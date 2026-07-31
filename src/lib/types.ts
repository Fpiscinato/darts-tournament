export type BestOf = 3 | 5 | 7

export type TournamentType = "league" | "knockout"
export type TournamentStatus = "draft" | "active" | "completed"

export type LeagueFinalsFormat = "top4_knockout" | "top4_round_robin" | "direct_final" | "league_winner"
export type DrawMethod = "random" | "seeded" | "manual"

/** Which stage a match belongs to. "knockout" is used both for standalone
 * Knockout tournaments and for the top4_knockout finals format. */
export type Stage = "league" | "top4" | "final" | "knockout"

export interface StageFormats {
  league?: BestOf
  top4?: BestOf
  knockout?: BestOf
  final?: BestOf
}

export interface Player {
  id: string
  name: string
  active: boolean
  seed: number | null
  createdAt: string
  updatedAt: string
}

export interface Tournament {
  id: string
  name: string
  type: TournamentType
  status: TournamentStatus
  playerIds: string[]
  /** Only meaningful when type === "league". */
  finalsFormat: LeagueFinalsFormat | null
  /** Only meaningful when type === "knockout". */
  drawMethod: DrawMethod | null
  stageFormats: StageFormats
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export type MatchStatus = "pending" | "in_progress" | "completed"

export interface Match {
  id: string
  tournamentId: string
  stage: Stage
  round: number
  bracketPosition: number
  player1Id: string | null
  player2Id: string | null
  player1Legs: number
  player2Legs: number
  winnerId: string | null
  status: MatchStatus
  bestOf: BestOf
  legsToWin: number
  /** Knockout-only: where the winner of this match feeds into. */
  nextMatchId: string | null
  nextMatchSlot: 1 | 2 | null
  confirmedAt: string | null
  createdAt: string
  updatedAt: string
}

/** One row per player per tournament — never one row per tournament. */
export interface TournamentPlayerResult {
  id: string
  tournamentId: string
  playerId: string
  position: number | null
  matchWins: number
  matchLosses: number
  points: number
  legsFor: number
  legsAgainst: number
  playoffRequired: boolean
  titleWon: boolean
  createdAt: string
}

export interface AppSettings {
  id: string
  schemaVersion: number
  theme: "light" | "dark" | "system"
}

export const SCHEMA_VERSION = 1
