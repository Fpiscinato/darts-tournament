/**
 * The pre-React placeholder declared in `index.html`.
 *
 * It exists so that a slow or broken start-up shows "Loading…" (and a Reload
 * button) instead of a black screen. React removes it as soon as the first
 * tree is on screen, so the user never sees both at once.
 */
const BOOT_ID = "boot"

/** Must match `RETRY_KEY` in the inline script inside `index.html`. */
const RETRY_KEY = "darts.boot.retried"

/** Called once the React tree has mounted (or shown its error fallback). */
export function dismissBoot(): void {
  document.getElementById(BOOT_ID)?.remove()
  try {
    // The app started, so the next start deserves its own automatic retry.
    window.sessionStorage.removeItem(RETRY_KEY)
  } catch {
    // Storage can be unavailable (private mode); there is nothing to clean up.
  }
}
