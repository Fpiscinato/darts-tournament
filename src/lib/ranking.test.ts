import { describe, expect, it } from "vitest"
import { computeAllTimeRanking } from "./ranking"
import type { TournamentPlayerResult } from "./types"

function result(overrides: Partial<TournamentPlayerResult>): TournamentPlayerResult {
  return {
    id: crypto.randomUUID(),
    tournamentId: "t1",
    playerId: "a",
    position: null,
    matchWins: 0,
    matchLosses: 0,
    points: 0,
    legsFor: 0,
    legsAgainst: 0,
    playoffRequired: false,
    titleWon: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe("computeAllTimeRanking", () => {
  it("ranks title winners first", () => {
    const results = [
      result({ playerId: "a", titleWon: true, position: 1, matchWins: 3 }),
      result({ playerId: "b", titleWon: false, position: 2, matchWins: 5 }),
    ]
    const ranking = computeAllTimeRanking(results)
    expect(ranking[0].playerId).toBe("a")
  })

  it("falls back to total match wins when titles tie", () => {
    const results = [
      result({ playerId: "a", tournamentId: "t1", matchWins: 2, matchLosses: 1 }),
      result({ playerId: "b", tournamentId: "t2", matchWins: 4, matchLosses: 0 }),
    ]
    const ranking = computeAllTimeRanking(results)
    expect(ranking[0].playerId).toBe("b")
  })

  it("computes win rate correctly", () => {
    const results = [
      result({ playerId: "a", tournamentId: "t1", matchWins: 3, matchLosses: 1 }),
      result({ playerId: "a", tournamentId: "t2", matchWins: 1, matchLosses: 1 }),
    ]
    const ranking = computeAllTimeRanking(results)
    expect(ranking[0].totalMatchWins).toBe(4)
    expect(ranking[0].totalMatchLosses).toBe(2)
    expect(ranking[0].winRate).toBeCloseTo(4 / 6)
  })

  it("returns 0 win rate for a player with no matches", () => {
    const ranking = computeAllTimeRanking([result({ playerId: "a", matchWins: 0, matchLosses: 0 })])
    expect(ranking[0].winRate).toBe(0)
  })
})
