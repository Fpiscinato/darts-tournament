import { Component, type ErrorInfo, type ReactNode } from "react"
import { dismissBoot } from "@/lib/boot"

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Last line of defence: an unexpected render error must never leave a blank
 * page. Deliberately dependency-free, so the fallback cannot fail the same way
 * the rest of the app just did.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidMount(): void {
    // The tree committed (either the app or this fallback): the boot screen in
    // index.html is no longer needed.
    dismissBoot()
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("The app crashed while rendering", error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
        <h1 className="text-lg font-semibold">The app could not start</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Something failed while loading the screen. Your tournaments are stored on this device and were not deleted.
        </p>
        <pre className="max-w-full overflow-auto rounded-md border bg-muted p-3 text-left text-xs text-muted-foreground">
          {error.message || error.name}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground"
        >
          Reload
        </button>
      </div>
    )
  }
}
