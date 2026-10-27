import type { Point } from "./boardGeometry"

/** Display-only viewport over the camera frame.
 *
 * Detection always runs on the whole frame, so zooming never invalidates the
 * calibration or the empty-board reference — it only changes what you see and
 * where a tap lands.
 */
export interface Viewport {
  /** 1 = the whole frame, 4 = a quarter of its width. */
  zoom: number
  /** Centre of the visible region, in source pixels. */
  center: Point
}

export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM)
}

/** Keep the visible window inside the frame, so zooming never shows black. */
export function clampViewport(viewport: Viewport, width: number, height: number): Viewport {
  const zoom = clampZoom(viewport.zoom)
  if (width <= 0 || height <= 0) return { zoom, center: { ...viewport.center } }

  const windowWidth = width / zoom
  const windowHeight = height / zoom
  return {
    zoom,
    center: {
      x: clamp(viewport.center.x, windowWidth / 2, width - windowWidth / 2),
      y: clamp(viewport.center.y, windowHeight / 2, height - windowHeight / 2),
    },
  }
}

/**
 * Viewport that makes a circle of `radius` fill `coverage` of the shorter side
 * of the frame. Used to frame the board right after it is detected, so the
 * numbers are readable without touching the zoom slider.
 */
export function autoFrame(
  center: Point,
  radius: number,
  width: number,
  height: number,
  coverage = 0.82,
): Viewport {
  if (width <= 0 || height <= 0 || radius <= 0) {
    return { zoom: MIN_ZOOM, center: { x: width / 2, y: height / 2 } }
  }
  const safeCoverage = clamp(coverage, 0.4, 0.95)
  const zoom = clampZoom(Math.min(width, height) / ((radius * 2) / safeCoverage))
  return clampViewport({ zoom, center: { ...center } }, width, height)
}

/** The source rectangle currently visible. */
export function cropFor(viewport: Viewport, width: number, height: number): Crop {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  const clamped = clampViewport(viewport, width, height)
  const cropWidth = width / clamped.zoom
  const cropHeight = height / clamped.zoom
  return {
    x: clamped.center.x - cropWidth / 2,
    y: clamped.center.y - cropHeight / 2,
    width: cropWidth,
    height: cropHeight,
  }
}

export function videoToScreen(point: Point, crop: Crop, width: number, height: number): Point {
  if (crop.width <= 0 || crop.height <= 0) return { x: 0, y: 0 }
  return {
    x: ((point.x - crop.x) * width) / crop.width,
    y: ((point.y - crop.y) * height) / crop.height,
  }
}

export function screenToVideo(point: Point, crop: Crop, width: number, height: number): Point {
  if (width <= 0 || height <= 0) return { x: 0, y: 0 }
  return {
    x: crop.x + (point.x * crop.width) / width,
    y: crop.y + (point.y * crop.height) / height,
  }
}

/** Viewport that keeps `anchor` (source pixels) under `fraction` (0..1 of the
 * canvas), used by pinch-to-zoom so the board grows around your fingers. */
export function viewportAnchoredOn(
  zoom: number,
  anchor: Point,
  fraction: Point,
  width: number,
  height: number,
): Viewport {
  const clampedZoom = clampZoom(zoom)
  if (width <= 0 || height <= 0) return { zoom: clampedZoom, center: { ...anchor } }

  const windowWidth = width / clampedZoom
  const windowHeight = height / clampedZoom
  return clampViewport(
    {
      zoom: clampedZoom,
      center: {
        x: anchor.x - fraction.x * windowWidth + windowWidth / 2,
        y: anchor.y - fraction.y * windowHeight + windowHeight / 2,
      },
    },
    width,
    height,
  )
}

/** Map a client (CSS pixel) position onto canvas pixels, taking the
 * letterboxing added by `object-contain` into account. Without this a tap on a
 * 16:9 canvas shown in a 16:10 box is off by several percent. */
export function clientToCanvas(
  clientX: number,
  clientY: number,
  rect: Rect,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  if (rect.width <= 0 || rect.height <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { x: 0, y: 0 }
  }

  const x = clientX - rect.left
  const y = clientY - rect.top
  const contentAspect = canvasWidth / canvasHeight
  const boxAspect = rect.width / rect.height

  if (boxAspect > contentAspect) {
    const drawnWidth = rect.height * contentAspect
    const offsetX = (rect.width - drawnWidth) / 2
    return {
      x: ((x - offsetX) * canvasWidth) / drawnWidth,
      y: (y * canvasHeight) / rect.height,
    }
  }

  const drawnHeight = rect.width / contentAspect
  const offsetY = (rect.height - drawnHeight) / 2
  return {
    x: (x * canvasWidth) / rect.width,
    y: ((y - offsetY) * canvasHeight) / drawnHeight,
  }
}

