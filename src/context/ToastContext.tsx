import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface Toast {
  id: number
  message: string
  variant: "default" | "destructive"
}

interface ToastContextValue {
  notify: (message: string, variant?: Toast["variant"]) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

const MAX_TOASTS = 4

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (message: string, variant: Toast["variant"] = "default") => {
      const id = nextId++
      setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { id, message, variant }])
      setTimeout(() => dismiss(id), 4000)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.variant === "destructive" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-lg bg-card text-card-foreground",
              t.variant === "destructive" && "border-destructive bg-destructive text-destructive-foreground",
            )}
          >
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1">{t.message}</span>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-1 -mt-1 h-6 w-6 shrink-0 text-inherit hover:bg-foreground/10"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within a ToastProvider")
  return ctx
}