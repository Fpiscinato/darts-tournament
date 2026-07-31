import type { BestOf } from "./types"

export const BEST_OF_OPTIONS: BestOf[] = [3, 5, 7]

export function legsToWin(bestOf: BestOf): number {
  return Math.ceil(bestOf / 2)
}

/** A completed leg score is valid iff exactly one side has reached
 * legsToWin and the other has strictly fewer legs (draws are impossible). */
export function isValidCompletedScore(bestOf: BestOf, player1Legs: number, player2Legs: number): boolean {
  const need = legsToWin(bestOf)
  if (player1Legs < 0 || player2Legs < 0) return false
  const p1Wins = player1Legs === need && player2Legs < need
  const p2Wins = player2Legs === need && player1Legs < need
  return p1Wins || p2Wins
}

export function winnerSlot(player1Legs: number, player2Legs: number): 1 | 2 | null {
  if (player1Legs > player2Legs) return 1
  if (player2Legs > player1Legs) return 2
  return null
}
