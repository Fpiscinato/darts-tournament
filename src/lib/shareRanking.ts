import type { Player, Tournament, TournamentPlayerResult } from "./types"

export const MEDALS = ["🥇", "🥈", "🥉"]
const FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
const FORMAT_DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })

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
  return tournament.type === "league" ? "Liga" : "Mata-mata"
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

  const notes = (tournament.withdrawals ?? []).map((w) => `⚠️ ${nameOf(w.playerId)} desistiu do torneio`)

  return {
    tournamentName: tournament.name,
    typeLabel: typeLabelOf(tournament),
    dateLabel: tournament.completedAt ? `finalizado em ${FORMAT_DATE.format(new Date(tournament.completedAt))}` : null,
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

  // Podium (top 3)
  drawLegend(ctx, left, y, "Pódio")
  y += 42
  const podium = model.rows.slice(0, 3)
  for (const row of podium) {
    ctx.font = `600 34px ${FONT_FAMILY}`
    const medalText = `${row.medal ?? `${row.position}º`}`
    const nameText = ellipsize(ctx, row.name, 460 - ctx.measureText(medalText).width)
    ctx.fillStyle = COLORS.gold
    ctx.fillText(medalText, left, y)
    ctx.fillStyle = COLORS.text
    ctx.fillText(nameText, left + ctx.measureText(medalText).width + 16, y)
    if (row.wonTitle) {
      ctx.fillText(" 🏆", left + ctx.measureText(medalText).width + 16 + ctx.measureText(nameText).width, y)
    }

    // Stats right-aligned
    const pts = `${row.points} pts`
    const wl = `${row.wins}V–${row.losses}D`
    ctx.font = `500 28px ${FONT_FAMILY}`
    ctx.fillStyle = COLORS.dim
    const ptsW = ctx.measureText(pts).width
    const wlW = ctx.measureText(wl).width
    ctx.fillText(pts, right - ptsW, y)
    ctx.fillText(wl, right - ptsW - wlW - 36, y)

    if (row.legDiff !== 0) {
      const ld = `${row.legDiff > 0 ? "+" : ""}${row.legDiff} legs`
      ctx.font = `600 28px ${FONT_FAMILY}`
      ctx.fillStyle = row.legDiff >= 0 ? COLORS.emerald : COLORS.gold
      const ldW = ctx.measureText(ld).width
      ctx.fillText(ld, right - ptsW - wlW - 36 - ldW - 36, y)
    }
    y += 78
  }

  // Full table
  y += 18
  drawLegend(ctx, left, y, "Classificação completa")
  y += 46
  ctx.font = `600 26px ${FONT_FAMILY}`
  ctx.fillStyle = COLORS.label
  ctx.fillText("P", left, y, 60)
  ctx.fillText("Jogador", left + 64, y)
  const rightCol = (label: string) => {
    const w = ctx.measureText(label).width
    ctx.fillText(label, right - w, y)
    return w
  }
  const ldW = rightCol("Legs")
  rightCol("Pts")
  rightCol("V–D")
  const vdW = ctx.measureText("V–D").width
  y += 46

  for (const row of model.rows) {
    ctx.font = `500 28px ${FONT_FAMILY}`
    ctx.fillStyle = COLORS.dim
    ctx.fillText(String(row.position), left, y, 60)

    const flag = row.withdrawn ? "⚠️ " : ""
    const trophy = row.wonTitle ? " 🏆" : ""
    ctx.fillStyle = COLORS.text
    ctx.font = `600 32px ${FONT_FAMILY}`
    const nameMax = right - (left + 64) - 340
    ctx.fillText(flag + ellipsize(ctx, row.name, nameMax) + trophy, left + 64, y)

    ctx.font = `500 28px ${FONT_FAMILY}`
    ctx.fillStyle = COLORS.dim
    const ptsT = String(row.points)
    const vdT = `${row.wins}V–${row.losses}D`
    ctx.fillText(ptsT, right - rightCol(ptsT), y)
    ctx.fillText(vdT, right - vdW - rightCol(ptsT) - 48, y)

    if (row.legDiff !== 0) {
      const ldT = `${row.legDiff > 0 ? "+" : ""}${row.legDiff}`
      ctx.font = `600 28px ${FONT_FAMILY}`
      ctx.fillStyle = row.legDiff >= 0 ? COLORS.emerald : COLORS.gold
      ctx.fillText(ldT, right - ldW, y)
    }
    y += 50
  }

  // Withdrawal notes
  for (const note of model.notes) {
    y += 40
    ctx.font = `500 26px ${FONT_FAMILY}`
    ctx.fillStyle = COLORS.dim
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
    title: `${tournamentName} — resultado final`,
    text: `${tournamentName} — resultado final`,
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