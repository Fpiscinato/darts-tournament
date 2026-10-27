import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Camera, CameraOff, Crosshair, Download, RefreshCw, Scan, ScanLine, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  BOARD,
  SEGMENTS,
  pointOnBoard,
  ringPolygon,
  scoreAtPoint,
  segmentSpokes,
} from "@/lib/darts/boardGeometry"
import type { BoardScore, Point } from "@/lib/darts/boardGeometry"
import { detectBoard } from "@/lib/darts/boardDetector"
import { applyHomography, invertHomography, solveHomography } from "@/lib/darts/homography"
import type { Homography } from "@/lib/darts/homography"
import {
  changedRatio,
  connectedComponents,
  differenceMask,
  toGrayscale,
} from "@/lib/darts/dartDetection"
import { cn } from "@/lib/utils"

/** Radius (mm) where a manual tap lands when the user taps the outer wire of
 * the double ring. */
const MANUAL_RING_MM = BOARD.doubleOuter
/** The automatic detector locks onto the middle of the double wire pair
 * (162–170 mm), so its radius corresponds to ~166 mm. */
const AUTO_RING_MM = (BOARD.doubleInner + BOARD.doubleOuter) / 2
/** Processing resolution for differencing; 640 px keeps a dart ~40 px long. */
const DETECT_WIDTH = 640
const STORAGE_KEY = "darts.cameraLab.calibration.v1"

type Phase = "idle" | "starting" | "live" | "error"
type Mode = "calibrating" | "rotation" | "live"

interface DetectedDart {
  a: Point
  b: Point
  scoreA: BoardScore
  scoreB: BoardScore
  age: number
}

interface Hud {
  fps: number
  ms: number
  mmPerPx: number
}

/** One dart in the practice session. Auto detections carry both candidate
 * tips so the user only has to pick which one is the point. */
interface SessionDart {
  id: string
  at: string
  method: "auto" | "tap"
  candidateA: string | null
  candidateB: string | null
  chosen: string | null
  discarded: boolean
}

const SESSION_KEY = "darts.cameraLab.session.v1"

/** Turn a score label into something a speech engine reads naturally. */
function scoreSpeech(label: string): string {
  if (label === "50") return "fifty. Bullseye."
  if (label === "25") return "twenty five"
  if (label === "MISS") return "miss"
  const number = label.slice(1)
  if (label.startsWith("T")) return `triple ${number}`
  if (label.startsWith("D")) return `double ${number}`
  return number
}

function loadSession(): SessionDart[] {
  try {
    const stored = localStorage.getItem(SESSION_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as SessionDart[]
    return Array.isArray(parsed) ? parsed.slice(-500) : []
  } catch {
    return []
  }
}

function saveSession(records: SessionDart[]): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(records.slice(-500)))
  } catch {
    // Private mode: the session still works, it just will not survive a reload.
  }
}

/** The four calibration targets, clockwise from the top of the board. */
const CALIBRATION_TARGETS = [
  { label: "20", mm: pointOnBoard(20, MANUAL_RING_MM) },
  { label: "6", mm: pointOnBoard(6, MANUAL_RING_MM) },
  { label: "3", mm: pointOnBoard(3, MANUAL_RING_MM) },
  { label: "11", mm: pointOnBoard(11, MANUAL_RING_MM) },
]

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  toPixel: (point: Point) => Point,
): void {
  ctx.beginPath()
  points.forEach((point, index) => {
    const pixel = toPixel(point)
    if (index === 0) ctx.moveTo(pixel.x, pixel.y)
    else ctx.lineTo(pixel.x, pixel.y)
  })
  ctx.closePath()
  ctx.stroke()
}

export function CameraLabPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const backgroundRef = useRef<Uint8ClampedArray | null>(null)
  const staticOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const lastProcessRef = useRef(0)
  const lastDurationRef = useRef(0)
  const frameTimesRef = useRef<number[]>([])

  const calibrationPxRef = useRef<Point[]>([])
  const homographyRef = useRef<Homography | null>(null)
  const inverseRef = useRef<Homography | null>(null)
  const pendingBoardRef = useRef<{ center: Point; radius: number; confidence: number } | null>(null)
  const dartsRef = useRef<DetectedDart[]>([])
  const lastScoreRef = useRef<{ score: BoardScore; at: Point } | null>(null)

  const pushRecord = useCallback((record: SessionDart) => {
    sessionRef.current = [...sessionRef.current, record].slice(-500)
    setSession(sessionRef.current)
    saveSession(sessionRef.current)
  }, [])

  const [voice, setVoice] = useState(true)
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const lastSpokenRef = useRef(0)

  const speakLabel = useCallback((label: string) => {
    if (!voiceRef.current) return
    const synth = window.speechSynthesis
    if (!synth) return
    const now = Date.now()
    if (now - lastSpokenRef.current < 700) return
    lastSpokenRef.current = now
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(scoreSpeech(label))
    utterance.lang = "en-US"
    utterance.rate = 1.05
    synth.speak(utterance)
  }, [])

  const updateRecord = useCallback((id: string, patch: Partial<SessionDart>) => {
    sessionRef.current = sessionRef.current.map((record) =>
      record.id === id ? { ...record, ...patch } : record,
    )
    setSession(sessionRef.current)
    saveSession(sessionRef.current)
  }, [])

  const [phase, setPhase] = useState<Phase>("idle")
  const [mode, setMode] = useState<Mode>("calibrating")
  const [error, setError] = useState<string | null>(null)
  const [calibrationVersion, setCalibrationVersion] = useState(0)
  const [tapCount, setTapCount] = useState(0)
  const [autoDetect, setAutoDetect] = useState(true)
  const [showModel, setShowModel] = useState(true)
  const [sensitivity, setSensitivity] = useState(35)
  const [lastScore, setLastScore] = useState<{ score: BoardScore; at: Point } | null>(null)
  const [hud, setHud] = useState<Hud>({ fps: 0, ms: 0, mmPerPx: 0 })
  const sessionRef = useRef<SessionDart[]>(loadSession())
  const [session, setSession] = useState<SessionDart[]>(sessionRef.current)
  const [pendingConfidence, setPendingConfidence] = useState<number | null>(null)

  const modeRef = useRef(mode)
  modeRef.current = mode
  const autoRef = useRef(autoDetect)
  autoRef.current = autoDetect
  const showModelRef = useRef(showModel)
  showModelRef.current = showModel
  const sensitivityRef = useRef(sensitivity)
  sensitivityRef.current = sensitivity
  lastScoreRef.current = lastScore

  const calibrated = calibrationVersion > 0

  const applyCalibration = useCallback((pixels: Point[]) => {
    const h = solveHomography(
      pixels,
      CALIBRATION_TARGETS.map((target) => target.mm),
    )
    if (!h) {
      setError("Those four points are nearly collinear — retry the calibration.")
      return false
    }
    homographyRef.current = h
    inverseRef.current = invertHomography(h)
    calibrationPxRef.current = pixels
    setCalibrationVersion((version) => version + 1)
    setMode("live")
    setError(null)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pixels))
    } catch {
      // Storage can be unavailable in private mode; the lab still works.
    }
    return true
  }, [])

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    dartsRef.current = []
    backgroundRef.current = null
    setPhase("idle")
  }, [])

  const startCamera = useCallback(async () => {
    setError(null)
    setPhase("starting")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      setPhase("live")
    } catch (err) {
      setPhase("error")
      setError(
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : "Could not start the camera. The page must be served over HTTPS.",
      )
    }
  }, [])

  // Restore a previous calibration once the video is running.
  useEffect(() => {
    if (phase !== "live" || calibrated) return
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored) as Point[]
      if (Array.isArray(parsed) && parsed.length === 4) applyCalibration(parsed)
    } catch {
      // Ignore malformed storage.
    }
  }, [phase, calibrated, applyCalibration])

  const setBackground = useCallback(() => {
    const video = videoRef.current
    const detect = detectCanvasRef.current
    if (!video || !detect || detect.width === 0) return
    const ctx = detect.getContext("2d", { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(video, 0, 0, detect.width, detect.height)
    const image = ctx.getImageData(0, 0, detect.width, detect.height)
    backgroundRef.current = toGrayscale(image.data, detect.width, detect.height)
    dartsRef.current = []
    setLastScore(null)
  }, [])

  const resetCalibration = useCallback(() => {
    homographyRef.current = null
    inverseRef.current = null
    calibrationPxRef.current = []
    pendingBoardRef.current = null
    dartsRef.current = []
    setCalibrationVersion(0)
    setTapCount(0)
    setMode("calibrating")
    setPendingConfidence(null)
    setLastScore(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [])

  const runAutoDetect = useCallback(() => {
    const video = videoRef.current
    const detect = detectCanvasRef.current
    if (!video || !detect || detect.width === 0) return
    const ctx = detect.getContext("2d", { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(video, 0, 0, detect.width, detect.height)
    const image = ctx.getImageData(0, 0, detect.width, detect.height)
    const gray = toGrayscale(image.data, detect.width, detect.height)
    const found = detectBoard(gray, detect.width, detect.height)
    if (!found) {
      setError(
        "No board found in this frame — fill the frame with the board, improve the light, or calibrate manually.",
      )
      return
    }
    // Convert detection-canvas pixels to the video's intrinsic pixels.
    const scale = video.videoWidth / detect.width
    pendingBoardRef.current = {
      center: { x: found.center.x * scale, y: found.center.y * scale },
      radius: found.radius * scale,
      confidence: found.confidence,
    }
    setPendingConfidence(found.confidence)
    setError(null)
    setMode("rotation")
  }, [])

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const point: Point = {
        x: ((event.clientX - rect.left) * canvas.width) / rect.width,
        y: ((event.clientY - rect.top) * canvas.height) / rect.height,
      }

      if (modeRef.current === "calibrating") {
        const next = [...calibrationPxRef.current, point]
        calibrationPxRef.current = next
        setTapCount(next.length)
        if (next.length === 4) applyCalibration(next)
        return
      }

      if (modeRef.current === "rotation") {
        const pending = pendingBoardRef.current
        if (!pending) return
        // The tap marks the middle of the 20 double; that fixes the rotation.
        const angle = Math.atan2(point.y - pending.center.y, point.x - pending.center.x)
        const radiusPx = pending.radius * (MANUAL_RING_MM / AUTO_RING_MM)
        const pixels: Point[] = [0, 90, 180, 270].map((offset) => {
          const radians = angle + (offset * Math.PI) / 180
          return {
            x: pending.center.x + radiusPx * Math.cos(radians),
            y: pending.center.y + radiusPx * Math.sin(radians),
          }
        })
        pendingBoardRef.current = null
        setPendingConfidence(null)
        setTapCount(4)
        applyCalibration(pixels)
        return
      }

      const h = homographyRef.current
      if (!h) return
      const board = applyHomography(h, point)
      const score = scoreAtPoint(board)
      setLastScore({ score, at: point })
      speakLabel(score.label)
      pushRecord({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        method: "tap",
        candidateA: score.label,
        candidateB: null,
        chosen: score.label,
        discarded: false,
      })
    },
    [applyCalibration, pushRecord, speakLabel],
  )

  // Render + detection loop. Restarts when the calibration or the model
  // visibility changes, because the static overlay is cached per run.
  useEffect(() => {
    if (phase !== "live") return
    const video = videoRef.current
    const canvas = canvasRef.current
    const detect = detectCanvasRef.current
    if (!video || !canvas || !detect) return

    const ctx = canvas.getContext("2d")
    const detectCtx = detect.getContext("2d", { willReadFrequently: true })
    if (!ctx || !detectCtx) return

    let stopped = false
    let overlay: HTMLCanvasElement | null = null
    let hudAt = 0

    const buildOverlay = (): HTMLCanvasElement | null => {
      const inverse = inverseRef.current
      if (!inverse || !showModelRef.current) return null

      const buffer = staticOverlayRef.current ?? document.createElement("canvas")
      staticOverlayRef.current = buffer
      if (buffer.width !== canvas.width || buffer.height !== canvas.height) {
        buffer.width = canvas.width
        buffer.height = canvas.height
      }
      const bctx = buffer.getContext("2d")
      if (!bctx) return null

      bctx.clearRect(0, 0, buffer.width, buffer.height)
      const toPixel = (point: Point) => applyHomography(inverse, point)

      bctx.lineWidth = Math.max(1.5, canvas.width / 700)
      bctx.strokeStyle = "rgba(56, 189, 248, 0.85)"
      drawPolygon(bctx, ringPolygon(BOARD.doubleOuter), toPixel)
      drawPolygon(bctx, ringPolygon(BOARD.tripleOuter), toPixel)
      drawPolygon(bctx, ringPolygon(BOARD.tripleInner), toPixel)
      drawPolygon(bctx, ringPolygon(BOARD.outerBull), toPixel)

      bctx.strokeStyle = "rgba(148, 163, 184, 0.7)"
      for (const [inner, outer] of segmentSpokes()) {
        const a = toPixel(inner)
        const b = toPixel(outer)
        bctx.beginPath()
        bctx.moveTo(a.x, a.y)
        bctx.lineTo(b.x, b.y)
        bctx.stroke()
      }

      bctx.fillStyle = "rgba(226, 232, 240, 0.95)"
      bctx.font = `600 ${Math.max(12, canvas.width / 45)}px system-ui, sans-serif`
      bctx.textAlign = "center"
      bctx.textBaseline = "middle"
      for (const segment of SEGMENTS) {
        const label = toPixel(pointOnBoard(segment, 190))
        bctx.fillText(String(segment), label.x, label.y)
      }

      bctx.fillStyle = "rgba(250, 204, 21, 0.95)"
      for (const pixel of calibrationPxRef.current) {
        bctx.beginPath()
        bctx.arc(pixel.x, pixel.y, Math.max(3, canvas.width / 220), 0, Math.PI * 2)
        bctx.fill()
      }

      return buffer
    }

    const drawDetections = () => {
      const darts = dartsRef.current
      if (darts.length === 0) return

      ctx.lineWidth = Math.max(2, canvas.width / 400)
      for (const dart of darts) {
        const { a, b } = dart
        ctx.strokeStyle = "rgba(250, 204, 21, 0.9)"
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()

        const markers: [Point, BoardScore, string][] = [
          [a, dart.scoreA, "#fbbf24"],
          [b, dart.scoreB, "#f472b6"],
        ]
        for (const [point, score, colour] of markers) {
          ctx.beginPath()
          ctx.arc(point.x, point.y, Math.max(4, canvas.width / 160), 0, Math.PI * 2)
          ctx.fillStyle = colour
          ctx.fill()
          ctx.strokeStyle = "rgba(0,0,0,0.7)"
          ctx.stroke()

          const fontSize = Math.max(14, canvas.width / 34)
          ctx.font = `700 ${fontSize}px system-ui, sans-serif`
          ctx.textAlign = "left"
          ctx.textBaseline = "middle"
          const padding = fontSize * 0.3
          const width = ctx.measureText(score.label).width + padding * 2
          const x = point.x + fontSize * 0.6
          const y = point.y - fontSize * 0.9
          ctx.fillStyle = "rgba(2, 6, 23, 0.8)"
          ctx.fillRect(x - padding, y - fontSize / 2 - padding, width, fontSize + padding * 2)
          ctx.fillStyle = colour
          ctx.fillText(score.label, x, y)
        }
      }
    }

    const detectDarts = (now: number) => {
      if (now - lastProcessRef.current < 80) return
      lastProcessRef.current = now
      const started = performance.now()

      detectCtx.drawImage(video, 0, 0, detect.width, detect.height)
      const image = detectCtx.getImageData(0, 0, detect.width, detect.height)
      const gray = toGrayscale(image.data, detect.width, detect.height)

      const background = backgroundRef.current
      const h = homographyRef.current
      if (!background || !h || !autoRef.current) {
        lastDurationRef.current = performance.now() - started
        return
      }

      const mask = differenceMask(gray, background, sensitivityRef.current)
      const ratio = changedRatio(mask)

      // A hand or an arm crossing the frame invalidates the difference.
      if (ratio > 0.08) {
        dartsRef.current = []
        return
      }

      const scale = video.videoWidth / detect.width
      const blobs = connectedComponents(mask, detect.width, detect.height, {
        minArea: 24,
        maxArea: 6000,
        minLength: 10,
      })

      const next: DetectedDart[] = []
      for (const blob of blobs) {
        const endpoints = blob.endpoints.map((endpoint) => ({
          x: endpoint.x * scale,
          y: endpoint.y * scale,
        }))
        const scores = endpoints.map((endpoint) => scoreAtPoint(applyHomography(h, endpoint)))

        // Both ends off the board means an arm, a chair or the wall — not a
        // dart. Dropping these keeps the session log readable.
        if (scores.every((score) => score.ring === "miss")) continue

        const previous = dartsRef.current.find(
          (dart) =>
            Math.hypot(dart.a.x - endpoints[0].x, dart.a.y - endpoints[0].y) < 24 * scale ||
            Math.hypot(dart.b.x - endpoints[1].x, dart.b.y - endpoints[1].y) < 24 * scale,
        )

        const age = (previous?.age ?? 0) + 1
        if (age === 3) {
          speakLabel(scores[0].label)
          pushRecord({
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            method: "auto",
            candidateA: scores[0].label,
            candidateB: scores[1].label,
            chosen: null,
            discarded: false,
          })
        }

        next.push({
          a: endpoints[0],
          b: endpoints[1],
          scoreA: scores[0],
          scoreB: scores[1],
          age,
        })
      }

      dartsRef.current = next
      lastDurationRef.current = performance.now() - started
    }

    const frame = (now: number) => {
      if (stopped) return
      rafRef.current = requestAnimationFrame(frame)

      if (video.videoWidth === 0) return

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        detect.width = Math.min(DETECT_WIDTH, video.videoWidth)
        detect.height = Math.round((detect.width * video.videoHeight) / video.videoWidth)
        staticOverlayRef.current = null
        overlay = buildOverlay()
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      if (!overlay) overlay = buildOverlay()
      if (overlay) ctx.drawImage(overlay, 0, 0)

      const pending = pendingBoardRef.current
      if (pending) {
        ctx.strokeStyle = "rgba(56, 189, 248, 0.95)"
        ctx.lineWidth = Math.max(2, canvas.width / 400)
        ctx.beginPath()
        ctx.arc(pending.center.x, pending.center.y, pending.radius, 0, Math.PI * 2)
        ctx.stroke()
      }

      const tap = lastScoreRef.current
      if (tap) {
        ctx.beginPath()
        ctx.arc(tap.at.x, tap.at.y, Math.max(5, canvas.width / 140), 0, Math.PI * 2)
        ctx.fillStyle = "rgba(34, 197, 94, 0.95)"
        ctx.fill()
      }

      drawDetections()

      if (modeRef.current === "live") detectDarts(now)

      frameTimesRef.current.push(now)
      if (now - hudAt > 500) {
        hudAt = now
        const times = frameTimesRef.current.filter((time) => now - time < 1000)
        frameTimesRef.current = times
        const inverse = inverseRef.current
        let mmPerPx = 0
        if (inverse) {
          const a = applyHomography(inverse, { x: 0, y: 0 })
          const b = applyHomography(inverse, { x: 100, y: 0 })
          mmPerPx = 100 / Math.hypot(a.x - b.x, a.y - b.y)
        }
        setHud({ fps: times.length, ms: lastDurationRef.current, mmPerPx })
      }
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      stopped = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [phase, calibrationVersion, showModel, pushRecord, speakLabel])

  useEffect(() => () => stopCamera(), [stopCamera])

  const calibrationHint = CALIBRATION_TARGETS[Math.min(tapCount, 3)].label

  const autoDarts = session.filter((record) => record.method === "auto")
  const confirmed = autoDarts.filter((record) => record.chosen !== null)
  const aWins = confirmed.filter((record) => record.chosen === record.candidateA).length
  const bWins = confirmed.filter((record) => record.chosen === record.candidateB).length
  const pendingDart =
    session.find((record) => record.method === "auto" && record.chosen === null && !record.discarded) ?? null

  const confirmDart = (choice: "a" | "b") => {
    if (!pendingDart) return
    const label = choice === "a" ? pendingDart.candidateA : pendingDart.candidateB
    updateRecord(pendingDart.id, { chosen: label })
    if (label) speakLabel(label)
  }

  const discardDart = () => {
    if (pendingDart) updateRecord(pendingDart.id, { discarded: true })
  }

  const resetSession = () => {
    sessionRef.current = []
    setSession([])
    saveSession([])
  }

  const exportSession = () => {
    const payload = {
      app: "darts-camera-lab",
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      calibration: {
        points: calibrationPxRef.current,
        mmPerPx: hud.mmPerPx,
      },
      summary: {
        darts: autoDarts.length,
        confirmed: confirmed.length,
        tipA: aWins,
        tipB: bWins,
      },
      records: sessionRef.current,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `camera-lab-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" className="min-h-11">
          <Link to="/">
            <ArrowLeft /> Back
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Scan className="text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Camera Lab</h1>
        </div>
        <Badge variant="secondary">experimental</Badge>
        {calibrated && <Badge variant="outline">calibrated</Badge>}
      </div>

      <div
        className="relative overflow-hidden rounded-lg border border-border bg-black"
        style={{ aspectRatio: "16 / 10" }}
      >
        <video ref={videoRef} muted playsInline className="hidden" />
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className={cn("h-full w-full object-contain", phase === "live" ? "cursor-crosshair" : "opacity-0")}
        />
        <canvas ref={detectCanvasRef} className="hidden" />

        {phase !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-300">
            <Camera className="h-8 w-8" aria-hidden="true" />
            <p className="max-w-xs">
              Point the rear camera at the board from about 1.5–2 m, fill the frame, then start. Needs HTTPS and
              camera permission.
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {phase === "live" && mode === "calibrating" && (
        <p className="text-sm text-muted-foreground">
          Tap the <strong className="text-foreground">outer wire of the double “{calibrationHint}”</strong> —{" "}
          {tapCount}/4 points.{tapCount === 0 && " Or use “Detect board” for a one-tap setup."}
        </p>
      )}

      {phase === "live" && mode === "rotation" && (
        <p className="text-sm text-muted-foreground">
          Board found{pendingConfidence ? ` (confidence ${(pendingConfidence * 100).toFixed(0)}%)` : ""}. Now tap
          the <strong className="text-foreground">middle of the double 20</strong> to set the rotation.
        </p>
      )}

      {phase === "live" && mode === "live" && (
        <p className="text-sm text-muted-foreground">
          Tap any point to read its score. Set an empty-board reference, then throw — each new dart shows two
          candidate tips (yellow = start, pink = end) with their scores.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {phase !== "live" ? (
          <Button className="min-h-11" onClick={startCamera} disabled={phase === "starting"}>
            <Camera /> {phase === "starting" ? "Starting…" : "Start camera"}
          </Button>
        ) : (
          <Button variant="outline" className="min-h-11" onClick={stopCamera}>
            <CameraOff /> Stop
          </Button>
        )}

        <Button variant="outline" className="min-h-11" onClick={runAutoDetect} disabled={phase !== "live"}>
          <ScanLine /> Detect board
        </Button>

        <Button variant="outline" className="min-h-11" onClick={setBackground} disabled={!calibrated}>
          <Crosshair /> Empty board
        </Button>

        <Button variant="outline" className="min-h-11" onClick={resetCalibration} disabled={phase !== "live"}>
          <RefreshCw /> Recalibrate
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoDetect}
            onChange={(event) => setAutoDetect(event.target.checked)}
            className="h-5 w-5"
          />
          Auto-detect darts
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showModel}
            onChange={(event) => setShowModel(event.target.checked)}
            className="h-5 w-5"
          />
          Show board model
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={voice}
            onChange={(event) => {
              setVoice(event.target.checked)
              if (event.target.checked) speakLabel("triple 20")
            }}
            className="h-5 w-5"
          />
          Voice
        </label>
        <label className="flex min-w-40 flex-1 items-center gap-2">
          <span className="whitespace-nowrap">Sensitivity</span>
          <input
            type="range"
            min={10}
            max={80}
            value={sensitivity}
            onChange={(event) => setSensitivity(Number(event.target.value))}
            className="w-full accent-sky-500"
          />
          <span className="w-8 tabular-nums">{sensitivity}</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{hud.fps} fps</span>
        <span>{hud.ms.toFixed(0)} ms/frame</span>
        <span>{hud.mmPerPx ? `${hud.mmPerPx.toFixed(2)} mm/px` : "not calibrated"}</span>
        {lastScore && <span>last tap: {lastScore.score.label}</span>}
      </div>

      {pendingDart && (
        <div className="rounded-lg border border-sky-500/50 bg-sky-500/5 p-3">
          <p className="text-sm font-medium">Dart detected — which tip is the point?</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button className="min-h-11" onClick={() => confirmDart("a")}>
              A · {pendingDart.candidateA}
            </Button>
            <Button variant="secondary" className="min-h-11" onClick={() => confirmDart("b")}>
              B · {pendingDart.candidateB}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={discardDart}>
              Discard
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Session</p>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={exportSession} disabled={session.length === 0}>
              <Download /> Export JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={resetSession} disabled={session.length === 0}>
              <Trash2 /> Reset
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {autoDarts.length} auto darts · {confirmed.length} confirmed · tip A {aWins} / B {bWins}
          {confirmed.length >= 3 && aWins + bWins > 0 && (
            <> — the point is {aWins >= bWins ? "A" : "B"}</>
          )}
        </p>
        {session.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Throw a dart — every detection is logged here.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {session
              .slice(-16)
              .reverse()
              .map((record) => (
                <li
                  key={record.id}
                  title={
                    record.method === "tap"
                      ? "manual tap"
                      : `auto: A ${record.candidateA} / B ${record.candidateB}`
                  }
                  className={cn(
                    "rounded-md px-2 py-1 text-sm tabular-nums",
                    record.discarded
                      ? "bg-muted/40 text-muted-foreground line-through"
                      : record.chosen
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400",
                  )}
                >
                  {record.chosen ?? `${record.candidateA}/${record.candidateB}`}
                </li>
              ))}
          </ul>
        )}
      </div>

      <p className="pb-6 text-xs text-muted-foreground">
        Everything runs locally: no frame leaves the device. Calibration is stored in this browser only. This
        prototype measures detection quality — it does not touch tournament data.
      </p>
    </div>
  )
}
