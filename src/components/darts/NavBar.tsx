import { NavLink } from "react-router-dom"
import { HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { DartboardIcon } from "./DartboardIcon"

const links = [
  { to: "/", label: "Tournaments" },
  { to: "/players", label: "Players" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
]

export function NavBar() {
  return (
    <nav className="flex items-center gap-1 border-b border-border px-2 py-2">
      <div className="mr-1 flex shrink-0 items-center gap-2 pl-1 pr-2">
        <DartboardIcon className="size-6" />
        <span className="hidden text-sm font-semibold sm:inline">Darts Tournament</span>
      </div>
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === "/"}
            className={({ isActive }) =>
              cn(
                "min-h-11 shrink-0 rounded-md px-3 py-2 text-sm font-medium",
                isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )
            }
          >
            {link.label}
          </NavLink>
        ))}
      </div>
      <NavLink
        to="/help"
        className={({ isActive }) =>
          cn(
            "flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md",
            isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )
        }
        aria-label="Help"
      >
        <HelpCircle className="size-5" />
      </NavLink>
    </nav>
  )
}
