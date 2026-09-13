/**
 * The sidebar, organised the way the work actually is.
 *
 * Before: one flat list of boards with a client filter in the top bar. That
 * suits someone who lives in one client's work all day. It does not suit
 * running five at once, where the first question is almost always "where is
 * this client" and the board is the second question, not the first.
 *
 * Now: clients are the top level, their projects sit underneath, and the
 * client's own name is a link to a page about that client. Boards with no
 * client — the agency's own admin — collect under Internal at the bottom,
 * because they are checked least often.
 *
 * Which clients are expanded is remembered per browser. A five-client
 * sidebar that collapses everything on each page load is worse than the
 * flat list it replaced.
 */

import { useCallback, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { Client, Workspace } from '../lib/types'
import { colourClass } from './Pill'

const OPEN_KEY = 'workos.openClients'

function readOpen(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function writeOpen(open: Set<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]))
  } catch {
    /* a remembered preference is not worth an error */
  }
}

/**
 * What goes in the little square.
 *
 * The client's own code if they have one — it is the abbreviation the team
 * already says out loud, and the client page uses it, so deriving something
 * different here would give the same client two identities on one screen.
 * Falling back to initials only when no code is set.
 */
function mark(client: Client): string {
  const code = client.code?.trim()
  if (code && code.length <= 3) return code.toUpperCase()

  const words = client.name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

export default function ClientNav({
  workspaces,
  clients,
  error,
}: {
  workspaces: Workspace[] | null
  clients: Client[]
  error: string | null
}) {
  const [open, setOpen] = useState<Set<string>>(readOpen)

  const toggle = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeOpen(next)
      return next
    })
  }, [])

  const { byClient, internal } = useMemo(() => {
    const boards = (workspaces ?? []).flatMap((w) => w.boards)
    const grouped = new Map<string, typeof boards>()
    const noClient: typeof boards = []

    for (const board of boards) {
      if (!board.clientId) {
        noClient.push(board)
        continue
      }
      const list = grouped.get(board.clientId)
      if (list) list.push(board)
      else grouped.set(board.clientId, [board])
    }

    // Clients the person can see, in the order the clients list gives them,
    // and only those with work — a client with no projects is noise in a
    // sidebar and belongs on the Clients page instead.
    const rows = clients
      .map((client) => ({ client, boards: grouped.get(client.id) ?? [] }))
      .filter((row) => row.boards.length > 0)

    // A board whose client this person cannot see would otherwise vanish
    // entirely. Keep it, under its own heading, rather than hiding work.
    const orphaned = [...grouped.entries()]
      .filter(([id]) => !clients.some((c) => c.id === id))
      .flatMap(([, list]) => list)

    return { byClient: rows, internal: [...noClient, ...orphaned] }
  }, [workspaces, clients])

  if (error) return <p className="sidebar-error">{error}</p>
  if (!workspaces) return <p className="sidebar-note">Loading…</p>

  const nothing = byClient.length === 0 && internal.length === 0
  if (nothing) return <p className="sidebar-note">No projects are shared with you yet.</p>

  return (
    <>
      {byClient.length > 0 && (
        <div className="nav-section">
          <h2 className="nav-head">Clients</h2>
          <ul className="client-list">
            {byClient.map(({ client, boards }) => {
              const isOpen = open.has(client.id)
              const items = boards.reduce((sum, b) => sum + (b.itemCount ?? 0), 0)
              return (
                <li key={client.id} className={isOpen ? 'client-row open' : 'client-row'}>
                  <div className="client-bar">
                    <button
                      type="button"
                      className="client-twist"
                      onClick={() => toggle(client.id)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} ${client.name} projects`}
                    >
                      <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
                        <path d="M4 2.5 L8 6 L4 9.5" fill="none" stroke="currentColor"
                              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>

                    <NavLink
                      to={`/clients/${client.id}`}
                      className={({ isActive }) => (isActive ? 'client-link active' : 'client-link')}
                    >
                      <span className={`client-mark ${colourClass(client.colour)}`}>
                        {mark(client)}
                      </span>
                      <span className="client-name">{client.name}</span>
                      <span className="client-count tnum">{items}</span>
                    </NavLink>
                  </div>

                  {isOpen && (
                    <ul className="project-list">
                      {boards.map((board) => (
                        <li key={board.id}>
                          <NavLink
                            to={`/boards/${board.id}`}
                            className={({ isActive }) =>
                              isActive ? 'project-link active' : 'project-link'
                            }
                          >
                            <span className="project-name">{board.name}</span>
                            <span className="project-count tnum">{board.itemCount}</span>
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {internal.length > 0 && (
        <div className="nav-section">
          <h2 className="nav-head">Internal</h2>
          <ul className="project-list flush">
            {internal.map((board) => (
              <li key={board.id}>
                <NavLink
                  to={`/boards/${board.id}`}
                  className={({ isActive }) => (isActive ? 'project-link active' : 'project-link')}
                >
                  <span className="project-name">{board.name}</span>
                  <span className="project-count tnum">{board.itemCount}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
