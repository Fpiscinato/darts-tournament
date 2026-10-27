import { describe, expect, it } from "vitest"
import {
  MAX_ZOOM,
  MIN_ZOOM,
  autoFrame,
  clampViewport,
  clampZoom,
  clientToCanvas,
  cropFor,
  screenToVideo,
  videoToScreen,
  viewportAnchoredOn,
} from "./viewport"

const WIDTH = 1920
const HEIGHT = 1080

describe("clampZoom", () => {
  it("keeps the zoom inside the allowed range", () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM)
    expect(clampZoom(9)).toBe(MAX_ZOOM)
    expect(clampZoom(2.5)).toBe(2.5)
  })

  it("falls back to 1 for nonsense", () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe("cropFor", () => {
  it("returns the whole frame at zoom 1", () => {
    const crop = cropFor({ zoom: 1, center: { x: WIDTH / 2, y: HEIGHT / 2 } }, WIDTH, HEIGHT)
    expect(crop).toEqual({ x: 0, y: 0, width: WIDTH, height: HEIGHT })
  })

  it("returns half the frame at zoom 2", () => {
    const crop = cropFor({ zoom: 2, center: { x: WIDTH / 2, y: HEIGHT / 2 } }, WIDTH, HEIGHT)
    expect(crop.width).toBe(WIDTH / 2)
    expect(crop.height).toBe(HEIGHT / 2)
    expect(crop.x).toBe(WIDTH / 4)
    expect(crop.y).toBe(HEIGHT / 4)
  })

  it("never leaves the frame when the centre is pushed to a corner", () => {
    const crop = cropFor({ zoom: 2, center: { x: 0, y: 0 } }, WIDTH, HEIGHT)
    expect(crop.x).toBe(0)
    expect(crop.y).toBe(0)
    expect(crop.x + crop.width).toBeLessThanOrEqual(WIDTH)
    expect(crop.y + crop.height).toBeLessThanOrEqual(HEIGHT)
  })

  it("is empty for a frame that has not loaded yet", () => {
    expect(cropFor({ zoom: 1, center: { x: 0, y: 0 } }, 0, 0)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe("clampViewport", () => {
  it("keeps the window inside the frame", () => {
    const clamped = clampViewport({ zoom: 4, center: { x: -500, y: 5000 } }, WIDTH, HEIGHT)
    expect(clamped.center.x).toBe(WIDTH / 8)
    expect(clamped.center.y).toBe(HEIGHT - HEIGHT / 8)
  })

  it("ignores centre movement when fully zoomed out", () => {
    const clamped = clampViewport({ zoom: 1, center: { x: 0, y: 0 } }, WIDTH, HEIGHT)
    expect(clamped.center).toEqual({ x: WIDTH / 2, y: HEIGHT / 2 })
  })
})

describe("videoToScreen / screenToVideo", () => {
  it("round-trips a point", () => {
    const crop = cropFor({ zoom: 2.5, center: { x: 700, y: 400 } }, WIDTH, HEIGHT)
    const source = { x: 720, y: 380 }
    const screen = videoToScreen(source, crop, 800, 450)
    const back = screenToVideo(screen, crop, 800, 450)
    expect(back.x).toBeCloseTo(source.x, 6)
    expect(back.y).toBeCloseTo(source.y, 6)
  })

  it("maps the crop corner to the canvas corner", () => {
    const crop = cropFor({ zoom: 2, center: { x: 500, y: 300 } }, WIDTH, HEIGHT)
    expect(videoToScreen({ x: crop.x, y: crop.y }, crop, 800, 450)).toEqual({ x: 0, y: 0 })
  })
})

describe("viewportAnchoredOn", () => {
  it("keeps the anchored point under the same screen position", () => {
    const anchor = { x: 640, y: 360 }
    const fraction = { x: 0.5, y: 0.5 }
    const viewport = viewportAnchoredOn(2, anchor, fraction, WIDTH, HEIGHT)
    const crop = cropFor(viewport, WIDTH, HEIGHT)
    const screen = videoToScreen(anchor, crop, 800, 450)
    expect(screen.x).toBeCloseTo(400, 3)
    expect(screen.y).toBeCloseTo(225, 3)
  })

  it("anchors off-centre points too", () => {
    const anchor = { x: 300, y: 400 }
    const fraction = { x: 0.25, y: 0.75 }
    const viewport = viewportAnchoredOn(3, anchor, fraction, WIDTH, HEIGHT)
    const crop = cropFor(viewport, WIDTH, HEIGHT)
    const screen = videoToScreen(anchor, crop, 800, 450)
    expect(screen.x).toBeCloseTo(200, 3)
    expect(screen.y).toBeCloseTo(337.5, 3)
  })
})

describe("clientToCanvas", () => {
  const rect = { left: 0, top: 0, width: 800, height: 500 }

  it("is exact when the box and the canvas share an aspect ratio", () => {
    const point = clientToCanvas(400, 225, { ...rect, height: 450 }, 1920, 1080)
    expect(point.x).toBeCloseTo(960, 6)
    expect(point.y).toBeCloseTo(540, 6)
  })

  it("removes the top/bottom letterbox of a 16:9 canvas in a 16:10 box", () => {
    // Drawn image is 800 x 450, centred vertically: 25 px bars.
    const centre = clientToCanvas(400, 250, rect, 1920, 1080)
    expect(centre.x).toBeCloseTo(960, 6)
    expect(centre.y).toBeCloseTo(540, 6)

    const topOfImage = clientToCanvas(400, 25, rect, 1920, 1080)
    expect(topOfImage.y).toBeCloseTo(0, 6)
  })

  it("removes the left/right letterbox of a portrait canvas", () => {
    // Portrait 1080x1920 in an 800x500 box: drawn width 281.25, bars 259.375.
    const point = clientToCanvas(400, 250, rect, 1080, 1920)
    expect(point.x).toBeCloseTo(540, 6)
    expect(point.y).toBeCloseTo(960, 6)
  })

  it("survives a zero-sized box", () => {
    expect(clientToCanvas(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 1920, 1080)).toEqual({ x: 0, y: 0 })
  })
})

describe("autoFrame", () => {
  it("zooms in until the board fills most of the frame", () => {
    const viewport = autoFrame({ x: 960, y: 540 }, 120, WIDTH, HEIGHT)
    // Shorter side is 1080; 82% of it should be the board's diameter.
    expect(viewport.zoom).toBeCloseTo(1080 / ((120 * 2) / 0.82), 6)
    expect(viewport.center).toEqual({ x: 960, y: 540 })
  })

  it("never zooms below 1 when the board already fills the frame", () => {
    const viewport = autoFrame({ x: 640, y: 360 }, 400, 1280, 720)
    expect(viewport.zoom).toBe(MIN_ZOOM)
    expect(viewport.center).toEqual({ x: 640, y: 360 })
  })

  it("caps the zoom for a tiny board", () => {
    expect(autoFrame({ x: 960, y: 540 }, 20, WIDTH, HEIGHT).zoom).toBe(MAX_ZOOM)
  })

  it("keeps the board inside the frame near an edge", () => {
    const viewport = autoFrame({ x: 60, y: 60 }, 90, WIDTH, HEIGHT)
    const crop = cropFor(viewport, WIDTH, HEIGHT)
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.width).toBeLessThanOrEqual(WIDTH)
    expect(crop.y + crop.height).toBeLessThanOrEqual(HEIGHT)
  })

  it("falls back to the full frame before the video is ready", () => {
    expect(autoFrame({ x: 0, y: 0 }, 10, 0, 0)).toEqual({ zoom: 1, center: { x: 0, y: 0 } })
  })
})
