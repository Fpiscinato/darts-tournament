import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { roundName } from "@/lib/knockout"
import { ROUND_BADGE_CLASSES, ROUND_LINE_CLASSES } from "@/lib/roundColors"
import type { Match } from "@/lib/types"
import { cn } from "@/lib/utils"

const BOX_HEIGHT = "h-[70px]"

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
      className={cn(
        "relative flex w-48 flex-col justify-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-left text-sm shadow-sm",
        BOX_HEIGHT,
        clickable && "hover:border-primary hover:bg-muted",
        match.status === "completed" && "opacity-80",
      )}
    >
      {clickable && (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-4 items-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-white"
          title="Needs score"
        >
          Needs score
        </span>
      )}
      <div className={cn("flex justify-between", match.winnerId === match.player1Id && "font-semibold")}>
        <span className="truncate">
          {p1?.name ?? (match.player1Id ? "…" : "TBD")}
          {isBye && match.player1Id && <span className="ml-1 text-xs font-normal text-muted-foreground">(bye)</span>}
        </span>
        {match.status === "completed" && !isBye && <span className="tabular-nums">{match.player1Legs}</span>}
      </div>
      <div className={cn("flex justify-between", match.winnerId === match.player2Id && "font-semibold")}>
        <span className="truncate">
          {p2?.name ?? (match.player2Id ? "…" : "TBD")}
          {isBye && match.player2Id && <span className="ml-1 text-xs font-normal text-muted-foreground">(bye)</span>}
        </span>
        {match.status === "completed" && !isBye && <span className="tabular-nums">{match.player2Legs}</span>}
      </div>
    </button>
  )
}

/** Elbow connector linking a pair of round-N matches to the round-N+1 match
 * they feed into: a CSS-only bracket line (no SVG/measurement needed) using
 * top/bottom borders on two stacked halves. */
function Connector({ colorClass }: { colorClass: string }) {
  return (
    <div className="flex w-6 flex-1 flex-col">
      <div className={cn("flex-1 border-r-2 border-b-2 rounded-br", colorClass)} />
      <div className={cn("flex-1 border-r-2 border-t-2 rounded-tr", colorClass)} />
    </div>
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
    <div className="flex items-stretch gap-0 overflow-x-auto pb-4">
      {rounds.map((round, roundIndex) => {
        const roundMatches = matches.filter((m) => m.round === round).sort((a, b) => a.bracketPosition - b.bracketPosition)
        const isLast = roundIndex === rounds.length - 1
        const lineColor = ROUND_LINE_CLASSES[roundIndex % ROUND_LINE_CLASSES.length]

        return (
          <div key={round} className="flex shrink-0 items-stretch">
            <div className="flex flex-col gap-2 pr-2">
              <span
                className={cn(
                  "mb-1 w-fit rounded-full border px-2 py-0.5 text-xs font-semibold",
                  ROUND_BADGE_CLASSES[roundIndex % ROUND_BADGE_CLASSES.length],
                )}
              >
                {roundName(round, total)}
              </span>
              <div className="flex flex-1 flex-col justify-around gap-4">
                {roundMatches.map((m) => (
                  <MatchBox key={m.id} match={m} onSelect={onSelectMatch} />
                ))}
              </div>
            </div>

            {!isLast && (
              <div className="mt-7 flex flex-col justify-around gap-4">
                {Array.from({ length: Math.ceil(roundMatches.length / 2) }).map((_, i) => (
                  <div key={i} className="flex flex-col justify-around" style={{ height: `${2 * 70 + 16}px` }}>
                    <Connector colorClass={lineColor} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
