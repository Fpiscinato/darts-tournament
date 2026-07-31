import { db, ensureSeeded } from "./db"
import { SCHEMA_VERSION } from "./types"
import type { AppSettings, Match, Player, Tournament, TournamentPlayerResult } from "./types"

export class BackupError extends Error {}

export interface BackupFile {
  schemaVersion: number
  createdAt: string
  data: {
    players: Player[]
    tournaments: Tournament[]
    matches: Match[]
    results: TournamentPlayerResult[]
    settings: AppSettings[]
  }
}

export async function exportBackup(): Promise<BackupFile> {
  const [players, tournaments, matches, results, settings] = await Promise.all([
    db.players.toArray(),
    db.tournaments.toArray(),
    db.matches.toArray(),
    db.results.toArray(),
    db.settings.toArray(),
  ])
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    data: { players, tournaments, matches, results, settings },
  }
}

function isBackupFile(value: unknown): value is BackupFile {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.schemaVersion !== "number" || typeof v.createdAt !== "string") return false
  if (typeof v.data !== "object" || v.data === null) return false
  const d = v.data as Record<string, unknown>
  return Array.isArray(d.players) && Array.isArray(d.tournaments) && Array.isArray(d.matches) && Array.isArray(d.results)
}

/** Parses and validates a backup file's shape/version, without writing
 * anything — callers should confirm with the user before calling replaceAll. */
export function parseBackupFile(json: string): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new BackupError("This file is not valid JSON")
  }
  if (!isBackupFile(parsed)) {
    throw new BackupError("This file doesn't look like a Darts Tournament backup")
  }
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError("This backup was created by a newer version of the app and can't be restored here")
  }
  return parsed
}

export async function replaceAllWithBackup(backup: BackupFile): Promise<void> {
  await db.transaction("rw", db.players, db.tournaments, db.matches, db.results, db.settings, async () => {
    await Promise.all([
      db.players.clear(),
      db.tournaments.clear(),
      db.matches.clear(),
      db.results.clear(),
      db.settings.clear(),
    ])
    await Promise.all([
      db.players.bulkAdd(backup.data.players),
      db.tournaments.bulkAdd(backup.data.tournaments),
      db.matches.bulkAdd(backup.data.matches),
      db.results.bulkAdd(backup.data.results),
      backup.data.settings.length > 0
        ? db.settings.bulkAdd(backup.data.settings)
        : db.settings.add({ id: "settings", schemaVersion: SCHEMA_VERSION, theme: "system" }),
    ])
  })
}

/** Wipes everything and puts the app back to a just-installed state,
 * including reseeding the default players — the same state you'd see
 * opening the app for the very first time. */
export async function fullReset(): Promise<void> {
  await db.transaction("rw", db.players, db.tournaments, db.matches, db.results, db.settings, async () => {
    await Promise.all([
      db.players.clear(),
      db.tournaments.clear(),
      db.matches.clear(),
      db.results.clear(),
      db.settings.clear(),
    ])
  })
  await ensureSeeded()
}
