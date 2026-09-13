import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../state/auth'
import { useClients } from '../state/clients'
import { formatDuration, useTimer } from '../state/timer'
import { colourClass } from './Pill'
import MyTasks from './MyTasks'
import Notifications from './Notifications'
import SlidingHighlight from './SlidingHighlight'
import { api } from '../lib/api'
import type { Todo } from '../lib/types'

/**
 * The client switcher is the spine of the app: everything below it is scoped
 * to whatever is chosen here.
 */
export default function TopBar() {
  const { clients, selected, selectedId, select } = useClients()
  const location = useLocation()
  const { user } = useAuth()
  // The People screen is about access, so it follows the access rule.
  const canManage = user?.role === 'ADMIN'
  const { running, elapsed, stop } = useTimer()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [tasksOpen, setTasksOpen] = useState(false)
  const [openTasks, setOpenTasks] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Just the count for the badge; the panel loads the list when it opens.
  useEffect(() => {
    let cancelled = false
    api
      .get<Todo[]>('/api/todos')
      .then((rows) => !cancelled && setOpenTasks(rows.filter((t) => !t.done).length))
      .catch(() => !cancelled && setOpenTasks(null))
  }, [tasksOpen])

  const needle = query.trim().toLowerCase()
  const shown = clients.filter(
    (c) => !needle || c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle),
  )

  // Which top-level section the current URL sits in. /clients/:id is still
  // "Clients" as far as the navigation is concerned — without this, opening
  // a client would slide the highlight off the strip entirely.
  const navItems = [
    { to: '/', label: 'Dashboard', end: true },
    { to: '/clients', label: 'Clients', end: false },
    { to: '/team', label: 'Team & time', end: false },
    ...(canManage ? [{ to: '/people', label: 'People', end: false }] : []),
  ]
  const activeNav =
    navItems
      .filter((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))
      .sort((a, b) => b.to.length - a.to.length)[0]?.to ?? null

  return (
    <header className="topbar">
      <div className="client-switch" ref={wrapRef}>
        <button
          className={`client-btn ${selected ? colourClass(selected.colour) : 'all'}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="client-code">{selected ? selected.code : 'ALL'}</span>
          <span className="client-label">{selected ? selected.name : 'All clients'}</span>
          <span className="caret" aria-hidden="true">▾</span>
        </button>

        {open && (
          <div className="client-menu">
            <input
              className="client-search"
              placeholder="Find a client"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className={`client-option ${selectedId === null ? 'on' : ''}`}
              onClick={() => {
                select(null)
                setOpen(false)
              }}
            >
              <span className="opt-code all">ALL</span>
              <span className="opt-name">All clients</span>
            </button>
            {shown.map((client) => (
              <button
                key={client.id}
                className={`client-option ${selectedId === client.id ? 'on' : ''}`}
                onClick={() => {
                  select(client.id)
                  setOpen(false)
                }}
              >
                <span className={`opt-code ${colourClass(client.colour)}`}>{client.code}</span>
                <span className="opt-name">{client.name}</span>
                {client.status !== 'ACTIVE' && (
                  <span className="opt-status">{client.status.toLowerCase()}</span>
                )}
              </button>
            ))}
            {shown.length === 0 && <p className="client-none">No client matches that.</p>}
            <NavLink to="/clients" className="client-manage" onClick={() => setOpen(false)}>
              Manage clients →
            </NavLink>
          </div>
        )}
      </div>

      <SlidingHighlight activeId={activeNav} className="topnav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-slide-id={item.to}
            className={({ isActive }) => (isActive ? 'on' : '')}
          >
            {item.label}
          </NavLink>
        ))}
      </SlidingHighlight>

      <Notifications />

      <button
        className={openTasks ? 'tasks-btn has-open' : 'tasks-btn'}
        onClick={() => setTasksOpen(true)}
        title="Your private to-do list"
      >
        My tasks
        {openTasks ? <span className="tasks-badge">{openTasks}</span> : null}
      </button>

      {tasksOpen && <MyTasks onClose={() => setTasksOpen(false)} />}

      {running && (
        <div className="running-timer">
          <span className="pulse" aria-hidden="true" />
          <span className="rt-what">{running.itemTitle ?? running.clientName ?? 'Working'}</span>
          <span className="rt-clock">{formatDuration(elapsed)}</span>
          <button className="rt-stop" onClick={() => void stop()}>
            Stop
          </button>
        </div>
      )}
    </header>
  )
}
