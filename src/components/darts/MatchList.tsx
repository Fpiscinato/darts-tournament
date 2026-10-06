import { useLiveQuery } from "dexie-react-hooks"
import { Pencil } from "lucide-react"
import { db } from "@/lib/db"
import type { Match } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Legend } from "@/components/darts/Legend"
import { cn } from "@/lib/utils"
import { ROUND_BORDER_CLASSES } from "@/lib/roundColors"

function MatchRow({
  match,
  onSelect,
  onEdit,
}: {
  match: Match
  onSelect: (id: string) => void
  onEdit?: (id: string) => void
}) {
  const p1 = useLiveQuery(() => (match.player1Id ? db.players.get(match.player1Id) : undefined), [match.player1Id])
  const p2 = useLiveQuery(() => (match.player2Id ? db.players.get(match.player2Id) : undefined), [match.player2Id])

  const ready = match.player1Id && match.player2Id
  const isBye = match.status === "completed" && (!match.player1Id || !match.player2Id)
  const canEdit = match.status === "completed" && !isBye && onEdit

  return (
    <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-3 py-2 transition-colors hover:border-foreground/20 hover:bg-muted/40">
      <div className="min-w-0 flex-1 text-sm">
        <span className={match.winnerId === match.player1Id ? "font-semibold" : ""}>{p1?.name ?? (match.player1Id ? "…" : "TBD")}</span>
        <span className="mx-1 text-muted-foreground">vs</span>
        <span className={match.winnerId === match.player2Id ? "font-semibold" : ""}>{p2?.name ?? (match.player2Id ? "…" : "TBD")}</span>
      </div>
      {match.status === "completed" ? (
        <>
          <Badge variant={isBye ? "outline" : "secondary"}>
            {isBye ? "Bye" : match.walkover ? "WO" : `${match.player1Legs}-${match.player2Legs}`}
          </Badge>
          {canEdit && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => onEdit(match.id)}
              aria-label={`Edit result of ${p1?.name ?? "player"} × ${p2?.name ?? "player"}`}
              title="Edit result"
            >
              <Pencil />
            </Button>
          )}
        </>
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

/** Groups matches by round, colored consistently with the Knockout bracket.
 * Rounds that still have work to do float to the top; rounds where every
 * match is confirmed sink toward the bottom — same within each round, so
 * the organiser never has to scroll past finished matches to find the next
 * one to score.
 */
export function MatchList({
  matches,
  onSelect,
  onEdit,
  title,
}: {
  matches: Match[]
  onSelect: (id: string) => void
  onEdit?: (id: string) => void
  title?: string
}) {
  const roundNumbers = Array.from(new Set(matches.map((m) => m.round))).sort((a, b) => a - b)
  const multiRound = roundNumbers.length > 1

  const rounds = roundNumbers.map((round) => {
    const roundMatches = [...matches.filter((m) => m.round === round)].sort((a, b) => {
      const aDone = a.status === "completed" ? 1 : 0
      const bDone = b.status === "completed" ? 1 : 0
      return aDone - bDone || a.bracketPosition - b.bracketPosition
    })
    const allDone = roundMatches.every((m) => m.status === "completed")
    return { round, roundMatches, allDone }
  })

  const ordered = [...rounds].sort((a, b) => {
    const aDone = a.allDone ? 1 : 0
    const bDone = b.allDone ? 1 : 0
    return aDone - bDone || a.round - b.round
  })

  return (
    <div>
      {title && <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>}
      <div className="flex flex-col gap-4">
        {ordered.map(({ round, roundMatches, allDone }) => {
          const colorIndex = roundNumbers.indexOf(round) % ROUND_BORDER_CLASSES.length
          return (
            <div
              key={round}
              className={cn(
                "rounded-lg border border-border bg-muted/30 p-3",
                allDone && "opacity-70",
                multiRound && `border-l-4 ${ROUND_BORDER_CLASSES[colorIndex]}`,
              )}
            >
              {multiRound && (
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Round {round}
                  {allDone && " · done"}
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {roundMatches.map((m) => (
                  <MatchRow key={m.id} match={m} onSelect={onSelect} onEdit={onEdit} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {matches.some((m) => m.status === "completed" || m.walkover) && (
        <Legend
          className="mt-2"
          items={[
            { term: "a–b", label: "final legs of a finished match" },
            ...(matches.some((m) => m.walkover)
              ? [{ term: "WO", label: "walkover — opponent withdrew, no legs played" }]
              : []),
            ...(matches.some((m) => m.status === "completed" && (!m.player1Id || !m.player2Id))
              ? [{ term: "Bye", label: "empty slot — opponent advances automatically" }]
              : []),
            ...(onEdit ? [{ term: "✎", label: "edit a result after it was confirmed" }] : []),
          ]}
        />
      )}
    </div>
  )
}
