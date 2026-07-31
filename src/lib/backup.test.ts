import { beforeEach, describe, expect, it } from "vitest"
import { db } from "./db"
import { ensureSeeded } from "./db"
import { BackupError, exportBackup, fullReset, parseBackupFile, replaceAllWithBackup } from "./backup"
import { createPlayer } from "./players"

beforeEach(async () => {
  await db.players.clear()
  await db.tournaments.clear()
  await db.matches.clear()
  await db.results.clear()
  await db.settings.clear()
})

describe("export / import round trip", () => {
  it("restores exactly what was exported", async () => {
    await createPlayer("Alex")
    await createPlayer("Bianca")
    const backup = await exportBackup()
    expect(backup.data.players.length).toBe(2)

    await db.players.clear()
    expect(await db.players.count()).toBe(0)

    const parsed = parseBackupFile(JSON.stringify(backup))
    await replaceAllWithBackup(parsed)
    expect(await db.players.count()).toBe(2)
  })
})

describe("parseBackupFile", () => {
  it("rejects invalid JSON", () => {
    expect(() => parseBackupFile("not json")).toThrow(BackupError)
  })

  it("rejects a file that isn't a backup", () => {
    expect(() => parseBackupFile(JSON.stringify({ hello: "world" }))).toThrow(BackupError)
  })

  it("rejects a backup from a newer schema version", () => {
    const future = { schemaVersion: 999, createdAt: new Date().toISOString(), data: { players: [], tournaments: [], matches: [], results: [], settings: [] } }
    expect(() => parseBackupFile(JSON.stringify(future))).toThrow(BackupError)
  })
})

describe("fullReset", () => {
  it("wipes all data and puts the app back to a just-installed state", async () => {
    await ensureSeeded()
    const originalIds = (await db.players.toArray()).map((p) => p.id).sort()
    expect(originalIds.length).toBe(9)

    const t = {
      id: "t1",
      name: "Cup",
      type: "league" as const,
      status: "draft" as const,
      playerIds: originalIds.slice(0, 2),
      finalsFormat: "league_winner" as const,
      drawMethod: null,
      stageFormats: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    }
    await db.tournaments.add(t)

    await fullReset()

    expect(await db.tournaments.count()).toBe(0)
    const freshPlayers = await db.players.toArray()
    expect(freshPlayers.length).toBe(9)
    // Genuinely fresh: new ids, not a resurrection of the old rows.
    expect(freshPlayers.some((p) => originalIds.includes(p.id))).toBe(false)
  })
})
