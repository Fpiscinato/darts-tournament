/** Shared per-round accent palette so League/Top4 match lists and the
 * Knockout bracket use the same color for "round 1", "round 2", etc. */
export const ROUND_BORDER_CLASSES = [
  "border-l-violet-500",
  "border-l-sky-500",
  "border-l-amber-500",
  "border-l-emerald-500",
  "border-l-rose-500",
  "border-l-cyan-500",
]

export const ROUND_LINE_CLASSES = [
  "border-violet-500",
  "border-sky-500",
  "border-amber-500",
  "border-emerald-500",
  "border-rose-500",
  "border-cyan-500",
]

export const ROUND_BADGE_CLASSES = [
  "border-violet-500 text-violet-600 dark:text-violet-400",
  "border-sky-500 text-sky-600 dark:text-sky-400",
  "border-amber-500 text-amber-600 dark:text-amber-400",
  "border-emerald-500 text-emerald-600 dark:text-emerald-400",
  "border-rose-500 text-rose-600 dark:text-rose-400",
  "border-cyan-500 text-cyan-600 dark:text-cyan-400",
]

export function roundAccent(index: number, palette: string[]): string {
  return palette[index % palette.length]
}
