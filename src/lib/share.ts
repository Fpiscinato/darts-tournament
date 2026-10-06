import type { Player, Tournament, TournamentPlayerResult } from "./types"

/** Position emoji used in shared summaries. */
const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

const TYPE_LABEL: Record<string, string> = {
  league: "Liga",
  knockout: "Mata-mata",
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function legDiffLabel(r: TournamentPlayerResult): string {
  const diff = r.legsFor - r.legsAgainst
  if (diff === 0) return "±0"
  return diff > 0 ? `+${diff}` : `${diff}`
}

export interface ShareTournamentInput {
  tournament: Tournament
  results: TournamentPlayerResult[]
  players: Player[]
}

/**
 * Builds a WhatsApp-formatted summary of a finished tournament (WhatsApp only
 * renders *bold*, _italic_ and line breaks — nothing else), e.g.:
 *
 *   🏆 *Copa Darts 2026*
 *   _Liga · finalizado em 06/10/2026_
 *   🥇 *1º Fernando* — 8V-2D · 16 pts · +12 legs
 *   …
 */
export function buildShareText({ tournament, results, players }: ShareTournamentInput): string {
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?"
  const ordered = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))

  const lines: string[] = []
  lines.push(`🏆 *${tournament.name}*`)

  const meta: string[] = []
  meta.push(TYPE_LABEL[tournament.type] ?? tournament.type)
  const date = formatDate(tournament.completedAt)
  if (date) meta.push(`finalizado em ${date}`)
  lines.push(`_${meta.join(" · ")}_`)
  lines.push("")

  // Podium (top 3 with the full stat line).
  const podium = ordered.filter((r) => r.position !== null && r.position <= 3).slice(0, 3)
  for (const r of podium) {
    const medal = MEDALS[r.position!] ?? ""
    lines.push(
      `${medal} *${r.position}º ${nameOf(r.playerId)}* — ${r.matchWins}V-${r.matchLosses}D · ${r.points} pts · ${legDiffLabel(r)} legs`,
    )
  }
  if (podium.length > 0) lines.push("")

  // Everyone else, compact.
  const others = ordered.filter((r) => !podium.includes(r))
  if (others.length > 0) {
    lines.push("*📊 Classificação completa*")
    for (const r of others) {
      const pos = r.position ? `${r.position}º` : "—"
      const wd = r.withdrawn ? " ⚠️" : ""
      lines.push(`${pos} ${nameOf(r.playerId)}${wd} — ${r.points} pts (${r.matchWins}V-${r.matchLosses}D)`)
    }
    lines.push("")
  }

  // Withdrawals spelled out (both a footnote and a marker on the row above).
  const withdrawnIds = (tournament.withdrawals ?? []).map((w) => w.playerId)
  for (const id of withdrawnIds) {
    lines.push(`⚠️ ${nameOf(id)} desistiu do torneio`)
  }
  if (withdrawnIds.length > 0) lines.push("")

  // Each match contributes one win and one loss across the whole table.
  const matchCount = ordered.reduce((sum, r) => sum + r.matchWins + r.matchLosses, 0) / 2
  if (matchCount > 0) {
    const bestOf = tournament.stageFormats.league ?? tournament.stageFormats.knockout
    lines.push(`🎯 ${Math.round(matchCount)} jogos disputados${bestOf ? ` · Melhor de ${bestOf}` : ""}`)
  }
  lines.push("_Darts Tournament Manager_")

  return lines.join("\n")
}

/** Opens WhatsApp's share sheet with the given text (contact picker on
 * mobile, WhatsApp Web's send dialog on desktop). */
export function openWhatsAppShare(text: string): void {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")
}

export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Fallback for older browsers / non-secure contexts.
  const el = document.createElement("textarea")
  el.value = text
  el.setAttribute("readonly", "")
  el.style.position = "fixed"
  el.style.opacity = "0"
  document.body.appendChild(el)
  el.select()
  document.execCommand("copy")
  document.body.removeChild(el)
}
