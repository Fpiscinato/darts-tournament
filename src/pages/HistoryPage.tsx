import { useLiveQuery } from "dexie-react-hooks"
import { Link } from "react-router-dom"
import { db } from "@/lib/db"
import { computeAllTimeRanking } from "@/lib/ranking"
import { Badge } from "@/components/ui/badge"

export function HistoryPage() {
  const results = useLiveQuery(() => db.results.toArray(), [])
  const players = useLiveQuery(() => db.players.toArray(), [])
  const tournaments = useLiveQuery(
    () => db.tournaments.where("status").equals("completed").reverse().sortBy("completedAt"),
    [],
  )

  if (!results || !players || !tournaments) return null

  const ranking = computeAllTimeRanking(results)
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?"

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">History</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">All-time ranking</h2>
        {ranking.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed tournaments yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2 text-right">Titles</th>
                  <th className="px-3 py-2 text-right">Match W-L</th>
                  <th className="px-3 py-2 text-right">Win %</th>
                  <th className="px-3 py-2 text-right">Leg Diff</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((row, i) => (
                  <tr key={row.playerId} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{nameOf(row.playerId)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.titles}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.totalMatchWins}-{row.totalMatchLosses}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round(row.winRate * 100)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.legDiff > 0 ? `+${row.legDiff}` : row.legDiff}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Finished tournaments</h2>
        {tournaments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {tournaments.map((t) => (
              <Link
                key={t.id}
                to={`/tournaments/${t.id}`}
                className="flex min-h-11 items-center justify-between rounded-lg border border-border px-4 py-3 hover:bg-muted"
              >
                <span className="font-medium">{t.name}</span>
                <Badge variant="outline">{t.type === "league" ? "League" : "Knockout"}</Badge>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
