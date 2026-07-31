import { db } from "./db"
import { isValidCompletedScore, legsToWin } from "./format"
import { generateKnockoutRound1, totalRounds as knockoutTotalRounds } from "./knockout"
import { computeStandings, generateRoundRobinFixtures } from "./roundRobin"
import type { BestOf, Match, Stage, Tournament, TournamentPlayerResult } from "./types"

export class EngineError extends Error {}

function uid(): string {
  return crypto.randomUUID()
}

function nowISO(): string {
  return new Date().toISOString()
}

interface BuildMatchInput {
  tournamentId: string
  stage: Stage
  round: number
  bracketPosition: number
  player1Id: string | null
  player2Id: string | null
  bestOf: BestOf
}

function buildMatch(input: BuildMatchInput): Match {
  const bothPresent = input.player1Id !== null && input.player2Id !== null
  const bothAbsent = input.player1Id === null && input.player2Id === null
  const isBye = !bothPresent && !bothAbsent
  const winnerId = isBye ? (input.player1Id ?? input.player2Id) : null
  const timestamp = nowISO()
  return {
    id: uid(),
    tournamentId: input.tournamentId,
    stage: input.stage,
    round: input.round,
    bracketPosition: input.bracketPosition,
    player1Id: input.player1Id,
    player2Id: input.player2Id,
    player1Legs: 0,
    player2Legs: 0,
    winnerId,
    status: isBye ? "completed" : "pending",
    bestOf: input.bestOf,
    legsToWin: legsToWin(input.bestOf),
    nextMatchId: null,
    nextMatchSlot: null,
    confirmedAt: isBye ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function buildLeagueMatches(tournamentId: string, playerIds: string[], bestOf: BestOf): Match[] {
  const fixtures = generateRoundRobinFixtures(playerIds)
  return fixtures.map((f, i) =>
    buildMatch({
      tournamentId,
      stage: "league",
      round: f.round,
      bracketPosition: i + 1,
      player1Id: f.player1Id,
      player2Id: f.player2Id,
      bestOf,
    }),
  )
}

export function buildTop4Matches(tournamentId: string, top4PlayerIds: string[], bestOf: BestOf): Match[] {
  const fixtures = generateRoundRobinFixtures(top4PlayerIds)
  return fixtures.map((f, i) =>
    buildMatch({
      tournamentId,
      stage: "top4",
      round: f.round,
      bracketPosition: i + 1,
      player1Id: f.player1Id,
      player2Id: f.player2Id,
      bestOf,
    }),
  )
}

export function buildFinalMatch(tournamentId: string, player1Id: string, player2Id: string, bestOf: BestOf): Match {
  return buildMatch({
    tournamentId,
    stage: "final",
    round: 1,
    bracketPosition: 1,
    player1Id,
    player2Id,
    bestOf,
  })
}

/** orderedPlayerIds must already reflect the desired seed order (random
 * shuffle, seed-sort, or manual order — decided by the caller/UI).
 * `bestOf` may be a single format for the whole bracket, or a function of
 * (round, totalRounds) for brackets whose final uses a different format
 * than earlier rounds (e.g. the Top 4 Knockout finals format: bo3 semis,
 * bo5 final). */
export function buildKnockoutMatches(
  tournamentId: string,
  orderedPlayerIds: string[],
  bestOf: BestOf | ((round: number, totalRounds: number) => BestOf),
): Match[] {
  const rounds = knockoutTotalRounds(orderedPlayerIds.length)
  const bestOfForRound = typeof bestOf === "function" ? bestOf : () => bestOf
  const round1Seeds = generateKnockoutRound1(orderedPlayerIds)
  const matches: Match[] = []
  const byRoundPos = new Map<string, Match>()

  for (const seed of round1Seeds) {
    const m = buildMatch({
      tournamentId,
      stage: "knockout",
      round: 1,
      bracketPosition: seed.bracketPosition,
      player1Id: seed.player1Id,
      player2Id: seed.player2Id,
      bestOf: bestOfForRound(1, rounds),
    })
    matches.push(m)
    byRoundPos.set(`1:${seed.bracketPosition}`, m)
  }

  for (let round = 2; round <= rounds; round++) {
    const count = 2 ** (rounds - round)
    for (let pos = 1; pos <= count; pos++) {
      const m = buildMatch({
        tournamentId,
        stage: "knockout",
        round,
        bracketPosition: pos,
        player1Id: null,
        player2Id: null,
        bestOf: bestOfForRound(round, rounds),
      })
      matches.push(m)
      byRoundPos.set(`${round}:${pos}`, m)
    }
  }

  // Wire next-match links and propagate round-1 bye winners forward. Byes
  // can never appear in round 2+ (every round-1 match has >=1 real player,
  // so it always resolves to exactly one winner — see knockout.ts).
  for (let round = 1; round < rounds; round++) {
    const count = 2 ** (rounds - round)
    for (let pos = 1; pos <= count; pos++) {
      const m = byRoundPos.get(`${round}:${pos}`)!
      const nextPos = Math.ceil(pos / 2)
      const next = byRoundPos.get(`${round + 1}:${nextPos}`)!
      const slot: 1 | 2 = pos % 2 === 1 ? 1 : 2
      m.nextMatchId = next.id
      m.nextMatchSlot = slot
      if (m.status === "completed" && m.winnerId) {
        if (slot === 1) next.player1Id = m.winnerId
        else next.player2Id = m.winnerId
      }
    }
  }

  return matches
}

/** Reduces a "random" / "seeded" / "manual" draw method down to the ordered
 * player list a knockout bracket needs (seed 1 first). Manual draw methods
 * use the order the UI already collected the player list in. */
export function orderPlayersForDraw(
  playerIds: string[],
  method: "random" | "seeded" | "manual",
  seedLookup?: (id: string) => number | null,
): string[] {
  if (method === "manual") return [...playerIds]
  if (method === "random") {
    const arr = [...playerIds]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
  return [...playerIds].sort((a, b) => {
    const sa = seedLookup?.(a) ?? Number.POSITIVE_INFINITY
    const sb = seedLookup?.(b) ?? Number.POSITIVE_INFINITY
    return sa - sb
  })
}

export interface StartTournamentOptions {
  /** Required for knockout tournaments: seed order decided by the UI. */
  orderedPlayerIds?: string[]
}

export async function startTournament(tournamentId: string, options: StartTournamentOptions = {}): Promise<void> {
  const tournament = await db.tournaments.get(tournamentId)
  if (!tournament) throw new EngineError("Tournament not found")
  if (tournament.status !== "draft") throw new EngineError("Tournament already started")

  let matches: Match[]
  if (tournament.type === "league") {
    const bestOf = tournament.stageFormats.league ?? 3
    matches = buildLeagueMatches(tournament.id, tournament.playerIds, bestOf)
  } else {
    const bestOf = tournament.stageFormats.knockout ?? 5
    const order = options.orderedPlayerIds ?? tournament.playerIds
    matches = buildKnockoutMatches(tournament.id, order, bestOf)
  }

  await db.transaction("rw", db.tournaments, db.matches, async () => {
    await db.matches.bulkAdd(matches)
    await db.tournaments.update(tournamentId, {
      status: "active",
      startedAt: nowISO(),
      updatedAt: nowISO(),
    })
  })
}

async function allMatchesInStageCompleted(tournamentId: string, stage: Stage): Promise<boolean> {
  const stageMatches = await db.matches
    .where("tournamentId")
    .equals(tournamentId)
    .and((m) => m.stage === stage)
    .toArray()
  if (stageMatches.length === 0) return false
  return stageMatches.every((m) => m.status === "completed")
}

/** Called after a league (or top4) stage finishes, to build whichever
 * finals stage the tournament's finalsFormat calls for — or to finish the
 * tournament outright for "league_winner". */
async function advanceLeagueStage(tournament: Tournament): Promise<void> {
  const leagueMatches = await db.matches
    .where("tournamentId")
    .equals(tournament.id)
    .and((m) => m.stage === "league")
    .toArray()
  const standings = computeStandings(tournament.playerIds, leagueMatches)

  switch (tournament.finalsFormat) {
    case "league_winner": {
      await finishTournament(tournament.id)
      return
    }
    case "direct_final": {
      const [p1, p2] = standings
      const bestOf = tournament.stageFormats.final ?? 5
      await db.matches.add(buildFinalMatch(tournament.id, p1.playerId, p2.playerId, bestOf))
      return
    }
    case "top4_round_robin": {
      const top4 = standings.slice(0, 4).map((r) => r.playerId)
      const bestOf = tournament.stageFormats.top4 ?? 3
      const matches = buildTop4Matches(tournament.id, top4, bestOf)
      await db.matches.bulkAdd(matches)
      return
    }
    case "top4_knockout": {
      const top4 = standings.slice(0, 4).map((r) => r.playerId)
      const semiBestOf = tournament.stageFormats.top4 ?? 3
      const finalBestOf = tournament.stageFormats.final ?? 5
      // Seed within the mini-bracket so seed 1 (table leader) and seed 2
      // land in opposite halves: 1v4 and 2v3. Semis use the Top 4 format,
      // the mini-bracket's final (last round) uses the Final format.
      const matches = buildKnockoutMatches(tournament.id, top4, (round, totalRoundsCount) =>
        round === totalRoundsCount ? finalBestOf : semiBestOf,
      )
      await db.matches.bulkAdd(matches)
      return
    }
  }
}

async function advanceTop4Stage(tournament: Tournament): Promise<void> {
  const top4Matches = await db.matches
    .where("tournamentId")
    .equals(tournament.id)
    .and((m) => m.stage === "top4")
    .toArray()
  const top4PlayerIds = Array.from(
    new Set(top4Matches.flatMap((m) => [m.player1Id, m.player2Id].filter((x): x is string => x !== null))),
  )
  const standings = computeStandings(top4PlayerIds, top4Matches)
  const [p1, p2] = standings
  const bestOf = tournament.stageFormats.final ?? 5
  await db.matches.add(buildFinalMatch(tournament.id, p1.playerId, p2.playerId, bestOf))
}

export async function confirmMatch(matchId: string, player1Legs: number, player2Legs: number): Promise<void> {
  const match = await db.matches.get(matchId)
  if (!match) throw new EngineError("Match not found")
  if (match.status === "completed") throw new EngineError("Match already confirmed")
  if (!match.player1Id || !match.player2Id) throw new EngineError("Match is not ready (missing a player)")
  if (!isValidCompletedScore(match.bestOf, player1Legs, player2Legs)) {
    throw new EngineError(`Invalid score for best of ${match.bestOf} (first to ${match.legsToWin})`)
  }

  const winnerId = player1Legs > player2Legs ? match.player1Id : match.player2Id
  const timestamp = nowISO()

  await db.transaction("rw", db.matches, db.tournaments, db.results, async () => {
    await db.matches.update(matchId, {
      player1Legs,
      player2Legs,
      winnerId,
      status: "completed",
      confirmedAt: timestamp,
      updatedAt: timestamp,
    })

    if (match.nextMatchId && match.nextMatchSlot) {
      await db.matches.update(match.nextMatchId, {
        [match.nextMatchSlot === 1 ? "player1Id" : "player2Id"]: winnerId,
        updatedAt: timestamp,
      })
    }

    const tournament = await db.tournaments.get(match.tournamentId)
    if (!tournament) return

    if (match.stage === "league" && (await allMatchesInStageCompleted(tournament.id, "league"))) {
      await advanceLeagueStage(tournament)
    } else if (match.stage === "top4" && (await allMatchesInStageCompleted(tournament.id, "top4"))) {
      await advanceTop4Stage(tournament)
    } else if (match.stage === "final") {
      await finishTournament(tournament.id)
    } else if (
      match.stage === "knockout" &&
      tournament.type === "knockout" &&
      match.nextMatchId === null
    ) {
      // Standalone knockout tournament: no next match means this was the final.
      await finishTournament(tournament.id)
    } else if (
      match.stage === "knockout" &&
      tournament.type === "league" &&
      match.nextMatchId === null
    ) {
      // top4_knockout finals: the mini-bracket's final has no next match.
      await finishTournament(tournament.id)
    }
  })
}

export async function finishTournament(tournamentId: string): Promise<void> {
  const tournament = await db.tournaments.get(tournamentId)
  if (!tournament) return

  const allMatches = await db.matches.where({ tournamentId }).toArray()
  const wins = new Map<string, number>()
  const losses = new Map<string, number>()
  const legsFor = new Map<string, number>()
  const legsAgainst = new Map<string, number>()
  for (const id of tournament.playerIds) {
    wins.set(id, 0)
    losses.set(id, 0)
    legsFor.set(id, 0)
    legsAgainst.set(id, 0)
  }
  for (const m of allMatches) {
    if (m.status !== "completed" || !m.player1Id || !m.player2Id) continue
    legsFor.set(m.player1Id, (legsFor.get(m.player1Id) ?? 0) + m.player1Legs)
    legsAgainst.set(m.player1Id, (legsAgainst.get(m.player1Id) ?? 0) + m.player2Legs)
    legsFor.set(m.player2Id, (legsFor.get(m.player2Id) ?? 0) + m.player2Legs)
    legsAgainst.set(m.player2Id, (legsAgainst.get(m.player2Id) ?? 0) + m.player1Legs)
    if (m.winnerId) {
      wins.set(m.winnerId, (wins.get(m.winnerId) ?? 0) + 1)
      const loserId = m.winnerId === m.player1Id ? m.player2Id : m.player1Id
      losses.set(loserId, (losses.get(loserId) ?? 0) + 1)
    }
  }

  const finalMatch = allMatches.find((m) => m.stage === "final")
  const knockoutFinal = allMatches.find(
    (m) => m.stage === "knockout" && m.nextMatchId === null && m.status === "completed",
  )
  const decidingMatch = finalMatch ?? knockoutFinal
  const championId = decidingMatch?.winnerId ?? null
  const runnerUpId = decidingMatch
    ? decidingMatch.winnerId === decidingMatch.player1Id
      ? decidingMatch.player2Id
      : decidingMatch.player1Id
    : null

  const leagueMatches = allMatches.filter((m) => m.stage === "league")
  const leagueStandings = leagueMatches.length > 0 ? computeStandings(tournament.playerIds, leagueMatches) : []

  // Positions 3+ go to whoever didn't reach the decider. Rank them by the
  // furthest stage they reached (the Top 4 stage / mini-bracket outranks
  // pure league standings), not by their original league-table slot — a
  // player can climb from a middling league finish into a real semi-final.
  const top4StageMatches = allMatches.filter(
    (m) => m.stage === "top4" || (m.stage === "knockout" && tournament.type === "league"),
  )
  const top4StagePlayerIds = Array.from(
    new Set(top4StageMatches.flatMap((m) => [m.player1Id, m.player2Id]).filter((x): x is string => x !== null)),
  )
  const top4Standings = top4StageMatches.length > 0 ? computeStandings(top4StagePlayerIds, top4StageMatches) : []

  const remaining = tournament.playerIds.filter((id) => id !== championId && id !== runnerUpId)
  const rankKey = (playerId: string): [number, number] => {
    const top4Idx = top4Standings.findIndex((r) => r.playerId === playerId)
    if (top4Idx !== -1) return [0, top4Idx]
    const leagueIdx = leagueStandings.findIndex((r) => r.playerId === playerId)
    return [1, leagueIdx === -1 ? Number.MAX_SAFE_INTEGER : leagueIdx]
  }
  const rankedRemaining = [...remaining].sort((a, b) => {
    const [tierA, idxA] = rankKey(a)
    const [tierB, idxB] = rankKey(b)
    return tierA - tierB || idxA - idxB
  })
  const positionByPlayer = new Map(rankedRemaining.map((playerId, i) => [playerId, i + 3]))

  const timestamp = nowISO()
  const results: TournamentPlayerResult[] = tournament.playerIds.map((playerId) => ({
    id: uid(),
    tournamentId,
    playerId,
    position:
      championId === playerId ? 1 : runnerUpId === playerId ? 2 : (positionByPlayer.get(playerId) ?? null),
    matchWins: wins.get(playerId) ?? 0,
    matchLosses: losses.get(playerId) ?? 0,
    points: (wins.get(playerId) ?? 0) * 2,
    legsFor: legsFor.get(playerId) ?? 0,
    legsAgainst: legsAgainst.get(playerId) ?? 0,
    playoffRequired: leagueStandings.find((r) => r.playerId === playerId)?.playoffRequired ?? false,
    titleWon: championId === playerId,
    createdAt: timestamp,
  }))

  await db.results.where({ tournamentId }).delete()
  await db.results.bulkAdd(results)
  await db.tournaments.update(tournamentId, {
    status: "completed",
    completedAt: timestamp,
    updatedAt: timestamp,
  })
}

export interface UndoResult {
  ok: boolean
  reason?: string
}

/** Reopens the most recently confirmed match in a tournament, recalculating
 * bracket/table state. If a dependent later match is already confirmed,
 * refuses and explains why rather than silently corrupting state. */
export async function undoLastConfirmedResult(tournamentId: string): Promise<UndoResult> {
  const tournament = await db.tournaments.get(tournamentId)
  if (!tournament) return { ok: false, reason: "Tournament not found" }

  const completed = await db.matches
    .where({ tournamentId })
    .and((m) => m.status === "completed" && m.confirmedAt !== null && m.player1Id !== null && m.player2Id !== null)
    .toArray()
  if (completed.length === 0) return { ok: false, reason: "No confirmed results to undo" }

  completed.sort((a, b) => (b.confirmedAt! > a.confirmedAt! ? 1 : -1))
  const match = completed[0]

  if (match.nextMatchId) {
    const next = await db.matches.get(match.nextMatchId)
    if (next && next.status === "completed") {
      return { ok: false, reason: "Cannot undo: the next match already has a confirmed result. Undo that one first." }
    }
  }

  if (tournament.status === "completed") {
    return { ok: false, reason: "Cannot undo: this tournament is finished. Reopen it first." }
  }

  const timestamp = nowISO()
  await db.transaction("rw", db.matches, async () => {
    await db.matches.update(match.id, {
      status: "in_progress",
      winnerId: null,
      confirmedAt: null,
      updatedAt: timestamp,
    })
    if (match.nextMatchId && match.nextMatchSlot) {
      await db.matches.update(match.nextMatchId, {
        [match.nextMatchSlot === 1 ? "player1Id" : "player2Id"]: null,
        updatedAt: timestamp,
      })
    }
  })

  return { ok: true }
}

export async function reopenTournament(tournamentId: string): Promise<void> {
  await db.transaction("rw", db.tournaments, db.results, async () => {
    await db.results.where({ tournamentId }).delete()
    await db.tournaments.update(tournamentId, {
      status: "active",
      completedAt: null,
      updatedAt: nowISO(),
    })
  })
}

/** Permanently deletes a tournament along with all of its matches and
 * results. Irreversible — the caller is responsible for confirming with
 * the user first. */
export async function deleteTournament(tournamentId: string): Promise<void> {
  await db.transaction("rw", db.tournaments, db.matches, db.results, async () => {
    await db.matches.where({ tournamentId }).delete()
    await db.results.where({ tournamentId }).delete()
    await db.tournaments.delete(tournamentId)
  })
}
