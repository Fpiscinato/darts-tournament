import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  Camera,
  CameraOff,
  Check,
  Crosshair,
  Download,
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
import { detectBoard, refineBoard } from "@/lib/darts/boardDetector"
import {
  applyHomography,
  composeHomography,
  invertHomography,
  scaleHomography,
  solveHomography,
} from "@/lib/darts/homography"
import type { Homography } from "@/lib/darts/homography"
import {
  BOARD_SPACE_SIZE,
  pixelToMm,
  staticEdgeMask,
  warpToBoardSpace,
} from "@/lib/darts/boardSpace"
import {
  changedRatio,
  connectedComponents,
  differenceMask,
  meanLuma,
  mergeSegments,
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
import { useWakeLock } from "@/hooks/useWakeLock"
import { cn } from "@/lib/utils"

/** Radius (mm) where a manual tap lands when the user taps the outer wire of
 * the double ring. */
const MANUAL_RING_MM = BOARD.doubleOuter
/** The Hough pass locks onto the middle of the double wire pair (162–170 mm)
 * when the fingerprint refinement cannot be used, so its radius corresponds
 * to ~166 mm. `refineBoard` instead returns the outer wire (170 mm). */
const AUTO_RING_MM = (BOARD.doubleInner + BOARD.doubleOuter) / 2
/** Long side, in pixels, of the small frame used for the Hough seed. Running
 * the Hough at full detection resolution would need a ~380 MB accumulator on a
 * 1080p frame; the fingerprint refinement then works on the full frame. */
const SEED_LONG_SIDE = 640
/** Processing resolution for differencing; 1280 px keeps a dart ~60 px long on
 * a board that fills a third of a 1080p frame, which is the difference between
 * seeing a dart and seeing noise. */
const DETECT_WIDTH = 1280
/** Minimum time between two logged darts, so one noisy frame cannot flood the
 * session. A real visit cannot throw faster than this anyway. */
const RECORD_COOLDOWN_MS = 900
/** Two detections whose tips are this close (mm) are the same dart. */
const SAME_DART_MM = 14
/** How often the board model is re-fitted, in ms. The phone sits on a mount and
 * gets nudged; following it costs ~15 ms and removes the need to recalibrate. */
const TRACK_INTERVAL_MS = 1000
/** A detection only becomes a dart after being seen in this many consecutive
 * frames: a darts is static, sensor noise and shadows are not. */
const HITS_TO_RECORD = 3
/** Largest share of board space that may change and still be a dart. One dart
 * covers a few tenths of a percent and a whole visit a bit over one; a nudged
 * phone covers several percent, which is what this separates. */
const MAX_DART_RATIO = 0.02
/** How long a dart may go unseen before its streak is forgotten, in ms. */
const TRACK_MEMORY_MS = 400
/** After the board model is re-fitted the warp is resampled, so a few frames
 * can look like a change. Nothing is recorded for this long afterwards. */
const TRACK_SETTLE_MS = 600
/** Plausible major-axis length of a dart, in board millimetres. A steel dart is
 * 120–180 mm; the view is slightly from the side, so allow a little either way.
 * Shadows, wires and numbers fall below the lower bound. */
const MIN_DART_MM = 90
const MAX_DART_MM = 280
const STORAGE_KEY = "darts.cameraLab.calibration.v1"
const CAMERA_KEY = "darts.cameraLab.camera.v1"

type Phase = "idle" | "starting" | "live" | "error"
type Mode = "calibrating" | "rotation" | "live"

/**
 * One dart-shaped change, tracked across frames.
 *
 * Everything is in board millimetres, so a moving phone cannot change what
 * "this dart" means: the geometry is re-warped every frame, not re-learned.
 */
interface DetectedDart {
  /** Both tips in board millimetres. */
  aMm: Point
  bMm: Point
  scoreA: BoardScore
  scoreB: BoardScore
  /** Major-axis length in millimetres, for filtering shadows and reflections. */
  lengthMm: number
  /** Consecutive frames this dart has been seen in. */
  hits: number
  /** Already pushed to the session. */
  recorded: boolean
  lastSeen: number
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
  /** Both tips in board millimetres, for tuning the detector from the export. */
  aMm?: Point
  bMm?: Point
  /** Detected major-axis length, in millimetres. */
  lengthMm?: number
}

interface KnownDart {
  aMm: Point
  bMm: Point
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** True when a new detection lands on a dart that is already logged. */
function isSameDart(a: Point, b: Point, known: KnownDart): boolean {
  return (
    Math.min(distance(a, known.aMm), distance(a, known.bMm), distance(b, known.aMm), distance(b, known.bMm)) <
    SAME_DART_MM
  )
}

const SESSION_KEY = "darts.cameraLab.session.v1"

const STEPS = ["Camera", "Find board", "Check board", "Empty board", "Throw"] as const

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
  /** Empty-board reference, stored in board space (never in video pixels). */
  const referenceRef = useRef<Uint8ClampedArray | null>(null)
  const referenceLumaRef = useRef(0)
  /** Pixels around wires and numbers in the reference; never scored. */
  const referenceEdgesRef = useRef<Uint8Array | null>(null)
  const staticOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const lastProcessRef = useRef(0)
  const lastDurationRef = useRef(0)
  const frameTimesRef = useRef<number[]>([])

  const calibrationPxRef = useRef<Point[]>([])
  const homographyRef = useRef<Homography | null>(null)
  const inverseRef = useRef<Homography | null>(null)
  const pendingBoardRef = useRef<{
    center: Point
    radius: number
    confidence: number
    /** Which board ring the radius describes, in mm. */
    ringMm: number
  } | null>(null)
  /** Accepted model in video pixels; the tracker re-fits it while the phone
   * moves. `radius` is always the 170 mm ring. */
  const modelRef = useRef<{ centre: Point; radius: number; ringMm: number } | null>(null)
  const lastTrackAtRef = useRef(0)
  const modelUpdatedAtRef = useRef(0)
  const dartsRef = useRef<DetectedDart[]>([])
  const knownDartsRef = useRef<KnownDart[]>([])
  const lastRecordAtRef = useRef(0)
  const pendingAngleRef = useRef(-90)
  const boardScaleRef = useRef(1)
  const lastScoreRef = useRef<{ score: BoardScore; at: Point } | null>(null)
  const viewportRef = useRef<Viewport>({ zoom: 1, center: { x: 0, y: 0 } })
  const pointersRef = useRef(new Map<number, Point>())
  const gestureRef = useRef<Gesture | null>(null)
  /** Finger position while aiming, in screen pixels; drawn as a magnifier. */
  const loupeRef = useRef<Point | null>(null)

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
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [cameraId, setCameraId] = useState("")
  const cameraIdRef = useRef("")
  const [lastScore, setLastScore] = useState<{ score: BoardScore; at: Point } | null>(null)
  const [hud, setHud] = useState<Hud>({ fps: 0, ms: 0, mmPerPx: 0 })
  const sessionRef = useRef<SessionDart[]>(loadSession())
  const [session, setSession] = useState<SessionDart[]>(sessionRef.current)
  const [pendingConfidence, setPendingConfidence] = useState<number | null>(null)
  const [boardScale, setBoardScale] = useState(1)
  const [boardSizePercent, setBoardSizePercent] = useState<number | null>(null)
  const [rotationDeg, setRotationDeg] = useState(-90)
  const [voice, setVoice] = useState(true)
  const [viewport, setViewport] = useState<Viewport>(viewportRef.current)
  const [stageAspect, setStageAspect] = useState("16 / 10")

  // The lab runs with the phone on a mount for a whole session: keep the
  // screen awake while the camera is actually streaming.
  const wakeLock = useWakeLock(phase === "live")

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

  const buildHomography = useCallback((pixels: Point[]): boolean => {
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
    // Keep a compact model for the tracker: the four points are all on the
    // 170 mm ring, so their mean is the centre and their mean distance the
    // double-ring radius.
    const centre = {
      x: pixels.reduce((sum, point) => sum + point.x, 0) / pixels.length,
      y: pixels.reduce((sum, point) => sum + point.y, 0) / pixels.length,
    }
    const radius =
      pixels.reduce((sum, point) => sum + distance(point, centre), 0) / pixels.length
    modelRef.current = { centre, radius, ringMm: MANUAL_RING_MM }
    setCalibrationVersion((version) => version + 1)
    setError(null)
    return true
  }, [])

  /** Apply the model for real: the user accepted it, so persist and move on. */
  const applyCalibration = useCallback(
    (pixels: Point[]) => {
      if (!buildHomography(pixels)) return false
      setMode("live")
      setManual(false)
      setReferenceSet(false)
      // Board millimetres change meaning with a new model.
      knownDartsRef.current = []
      dartsRef.current = []
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pixels))
      } catch {
        // Storage can be unavailable in private mode; the lab still works.
      }
      return true
    },
    [buildHomography],
  )

  /** Re-draw the model while the user adjusts size or rotation. */
  const previewCalibration = useCallback(
    (pixels: Point[]) => {
      if (!buildHomography(pixels)) return false
      setMode("rotation")
      setManual(false)
      setReferenceSet(false)
      return true
    },
    [buildHomography],
  )

  const applyPendingModel = useCallback(
    (scale: number, angleDeg: number) => {
      const pending = pendingBoardRef.current
      if (!pending) return
      const radians = (angleDeg * Math.PI) / 180
      const radiusPx = pending.radius * (MANUAL_RING_MM / pending.ringMm) * scale
      const pixels: Point[] = [0, 90, 180, 270].map((offset) => {
        const angle = radians + (offset * Math.PI) / 180
        return {
          x: pending.center.x + radiusPx * Math.cos(angle),
          y: pending.center.y + radiusPx * Math.sin(angle),
        }
      })
      previewCalibration(pixels)
    },
    [previewCalibration],
  )

  /** The user says the model matches the board: persist it and start. */
  const acceptPendingModel = useCallback(() => {
    const pixels = calibrationPxRef.current
    if (pixels.length !== 4) return
    pendingBoardRef.current = null
    setPendingConfidence(null)
    setTapCount(4)
    applyCalibration(pixels)
  }, [applyCalibration])

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    dartsRef.current = []
    referenceRef.current = null
    pointersRef.current.clear()
    gestureRef.current = null
    viewportRef.current = { zoom: 1, center: { x: 0, y: 0 } }
    setViewport(viewportRef.current)
    setReferenceSet(false)
    setPhase("idle")
  }, [])

  /** Cameras the browser exposes. On phones the telephoto lens often shows up
   * as its own device, which is the difference between a board that fills 20%
   * of the frame and one that fills most of it. */
  const listCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameras(
        devices
          .filter((device) => device.kind === "videoinput")
          .map((device, index) => ({
            id: device.deviceId,
            label: device.label || `Camera ${index + 1}`,
          })),
      )
    } catch {
      // Enumeration is optional; the default camera still works.
    }
  }, [])

  const startCamera = useCallback(async () => {
    setError(null)
    setPhase("starting")
    const requested = cameraIdRef.current

    const open = (deviceId: string) =>
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // A chosen device cannot be combined with facingMode, and asking for
          // the highest resolution we can get is what makes a dart more than a
          // handful of pixels.
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })

    let stream: MediaStream | null = null
    let note: string | null = null
    try {
      stream = await open(requested)
    } catch (err) {
      // Some Android builds list logical lenses that cannot be opened on their
      // own. Falling back is better than leaving the lab dead.
      if (requested) {
        cameraIdRef.current = ""
        setCameraId("")
        try {
          localStorage.removeItem(CAMERA_KEY)
        } catch {
          // ignore
        }
        try {
          stream = await open("")
          note = "That camera could not be opened — using the default one."
        } catch {
          stream = null
        }
      }
      if (!stream && !note) {
        setPhase("error")
        setError(
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : "Could not start the camera. The page must be served over HTTPS.",
        )
        return
      }
    }

    if (!stream) return
    streamRef.current = stream
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    await video.play()
    setPhase("live")
    setError(note)
    void listCameras()
  }, [listCameras])

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

  // Remember which lens was chosen. On a phone the telephoto camera is often
  // the difference between a dart being four pixels wide and forty.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CAMERA_KEY)
      if (stored) {
        cameraIdRef.current = stored
        setCameraId(stored)
      }
    } catch {
      // Ignore storage failures (private mode).
    }
  }, [])

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

  /** Empty-board reference. Captured in board space, so nudging the phone does
   * not invalidate it: the warp follows the board model, not the camera. */
  const setBackground = useCallback(() => {
    const video = videoRef.current
    const detect = detectCanvasRef.current
    const h = homographyRef.current
    if (!video || !detect || detect.width === 0) return
    if (!h) {
      setError("Calibrate the board before taking the empty-board reference.")
      return
    }
    const ctx = detect.getContext("2d", { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(video, 0, 0, detect.width, detect.height)
    const image = ctx.getImageData(0, 0, detect.width, detect.height)
    const gray = toGrayscale(image.data, detect.width, detect.height)
    const toFrame = inverseRef.current
    if (!toFrame) return
    const warped = warpToBoardSpace(
      gray,
      detect.width,
      detect.height,
      composeHomography(scaleHomography(detect.width / video.videoWidth), toFrame),
    )
    referenceRef.current = warped
    referenceLumaRef.current = meanLuma(warped)
    // Wires and numbers move by a pixel or two whenever the model is re-fitted.
    // Ignoring those pixels stops a whole class of phantom darts.
    referenceEdgesRef.current = staticEdgeMask(warped)
    // A new reference means an empty board: forget which darts were logged so
    // the next throw is never mistaken for one of them.
    knownDartsRef.current = []
    dartsRef.current = []
    lastRecordAtRef.current = 0
    setLastScore(null)
    setReferenceSet(true)
    setError(null)
  }, [])

  const resetCalibration = useCallback(() => {
    homographyRef.current = null
    inverseRef.current = null
    calibrationPxRef.current = []
    pendingBoardRef.current = null
    dartsRef.current = []
    knownDartsRef.current = []
    setCalibrationVersion(0)
    setTapCount(0)
    setManual(false)
    setMode("calibrating")
    setPendingConfidence(null)
    setBoardSizePercent(null)
    setRotationDeg(-90)
    setBoardScale(1)
    boardScaleRef.current = 1
    setReferenceSet(false)
    setLastScore(null)
    referenceRef.current = null
    referenceEdgesRef.current = null
    modelRef.current = null
    lastTrackAtRef.current = 0
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [])

  /** Switch camera: the model was fitted in the old stream's pixels, so the
   * board has to be found again. */
  const chooseCamera = useCallback(
    (id: string) => {
      cameraIdRef.current = id
      setCameraId(id)
      try {
        localStorage.setItem(CAMERA_KEY, id)
      } catch {
        // ignore
      }
      stopCamera()
      resetCalibration()
      void startCamera()
    },
    [resetCalibration, startCamera, stopCamera],
  )

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

    // Stage 1 — rough seed. The Hough accumulator grows with width × height ×
    // radius bins, so at 1080p it would need hundreds of MB. On a 640-px frame
    // it is a few MB and precise enough to say "the board is around here".
    const ratio = Math.min(1, SEED_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight))
    const seedWidth = Math.round(video.videoWidth * ratio)
    const seedHeight = Math.round(video.videoHeight * ratio)
    const seedCanvas = document.createElement("canvas")
    seedCanvas.width = seedWidth
    seedCanvas.height = seedHeight
    const seedCtx = seedCanvas.getContext("2d", { willReadFrequently: true })
    if (!seedCtx) return
    seedCtx.drawImage(video, 0, 0, seedWidth, seedHeight)
    const seedImage = seedCtx.getImageData(0, 0, seedWidth, seedHeight)
    const seedGray = toGrayscale(seedImage.data, seedWidth, seedHeight)
    // A dartboard that fills ~47% of the frame width sits at ~0.1–0.3 of the
    // short side; the wide bounds let the seed land on the rim or the surround.
    const seedBoard = detectBoard(seedGray, seedWidth, seedHeight, {
      minRadiusFraction: 0.05,
      maxRadiusFraction: 0.6,
    })
    if (!seedBoard) {
      setError(
        "No board found in this frame — fill the frame with the board, improve the light, or calibrate by hand.",
      )
      return
    }

    // Stage 2 — decide *which* circle that was. The Hough has no idea whether
    // it locked onto the 170 mm double wire, the 225.5 mm rim or the black
    // surround, and that choice is worth 7–30% of scale. The four-wire
    // fingerprint is unambiguous, so fit centre and radius on the full
    // detection frame, where 1 mm is about one pixel.
    const toDetect = detect.width / seedWidth
    const refined = refineBoard(gray, detect.width, detect.height, {
      center: { x: seedBoard.center.x * toDetect, y: seedBoard.center.y * toDetect },
      radius: seedBoard.radius * toDetect,
    })
    const found = refined
      ? { ...refined, ringMm: BOARD.doubleOuter }
      : {
          center: {
            x: seedBoard.center.x * toDetect,
            y: seedBoard.center.y * toDetect,
          },
          radius: seedBoard.radius * toDetect,
          confidence: seedBoard.confidence,
          ringMm: AUTO_RING_MM,
        }

    // Convert detection-canvas pixels to the video's intrinsic pixels.
    const scale = video.videoWidth / detect.width
    pendingBoardRef.current = {
      center: { x: found.center.x * scale, y: found.center.y * scale },
      radius: found.radius * scale,
      confidence: found.confidence,
      ringMm: found.ringMm,
    }
    setPendingConfidence(found.confidence)
    setManual(false)

    // Frame the board for the user: the tap on the double 20 is much easier
    // when the numbers are readable. Still adjustable with the slider.
    const pending = pendingBoardRef.current
    applyViewport(
      autoFrame(pending.center, pending.radius, video.videoWidth, video.videoHeight),
      video.videoWidth,
      video.videoHeight,
    )

    // The board's apparent size is compared with the shorter side of the
    // frame. Below ~35% the ring edges are too coarse for the model to be
    // trustworthy, and that is exactly when the detector used to lock onto
    // the surround or the wall.
    const shorter = Math.min(video.videoWidth, video.videoHeight)
    const percent = Math.round(((pending.radius * 2) / shorter) * 100)
    setBoardSizePercent(percent)

    // Draw the full model immediately, with the 20 at the top. The user only
    // corrects it if it is visibly off — detect, then confirm.
    boardScaleRef.current = 1
    setBoardScale(1)
    pendingAngleRef.current = -90
    applyPendingModel(1, -90)
    setMode("rotation")

    // The size is surfaced as its own warning rather than an error, because
    // the size slider below can still rescue the calibration.
  }, [applyPendingModel, applyViewport])

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
        // The tap marks the middle of the double 20; that fixes the rotation.
        // The model stays a preview so the size slider keeps working.
        const angle = (Math.atan2(point.y - pending.center.y, point.x - pending.center.x) * 180) / Math.PI
        pendingAngleRef.current = angle
        setRotationDeg(Math.round(angle))
        applyPendingModel(boardScaleRef.current, angle)
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
    [applyPendingModel, applyCalibration, pushRecord, speakLabel],
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
        if (modeRef.current !== "live") loupeRef.current = point
        return
      }

      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        loupeRef.current = null
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

      // While calibrating, dragging aims instead of moving the picture: the
      // finger stays over the target and the magnifier shows where it will land.
      if (modeRef.current !== "live" && pointersRef.current.size === 1) {
        loupeRef.current = point
        return
      }

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

      // Calibration taps are accepted even after the finger slides, because
      // sliding is how the user aims with the magnifier.
      if (modeRef.current !== "live") {
        loupeRef.current = null
        const video = videoRef.current
        if (gesture?.kind === "pan" && video && video.videoWidth > 0) {
          const crop = cropFor(viewportRef.current, video.videoWidth, video.videoHeight)
          handleTap(screenToVideo(point, crop, canvas.width, canvas.height))
        }
        return
      }

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
    loupeRef.current = null
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

    /**
     * Re-fit the board model while the camera is live.
     *
     * A phone on a mount gets nudged, and one nudge used to invalidate the
     * whole calibration. The four-wire fingerprint is cheap enough to run
     * every second, so the model follows the board instead of the user having
     * to redo it. The correction is a similarity in video pixels composed onto
     * the existing homography, so the rotation the user calibrated survives.
     */
    const trackBoard = (gray: Uint8ClampedArray) => {
      const model = modelRef.current
      const current = homographyRef.current
      if (!model || !current || video.videoWidth === 0) return
      const k = detect.width / video.videoWidth
      const found = refineBoard(
        gray,
        detect.width,
        detect.height,
        { center: { x: model.centre.x * k, y: model.centre.y * k }, radius: model.radius * k },
        { spanFraction: 0.15, centres: 16, radii: 20, radiusScale: [0.85, 1.15] },
      )
      if (!found || !(found.radius > 4)) return

      const centre = { x: found.center.x / k, y: found.center.y / k }
      const radius = found.radius / k
      const ratio = radius / model.radius
      const shift = distance(centre, model.centre)
      // A hand over the board or a half-visible board must not teleport it.
      if (!(ratio > 0.86 && ratio < 1.16)) return
      if (shift > model.radius * 0.45) return
      // Sub-pixel noise is not worth a redraw, and every redraw briefly
      // suspends recording (the warp is resampled), so keep this generous.
      if (Math.abs(ratio - 1) < 0.006 && shift < 3) return

      const correction: Homography = [
        ratio,
        0,
        centre.x - ratio * model.centre.x,
        0,
        ratio,
        centre.y - ratio * model.centre.y,
        0,
        0,
        1,
      ]
      // The correction maps old video pixels onto new ones, so it is the
      // millimetres -> pixels direction (the inverse model) that it extends:
      // inverse = correction ∘ oldInverse. Composing it onto the pixels ->
      // millimetres model instead would apply a pixel translation to
      // millimetres, which is what spawned phantom darts at every nudge.
      const toFrame = inverseRef.current
      if (!toFrame) return
      const updatedInverse = composeHomography(correction, toFrame)
      const updated = invertHomography(updatedInverse)
      if (!updated) return

      homographyRef.current = updated
      inverseRef.current = updatedInverse
      calibrationPxRef.current = calibrationPxRef.current.map((point) => ({
        x: centre.x + ratio * (point.x - model.centre.x),
        y: centre.y + ratio * (point.y - model.centre.y),
      }))
      modelRef.current = { centre, radius, ringMm: model.ringMm }
      // The board moved: the pixels that moved with it are not darts, and a
      // streak collected before the correction must not count towards one.
      modelUpdatedAtRef.current = performance.now()
      dartsRef.current = []
      setCalibrationVersion((version) => version + 1)
    }

    const detectDarts = (now: number) => {
      if (now - lastProcessRef.current < 80) return
      lastProcessRef.current = now
      const started = performance.now()

      detectCtx.drawImage(video, 0, 0, detect.width, detect.height)
      const image = detectCtx.getImageData(0, 0, detect.width, detect.height)
      const gray = toGrayscale(image.data, detect.width, detect.height)

      const h = homographyRef.current
      if (!h) {
        lastDurationRef.current = performance.now() - started
        return
      }

      // Follow the board before comparing, so a nudged phone does not look
      // like a changed board.
      if (modeRef.current === "live" && now - lastTrackAtRef.current > TRACK_INTERVAL_MS) {
        lastTrackAtRef.current = now
        trackBoard(gray)
      }

      const reference = referenceRef.current
      if (!reference || !autoRef.current) {
        lastDurationRef.current = performance.now() - started
        return
      }

      // Warp into board space: comparing there removes the camera entirely,
      // so the empty-board reference stays valid while the phone moves. The
      // warp needs millimetres -> pixels, which is the inverse model.
      const toFrame = inverseRef.current
      if (!toFrame) {
        lastDurationRef.current = performance.now() - started
        return
      }
      const warped = warpToBoardSpace(
        gray,
        detect.width,
        detect.height,
        composeHomography(scaleHomography(detect.width / video.videoWidth), toFrame),
      )

      // Phones re-expose continuously; a global gain is enough to make the
      // difference meaningful again.
      const liveLuma = meanLuma(warped)
      const gain =
        referenceLumaRef.current > 1 && liveLuma > 1
          ? Math.min(1.6, Math.max(0.63, referenceLumaRef.current / liveLuma))
          : 1
      const mask = differenceMask(warped, reference, sensitivityRef.current, {
        gain,
        ignore: referenceEdgesRef.current,
      })

      // A hand or an arm over the board invalidates this frame, but the darts
      // already logged stay logged: clearing them used to re-record every dart
      // still in the board as soon as the arm moved out.
      const changed = changedRatio(mask)
      // A hand crossing the frame.
      if (changed > 0.12) {
        lastDurationRef.current = performance.now() - started
        return
      }
      // Too much changed to be a dart: the board moved (or something large is
      // in front of it). Re-fit the model on the next frame instead of logging
      // the whole displaced board as a dart — this was the "nudge ghost".
      if (changed > MAX_DART_RATIO) {
        dartsRef.current = []
        lastTrackAtRef.current = 0
        lastDurationRef.current = performance.now() - started
        return
      }

      const blobs = connectedComponents(mask, BOARD_SPACE_SIZE, BOARD_SPACE_SIZE, {
        minArea: 45,
        maxArea: 6000,
        // Wires cut a dart into short pieces, so the per-piece length has to
        // stay low: the merged segment is what gets measured.
        minLength: 18,
      })

      // Wires are ignored, so a dart that crosses one arrives as two or three
      // fragments. Join the fragments before measuring, otherwise no piece is
      // long enough to count as a dart.
      const segments = mergeSegments(
        blobs.map((blob) => ({
          a: pixelToMm(blob.endpoints[0]),
          b: pixelToMm(blob.endpoints[1]),
        })),
        { gap: 30, angleDeg: 22 },
      )

      const matched = new Set<DetectedDart>()
      const next: DetectedDart[] = []
      for (const segment of segments) {
        const aMm = segment.a
        const bMm = segment.b
        const lengthMm = distance(aMm, bMm)

        // A steel dart is 120–180 mm; shadows, reflections and the edges of
        // the surround are either much shorter or much longer.
        if (!Number.isFinite(lengthMm) || lengthMm < MIN_DART_MM || lengthMm > MAX_DART_MM) continue

        const scores = [scoreAtPoint(aMm), scoreAtPoint(bMm)]
        // Both tips off the board means an arm, a chair or the wall.
        if (scores.every((score) => score.ring === "miss")) continue

        const previous = dartsRef.current.find(
          (dart) =>
            Math.hypot(dart.aMm.x - aMm.x, dart.aMm.y - aMm.y) < SAME_DART_MM ||
            Math.hypot(dart.aMm.x - bMm.x, dart.aMm.y - bMm.y) < SAME_DART_MM,
        )
        if (previous) matched.add(previous)

        next.push({
          aMm,
          bMm,
          scoreA: scores[0],
          scoreB: scores[1],
          lengthMm,
          hits: (previous?.hits ?? 0) + 1,
          recorded: previous?.recorded ?? false,
          lastSeen: now,
        })
      }

      // Keep recently seen darts so a one-frame miss does not restart the
      // stability count.
      for (const dart of dartsRef.current) {
        if (matched.has(dart)) continue
        if (now - dart.lastSeen > TRACK_MEMORY_MS) continue
        next.push(dart)
      }

      // A dart is static and sensor noise is not, so a detection only becomes
      // a dart after being seen in HITS_TO_RECORD consecutive frames. This is
      // what stopped a single noisy frame from filling the session.
      let recorded = false
      for (const dart of next) {
        if (recorded || dart.recorded || dart.hits < HITS_TO_RECORD) continue
        if (now - lastRecordAtRef.current < RECORD_COOLDOWN_MS) continue
        // Just after the model moved, the resampled warp can look like a dart.
        if (now - modelUpdatedAtRef.current < TRACK_SETTLE_MS) continue
        if (knownDartsRef.current.some((known) => isSameDart(dart.aMm, dart.bMm, known))) {
          dart.recorded = true
          continue
        }

        dart.recorded = true
        knownDartsRef.current.push({ aMm: dart.aMm, bMm: dart.bMm })
        lastRecordAtRef.current = now
        recorded = true
        speakLabel(dart.scoreA.label)
        pushRecord({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          method: "auto",
          candidateA: dart.scoreA.label,
          candidateB: dart.scoreB.label,
          chosen: null,
          discarded: false,
          aMm: dart.aMm,
          bMm: dart.bMm,
          lengthMm: Math.round(dart.lengthMm),
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
      const model = homographyRef.current
      if (darts.length > 0 && model) {
        ctx.lineWidth = Math.max(2, canvas.width / 400)
        for (const dart of darts) {
          // Darts live in board millimetres; project them back through the
          // current model so they stay on the board even if the phone moved.
          const a = toScreen(applyHomography(model, dart.aMm))
          const b = toScreen(applyHomography(model, dart.bMm))
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

      // Magnifier: tapping a 8 mm double at arm's length on a mounted phone is
      // hopeless without it. Shown while calibrating, drawn from the frame
      // under the finger, on the opposite side so the hand never hides it.
      const loupe = loupeRef.current
      if (loupe && modeRef.current !== "live") {
        const source = screenToVideo(loupe, crop, canvas.width, canvas.height)
        const radius = Math.min(canvas.width, canvas.height) * 0.17
        const margin = radius * 1.12
        const centre = { x: loupe.x < canvas.width / 2 ? canvas.width - margin : margin, y: margin }
        const magnification = 8
        const half = radius / magnification

        ctx.save()
        ctx.beginPath()
        ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2)
        ctx.clip()
        ctx.fillStyle = "#020617"
        ctx.fillRect(centre.x - radius, centre.y - radius, radius * 2, radius * 2)
        ctx.drawImage(
          video,
          source.x - half,
          source.y - half,
          half * 2,
          half * 2,
          centre.x - radius,
          centre.y - radius,
          radius * 2,
          radius * 2,
        )
        ctx.strokeStyle = "rgba(56, 189, 248, 0.95)"
        ctx.lineWidth = Math.max(1.5, radius / 45)
        ctx.beginPath()
        ctx.moveTo(centre.x - radius * 0.28, centre.y)
        ctx.lineTo(centre.x + radius * 0.28, centre.y)
        ctx.moveTo(centre.x, centre.y - radius * 0.28)
        ctx.lineTo(centre.x, centre.y + radius * 0.28)
        ctx.stroke()
        ctx.restore()

        ctx.strokeStyle = "rgba(56, 189, 248, 0.85)"
        ctx.lineWidth = Math.max(2, canvas.width / 500)
        ctx.beginPath()
        ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(loupe.x, loupe.y, Math.max(6, canvas.width / 120), 0, Math.PI * 2)
        ctx.stroke()
      }

      if (modeRef.current === "live" && referenceRef.current) detectDarts(now)

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
        boardSizePercent,
        rotationDeg,
        boardScale,
        accepted: calibrated,
      },
      detection: {
        sensitivity,
        detectWidth: detectCanvasRef.current?.width ?? 0,
        cooldownMs: RECORD_COOLDOWN_MS,
        sameDartMm: SAME_DART_MM,
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
              {pendingConfidence ? ` (${Math.round(pendingConfidence * 100)}% confident)` : ""} and the blue ring
              lines are drawn on it. Check that they sit on the wires: nudge{" "}
              <strong className="text-foreground">Board size</strong> first, then tap the{" "}
              <strong className="text-foreground">middle of the double 20 on this screen</strong> (a magnifier
              follows your finger) to fix the rotation. You touch the image, never the physical board. Happy with
              it? Tap “Looks right”.
            </>
          )}
          {stepIndex === 3 &&
            "Take every dart off the board, then tap “Board is empty”. The detector compares each frame against this reference."}
          {stepIndex === 4 &&
            "Throw real darts at the board — the camera detects them, you do not tap anything. Each dart is spoken out loud and logged; just tap A or B (which tip is the point) or Discard on this screen. After pulling the darts out, tap “Board is empty” again."}
        </p>
        {manual && <p className="mt-1 text-sm text-muted-foreground">Next: double {calibratingTarget}</p>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {boardSizePercent !== null && boardSizePercent < 35 && (
        <p className="text-sm text-amber-500">
          The board fills only {boardSizePercent}% of the frame. Below about 35% a dart is a couple of pixels
          wide, so automatic scoring will miss it and the ring lines are approximate. Move the phone closer
          (about 1 m), or pick the telephoto lens under Detection settings — digital zoom cannot add detail.
        </p>
      )}

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
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0">Board size</span>
              <input
                type="range"
                min={0.6}
                max={1.8}
                step={0.01}
                value={boardScale}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  boardScaleRef.current = value
                  setBoardScale(value)
                  applyPendingModel(value, pendingAngleRef.current)
                }}
                className="min-w-0 flex-1 accent-sky-500"
                aria-label="Board size"
              />
              <span className="w-10 shrink-0 text-right tabular-nums">{boardScale.toFixed(2)}×</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0">Rotation</span>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={rotationDeg}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  pendingAngleRef.current = value
                  setRotationDeg(value)
                  applyPendingModel(boardScaleRef.current, value)
                }}
                className="min-w-0 flex-1 accent-sky-500"
                aria-label="Rotation"
              />
              <span className="w-10 shrink-0 text-right tabular-nums">{rotationDeg}°</span>
            </label>
            <Button className="min-h-12" onClick={acceptPendingModel}>
              <Check /> Looks right — continue
            </Button>
          </div>
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
              aria-describedby="sensitivity-help"
            />
            <span className="w-8 tabular-nums">{sensitivity}</span>
          </label>
          <p id="sensitivity-help" className="-mt-1 text-xs text-muted-foreground">
            How different a pixel must be from the empty-board reference before it counts as a dart. 35 suits
            most rooms. Raise it if phantom darts appear with nothing thrown; lower it if a real dart in a dark
            segment is missed. After changing the light, take “Board is empty” again.
          </p>
          {cameras.length > 1 && (
            <label className="flex flex-col gap-1">
              <span className="whitespace-nowrap">Camera</span>
              <select
                value={cameraId}
                onChange={(event) => chooseCamera(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Default (rear)</option>
                {cameras.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                If the phone lists a telephoto lens (3×/5×), pick it: it puts several times more pixels on the
                board than digital zoom can. Switching camera resets the calibration.
              </span>
            </label>
          )}
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{hud.fps} fps</span>
        <span>{hud.ms.toFixed(0)} ms/frame</span>
        <span>{hud.mmPerPx ? `${hud.mmPerPx.toFixed(2)} mm/px` : "not calibrated"}</span>
        {boardSizePercent !== null && <span>board {boardSizePercent}% of frame</span>}
        {phase === "live" && wakeLock === "on" && (
          <span className="text-emerald-500">screen stays on</span>
        )}
        {phase === "live" && (wakeLock === "denied" || wakeLock === "unsupported") && (
          <span className="text-amber-500">screen may sleep — check display settings</span>
        )}
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
