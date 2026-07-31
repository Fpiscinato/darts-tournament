import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const notify = useCallback((message: string, variant: Toast["variant"] = "default") => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, variant }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))]">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "rounded-md border px-4 py-3 text-sm shadow-lg bg-card text-card-foreground",
              t.variant === "destructive" && "border-destructive text-destructive-foreground bg-destructive",
            )}
          >
            {t.message}
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
