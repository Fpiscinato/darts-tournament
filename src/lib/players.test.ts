import { beforeEach, describe, expect, it } from "vitest"
import { db } from "./db"
import { confirmMatch, startTournament } from "./engine"
import { PlayerError, createPlayer, deleteOrArchivePlayer, renamePlayer, setPlayerActive } from "./players"

beforeEach(async () => {
  await db.players.clear()
  await db.tournaments.clear()
  await db.matches.clear()
  await db.results.clear()
})

describe("createPlayer", () => {
  it("prevents duplicate names (case-insensitive, trimmed)", async () => {
    await createPlayer("Alex")
    await expect(createPlayer("  alex ")).rejects.toThrow(PlayerError)
  })

  it("rejects empty names", async () => {
    await expect(createPlayer("   ")).rejects.toThrow(PlayerError)
  })
})

describe("renamePlayer", () => {
  it("allows renaming to a currently-unused name", async () => {
    const a = await createPlayer("Alex")
    await renamePlayer(a.id, "Alexandra")
    const updated = await db.players.get(a.id)
    expect(updated?.name).toBe("Alexandra")
  })

  it("still allows keeping your own name unchanged", async () => {
    const a = await createPlayer("Alex")
    await expect(renamePlayer(a.id, "Alex")).resolves.toBeUndefined()
  })
})

describe("deleteOrArchivePlayer", () => {
  it("deletes a player who never played a match", async () => {
    const a = await createPlayer("Alex")
    const result = await deleteOrArchivePlayer(a.id)
    expect(result).toBe("deleted")
    expect(await db.players.get(a.id)).toBeUndefined()
  })

  it("archives (deactivates) instead of deleting once a player has match history", async () => {
    const a = await createPlayer("Alex")
    const b = await createPlayer("Bianca")
    await db.tournaments.add({
      id: "t1",
      name: "Cup",
      type: "league",
      status: "draft",
      playerIds: [a.id, b.id],
      finalsFormat: "league_winner",
      drawMethod: null,
      stageFormats: { league: 3 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    })
    await startTournament("t1")
    const [match] = await db.matches.where({ tournamentId: "t1" }).toArray()
    await confirmMatch(match.id, 2, 0)

    const result = await deleteOrArchivePlayer(a.id)
    expect(result).toBe("archived")
    const player = await db.players.get(a.id)
    expect(player?.active).toBe(false)
  })
})

describe("setPlayerActive", () => {
  it("toggles active state", async () => {
    const a = await createPlayer("Alex")
    await setPlayerActive(a.id, false)
    expect((await db.players.get(a.id))?.active).toBe(false)
    await setPlayerActive(a.id, true)
    expect((await db.players.get(a.id))?.active).toBe(true)
  })
})
