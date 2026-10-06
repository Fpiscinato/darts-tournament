import { Link } from "react-router-dom"
import { useLiveQuery } from "dexie-react-hooks"
import { Plus } from "lucide-react"
import { db } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageSkeleton } from "@/components/darts/PageSkeleton"
import type { Tournament } from "@/lib/types"

function StatusBadge({ status }: { status: Tournament["status"] }) {
  if (status === "active") return <Badge>Active</Badge>
  if (status === "completed") return <Badge variant="secondary">Completed</Badge>
  return <Badge variant="outline">Draft</Badge>
}

export function HomePage() {
  const tournaments = useLiveQuery(
    () => db.tournaments.orderBy("createdAt").reverse().toArray(),
    [],
  )

  if (!tournaments) return <PageSkeleton rows={4} className="mx-auto max-w-2xl px-4 py-6" />

  const active = tournaments.filter((t) => t.status !== "completed")
  const completed = tournaments.filter((t) => t.status === "completed")

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tournaments</h1>
        <Button asChild className="min-h-11">
          <Link to="/tournaments/new">
            <Plus /> New Tournament
          </Link>
        </Button>
      </div>

      {tournaments.length === 0 && (
        <p className="text-sm text-muted-foreground">No tournaments yet — create one to get started.</p>
      )}

      {active.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">In progress</h2>
          <div className="flex flex-col gap-2">
            {active.map((t) => (
              <Link
                key={t.id}
                to={`/tournaments/${t.id}`}
                className="flex min-h-11 items-center justify-between rounded-lg border border-border px-4 py-3 transition-colors hover:bg-muted"
              >
                <span className="font-medium">{t.name}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{t.type === "league" ? "League" : "Knockout"}</Badge>
                  <StatusBadge status={t.status} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Completed</h2>
          <div className="flex flex-col gap-2">
            {completed.map((t) => (
              <Link
                key={t.id}
                to={`/tournaments/${t.id}`}
                className="flex min-h-11 items-center justify-between rounded-lg border border-border px-4 py-3 transition-colors hover:bg-muted"
              >
                <span className="font-medium">{t.name}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{t.type === "league" ? "League" : "Knockout"}</Badge>
                  <StatusBadge status={t.status} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
