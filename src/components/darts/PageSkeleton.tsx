import { Skeleton } from "@/components/ui/skeleton"

/** Page-level placeholder shown while live Dexie queries are loading. */
export function PageSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">Loading…</span>
      <Skeleton className="mb-6 h-8 w-40" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  )
}
