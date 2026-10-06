import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { computeStandings } from "@/lib/roundRobin"
import type { Match } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Legend } from "@/components/darts/Legend"

export function StandingsTable({
  playerIds,
  matches,
  title,
  withdrawnIds,
}: {
  playerIds: string[]
  matches: Match[]
  title?: string
  withdrawnIds?: Set<string>
}) {
  const players = useLiveQuery(() => db.players.bulkGet(playerIds), [playerIds.join(",")])
  const standings = computeStandings(playerIds, matches)

  if (!players) {
    return (
      <div role="status" aria-busy="true" className="space-y-2 rounded-lg border border-border p-3">
        <span className="sr-only">Loading standings…</span>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    )
  }
  const nameOf = (id: string) => players.find((p) => p?.id === id)?.name ?? "?"

  return (
    <div>
      {title && <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">{title ?? "Standings"}</caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="px-3 py-2">#</th>
                <th scope="col" className="px-3 py-2">Player</th>
                <th scope="col" className="px-3 py-2 text-right">P</th>
                <th scope="col" className="px-3 py-2 text-right">W</th>
                <th scope="col" className="px-3 py-2 text-right">L</th>
                <th scope="col" className="px-3 py-2 text-right">Legs</th>
                <th scope="col" className="px-3 py-2 text-right">Diff</th>
                <th scope="col" className="px-3 py-2 text-right">Pts</th>
              </tr>
            </thead>
          <tbody>
            {standings.map((row, i) => (
              <tr key={row.playerId} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 font-medium">
                  {nameOf(row.playerId)}
                  {withdrawnIds?.has(row.playerId) && (
                    <Badge variant="destructive" className="ml-2">
                      WD
                    </Badge>
                  )}
                  {row.playoffRequired && (
                    <Badge variant="destructive" className="ml-2">
                      Play-off Required
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.played}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.wins}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.losses}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.legsFor}-{row.legsAgainst}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.legDiff > 0 ? `+${row.legDiff}` : row.legDiff}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend
        items={[
          { term: "P", label: "played" },
          { term: "W / L", label: "matches won / lost" },
          { term: "Legs", label: "legs for – legs against" },
          { term: "Diff", label: "leg difference (+ = better)" },
          { term: "Pts", label: "points (2 per win)" },
          ...(withdrawnIds && withdrawnIds.size > 0 ? [{ term: "WD", label: "withdrew from the tournament" }] : []),
          ...(standings.some((row) => row.playoffRequired)
            ? [{ term: "Play-off", label: "needs a play-off to decide position" }]
            : []),
        ]}
      />
    </div>
  )
}
