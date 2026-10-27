import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  Camera,
  CameraOff,
  Crosshair,
  Download,
  MousePointerClick,
  RefreshCw,
  Scan,
  ScanLine,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
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
import {
  MAX_ZOOM,
  MIN_ZOOM,
  autoFrame,
  clampZoom,
  clampViewport,
  clientToCanvas,
  cropFor,
  screenToVideo,
  videoToScreen,
  viewportAnchoredOn,
} from "@/lib/darts/viewport"
import type { Viewport } from "@/lib/darts/viewport"
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

const STEPS = ["Camera", "Find board", "Set rotation", "Empty board", "Throw"] as const

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

interface Gesture {
  kind: "pan" | "pinch"
  startViewport: Viewport
  startPoint: Point
  startDistance: number
  anchorVideo: Point
  moved: boolean
  startedAt: number
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
  const viewportRef = useRef<Viewport>({ zoom: 1, center: { x: 0, y: 0 } })
  const pointersRef = useRef(new Map<number, Point>())
  const gestureRef = useRef<Gesture | null>(null)

  const [phase, setPhase] = useState<Phase>("idle")
  const [mode, setMode] = useState<Mode>("calibrating")
  const [manual, setManual] = useState(false)
  const [referenceSet, setReferenceSet] = useState(false)
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
  const [voice, setVoice] = useState(true)
  const [viewport, setViewport] = useState<Viewport>(viewportRef.current)
  const [stageAspect, setStageAspect] = useState("16 / 10")

  const modeRef = useRef(mode)
  modeRef.current = mode
  const manualRef = useRef(manual)
  manualRef.current = manual
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const autoRef = useRef(autoDetect)
  autoRef.current = autoDetect
  const showModelRef = useRef(showModel)
  showModelRef.current = showModel
  const sensitivityRef = useRef(sensitivity)
  sensitivityRef.current = sensitivity
  lastScoreRef.current = lastScore

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

  const pushRecord = useCallback((record: SessionDart) => {
    sessionRef.current = [...sessionRef.current, record].slice(-500)
    setSession(sessionRef.current)
    saveSession(sessionRef.current)
  }, [])

  const updateRecord = useCallback((id: string, patch: Partial<SessionDart>) => {
    sessionRef.current = sessionRef.current.map((record) =>
      record.id === id ? { ...record, ...patch } : record,
    )
    setSession(sessionRef.current)
    saveSession(sessionRef.current)
  }, [])

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
    setManual(false)
    setReferenceSet(false)
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
    pointersRef.current.clear()
    gestureRef.current = null
    viewportRef.current = { zoom: 1, center: { x: 0, y: 0 } }
    setViewport(viewportRef.current)
    setReferenceSet(false)
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

  const applyViewport = useCallback((next: Viewport, width: number, height: number) => {
    const clamped = clampViewport(next, width, height)
    viewportRef.current = clamped
    setViewport(clamped)
  }, [])

  const setDigitalZoom = useCallback(
    (zoom: number) => {
      const video = videoRef.current
      applyViewport(
        { zoom: clampZoom(zoom), center: viewportRef.current.center },
        video?.videoWidth ?? 0,
        video?.videoHeight ?? 0,
      )
    },
    [applyViewport],
  )

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
    setReferenceSet(true)
  }, [])

  const resetCalibration = useCallback(() => {
    homographyRef.current = null
    inverseRef.current = null
    calibrationPxRef.current = []
    pendingBoardRef.current = null
    dartsRef.current = []
    setCalibrationVersion(0)
    setTapCount(0)
    setManual(false)
    setMode("calibrating")
    setPendingConfidence(null)
    setReferenceSet(false)
    setLastScore(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [])

  const startManual = useCallback(() => {
    calibrationPxRef.current = []
    pendingBoardRef.current = null
    setTapCount(0)
    setManual(true)
    setMode("calibrating")
    setPendingConfidence(null)
    setError(null)
  }, [])

  const cancelManual = useCallback(() => {
    calibrationPxRef.current = []
    setTapCount(0)
    setManual(false)
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
        "No board found in this frame — fill the frame with the board, improve the light, or calibrate by hand.",
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
    setManual(false)
    setError(null)
    setMode("rotation")

    // Frame the board for the user: the tap on the double 20 is much easier
    // when the numbers are readable. Still adjustable with the slider.
    const pending = pendingBoardRef.current
    if (pending) {
      applyViewport(
        autoFrame(pending.center, pending.radius, video.videoWidth, video.videoHeight),
        video.videoWidth,
        video.videoHeight,
      )
    }
  }, [applyViewport])

  const handleTap = useCallback(
    (point: Point) => {
      if (modeRef.current === "calibrating") {
        if (!manualRef.current) {
          setError("Tap “Find the board” first — or calibrate by hand.")
          return
        }
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

  const canvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    return clientToCanvas(
      event.clientX,
      event.clientY,
      canvas.getBoundingClientRect(),
      canvas.width,
      canvas.height,
    )
  }, [])

  const beginPan = useCallback(
    (point: Point, moved: boolean): Gesture => {
      const video = videoRef.current
      const width = video?.videoWidth ?? 0
      const height = video?.videoHeight ?? 0
      const canvas = canvasRef.current
      const crop = cropFor(viewportRef.current, width, height)
      return {
        kind: "pan",
        startViewport: viewportRef.current,
        startPoint: point,
        startDistance: 0,
        anchorVideo: screenToVideo(point, crop, canvas?.width ?? 0, canvas?.height ?? 0),
        moved,
        startedAt: performance.now(),
      }
    },
    [],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (phase !== "live") return
      const canvas = canvasRef.current
      if (!canvas) return
      const point = canvasPoint(event)
      pointersRef.current.set(event.pointerId, point)
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is best-effort.
      }

      if (pointersRef.current.size === 1) {
        gestureRef.current = beginPan(point, false)
        return
      }

      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const video = videoRef.current
        const crop = cropFor(viewportRef.current, video?.videoWidth ?? 0, video?.videoHeight ?? 0)
        gestureRef.current = {
          kind: "pinch",
          startViewport: viewportRef.current,
          startPoint: mid,
          startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          anchorVideo: screenToVideo(mid, crop, canvas.width, canvas.height),
          moved: true,
          startedAt: performance.now(),
        }
      }
    },
    [beginPan, canvasPoint, phase],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return
      const canvas = canvasRef.current
      const gesture = gestureRef.current
      const video = videoRef.current
      if (!canvas || !gesture || !video || video.videoWidth === 0) return

      const point = canvasPoint(event)
      pointersRef.current.set(event.pointerId, point)
      const width = video.videoWidth
      const height = video.videoHeight

      if (gesture.kind === "pinch" && pointersRef.current.size >= 2) {
        const [a, b] = [...pointersRef.current.values()]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const zoom = clampZoom(gesture.startViewport.zoom * (distance / gesture.startDistance))
        const fraction = { x: mid.x / canvas.width, y: mid.y / canvas.height }
        applyViewport(viewportAnchoredOn(zoom, gesture.anchorVideo, fraction, width, height), width, height)
        return
      }

      if (gesture.kind !== "pan" || pointersRef.current.size !== 1) return

      const dx = point.x - gesture.startPoint.x
      const dy = point.y - gesture.startPoint.y
      if (Math.hypot(dx, dy) > 8) gesture.moved = true
      if (!gesture.moved || gesture.startViewport.zoom <= MIN_ZOOM) return

      const crop = cropFor(gesture.startViewport, width, height)
      const scale = crop.width / canvas.width
      applyViewport(
        {
          zoom: gesture.startViewport.zoom,
          center: {
            x: gesture.startViewport.center.x - dx * scale,
            y: gesture.startViewport.center.y - dy * scale,
          },
        },
        width,
        height,
      )
    },
    [applyViewport, canvasPoint],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const point = pointersRef.current.get(event.pointerId) ?? canvasPoint(event)
      pointersRef.current.delete(event.pointerId)
      const gesture = gestureRef.current
      gestureRef.current = null

      // One finger lifted while another is still down: keep panning with it.
      if (pointersRef.current.size === 1) {
        const remaining = [...pointersRef.current.values()][0]
        gestureRef.current = beginPan(remaining, true)
        return
      }

      if (!gesture) return
      if (gesture.kind === "pan" && !gesture.moved && performance.now() - gesture.startedAt < 600) {
        const video = videoRef.current
        const crop = cropFor(viewportRef.current, video?.videoWidth ?? 0, video?.videoHeight ?? 0)
        handleTap(screenToVideo(point, crop, canvas.width, canvas.height))
      }
    },
    [beginPan, canvasPoint, handleTap],
  )

  const handlePointerCancel = useCallback(() => {
    pointersRef.current.clear()
    gestureRef.current = null
  }, [])

  // Render + detection loop. Restarts when the calibration or the model
  // visibility changes, because the static overlay is cached per run. Zooming
  // is applied per frame, so it never restarts the loop.
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
    let aspect = ""

    const buildOverlay = (): HTMLCanvasElement | null => {
      const inverse = inverseRef.current
      const width = video.videoWidth
      const height = video.videoHeight
      if (!inverse || !showModelRef.current || width === 0 || height === 0) return null

      const buffer = staticOverlayRef.current ?? document.createElement("canvas")
      staticOverlayRef.current = buffer
      if (buffer.width !== width || buffer.height !== height) {
        buffer.width = width
        buffer.height = height
      }
      const bctx = buffer.getContext("2d")
      if (!bctx) return null

      bctx.clearRect(0, 0, width, height)
      const toPixel = (point: Point) => applyHomography(inverse, point)

      bctx.lineWidth = Math.max(1.5, width / 700)
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
      bctx.font = `600 ${Math.max(12, width / 45)}px system-ui, sans-serif`
      bctx.textAlign = "center"
      bctx.textBaseline = "middle"
      for (const segment of SEGMENTS) {
        const label = toPixel(pointOnBoard(segment, 190))
        bctx.fillText(String(segment), label.x, label.y)
      }

      bctx.fillStyle = "rgba(250, 204, 21, 0.95)"
      for (const pixel of calibrationPxRef.current) {
        bctx.beginPath()
        bctx.arc(pixel.x, pixel.y, Math.max(3, width / 220), 0, Math.PI * 2)
        bctx.fill()
      }

      return buffer
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
        overlay = null

        const ratio = video.videoWidth / video.videoHeight
        const nextAspect = ratio.toFixed(3)
        if (nextAspect !== aspect) {
          aspect = nextAspect
          setStageAspect(nextAspect)
        }
      }

      const crop = cropFor(viewportRef.current, canvas.width, canvas.height)
      const toScreen = (point: Point) => videoToScreen(point, crop, canvas.width, canvas.height)

      ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
      if (!overlay) overlay = buildOverlay()
      if (overlay) {
        ctx.drawImage(overlay, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
      }

      const pending = pendingBoardRef.current
      if (pending) {
        const centre = toScreen(pending.center)
        const radius = (pending.radius * canvas.width) / crop.width
        ctx.setLineDash([10, 8])
        ctx.strokeStyle = "rgba(56, 189, 248, 0.95)"
        ctx.lineWidth = Math.max(2, canvas.width / 400)
        ctx.beginPath()
        ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])

        // A dot at the top of the board: the double 20 when the phone is upright.
        const dotRadius = Math.max(16, canvas.width / 55)
        const hintY = Math.max(dotRadius + 6, centre.y - radius)
        ctx.beginPath()
        ctx.arc(centre.x, hintY, dotRadius, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(56, 189, 248, 0.95)"
        ctx.fill()
        ctx.lineWidth = Math.max(2, canvas.width / 500)
        ctx.strokeStyle = "rgba(2, 6, 23, 0.85)"
        ctx.stroke()
        ctx.fillStyle = "#0f172a"
        ctx.font = `700 ${dotRadius * 0.95}px system-ui, sans-serif`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText("20", centre.x, hintY + dotRadius * 0.04)
      }

      const tap = lastScoreRef.current
      if (tap) {
        const marker = toScreen(tap.at)
        ctx.beginPath()
        ctx.arc(marker.x, marker.y, Math.max(5, canvas.width / 140), 0, Math.PI * 2)
        ctx.fillStyle = "rgba(34, 197, 94, 0.95)"
        ctx.fill()
      }

      const darts = dartsRef.current
      if (darts.length > 0) {
        ctx.lineWidth = Math.max(2, canvas.width / 400)
        for (const dart of darts) {
          const a = toScreen(dart.a)
          const b = toScreen(dart.b)
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

      if (modeRef.current === "live" && backgroundRef.current) detectDarts(now)

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

  const stepIndex =
    phase !== "live" ? 0 : mode === "calibrating" ? 1 : mode === "rotation" ? 2 : referenceSet ? 4 : 3

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
      zoom: viewport.zoom,
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

  const calibratingTarget = CALIBRATION_TARGETS[Math.min(tapCount, 3)].label

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

      <div aria-hidden="true">
        <div className="flex gap-1">
          {STEPS.map((step, index) => (
            <span
              key={step}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                index < stepIndex
                  ? "bg-emerald-500"
                  : index === stepIndex
                    ? "bg-sky-500"
                    : "bg-muted",
              )}
            />
          ))}
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded-lg border border-border bg-black"
        style={{ aspectRatio: stageAspect, maxHeight: "62vh" }}
      >
        <video ref={videoRef} muted playsInline className="hidden" />
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className={cn(
            "h-full w-full touch-none object-contain select-none",
            phase === "live" ? "cursor-crosshair" : "pointer-events-none opacity-0",
          )}
        />
        <canvas ref={detectCanvasRef} className="hidden" />

        {phase !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-300">
            <Camera className="h-8 w-8" aria-hidden="true" />
            <p className="max-w-xs">
              Hold the phone in portrait, about 1.5–2 m from the board, and fill the frame with it. Needs HTTPS and
              camera permission.
            </p>
          </div>
        )}
      </div>

      {phase === "live" && (
        <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
          <ZoomOut className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.1}
            value={viewport.zoom}
            onChange={(event) => setDigitalZoom(Number(event.target.value))}
            className="min-w-0 flex-1 accent-sky-500"
            aria-label="Zoom"
          />
          <ZoomIn className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="w-12 shrink-0 text-right text-xs tabular-nums">{viewport.zoom.toFixed(1)}×</span>
          <Button
            size="icon"
            variant="ghost"
            className="size-9 shrink-0"
            aria-label={voice ? "Mute voice feedback" : "Enable voice feedback"}
            aria-pressed={voice}
            onClick={() => {
              const next = !voice
              setVoice(next)
              if (next) speakLabel("triple 20")
            }}
          >
            {voice ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </Button>
        </div>
      )}

      {phase === "live" && viewport.zoom > 1 && (
        <p className="-mt-1 text-xs text-muted-foreground">Drag the image to move · pinch to zoom</p>
      )}

      <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3">
        <p className="text-sm font-semibold">
          Step {stepIndex + 1} of {STEPS.length} — {STEPS[stepIndex]}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {stepIndex === 0 &&
            "Start the rear camera. You can zoom with the slider, and pinch or drag the image once it is running."}
          {stepIndex === 1 &&
            (manual
              ? `Tap the outer wire of the double ${calibratingTarget} — ${tapCount}/4 points. Do one number at a time: 20, 6, 3, 11.`
              : "Tap “Find the board”. If it fails, fill the frame with the board and try again, or calibrate by hand with 4 taps.")}
          {stepIndex === 2 && (
            <>
              Board found
              {pendingConfidence ? ` (${Math.round(pendingConfidence * 100)}% confident)` : ""} and zoomed in on
              it. Now tap the <strong className="text-foreground">middle of the double 20</strong> — the segment at
              the top of the board, on the image above.
            </>
          )}
          {stepIndex === 3 &&
            "Take every dart off the board, then tap “Board is empty”. The detector compares each frame against this reference."}
          {stepIndex === 4 &&
            "Throw. Each dart is spoken out loud and logged. Pick A or B (which tip is the point) or Discard. After pulling the darts out, tap “Board is empty” again to reset the round."}
        </p>
        {manual && <p className="mt-1 text-sm text-muted-foreground">Next: double {calibratingTarget}</p>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-2">
        {stepIndex === 0 && (
          <Button className="min-h-12" onClick={startCamera} disabled={phase === "starting"}>
            <Camera /> {phase === "starting" ? "Starting…" : "Start camera"}
          </Button>
        )}
        {stepIndex === 1 && (
          <Button className="min-h-12" onClick={runAutoDetect}>
            <ScanLine /> Find the board
          </Button>
        )}
        {stepIndex === 2 && (
          <Button className="min-h-12" variant="outline" disabled>
            <MousePointerClick /> Tap the double 20 above
          </Button>
        )}
        {(stepIndex === 3 || stepIndex === 4) && (
          <Button
            className="min-h-12"
            variant={stepIndex === 4 ? "outline" : "default"}
            onClick={setBackground}
          >
            <Crosshair /> Board is empty
          </Button>
        )}

        {phase === "live" && (
          <div className="flex flex-wrap gap-2">
            {stepIndex === 1 && !manual && (
              <Button size="sm" variant="ghost" onClick={startManual}>
                <Crosshair /> Calibrate by hand
              </Button>
            )}
            {manual && (
              <Button size="sm" variant="ghost" onClick={cancelManual}>
                Cancel
              </Button>
            )}
            {stepIndex >= 2 && (
              <Button size="sm" variant="ghost" onClick={runAutoDetect}>
                <ScanLine /> Detect again
              </Button>
            )}
            {stepIndex >= 2 && (
              <Button size="sm" variant="ghost" onClick={resetCalibration}>
                <RefreshCw /> Recalibrate
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={stopCamera}>
              <CameraOff /> Stop camera
            </Button>
          </div>
        )}
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

      <details className="rounded-lg border border-border p-3 text-sm">
        <summary className="cursor-pointer select-none font-medium">Detection settings</summary>
        <div className="mt-3 flex flex-col gap-3">
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
      </details>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{hud.fps} fps</span>
        <span>{hud.ms.toFixed(0)} ms/frame</span>
        <span>{hud.mmPerPx ? `${hud.mmPerPx.toFixed(2)} mm/px` : "not calibrated"}</span>
        {lastScore && <span>last tap: {lastScore.score.label}</span>}
      </div>

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
