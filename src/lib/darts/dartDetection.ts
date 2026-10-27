import type { Point } from "./boardGeometry"

/** Conservative, allocation-light frame differencing used by the Camera Lab.
 *
 * Everything here is pure and synchronous so it can be unit-tested with
 * synthetic masks; the page only supplies pixels and draws the result.
 */

export function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    // Integer approximation of Rec. 601 luma; fast enough for 10–15 fps.
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8
  }
  return gray
}

/** Mean luminance, used to compensate camera auto-exposure between frames. */
export function meanLuma(gray: Uint8ClampedArray): number {
  const stride = Math.max(1, Math.floor(gray.length / 20_000))
  let sum = 0
  let count = 0
  for (let i = 0; i < gray.length; i += stride) {
    sum += gray[i]
    count += 1
  }
  return count === 0 ? 0 : sum / count
}

export interface DifferenceOptions {
  /** Multiplies `a` before comparing, undoing a global exposure change. */
  gain?: number
  /** Added to `b` before comparing, undoing a global brightness offset. */
  bias?: number
  /** Pixel indices to ignore (static edges, the frame border, ...). */
  ignore?: Uint8Array | null
}

/** 1 where the absolute difference exceeds `threshold`, 0 elsewhere.
 *
 * A phone camera re-exposes continuously. `gain` (multiplicative) and `bias`
 * (additive) are applied to the live frame before the comparison, so a
 * brightness shift does not flip large areas of the frame and look like a
 * hundred new darts.
 */
export function differenceMask(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  threshold: number,
  options: DifferenceOptions = {},
): Uint8Array {
  const gain = options.gain ?? 1
  const bias = options.bias ?? 0
  const ignore = options.ignore
  const mask = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) {
    if (ignore && ignore[i]) continue
    mask[i] = Math.abs(a[i] * gain - (b[i] + bias)) >= threshold ? 1 : 0
  }
  return mask
}

export function changedRatio(mask: Uint8Array): number {
  let changed = 0
  for (let i = 0; i < mask.length; i++) changed += mask[i]
  return changed / mask.length
}

export interface Blob {
  area: number
  cx: number
  cy: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Major-axis direction in radians. */
  orientation: number
  /** Extreme points of the blob along its major axis. */
  endpoints: [Point, Point]
  /** Approximate major-axis extent in pixels. */
  length: number
}

export interface BlobOptions {
  /** Blobs with fewer pixels are noise. */
  minArea?: number
  /** Blobs with more pixels are a hand/body and are discarded. */
  maxArea?: number
  /** Ignore blobs whose major axis is shorter than this (pixels). */
  minLength?: number
}

/**
 * 8-connected component labelling over a binary mask.
 *
 * Oversized components (an arm crossing the frame) are flood-filled to mark
 * their pixels as visited but are not returned, so the next frames stay
 * cheap instead of re-scanning a huge blob.
 */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  options: BlobOptions = {},
): Blob[] {
  const minArea = options.minArea ?? 24
  const maxArea = options.maxArea ?? 12_000
  const minLength = options.minLength ?? 0

  const visited = new Uint8Array(mask.length)
  const blobs: Blob[] = []
  const stack: number[] = []
  const pixels: number[] = []

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start] === 1) continue

    stack.length = 0
    pixels.length = 0
    stack.push(start)
    visited[start] = 1

    let oversize = false
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    while (stack.length > 0) {
      const index = stack.pop() as number
      const x = index % width
      const y = (index - x) / width

      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      if (oversize) {
        // Still flood the component so its pixels are not rescanned.
      } else if (pixels.length >= maxArea) {
        oversize = true
        pixels.length = 0
      } else {
        pixels.push(index)
      }

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const neighbour = ny * width + nx
          if (mask[neighbour] === 1 && visited[neighbour] === 0) {
            visited[neighbour] = 1
            stack.push(neighbour)
          }
        }
      }
    }

    if (oversize || pixels.length < minArea) continue

    const blob = describeBlob(pixels, width)
    if (blob.length < minLength) continue
    blobs.push(blob)
  }

  return blobs
}

function describeBlob(pixels: number[], width: number): Blob {
  let sumX = 0
  let sumY = 0
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const index of pixels) {
    const x = index % width
    const y = (index - x) / width
    sumX += x
    sumY += y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const area = pixels.length
  const cx = sumX / area
  const cy = sumY / area

  // Second moments give the major axis of the shape, which for a dart is
  // the barrel/flight direction.
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const index of pixels) {
    const x = index % width
    const y = (index - x) / width
    const dx = x - cx
    const dy = y - cy
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  sxx /= area
  syy /= area
  sxy /= area

  const orientation = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ax = Math.cos(orientation)
  const ay = Math.sin(orientation)

  let minProjection = Number.POSITIVE_INFINITY
  let maxProjection = Number.NEGATIVE_INFINITY
  let minPoint: Point = { x: cx, y: cy }
  let maxPoint: Point = { x: cx, y: cy }

  for (const index of pixels) {
    const x = index % width
    const y = (index - x) / width
    const projection = (x - cx) * ax + (y - cy) * ay
    if (projection < minProjection) {
      minProjection = projection
      minPoint = { x, y }
    }
    if (projection > maxProjection) {
      maxProjection = projection
      maxPoint = { x, y }
    }
  }

  return {
    area,
    cx,
    cy,
    minX,
    minY,
    maxX,
    maxY,
    orientation,
    endpoints: [minPoint, maxPoint],
    length: maxProjection - minProjection,
  }
}

export interface Segment {
  a: Point
  b: Point
}

export interface MergeOptions {
  /** Largest gap between two fragments of the same dart, in mm. */
  gap?: number
  /** How far the connecting line may bend, in degrees. */
  angleDeg?: number
}

/**
 * Join fragments of one dart that a wire or a dark patch cut in two.
 *
 * The detection mask deliberately ignores the wires and the ring boundaries,
 * which is what killed the false positives, but it also slices any dart that
 * crosses them. One physical dart then arrives as two or three short segments
 * and none of them is long enough to be a dart. Two segments are the same dart
 * when the gap between them is short *and* the gap points along them: parallel
 * darts in neighbouring beds are close together but their gap is across them.
 */
export function mergeSegments(segments: Segment[], options: MergeOptions = {}): Segment[] {
  const gap = options.gap ?? 25
  const maxAngle = ((options.angleDeg ?? 22) * Math.PI) / 180
  const minDot = Math.cos(maxAngle)

  let current = segments
    .filter((segment) => Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) > 1)
    .map((segment) => ({ ...segment }))

  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const joined = joinSegments(current[i], current[j], gap, minDot)
        if (!joined) continue
        current = current.filter((_, index) => index !== i && index !== j)
        current.push(joined)
        merged = true
        break outer
      }
    }
  }

  return current
}

/** Union of two collinear-ish segments, or null when they are not one dart. */
function joinSegments(first: Segment, second: Segment, gap: number, minDot: number): Segment | null {
  const length = (segment: Segment) => Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y)
  const unit = (from: Point, to: Point): Point => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    return distance < 1e-9 ? { x: 0, y: 0 } : { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance }
  }

  const firstUnit = unit(first.a, first.b)
  const secondUnit = unit(second.a, second.b)
  // They must point the same way, so the merged ends are the far ones.
  if (Math.abs(firstUnit.x * secondUnit.x + firstUnit.y * secondUnit.y) < minDot) return null

  // Closest pair of ends, then check that the gap runs along the dart.
  const pairs: [Point, Point][] = [
    [first.b, second.a],
    [first.b, second.b],
    [first.a, second.a],
    [first.a, second.b],
  ]
  let best: { from: Point; to: Point; distance: number } | null = null
  for (const [from, to] of pairs) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    if (!best || distance < best.distance) best = { from, to, distance }
  }
  if (!best) return null
  const allowed = Math.max(gap, 0.35 * Math.max(length(first), length(second)))
  if (best.distance > allowed) return null
  const gapUnit = unit(best.from, best.to)
  const along = Math.abs(gapUnit.x * firstUnit.x + gapUnit.y * firstUnit.y)
  if (along < minDot) return null

  // Keep the two ends that are farthest apart.
  const ends = [first.a, first.b, second.a, second.b]
  let far: [Point, Point] = [ends[0], ends[1]]
  let farDistance = 0
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const distance = Math.hypot(ends[j].x - ends[i].x, ends[j].y - ends[i].y)
      if (distance > farDistance) {
        farDistance = distance
        far = [ends[i], ends[j]]
      }
    }
  }
  return { a: far[0], b: far[1] }
}
