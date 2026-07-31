import { describe, expect, it } from "vitest"
import { byeCount, generateKnockoutRound1, nextPowerOfTwo, roundName, seedPositions, totalRounds } from "./knockout"

function players(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`)
}

describe("byeCount", () => {
  it.each([
    [2, 0],
    [3, 1],
    [5, 3],
    [6, 2],
    [7, 1],
    [8, 0],
    [9, 7],
    [10, 6],
    [12, 4],
    [16, 0],
  ])("gives correct bye count for %i players", (n, expected) => {
    expect(byeCount(n)).toBe(expected)
  })
})

describe("generateKnockoutRound1", () => {
  it.each([2, 3, 5, 6, 7, 8, 9, 10, 12, 16])(
    "produces exactly nextPowerOfTwo(n)/2 round-1 matches for %i players",
    (n) => {
      const matches = generateKnockoutRound1(players(n))
      expect(matches.length).toBe(nextPowerOfTwo(n) / 2)
    },
  )

  it.each([2, 3, 5, 6, 7, 8, 9, 10, 12, 16])("gives exactly byeCount(n) byes for %i players", (n) => {
    const matches = generateKnockoutRound1(players(n))
    const byes = matches.filter((m) => m.isBye)
    expect(byes.length).toBe(byeCount(n))
  })

  it("never produces a match with both slots empty", () => {
    for (const n of [2, 3, 5, 6, 7, 8, 9, 10, 12, 16]) {
      const matches = generateKnockoutRound1(players(n))
      for (const m of matches) {
        expect(m.player1Id !== null || m.player2Id !== null).toBe(true)
      }
    }
  })

  it("includes every player exactly once", () => {
    const ids = players(9)
    const matches = generateKnockoutRound1(ids)
    const seen = matches.flatMap((m) => [m.player1Id, m.player2Id]).filter((x): x is string => x !== null)
    expect(new Set(seen).size).toBe(9)
    expect(seen.length).toBe(9)
  })

  it("keeps seed 1 and seed 2 in opposite halves of the bracket", () => {
    const ids = players(8)
    const matches = generateKnockoutRound1(ids)
    const half = matches.length / 2
    const topHalf = matches.slice(0, half)
    const bottomHalf = matches.slice(half)
    const inTopHalf = topHalf.some((m) => m.player1Id === "p1" || m.player2Id === "p1")
    const inBottomHalf = bottomHalf.some((m) => m.player1Id === "p2" || m.player2Id === "p2")
    expect(inTopHalf).toBe(true)
    expect(inBottomHalf).toBe(true)
  })
})

describe("seedPositions", () => {
  it("matches the standard bracket seeding order for size 8", () => {
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
  })
})

describe("roundName", () => {
  it("names rounds by distance from the final", () => {
    expect(roundName(3, 3)).toBe("Final")
    expect(roundName(2, 3)).toBe("Semi-final")
    expect(roundName(1, 3)).toBe("Quarter-final")
    expect(roundName(1, 4)).toBe("Round of 16")
  })

  it("totalRounds matches log2 of the padded bracket size", () => {
    expect(totalRounds(16)).toBe(4)
    expect(totalRounds(9)).toBe(4)
    expect(totalRounds(2)).toBe(1)
  })
})
