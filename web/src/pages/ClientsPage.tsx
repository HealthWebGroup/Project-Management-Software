/**
 * The clients, as cards: adding one, editing it, and who works on it.
 *
 * safeUrl at the bottom is the reason a client website is rendered as a link
 * at all - anything that is not plain http(s) is dropped rather than trusted.
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { Client, ClientRole, ClientStatus, User } from '../lib/types'
import { useAuth } from '../state/auth'
import { useClients } from '../state/clients'
import { formatMinutes } from '../state/timer'
import { Avatar, colourClass } from '../components/Pill'
import Dialog from '../components/Dialog'

const COLOURS = ['blue', 'teal', 'green', 'amber', 'red', 'violet', 'grey']
const STATUSES: ClientStatus[] = ['PROSPECT', 'ACTIVE', 'PAUSED', 'ARCHIVED']

export default function ClientsPage() {
  const { clients, refresh, select } = useClients()
  const { user } = useAuth()
  const [adding, setAdding] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Client | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Clients</h1>
          <p>Who you work for, and who looks after them</p>
        </div>
        {canManage && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add client
          </button>
        )}
      </header>

      {error && <p className="form-error">{error}</p>}

      <div className="client-grid">
        {clients.map((client) => (
          <article className={`client-card ${colourClass(client.colour)}`} key={client.id}>
            <div className="cc-head">
              <span className={`cc-code ${colourClass(client.colour)}`}>{client.code}</span>
              <div className="cc-title">
                <h2>{client.name}</h2>
                <span className={`cc-status ${client.status.toLowerCase()}`}>
                  {client.status.toLowerCase()}
                </span>
              </div>
            </div>

            <dl className="cc-details">
              {client.contactName && (
                <div>
                  <dt>Contact</dt>
                  <dd>{client.contactName}</dd>
                </div>
              )}
              {client.contactEmail && (
                <div>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${client.contactEmail}`}>{client.contactEmail}</a>
                  </dd>
                </div>
              )}
              {client.contactPhone && (
                <div>
                  <dt>Phone</dt>
                  <dd>{client.contactPhone}</dd>
                </div>
              )}
              {safeUrl(client.website) && (
                <div>
                  <dt>Website</dt>
                  <dd>
                    <a href={safeUrl(client.website)} target="_blank" rel="noreferrer noopener">
                      {(client.website ?? '').replace(/^https?:\/\//, '')}
                    </a>
                  </dd>
                </div>
              )}
              {client.address && (
                <div>
                  <dt>Address</dt>
                  <dd>{client.address}</dd>
                </div>
              )}
            </dl>

            {client.notes && <p className="cc-notes">{client.notes}</p>}

            <div className="cc-team">
              <span className="cc-team-label">Team</span>
              <div className="cc-team-people">
                {client.team.length === 0 && <span className="muted">Nobody assigned</span>}
                {client.team.map((member) => (
                  <span className="cc-person" key={member.userId} title={member.jobTitle ?? ''}>
                    <Avatar name={member.fullName} />
                    <span>{member.fullName}</span>
                    {member.roleOnClient === 'LEAD' && <span className="cc-lead">lead</span>}
                  </span>
                ))}
              </div>
              {canManage && (
                <button className="btn ghost small" onClick={() => setEditingTeam(client)}>
                  Change team
                </button>
              )}
            </div>

            <footer className="cc-foot">
              <span>
                <strong>{client.openItems}</strong> items
              </span>
              <span>
                <strong>{formatMinutes(client.minutesThisMonth)}</strong> last 30 days
              </span>
              <button className="btn ghost small" onClick={() => select(client.id)}>
                Switch to this client
              </button>
            </footer>
          </article>
        ))}

        {clients.length === 0 && (
          <p className="muted">No clients yet. Add the first one to get started.</p>
        )}
      </div>

      {adding && (
        <AddClientDialog
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await refresh()
          }}
          onError={setError}
        />
      )}

      {editingTeam && (
        <TeamDialog
          client={editingTeam}
          onClose={() => setEditingTeam(null)}
          onSaved={async () => {
            setEditingTeam(null)
            await refresh()
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- add

function AddClientDialog({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [form, setForm] = useState({
    name: '', code: '', status: 'ACTIVE' as ClientStatus, colour: 'blue',
    contactName: '', contactEmail: '', contactPhone: '', website: '', address: '', notes: '',
    startedOn: '',
  })
  const [busy, setBusy] = useState(false)

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await api.post('/api/clients', {
        ...form,
        code: form.code.trim().toUpperCase(),
        startedOn: form.startedOn || undefined,
        contactEmail: form.contactEmail || undefined,
      })
      onSaved()
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Could not add that client.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Add a client" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <div className="row-2">
          <label className="field">
            <span>Client name</span>
            <input required autoFocus value={form.name} onChange={set('name')} />
          </label>
          <label className="field">
            <span>Short code</span>
            <input
              required
              maxLength={12}
              placeholder="RIV"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            />
          </label>
        </div>

        <div className="row-2">
          <label className="field">
            <span>Status</span>
            <select value={form.status} onChange={set('status')}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Colour</span>
            <div className="swatches">
              {COLOURS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch ${c} ${form.colour === c ? 'on' : ''}`}
                  aria-label={c}
                  onClick={() => setForm((f) => ({ ...f, colour: c }))}
                />
              ))}
            </div>
          </label>
        </div>

        <div className="row-2">
          <label className="field">
            <span>Contact name</span>
            <input value={form.contactName} onChange={set('contactName')} />
          </label>
          <label className="field">
            <span>Contact email</span>
            <input type="email" value={form.contactEmail} onChange={set('contactEmail')} />
          </label>
        </div>

        <div className="row-2">
          <label className="field">
            <span>Phone</span>
            <input value={form.contactPhone} onChange={set('contactPhone')} />
          </label>
          <label className="field">
            <span>Website</span>
            <input placeholder="https://" value={form.website} onChange={set('website')} />
          </label>
        </div>

        <div className="row-2">
          <label className="field">
            <span>Address</span>
            <input value={form.address} onChange={set('address')} />
          </label>
          <label className="field">
            <span>Working with them since</span>
            <input type="date" value={form.startedOn} onChange={set('startedOn')} />
          </label>
        </div>

        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={form.notes} onChange={set('notes')} />
        </label>

        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add client'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------- team

function TeamDialog({
  client,
  onClose,
  onSaved,
  onError,
}: {
  client: Client
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [everyone, setEveryone] = useState<User[] | null>(null)
  const [assigned, setAssigned] = useState<Record<string, ClientRole>>(() =>
    Object.fromEntries(client.team.map((m) => [m.userId, m.roleOnClient])),
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<User[]>('/api/users')
      .then((people) => !cancelled && setEveryone(people))
      .catch(() => !cancelled && setEveryone([]))
    return () => {
      cancelled = true
    }
  }, [])

  function toggle(userId: string) {
    setAssigned((current) => {
      const next = { ...current }
      if (next[userId]) delete next[userId]
      else next[userId] = 'MEMBER'
      return next
    })
  }

  function makeLead(userId: string) {
    setAssigned((current) => {
      const next: Record<string, ClientRole> = {}
      for (const [id, role] of Object.entries(current)) next[id] = role === 'LEAD' ? 'MEMBER' : role
      next[userId] = 'LEAD'
      return next
    })
  }

  async function save() {
    setBusy(true)
    try {
      await api.put(`/api/clients/${client.id}/team`, {
        members: Object.entries(assigned).map(([userId, roleOnClient]) => ({ userId, roleOnClient })),
      })
      onSaved()
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Could not save the team.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Who works with ${client.name}`} onClose={onClose}>
      <p className="dialog-note">
        Tick everyone who works on this client. One person can be the lead — the named point of
        contact.
      </p>
      <div className="people-list">
        {!everyone && <p className="muted">Loading…</p>}
        {everyone?.map((person) => {
          const role = assigned[person.id]
          return (
            <div className={`person-row ${role ? 'on' : ''}`} key={person.id}>
              <label className="person-pick">
                <input type="checkbox" checked={!!role} onChange={() => toggle(person.id)} />
                <Avatar name={person.fullName} />
                <span className="pr-name">
                  {person.fullName}
                  {person.jobTitle && <small>{person.jobTitle}</small>}
                </span>
              </label>
              {role && (
                <button
                  type="button"
                  className={`lead-btn ${role === 'LEAD' ? 'on' : ''}`}
                  onClick={() => makeLead(person.id)}
                >
                  {role === 'LEAD' ? 'Lead' : 'Make lead'}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save team'}
        </button>
      </div>
    </Dialog>
  )
}

/**
 * Only http and https reach an href.
 *
 * The server refuses anything else now, but a website saved before that check
 * existed is still in the database, and `javascript:` in a link runs on our
 * origin with the session of whoever clicks it.
 */
function safeUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}
