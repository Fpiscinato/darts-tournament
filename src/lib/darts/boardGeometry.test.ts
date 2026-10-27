import { describe, expect, it } from "vitest"
import {
  BOARD,
  SEGMENTS,
  pointOnBoard,
  ringPolygon,
  scoreAtPoint,
  segmentAtPoint,
  segmentCentreAngle,
  segmentLabelPoint,
  segmentSpokes,
} from "./boardGeometry"

describe("segment geometry", () => {
  it("puts 20 at the top, 6 right, 3 bottom, 11 left", () => {
    expect(segmentCentreAngle(20)).toBe(90)
    expect(segmentCentreAngle(6)).toBe(0)
    expect(segmentCentreAngle(3)).toBe(270)
    expect(segmentCentreAngle(11)).toBe(180)
  })

  it("maps the cardinal directions to the expected segments", () => {
    expect(segmentAtPoint({ x: 0, y: 100 })).toBe(20)
    expect(segmentAtPoint({ x: 100, y: 0 })).toBe(6)
    expect(segmentAtPoint({ x: 0, y: -100 })).toBe(3)
    expect(segmentAtPoint({ x: -100, y: 0 })).toBe(11)
  })

  it("round-trips every segment through pointOnBoard", () => {
    for (const segment of SEGMENTS) {
      const point = pointOnBoard(segment, 60)
      expect(segmentAtPoint(point)).toBe(segment)
    }
  })
})

describe("scoreAtPoint", () => {
  it("scores the bulls", () => {
    expect(scoreAtPoint({ x: 0, y: 0 })).toMatchObject({ score: 50, ring: "inner-bull", label: "50" })
    expect(scoreAtPoint({ x: 0, y: 10 })).toMatchObject({ score: 25, ring: "outer-bull", label: "25" })
  })

  it("scores singles, triples and doubles for all 20 segments", () => {
    for (const segment of SEGMENTS) {
      const single = scoreAtPoint(pointOnBoard(segment, 60))
      const triple = scoreAtPoint(pointOnBoard(segment, 103))
      const double = scoreAtPoint(pointOnBoard(segment, 166))

      expect(single).toMatchObject({ score: segment, ring: "single-inner", label: `S${segment}` })
      expect(triple).toMatchObject({ score: segment * 3, ring: "triple", label: `T${segment}` })
      expect(double).toMatchObject({ score: segment * 2, ring: "double", label: `D${segment}` })
    }
  })

  it("respects the ring boundaries exactly", () => {
    expect(scoreAtPoint({ x: 0, y: BOARD.tripleInner - 0.01 }).ring).toBe("single-inner")
    expect(scoreAtPoint({ x: 0, y: BOARD.tripleInner + 0.01 }).ring).toBe("triple")
    expect(scoreAtPoint({ x: 0, y: BOARD.tripleOuter + 0.01 }).ring).toBe("single-outer")
    expect(scoreAtPoint({ x: 0, y: BOARD.doubleInner + 0.01 }).ring).toBe("double")
    expect(scoreAtPoint({ x: 0, y: BOARD.doubleOuter + 0.01 }).ring).toBe("miss")
  })

  it("misses outside the scoring area", () => {
    expect(scoreAtPoint({ x: 0, y: 200 })).toMatchObject({ score: 0, segment: null, label: "MISS" })
  })
})

describe("drawing helpers", () => {
  it("builds closed polygons with the requested radius", () => {
    const polygon = ringPolygon(170, 32)
    expect(polygon).toHaveLength(32)
    for (const point of polygon) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(170, 6)
    }
  })

  it("draws one spoke per segment boundary", () => {
    const spokes = segmentSpokes()
    expect(spokes).toHaveLength(20)
    for (const [inner, outer] of spokes) {
      expect(Math.hypot(inner.x, inner.y)).toBeCloseTo(BOARD.outerBull, 6)
      expect(Math.hypot(outer.x, outer.y)).toBeCloseTo(BOARD.doubleOuter, 6)
    }
  })

  it("places the number ring outside the doubles", () => {
    const position = segmentLabelPoint(20)
    expect(Math.hypot(position.x, position.y)).toBeGreaterThan(BOARD.doubleOuter)
  })
})
