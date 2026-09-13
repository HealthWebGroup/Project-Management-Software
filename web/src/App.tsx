import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './state/auth'
import LoginPage from './pages/LoginPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import BoardPage from './pages/BoardPage'
import DashboardPage from './pages/DashboardPage'
import ClientsPage from './pages/ClientsPage'
import ClientPage from './pages/ClientPage'
import TeamPage from './pages/TeamPage'
import PeoplePage from './pages/PeoplePage'
import SetupPage from './pages/SetupPage'
import Shell from './components/Shell'
import ErrorBoundary from './components/ErrorBoundary'

function Protected({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />
  return children
}

export default function App() {
  const { setupNeeded } = useAuth()

  // Before any route: an installation that is not finished has nothing
  // useful behind any of them, and saying so beats failing at each in turn.
  if (setupNeeded) {
    return (
      <ErrorBoundary>
        <SetupPage missing={setupNeeded} />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Shell />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="boards/:boardId" element={<BoardPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:clientId" element={<ClientPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="people" element={<PeoplePage />} />
      </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
