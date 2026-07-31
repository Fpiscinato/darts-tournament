import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Step = {
  title: string
  detail: string
  image: string
}

const STEPS: Step[] = [
  {
    title: "Add players",
    detail: "Players screen — 9 are preloaded and seeded. Add, rename, or remove anyone.",
    image: "/help/players.png",
  },
  {
    title: "Start a tournament",
    detail: "Name it, pick players and a format (League or Knockout), then Create & start.",
    image: "/help/new-tournament.png",
  },
  {
    title: "Score each leg",
    detail: "Open a match, tap the winner of each leg, then Confirm result.",
    image: "/help/match.png",
  },
  {
    title: "Watch it live",
    detail: "Standings and brackets update as results come in. Pending matches stay on top.",
    image: "/help/standings.png",
  },
  {
    title: "Champion crowned",
    detail: "Once everything is confirmed, final results appear automatically.",
    image: "/help/results.png",
  },
  {
    title: "Backup or reset",
    detail: "Export/import a backup, or fully reset the app — all from Settings.",
    image: "/help/settings.png",
  },
]

export function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-semibold">How it works</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Six steps to run a full tournament — everything runs offline, on this device.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <Card key={step.title} className="py-4">
            <CardContent className="flex items-center gap-4 px-4">
              <img
                src={step.image}
                alt={step.title}
                className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover object-top"
              />
              <div className="min-w-0">
                <CardHeader className="grid-rows-none gap-0 p-0">
                  <CardTitle className="text-sm">
                    <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                    {step.title}
                  </CardTitle>
                </CardHeader>
                <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
