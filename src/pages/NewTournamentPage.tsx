import { useState, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { orderPlayersForDraw, startTournament } from "@/lib/engine"
import { useToast } from "@/context/ToastContext"
import { BEST_OF_OPTIONS } from "@/lib/format"
import type { BestOf, DrawMethod, LeagueFinalsFormat, Tournament, TournamentType } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageSkeleton } from "@/components/darts/PageSkeleton"
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

const FINALS_FORMATS: { value: LeagueFinalsFormat; label: string; hasTop4: boolean; hasFinal: boolean }[] = [
  { value: "top4_round_robin", label: "Top 4 Round Robin (recommended)", hasTop4: true, hasFinal: true },
  { value: "top4_knockout", label: "Top 4 Knockout", hasTop4: true, hasFinal: true },
  { value: "direct_final", label: "Direct Final (1st vs 2nd)", hasTop4: false, hasFinal: true },
  { value: "league_winner", label: "League Winner (table only, no final)", hasTop4: false, hasFinal: false },
]

function uid(): string {
  return crypto.randomUUID()
}

/** Fallback name when the user leaves the field blank — date only, so the
 * same name never appears twice and no clock time leaks into the share image. */
function defaultTournamentName(): string {
  const stamp = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date())
  return `Darts Cup ${stamp}`
}

function Hint({ show, children, tone = "muted" }: { show: boolean; children: ReactNode; tone?: "muted" | "destructive" }) {
  if (!show) return null
  return (
    <span className={tone === "destructive" ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
      {children}
    </span>
  )
}

function BestOfSelect({
  label,
  id,
  value,
  onChange,
}: {
  label: string
  id: string
  value: BestOf
  onChange: (v: BestOf) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v) as BestOf)}>
        <SelectTrigger id={id} className="min-h-11 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BEST_OF_OPTIONS.map((bo) => (
            <SelectItem key={bo} value={String(bo)}>
              Best of {bo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function NewTournamentPage() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const players = useLiveQuery(() => db.players.filter((p) => p.active).sortBy("name"), [])

  const [name, setName] = useState("")
  const [type, setType] = useState<TournamentType>("league")
  const [selected, setSelected] = useState<string[]>([])
  const [finalsFormat, setFinalsFormat] = useState<LeagueFinalsFormat>("top4_round_robin")
  const [drawMethod, setDrawMethod] = useState<DrawMethod>("random")
  const [leagueBestOf, setLeagueBestOf] = useState<BestOf>(3)
  const [top4BestOf, setTop4BestOf] = useState<BestOf>(3)
  const [finalBestOf, setFinalBestOf] = useState<BestOf>(5)
  const [knockoutBestOf, setKnockoutBestOf] = useState<BestOf>(5)
  const [creating, setCreating] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  if (!players) return <PageSkeleton rows={5} className="mx-auto max-w-2xl px-4 py-6" />

  const isDirty = name.trim().length > 0 || selected.length > 0

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 16 ? [...prev, id] : prev))
  }

  const canCreate = selected.length >= 2 && selected.length <= 16

  const format = FINALS_FORMATS.find((f) => f.value === finalsFormat)!

  function handleCancel() {
    if (isDirty) setCancelConfirm(true)
    else navigate(-1)
  }

  async function handleCreate() {
    if (!canCreate || !players) return
    setCreating(true)
    let createdId: string | null = null
    try {
      const tournament: Tournament = {
        id: uid(),
        name: name.trim() || defaultTournamentName(),
        type,
        status: "draft",
        playerIds: selected,
        finalsFormat: type === "league" ? finalsFormat : null,
        drawMethod: type === "knockout" ? drawMethod : null,
        stageFormats:
          type === "league"
            ? { league: leagueBestOf, ...(format.hasTop4 ? { top4: top4BestOf } : {}), ...(format.hasFinal ? { final: finalBestOf } : {}) }
            : { knockout: knockoutBestOf },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      }
      createdId = tournament.id
      await db.tournaments.add(tournament)

      if (type === "knockout") {
        const seedLookup = (id: string) => players.find((p) => p.id === id)?.seed ?? null
        const ordered = orderPlayersForDraw(selected, drawMethod, seedLookup)
        await startTournament(tournament.id, { orderedPlayerIds: ordered })
      } else {
        await startTournament(tournament.id)
      }

      notify(`${tournament.name} started`)
      navigate(`/tournaments/${tournament.id}`)
    } catch (err) {
      if (createdId) {
        try {
          const created = await db.tournaments.get(createdId)
          if (created?.status === "draft") await db.tournaments.delete(createdId)
        } catch {
          // best-effort cleanup of the failed draft
        }
      }
      notify(err instanceof Error ? err.message : "Could not create the tournament", "destructive")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">New tournament</h1>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="tournament-name">Name</Label>
            <Hint show={name.trim().length === 0}>leave blank to auto-generate</Hint>
          </div>
          <Input id="tournament-name" value={name} onChange={(e) => setName(e.target.value)} className="min-h-11" />
        </div>

        <div className="flex flex-col gap-2">
          <Label id="tournament-type-label">Type</Label>
          <div role="radiogroup" aria-labelledby="tournament-type-label" className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "league", label: "League" },
                { value: "knockout", label: "Knockout" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={type === option.value}
                aria-pressed={type === option.value}
                onClick={() => setType(option.value)}
                className={`min-h-11 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  type === option.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label>
              Players ({selected.length}/16, min 2)
            </Label>
            <Hint show={players.length === 0}>No active players yet</Hint>
            <Hint show={players.length > 0 && selected.length === 0}>Pick the players</Hint>
            <Hint show={selected.length === 16} tone="destructive">
              16-player limit reached
            </Hint>
          </div>
          {players.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="mb-4 text-sm text-muted-foreground">Add players before creating a tournament.</p>
              <Button asChild variant="outline">
                <Link to="/players">Add players</Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={selected.includes(p.id)}
                  onClick={() => toggle(p.id)}
                  className={`min-h-11 rounded-md border px-3 py-2 text-sm ${
                    selected.includes(p.id) ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {type === "league" && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="finals-format">Finals format</Label>
              <Select value={finalsFormat} onValueChange={(v) => setFinalsFormat(v as LeagueFinalsFormat)}>
                <SelectTrigger id="finals-format" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FINALS_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <BestOfSelect id="league-best-of" label="League match format" value={leagueBestOf} onChange={setLeagueBestOf} />
            {format.hasTop4 && (
              <BestOfSelect id="top4-best-of" label="Top 4 match format" value={top4BestOf} onChange={setTop4BestOf} />
            )}
            {format.hasFinal && (
              <BestOfSelect id="final-best-of" label="Final match format" value={finalBestOf} onChange={setFinalBestOf} />
            )}
          </>
        )}

        {type === "knockout" && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="draw-method">Draw method</Label>
              <Select value={drawMethod} onValueChange={(v) => setDrawMethod(v as DrawMethod)}>
                <SelectTrigger id="draw-method" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="random">Random</SelectItem>
                  <SelectItem value="seeded">Seeded (by player seed)</SelectItem>
                  <SelectItem value="manual">Manual (selection order)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <BestOfSelect id="knockout-best-of" label="Match format" value={knockoutBestOf} onChange={setKnockoutBestOf} />
          </>
        )}

        <div className="flex gap-2">
          <Button className="min-h-11 flex-1" disabled={!canCreate || creating} onClick={handleCreate}>
            {creating ? "Creating…" : "Create & start"}
          </Button>
          <Button className="min-h-11" variant="outline" disabled={creating} onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      </div>

      <AlertDialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this tournament?</AlertDialogTitle>
            <AlertDialogDescription>Your name and player selection will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate(-1)}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
