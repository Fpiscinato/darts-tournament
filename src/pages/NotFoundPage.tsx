import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-4 py-16 text-center">
      <p className="text-4xl font-semibold">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">This link doesn't point to anything in the app.</p>
      <Button asChild className="min-h-11">
        <Link to="/">Back to tournaments</Link>
      </Button>
    </div>
  )
}
