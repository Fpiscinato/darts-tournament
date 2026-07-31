import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"

const links = [
  { to: "/", label: "Tournaments" },
  { to: "/players", label: "Players" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
]

export function NavBar() {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-2">
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
    </nav>
  )
}
