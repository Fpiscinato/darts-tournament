import { describe, expect, it } from "vitest"
import { detectBoard, refineBoard } from "./boardDetector"

const WIDTH = 320
const HEIGHT = 240

function blank(): Uint8ClampedArray {
  return new Uint8ClampedArray(WIDTH * HEIGHT).fill(20)
}

function drawRing(gray: Uint8ClampedArray, cx: number, cy: number, radius: number, thickness: number): void {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const distance = Math.hypot(x - cx, y - cy)
      if (Math.abs(distance - radius) <= thickness / 2) gray[y * WIDTH + x] = 235
    }
  }
}

describe("detectBoard", () => {
  it("finds a centred ring", () => {
    const gray = blank()
    drawRing(gray, 160, 120, 80, 4)

    const board = detectBoard(gray, WIDTH, HEIGHT)
    expect(board).not.toBeNull()
    expect(board?.center.x).toBeCloseTo(160, 0)
    expect(board?.center.y).toBeCloseTo(120, 0)
    expect(board?.radius).toBeCloseTo(80, 0)
    expect(board?.confidence).toBeGreaterThan(0.7)
  })

  it("finds an off-centre, larger ring", () => {
    const gray = blank()
    drawRing(gray, 120, 90, 95, 4)

    const board = detectBoard(gray, WIDTH, HEIGHT)
    expect(board).not.toBeNull()
    expect(board?.center.x).toBeCloseTo(120, 0)
    expect(board?.center.y).toBeCloseTo(90, 0)
    expect(board?.radius).toBeCloseTo(95, 0)
  })

  it("returns nothing for a featureless frame", () => {
    const gray = blank()
    expect(detectBoard(gray, WIDTH, HEIGHT)).toBeNull()
  })

  it("ignores rings outside the expected size range", () => {
    const gray = blank()
    drawRing(gray, 160, 120, 10, 2)
    const board = detectBoard(gray, WIDTH, HEIGHT)
    // A tiny circle is below minRadiusFraction; either nothing or a poor
    // confidence is acceptable, never a confident wrong answer.
    if (board) expect(board.confidence).toBeLessThan(0.7)
  })
})

describe("detectBoard on a full board (rim stronger than the double ring)", () => {
  it("returns the double-ring radius, not the rim radius", () => {
    const width = 400
    const height = 400
    const gray = new Uint8ClampedArray(width * height).fill(30)
    const cx = 200
    const cy = 200

    // Physical proportions: rim 225.5 mm, double 170 mm, triple 107 mm.
    const rim = 150
    const doubleRing = (rim * 170) / 225.5
    const tripleRing = (rim * 107) / 225.5

    // The rim is the strongest, brightest edge; the rings are thinner.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const distance = Math.hypot(x - cx, y - cy)
        if (Math.abs(distance - rim) <= 3) gray[y * width + x] = 245
        else if (Math.abs(distance - doubleRing) <= 1.5) gray[y * width + x] = 200
        else if (Math.abs(distance - tripleRing) <= 1.5) gray[y * width + x] = 200
        else if (distance < doubleRing) gray[y * width + x] = 120
      }
    }

    const board = detectBoard(gray, width, height)
    expect(board).not.toBeNull()
    expect(board?.center.x).toBeCloseTo(cx, 0)
    expect(board?.center.y).toBeCloseTo(cy, 0)
    expect(board?.radius).toBeCloseTo(doubleRing, 0)
  })
})

describe("refineBoard", () => {
  /** Synthetic board at a known scale: rim, four scoring wires, bull. */
  function boardImage(size: number, cx: number, cy: number, pxPerMm: number) {
    const gray = new Uint8ClampedArray(size * size).fill(30)
    const mm = [225.5, 170, 162, 107, 99, 15.9, 6.35]
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const distance = Math.hypot(x - cx, y - cy) / pxPerMm
        let value = 30
        if (distance <= 225.5) value = 150
        // Wires and the rim read as dark lines on the painted board.
        for (const ring of mm) {
          const thickness = ring === 225.5 ? 1.6 : 0.9
          if (Math.abs(distance - ring) <= thickness) value = 25
        }
        if (distance <= 6.35) value = 40
        gray[y * size + x] = value
      }
    }
    return gray
  }

  it("finds the 170 mm ring even when the seed is the rim", () => {
    const size = 720
    const pxPerMm = 1.5
    const cx = 360
    const cy = 360
    const gray = boardImage(size, cx, cy, pxPerMm)

    // What the Hough pass returns on a real phone: the rim, a little off.
    const refined = refineBoard(gray, size, size, {
      center: { x: cx + 12, y: cy - 9 },
      radius: 225.5 * pxPerMm,
    })

    expect(refined).not.toBeNull()
    expect(refined?.center.x).toBeCloseTo(cx, -0.2)
    expect(refined?.center.y).toBeCloseTo(cy, -0.2)
    expect(refined?.radius).toBeCloseTo(170 * pxPerMm, 0)
    expect(refined?.confidence).toBeGreaterThan(0.6)
  })

  it("corrects a seed that locked onto the black surround", () => {
    const size = 720
    const pxPerMm = 1.4
    const cx = 340
    const cy = 380
    const gray = boardImage(size, cx, cy, pxPerMm)

    const refined = refineBoard(gray, size, size, {
      center: { x: cx - 14, y: cy + 6 },
      // Well outside the 225.5 mm rim, as a surround or a cabinet edge would be.
      radius: 260 * pxPerMm,
    })

    expect(refined).not.toBeNull()
    expect(refined?.radius).toBeCloseTo(170 * pxPerMm, 0)
    expect(refined?.center.x).toBeCloseTo(cx, -0.2)
  })

  it("rejects a seed with no radius and a featureless frame", () => {
    const size = 240
    const blank = new Uint8ClampedArray(size * size).fill(90)
    expect(refineBoard(blank, size, size, { center: { x: 120, y: 120 }, radius: 0 })).toBeNull()
    expect(refineBoard(blank, size, size, { center: { x: 120, y: 120 }, radius: 60 })).toBeNull()
  })

  it("follows a small move with the tight tracking band", () => {
    // What the once-a-second tracker does: the phone was nudged, so the seed is
    // the previous model and only a narrow band is searched.
    const size = 720
    const pxPerMm = 1.5
    const cx = 372
    const cy = 352
    const gray = boardImage(size, cx, cy, pxPerMm)

    const refined = refineBoard(
      gray,
      size,
      size,
      { center: { x: 360, y: 360 }, radius: 170 * pxPerMm },
      { spanFraction: 0.15, centres: 16, radii: 20, radiusScale: [0.85, 1.15] },
    )

    expect(refined).not.toBeNull()
    // The tight band is a coarse grid plus a hill climb; a couple of pixels is
    // about a millimetre on a real phone, well under the double-wire width.
    expect(Math.abs((refined?.center.x ?? 0) - cx)).toBeLessThan(4)
    expect(Math.abs((refined?.center.y ?? 0) - cy)).toBeLessThan(4)
    expect(refined?.radius).toBeCloseTo(170 * pxPerMm, 0)
  })

  it("does not invent a board when the tracking band has nothing to lock onto", () => {
    const size = 480
    const blank = new Uint8ClampedArray(size * size).fill(120)
    const refined = refineBoard(
      blank,
      size,
      size,
      { center: { x: 240, y: 240 }, radius: 120 },
      { spanFraction: 0.15, centres: 12, radii: 14, radiusScale: [0.85, 1.15] },
    )
    expect(refined).toBeNull()
  })
})
