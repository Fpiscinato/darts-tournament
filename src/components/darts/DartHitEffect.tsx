import { useEffect, useState } from "react"
import { DartboardIcon } from "./DartboardIcon"

function DartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g transform="rotate(45 12 12)">
        <path d="M12 2 L15 9 L12 12 L9 9 Z" fill="#facc15" />
        <rect x="11" y="11" width="2" height="9" fill="#71717a" />
        <path d="M12 20 L15 23 L12 21.5 L9 23 Z" fill="#dc2626" />
      </g>
    </svg>
  )
}

/** Plays a brief "dart hits the board" animation whenever `triggerKey`
 * changes. No external GIF/image asset — a self-contained SVG + CSS
 * animation keeps it crisp, tiny, and fully available offline. */
export function DartHitEffect({ triggerKey }: { triggerKey: number }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (triggerKey === 0) return
    setVisible(true)
    const timer = setTimeout(() => setVisible(false), 700)
    return () => clearTimeout(timer)
  }, [triggerKey])

  if (!visible) return null

  return (
    <div
      key={triggerKey}
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    >
      <div className="relative size-14 animate-[dart-impact_0.5s_ease-out]">
        <DartboardIcon className="size-14" />
        <DartIcon className="absolute inset-0 size-14 animate-[dart-throw_0.32s_ease-out]" />
      </div>
    </div>
  )
}
