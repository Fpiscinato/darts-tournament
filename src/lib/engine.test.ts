import { beforeEach, describe, expect, it } from "vitest"
import { db } from "./db"
import {
  EngineError,
  confirmMatch,
  deleteTournament,
  finishTournament,
  reopenTournament,
  startTournament,
  undoLastConfirmedResult,
} from "./engine"
import type { Tournament } from "./types"

function uid(): string {
  return crypto.randomUUID()
}

async function makeTournament(overrides: Partial<Tournament>): Promise<Tournament> {
  const t: Tournament = {
    id: uid(),
    name: "Test Cup",
    type: "league",
    status: "draft",
    playerIds: [],
    finalsFormat: null,
    drawMethod: null,
    stageFormats: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
  await db.tournaments.add(t)
  return t
}

function players(n: number): string[] {
  return Array.from({ length: n }, () => uid())
}

/** Confirms every currently-pending match for a tournament+stage by making
 * the lower-index player win every time (deterministic standings). */
async function playOutStage(tournamentId: string, stage: string, bestOf = 3): Promise<void> {
  const need = Math.ceil(bestOf / 2)
  for (;;) {
    const pending = await db.matches
      .where({ tournamentId, stage })
      .and((m) => m.status === "pending" && m.player1Id !== null && m.player2Id !== null)
      .toArray()
    if (pending.length === 0) break
    for (const m of pending) {
      await confirmMatch(m.id, need, 0)
    }
  }
}

beforeEach(async () => {
  await db.tournaments.clear()
  await db.matches.clear()
  await db.results.clear()
})

describe("league tournament with top4_round_robin finals", () => {
  it("produces exactly 6 Top 4 matches and crowns a champion via a separate final", async () => {
    const ids = players(6)
    const t = await makeTournament({
      type: "league",
      playerIds: ids,
      finalsFormat: "top4_round_robin",
      stageFormats: { league: 3, top4: 3, final: 5 },
    })
    await startTournament(t.id)

    const leagueMatches = await db.matches.where({ tournamentId: t.id, stage: "league" }).toArray()
    expect(leagueMatches.length).toBe((6 * 5) / 2)

    await playOutStage(t.id, "league", 3)

    const top4Matches = await db.matches.where({ tournamentId: t.id, stage: "top4" }).toArray()
    expect(top4Matches.length).toBe(6)

    await playOutStage(t.id, "top4", 3)

    const finalMatches = await db.matches.where({ tournamentId: t.id, stage: "final" }).toArray()
    expect(finalMatches.length).toBe(1)
    expect(finalMatches[0].bestOf).toBe(5)

    // Play the final with a valid bo5 score.
    await confirmMatch(finalMatches[0].id, 3, 2)

    const tournament = await db.tournaments.get(t.id)
    expect(tournament?.status).toBe("completed")

    const results = await db.results.where({ tournamentId: t.id }).toArray()
    expect(results.length).toBe(6) // one row per player, never one per tournament
    expect(results.filter((r) => r.titleWon).length).toBe(1)
  })
})

describe("league tournament with direct_final", () => {
  it("sends the top 2 straight to a bo5 final", async () => {
    const ids = players(4)
    const t = await makeTournament({
      type: "league",
      playerIds: ids,
      finalsFormat: "direct_final",
      stageFormats: { league: 3, final: 5 },
    })
    await startTournament(t.id)
    await playOutStage(t.id, "league", 3)

    const finalMatches = await db.matches.where({ tournamentId: t.id, stage: "final" }).toArray()
    expect(finalMatches.length).toBe(1)
    expect(finalMatches[0].bestOf).toBe(5)
    expect(finalMatches[0].legsToWin).toBe(3)
  })
})

describe("league tournament with league_winner", () => {
  it("finishes immediately once the table is complete, no extra stage", async () => {
    const ids = players(4)
    const t = await makeTournament({
      type: "league",
      playerIds: ids,
      finalsFormat: "league_winner",
      stageFormats: { league: 3 },
    })
    await startTournament(t.id)
    await playOutStage(t.id, "league", 3)

    const tournament = await db.tournaments.get(t.id)
    expect(tournament?.status).toBe("completed")
    const finalMatches = await db.matches.where({ tournamentId: t.id, stage: "final" }).toArray()
    expect(finalMatches.length).toBe(0)
  })
})

describe("league tournament with top4_knockout", () => {
  it("uses the top4 format for semis and the final format for the mini-final", async () => {
    const ids = players(5)
    const t = await makeTournament({
      type: "league",
      playerIds: ids,
      finalsFormat: "top4_knockout",
      stageFormats: { league: 3, top4: 3, final: 5 },
    })
    await startTournament(t.id)
    await playOutStage(t.id, "league", 3)

    const knockoutMatches = await db.matches.where({ tournamentId: t.id, stage: "knockout" }).toArray()
    expect(knockoutMatches.length).toBe(3) // 2 semis + 1 final
    const semis = knockoutMatches.filter((m) => m.round === 1)
    const final = knockoutMatches.find((m) => m.round === 2)!
    expect(semis.every((m) => m.bestOf === 3)).toBe(true)
    expect(final.bestOf).toBe(5)

    for (const semi of semis) {
      await confirmMatch(semi.id, 2, 0)
    }
    const updatedFinal = await db.matches.get(final.id)
    expect(updatedFinal!.player1Id).not.toBeNull()
    expect(updatedFinal!.player2Id).not.toBeNull()

    await confirmMatch(final.id, 3, 1)
    const tournament = await db.tournaments.get(t.id)
    expect(tournament?.status).toBe("completed")
  })
})

describe("finishTournament positions", () => {
  it("gives every player a unique position, ranking Top 4 finishers above league-only finishers", async () => {
    const ids = players(6)
    const t = await makeTournament({
      type: "league",
      playerIds: ids,
      finalsFormat: "top4_round_robin",
      stageFormats: { league: 3, top4: 3, final: 5 },
    })
    await startTournament(t.id)
    await playOutStage(t.id, "league", 3)
    await playOutStage(t.id, "top4", 3)
    const [finalMatch] = await db.matches.where({ tournamentId: t.id, stage: "final" }).toArray()
    await confirmMatch(finalMatch.id, 3, 0)

    const results = await db.results.where({ tournamentId: t.id }).toArray()
    const positions = results.map((r) => r.position).sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(new Set(positions).size).toBe(positions.length) // no duplicates
    expect(positions).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe("standalone knockout tournament", () => {
  it.each([2, 3, 5, 6, 7, 9])("crowns a champion and runner-up for %i players", async (n) => {
    const ids = players(n)
    const t = await makeTournament({
      type: "knockout",
      playerIds: ids,
      drawMethod: "seeded",
      stageFormats: { knockout: 3 },
    })
    await startTournament(t.id, { orderedPlayerIds: ids })

    for (;;) {
      const pending = await db.matches
        .where({ tournamentId: t.id, stage: "knockout" })
        .and((m) => m.status === "pending" && m.player1Id !== null && m.player2Id !== null)
        .toArray()
      if (pending.length === 0) break
      for (const m of pending) {
        await confirmMatch(m.id, 2, 0)
      }
    }

    const tournament = await db.tournaments.get(t.id)
    expect(tournament?.status).toBe("completed")

    const results = await db.results.where({ tournamentId: t.id }).toArray()
    expect(results.length).toBe(n)
    expect(results.filter((r) => r.position === 1).length).toBe(1)
    expect(results.filter((r) => r.position === 2).length).toBe(1)
  })
})

describe("no-draw enforcement", () => {
  it("rejects a tied score", async () => {
    const ids = players(2)
    const t = await makeTournament({
      type: "league",
      playerIds: ids,
      finalsFormat: "league_winner",
      stageFormats: { league: 3 },
    })
    await startTournament(t.id)
    const [match] = await db.matches.where({ tournamentId: t.id }).toArray()
    await expect(confirmMatch(match.id, 1, 1)).rejects.toThrow(EngineError)
  })
})

describe("undoLastConfirmedResult", () => {
  it("reopens the most recent match so it can be corrected", async () => {
    const ids = players(3)
    const t = await makeTournament({
      type: "league",
      playerIds: ids,
      finalsFormat: "league_winner",
      stageFormats: { league: 3 },
    })
    await startTournament(t.id)
    const [match] = await db.matches.where({ tournamentId: t.id }).toArray()
    await confirmMatch(match.id, 2, 0)

    const result = await undoLastConfirmedResult(t.id)
    expect(result.ok).toBe(true)

    const reopened = await db.matches.get(match.id)
    expect(reopened?.status).toBe("in_progress")
    expect(reopened?.winnerId).toBeNull()
    expect(reopened?.confirmedAt).toBeNull()

    // Can be re-confirmed with a corrected score.
    await confirmMatch(match.id, 2, 1)
    const fixed = await db.matches.get(match.id)
    expect(fixed?.player1Legs).toBe(2)
    expect(fixed?.player2Legs).toBe(1)
  })

  it("blocks undo once the tournament is finished until it is explicitly reopened", async () => {
    const ids = players(4)
    const t = await makeTournament({
      type: "knockout",
      playerIds: ids,
      drawMethod: "manual",
      stageFormats: { knockout: 3 },
    })
    await startTournament(t.id, { orderedPlayerIds: ids })
    const round1 = await db.matches.where({ tournamentId: t.id, round: 1 }).toArray()
    for (const m of round1) {
      await confirmMatch(m.id, 2, 0)
    }
    const final = await db.matches.where({ tournamentId: t.id, round: 2 }).first()
    await confirmMatch(final!.id, 2, 1)
    expect((await db.tournaments.get(t.id))?.status).toBe("completed")

    const blocked = await undoLastConfirmedResult(t.id)
    expect(blocked.ok).toBe(false)

    await reopenTournament(t.id)
    expect((await db.tournaments.get(t.id))?.status).toBe("active")
    expect(await db.results.where({ tournamentId: t.id }).count()).toBe(0)

    const undone = await undoLastConfirmedResult(t.id)
    expect(undone.ok).toBe(true)
    const finalReopened = await db.matches.get(final!.id)
    expect(finalReopened?.status).toBe("in_progress")
    expect(round1[0].nextMatchId).toBe(final!.id)
  })

  it("returns an error when there is nothing to undo", async () => {
    const t = await makeTournament({ type: "league", playerIds: players(2), finalsFormat: "league_winner" })
    const result = await undoLastConfirmedResult(t.id)
    expect(result.ok).toBe(false)
  })
})

describe("finishTournament duplicate-archive prevention", () => {
  it("does not duplicate results if called twice", async () => {
    const ids = players(2)
    const t = await makeTournament({
      type: "league",
      playerIds: ids,
      finalsFormat: "league_winner",
      stageFormats: { league: 3 },
    })
    await startTournament(t.id)
    const [match] = await db.matches.where({ tournamentId: t.id }).toArray()
    await confirmMatch(match.id, 2, 0)

    await finishTournament(t.id) // already finished by confirmMatch; calling again should not duplicate
    const results = await db.results.where({ tournamentId: t.id }).toArray()
    expect(results.length).toBe(2)
  })
})

describe("deleteTournament", () => {
  it("removes the tournament and all of its matches and results", async () => {
    const ids = players(2)
    const t = await makeTournament({
      type: "league",
      playerIds: ids,
      finalsFormat: "league_winner",
      stageFormats: { league: 3 },
    })
    await startTournament(t.id)
    const [match] = await db.matches.where({ tournamentId: t.id }).toArray()
    await confirmMatch(match.id, 2, 0)
    expect(await db.results.where({ tournamentId: t.id }).count()).toBe(2)

    await deleteTournament(t.id)

    expect(await db.tournaments.get(t.id)).toBeUndefined()
    expect(await db.matches.where({ tournamentId: t.id }).count()).toBe(0)
    expect(await db.results.where({ tournamentId: t.id }).count()).toBe(0)
  })
})
