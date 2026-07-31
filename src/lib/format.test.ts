import { describe, expect, it } from "vitest"
import { isValidCompletedScore, legsToWin, winnerSlot } from "./format"

describe("legsToWin", () => {
  it("derives legsToWin = ceil(bestOf/2)", () => {
    expect(legsToWin(3)).toBe(2)
    expect(legsToWin(5)).toBe(3)
    expect(legsToWin(7)).toBe(4)
  })
})

describe("isValidCompletedScore", () => {
  it("accepts a valid bo3 result", () => {
    expect(isValidCompletedScore(3, 2, 0)).toBe(true)
    expect(isValidCompletedScore(3, 2, 1)).toBe(true)
    expect(isValidCompletedScore(3, 0, 2)).toBe(true)
  })

  it("accepts a valid bo5 result", () => {
    expect(isValidCompletedScore(5, 3, 2)).toBe(true)
    expect(isValidCompletedScore(5, 3, 0)).toBe(true)
  })

  it("accepts a valid bo7 result", () => {
    expect(isValidCompletedScore(7, 4, 3)).toBe(true)
  })

  it("rejects a draw (impossible by construction)", () => {
    expect(isValidCompletedScore(3, 1, 1)).toBe(false)
    expect(isValidCompletedScore(5, 2, 2)).toBe(false)
  })

  it("rejects scores where neither side reached legsToWin", () => {
    expect(isValidCompletedScore(3, 1, 0)).toBe(false)
    expect(isValidCompletedScore(5, 2, 1)).toBe(false)
  })

  it("rejects scores where both sides reached legsToWin", () => {
    expect(isValidCompletedScore(3, 2, 2)).toBe(false)
  })

  it("rejects scores exceeding legsToWin", () => {
    expect(isValidCompletedScore(3, 3, 1)).toBe(false)
  })

  it("rejects negative legs", () => {
    expect(isValidCompletedScore(3, -1, 2)).toBe(false)
  })
})

describe("winnerSlot", () => {
  it("picks the higher score's slot", () => {
    expect(winnerSlot(2, 0)).toBe(1)
    expect(winnerSlot(0, 2)).toBe(2)
    expect(winnerSlot(1, 1)).toBe(null)
  })
})
