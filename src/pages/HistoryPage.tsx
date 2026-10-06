import { useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Link } from "react-router-dom"
import { Share2 } from "lucide-react"
import { db } from "@/lib/db"
import { computeAllTimeRanking } from "@/lib/ranking"
import type { Tournament } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ShareDialog } from "@/components/darts/ShareDialog"
import { PageSkeleton } from "@/components/darts/PageSkeleton"

export function HistoryPage() {
  const results = useLiveQuery(() => db.results.toArray(), [])
  const players = useLiveQuery(() => db.players.toArray(), [])
  const tournaments = useLiveQuery(
    () => db.tournaments.where("status").equals("completed").reverse().sortBy("completedAt"),
    [],
  )
  const [shareTournament, setShareTournament] = useState<Tournament | null>(null)

  if (!results || !players || !tournaments) return <PageSkeleton rows={4} className="mx-auto max-w-2xl px-4 py-6" />

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
              <caption className="sr-only">All-time ranking</caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="px-3 py-2">#</th>
                  <th scope="col" className="px-3 py-2">Player</th>
                  <th scope="col" className="px-3 py-2 text-right">Titles</th>
                  <th scope="col" className="px-3 py-2 text-right">Match W-L</th>
                  <th scope="col" className="px-3 py-2 text-right">Win %</th>
                  <th scope="col" className="px-3 py-2 text-right">Leg Diff</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((row, i) => (
                  <tr key={row.playerId} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{nameOf(row.playerId)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.titles}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{row.totalMatchWins}</span>
                      -
                      <span className="font-semibold text-red-600 dark:text-red-400">{row.totalMatchLosses}</span>
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
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 transition-colors hover:bg-muted"
              >
                <Link to={`/tournaments/${t.id}`} className="flex min-h-11 flex-1 items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.name}</span>
                    {t.completedAt && (
                      <span className="block text-xs text-muted-foreground">
                        {new Date(t.completedAt).toLocaleDateString()}
                      </span>
                    )}
                  </span>
                  <Badge variant="outline">{t.type === "league" ? "League" : "Knockout"}</Badge>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11 shrink-0"
                  aria-label={`Share ${t.name} on WhatsApp`}
                  title="Share results"
                  onClick={() => setShareTournament(t)}
                >
                  <Share2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {shareTournament && (
        <ShareDialog
          open
          onOpenChange={(o) => !o && setShareTournament(null)}
          tournament={shareTournament}
          results={results.filter((r) => r.tournamentId === shareTournament.id)}
          players={players}
        />
      )}
    </div>
  )
}
