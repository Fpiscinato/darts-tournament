import { db } from "./db"
import type { Player } from "./types"

export class PlayerError extends Error {}

function uid(): string {
  return crypto.randomUUID()
}

function normalize(name: string): string {
  return name.trim().toLowerCase()
}

async function assertNameAvailable(name: string, excludeId?: string): Promise<void> {
  const target = normalize(name)
  if (!target) throw new PlayerError("Name cannot be empty")
  const all = await db.players.toArray()
  const clash = all.some((p) => p.id !== excludeId && normalize(p.name) === target)
  if (clash) throw new PlayerError("A player with this name already exists")
}

export async function createPlayer(name: string, seed: number | null = null): Promise<Player> {
  await assertNameAvailable(name)
  const now = new Date().toISOString()
  const player: Player = {
    id: uid(),
    name: name.trim(),
    active: true,
    seed,
    createdAt: now,
    updatedAt: now,
  }
  await db.players.add(player)
  return player
}

export async function renamePlayer(id: string, name: string): Promise<void> {
  await assertNameAvailable(name, id)
  await db.players.update(id, { name: name.trim(), updatedAt: new Date().toISOString() })
}

export async function setPlayerSeed(id: string, seed: number | null): Promise<void> {
  await db.players.update(id, { seed, updatedAt: new Date().toISOString() })
}

export async function setPlayerActive(id: string, active: boolean): Promise<void> {
  await db.players.update(id, { active, updatedAt: new Date().toISOString() })
}

async function hasParticipated(id: string): Promise<boolean> {
  const count = await db.matches.filter((m) => m.player1Id === id || m.player2Id === id).count()
  return count > 0
}

/** Deletes the player outright if they never participated in a match;
 * otherwise archives (deactivates) them instead, since deleting would
 * corrupt historical results. */
export async function deleteOrArchivePlayer(id: string): Promise<"deleted" | "archived"> {
  if (await hasParticipated(id)) {
    await setPlayerActive(id, false)
    return "archived"
  }
  await db.players.delete(id)
  return "deleted"
}
