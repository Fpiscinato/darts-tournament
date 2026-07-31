import Dexie, { type EntityTable } from "dexie"
import type { AppSettings, Match, Player, Tournament, TournamentPlayerResult } from "./types"
import { SCHEMA_VERSION } from "./types"

export class DartsDB extends Dexie {
  players!: EntityTable<Player, "id">
  tournaments!: EntityTable<Tournament, "id">
  matches!: EntityTable<Match, "id">
  results!: EntityTable<TournamentPlayerResult, "id">
  settings!: EntityTable<AppSettings, "id">

  constructor() {
    super("darts-tournament")
    this.version(1).stores({
      players: "id, name, active",
      tournaments: "id, status, type, createdAt",
      matches: "id, tournamentId, stage, status, round, [tournamentId+stage], [tournamentId+round]",
      results: "id, tournamentId, playerId",
      settings: "id",
    })
  }
}

export const db = new DartsDB()

const DEFAULT_PLAYERS = [
  "Alex", "Bianca", "Carlos", "Diana", "Erik", "Fabio", "Gina", "Hugo", "Ivy",
]

function uid(): string {
  return crypto.randomUUID()
}

/** Seeds the 9 default players only on the very first run ever (detected by
 * the absence of the settings row) — not whenever the players table happens
 * to be empty, so a Full Reset or bulk-delete doesn't bring them back. */
export async function ensureSeeded(): Promise<void> {
  const settings = await db.settings.get("settings")
  if (settings) return

  const now = new Date().toISOString()
  await db.players.bulkAdd(
    DEFAULT_PLAYERS.map((name) => ({
      id: uid(),
      name,
      active: true,
      seed: null,
      createdAt: now,
      updatedAt: now,
    })),
  )
  await db.settings.put({ id: "settings", schemaVersion: SCHEMA_VERSION, theme: "system" })
}
