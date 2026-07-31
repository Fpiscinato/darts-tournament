import type { Match } from "./types"

export interface RoundRobinFixture {
  round: number
  player1Id: string
  player2Id: string
}

const BYE = "__BYE__"

/** Circle method: every player meets every other exactly once. For odd
 * counts a phantom BYE seat is added and rotated along with everyone else,
 * so each real player sits out exactly one round — no player is favored. */
export function generateRoundRobinFixtures(playerIds: string[]): RoundRobinFixture[] {
  if (playerIds.length < 2) return []

  const arr: string[] = [...playerIds]
  if (arr.length % 2 !== 0) arr.push(BYE)

  const n = arr.length
  const rounds = n - 1
  const half = n / 2
  const fixtures: RoundRobinFixture[] = []

  for (let round = 1; round <= rounds; round++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i]
      const b = arr[n - 1 - i]
      if (a !== BYE && b !== BYE) {
        fixtures.push({ round, player1Id: a, player2Id: b })
      }
    }
    const fixed = arr[0]
    const rest = arr.slice(1)
    const last = rest.pop()!
    rest.unshift(last)
    arr.splice(0, arr.length, fixed, ...rest)
  }

  return fixtures
}

export interface StandingRow {
  playerId: string
  played: number
  wins: number
  losses: number
  points: number
  legsFor: number
  legsAgainst: number
  legDiff: number
  playoffRequired: boolean
}

function headToHeadWinner(p1: string, p2: string, matches: Match[]): string | null {
  const m = matches.find(
    (m) =>
      m.status === "completed" &&
      ((m.player1Id === p1 && m.player2Id === p2) || (m.player1Id === p2 && m.player2Id === p1)),
  )
  return m?.winnerId ?? null
}

function resolveTieGroup(rows: StandingRow[], matches: Match[]): StandingRow[] {
  if (rows.length === 1) return rows

  const byStats = [...rows].sort((a, b) => b.legDiff - a.legDiff || b.legsFor - a.legsFor)
  const subgroups: StandingRow[][] = []
  for (const row of byStats) {
    const last = subgroups[subgroups.length - 1]
    if (last && last[0].legDiff === row.legDiff && last[0].legsFor === row.legsFor) {
      last.push(row)
    } else {
      subgroups.push([row])
    }
  }

  const out: StandingRow[] = []
  for (const sub of subgroups) {
    if (sub.length === 1) {
      out.push(sub[0])
      continue
    }
    if (sub.length === 2) {
      const winner = headToHeadWinner(sub[0].playerId, sub[1].playerId, matches)
      if (winner) {
        out.push(...(winner === sub[0].playerId ? sub : [sub[1], sub[0]]))
        continue
      }
    }
    // Unresolved (3+ way tie, or no head-to-head result yet): flag it rather
    // than silently falling back to alphabetical order. Players who haven't
    // played any matches yet are trivially "tied" at 0-0 — that's just the
    // start of the tournament, not a deadlock worth flagging.
    for (const r of sub) {
      if (r.played > 0) r.playoffRequired = true
    }
    out.push(...sub)
  }
  return out
}

/** Points: win = 2, loss = 0 (no draws possible). Tie-break cascade:
 * Points -> Leg Diff -> Legs For -> Head-to-Head -> Play-off Required flag. */
export function computeStandings(playerIds: string[], matches: Match[]): StandingRow[] {
  const rows = new Map<string, StandingRow>()
  for (const id of playerIds) {
    rows.set(id, {
      playerId: id,
      played: 0,
      wins: 0,
      losses: 0,
      points: 0,
      legsFor: 0,
      legsAgainst: 0,
      legDiff: 0,
      playoffRequired: false,
    })
  }

  for (const m of matches) {
    if (m.status !== "completed" || !m.player1Id || !m.player2Id) continue
    const r1 = rows.get(m.player1Id)
    const r2 = rows.get(m.player2Id)
    if (!r1 || !r2) continue
    r1.played++
    r2.played++
    r1.legsFor += m.player1Legs
    r1.legsAgainst += m.player2Legs
    r2.legsFor += m.player2Legs
    r2.legsAgainst += m.player1Legs
    if (m.winnerId === m.player1Id) {
      r1.wins++
      r1.points += 2
      r2.losses++
    } else if (m.winnerId === m.player2Id) {
      r2.wins++
      r2.points += 2
      r1.losses++
    }
  }

  for (const r of rows.values()) r.legDiff = r.legsFor - r.legsAgainst

  const sorted = Array.from(rows.values()).sort((a, b) => b.points - a.points)
  const groups: StandingRow[][] = []
  for (const row of sorted) {
    const last = groups[groups.length - 1]
    if (last && last[0].points === row.points) {
      last.push(row)
    } else {
      groups.push([row])
    }
  }

  return groups.flatMap((group) => resolveTieGroup(group, matches))
}
