import { useEffect, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowLeft } from "lucide-react"
import { db } from "@/lib/db"
import { confirmMatch, undoLastConfirmedResult } from "@/lib/engine"
import { isValidCompletedScore } from "@/lib/format"
import { useToast } from "@/context/ToastContext"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DartHitEffect } from "./DartHitEffect"
import { PageSkeleton } from "./PageSkeleton"
import { Legend } from "./Legend"
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

function usePlayerName(id: string | null): string {
  const player = useLiveQuery(() => (id ? db.players.get(id) : undefined), [id])
  return player?.name ?? "TBD"
}

export function MatchControl({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const matchRow = useLiveQuery(async () => {
    const m = await db.matches.get(matchId)
    return m ?? null
  }, [matchId])
  const [history, setHistory] = useState<(1 | 2)[]>([])
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmUndoLast, setConfirmUndoLast] = useState(false)
  const [hitP1, setHitP1] = useState(0)
  const [hitP2, setHitP2] = useState(0)
  const [working, setWorking] = useState(false)
  const { notify } = useToast()

  const p1Name = usePlayerName(matchRow?.player1Id ?? null)
  const p2Name = usePlayerName(matchRow?.player2Id ?? null)

  useEffect(() => {
    setHistory([])
  }, [matchId])

  useEffect(() => {
    if (matchRow === null) onClose()
  }, [matchRow, onClose])

  if (matchRow === undefined) {
    return <PageSkeleton rows={3} className="mx-auto max-w-3xl px-4 py-6" />
  }
  if (matchRow === null) return null
  const match = matchRow

  const decided = isValidCompletedScore(match.bestOf, match.player1Legs, match.player2Legs)
  const someoneWon = match.player1Legs >= match.legsToWin || match.player2Legs >= match.legsToWin
  const p1Won = match.player1Legs >= match.legsToWin
  const p2Won = match.player2Legs >= match.legsToWin

  async function bumpLeg(slot: 1 | 2, dir: 1 | -1) {
    // Read-modify-write runs inside a single transaction, so a second tab
    // (or a late refresh) can't race the increment and lose a leg.
    await db.transaction("rw", db.matches, async () => {
      const m = await db.matches.get(match.id)
      if (!m) return
      await db.matches.update(m.id, {
        ...(slot === 1
          ? { player1Legs: Math.max(0, m.player1Legs + dir) }
          : { player2Legs: Math.max(0, m.player2Legs + dir) }),
        ...(dir === 1 ? { status: "in_progress" as const } : {}),
        updatedAt: new Date().toISOString(),
      })
    })
  }

  async function winLeg(slot: 1 | 2) {
    if (!match || someoneWon || working) return
    setWorking(true)
    try {
      await bumpLeg(slot, 1)
      setHistory((h) => [...h, slot])
      if (slot === 1) setHitP1((n) => n + 1)
      else setHitP2((n) => n + 1)
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not record the leg", "destructive")
    } finally {
      setWorking(false)
    }
  }

  async function undoLastLeg() {
    if (!match || history.length === 0 || working) return
    const last = history[history.length - 1]
    setWorking(true)
    try {
      await bumpLeg(last, -1)
      setHistory((h) => h.slice(0, -1))
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not undo the leg", "destructive")
    } finally {
      setWorking(false)
    }
  }

  async function resetCurrentMatch() {
    if (!match || working) return
    setWorking(true)
    try {
      await db.matches.update(match.id, {
        player1Legs: 0,
        player2Legs: 0,
        status: "pending",
        updatedAt: new Date().toISOString(),
      })
      setHistory([])
      setConfirmReset(false)
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not reset the match", "destructive")
    } finally {
      setWorking(false)
    }
  }

  async function handleConfirm() {
    if (!match || !decided) return
    try {
      await confirmMatch(match.id, match.player1Legs, match.player2Legs)
      const tournament = await db.tournaments.get(match.tournamentId)
      if (tournament?.status === "completed") {
        notify(`${tournament.name} is finished! Consider exporting a backup from Settings.`)
      } else {
        notify("Result confirmed")
      }
      onClose()
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not confirm result", "destructive")
    }
  }

  async function handleUndoLastConfirmed() {
    if (!match) return
    const result = await undoLastConfirmedResult(match.tournamentId)
    setConfirmUndoLast(false)
    if (result.ok) {
      notify("Last confirmed result reopened")
    } else {
      notify(result.reason ?? "Nothing to undo", "destructive")
    }
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" className="min-h-11" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <span className="text-sm text-muted-foreground">
          <strong className="font-semibold text-foreground">{p1Name}</strong> ×{" "}
          <strong className="font-semibold text-foreground">{p2Name}</strong> · Best of {match.bestOf} · first to{" "}
          {match.legsToWin}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div
          className={cn(
            "relative flex flex-col items-center gap-2 overflow-hidden rounded-lg border border-border p-4",
            p1Won && "ring-2 ring-inset ring-emerald-500",
          )}
        >
          <DartHitEffect triggerKey={hitP1} />
          <span className="truncate text-center font-medium">{p1Name}</span>
          <span key={`${match.id}-p1-${match.player1Legs}`} className={cn("animate-leg-pop text-4xl font-bold tabular-nums", p1Won && "text-emerald-500")}>
            {match.player1Legs}
          </span>
          {history.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1" aria-label="Leg history">
              {history.map((winner, i) => (
                <span
                  key={i}
                  className={cn("h-2 w-2 rounded-full", winner === 1 ? "bg-emerald-500" : "bg-muted-foreground/40")}
                />
              ))}
            </div>
          )}
          <Button className="min-h-11 w-full" disabled={someoneWon || working} onClick={() => winLeg(1)}>
            {p1Name} Wins Leg
          </Button>
        </div>
        <div
          className={cn(
            "relative flex flex-col items-center gap-2 overflow-hidden rounded-lg border border-border p-4",
            p2Won && "ring-2 ring-inset ring-emerald-500",
          )}
        >
          <DartHitEffect triggerKey={hitP2} />
          <span className="truncate text-center font-medium">{p2Name}</span>
          <span key={`${match.id}-p2-${match.player2Legs}`} className={cn("animate-leg-pop text-4xl font-bold tabular-nums", p2Won && "text-emerald-500")}>
            {match.player2Legs}
          </span>
          {history.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1" aria-label="Leg history">
              {history.map((winner, i) => (
                <span
                  key={i}
                  className={cn("h-2 w-2 rounded-full", winner === 2 ? "bg-emerald-500" : "bg-muted-foreground/40")}
                />
              ))}
            </div>
          )}
          <Button className="min-h-11 w-full" disabled={someoneWon || working} onClick={() => winLeg(2)}>
            {p2Name} Wins Leg
          </Button>
        </div>
      </div>

      <Legend
        items={[
          { term: "First to", label: `${match.legsToWin} legs wins the match` },
          { term: "Wins leg", label: "records one leg for that player" },
          { term: "Undo last", label: "removes that player's most recent leg only" },
          { term: "●", label: "one dot per leg won" },
          { term: "Reset", label: "clears this score back to 0–0" },
          { term: "✎", label: "already confirmed? use the pencil in the match list" },
        ]}
      />

      <div className="flex flex-col gap-3">
<Button
            size="lg"
            className={cn("min-h-11", decided && "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background")}
            disabled={!decided || working}
            onClick={handleConfirm}
          >
            {decided ? "Confirm Result — winner decided" : "Confirm Result"}
          </Button>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="min-h-11" disabled={history.length === 0 || working} onClick={undoLastLeg}>
              Undo Last Leg
            </Button>
            <Button variant="outline" className="min-h-11" disabled={working} onClick={() => setConfirmReset(true)}>
              Reset Current Match
            </Button>
          </div>

        <Button variant="destructive" className="min-h-11" onClick={() => setConfirmUndoLast(true)}>
          Undo Last Confirmed Result
        </Button>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this match?</AlertDialogTitle>
            <AlertDialogDescription>
              The score for this match will go back to 0–0. This does not affect any other match.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={resetCurrentMatch}>
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmUndoLast} onOpenChange={setConfirmUndoLast}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo the last confirmed result?</AlertDialogTitle>
            <AlertDialogDescription>
              This reopens the most recently confirmed match in this tournament (which may not be this one) so its
              score can be corrected. Tables and brackets will be recalculated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={handleUndoLastConfirmed}>
              Undo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
