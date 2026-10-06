import { z } from "zod"
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

// looseObject: keeps every field of each row (fields added by newer app
// versions survive the round trip); only the identity fields are enforced.
const playerSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  active: z.boolean(),
})

const tournamentSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  status: z.string(),
})

const matchSchema = z.looseObject({
  id: z.string().min(1),
  tournamentId: z.string().min(1),
  status: z.string(),
})

const resultSchema = z.looseObject({
  id: z.string().min(1),
  tournamentId: z.string().min(1),
  playerId: z.string().min(1),
})

const settingsSchema = z.looseObject({ id: z.string().min(1) })

const backupFileSchema = z.object({
  schemaVersion: z.number(),
  createdAt: z.string(),
  data: z.object({
    players: z.array(playerSchema),
    tournaments: z.array(tournamentSchema),
    matches: z.array(matchSchema),
    results: z.array(resultSchema),
    settings: z.array(settingsSchema).default([]),
  }),
})

/** Parses and validates a backup file's shape/version, without writing
 * anything — callers should confirm with the user before calling replaceAll. */
export function parseBackupFile(json: string): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new BackupError("This file is not valid JSON")
  }
  const result = backupFileSchema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : ""
    throw new BackupError(`This file doesn't look like a Darts Tournament backup${where}`)
  }
  if (result.data.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError("This backup was created by a newer version of the app and can't be restored here")
  }
  return result.data as unknown as BackupFile
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
