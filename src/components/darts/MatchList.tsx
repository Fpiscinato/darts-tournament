import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import type { Match } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const ROUND_ACCENTS = [
  "border-l-violet-500",
  "border-l-sky-500",
  "border-l-amber-500",
  "border-l-emerald-500",
  "border-l-rose-500",
  "border-l-cyan-500",
]

function MatchRow({ match, onSelect }: { match: Match; onSelect: (id: string) => void }) {
  const p1 = useLiveQuery(() => (match.player1Id ? db.players.get(match.player1Id) : undefined), [match.player1Id])
  const p2 = useLiveQuery(() => (match.player2Id ? db.players.get(match.player2Id) : undefined), [match.player2Id])

  const ready = match.player1Id && match.player2Id
  const isBye = match.status === "completed" && (!match.player1Id || !match.player2Id)

  return (
    <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-3 py-2">
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
  const rounds = Array.from(new Set(matches.map((m) => m.round))).sort((a, b) => a - b)
  const multiRound = rounds.length > 1

  return (
    <div>
      {title && <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>}
      <div className="flex flex-col gap-4">
        {rounds.map((round, i) => {
          const roundMatches = matches
            .filter((m) => m.round === round)
            .sort((a, b) => a.bracketPosition - b.bracketPosition)
          return (
            <div
              key={round}
              className={cn(
                "rounded-lg border border-border bg-muted/30 p-3",
                multiRound && `border-l-4 ${ROUND_ACCENTS[i % ROUND_ACCENTS.length]}`,
              )}
            >
              {multiRound && (
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Round {round}
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {roundMatches.map((m) => (
                  <MatchRow key={m.id} match={m} onSelect={onSelect} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
