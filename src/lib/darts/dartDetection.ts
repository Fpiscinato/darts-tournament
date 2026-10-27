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

/** 1 where the absolute difference exceeds `threshold`, 0 elsewhere. */
export function differenceMask(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  threshold: number,
): Uint8Array {
  const mask = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) {
    mask[i] = Math.abs(a[i] - b[i]) >= threshold ? 1 : 0
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
