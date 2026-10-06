import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Step = {
  title: string
  detail: string
  image: string
}

const STEPS: Step[] = [
  {
    title: "Add players",
    detail: "Players screen — 9 are preloaded and seeded. Add, rename, archive, or reorder anyone.",
    image: "/help/players.png",
  },
  {
    title: "Start a tournament",
    detail: "Name it, pick League or Knockout and 2–16 players, choose the formats, then Create & start.",
    image: "/help/new-tournament.png",
  },
  {
    title: "Score each leg",
    detail: "Open a match, tap the winner of each leg until someone reaches the target, then Confirm result.",
    image: "/help/match.png",
  },
  {
    title: "Watch it live",
    detail: "The tournament page splits into tabs — one per stage — with an 'Up next' list on top. Tables and brackets update as results come in; abbreviations are explained under each table.",
    image: "/help/standings.png",
  },
  {
    title: "Fix a wrong result",
    detail: "Every finished match has a pencil icon. Tap it to re-open the match at 0–0 and re-score it. Finished tournaments are reopened automatically so you can correct them too.",
    image: "/help/match.png",
  },
  {
    title: "Withdraw a player",
    detail: "Use the players button on a tournament to withdraw someone mid-way. Their unfinished matches become walkovers (WO); use Rejoin to bring them back.",
    image: "/help/players.png",
  },
  {
    title: "Champion crowned",
    detail: "Once everything is confirmed, the final ranking appears with medals, stats and withdrawal notes.",
    image: "/help/results.png",
  },
  {
    title: "Share the ranking",
    detail: "A finished tournament's Share button renders a ranking image you can send straight into WhatsApp, or save and share later. Works offline.",
    image: "/help/settings.png",
  },
  {
    title: "Backup or reset",
    detail: "Export/import a full backup, switch between light/dark themes, or fully reset the app — all from Settings.",
    image: "/help/settings.png",
  },
]

export function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-semibold">How it works</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Nine steps to run and share a full tournament — everything runs offline, on this device.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <Card key={step.title} className="py-4">
            <CardContent className="flex items-center gap-4 px-4">
              <img
                src={step.image}
                alt=""
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