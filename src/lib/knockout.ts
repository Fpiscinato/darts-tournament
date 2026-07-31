export function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

export function byeCount(n: number): number {
  return nextPowerOfTwo(n) - n
}

/** Standard recursive bracket-seeding order: for a size-N bracket, returns
 * seed numbers (1-indexed) in bracket-slot order such that seed 1 and seed
 * 2 always land in opposite halves, seed 1 and seed 3 in opposite quarters,
 * etc. e.g. seedPositions(8) => [1,8,4,5,2,7,3,6]. */
export function seedPositions(size: number): number[] {
  let result = [1]
  while (result.length < size) {
    const n = result.length * 2
    const next: number[] = []
    for (const s of result) {
      next.push(s, n + 1 - s)
    }
    result = next
  }
  return result
}

export interface KnockoutMatchSeed {
  round: number
  bracketPosition: number
  player1Id: string | null
  player2Id: string | null
  isBye: boolean
}

/** orderedPlayerIds must already reflect the desired seed order (best/seed-1
 * first) — random, seeded, and manual draw methods all reduce to producing
 * this order before calling in. Byes are always given to the top seeds. */
export function generateKnockoutRound1(orderedPlayerIds: string[]): KnockoutMatchSeed[] {
  const n = orderedPlayerIds.length
  const size = nextPowerOfTwo(n)
  const positions = seedPositions(size)

  const seedToPlayer = new Map<number, string | null>()
  for (let seed = 1; seed <= size; seed++) {
    seedToPlayer.set(seed, seed <= n ? orderedPlayerIds[seed - 1] : null)
  }

  const matches: KnockoutMatchSeed[] = []
  for (let i = 0; i < size / 2; i++) {
    const seedA = positions[i * 2]
    const seedB = positions[i * 2 + 1]
    const player1Id = seedToPlayer.get(seedA) ?? null
    const player2Id = seedToPlayer.get(seedB) ?? null
    matches.push({
      round: 1,
      bracketPosition: i + 1,
      player1Id,
      player2Id,
      isBye: player1Id === null || player2Id === null,
    })
  }
  return matches
}

export function totalRounds(playerCount: number): number {
  return Math.log2(nextPowerOfTwo(playerCount))
}

export function roundName(round: number, totalRoundsCount: number): string {
  const distance = totalRoundsCount - round
  switch (distance) {
    case 0:
      return "Final"
    case 1:
      return "Semi-final"
    case 2:
      return "Quarter-final"
    default:
      return `Round of ${2 ** (distance + 1)}`
  }
}
