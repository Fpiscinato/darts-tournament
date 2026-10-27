import { describe, expect, it } from "vitest"
import {
  BOARD_SPACE_PX_PER_MM,
  BOARD_SPACE_RADIUS_MM,
  BOARD_SPACE_SIZE,
  isOnBoard,
  mmToPixel,
  pixelToMm,
  staticEdgeMask,
  warpToBoardSpace,
} from "./boardSpace"
import type { Homography } from "./homography"

describe("board space coordinates", () => {
  it("maps the canonical centre to the bull", () => {
    const centre = pixelToMm({ x: BOARD_SPACE_SIZE / 2 - 0.5, y: BOARD_SPACE_SIZE / 2 - 0.5 })
    expect(centre.x).toBeCloseTo(0, 6)
    expect(centre.y).toBeCloseTo(0, 6)
  })

  it("round-trips millimetres through canonical pixels", () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 170, y: 0 },
      { x: -103, y: 62 },
      { x: 310, y: -305 },
    ]) {
      const back = pixelToMm(mmToPixel(point))
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
    }
  })

  it("uses roughly one canonical pixel per millimetre", () => {
    expect(BOARD_SPACE_PX_PER_MM * BOARD_SPACE_RADIUS_MM * 2).toBeCloseTo(BOARD_SPACE_SIZE, 9)
    expect(BOARD_SPACE_PX_PER_MM).toBeGreaterThan(0.7)
    expect(BOARD_SPACE_PX_PER_MM).toBeLessThan(0.9)
  })

  it("knows what is on the scoring area", () => {
    expect(isOnBoard({ x: 0, y: 0 })).toBe(true)
    expect(isOnBoard({ x: 170, y: 0 })).toBe(true)
    expect(isOnBoard({ x: 0, y: 220 })).toBe(true)
    expect(isOnBoard({ x: 0, y: 260 })).toBe(false)
    expect(isOnBoard({ x: 200, y: 200 })).toBe(false)
  })
})

/** A frame whose content is a flat board with a bright disc at the bull. */
function syntheticFrame(
  width: number,
  height: number,
  mmToFrame: Homography,
  discRadiusMm = 40,
): Uint8ClampedArray {
  const inverse = [1, 0, 0, 0, 1, 0, 0, 0, 1] as Homography
  const frame = new Uint8ClampedArray(width * height).fill(30)
  // mmToFrame is a pure scale+translation in these tests, so the inverse is
  // easy to write out rather than pulling in the matrix solver.
  inverse[0] = 1 / mmToFrame[0]
  inverse[4] = 1 / mmToFrame[4]
  inverse[2] = -mmToFrame[2] / mmToFrame[0]
  inverse[5] = -mmToFrame[5] / mmToFrame[4]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = inverse[6] * x + inverse[7] * y + inverse[8]
      const mx = (inverse[0] * x + inverse[1] * y + inverse[2]) / w
      const my = (inverse[3] * x + inverse[4] * y + inverse[5]) / w
      if (Math.hypot(mx, my) <= discRadiusMm) frame[y * width + x] = 220
    }
  }
  return frame
}

describe("warpToBoardSpace", () => {
  const mmToFrame: Homography = [2, 0, 400, 0, 2, 300, 0, 0, 1]
  const width = 900
  const height = 800
  const frame = syntheticFrame(width, height, mmToFrame, 40)

  it("puts the bull where board space says it is", () => {
    const warped = warpToBoardSpace(frame, width, height, mmToFrame)
    const bull = mmToPixel({ x: 0, y: 0 })
    expect(warped[Math.round(bull.y) * BOARD_SPACE_SIZE + Math.round(bull.x)]).toBeGreaterThan(150)
  })

  it("agrees with the millimetre lookup away from the centre", () => {
    const warped = warpToBoardSpace(frame, width, height, mmToFrame)
    const inside = mmToPixel({ x: 20, y: 0 })
    const outside = mmToPixel({ x: 120, y: 60 })
    expect(warped[Math.round(inside.y) * BOARD_SPACE_SIZE + Math.round(inside.x)]).toBeGreaterThan(150)
    expect(warped[Math.round(outside.y) * BOARD_SPACE_SIZE + Math.round(outside.x)]).toBeLessThan(80)
  })

  it("leaves areas outside the frame at zero", () => {
    // The frame only covers ±450 mm around the bull; the canonical image is
    // 320 mm half-width, so a frame that starts near the bull must leave the
    // far corner empty rather than wrapping.
    const shifted: Homography = [2, 0, 0, 0, 2, 0, 0, 0, 1]
    const warped = warpToBoardSpace(syntheticFrame(200, 200, shifted, 20), 200, 200, shifted)
    const corner = mmToPixel({ x: 300, y: 300 })
    expect(warped[Math.round(corner.y) * BOARD_SPACE_SIZE + Math.round(corner.x)]).toBe(0)
  })
})

describe("staticEdgeMask", () => {
  it("is empty for a flat reference", () => {
    const flat = new Uint8ClampedArray(BOARD_SPACE_SIZE * BOARD_SPACE_SIZE).fill(90)
    expect(staticEdgeMask(flat).some((value) => value === 1)).toBe(false)
  })

  it("marks wires and dilates them so small model shifts stay ignored", () => {
    const reference = new Uint8ClampedArray(BOARD_SPACE_SIZE * BOARD_SPACE_SIZE).fill(60)
    const row = 200
    const x0 = 120
    const x1 = 400
    for (let x = x0; x <= x1; x++) reference[row * BOARD_SPACE_SIZE + x] = 210

    const mask = staticEdgeMask(reference, 42, 2)
    const at = (x: number, y: number) => mask[y * BOARD_SPACE_SIZE + x]

    expect(at(260, row)).toBe(1)
    expect(at(260, row - 2)).toBe(1)
    expect(at(260, row + 2)).toBe(1)
    expect(at(260, row - 9)).toBe(0)
    expect(at(20, 20)).toBe(0)
  })
})
