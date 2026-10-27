import { useEffect, useRef, useState } from "react"

export type WakeLockState = "off" | "on" | "unsupported" | "denied"

/**
 * Keep the screen awake while `active` is true.
 *
 * The camera lab is meant to run with the phone on a mount, often for a whole
 * practice session. Without a wake lock the screen dims and locks mid-leg,
 * which pauses the video element and stops the detector. The Screen Wake Lock
 * API is the only web way to ask for this; it needs a visible document, and
 * the browser drops the lock whenever the page goes to the background, so the
 * lock is re-acquired on every return to the tab.
 */
export function useWakeLock(active: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>("off")
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!active) {
      setState("off")
      return
    }
    if (typeof navigator === "undefined" || !("wakeLock" in navigator) || !navigator.wakeLock) {
      setState("unsupported")
      return
    }

    let cancelled = false

    const acquire = async () => {
      if (document.visibilityState !== "visible") return
      try {
        const sentinel = await navigator.wakeLock.request("screen")
        if (cancelled) {
          void sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        setState("on")
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null
          // The browser can revoke the lock (low battery, tab hidden). Say so
          // instead of pretending the screen will stay on.
          if (!cancelled) setState("off")
        })
      } catch {
        // Denied by policy or a non-secure context. The lab still works, the
        // screen just follows the normal sleep settings.
        if (!cancelled) setState("denied")
      }
    }

    void acquire()

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) void acquire()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibilityChange)
      const sentinel = sentinelRef.current
      sentinelRef.current = null
      void sentinel?.release().catch(() => {})
    }
  }, [active])

  return state
}
