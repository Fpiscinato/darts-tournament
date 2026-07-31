import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useLiveQuery } from "dexie-react-hooks"
import { Trash2 } from "lucide-react"
import { db } from "@/lib/db"
import { deleteTournament, reopenTournament } from "@/lib/engine"
import { useToast } from "@/context/ToastContext"
import { MatchControl } from "@/components/darts/MatchControl"
import { MatchList } from "@/components/darts/MatchList"
import { StandingsTable } from "@/components/darts/StandingsTable"
import { BracketView } from "@/components/darts/BracketView"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { Stage } from "@/lib/types"

const STAGE_LABEL: Record<Stage, string> = {
  league: "League",
  top4: "Top 4",
  final: "Final",
  knockout: "Knockout",
}

export function TournamentPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { notify } = useToast()
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const tournament = useLiveQuery(() => (id ? db.tournaments.get(id) : undefined), [id])
  const matches = useLiveQuery(() => (id ? db.matches.where({ tournamentId: id }).toArray() : []), [id])
  const results = useLiveQuery(() => (id ? db.results.where({ tournamentId: id }).toArray() : []), [id])
  const players = useLiveQuery(() => db.players.toArray(), [])

  if (!tournament || !matches || !results || !players) return null

  const nameOf = (playerId: string) => players.find((p) => p.id === playerId)?.name ?? "?"

  if (selectedMatchId) {
    return <MatchControl matchId={selectedMatchId} onClose={() => setSelectedMatchId(null)} />
  }

  const stagesPresent = Array.from(new Set(matches.map((m) => m.stage))) as Stage[]
  const stageOrder: Stage[] = ["league", "top4", "knockout", "final"]
  const orderedStages = stageOrder.filter((s) => stagesPresent.includes(s))

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{tournament.name}</h1>
          <div className="mt-1 flex gap-2">
            <Badge variant="outline">{tournament.type === "league" ? "League" : "Knockout"}</Badge>
            {tournament.status === "completed" && <Badge variant="secondary">Completed</Badge>}
            {tournament.status === "active" && <Badge>Active</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tournament.status === "completed" && (
            <Button variant="outline" className="min-h-11" onClick={() => setConfirmReopen(true)}>
              Reopen
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11 text-destructive"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete tournament"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {tournament.status === "completed" && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Final results</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[360px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2">Pos</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2 text-right">W-L</th>
                  <th className="px-3 py-2 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {[...results]
                  .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
                  .map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        {r.position ?? "—"}
                        {r.titleWon && " 🏆"}
                      </td>
                      <td className="px-3 py-2 font-medium">{nameOf(r.playerId)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.matchWins}-{r.matchLosses}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.points}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-col gap-8">
        {orderedStages.map((stage) => {
          const stageMatches = matches.filter((m) => m.stage === stage)
          const stagePlayerIds = Array.from(
            new Set(stageMatches.flatMap((m) => [m.player1Id, m.player2Id]).filter((x): x is string => x !== null)),
          )
          const isRoundRobin = stage === "league" || (stage === "top4" && tournament.finalsFormat === "top4_round_robin")
          const isBracket = stage === "knockout"

          return (
            <section key={stage}>
              <h2 className="mb-2 text-lg font-medium">{STAGE_LABEL[stage]}</h2>
              {isRoundRobin && <StandingsTable playerIds={stagePlayerIds} matches={stageMatches} />}
              {isBracket && <BracketView matches={stageMatches} onSelectMatch={setSelectedMatchId} />}
              {(isRoundRobin || stage === "final") && (
                <div className="mt-3">
                  <MatchList matches={stageMatches} onSelect={setSelectedMatchId} />
                </div>
              )}
            </section>
          )
        })}
      </div>

      <AlertDialog open={confirmReopen} onOpenChange={setConfirmReopen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen this tournament?</AlertDialogTitle>
            <AlertDialogDescription>
              This tournament is finished. Reopening it removes its entry from the history ranking until it is
              finished again, and lets you undo confirmed results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={async () => {
                await reopenTournament(tournament.id)
                setConfirmReopen(false)
              }}
            >
              Reopen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{tournament.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this tournament and all of its matches and results. This cannot be undone
              unless you have a backup file to import afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={async () => {
                await deleteTournament(tournament.id)
                notify(`${tournament.name} deleted`)
                navigate("/")
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
