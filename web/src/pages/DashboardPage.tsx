/**
 * The landing page once you are signed in: what is due, what is at risk,
 * where the hours went, and who is online.
 *
 * Everything here comes from one /api/dashboard call. That is deliberate:
 * D1 allows a limited number of queries per request, so this page asks once
 * and the Worker does the joining.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { Dashboard } from '../lib/types'
import { useClients } from '../state/clients'
import { formatMinutes } from '../state/timer'
import { colourClass } from '../components/Pill'

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
}

export default function DashboardPage() {
  const { selected, selectedId, chartSlot } = useClients()
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    api
      .get<Dashboard>(
        selectedId ? `/api/dashboard?clientId=${selectedId}&days=30` : '/api/dashboard?days=30',
      )
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError('Could not load the dashboard.'))
    return () => {
      cancelled = true
    }
  }, [selectedId])

  if (error) return <div className="empty-state"><h1>Unavailable</h1><p>{error}</p></div>
  if (!data) return <div className="boot">Loading…</div>

  const statusTotal = data.statusBreakdown.reduce((sum, s) => sum + s.count, 0)
  const maxWorkload = Math.max(1, ...data.workload.map((w) => w.open))
  const maxHours = Math.max(1, ...data.hoursByClient.map((h) => h.minutes))

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{selected ? selected.name : 'Overview'}</h1>
          <p>{selected ? 'This client' : 'All clients'}</p>
        </div>
      </header>

      {/* Headline numbers. Severity is in the form as well as the colour. */}
      <div className="kpi-row">
        <div className="kpi">
          <span className="k">Open</span>
          <span className="v">{data.openItems}</span>
          <span className="d">items</span>
        </div>
        <div className={data.overdue > 0 ? 'kpi alert' : 'kpi'}>
          <span className="k">Overdue</span>
          <span className="v">{data.overdue}</span>
          <span className="d">{data.overdue > 0 ? 'past due' : 'none'}</span>
        </div>
        <div className={data.dueThisWeek > 0 ? 'kpi warnk' : 'kpi'}>
          <span className="k">Due this week</span>
          <span className="v">{data.dueThisWeek}</span>
          <span className="d">next 7 days</span>
        </div>
        <div className={data.unassigned > 0 ? 'kpi warnk' : 'kpi'}>
          <span className="k">Unassigned</span>
          <span className="v">{data.unassigned}</span>
          <span className="d">no owner</span>
        </div>
        <div className="kpi">
          <span className="k">Hours, 30 days</span>
          <span className="v">{formatMinutes(data.minutesLogged)}</span>
          <span className="d">
            {data.minutesLogged > 0
              ? `${Math.round((data.billableMinutes / data.minutesLogged) * 100)}% billable`
              : 'none logged'}
          </span>
        </div>
      </div>

      {/* ---- what needs attention: a list, not a chart ---- */}
      <section className="dash-block">
        <div className="dash-head">
          <h2>At risk</h2>
          <span className="dash-sub">Overdue first, then due within 7 days</span>
        </div>

        {data.atRisk.length === 0 ? (
          <p className="all-clear">Nothing overdue or due this week.</p>
        ) : (
          <div className="scroller">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Board</th>
                  <th>Client</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {data.atRisk.map((row) => (
                  <tr key={row.itemId} className={row.daysLate > 0 ? 'late' : ''}>
                    <td>
                      <Link to={`/boards/${row.boardId}`} className="risk-link">
                        {row.title}
                      </Link>
                    </td>
                    <td className="muted">{row.boardName}</td>
                    <td>{row.clientName ?? <span className="muted">Internal</span>}</td>
                    <td>
                      {row.owners.length > 0 ? (
                        row.owners.join(', ')
                      ) : (
                        <span className="unowned">Unassigned</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${colourClass(row.statusColour)}`}>
                        {row.statusLabel}
                      </span>
                    </td>
                    <td className="tnum">
                      {row.daysLate > 0 ? (
                        <span className="late-by">
                          {row.daysLate} {row.daysLate === 1 ? 'day' : 'days'} late
                        </span>
                      ) : (
                        formatDate(row.dueOn)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="dash-grid">
        {/* ---- status: one stacked bar, legend always, values direct ---- */}
        <section className="dash-block">
          <div className="dash-head">
            <h2>By status</h2>
            <span className="dash-sub">{statusTotal} items</span>
          </div>

          {statusTotal === 0 ? (
            <p className="muted">No items with a status column yet.</p>
          ) : (
            <>
              <div className="stack" role="img" aria-label="Items by status">
                {data.statusBreakdown.map((slice) => (
                  <span
                    key={slice.labelId}
                    className={`stack-seg ${colourClass(slice.colour)}`}
                    style={{ flexGrow: slice.count }}
                    title={`${slice.label}: ${slice.count} items`}
                  />
                ))}
              </div>
              <ul className="legend">
                {data.statusBreakdown.map((slice) => (
                  <li key={slice.labelId}>
                    <span className={`legend-dot ${colourClass(slice.colour)}`} aria-hidden="true" />
                    <span className="legend-label">{slice.label}</span>
                    <span className="legend-value">{slice.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* ---- workload: magnitude, so bars ---- */}
        <section className="dash-block">
          <div className="dash-head">
            <h2>Workload</h2>
            <span className="dash-sub">Open per person · overdue darker</span>
          </div>

          {data.workload.length === 0 ? (
            <p className="muted">Nobody is assigned anything yet.</p>
          ) : (
            <div className="hbars">
              {data.workload.map((row) => (
                <div className="hbar" key={row.userId}>
                  <span className="hb-name">{row.fullName}</span>
                  <span className="hb-track">
                    <span
                      className="hb-fill teal"
                      style={{ width: `${(row.open / maxWorkload) * 100}%` }}
                      title={`${row.open} open`}
                    >
                      {row.overdue > 0 && (
                        <span
                          className="hb-overdue"
                          style={{ width: `${(row.overdue / row.open) * 100}%` }}
                          title={`${row.overdue} overdue`}
                        />
                      )}
                    </span>
                  </span>
                  <span className="hb-value">
                    {row.open}
                    {row.overdue > 0 && <em className="hb-late"> · {row.overdue} late</em>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ---- hours: identity colours, validated categorical palette ---- */}
      <section className="dash-block">
        <div className="dash-head">
          <h2>Hours by client</h2>
          <span className="dash-sub">Last 30 days</span>
        </div>

        {data.hoursByClient.length === 0 ? (
          <p className="muted">No hours logged.</p>
        ) : (
          <div className="hbars">
            {data.hoursByClient.map((row) => (
              <div className="hbar" key={row.clientId ?? 'internal'}>
                <span className="hb-name">{row.clientName}</span>
                <span className="hb-track">
                  <span
                    className={`hb-fill cat-${chartSlot(row.clientId)}`}
                    style={{ width: `${(row.minutes / maxHours) * 100}%` }}
                    title={`${row.clientName}: ${formatMinutes(row.minutes)}`}
                  />
                </span>
                <span className="hb-value">{formatMinutes(row.minutes)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
