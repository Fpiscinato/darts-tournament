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
  it("wipes all data and does not reseed default players afterwards", async () => {
    await ensureSeeded()
    expect(await db.players.count()).toBe(9)

    await fullReset()
    expect(await db.players.count()).toBe(0)

    await ensureSeeded()
    expect(await db.players.count()).toBe(0) // stays empty — not a "first run" anymore
  })
})
