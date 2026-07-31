import { useEffect, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { confirmMatch, undoLastConfirmedResult } from "@/lib/engine"
import { isValidCompletedScore } from "@/lib/format"
import { useToast } from "@/context/ToastContext"
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

function usePlayerName(id: string | null): string {
  const player = useLiveQuery(() => (id ? db.players.get(id) : undefined), [id])
  return player?.name ?? "TBD"
}

export function MatchControl({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const match = useLiveQuery(() => db.matches.get(matchId), [matchId])
  const [history, setHistory] = useState<(1 | 2)[]>([])
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmUndoLast, setConfirmUndoLast] = useState(false)
  const { notify } = useToast()

  const p1Name = usePlayerName(match?.player1Id ?? null)
  const p2Name = usePlayerName(match?.player2Id ?? null)

  useEffect(() => {
    setHistory([])
  }, [matchId])

  if (!match) return null

  const decided = isValidCompletedScore(match.bestOf, match.player1Legs, match.player2Legs)
  const someoneWon = match.player1Legs >= match.legsToWin || match.player2Legs >= match.legsToWin

  async function winLeg(slot: 1 | 2) {
    if (!match || someoneWon) return
    const patch =
      slot === 1 ? { player1Legs: match.player1Legs + 1 } : { player2Legs: match.player2Legs + 1 }
    await db.matches.update(match.id, { ...patch, status: "in_progress", updatedAt: new Date().toISOString() })
    setHistory((h) => [...h, slot])
  }

  async function undoLastLeg() {
    if (!match || history.length === 0) return
    const last = history[history.length - 1]
    const patch = last === 1 ? { player1Legs: Math.max(0, match.player1Legs - 1) } : { player2Legs: Math.max(0, match.player2Legs - 1) }
    await db.matches.update(match.id, { ...patch, updatedAt: new Date().toISOString() })
    setHistory((h) => h.slice(0, -1))
  }

  async function resetCurrentMatch() {
    if (!match) return
    await db.matches.update(match.id, {
      player1Legs: 0,
      player2Legs: 0,
      status: "pending",
      updatedAt: new Date().toISOString(),
    })
    setHistory([])
    setConfirmReset(false)
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
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="min-h-11" onClick={onClose}>
          Back
        </Button>
        <span className="text-sm text-muted-foreground">Best of {match.bestOf} · first to {match.legsToWin}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-4">
          <span className="truncate text-center font-medium">{p1Name}</span>
          <span className="text-4xl font-bold tabular-nums">{match.player1Legs}</span>
          <Button className="min-h-11 w-full" disabled={someoneWon} onClick={() => winLeg(1)}>
            {p1Name} Wins Leg
          </Button>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-4">
          <span className="truncate text-center font-medium">{p2Name}</span>
          <span className="text-4xl font-bold tabular-nums">{match.player2Legs}</span>
          <Button className="min-h-11 w-full" disabled={someoneWon} onClick={() => winLeg(2)}>
            {p2Name} Wins Leg
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          className="min-h-11"
          disabled={!decided}
          onClick={handleConfirm}
        >
          Confirm Result
        </Button>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="min-h-11" disabled={history.length === 0} onClick={undoLastLeg}>
            Undo Last Leg
          </Button>
          <Button variant="outline" className="min-h-11" onClick={() => setConfirmReset(true)}>
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
