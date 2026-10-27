import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { ensureSeeded } from "./lib/db"

/**
 * How long the first paint waits for IndexedDB. Seeding is a convenience (it
 * adds the demo roster), so it must never be able to block the app.
 */
const SEED_WAIT_MS = 3000

const seeded = ensureSeeded().catch((error: unknown) => {
  console.error("Could not seed the local database", error)
})

const seedTimeout = new Promise<void>((resolve) => {
  window.setTimeout(resolve, SEED_WAIT_MS)
})

// Render whatever happens: a rejected, blocked or hanging database used to
// leave the user staring at a blank screen with no way out.
Promise.race([seeded, seedTimeout]).finally(() => {
  const root = document.getElementById("root")
  if (!root) return
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
})
