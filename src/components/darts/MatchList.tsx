import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import type { Match } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

function MatchRow({ match, onSelect }: { match: Match; onSelect: (id: string) => void }) {
  const p1 = useLiveQuery(() => (match.player1Id ? db.players.get(match.player1Id) : undefined), [match.player1Id])
  const p2 = useLiveQuery(() => (match.player2Id ? db.players.get(match.player2Id) : undefined), [match.player2Id])

  const ready = match.player1Id && match.player2Id
  const isBye = match.status === "completed" && (!match.player1Id || !match.player2Id)

  return (
    <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border py-2 last:border-0">
      <div className="min-w-0 flex-1 text-sm">
        <span className={match.winnerId === match.player1Id ? "font-semibold" : ""}>{p1?.name ?? (match.player1Id ? "…" : "TBD")}</span>
        <span className="mx-1 text-muted-foreground">vs</span>
        <span className={match.winnerId === match.player2Id ? "font-semibold" : ""}>{p2?.name ?? (match.player2Id ? "…" : "TBD")}</span>
      </div>
      {match.status === "completed" ? (
        <Badge variant={isBye ? "outline" : "secondary"}>
          {isBye ? "Bye" : `${match.player1Legs}-${match.player2Legs}`}
        </Badge>
      ) : ready ? (
        <Button size="sm" className="min-h-11" onClick={() => onSelect(match.id)}>
          {match.status === "in_progress" ? `${match.player1Legs}-${match.player2Legs} · Continue` : "Score"}
        </Button>
      ) : (
        <Badge variant="outline">TBD</Badge>
      )}
    </div>
  )
}

export function MatchList({ matches, onSelect, title }: { matches: Match[]; onSelect: (id: string) => void; title?: string }) {
  const sorted = [...matches].sort((a, b) => a.round - b.round || a.bracketPosition - b.bracketPosition)
  return (
    <div>
      {title && <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>}
      <div className="rounded-lg border border-border px-4">
        {sorted.map((m) => (
          <MatchRow key={m.id} match={m} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
