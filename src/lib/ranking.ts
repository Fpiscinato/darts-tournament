import type { TournamentPlayerResult } from "./types"

export interface AllTimeRankingRow {
  playerId: string
  titles: number
  tournamentWins: number
  totalMatchWins: number
  totalMatchLosses: number
  winRate: number
  legDiff: number
  totalPoints: number
  tournamentsPlayed: number
}

/** Sort cascade: Titles -> Tournament Wins -> Total Match Wins -> Win Rate
 * -> Leg Difference -> Total Tournament Points. */
export function computeAllTimeRanking(results: TournamentPlayerResult[]): AllTimeRankingRow[] {
  const byPlayer = new Map<string, AllTimeRankingRow>()

  for (const r of results) {
    const row = byPlayer.get(r.playerId) ?? {
      playerId: r.playerId,
      titles: 0,
      tournamentWins: 0,
      totalMatchWins: 0,
      totalMatchLosses: 0,
      winRate: 0,
      legDiff: 0,
      totalPoints: 0,
      tournamentsPlayed: 0,
    }
    row.tournamentsPlayed++
    if (r.titleWon) row.titles++
    if (r.position === 1) row.tournamentWins++
    row.totalMatchWins += r.matchWins
    row.totalMatchLosses += r.matchLosses
    row.legDiff += r.legsFor - r.legsAgainst
    row.totalPoints += r.points
    byPlayer.set(r.playerId, row)
  }

  const rows = Array.from(byPlayer.values()).map((row) => {
    const totalMatches = row.totalMatchWins + row.totalMatchLosses
    return { ...row, winRate: totalMatches > 0 ? row.totalMatchWins / totalMatches : 0 }
  })

  return rows.sort(
    (a, b) =>
      b.titles - a.titles ||
      b.tournamentWins - a.tournamentWins ||
      b.totalMatchWins - a.totalMatchWins ||
      b.winRate - a.winRate ||
      b.legDiff - a.legDiff ||
      b.totalPoints - a.totalPoints,
  )
}
