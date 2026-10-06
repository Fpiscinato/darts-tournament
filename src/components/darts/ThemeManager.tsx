import { useEffect } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/lib/db"

/** Applies the saved theme preference (or the OS preference) to <html>,
 * keeps the browser UI chrome in sync, and updates <meta name="theme-color">. */
export function ThemeManager() {
  const settings = useLiveQuery(() => db.settings.get("settings"), [])

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")

    const apply = () => {
      const theme = settings?.theme ?? "system"
      const dark = theme === "dark" || (theme === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
      document.documentElement.style.setProperty("color-scheme", dark ? "dark" : "light")
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#0f172a" : "#ffffff")
    }

    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [settings?.theme])

  return null
}