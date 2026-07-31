import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { roundName } from "@/lib/knockout"
import type { Match } from "@/lib/types"
import { Badge } from "@/components/ui/badge"

function MatchBox({ match, onSelect }: { match: Match; onSelect?: (id: string) => void }) {
  const p1 = useLiveQuery(() => (match.player1Id ? db.players.get(match.player1Id) : undefined), [match.player1Id])
  const p2 = useLiveQuery(() => (match.player2Id ? db.players.get(match.player2Id) : undefined), [match.player2Id])

  const isBye = match.status === "completed" && (match.player1Id === null || match.player2Id === null)
  const clickable = !isBye && match.player1Id && match.player2Id && match.status !== "completed" && onSelect

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => match.player1Id && match.player2Id && onSelect?.(match.id)}
      className={`flex w-48 flex-col gap-1 rounded-md border border-border px-3 py-2 text-left text-sm ${
        clickable ? "hover:bg-muted" : ""
      } ${match.status === "completed" ? "opacity-80" : ""}`}
    >
      <div className={`flex justify-between ${match.winnerId === match.player1Id ? "font-semibold" : ""}`}>
        <span className="truncate">{p1?.name ?? (match.player1Id ? "…" : "TBD")}</span>
        {match.status === "completed" && !isBye && <span className="tabular-nums">{match.player1Legs}</span>}
      </div>
      <div className={`flex justify-between ${match.winnerId === match.player2Id ? "font-semibold" : ""}`}>
        <span className="truncate">{p2?.name ?? (match.player2Id ? "…" : "TBD")}</span>
        {match.status === "completed" && !isBye && <span className="tabular-nums">{match.player2Legs}</span>}
      </div>
      {isBye && <span className="text-xs text-muted-foreground">Bye — auto-advanced</span>}
    </button>
  )
}

export function BracketView({
  matches,
  onSelectMatch,
}: {
  matches: Match[]
  onSelectMatch?: (id: string) => void
}) {
  const rounds = Array.from(new Set(matches.map((m) => m.round))).sort((a, b) => a - b)
  const total = rounds.length

  return (
    <div className="flex gap-8 overflow-x-auto pb-4">
      {rounds.map((round) => {
        const roundMatches = matches.filter((m) => m.round === round).sort((a, b) => a.bracketPosition - b.bracketPosition)
        return (
          <div key={round} className="flex flex-col justify-around gap-6">
            <Badge variant="outline" className="mb-2 w-fit">
              {roundName(round, total)}
            </Badge>
            <div className="flex flex-col justify-around gap-6">
              {roundMatches.map((m) => (
                <MatchBox key={m.id} match={m} onSelect={onSelectMatch} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
