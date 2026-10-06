import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useLiveQuery } from "dexie-react-hooks"
import { Share2, Trash2, Users } from "lucide-react"
import { db } from "@/lib/db"
import { deleteTournament, reopenMatch, reopenTournament, withdrawnPlayerIds } from "@/lib/engine"
import { useToast } from "@/context/ToastContext"
import { MatchControl } from "@/components/darts/MatchControl"
import { MatchList } from "@/components/darts/MatchList"
import { StandingsTable } from "@/components/darts/StandingsTable"
import { BracketView } from "@/components/darts/BracketView"
import { RosterDialog } from "@/components/darts/RosterDialog"
import { ShareDialog } from "@/components/darts/ShareDialog"
import { PageSkeleton } from "@/components/darts/PageSkeleton"
import { Legend } from "@/components/darts/Legend"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  const { id, matchId } = useParams<{ id: string; matchId?: string }>()
  const navigate = useNavigate()
  const { notify } = useToast()
  const [confirmReopen, setConfirmReopen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [activeTab, setActiveTab] = useState<string | null>(null)

  const openMatch = (mId: string) => navigate(`/tournaments/${id}/matches/${mId}`)
  const closeMatch = () => {
    // Walk back to wherever the user came from; deep links jump straight to
    // the tournament instead of leaving the app.
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
    else navigate(`/tournaments/${id}`)
  }

  const tournamentRow = useLiveQuery(async () => {
    if (!id) return null
    const t = await db.tournaments.get(id)
    return t ?? null
  }, [id])
  const matches = useLiveQuery(() => (id ? db.matches.where({ tournamentId: id }).toArray() : []), [id])
  const results = useLiveQuery(() => (id ? db.results.where({ tournamentId: id }).toArray() : []), [id])
  const players = useLiveQuery(() => db.players.toArray(), [])

  if (tournamentRow === undefined || !matches || !results || !players) {
    return <PageSkeleton rows={5} className="mx-auto max-w-3xl px-4 py-6" />
  }
  if (tournamentRow === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Tournament not found</h1>
        <p className="text-sm text-muted-foreground">It may have been deleted from this device.</p>
        <Button asChild className="min-h-11">
          <Link to="/">Back to tournaments</Link>
        </Button>
      </div>
    )
  }
  const tournament = tournamentRow

  if (matchId) {
    return <MatchControl matchId={matchId} onClose={closeMatch} />
  }

  const nameOf = (playerId: string) => players.find((p) => p.id === playerId)?.name ?? "?"
  const withdrawnIds = withdrawnPlayerIds(tournament)
  const withdrawnSet = new Set(withdrawnIds)

  const stagesPresent = Array.from(new Set(matches.map((m) => m.stage))) as Stage[]
  const stageOrder: Stage[] = ["league", "top4", "knockout", "final"]
  const naturalStages = stageOrder.filter((s) => stagesPresent.includes(s))

  // Whichever stage still has work to do floats to the top; stages that are
  // fully confirmed sink toward the bottom — same idea as the round
  // ordering inside MatchList, applied one level up so a finished League
  // table doesn't sit above the Top 4 / Final you're actually playing.
  const stageDone = (stage: Stage) => matches.filter((m) => m.stage === stage).every((m) => m.status === "completed")
  const orderedStages = [...naturalStages].sort((a, b) => {
    const aDone = stageDone(a) ? 1 : 0
    const bDone = stageDone(b) ? 1 : 0
    return aDone - bDone || naturalStages.indexOf(a) - naturalStages.indexOf(b)
  })

  // Deterministic "who plays who" preview: fixtures are generated up front, so
  // the next matches are simply the earliest pending ones, stage by stage.
  // Bracket slots still waiting on "Winner of X × Y" are skipped (players unknown).
  const stagePriority = (stage: Stage) => naturalStages.indexOf(stage)
  const upcoming = [...matches]
    .filter((m) => m.status !== "completed" && m.player1Id && m.player2Id)
    .sort((a, b) => stagePriority(a.stage) - stagePriority(b.stage) || a.round - b.round)
    .slice(0, 4)

  const defaultTab = orderedStages[0] ?? naturalStages[0]
  const resolvedTab =
    activeTab && naturalStages.includes(activeTab as Stage) ? (activeTab as Stage) : (defaultTab ?? "league")

  async function handleReopen() {
    if (working) return
    setWorking(true)
    try {
      await reopenTournament(tournament.id)
      setConfirmReopen(false)
      notify(`${tournament.name} reopened`)
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not reopen the tournament", "destructive")
    } finally {
      setWorking(false)
    }
  }

  async function handleDelete() {
    if (working) return
    setWorking(true)
    try {
      await deleteTournament(tournament.id)
      setConfirmDelete(false)
      notify(`${tournament.name} deleted`)
      navigate("/")
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not delete the tournament", "destructive")
    } finally {
      setWorking(false)
    }
  }

  // Pencil on a finished match: reopen (possibly the whole tournament,
  // which is already finished) then re-score that single match from 0–0.
  async function handleEditMatch(mId: string) {
    if (working) return
    if (tournament.status === "completed") {
      setWorking(true)
      try {
        await reopenTournament(tournament.id)
        notify("Tournament reopened — you can now correct the result")
      } catch (err) {
        notify(err instanceof Error ? err.message : "Could not reopen the tournament", "destructive")
        return
      } finally {
        setWorking(false)
      }
    }
    const result = await reopenMatch(tournament.id, mId)
    if (!result.ok) {
      notify(result.reason ?? "Could not edit the match", "destructive")
      return
    }
    openMatch(mId)
  }

  const stagePendingCount = (stage: Stage) =>
    matches.filter((m) => m.stage === stage && m.status !== "completed").length

  const renderStage = (stage: Stage) => {
    const stageMatches = matches.filter((m) => m.stage === stage)
    const stagePlayerIds = Array.from(
      new Set(stageMatches.flatMap((m) => [m.player1Id, m.player2Id]).filter((x): x is string => x !== null)),
    )
    const isRoundRobin = stage === "league" || (stage === "top4" && tournament.finalsFormat === "top4_round_robin")
    const isBracket = stage === "knockout"
    const done = stageDone(stage)
    const left = stagePendingCount(stage)

    return (
      <div className={done ? "opacity-80" : undefined}>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-lg font-medium">{STAGE_LABEL[stage]}</h2>
          {done ? (
            <Badge variant="secondary">done</Badge>
          ) : left > 0 ? (
            <Badge>{left} pending</Badge>
          ) : null}
        </div>
        {isRoundRobin && (
          <StandingsTable playerIds={stagePlayerIds} matches={stageMatches} withdrawnIds={withdrawnSet} />
        )}
        {isBracket && (
          <BracketView matches={stageMatches} onSelectMatch={openMatch} nameOf={(id) => (id ? nameOf(id) : "")} />
        )}
        {(isRoundRobin || stage === "final" || isBracket) && (
          <div className="mt-3">
            <MatchList matches={stageMatches} onSelect={openMatch} onEdit={handleEditMatch} />
          </div>
        )}
      </div>
    )
  }

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
            <>
              <Button
                variant="outline"
                size="icon"
                className="min-h-11 min-w-11"
                onClick={() => setShareOpen(true)}
                aria-label="Share results on WhatsApp"
                title="Share results"
              >
                <Share2 />
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => setConfirmReopen(true)}>
                Reopen
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={() => setRosterOpen(true)}
            aria-label="Manage players (withdraw / rejoin)"
            title="Players"
          >
            <Users />
          </Button>
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
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Final results</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[360px] text-sm">
                <caption className="sr-only">Final results</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="px-3 py-2">Pos</th>
                    <th scope="col" className="px-3 py-2">Player</th>
                    <th scope="col" className="px-3 py-2 text-right">W-L</th>
                    <th scope="col" className="px-3 py-2 text-right">Pts</th>
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
                      <td className="px-3 py-2 font-medium">
                        {nameOf(r.playerId)}
                        {r.withdrawn && (
                          <Badge variant="destructive" className="ml-2">
                            WD
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.matchWins}-{r.matchLosses}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.points}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Legend
            className="mt-2"
            items={[
              { term: "🏆", label: "champion" },
              ...(results.some((r) => r.withdrawn) ? [{ term: "WD", label: "withdrew mid-tournament" }] : []),
            ]}
          />
        </section>
      )}

      {tournament.status === "active" && upcoming.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Up next</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {upcoming.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => openMatch(m.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <span className="font-medium">
                    {nameOf(m.player1Id ?? "")}
                    <span className="mx-1.5 text-muted-foreground">×</span>
                    {nameOf(m.player2Id ?? "")}
                  </span>
                  <Badge variant="secondary">{STAGE_LABEL[m.stage]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {naturalStages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No matches yet.
        </p>
      ) : naturalStages.length === 1 ? (
        renderStage(naturalStages[0])
      ) : (
        <Tabs value={resolvedTab} onValueChange={setActiveTab}>
          <TabsList
            className="w-full justify-start gap-1 overflow-x-auto rounded-xl p-1"
            style={{ height: "auto" }}
          >
            {orderedStages.map((stage) => (
              <TabsTrigger key={stage} value={stage} className="min-h-11 shrink-0 px-3">
                {STAGE_LABEL[stage]}
                {stagePendingCount(stage) > 0 && stage !== resolvedTab && (
                  <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
                    {stagePendingCount(stage)}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {orderedStages.map((stage) => (
            <TabsContent key={stage} value={stage} className="pt-3">
              {renderStage(stage)}
            </TabsContent>
          ))}
        </Tabs>
      )}

      <AlertDialog open={confirmReopen} onOpenChange={setConfirmReopen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen this tournament?</AlertDialogTitle>
            <AlertDialogDescription>
              This tournament is finished. Reopening it removes its entry from the history ranking until it is
              finished again, and lets you correct confirmed results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" disabled={working} onClick={handleReopen}>
              {working ? "Reopening…" : "Reopen"}
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
            <AlertDialogAction className="min-h-11" disabled={working} onClick={handleDelete}>
              {working ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RosterDialog open={rosterOpen} onOpenChange={setRosterOpen} tournament={tournament} />
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} tournament={tournament} results={results} players={players} />
    </div>
  )
}