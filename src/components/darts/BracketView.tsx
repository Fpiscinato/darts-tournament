import { roundName } from "@/lib/knockout"
import { ROUND_BADGE_CLASSES, ROUND_LINE_CLASSES } from "@/lib/roundColors"
import type { Match } from "@/lib/types"
import { cn } from "@/lib/utils"

const BOX_HEIGHT = "h-[70px]"

interface FeederPairs {
  slot1?: Match
  slot2?: Match
}

function MatchBox({
  match,
  feeders,
  nameOf,
  onSelect,
}: {
  match: Match
  feeders?: FeederPairs
  nameOf: (id: string | null) => string
  onSelect?: (id: string) => void
}) {
  const isBye = match.status === "completed" && (match.player1Id === null || match.player2Id === null)
  const clickable = !isBye && match.player1Id && match.player2Id && match.status !== "completed" && onSelect
  const showScore =
    match.status === "completed" ||
    (match.status === "in_progress" && (match.player1Legs > 0 || match.player2Legs > 0))
  const p1 = feeders?.slot1
  const p2 = feeders?.slot2

  const slotLabel = (slot: 1 | 2) => {
    if (match.player1Id && slot === 1) return null
    if (match.player2Id && slot === 2) return null
    const feeder = slot === 1 ? p1 : p2
    if (!feeder) return "TBD"
    return `Winner of ${nameOf(feeder.player1Id)} × ${nameOf(feeder.player2Id)}`
  }

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => match.player1Id && match.player2Id && onSelect?.(match.id)}
      className={cn(
        "relative flex w-48 flex-col justify-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-left text-sm shadow-sm",
        BOX_HEIGHT,
        clickable && "transition-transform hover:-translate-y-0.5 hover:border-primary hover:bg-muted",
        match.status === "completed" && "opacity-80",
        match.winnerId && "ring-1 ring-inset ring-emerald-500/50",
      )}
    >
      {clickable && (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-4 items-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-white shadow-sm"
          title="Needs score"
        >
          Needs score
        </span>
      )}
      <div className={cn("flex items-center justify-between gap-1", match.winnerId === match.player1Id && "font-semibold")}>
        {match.player1Id ? (
          <span className="truncate">
            {nameOf(match.player1Id)}
            {isBye && <span className="ml-1 text-xs font-normal text-muted-foreground">(bye)</span>}
          </span>
        ) : (
          <span className="truncate text-muted-foreground">{slotLabel(1)}</span>
        )}
        {showScore && !isBye && (
          <span className="shrink-0 tabular-nums">
            {match.walkover && match.winnerId === match.player1Id ? "WO" : match.player1Legs}
          </span>
        )}
      </div>
      <div className={cn("flex items-center justify-between gap-1", match.winnerId === match.player2Id && "font-semibold")}>
        {match.player2Id ? (
          <span className="truncate">
            {nameOf(match.player2Id)}
            {isBye && <span className="ml-1 text-xs font-normal text-muted-foreground">(bye)</span>}
          </span>
        ) : (
          <span className="truncate text-muted-foreground">{slotLabel(2)}</span>
        )}
        {showScore && !isBye && (
          <span className="shrink-0 tabular-nums">
            {match.walkover && match.winnerId === match.player2Id ? "WO" : match.player2Legs}
          </span>
        )}
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
  nameOf,
}: {
  matches: Match[]
  onSelectMatch?: (id: string) => void
  nameOf: (id: string | null) => string
}) {
  const rounds = Array.from(new Set(matches.map((m) => m.round))).sort((a, b) => a - b)
  const total = rounds.length

  // Pre-compute, for every upcoming match, the two matches that feed each of
  // its slots — used to show "Winner of X × Y" while the previous round is
  // still being played.
  const feederOf: Record<string, FeederPairs> = {}
  for (const m of matches) {
    if (m.nextMatchId) {
      const slot = m.nextMatchSlot === 2 ? "slot2" : "slot1"
      feederOf[m.nextMatchId] = { ...feederOf[m.nextMatchId], [slot]: m }
    }
  }

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
                  <MatchBox key={m.id} match={m} feeders={feederOf[m.id]} nameOf={nameOf} onSelect={onSelectMatch} />
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