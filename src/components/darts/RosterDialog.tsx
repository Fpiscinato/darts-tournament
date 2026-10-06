import { useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { rejoinPlayer, withdrawPlayer, withdrawnPlayerIds } from "@/lib/engine"
import type { Tournament } from "@/lib/types"
import { useToast } from "@/context/ToastContext"
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface PendingAction {
  mode: "withdraw" | "rejoin"
  playerId: string
  name: string
}

export function RosterDialog({
  open,
  onOpenChange,
  tournament,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tournament: Tournament
}) {
  const { notify } = useToast()
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)

  const players = useLiveQuery(
    () => db.players.bulkGet(tournament.playerIds),
    [tournament.playerIds.join(","), tournament.id],
  )

  const withdrawn = new Set(withdrawnPlayerIds(tournament))
  const isActive = tournament.status === "active"
  const nameOf = (id: string) => players?.find((p) => p?.id === id)?.name ?? "…"

  async function applyAction() {
    if (!pending) return
    setBusy(true)
    try {
      const result =
        pending.mode === "withdraw"
          ? await withdrawPlayer(tournament.id, pending.playerId)
          : await rejoinPlayer(tournament.id, pending.playerId)
      if (result.ok) {
        notify(
          pending.mode === "withdraw"
            ? `${pending.name} withdrew — unfinished matches awarded as walkovers`
            : `${pending.name} is back in the tournament`,
        )
      } else {
        notify(result.reason ?? "Could not update the player", "destructive")
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not update the player", "destructive")
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Players</DialogTitle>
            <DialogDescription>
              {isActive
                ? "If someone has to leave, withdraw them: their results so far stay on the board and their remaining matches become walkovers. They can rejoin later."
                : "Withdrawals are only available while the tournament is active."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            {tournament.playerIds.map((id) => {
              const isOut = withdrawn.has(id)
              return (
                <div
                  key={id}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{nameOf(id)}</span>
                    {isOut && <Badge variant="destructive">Withdrawn</Badge>}
                  </div>
                  {!isOut ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 text-destructive"
                      disabled={!isActive}
                      onClick={() => setPending({ mode: "withdraw", playerId: id, name: nameOf(id) })}
                    >
                      Withdraw
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11"
                      disabled={!isActive}
                      onClick={() => setPending({ mode: "rejoin", playerId: id, name: nameOf(id) })}
                    >
                      Rejoin
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.mode === "withdraw" ? `Withdraw ${pending.name}?` : `Bring ${pending?.name} back?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.mode === "withdraw" ? (
                <>
                  Every result <strong>{pending.name}</strong> already earned stays on the board. Their unfinished
                  matches are awarded to the opponent as a walkover (0–0, no legs), so tables and brackets keep
                  moving. You can bring them back while the tournament is active.
                </>
              ) : (
                <>
                  Every match the withdrawal resolved goes back to exactly how it was, including any half-played
                  score. A finals stage generated from a table that changed will be rebuilt.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction className="min-h-11" disabled={busy} onClick={applyAction}>
              {busy ? "Working…" : pending?.mode === "withdraw" ? "Withdraw" : "Rejoin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
