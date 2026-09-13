import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { OnlineUser, SessionRow, TimeEntry, TimeSummary } from '../lib/types'
import { useAuth } from '../state/auth'
import { formatMinutes } from '../state/timer'
import { Avatar, colourClass } from '../components/Pill'

type Tab = 'now' | 'hours' | 'history' | 'mine'

function when(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-IE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function TeamPage() {
  const { user } = useAuth()
  const isManager = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [tab, setTab] = useState<Tab>('now')

  const [online, setOnline] = useState<OnlineUser[] | null>(null)
  const [summary, setSummary] = useState<TimeSummary | null>(null)
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [mine, setMine] = useState<TimeEntry[] | null>(null)

  // Who is online refreshes on its own; the rest load once per tab.
  useEffect(() => {
    let cancelled = false
    const load = () =>
      api
        .get<OnlineUser[]>('/api/presence/online')
        .then((rows) => !cancelled && setOnline(rows))
        .catch(() => !cancelled && setOnline([]))
    void load()
    const id = window.setInterval(load, 30000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    if (tab === 'hours' && isManager && !summary) {
      api.get<TimeSummary>('/api/time/summary?days=30').then(setSummary).catch(() => setSummary(null))
    }
    if (tab === 'history' && !sessions) {
      api.get<SessionRow[]>('/api/presence/sessions?days=14').then(setSessions).catch(() => setSessions([]))
    }
    if (tab === 'mine' && !mine) {
      api.get<TimeEntry[]>('/api/time/mine?limit=100').then(setMine).catch(() => setMine([]))
    }
  }, [tab, isManager, summary, sessions, mine])

  const maxClient = Math.max(1, ...(summary?.byClient.map((c) => c.minutes) ?? [1]))
  const maxPerson = Math.max(1, ...(summary?.byPerson.map((p) => p.minutes) ?? [1]))

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Team &amp; time</h1>
          <p>Signed in now, and hours logged</p>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'now' ? 'on' : ''} onClick={() => setTab('now')}>
          Online now {online ? `(${online.length})` : ''}
        </button>
        {isManager && (
          <button className={tab === 'hours' ? 'on' : ''} onClick={() => setTab('hours')}>
            Hours by client
          </button>
        )}
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
          Login history
        </button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
          My time
        </button>
      </nav>

      {tab === 'now' && (
        <section className="panel-section">
          {!online && <p className="muted">Loading…</p>}
          {online?.length === 0 && <p className="muted">Nobody else is signed in right now.</p>}
          <div className="online-grid">
            {online?.map((person) => (
              <article className="online-card" key={person.userId}>
                <Avatar name={person.fullName} />
                <div className="oc-body">
                  <span className="oc-name">{person.fullName}</span>
                  <span className="oc-role">{person.jobTitle ?? person.role.toLowerCase()}</span>
                </div>
                <div className="oc-time">
                  <span className="live-dot" aria-hidden="true" />
                  <span className="oc-mins">{formatMinutes(person.minutesOnline)}</span>
                  <span className="oc-since">since {when(person.sessionStartedAt)}</span>
                </div>
              </article>
            ))}
          </div>
          <p className="fine-print">
            Everyone can see this page, and everyone can see their own history. Your team should
            know it exists before you rely on it.
          </p>
        </section>
      )}

      {tab === 'hours' && isManager && (
        <section className="panel-section">
          {!summary && <p className="muted">Loading…</p>}
          {summary && (
            <>
              <div className="kpi-row">
                <div className="kpi">
                  <span className="k">Logged, last 30 days</span>
                  <span className="v">{formatMinutes(summary.totalMinutes)}</span>
                </div>
                <div className="kpi">
                  <span className="k">Billable</span>
                  <span className="v">{formatMinutes(summary.billableMinutes)}</span>
                  <span className="d">
                    {summary.totalMinutes > 0
                      ? `${Math.round((summary.billableMinutes / summary.totalMinutes) * 100)}% of logged time`
                      : '—'}
                  </span>
                </div>
                <div className="kpi">
                  <span className="k">Clients with time</span>
                  <span className="v">{summary.byClient.length}</span>
                </div>
              </div>

              <h3 className="section-title">By client</h3>
              <div className="hbars">
                {summary.byClient.map((row) => (
                  <div className="hbar" key={row.clientId ?? 'internal'}>
                    <span className="hb-name">{row.clientName}</span>
                    <span className="hb-track">
                      <span
                        className={`hb-fill ${colourClass(row.colour)}`}
                        style={{ width: `${(row.minutes / maxClient) * 100}%` }}
                      />
                    </span>
                    <span className="hb-value">{formatMinutes(row.minutes)}</span>
                  </div>
                ))}
                {summary.byClient.length === 0 && <p className="muted">No time logged yet.</p>}
              </div>

              <h3 className="section-title">By person</h3>
              <div className="hbars">
                {summary.byPerson.map((row) => (
                  <div className="hbar" key={row.userId}>
                    <span className="hb-name">{row.fullName}</span>
                    <span className="hb-track">
                      <span
                        className="hb-fill teal"
                        style={{ width: `${(row.minutes / maxPerson) * 100}%` }}
                      />
                    </span>
                    <span className="hb-value">{formatMinutes(row.minutes)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'history' && (
        <section className="panel-section">
          <div className="scroller">
            <table className="data">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Signed in</th>
                  <th>Signed out</th>
                  <th>Time in the system</th>
                </tr>
              </thead>
              <tbody>
                {sessions?.map((row) => (
                  <tr key={row.id}>
                    <td>{row.fullName}</td>
                    <td className="tnum">{when(row.startedAt)}</td>
                    <td className="tnum">
                      {row.live ? <span className="still-in">still signed in</span> : when(row.endedAt)}
                    </td>
                    <td className="tnum">{formatMinutes(row.minutes)}</td>
                  </tr>
                ))}
                {sessions?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Nothing recorded in the last two weeks.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'mine' && (
        <section className="panel-section">
          <div className="scroller">
            <table className="data">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Client</th>
                  <th>Started</th>
                  <th>Time</th>
                  <th>Billable</th>
                </tr>
              </thead>
              <tbody>
                {mine?.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.itemTitle ?? entry.note ?? 'Untitled'}</td>
                    <td>
                      {entry.clientName ? (
                        <span className={`pill ${colourClass(entry.clientColour)}`}>
                          {entry.clientName}
                        </span>
                      ) : (
                        <span className="muted">Internal</span>
                      )}
                    </td>
                    <td className="tnum">{when(entry.startedAt)}</td>
                    <td className="tnum">
                      {entry.running ? (
                        <span className="still-in">running</span>
                      ) : (
                        formatMinutes(entry.minutes ?? 0)
                      )}
                    </td>
                    <td>{entry.billable ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
                {mine?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      You have not logged any time yet. Press ▶ on any item to start.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
