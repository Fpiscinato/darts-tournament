import { useEffect, useMemo, useRef, useState } from "react"
import { Copy, Download, Loader2, MessageCircle } from "lucide-react"
import { useToast } from "@/context/ToastContext"
import { buildShareText, copyToClipboard } from "@/lib/share"
import { buildRankingModel, canShareImage, downloadRankingImage, renderRankingImage, shareRankingImage } from "@/lib/shareRanking"
import type { Player, Tournament, TournamentPlayerResult } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tournament: Tournament
  results: TournamentPlayerResult[]
  players: Player[]
}

export function ShareDialog({ open, onOpenChange, tournament, results, players }: ShareDialogProps) {
  const { notify } = useToast()
  const [image, setImage] = useState<{ dataUrl: string; file: File } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const generatedFor = useRef<string | null>(null)

  const model = useMemo(() => buildRankingModel({ tournament, results, players }), [tournament, results, players])
  const text = useMemo(() => buildShareText({ tournament, results, players }), [tournament, results, players])

  useEffect(() => {
    if (!open) return
    const key = `${tournament.id}:${results.map((r) => `${r.playerId}:${r.position}`).join(",")}`
    if (generatedFor.current === key) return

    let cancelled = false
    setGenerating(true)
    setImage(null)
    renderRankingImage(model).then(
      (r) => {
        if (cancelled) {
          URL.revokeObjectURL(r.dataUrl)
          return
        }
        setImage({ dataUrl: r.dataUrl, file: r.file })
        generatedFor.current = key
      },
      () => {
        if (!cancelled) notify("Could not render the ranking image", "destructive")
      },
    ).finally(() => {
      if (!cancelled) setGenerating(false)
    })

    return () => {
      cancelled = true
    }
  }, [open, model, tournament.id, results, notify])

  useEffect(() => () => {
    setImage((current) => {
      if (current) URL.revokeObjectURL(current.dataUrl)
      return null
    })
  }, [])

  async function handleShare() {
    if (!image) return
    setSharing(true)
    try {
      const result = await shareRankingImage(image.file, tournament.name)
      if (result === "unsupported") {
        downloadRankingImage(image.file)
        notify("Sharing isn't available here — the image was downloaded instead")
      } else {
        notify("Shared")
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not share the image", "destructive")
      downloadRankingImage(image.file)
    } finally {
      setSharing(false)
    }
  }

  async function handleSave() {
    if (!image) return
    setSaving(true)
    try {
      downloadRankingImage(image.file)
      notify("Image saved")
    } finally {
      setSaving(false)
    }
  }

  async function handleCopy() {
    setCopying(true)
    try {
      await copyToClipboard(text)
      notify("Summary copied to clipboard")
    } catch {
      notify("Could not copy the text", "destructive")
    } finally {
      setCopying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share results</DialogTitle>
          <DialogDescription>
            Share a ranking image of {tournament.name} straight into WhatsApp, or save it to send later.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-hidden rounded-lg border border-border">
          {generating || !image ? (
            <div
              role="status"
              aria-busy="true"
              className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="size-5 animate-spin" />
              Rendering image…
            </div>
          ) : (
            <img
              src={image.dataUrl}
              alt={`Final ranking of ${tournament.name}`}
              className="w-full rounded-lg bg-muted"
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          The image shows the podium, full classification, performance stats and any withdrawals. On phones it
          opens the WhatsApp share sheet directly.
        </p>

        <DialogFooter>
          <Button
            className="min-h-11"
            disabled={!image || sharing || generating}
            onClick={handleShare}
            title={canShareImage() ? "Open the share sheet" : "Sharing is not supported here — the image will be downloaded"}
          >
            <MessageCircle aria-hidden="true" />
            {sharing ? "Sharing…" : canShareImage() ? "Share on WhatsApp" : "Download to share"}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={!image || saving} onClick={handleSave}>
            <Download aria-hidden="true" />
            {saving ? "Saving…" : "Save image"}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={copying} onClick={handleCopy}>
            <Copy aria-hidden="true" />
            {copying ? "Copying…" : "Copy text"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}