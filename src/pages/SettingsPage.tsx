import { useRef, useState } from "react"
import { BackupError, exportBackup, fullReset, parseBackupFile, replaceAllWithBackup, type BackupFile } from "@/lib/backup"
import { useToast } from "@/context/ToastContext"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export function SettingsPage() {
  const { notify } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  async function handleExport() {
    const backup = await exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `darts-tournament-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    notify("Backup downloaded")
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseBackupFile(text)
      setPendingImport(parsed)
    } catch (err) {
      notify(err instanceof BackupError ? err.message : "Could not read this file", "destructive")
    }
  }

  async function confirmImport() {
    if (!pendingImport) return
    await replaceAllWithBackup(pendingImport)
    setPendingImport(null)
    notify("Backup restored")
  }

  async function handleFullReset() {
    await fullReset()
    setConfirmReset(false)
    notify("App reset to a blank slate")
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>

      <section className="mb-8 flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Backup</h2>
        <Button className="min-h-11" variant="outline" onClick={handleExport}>
          Export backup
        </Button>
        <Button className="min-h-11" variant="outline" onClick={() => fileInputRef.current?.click()}>
          Import backup
        </Button>
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFileChosen} />
        <p className="text-xs text-muted-foreground">
          Everything lives on this device. Export a backup regularly, especially after finishing a tournament.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Danger zone</h2>
        <Button className="min-h-11" variant="destructive" onClick={() => setConfirmReset(true)}>
          Full reset
        </Button>
      </section>

      <AlertDialog open={pendingImport !== null} onOpenChange={(v) => !v && setPendingImport(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace all current data?</AlertDialogTitle>
            <AlertDialogDescription>
              This backup was created on {pendingImport ? new Date(pendingImport.createdAt).toLocaleString() : ""}.
              Importing it replaces every player, tournament, match, and result currently on this device. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={confirmImport}>
              Replace everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Full reset — are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every player, tournament, match, and result on this device. There is no undo
              unless you have a backup file to import afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={handleFullReset}>
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
