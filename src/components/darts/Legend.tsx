import { cn } from "@/lib/utils"

export interface LegendItem {
  term: string
  label: string
}

/** Horizontal, wrap-friendly legend of abbreviations/symbols used on the
 * screen above it — keeps tables and brackets self-explanatory. */
export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <dl className={cn("mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((item) => (
        <div key={item.term} className="flex items-center gap-1">
          <dt className="font-semibold text-foreground">{item.term}</dt>
          <dd className="m-0">{item.label}</dd>
        </div>
      ))}
    </dl>
  )
}