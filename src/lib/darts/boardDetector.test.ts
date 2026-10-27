import { describe, expect, it } from "vitest"
import { detectBoard } from "./boardDetector"

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
