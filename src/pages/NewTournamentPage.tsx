import { useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"
import { orderPlayersForDraw, startTournament } from "@/lib/engine"
import { useToast } from "@/context/ToastContext"
import { BEST_OF_OPTIONS } from "@/lib/format"
import type { BestOf, DrawMethod, LeagueFinalsFormat, Tournament, TournamentType } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const FINALS_FORMATS: { value: LeagueFinalsFormat; label: string; hasTop4: boolean; hasFinal: boolean }[] = [
  { value: "top4_round_robin", label: "Top 4 Round Robin (recommended)", hasTop4: true, hasFinal: true },
  { value: "top4_knockout", label: "Top 4 Knockout", hasTop4: true, hasFinal: true },
  { value: "direct_final", label: "Direct Final (1st vs 2nd)", hasTop4: false, hasFinal: true },
  { value: "league_winner", label: "League Winner (table only, no final)", hasTop4: false, hasFinal: false },
]

function uid(): string {
  return crypto.randomUUID()
}

function Hint({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null
  return <span className="text-xs font-medium text-destructive">{children}</span>
}

function BestOfSelect({ label, value, onChange }: { label: string; value: BestOf; onChange: (v: BestOf) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v) as BestOf)}>
        <SelectTrigger className="min-h-11 w-full">
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
  const [typeTouched, setTypeTouched] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [finalsFormat, setFinalsFormat] = useState<LeagueFinalsFormat>("top4_round_robin")
  const [drawMethod, setDrawMethod] = useState<DrawMethod>("random")
  const [leagueBestOf, setLeagueBestOf] = useState<BestOf>(3)
  const [top4BestOf, setTop4BestOf] = useState<BestOf>(3)
  const [finalBestOf, setFinalBestOf] = useState<BestOf>(5)
  const [knockoutBestOf, setKnockoutBestOf] = useState<BestOf>(5)
  const [creating, setCreating] = useState(false)

  if (!players) return null

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 16 ? [...prev, id] : prev))
  }

  const canCreate = name.trim().length > 0 && selected.length >= 2 && selected.length <= 16

  const format = FINALS_FORMATS.find((f) => f.value === finalsFormat)!

  async function handleCreate() {
    if (!canCreate || !players) return
    setCreating(true)
    try {
      const tournament: Tournament = {
        id: uid(),
        name: name.trim(),
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
            <Hint show={name.trim().length === 0}>Type a name</Hint>
          </div>
          <Input id="tournament-name" value={name} onChange={(e) => setName(e.target.value)} className="min-h-11" />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label>Type</Label>
            <Hint show={!typeTouched}>Select a type</Hint>
          </div>
          <Tabs
            value={type}
            onValueChange={(v) => {
              setType(v as TournamentType)
              setTypeTouched(true)
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="league" className="min-h-11">
                League
              </TabsTrigger>
              <TabsTrigger value="knockout" className="min-h-11">
                Knockout
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label>
              Players ({selected.length}/16, min 2)
            </Label>
            <Hint show={selected.length === 0}>Click the players</Hint>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={`min-h-11 rounded-md border px-3 py-2 text-sm ${
                  selected.includes(p.id) ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {type === "league" && (
          <>
            <div className="flex flex-col gap-2">
              <Label>Finals format</Label>
              <Select value={finalsFormat} onValueChange={(v) => setFinalsFormat(v as LeagueFinalsFormat)}>
                <SelectTrigger className="min-h-11 w-full">
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
            <BestOfSelect label="League match format" value={leagueBestOf} onChange={setLeagueBestOf} />
            {format.hasTop4 && <BestOfSelect label="Top 4 match format" value={top4BestOf} onChange={setTop4BestOf} />}
            {format.hasFinal && <BestOfSelect label="Final match format" value={finalBestOf} onChange={setFinalBestOf} />}
          </>
        )}

        {type === "knockout" && (
          <>
            <div className="flex flex-col gap-2">
              <Label>Draw method</Label>
              <Select value={drawMethod} onValueChange={(v) => setDrawMethod(v as DrawMethod)}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="random">Random</SelectItem>
                  <SelectItem value="seeded">Seeded (by player seed)</SelectItem>
                  <SelectItem value="manual">Manual (selection order)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <BestOfSelect label="Match format" value={knockoutBestOf} onChange={setKnockoutBestOf} />
          </>
        )}

        <Button className="min-h-11" disabled={!canCreate || creating} onClick={handleCreate}>
          {creating ? "Creating…" : "Create & start"}
        </Button>
      </div>
    </div>
  )
}
