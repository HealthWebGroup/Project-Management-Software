/**
 * One client, on one page.
 *
 * Running five clients at once, the question is almost never "how is the
 * agency doing" — it is "where does Corrib Dental stand". That question was
 * previously answered by filtering the dashboard, scanning the sidebar for
 * their projects, and opening the Clients page for who works on them: three
 * screens for one thought.
 *
 * Everything here already existed in the API. `GET /dashboard` takes a
 * clientId, `GET /clients` carries the team and the month's hours, and the
 * projects come from the workspaces the shell already holds. No new
 * endpoint — which matters on a free D1 plan with fifty queries a request.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import NewBoardDialog from '../components/NewBoardDialog'
import type { Dashboard, Workspace } from '../lib/types'
import { useClients } from '../state/clients'
import { colourClass } from '../components/Pill'
import ClientVisibilityList from '../components/ClientVisibility'

function formatMinutes(total: number): string {
  if (!total) return '0h'
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (!hours) return `${minutes}m`
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

/** "12 days late" reads better than a date when something is overdue. */
function due(item: { dueOn?: string; daysLate: number }): string {
  if (item.daysLate > 0) return `${item.daysLate}d late`
  if (!item.dueOn) return '—'
  return new Date(`${item.dueOn}T00:00:00Z`).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'short',
  })
}

export default function ClientPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const { clients, loading } = useClients()
  const [data, setData] = useState<Dashboard | null>(null)
  const [boards, setBoards] = useState<Workspace[] | null>(null)
  const [addingBoard, setAddingBoard] = useState(false)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const client = useMemo(
    () => clients.find((row) => row.id === clientId) ?? null,
    [clients, clientId],
  )

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setData(null)
    setError(null)

    Promise.all([
      api.get<Dashboard>(`/api/dashboard?clientId=${encodeURIComponent(clientId)}`),
      api.get<Workspace[]>('/api/workspaces'),
    ])
      .then(([dash, spaces]) => {
        if (cancelled) return
        setData(dash)
        setBoards(spaces)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load this client.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [clientId])

  const projects = useMemo(
    () => (boards ?? []).flatMap((w) => w.boards).filter((b) => b.clientId === clientId),
    [boards, clientId],
  )

  if (error) return <div className="page"><p className="error">{error}</p></div>
  if (loading || !client) {
    return (
      <div className="page">
        <p className="muted">{loading ? 'Loading…' : 'That client is not available to you.'}</p>
      </div>
    )
  }

  return (
    <div className="page client-page">
      <header className="page-head">
        <div className="ch-identity">
          <span className={`ch-mark ${colourClass(client.colour)}`}>{client.code}</span>
          <div>
            <h1>{client.name}</h1>
            <p>
              {client.status === 'ACTIVE' ? 'Active' : client.status.toLowerCase()}
              {client.address ? ` · ${client.address}` : ''}
              {client.startedOn
                ? ` · since ${new Date(`${client.startedOn}T00:00:00Z`).toLocaleDateString('en-IE', {
                    month: 'short',
                    year: 'numeric',
                  })}`
                : ''}
            </p>
          </div>
        </div>
        {client.contactEmail && (
          <a className="btn ghost small" href={`mailto:${client.contactEmail}`}>
            {client.contactName ?? 'Contact'}
          </a>
        )}
      </header>

      <div className="kpi-row">
        <div className="kpi">
          <span className="k">Open</span>
          <span className="v">{data?.openItems ?? '—'}</span>
          <span className="d">items</span>
        </div>
        <div className={data && data.overdue > 0 ? 'kpi alert' : 'kpi'}>
          <span className="k">Overdue</span>
          <span className="v">{data?.overdue ?? '—'}</span>
          <span className="d">{data && data.overdue > 0 ? 'past due' : 'none'}</span>
        </div>
        <div className={data && data.dueThisWeek > 0 ? 'kpi warnk' : 'kpi'}>
          <span className="k">Due this week</span>
          <span className="v">{data?.dueThisWeek ?? '—'}</span>
          <span className="d">next 7 days</span>
        </div>
        <div className="kpi">
          <span className="k">Projects</span>
          <span className="v">{projects.length}</span>
          <span className="d">{projects.length === 1 ? 'board' : 'boards'}</span>
        </div>
        <div className="kpi">
          <span className="k">Hours, month</span>
          <span className="v">{formatMinutes(client.minutesThisMonth)}</span>
          <span className="d">logged</span>
        </div>
      </div>

      <div className="client-grid-2">
        <section className="dash-block">
          <div className="dash-head">
            <h2>Projects</h2>
            <span className="dash-sub">{projects.length}</span>
            <button className="btn ghost small" onClick={() => setAddingBoard(true)}>
              + New board
            </button>
          </div>
          {projects.length === 0 ? (
            // This used to say "No projects yet." and stop, which was a dead
            // end: the one thing you wanted was to start work for this client
            // and the page offered no way to. New clients now come with a
            // board, so this is only reached if every board was deleted.
            <div className="empty-do">
              <p className="muted">No boards for this client yet.</p>
              <button className="btn primary" onClick={() => setAddingBoard(true)}>
                Create the first board
              </button>
            </div>
          ) : (
            <ul className="proj-cards">
              {projects.map((board) => (
                <li key={board.id}>
                  <Link className="proj-card" to={`/boards/${board.id}`}>
                    <span className="pc-name">{board.name}</span>
                    {board.description && <span className="pc-desc">{board.description}</span>}
                    <span className="pc-count tnum">{board.itemCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-block">
          <div className="dash-head">
            <h2>Team</h2>
            <span className="dash-sub">{client.team.length}</span>
          </div>
          {client.team.length === 0 ? (
            <p className="muted pad">Nobody assigned.</p>
          ) : (
            <ul className="team-rows">
              {client.team.map((person) => (
                <li key={person.userId}>
                  <span className="tr-name">{person.fullName}</span>
                  <span className="tr-role">
                    {person.jobTitle ?? person.roleOnClient.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Assigning a team and then having no way to check the result is
              how a client ends up assumed private when it is not. */}
          <div className="dash-head sub">
            <h2>Who can see this client</h2>
          </div>
          <ClientVisibilityList clientId={client.id} />
        </section>
      </div>

      <section className="dash-block">
        <div className="dash-head">
          <h2>At risk</h2>
          <span className="dash-sub">Overdue first, then due within 7 days</span>
        </div>
        {!data ? (
          <p className="muted pad">Loading…</p>
        ) : data.atRisk.length === 0 ? (
          <p className="all-clear">Nothing overdue or due this week.</p>
        ) : (
          <div className="scroller">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Project</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {data.atRisk.map((item) => (
                  <tr key={item.itemId} className={item.daysLate > 0 ? 'late' : ''}>
                    <td className="strong">{item.title}</td>
                    <td>
                      <Link to={`/boards/${item.boardId}`}>{item.boardName}</Link>
                    </td>
                    <td className={item.owners.length ? '' : 'unowned'}>
                      {item.owners.length ? item.owners.join(', ') : 'Unassigned'}
                    </td>
                    <td>
                      <span className={`pill ${colourClass(item.statusColour)}`}>
                        {item.statusLabel}
                      </span>
                    </td>
                    <td className={item.daysLate > 0 ? 'late-cell tnum' : 'tnum'}>{due(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {client.notes && (
        <section className="dash-block">
          <div className="dash-head">
            <h2>Notes</h2>
          </div>
          <p className="client-notes">{client.notes}</p>
          {addingBoard && boards && (
        <NewBoardDialog
          workspaces={boards}
          clientId={clientId}
          clientName={client.name}
          onClose={() => setAddingBoard(false)}
          onCreated={(board) => {
            setAddingBoard(false)
            // Straight into the new board. Creating one and being left on
            // the page you started from makes you hunt for the thing you
            // just made.
            navigate(`/boards/${board.id}`)
          }}
        />
      )}

    </section>
      )}
    </div>
  )
}
