import { describe, expect, it } from "vitest"
import { buildRankingModel, typeLabelOf } from "./shareRanking"
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
    legsFor: 5,
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
  { id: "p4", name: "Bruno", active: false, seed: null, createdAt: "", updatedAt: "" },
]

describe("buildRankingModel", () => {
  it("sorts by position and assigns medals and leg difference", () => {
    const model = buildRankingModel({
      tournament: makeTournament(),
      results: [
        makeResult({ playerId: "p1", position: 1, legsFor: 5, legsAgainst: 1 }),
        makeResult({ id: "r2", playerId: "p2", position: 2, matchWins: 1, matchLosses: 1, points: 2, legsFor: 3, legsAgainst: 4 }),
        makeResult({ id: "r3", playerId: "p3", position: 3, matchWins: 0, matchLosses: 2, points: 0, legsFor: 1, legsAgainst: 4, titleWon: false }),
      ],
      players,
    })

    expect(model.rows.map((r) => r.name)).toEqual(["Fernando", "João", "Maria"])
    expect(model.rows[0].medal).toBe("🥇")
    expect(model.rows[1].medal).toBe("🥈")
    expect(model.rows[2].medal).toBe("🥉")
    expect(model.rows.map((r) => r.legDiff)).toEqual([4, -1, -3])
    expect(model.rows[0].wonTitle).toBe(true)
    expect(model.dateLabel).toContain("Oct 2026")
  })

  it("includes a withdrawal footnote", () => {
    const model = buildRankingModel({
      tournament: makeTournament({
        withdrawals: [{ playerId: "p4", at: "2026-10-06T11:00:00.000Z", matches: [] }],
      }),
      results: [
        makeResult({ playerId: "p1", position: 1 }),
        makeResult({ id: "r2", playerId: "p4", position: 4, matchWins: 0, matchLosses: 2, points: 0, legsFor: 0, legsAgainst: 4, titleWon: false, withdrawn: true }),
      ],
      players,
    })

    expect(model.notes).toEqual(["⚠️ Bruno withdrew from the tournament"])
    expect(model.rows[1].withdrawn).toBe(true)
  })

  it("handles a knockout tournament label and a missing end date", () => {
    const knockout = buildRankingModel({
      tournament: makeTournament({ type: "knockout", finalsFormat: null, completedAt: null }),
      results: [],
      players,
    })
    expect(knockout.typeLabel).toBe("Knockout")
    expect(knockout.dateLabel).toBeNull()

    expect(typeLabelOf(makeTournament())).toBe("League")
  })
})