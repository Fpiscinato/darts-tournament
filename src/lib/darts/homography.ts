import type { Point } from "./boardGeometry"

/** A 3x3 projective transform stored row-major, with h[8] === 1. */
export type Homography = [number, number, number, number, number, number, number, number, number]

/**
 * Solve the homography that maps four source points onto four destination
 * points (direct linear transform, 8x8 system solved by Gauss-Jordan with
 * partial pivoting).
 *
 * Returns null when the four points are collinear/degenerate, which is the
 * only failure mode that matters for a tap-based calibration.
 */
export function solveHomography(src: readonly Point[], dst: readonly Point[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null

  // Each correspondence gives two rows of the 8x9 augmented matrix.
  const rows: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }

  for (let column = 0; column < 8; column++) {
    let pivot = column
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null

    const swap = rows[column]
    rows[column] = rows[pivot]
    rows[pivot] = swap

    const divisor = rows[column][column]
    for (let k = column; k < 9; k++) rows[column][k] /= divisor

    for (let row = 0; row < 8; row++) {
      if (row === column) continue
      const factor = rows[row][column]
      if (factor === 0) continue
      for (let k = column; k < 9; k++) rows[row][k] -= factor * rows[column][k]
    }
  }

  const h = rows.map((row) => row[8])
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export function applyHomography(h: readonly number[], point: Point): Point {
  const w = h[6] * point.x + h[7] * point.y + h[8]
  if (Math.abs(w) < 1e-12) return { x: Number.NaN, y: Number.NaN }
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / w,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / w,
  }
}

/** Uniform scale of frame pixels, e.g. video pixels to detection-canvas pixels. */
export function scaleHomography(factor: number): Homography {
  return [factor, 0, 0, 0, factor, 0, 0, 0, 1]
}

/**
 * `outer ∘ inner`: the transform that applies `inner` first and `outer` after.
 *
 * Used to chain a small correction (the board moved or changed size between
 * two detections) onto an existing board model without throwing away the
 * rotation that the user calibrated by hand.
 */
export function composeHomography(outer: Homography, inner: Homography): Homography {
  const out = new Array<number>(9).fill(0)
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      out[row * 3 + column] =
        outer[row * 3] * inner[column] +
        outer[row * 3 + 1] * inner[3 + column] +
        outer[row * 3 + 2] * inner[6 + column]
    }
  }
  const last = out[8]
  if (Math.abs(last) < 1e-12) return [...inner] as Homography
  return out.map((value) => value / last) as Homography
}

/** Inverse transform for drawing board space back onto the video frame. */export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h

  const A = e * j - f * i
  const B = -(d * j - f * g)
  const C = d * i - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null

  const inv: Homography = [
    A / det,
    (c * i - b * j) / det,
    (b * f - c * e) / det,
    B / det,
    (a * j - c * g) / det,
    (c * d - a * f) / det,
    C / det,
    (b * g - a * i) / det,
    (a * e - b * d) / det,
  ]

  // Normalise so the last element is 1, which keeps the math consistent
  // with solveHomography's output.
  const last = inv[8]
  if (Math.abs(last) < 1e-12) return null
  return inv.map((value) => value / last) as Homography
}
