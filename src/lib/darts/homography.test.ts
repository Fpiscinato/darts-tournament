import { describe, expect, it } from "vitest"
import type { Point } from "./boardGeometry"
import { applyHomography, invertHomography, solveHomography } from "./homography"

const TRUE_H = [1.2, 0.15, 400, -0.08, 1.35, 120, 0.00018, 0.00009, 1]

function project([x, y]: [number, number]): Point {
  const w = TRUE_H[6] * x + TRUE_H[7] * y + 1
  return {
    x: (TRUE_H[0] * x + TRUE_H[1] * y + TRUE_H[2]) / w,
    y: (TRUE_H[3] * x + TRUE_H[4] * y + TRUE_H[5]) / w,
  }
}

describe("solveHomography", () => {
  it("recovers a known projective transform from four points", () => {
    const src: Point[] = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 700 },
      { x: 0, y: 700 },
    ]
    const dst = src.map((point) => project([point.x, point.y]))

    const solved = solveHomography(src, dst)
    expect(solved).not.toBeNull()

    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 10; j++) {
        const point = { x: i * 100, y: j * 70 }
        const expected = project([point.x, point.y])
        const actual = applyHomography(solved as number[], point)
        expect(actual.x).toBeCloseTo(expected.x, 8)
        expect(actual.y).toBeCloseTo(expected.y, 8)
      }
    }
  })

  it("rejects degenerate (collinear) points", () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ]
    expect(solveHomography(line, line)).toBeNull()
  })

  it("requires exactly four correspondences", () => {
    expect(solveHomography([], [])).toBeNull()
  })
})

describe("invertHomography", () => {
  it("round-trips a realistic board calibration", () => {
    const corners: Point[] = [
      { x: 420, y: 180 },
      { x: 1660, y: 220 },
      { x: 1600, y: 1500 },
      { x: 380, y: 1460 },
    ]
    const board: Point[] = [
      { x: 0, y: 170 },
      { x: 170, y: 0 },
      { x: 0, y: -170 },
      { x: -170, y: 0 },
    ]

    const toBoard = solveHomography(corners, board)
    expect(toBoard).not.toBeNull()

    const toPixels = invertHomography(toBoard as never)
    expect(toPixels).not.toBeNull()

    for (const point of corners) {
      const boardPoint = applyHomography(toBoard as number[], point)
      const back = applyHomography(toPixels as number[], boardPoint)
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
    }
  })
})
