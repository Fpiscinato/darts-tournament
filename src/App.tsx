import { BrowserRouter, Routes, Route } from "react-router-dom"
import { ToastProvider } from "@/context/ToastContext"
import { OfflineIndicator } from "@/components/darts/OfflineIndicator"
import { NavBar } from "@/components/darts/NavBar"
import { HomePage } from "@/pages/HomePage"
import { PlayersPage } from "@/pages/PlayersPage"
import { NewTournamentPage } from "@/pages/NewTournamentPage"
import { TournamentPage } from "@/pages/TournamentPage"
import { HistoryPage } from "@/pages/HistoryPage"
import { SettingsPage } from "@/pages/SettingsPage"

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="min-h-screen bg-background text-foreground">
          <OfflineIndicator />
          <NavBar />
          <main className="pb-8">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/players" element={<PlayersPage />} />
              <Route path="/tournaments/new" element={<NewTournamentPage />} />
              <Route path="/tournaments/:id" element={<TournamentPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
