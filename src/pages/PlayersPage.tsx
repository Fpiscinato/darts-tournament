import { useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { db } from "@/lib/db"
import { PlayerError, createPlayer, deleteOrArchivePlayer, renamePlayer, setPlayerActive } from "@/lib/players"
import { useToast } from "@/context/ToastContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import type { Player } from "@/lib/types"

function AddPlayerDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const { notify } = useToast()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await createPlayer(name)
      notify(`${name.trim()} added`)
      setName("")
      setError(null)
      setOpen(false)
    } catch (err) {
      setError(err instanceof PlayerError ? err.message : "Could not add player")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button className="min-h-11" onClick={() => setOpen(true)}>
        <Plus /> Add Player
      </Button>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add player</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="new-player-name">Name</Label>
            <Input
              id="new-player-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-11"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="mt-4">
            <Button type="submit" className="min-h-11" disabled={!name.trim()}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditPlayerDialog({ player, onClose }: { player: Player; onClose: () => void }) {
  const [name, setName] = useState(player.name)
  const [seed, setSeed] = useState(player.seed?.toString() ?? "")
  const [error, setError] = useState<string | null>(null)
  const { notify } = useToast()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await renamePlayer(player.id, name)
      const parsedSeed = seed.trim() === "" ? null : Number(seed)
      await db.players.update(player.id, { seed: parsedSeed, updatedAt: new Date().toISOString() })
      notify("Player updated")
      onClose()
    } catch (err) {
      setError(err instanceof PlayerError ? err.message : "Could not update player")
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit player</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-player-name">Name</Label>
              <Input id="edit-player-name" value={name} onChange={(e) => setName(e.target.value)} className="min-h-11" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-player-seed">Seed (optional)</Label>
              <Input
                id="edit-player-seed"
                type="number"
                min={1}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="min-h-11"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="mt-4">
            <Button type="submit" className="min-h-11" disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PlayerRow({ player }: { player: Player }) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { notify } = useToast()

  async function handleDelete() {
    const result = await deleteOrArchivePlayer(player.id)
    notify(result === "deleted" ? `${player.name} deleted` : `${player.name} archived (has match history)`)
    setConfirmDelete(false)
  }

  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-0">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium">{player.name}</span>
        {player.seed !== null && <Badge variant="outline">Seed {player.seed}</Badge>}
        {!player.active && <Badge variant="secondary">Archived</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={player.active}
          onCheckedChange={(v) => setPlayerActive(player.id, v)}
          aria-label={player.active ? "Deactivate" : "Activate"}
        />
        <Button variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={() => setEditing(true)} aria-label="Edit">
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 text-destructive"
          onClick={() => setConfirmDelete(true)}
          aria-label="Delete"
        >
          <Trash2 />
        </Button>
      </div>

      {editing && <EditPlayerDialog player={player} onClose={() => setEditing(false)} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {player.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              If this player never played a match, they'll be deleted permanently. If they have match history,
              they'll be archived instead so past results stay intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={handleDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function PlayersPage() {
  const players = useLiveQuery(() => db.players.orderBy("name").toArray(), [])

  if (!players) return null

  const active = players.filter((p) => p.active)
  const archived = players.filter((p) => !p.active)

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Players</h1>
        <AddPlayerDialog />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Active ({active.length})</h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active players yet.</p>
        ) : (
          <div className="rounded-lg border border-border px-4">
            {active.map((p) => (
              <PlayerRow key={p.id} player={p} />
            ))}
          </div>
        )}
      </section>

      {archived.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Archived ({archived.length})</h2>
          <div className="rounded-lg border border-border px-4">
            {archived.map((p) => (
              <PlayerRow key={p.id} player={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
