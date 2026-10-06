import { db } from "./db"
import { isValidCompletedScore, legsToWin } from "./format"
import { generateKnockoutRound1, totalRounds as knockoutTotalRounds } from "./knockout"
import { computeStandings, generateRoundRobinFixtures } from "./roundRobin"
import type { BestOf, Match, Stage, Tournament, TournamentPlayerResult, TournamentWithdrawal } from "./types"

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

/** Stages that only exist because an earlier stage finished (used to roll
 * advancement back on undo, and to make advancement idempotent). */
const LATER_STAGES: Record<Stage, Stage[]> = {
  league: ["top4", "final", "knockout"],
  top4: ["final"],
  final: [],
  knockout: [],
}

async function laterStageMatchesExist(tournamentId: string, stage: Stage): Promise<boolean> {
  const later = LATER_STAGES[stage]
  if (later.length === 0) return false
  const count = await db.matches
    .where("tournamentId")
    .equals(tournamentId)
    .and((m) => later.includes(m.stage))
    .count()
  return count > 0
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

  // Idempotency guard: if the finals stage already exists (two tabs confirming
  // the last league match at once, or an earlier partial advance), building it
  // again would duplicate every match.
  if (tournament.finalsFormat !== "league_winner" && (await laterStageMatchesExist(tournament.id, "league"))) {
    return
  }

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
  if (await laterStageMatchesExist(tournament.id, "top4")) return
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

/** Must run inside a "rw" transaction covering matches/tournaments/results.
 * Applies a winner to the match, feeds the bracket forward, then runs the
 * stage-completion checks (advance the finals stage / finish the tournament).
 * Shared by confirmMatch and by walkover resolution (player withdrawals). */
async function completeMatchWithWinner(
  match: Match,
  winnerId: string,
  patch: { player1Legs: number; player2Legs: number; walkover?: boolean; confirmedAt: string | null },
): Promise<void> {
  const timestamp = nowISO()
  await db.matches.update(match.id, {
    ...patch,
    winnerId,
    status: "completed",
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
  } else if (match.stage === "knockout" && tournament.type === "knockout" && match.nextMatchId === null) {
    // Standalone knockout tournament: no next match means this was the final.
    await finishTournament(tournament.id)
  } else if (match.stage === "knockout" && tournament.type === "league" && match.nextMatchId === null) {
    // top4_knockout finals: the mini-bracket's final has no next match.
    await finishTournament(tournament.id)
  }
}

export async function confirmMatch(matchId: string, player1Legs: number, player2Legs: number): Promise<void> {
  const timestamp = nowISO()

  // The match is read *inside* the transaction so two tabs confirming at the
  // same time can't both pass the "still pending" check and double-advance.
  await db.transaction("rw", db.matches, db.tournaments, db.results, async () => {
    const match = await db.matches.get(matchId)
    if (!match) throw new EngineError("Match not found")
    if (match.status === "completed") throw new EngineError("Match already confirmed")
    if (!match.player1Id || !match.player2Id) throw new EngineError("Match is not ready (missing a player)")
    if (!isValidCompletedScore(match.bestOf, player1Legs, player2Legs)) {
      throw new EngineError(`Invalid score for best of ${match.bestOf} (first to ${match.legsToWin})`)
    }

    const winnerId = player1Legs > player2Legs ? match.player1Id : match.player2Id
    await completeMatchWithWinner(match, winnerId, { player1Legs, player2Legs, confirmedAt: timestamp })
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
  const withdrawnIds = new Set((tournament.withdrawals ?? []).map((w) => w.playerId))
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
    withdrawn: withdrawnIds.has(playerId),
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

const STAGE_NAME: Record<Stage, string> = {
  league: "League",
  top4: "Top 4",
  final: "Final",
  knockout: "Knockout",
}

/** First match of a stage that exists *after* `stage` in the tournament flow
 * that has already been started or confirmed. Re-generating that stage would
 * silently corrupt results the organiser already entered — callers must refuse
 * instead of rolling back. */
async function firstStartedLaterMatch(tournamentId: string, stage: Stage): Promise<Match | null> {
  const later = LATER_STAGES[stage]
  if (later.length === 0) return null
  const blocking = await db.matches
    .where("tournamentId")
    .equals(tournamentId)
    .and((m) => later.includes(m.stage) && m.status !== "pending")
    .first()
  return blocking ?? null
}

/** Drops the not-yet-played matches of the stages that only exist because
 * `stage` was complete, so the next confirmation regenerates them from the
 * current table instead of duplicating them. Callers must have checked with
 * `firstStartedLaterMatch` that nothing there has been played yet. Must run
 * inside a transaction that owns db.matches. */
async function rollbackLaterStages(tournamentId: string, stage: Stage): Promise<void> {
  const later = LATER_STAGES[stage]
  if (later.length === 0) return
  await db.matches
    .where("tournamentId")
    .equals(tournamentId)
    .and((m) => later.includes(m.stage) && m.status === "pending")
    .delete()
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

  const blocking = await firstStartedLaterMatch(tournamentId, match.stage)
  if (blocking) {
    return {
      ok: false,
      reason: `Cannot undo: the ${STAGE_NAME[blocking.stage]} stage was built from a completed ${STAGE_NAME[match.stage]} table and has already started. Undo or reset those results first.`,
    }
  }

  const timestamp = nowISO()
  await db.transaction("rw", db.matches, async () => {
    // Score goes back to 0–0 (same as a match reset) so the scoring screen
    // reopens clean instead of "decided" with the old, wrong score.
    await db.matches.update(match.id, {
      status: "pending",
      player1Legs: 0,
      player2Legs: 0,
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
    if (!(await allMatchesInStageCompleted(tournamentId, match.stage))) {
      await rollbackLaterStages(tournamentId, match.stage)
    }
  })

  return { ok: true }
}

export function withdrawnPlayerIds(tournament: Tournament): string[] {
  return (tournament.withdrawals ?? []).map((w) => w.playerId)
}

/** Marks a player as having quit mid-tournament. Results they already
 * earned stay on the board; every match they haven't finished yet is awarded
 * to the opponent as a walkover (0–0, no legs) so brackets and tables keep
 * moving. Reversible with rejoinPlayer while the tournament is active. */
export async function withdrawPlayer(tournamentId: string, playerId: string): Promise<UndoResult> {
  const tournament = await db.tournaments.get(tournamentId)
  if (!tournament) return { ok: false, reason: "Tournament not found" }
  if (tournament.status !== "active") {
    return { ok: false, reason: "Players can only withdraw while the tournament is active." }
  }
  if (!tournament.playerIds.includes(playerId)) {
    return { ok: false, reason: "Player is not in this tournament" }
  }
  if ((tournament.withdrawals ?? []).some((w) => w.playerId === playerId)) {
    return { ok: false, reason: "Player has already withdrawn" }
  }

  const unfinished = await db.matches
    .where({ tournamentId })
    .and((m) => m.status !== "completed" && (m.player1Id === playerId || m.player2Id === playerId))
    .toArray()

  const withdrawal: TournamentWithdrawal = {
    playerId,
    at: nowISO(),
    matches: unfinished.map((m) => ({
      id: m.id,
      previousStatus: m.status,
      player1Legs: m.player1Legs,
      player2Legs: m.player2Legs,
    })),
  }

  await db.transaction("rw", db.tournaments, db.matches, db.results, async () => {
    const current = await db.tournaments.get(tournamentId)
    if (!current) return
    await db.tournaments.update(tournamentId, {
      withdrawals: [...(current.withdrawals ?? []), withdrawal],
      updatedAt: nowISO(),
    })
    for (const m of unfinished) {
      const opponentId = m.player1Id === playerId ? m.player2Id : m.player1Id
      if (!opponentId) continue
      await completeMatchWithWinner(m, opponentId, {
        player1Legs: 0,
        player2Legs: 0,
        walkover: true,
        // Walkovers are never "undo" targets — rejoining is how they revert.
        confirmedAt: null,
      })
    }
  })

  return { ok: true }
}

/** Undoes a withdrawal: every match it resolved goes back to exactly how it
 * was (including a half-played score), and any finals stage generated from a
 * table that is no longer complete is removed so it regenerates correctly. */
export async function rejoinPlayer(tournamentId: string, playerId: string): Promise<UndoResult> {
  const tournament = await db.tournaments.get(tournamentId)
  if (!tournament) return { ok: false, reason: "Tournament not found" }
  const withdrawal = (tournament.withdrawals ?? []).find((w) => w.playerId === playerId)
  if (!withdrawal) return { ok: false, reason: "Player has not withdrawn from this tournament" }
  if (tournament.status === "completed") {
    return { ok: false, reason: "Cannot rejoin: this tournament is finished. Reopen it first." }
  }

  const all = await db.matches.where({ tournamentId }).toArray()
  const toRevert = withdrawal.matches
    .map((s) => ({ snapshot: s, match: all.find((m) => m.id === s.id) }))
    .filter((x): x is { snapshot: (typeof withdrawal.matches)[number]; match: Match } => x.match !== undefined)

  const affectedStages = new Set<Stage>()
  for (const { match } of toRevert) {
    affectedStages.add(match.stage)
    if (match.nextMatchId) {
      const next = all.find((m) => m.id === match.nextMatchId)
      if (next && next.status === "completed") {
        return {
          ok: false,
          reason: "Cannot rejoin: an opponent already advanced from this walkover and has since confirmed another result. Undo that result first.",
        }
      }
    }
  }
  for (const stage of affectedStages) {
    const blocking = await firstStartedLaterMatch(tournamentId, stage)
    if (blocking) {
      return {
        ok: false,
        reason: `Cannot rejoin: the ${STAGE_NAME[blocking.stage]} stage has already started. Undo or reset those results first.`,
      }
    }
  }

  const timestamp = nowISO()
  await db.transaction("rw", db.tournaments, db.matches, async () => {
    for (const { snapshot, match } of toRevert) {
      await db.matches.update(snapshot.id, {
        status: snapshot.previousStatus,
        player1Legs: snapshot.player1Legs,
        player2Legs: snapshot.player2Legs,
        winnerId: null,
        confirmedAt: null,
        walkover: false,
        updatedAt: timestamp,
      })
      if (match.nextMatchId && match.nextMatchSlot) {
        await db.matches.update(match.nextMatchId, {
          [match.nextMatchSlot === 1 ? "player1Id" : "player2Id"]: null,
          updatedAt: timestamp,
        })
      }
    }
    for (const stage of affectedStages) {
      if (!(await allMatchesInStageCompleted(tournamentId, stage))) {
        await rollbackLaterStages(tournamentId, stage)
      }
    }
    const current = await db.tournaments.get(tournamentId)
    if (!current) return
    await db.tournaments.update(tournamentId, {
      withdrawals: (current.withdrawals ?? []).filter((w) => w.playerId !== playerId),
      updatedAt: timestamp,
    })
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
