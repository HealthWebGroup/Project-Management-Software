/**
 * The frame every signed-in page renders inside: sidebar, top bar, command
 * palette, and the providers for clients and the running timer.
 *
 * It owns the list of boards because the sidebar needs all of them, not the
 * filtered set - see the note on the fetch below.
 */
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import type { Workspace } from '../lib/types'
import { useAuth } from '../state/auth'
import { ClientProvider, useClients } from '../state/clients'
import { TimerProvider } from '../state/timer'
import TopBar from './TopBar'
import CommandPalette from './CommandPalette'
import ClientNav from './ClientNav'


function ShellInner() {
  const { user, signOut } = useAuth()
  const { clients, select } = useClients()
  const location = useLocation()
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // Always every board, never the filtered set. The sidebar groups by client
  // itself now, so filtering here would empty the very list that does the
  // filtering — pick a client and four of the five would disappear from the
  // navigation you were about to use.
  useEffect(() => {
    let cancelled = false
    api
      .get<Workspace[]>('/api/workspaces')
      .then((data) => {
        if (cancelled) return
        setWorkspaces(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your projects.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the session marked as live while someone is actually working.
  useEffect(() => {
    const beat = () => { void api.post('/api/presence/heartbeat').catch(() => {}) }
    beat()
    const id = window.setInterval(beat, 120000)
    return () => window.clearInterval(id)
  }, [])

  // Close the drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="shell">
      <button
        className="menu-btn"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-label={menuOpen ? 'Hide boards' : 'Show boards'}
      >
        <span aria-hidden="true">☰</span>
        <span className="menu-btn-label">Boards</span>
      </button>

      {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}

      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-brand">
          <span className="brand-mark">HW</span>
          <span className="brand-name">Work OS</span>
        </div>

        {/*
          The pages, in the drawer.

          On a desktop these live in the top bar. On a phone that strip
          wrapped over three lines and still lost its last entry, so it is
          hidden there — which quietly made Settings, Team & time and the
          rest unreachable on a phone, because nothing else linked to them.
          They belong here: the drawer is the one place a phone user can
          always get back to. Hidden above 700px, where the top bar has
          room for them again.
        */}
        <nav className="drawer-pages" aria-label="Pages">
          {PAGES.map((page) => (
            <NavLink
              key={page.to}
              to={page.to}
              end={page.end}
              className={({ isActive }) => (isActive ? 'dp on' : 'dp')}
              onClick={() => setMenuOpen(false)}
            >
              {page.label}
            </NavLink>
          ))}
        </nav>

        <nav className="sidebar-nav">
          <ClientNav workspaces={workspaces} clients={clients} error={error} />
        </nav>

        <div className="sidebar-user">
          <div className="su-name">{user?.fullName}</div>
          <div className="su-role">{user?.role.toLowerCase()}</div>
          <div className="su-actions">
            <button className="btn ghost small" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <TopBar />
        <div className="main-body">
          <Outlet />
        </div>
      </main>

      <CommandPalette workspaces={workspaces} clients={clients} onSelectClient={select} />
    </div>
  )
}


/**
 * The client selection and the running timer are only meaningful once someone
 * is signed in, so their providers sit inside the authenticated shell.
 */
/**
 * The pages the drawer offers on a phone. Deliberately the same four the
 * top bar shows on a desktop — a drawer that can reach somewhere the top
 * bar cannot becomes a second, divergent navigation.
 */
const PAGES = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/clients', label: 'Clients', end: false },
  { to: '/team', label: 'Team & time', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export default function Shell() {
  return (
    <ClientProvider>
      <TimerProvider>
        <ShellInner />
      </TimerProvider>
    </ClientProvider>
  )
}
