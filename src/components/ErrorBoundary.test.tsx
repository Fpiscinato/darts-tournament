import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ErrorBoundary } from "./ErrorBoundary"

function Boom(): never {
  throw new Error("boom")
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.getElementById("boot")?.remove()
  })

  it("shows a reload fallback instead of a blank page", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText("The app could not start")).toBeInTheDocument()
    expect(screen.getByText("boom")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument()
  })

  it("removes the pre-React boot placeholder once it mounts", () => {
    const boot = document.createElement("div")
    boot.id = "boot"
    document.body.append(boot)

    render(
      <ErrorBoundary>
        <p>ok</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText("ok")).toBeInTheDocument()
    expect(document.getElementById("boot")).toBeNull()
  })
})
