import { describe, expect, it } from "vitest"
import { buildShareText } from "./share"
import type { Player, Tournament, TournamentPlayerResult } from "./types"

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "t1",
    name: "Copa Darts 2026",
    type: "league",
    status: "completed",
    playerIds: ["p1", "p2", "p3"],
    withdrawals: [],
    finalsFormat: "league_winner",
    drawMethod: null,
    stageFormats: { league: 3 },
    createdAt: "2026-10-06T10:00:00.000Z",
    updatedAt: "2026-10-06T12:00:00.000Z",
    startedAt: "2026-10-06T10:00:00.000Z",
    completedAt: "2026-10-06T12:00:00.000Z",
    ...overrides,
  }
}

function makeResult(overrides: Partial<TournamentPlayerResult> = {}): TournamentPlayerResult {
  return {
    id: "r1",
    tournamentId: "t1",
    playerId: "p1",
    position: 1,
    matchWins: 2,
    matchLosses: 0,
    points: 4,
    legsFor: 4,
    legsAgainst: 1,
    playoffRequired: false,
    titleWon: true,
    withdrawn: false,
    createdAt: "2026-10-06T12:00:00.000Z",
    ...overrides,
  }
}

const players: Player[] = [
  { id: "p1", name: "Fernando", active: true, seed: null, createdAt: "", updatedAt: "" },
  { id: "p2", name: "João", active: true, seed: null, createdAt: "", updatedAt: "" },
  { id: "p3", name: "Maria", active: true, seed: null, createdAt: "", updatedAt: "" },
]

describe("buildShareText", () => {
  it("renders the tournament name, type, date and a medal for each podium row", () => {
    const text = buildShareText({
      tournament: makeTournament(),
      results: [
        makeResult({ playerId: "p1", position: 1, titleWon: true }),
        makeResult({ id: "r2", playerId: "p2", position: 2, matchWins: 1, matchLosses: 1, points: 2, legsFor: 3, legsAgainst: 3 }),
        makeResult({ id: "r3", playerId: "p3", position: 3, matchWins: 0, matchLosses: 2, points: 0, legsFor: 1, legsAgainst: 4, titleWon: false }),
      ],
      players,
    })

    expect(text).toContain("*Copa Darts 2026*")
    expect(text).toContain("League")
    expect(text).toContain("Finished on")
    expect(text).toContain("🥇 *1st Fernando* — 2W-0L · 4 pts · +3 legs")
    expect(text).toContain("🥈 *2nd João*")
    expect(text).toContain("🥉 *3rd Maria*")
    expect(text).toContain("Darts Tournament Manager")
  })

  it("lists players below the podium and spells out withdrawals", () => {
    const text = buildShareText({
      tournament: makeTournament({
        playerIds: ["p1", "p2", "p3", "p4"],
        withdrawals: [{ playerId: "p4", at: "", matches: [] }],
      }),
      results: [
        makeResult({ playerId: "p1", position: 1 }),
        makeResult({ id: "r2", playerId: "p2", position: 2, matchWins: 1, matchLosses: 1, points: 2, legsFor: 2, legsAgainst: 2 }),
        makeResult({ id: "r3", playerId: "p3", position: 3, matchWins: 0, matchLosses: 2, points: 0, legsFor: 0, legsAgainst: 4, titleWon: false }),
        makeResult({ id: "r4", playerId: "p4", position: 4, matchWins: 0, matchLosses: 3, points: 0, legsFor: 0, legsAgainst: 6, titleWon: false, withdrawn: true }),
      ],
      players: [...players, { id: "p4", name: "Bruno", active: false, seed: null, createdAt: "", updatedAt: "" }],
    })

    expect(text).toContain("*📊 Full ranking*")
    expect(text).toContain("4th Bruno ⚠️ — 0 pts (0W-3L)")
    expect(text).toContain("⚠️ Bruno withdrew from the tournament")
  })

  it("handles an empty result set without throwing", () => {
    const text = buildShareText({ tournament: makeTournament({ completedAt: null }), results: [], players })
    expect(text).toContain("*Copa Darts 2026*")
    expect(text).not.toContain("Finished on")
  })
})
