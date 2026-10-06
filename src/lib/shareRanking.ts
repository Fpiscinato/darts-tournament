import type { Player, Tournament, TournamentPlayerResult } from "./types"

export const MEDALS = ["🥇", "🥈", "🥉"]
const FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
const FORMAT_DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })

export interface RankingRow {
  position: number
  medal: string | null
  name: string
  wonTitle: boolean
  withdrawn: boolean
  wins: number
  losses: number
  points: number
  legDiff: number
}

export interface RankingModel {
  tournamentName: string
  typeLabel: string
  dateLabel: string | null
  rows: RankingRow[]
  notes: string[]
}

export function typeLabelOf(tournament: Tournament): string {
  return tournament.type === "league" ? "League" : "Knockout"
}

/** Pure, testable model of the finished-tournament ranking card. */
export function buildRankingModel(input: {
  tournament: Tournament
  results: TournamentPlayerResult[]
  players: Player[]
}): RankingModel {
  const { tournament, results, players } = input
  const nameOf = (id: string) => players.find((p) => p?.id === id)?.name ?? "?"

  const rows: RankingRow[] = [...results]
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    .map((r, i) => ({
      position: r.position ?? i + 1,
      medal: r.position != null && r.position >= 1 && r.position <= 3 ? MEDALS[r.position - 1] : null,
      name: nameOf(r.playerId),
      wonTitle: r.titleWon,
      withdrawn: r.withdrawn ?? false,
      wins: r.matchWins,
      losses: r.matchLosses,
      points: r.points,
      legDiff: r.legsFor - r.legsAgainst,
    }))

  const notes = (tournament.withdrawals ?? []).map((w) => `⚠️ ${nameOf(w.playerId)} withdrew from the tournament`)

  return {
    tournamentName: tournament.name,
    typeLabel: typeLabelOf(tournament),
    dateLabel: tournament.completedAt ? `Finished on ${FORMAT_DATE.format(new Date(tournament.completedAt))}` : null,
    rows,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Canvas rendering. Runs entirely on-device so the app keeps working offline.
// ---------------------------------------------------------------------------

const W = 1200
const SCALE = 2
const MARGIN = 28
const PAD = 64

const COLORS = {
  bg: "#0f172a",
  card: "#16223a",
  border: "rgba(148,163,184,0.28)",
  divider: "rgba(148,163,184,0.18)",
  title: "#f8fafc",
  subtitle: "#7d8ca6",
  label: "#94a3b8",
  text: "#e2e8f0",
  dim: "#94a3b8",
  emerald: "#34d399",
  red: "#f87171",
  gold: "#fbbf24",
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}

function ordinal(n: number): string {
  const rem = n % 100
  if (rem >= 11 && rem <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.fillStyle = COLORS.label
  ctx.font = `600 26px ${FONT_FAMILY}`
  ctx.textBaseline = "bottom"
  ctx.fillText(text.toUpperCase(), x, y)
}

function computeHeight(model: RankingModel): number {
  const n = model.rows.length
  return (
    56 + // top pad
    62 + // title
    42 + // subtitle
    40 + // gap
    42 + // section label (podium)
    Math.min(n, 3) * 78 + // podium rows
    18 + // gap
    42 + // section label (full table)
    46 + // header row
    n * 50 + // table rows
    (model.notes.length > 0 ? 18 + model.notes.length * 40 : 0) + // withdrawal notes
    40 + // gap
    56 + // footer
    56 // bottom pad
  )
}

type StatKey = "pts" | "wl" | "legs"

/** Right-aligned numeric columns shared by the podium and the full table.
 * Finite widths are reserved before any drawing, so nothing overlaps. */
function computeStatColumns(
  ctx: CanvasRenderingContext2D,
  right: number,
  rows: RankingRow[],
): { x: Record<StatKey, number>; width: Record<StatKey, number> } {
  const headerFont = `600 26px ${FONT_FAMILY}`
  const fonts: Record<StatKey, string> = {
    pts: `500 28px ${FONT_FAMILY}`,
    wl: `500 28px ${FONT_FAMILY}`,
    legs: `600 28px ${FONT_FAMILY}`,
  }
  const labels: Record<StatKey, string> = { pts: "Pts", wl: "W–L", legs: "Legs" }
  const value = (key: StatKey, r: RankingRow): string => {
    switch (key) {
      case "pts":
        return String(r.points)
      case "wl":
        return `${r.wins}W–${r.losses}L`
      case "legs":
        return r.legDiff !== 0 ? `${r.legDiff > 0 ? "+" : ""}${r.legDiff}` : "–"
    }
  }
  const measure = (s: string, font: string) => {
    ctx.font = font
    return ctx.measureText(s).width
  }
  const widthOf = (key: StatKey): number =>
    Math.max(measure(labels[key], headerFont), ...rows.map((r) => measure(value(key, r), fonts[key])))

  const width = {
    pts: widthOf("pts"),
    wl: widthOf("wl"),
    legs: widthOf("legs"),
  }
  const gap = 36
  const xPts = right - width.pts
  const xWl = xPts - gap - width.wl
  const xLegs = xWl - gap - width.legs
  return {
    x: { pts: xPts, wl: xWl, legs: xLegs },
    width,
  }
}

function drawStats(
  ctx: CanvasRenderingContext2D,
  row: RankingRow,
  cols: { x: Record<StatKey, number>; width: Record<StatKey, number> },
  y: number,
  showLegs: boolean,
) {
  const fonts: Record<StatKey, string> = {
    pts: `500 28px ${FONT_FAMILY}`,
    wl: `500 28px ${FONT_FAMILY}`,
    legs: `600 28px ${FONT_FAMILY}`,
  }
  const values: Array<[StatKey, string]> = [
    ["pts", String(row.points)],
    ["wl", `${row.wins}W–${row.losses}L`],
  ]
  if (showLegs) values.push(["legs", row.legDiff !== 0 ? `${row.legDiff > 0 ? "+" : ""}${row.legDiff}` : "–"])

  for (const [key, text] of values) {
    ctx.font = fonts[key]
    ctx.fillStyle = key === "legs" ? (row.legDiff >= 0 ? COLORS.emerald : COLORS.red) : COLORS.dim
    ctx.textAlign = "right"
    ctx.fillText(text, cols.x[key], y)
  }
}

/** Renders the finished-tournament ranking card and returns it as a PNG. */
export function drawRankingCard(canvas: HTMLCanvasElement, model: RankingModel): void {
  const H = computeHeight(model)
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is not available")

  ctx.scale(SCALE, SCALE)

  const cx = MARGIN
  const cw = W - MARGIN * 2
  const cy = MARGIN
  const ch = H - MARGIN * 2

  // Page background
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, W, H)

  // Rounded card
  roundRectPath(ctx, cx, cy, cw, ch, 28)
  ctx.fillStyle = COLORS.card
  ctx.fill()
  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.save()
  roundRectPath(ctx, cx, cy, cw, ch, 28)
  ctx.clip()

  const left = cx + PAD
  const right = cx + cw - PAD
  let y = cy + 56

  // Title
  ctx.fillStyle = COLORS.title
  ctx.font = `700 50px ${FONT_FAMILY}`
  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"
  ctx.fillText(ellipsize(ctx, model.tournamentName, right - left), left, y)
  y += 62

  // Subtitle (type + date)
  ctx.font = `500 28px ${FONT_FAMILY}`
  ctx.fillStyle = COLORS.subtitle
  const sub = model.dateLabel ? `${model.typeLabel} · ${model.dateLabel}` : model.typeLabel
  ctx.fillText(sub, left, y)
  y += 42

  // Accent bar
  const grad = ctx.createLinearGradient(left, y, right, y)
  grad.addColorStop(0, COLORS.emerald)
  grad.addColorStop(0.5, "#38bdf8")
  grad.addColorStop(1, COLORS.gold)
  ctx.fillStyle = grad
  ctx.fillRect(left, y - 6, right - left, 4)
  y += 40

  const cols = computeStatColumns(ctx, right, model.rows)

  // Podium (top 3)
  drawLegend(ctx, left, y, "Podium")
  y += 42
  for (const row of model.rows.slice(0, 3)) {
    const medalText = row.medal ?? ordinal(row.position)
    const nameMax = cols.x.legs - (left + 64) - 24
    const nameText = ellipsize(ctx, row.name, nameMax)
    ctx.font = `600 34px ${FONT_FAMILY}`
    const medalW = ctx.measureText(medalText).width
    const nameW = ctx.measureText(nameText).width
    ctx.fillStyle = COLORS.gold
    ctx.fillText(medalText, left, y)
    ctx.fillStyle = COLORS.text
    ctx.fillText(nameText, left + medalW + 16, y)
    if (row.wonTitle) {
      ctx.font = `600 28px ${FONT_FAMILY}`
      ctx.fillText("🏆", left + medalW + 16 + nameW + 12, y)
    }
    drawStats(ctx, row, cols, y, true)
    y += 78
  }

  // Full table
  y += 18
  drawLegend(ctx, left, y, "Full ranking")
  y += 46
  ctx.font = `600 26px ${FONT_FAMILY}`
  ctx.fillStyle = COLORS.label
  ctx.textAlign = "left"
  ctx.fillText("Pos", left, y)
  ctx.fillText("Player", left + 64, y)
  for (const key of ["pts", "wl", "legs"] as StatKey[]) {
    const label = key === "pts" ? "Pts" : key === "wl" ? "W–L" : "Legs"
    ctx.textAlign = "right"
    ctx.fillText(label, cols.x[key], y)
  }
  y += 46

  for (const row of model.rows) {
    ctx.font = `500 28px ${FONT_FAMILY}`
    ctx.fillStyle = COLORS.dim
    ctx.textAlign = "left"
    ctx.fillText(String(row.position), left, y)

    const flag = row.withdrawn ? "⚠️ " : ""
    const trophy = row.wonTitle ? " 🏆" : ""
    ctx.fillStyle = COLORS.text
    ctx.font = `600 32px ${FONT_FAMILY}`
    const nameMax = cols.x.legs - (left + 64) - 24
    ctx.textAlign = "left"
    ctx.fillText(flag + ellipsize(ctx, row.name, nameMax) + trophy, left + 64, y)

    drawStats(ctx, row, cols, y, true)
    y += 50
  }

  // Withdrawal notes
  for (const note of model.notes) {
    y += 40
    ctx.font = `500 26px ${FONT_FAMILY}`
    ctx.fillStyle = COLORS.dim
    ctx.textAlign = "left"
    ctx.fillText(ellipsize(ctx, note, right - left), left, y)
  }

  // Footer
  y += 72
  ctx.fillStyle = COLORS.subtitle
  ctx.font = `500 26px ${FONT_FAMILY}`
  ctx.textAlign = "center"
  ctx.fillText("Darts Tournament Manager", W / 2, y)

  ctx.restore()
}

/** Renders the card and returns PNG artifacts ready to share or download. */
export async function renderRankingImage(model: RankingModel): Promise<{
  blob: Blob
  dataUrl: string
  file: File
  filename: string
}> {
  const canvas = document.createElement("canvas")
  drawRankingCard(canvas, model)

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not render the ranking image"))),
      "image/png",
    ),
  )
  const filename = `darts-ranking-${new Date().toISOString().slice(0, 10)}.png`
  const file = new File([blob], filename, { type: "image/png" })
  return { blob, dataUrl: URL.createObjectURL(blob), file, filename }
}

/** True when the device can open a native share sheet (WhatsApp, etc.). */
export function canShareImage(): boolean {
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean
  }
  return typeof navigator.share === "function" && typeof nav.canShare === "function"
}

export async function shareRankingImage(
  file: File,
  tournamentName: string,
): Promise<"shared" | "unsupported"> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean
  }
  if (typeof navigator.share !== "function" || !nav.canShare?.({ files: [file] })) {
    return "unsupported"
  }
  await navigator.share({
    files: [file],
    title: `${tournamentName} — final results`,
    text: `${tournamentName} — final results`,
  })
  return "shared"
}

/** Downloads the PNG (fallback when the native share sheet is unavailable). */
export function downloadRankingImage(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement("a")
  a.href = url
  a.download = file.name
  a.click()
  URL.revokeObjectURL(url)
}