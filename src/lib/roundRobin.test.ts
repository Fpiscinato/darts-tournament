import { describe, expect, it } from "vitest"
import { computeStandings, generateRoundRobinFixtures } from "./roundRobin"
import type { Match } from "./types"

function players(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`)
}

describe("generateRoundRobinFixtures", () => {
  it.each([2, 3, 4, 5, 8, 9, 16])("generates n*(n-1)/2 fixtures for %i players", (n) => {
    const fixtures = generateRoundRobinFixtures(players(n))
    expect(fixtures.length).toBe((n * (n - 1)) / 2)
  })

  it("has every player meet every other exactly once", () => {
    const ids = players(6)
    const fixtures = generateRoundRobinFixtures(ids)
    const seen = new Set<string>()
    for (const f of fixtures) {
      const key = [f.player1Id, f.player2Id].sort().join("-")
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(seen.size).toBe(15)
  })

  it("gives every player exactly one bye round for odd counts", () => {
    const ids = players(5)
    const fixtures = generateRoundRobinFixtures(ids)
    const rounds = new Set(fixtures.map((f) => f.round))
    const byeCountPerPlayer = new Map(ids.map((id) => [id, 0]))
    for (const round of rounds) {
      const playing = new Set(
        fixtures.filter((f) => f.round === round).flatMap((f) => [f.player1Id, f.player2Id]),
      )
      for (const id of ids) {
        if (!playing.has(id)) byeCountPerPlayer.set(id, (byeCountPerPlayer.get(id) ?? 0) + 1)
      }
    }
    for (const id of ids) {
      expect(byeCountPerPlayer.get(id)).toBe(1)
    }
  })

  it("returns nothing for fewer than 2 players", () => {
    expect(generateRoundRobinFixtures(["p1"])).toEqual([])
  })
})

function completedMatch(p1: string, p2: string, p1Legs: number, p2Legs: number): Match {
  return {
    id: `${p1}-${p2}`,
    tournamentId: "t1",
    stage: "league",
    round: 1,
    bracketPosition: 1,
    player1Id: p1,
    player2Id: p2,
    player1Legs: p1Legs,
    player2Legs: p2Legs,
    winnerId: p1Legs > p2Legs ? p1 : p2,
    status: "completed",
    bestOf: 3,
    legsToWin: 2,
    nextMatchId: null,
    nextMatchSlot: null,
    confirmedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe("computeStandings", () => {
  it("ranks by points, no draws", () => {
    const matches = [
      completedMatch("a", "b", 2, 0),
      completedMatch("a", "c", 2, 1),
      completedMatch("b", "c", 2, 0),
    ]
    const standings = computeStandings(["a", "b", "c"], matches)
    expect(standings[0].playerId).toBe("a")
    expect(standings[0].points).toBe(4)
    expect(standings[0].wins).toBe(2)
  })

  it("breaks ties by leg difference then legs for", () => {
    // a and b both finish 1 win / 1 loss (2 pts) but b has the better leg diff.
    const matches = [
      completedMatch("a", "c", 2, 0), // a: legDiff +2
      completedMatch("d", "a", 2, 0), // a: legDiff -2 -> net 0
      completedMatch("b", "c", 2, 0), // b: legDiff +2
      completedMatch("d", "b", 2, 1), // b: legDiff -1 -> net +1
    ]
    const standings = computeStandings(["a", "b", "c", "d"], matches)
    const a = standings.find((r) => r.playerId === "a")!
    const b = standings.find((r) => r.playerId === "b")!
    expect(a.points).toBe(b.points)
    expect(a.legDiff).toBe(0)
    expect(b.legDiff).toBe(1)
    expect(standings.indexOf(b)).toBeLessThan(standings.indexOf(a))
  })

  it("uses head-to-head when points, leg diff, and legs for are all tied", () => {
    // a and b are tied 4pts / +8 legDiff / 14 legsFor after all games, but a
    // beat b 6-4 head-to-head, so a must rank above b without a play-off flag.
    const matches = [
      completedMatch("a", "c", 8, 2),
      completedMatch("b", "d", 5, 0),
      completedMatch("b", "e", 5, 0),
      completedMatch("a", "b", 6, 4),
    ]
    const standings = computeStandings(["a", "b", "c", "d", "e"], matches)
    const a = standings.find((r) => r.playerId === "a")!
    const b = standings.find((r) => r.playerId === "b")!
    expect(a.points).toBe(b.points)
    expect(a.legDiff).toBe(b.legDiff)
    expect(a.legsFor).toBe(b.legsFor)
    expect(standings.indexOf(a)).toBeLessThan(standings.indexOf(b))
    expect(a.playoffRequired).toBe(false)
    expect(b.playoffRequired).toBe(false)
  })

  it("flags playoffRequired instead of silently resolving unbreakable ties", () => {
    // Round-robin triangle where a beat b, b beat c, c beat a, all identical leg stats.
    const matches = [
      completedMatch("a", "b", 2, 1),
      completedMatch("b", "c", 2, 1),
      completedMatch("c", "a", 2, 1),
    ]
    const standings = computeStandings(["a", "b", "c"], matches)
    expect(standings.every((r) => r.playoffRequired)).toBe(true)
  })

  it("gives 0 points and no crash for players with no completed matches", () => {
    const standings = computeStandings(["a", "b"], [])
    expect(standings.every((r) => r.points === 0 && r.played === 0)).toBe(true)
  })

  it("does not flag playoffRequired before anyone has played a match", () => {
    const standings = computeStandings(["a", "b", "c", "d"], [])
    expect(standings.every((r) => !r.playoffRequired)).toBe(true)
  })
})
