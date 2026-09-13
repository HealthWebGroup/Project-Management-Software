/**
 * Who is on the team, what each person may do, and which clients they see.
 *
 * Administrators only - the two levers (role, and the client list) are the
 * same two the API enforces, and the preview dialog shows the result of both
 * together so the effect of a change is visible before it is saved.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { AccessPreview, Client, ClientRole, Person, Role, UserStatus } from '../lib/types'
import { useAuth } from '../state/auth'
import { useClients } from '../state/clients'
import Dialog from '../components/Dialog'
import { Avatar, colourClass } from '../components/Pill'

const ROLES: { value: Role; label: string; blurb: string }[] = [
  { value: 'ADMIN', label: 'Administrator', blurb: 'Everything, including who can see what' },
  { value: 'MANAGER', label: 'Manager', blurb: 'Every client and board; can add clients' },
  { value: 'MEMBER', label: 'Member', blurb: 'Edits work, but only for their clients' },
  { value: 'VIEWER', label: 'Viewer', blurb: 'Read-only, and only their clients' },
  { value: 'GUEST', label: 'Guest', blurb: 'Nothing until you add them to a board' },
]

const STATUSES: UserStatus[] = ['ACTIVE', 'SUSPENDED', 'LEAVER']

export default function PeoplePage() {
  const { user } = useAuth()
  const { clients } = useClients()
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<Person | null>(null)
  const [adding, setAdding] = useState(false)
  const [previewing, setPreviewing] = useState<Person | null>(null)

  // Administrators only, the same rule the API enforces. A manager has
  // every power needed to run the work; changing who may see what is not
  // one of them. Hiding the page is a courtesy — the server refuses these
  // routes regardless of what the interface shows.
  const isAdmin = user?.role === 'ADMIN'

  async function load() {
    try {
      setPeople(await api.get<Person[]>('/api/people'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the team.')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (!isAdmin) {
    return (
      <div className="empty-state">
        <h1>No access</h1>
        <p>Only an administrator can change who sees what.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>People</h1>
          <p>
            <strong>Role</strong> sets what someone can do. <strong>Clients</strong> sets what they
            can see. Board exceptions cover the rest.
          </p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          Add person
        </button>
      </header>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-notice">{notice}</p>}
      {!people && <p className="muted">Loading…</p>}

      <div className="people-grid">
        {people?.map((person) => (
          <article className={`person-card ${person.status !== 'ACTIVE' ? 'inactive' : ''}`} key={person.id}>
            <div className="pc-head">
              <Avatar name={person.fullName} />
              <div className="pc-who">
                <span className="pc-name">
                  {person.fullName}
                  {person.id === user?.id && <em className="pc-you">you</em>}
                </span>
                <span className="pc-email">{person.email}</span>
                {person.jobTitle && <span className="pc-job">{person.jobTitle}</span>}
              </div>
              <span className={`role-chip ${person.role.toLowerCase()}`}>
                {ROLES.find((r) => r.value === person.role)?.label ?? person.role}
              </span>
            </div>

            {person.status !== 'ACTIVE' && (
              <p className="pc-suspended">
                {person.status === 'SUSPENDED' ? 'Suspended — cannot sign in' : 'Left the company'}
              </p>
            )}

            {person.status === 'ACTIVE' && !person.lastLoginAt && (
              <p className="pc-pending">Added, but has not signed in yet</p>
            )}

            <div className="pc-sees">
              <span className="pc-label">Can see</span>
              {person.seesEveryClient ? (
                <span className="pc-all">Every client</span>
              ) : person.clients.length === 0 ? (
                <span className="pc-none">
                  No clients yet — only internal boards
                </span>
              ) : (
                <div className="pc-chips">
                  {person.clients.map((client) => (
                    <span className={`pill ${colourClass(client.colour)}`} key={client.clientId}>
                      {client.name}
                      {client.roleOnClient === 'LEAD' && <em className="chip-lead">lead</em>}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {person.boardOverrides.length > 0 && (
              <div className="pc-sees">
                <span className="pc-label">Board exceptions</span>
                <div className="pc-chips">
                  {person.boardOverrides.map((o) => (
                    <span className="pill grey" key={o.boardId}>
                      {o.boardName} · {o.permission.toLowerCase()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <footer className="pc-foot">
              <button className="btn ghost small" onClick={() => setEditing(person)}>
                Edit
              </button>
              <button className="btn ghost small" onClick={() => setPreviewing(person)}>
                What they see
              </button>
            </footer>
          </article>
        ))}
      </div>

      {people?.length === 0 && (
        <p className="muted">
          Nobody here yet. Add a colleague above, or they will appear the first time they sign in.
        </p>
      )}

      {(adding || editing) && (
        <PersonDialog
          person={editing}
          clients={clients}
          isAdmin={Boolean(isAdmin)}
          isSelf={editing?.id === user?.id}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSaved={async (message) => {
            setAdding(false)
            setEditing(null)
            setError(null)
            setNotice(message)
            await load()
          }}
        />
      )}

      {previewing && (
        <PreviewDialog person={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  )
}

// ------------------------------------------------------- add / edit person

/**
 * One form for both jobs. Adding and editing ask almost exactly the same
 * questions, and keeping them in one component is the only way to be sure the
 * two never drift apart.
 */
function PersonDialog({
  person,
  clients,
  isAdmin,
  isSelf,
  onClose,
  onSaved,
}: {
  person: Person | null
  clients: Client[]
  isAdmin: boolean
  isSelf: boolean
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const adding = person === null

  const [fullName, setFullName] = useState(person?.fullName ?? '')
  const [email, setEmail] = useState(person?.email ?? '')
  const [jobTitle, setJobTitle] = useState(person?.jobTitle ?? '')
  const [role, setRole] = useState<Role>(person?.role ?? 'MEMBER')
  const [status, setStatus] = useState<UserStatus>(person?.status ?? 'ACTIVE')
  const [assigned, setAssigned] = useState<Set<string>>(
    () => new Set((person?.clients ?? []).map((c) => c.clientId)),
  )
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const seesEveryClient = role === 'ADMIN' || role === 'MANAGER'
  // A manager can add colleagues, but not someone with power over them.
  const canPickRole = adding ? true : isAdmin
  const roleLocked = (value: Role) =>
    !canPickRole || ((value === 'ADMIN' || value === 'MANAGER') && !isAdmin)

  function toggle(clientId: string) {
    setAssigned((current) => {
      const next = new Set(current)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  function clientPayload() {
    return [...assigned].map((clientId) => ({
      clientId,
      roleOnClient:
        (person?.clients.find((c) => c.clientId === clientId)?.roleOnClient ??
          'MEMBER') as ClientRole,
    }))
  }

  async function save() {
    setLocalError(null)
    if (!fullName.trim()) return setLocalError('Enter their name.')
    if (!email.trim()) return setLocalError('Enter their email address.')

    setBusy(true)
    try {
      if (adding) {
        await api.post('/api/people', {
          email: email.trim(),
          fullName: fullName.trim(),
          jobTitle: jobTitle.trim() || undefined,
          role,
          clients: seesEveryClient ? [] : clientPayload(),
        })
        onSaved(`${fullName.trim()} added. They still need to be in your Cloudflare Access policy to sign in.`)
      } else {
        // Two writes, so say which one failed. Reporting "nothing saved"
        // when the role change went through and only the clients did not is
        // worse than the failure itself.
        await api.patch(`/api/people/${person.id}`, {
          role,
          status,
          fullName: fullName.trim(),
          jobTitle: jobTitle.trim(),
          ...(isAdmin ? { email: email.trim() } : {}),
        })
        try {
          await api.put(`/api/people/${person.id}/clients`, {
            clients: seesEveryClient ? [] : clientPayload(),
          })
        } catch (e) {
          setLocalError(
            `Their role and details were saved, but the client list was not: ${
              e instanceof ApiError ? e.message : 'the request failed'
            }`,
          )
          setBusy(false)
          return
        }
        onSaved(`${fullName.trim()} updated.`)
      }
    } catch (e) {
      setLocalError(e instanceof ApiError ? e.message : 'Could not save that.')
      setBusy(false)
    }
  }

  async function remove() {
    if (!person) return
    setLocalError(null)
    setBusy(true)
    try {
      await api.del(`/api/people/${person.id}`)
      onSaved(`${person.fullName} removed.`)
    } catch (e) {
      setLocalError(e instanceof ApiError ? e.message : 'Could not delete that account.')
      setBusy(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <Dialog title={adding ? 'Add someone' : `Edit ${person.fullName}`} onClose={onClose}>
      <div className="access-form">
        <section>
          <h3 className="af-title">Who they are</h3>
          <div className="field-grid">
            <label className="field">
              <span className="field-label">Full name</span>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Aoife Kelly"
                autoComplete="off"
              />
            </label>

            <label className="field">
              <span className="field-label">Job title</span>
              <input
                className="input"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Project manager"
                autoComplete="off"
              />
            </label>

            <label className="field wide">
              <span className="field-label">Work email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!adding && !isAdmin}
                placeholder="name@healthwebgroup.com"
                autoComplete="off"
              />
            </label>
          </div>

          {adding ? (
            <p className="af-warn">
              This creates the account so they land with the right access on day one. It does{' '}
              <strong>not</strong> let them in: sign-in is decided by Cloudflare Access, so add this
              same address to your Access policy in the Cloudflare dashboard. The addresses must
              match exactly.
            </p>
          ) : isAdmin ? (
            <p className="af-note">
              The email address is what Cloudflare Access matches on. Change it here and you must
              change it in the Access policy too, or they will not be able to sign in.
            </p>
          ) : (
            <p className="af-note">Only an administrator can change someone's email address.</p>
          )}
        </section>

        <section>
          <h3 className="af-title">Role</h3>
          {!canPickRole && (
            <p className="af-note">Only an administrator can change someone's role.</p>
          )}
          {canPickRole && !isAdmin && (
            <p className="af-note">
              Only an administrator can create an administrator or a manager.
            </p>
          )}
          <div className="role-list">
            {ROLES.map((option) => (
              <label
                className={`role-option ${role === option.value ? 'on' : ''} ${
                  roleLocked(option.value) ? 'off' : ''
                }`}
                key={option.value}
              >
                <input
                  type="radio"
                  name="role"
                  checked={role === option.value}
                  disabled={roleLocked(option.value)}
                  onChange={() => setRole(option.value)}
                />
                <span className="ro-body">
                  <span className="ro-label">{option.label}</span>
                  <span className="ro-blurb">{option.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="af-title">Clients they can see</h3>
          {seesEveryClient ? (
            <p className="af-note">
              {role === 'ADMIN' ? 'An administrator' : 'A manager'} reaches every client, so there is
              nothing to pick here. Change the role to Member or Viewer to limit them.
            </p>
          ) : (
            <>
              <p className="af-note">
                Tick a client and this person sees that client's boards. Internal boards, the ones
                not tied to any client, stay visible either way.
              </p>
              <div className="client-picks">
                {clients.map((client) => (
                  <label
                    className={`client-pick ${assigned.has(client.id) ? 'on' : ''}`}
                    key={client.id}
                  >
                    <input
                      type="checkbox"
                      checked={assigned.has(client.id)}
                      onChange={() => toggle(client.id)}
                    />
                    <span className={`opt-code ${colourClass(client.colour)}`}>{client.code}</span>
                    <span className="cp-name">{client.name}</span>
                  </label>
                ))}
                {clients.length === 0 && <p className="muted">No clients yet.</p>}
              </div>
            </>
          )}
        </section>

        {!adding && (
          <section>
            <h3 className="af-title">Account</h3>
            <div className="status-row">
              {STATUSES.map((option) => (
                <label className={`status-option ${status === option ? 'on' : ''}`} key={option}>
                  <input
                    type="radio"
                    name="status"
                    checked={status === option}
                    onChange={() => setStatus(option)}
                  />
                  <span>
                    {option === 'ACTIVE' ? 'Active' : option === 'SUSPENDED' ? 'Suspended' : 'Left'}
                  </span>
                </label>
              ))}
            </div>
            {status !== 'ACTIVE' && (
              <p className="af-warn">
                They will not be able to sign in. Their work and logged time stay exactly as they
                are.
              </p>
            )}
          </section>
        )}

        {!adding && isAdmin && !isSelf && (
          <section className="danger-zone">
            <h3 className="af-title">Remove the account</h3>
            {!confirmingDelete ? (
              <>
                <p className="af-note">
                  Only possible while the account is empty. Once someone has logged time or created
                  work, set them to <strong>Left</strong> above instead — that stops the sign-in and
                  keeps the history intact.
                </p>
                <button className="btn danger small" onClick={() => setConfirmingDelete(true)}>
                  Delete {person.fullName}
                </button>
              </>
            ) : (
              <>
                <p className="af-warn">
                  Delete {person.fullName} ({person.email})? This cannot be undone.
                </p>
                <div className="confirm-row">
                  <button className="btn ghost small" onClick={() => setConfirmingDelete(false)}>
                    Keep them
                  </button>
                  <button className="btn danger small" onClick={remove} disabled={busy}>
                    {busy ? 'Deleting…' : 'Yes, delete'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {localError && <p className="form-error">{localError}</p>}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : adding ? 'Add person' : 'Save changes'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

// --------------------------------------------------------------- preview

function PreviewDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const [preview, setPreview] = useState<AccessPreview | null>(null)
  // Without this, a failed request looked exactly like a slow one and the
  // dialog said "Working it out…" forever.
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<AccessPreview>(`/api/people/${person.id}/preview`)
      .then((data) => !cancelled && setPreview(data))
      .catch((e) =>
        !cancelled &&
        setFailed(e instanceof ApiError ? e.message : 'Could not work out what they see.'),
      )
    return () => {
      cancelled = true
    }
  }, [person.id])

  const visible = useMemo(
    () => (preview?.boards ?? []).filter((b) => b.access !== 'none'),
    [preview],
  )
  const hidden = useMemo(
    () => (preview?.boards ?? []).filter((b) => b.access === 'none'),
    [preview],
  )

  return (
    <Dialog title={`What ${person.fullName} sees`} onClose={onClose}>
      <p className="dialog-note">
        Worked out by the same rule the server enforces with, so this cannot drift from what
        actually happens.
      </p>

      {failed && <p className="form-error">{failed}</p>}
      {!preview && !failed && <p className="muted">Working it out…</p>}

      {preview && (
        <>
          <h3 className="af-title">Can open ({visible.length})</h3>
          <ul className="preview-list">
            {visible.map((board) => (
              <li key={board.boardId}>
                <span className="pv-name">{board.boardName}</span>
                {board.clientName && <span className="pv-client">{board.clientName}</span>}
                <span className={`pv-access ${board.access.replace(/ /g, '-')}`}>{board.access}</span>
                {board.viaOverride && <span className="pv-override">named on this board</span>}
              </li>
            ))}
            {visible.length === 0 && <li className="muted">Nothing at all.</li>}
          </ul>

          {hidden.length > 0 && (
            <>
              <h3 className="af-title">Cannot see ({hidden.length})</h3>
              <ul className="preview-list dim">
                {hidden.map((board) => (
                  <li key={board.boardId}>
                    <span className="pv-name">{board.boardName}</span>
                    {board.clientName && <span className="pv-client">{board.clientName}</span>}
                    <span className="pv-access none">hidden</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <div className="dialog-actions">
        <button className="btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}
