import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { computeStandings } from "@/lib/roundRobin"
import type { Match } from "@/lib/types"
import { Badge } from "@/components/ui/badge"

export function StandingsTable({ playerIds, matches, title }: { playerIds: string[]; matches: Match[]; title?: string }) {
  const players = useLiveQuery(() => db.players.bulkGet(playerIds), [playerIds.join(",")])
  const standings = computeStandings(playerIds, matches)

  if (!players) return null
  const nameOf = (id: string) => players.find((p) => p?.id === id)?.name ?? "?"

  return (
    <div>
      {title && <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2 text-right">P</th>
              <th className="px-3 py-2 text-right">W</th>
              <th className="px-3 py-2 text-right">L</th>
              <th className="px-3 py-2 text-right">Legs</th>
              <th className="px-3 py-2 text-right">Diff</th>
              <th className="px-3 py-2 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => (
              <tr key={row.playerId} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 font-medium">
                  {nameOf(row.playerId)}
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
    </div>
  )
}
