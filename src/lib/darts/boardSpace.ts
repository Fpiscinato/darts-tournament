import type { Point } from "./boardGeometry"
import { composeHomography } from "./homography"
import type { Homography } from "./homography"

/**
 * Canonical "board space": a square image of the board *plane*, in millimetres,
 * centred on the bull.
 *
 * The point of resampling every frame into this space is that it removes the
 * camera from the problem. The empty-board reference is stored here, not in
 * video pixels, so nudging the phone (or zooming, or moving the mount) only
 * changes the homography — the reference is still valid and the detector keeps
 * comparing like with like. Scoring also becomes a plain lookup in millimetres.
 */
export const BOARD_SPACE_SIZE = 512

/**
 * Half-width of the canonical image, in mm.
 *
 * 225.5 mm reaches the rim; a dart bedded in an outer double has its flight
 * another ~150 mm out, so 320 mm keeps most of the shaft in frame while
 * staying close to one canonical pixel per millimetre.
 */
export const BOARD_SPACE_RADIUS_MM = 320

export const BOARD_SPACE_PX_PER_MM = BOARD_SPACE_SIZE / (2 * BOARD_SPACE_RADIUS_MM)

/** Canonical pixel centre to board millimetres. */
export function pixelToMm(pixel: Point): Point {
  return {
    x: (pixel.x + 0.5) / BOARD_SPACE_PX_PER_MM - BOARD_SPACE_RADIUS_MM,
    y: (pixel.y + 0.5) / BOARD_SPACE_PX_PER_MM - BOARD_SPACE_RADIUS_MM,
  }
}

export function mmToPixel(mm: Point): Point {
  return {
    x: (mm.x + BOARD_SPACE_RADIUS_MM) * BOARD_SPACE_PX_PER_MM - 0.5,
    y: (mm.y + BOARD_SPACE_RADIUS_MM) * BOARD_SPACE_PX_PER_MM - 0.5,
  }
}

function sample(frame: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return 0
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const i = y0 * width + x0
  const top = frame[i] * (1 - fx) + frame[i + 1] * fx
  const bottom = frame[i + width] * (1 - fx) + frame[i + width + 1] * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * Resample a grayscale frame into board space.
 *
 * `mmToFrame` maps board millimetres to the frame's own pixel coordinates (for
 * the detection canvas that is the board model scaled by
 * detectWidth / videoWidth). Areas of board space that fall outside the frame
 * come out as 0, which is stable as long as the geometry does not change, and
 * a camera that moves is exactly what the homography update handles.
 */
export function warpToBoardSpace(
  frame: Uint8ClampedArray,
  frameWidth: number,
  frameHeight: number,
  mmToFrame: Homography,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(BOARD_SPACE_SIZE * BOARD_SPACE_SIZE)
  const scale = BOARD_SPACE_PX_PER_MM
  const offset = 0.5 / scale - BOARD_SPACE_RADIUS_MM
  // Canonical pixel -> millimetres, as a homography so it composes with the
  // board model in one matrix.
  const pixelToMmMatrix: Homography = [1 / scale, 0, offset, 0, 1 / scale, offset, 0, 0, 1]
  const h = composeHomography(mmToFrame, pixelToMmMatrix)
  const [a, b, c, d, e, f, g, i, j] = h

  for (let v = 0; v < BOARD_SPACE_SIZE; v++) {
    const row = v * BOARD_SPACE_SIZE
    for (let u = 0; u < BOARD_SPACE_SIZE; u++) {
      const w = g * u + i * v + j
      if (Math.abs(w) < 1e-12) continue
      const x = (a * u + b * v + c) / w
      const y = (d * u + e * v + f) / w
      out[row + u] = sample(frame, frameWidth, frameHeight, x, y)
    }
  }

  return out
}

/** True when a board-space point is on the scoring area (plus a small margin). */
export function isOnBoard(mm: Point, marginMm = 6): boolean {
  return Math.hypot(mm.x, mm.y) <= 225.5 + marginMm
}

/**
 * Pixels where the reference image has a strong edge: the wires, the numbers,
 * the ring boundaries.
 *
 * Those are exactly where a *tiny* model change shows up as a bright line of
 * "difference" that has nothing to do with a dart, and a line along a wire is
 * long enough to pass every length filter. Ignoring a few pixels around every
 * static edge removes that whole class of false positive; the cost is that a
 * dart tip landing exactly on a wire is not seen, which is ambiguous anyway.
 */
export function staticEdgeMask(
  reference: Uint8ClampedArray,
  threshold = 42,
  dilation = 3,
): Uint8Array {
  const size = BOARD_SPACE_SIZE
  const edges = new Uint8Array(size * size)
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x
      const dx =
        reference[i - size + 1] + 2 * reference[i + 1] + reference[i + size + 1] -
        (reference[i - size - 1] + 2 * reference[i - 1] + reference[i + size - 1])
      const dy =
        reference[i + size - 1] + 2 * reference[i + size] + reference[i + size + 1] -
        (reference[i - size - 1] + 2 * reference[i - size] + reference[i - size + 1])
      if (Math.hypot(dx, dy) >= threshold) edges[i] = 1
    }
  }
  if (dilation <= 0) return edges

  // Square dilation, two passes of a growing window keeps the code simple and
  // runs once per reference.
  const out = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!edges[y * size + x]) continue
      const top = Math.max(0, y - dilation)
      const bottom = Math.min(size - 1, y + dilation)
      const left = Math.max(0, x - dilation)
      const right = Math.min(size - 1, x + dilation)
      for (let ny = top; ny <= bottom; ny++) {
        out.fill(1, ny * size + left, ny * size + right + 1)
      }
    }
  }
  return out
}
