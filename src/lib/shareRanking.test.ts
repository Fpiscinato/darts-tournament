import { describe, expect, it } from "vitest"
import { buildRankingModel, drawRankingCard, typeLabelOf } from "./shareRanking"
import type { Player, Tournament, TournamentPlayerResult } from "./types"

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "t1",
    name: "Copa Darts 2026",
    type: "league",
    status: "completed",
    playerIds: ["p1", "p2", "p3"],
    withdrawals: [],
    finalsFormat: "league_winner",
    drawMethod: null,
    stageFormats: { league: 3 },
    createdAt: "2026-10-06T10:00:00.000Z",
    updatedAt: "2026-10-06T12:00:00.000Z",
    startedAt: "2026-10-06T10:00:00.000Z",
    completedAt: "2026-10-06T12:00:00.000Z",
    ...overrides,
  }
}

function makeResult(overrides: Partial<TournamentPlayerResult> = {}): TournamentPlayerResult {
  return {
    id: "r1",
    tournamentId: "t1",
    playerId: "p1",
    position: 1,
    matchWins: 2,
    matchLosses: 0,
    points: 4,
    legsFor: 5,
    legsAgainst: 1,
    playoffRequired: false,
    titleWon: true,
    withdrawn: false,
    createdAt: "2026-10-06T12:00:00.000Z",
    ...overrides,
  }
}

const players: Player[] = [
  { id: "p1", name: "Fernando", active: true, seed: null, createdAt: "", updatedAt: "" },
  { id: "p2", name: "João", active: true, seed: null, createdAt: "", updatedAt: "" },
  { id: "p3", name: "Maria", active: true, seed: null, createdAt: "", updatedAt: "" },
  { id: "p4", name: "Bruno", active: false, seed: null, createdAt: "", updatedAt: "" },
]

describe("buildRankingModel", () => {
  it("sorts by position and assigns medals and leg difference", () => {
    const model = buildRankingModel({
      tournament: makeTournament(),
      results: [
        makeResult({ playerId: "p1", position: 1, legsFor: 5, legsAgainst: 1 }),
        makeResult({ id: "r2", playerId: "p2", position: 2, matchWins: 1, matchLosses: 1, points: 2, legsFor: 3, legsAgainst: 4 }),
        makeResult({ id: "r3", playerId: "p3", position: 3, matchWins: 0, matchLosses: 2, points: 0, legsFor: 1, legsAgainst: 4, titleWon: false }),
      ],
      players,
    })

    expect(model.rows.map((r) => r.name)).toEqual(["Fernando", "João", "Maria"])
    expect(model.rows[0].medal).toBe("🥇")
    expect(model.rows[1].medal).toBe("🥈")
    expect(model.rows[2].medal).toBe("🥉")
    expect(model.rows.map((r) => r.legDiff)).toEqual([4, -1, -3])
    expect(model.rows[0].wonTitle).toBe(true)
    expect(model.dateLabel).toContain("Oct 2026")
  })

  it("includes a withdrawal footnote", () => {
    const model = buildRankingModel({
      tournament: makeTournament({
        withdrawals: [{ playerId: "p4", at: "2026-10-06T11:00:00.000Z", matches: [] }],
      }),
      results: [
        makeResult({ playerId: "p1", position: 1 }),
        makeResult({ id: "r2", playerId: "p4", position: 4, matchWins: 0, matchLosses: 2, points: 0, legsFor: 0, legsAgainst: 4, titleWon: false, withdrawn: true }),
      ],
      players,
    })

    expect(model.notes).toEqual(["⚠️ Bruno withdrew from the tournament"])
    expect(model.rows[1].withdrawn).toBe(true)
  })

  it("handles a knockout tournament label and a missing end date", () => {
    const knockout = buildRankingModel({
      tournament: makeTournament({ type: "knockout", finalsFormat: null, completedAt: null }),
      results: [],
      players,
    })
    expect(knockout.typeLabel).toBe("Knockout")
    expect(knockout.dateLabel).toBeNull()

    expect(typeLabelOf(makeTournament())).toBe("League")
  })
})

// ---------------------------------------------------------------------------
// Canvas layout. A mocked 2D context records every fillText call, so we can
// assert geometrically that nothing overlaps or runs off the card — the exact
// regressions that made the shared image look jumbled.
// ---------------------------------------------------------------------------

const CARD_LEFT = 92 // MARGIN + PAD
const CARD_RIGHT = 1108 // W - MARGIN - PAD

interface DrawCall {
  text: string
  x: number
  y: number
  align: string
}

function captureDraws(model: Parameters<typeof drawRankingCard>[1]): DrawCall[] {
  const draws: DrawCall[] = []
  const ctx = {
    fillStyle: "",
    font: "",
    lineWidth: 0,
    textAlign: "left",
    textBaseline: "alphabetic",
    scale: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    clip: () => {},
    restore: () => {},
    fillText: (text: string, x: number, y: number) => {
      draws.push({ text, x, y, align: ctx.textAlign })
    },
    measureText: (text: string) => ({ width: [...text].length * 16 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  }
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
  drawRankingCard(canvas, model)
  return draws
}

function bounds(d: DrawCall): [number, number] {
  const w = [...d.text].length * 16
  if (d.align === "right") return [d.x - w, d.x]
  if (d.align === "center") return [d.x - w / 2, d.x + w / 2]
  return [d.x, d.x + w]
}

function layoutModel() {
  const model = buildRankingModel({
    tournament: makeTournament({
      withdrawals: [{ playerId: "p4", at: "2026-10-06T11:00:00.000Z", matches: [] }],
    }),
    results: [
      makeResult({ playerId: "p1", position: 1, matchWins: 2, matchLosses: 0, points: 4, legsFor: 5, legsAgainst: 1 }),
      makeResult({ id: "r2", playerId: "p2", position: 2, matchWins: 1, matchLosses: 1, points: 2, legsFor: 3, legsAgainst: 3 }),
      makeResult({ id: "r3", playerId: "p3", position: 3, matchWins: 0, matchLosses: 2, points: 0, legsFor: 1, legsAgainst: 4, titleWon: false }),
      makeResult({ id: "r4", playerId: "p4", position: 4, matchWins: 0, matchLosses: 2, points: 0, legsFor: 0, legsAgainst: 4, titleWon: false, withdrawn: true }),
    ],
    players,
  })
  return model
}

describe("drawRankingCard layout", () => {
  it("keeps every text inside the card borders", () => {
    const draws = captureDraws(layoutModel())
    expect(draws.length).toBeGreaterThan(8)
    for (const d of draws) {
      const [start, end] = bounds(d)
      expect(start, `"${d.text}" starts left of the card`).toBeGreaterThanOrEqual(CARD_LEFT - 1)
      expect(end, `"${d.text}" ends right of the card`).toBeLessThanOrEqual(CARD_RIGHT + 1)
    }
  })

  it("never lets two texts on the same baseline overlap", () => {
    const draws = captureDraws(layoutModel())
    const byLine = new Map<number, DrawCall[]>()
    for (const d of draws) {
      const line = d.y
      byLine.set(line, [...(byLine.get(line) ?? []), d])
    }
    for (const [line, list] of byLine) {
      const sorted = list
        .map((d) => ({ d, start: bounds(d)[0], end: bounds(d)[1] }))
        .sort((a, b) => a.start - b.start)
      for (let i = 1; i < sorted.length; i++) {
        expect(
          sorted[i].start,
          `"${sorted[i - 1].d.text}" overlaps "${sorted[i].d.text}" on line y=${line}`,
        ).toBeGreaterThanOrEqual(sorted[i - 1].end - 0.5)
      }
    }
  })

  it("draws medals left-aligned in the Pos column, clear of the name column", () => {
    const draws = captureDraws(layoutModel())
    const medals = draws.filter((d) => ["🥇", "🥈", "🥉"].includes(d.text))
    expect(medals).toHaveLength(3)
    for (const m of medals) {
      expect(m.align).toBe("left")
      expect(m.x).toBe(CARD_LEFT)
      const [start, end] = bounds(m)
      expect(end).toBeLessThanOrEqual(CARD_LEFT + 64) // name column begins here
      expect(start).toBeGreaterThanOrEqual(CARD_LEFT)
    }
  })

  it("aligns every Pts value under its right-aligned header", () => {
    const draws = captureDraws(layoutModel())
    const ptsHeader = draws.find((d) => d.text === "Pts" && d.align === "right")
    expect(ptsHeader).toBeDefined()
    const values = draws.filter((d) => d.align === "right" && /^\d+$/.test(d.text))
    expect(values.length).toBeGreaterThanOrEqual(4)
    for (const v of values) expect(v.x).toBe(ptsHeader!.x)
  })
})