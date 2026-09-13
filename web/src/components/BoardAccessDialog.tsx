import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { BoardAccess, BoardDetail, BoardPermission, Person, Sensitivity } from '../lib/types'
import { useAuth } from '../state/auth'
import Dialog from './Dialog'
import { Avatar } from './Pill'

/**
 * Access to one board: how locked down it is, and who is named on it by hand.
 *
 * The API behind this has been enforcing these rules since the beginning;
 * until now there was no screen for it, which meant the only way to name
 * somebody on a board was an API call. This is that screen.
 */

const SENSITIVITIES: { value: Sensitivity; label: string; blurb: string }[] = [
  {
    value: 'INTERNAL',
    label: 'Internal',
    blurb: 'Ordinary work. Anyone with access to this client can open it.',
  },
  {
    value: 'CONFIDENTIAL',
    label: 'Confidential',
    blurb: 'Managers and administrators only. Hiring boards start here.',
  },
  {
    value: 'RESTRICTED',
    label: 'Restricted',
    blurb:
      'Named people only, whatever their role. An administrator sees it listed and cannot open it.',
  },
]

const PERMISSIONS: { value: BoardPermission; label: string }[] = [
  { value: 'VIEW', label: 'Can view' },
  { value: 'EDIT', label: 'Can edit' },
  { value: 'ADMIN', label: 'Can administer' },
]

export default function BoardAccessDialog({
  board,
  onClose,
  onChanged,
}: {
  board: BoardDetail
  onClose: () => void
  onChanged: () => void
}) {
  const { user } = useAuth()
  const [access, setAccess] = useState<BoardAccess | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sensitivity, setSensitivity] = useState<Sensitivity>(board.sensitivity)
  const [named, setNamed] = useState<Map<string, BoardPermission>>(new Map())

  const isAdmin = user?.role === 'ADMIN'

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get<BoardAccess>(`/api/boards/${board.id}/members`),
      api.get<Person[]>('/api/people').catch(() => [] as Person[]),
    ])
      .then(([current, everyone]) => {
        if (cancelled) return
        setAccess(current)
        setPeople(everyone)
        setSensitivity(current.sensitivity)
        setNamed(new Map(current.members.map((m) => [m.userId, m.permission])))
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : 'Could not load this.'))
    return () => {
      cancelled = true
    }
    // reloadKey re-reads after a save. Without it `access` kept its original
    // sensitivity, so setting a board restricted and then changing your mind
    // in the same dialog skipped the second save and still said "Saved."
  }, [board.id, reloadKey])

  function toggle(userId: string) {
    setNamed((current) => {
      const next = new Map(current)
      if (next.has(userId)) next.delete(userId)
      else next.set(userId, 'EDIT')
      return next
    })
  }

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (isAdmin && sensitivity !== access?.sensitivity) {
        await api.patch(`/api/boards/${board.id}/sensitivity`, { sensitivity })
      }
      await api.put(`/api/boards/${board.id}/members`, {
        members: [...named.entries()].map(([userId, permission]) => ({ userId, permission })),
      })
      setNotice('Saved.')
      onChanged()
      setReloadKey((n) => n + 1)
      setBusy(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that.')
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Access to ${board.name}`} onClose={onClose}>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-notice">{notice}</p>}
      {!access && !error && <p className="muted">Loading…</p>}

      {access && (
        <div className="access-form">
          <section>
            <h3 className="af-title">How locked down this board is</h3>
            {!isAdmin && (
              <p className="af-note">Only an administrator can change this.</p>
            )}
            <div className="role-list">
              {SENSITIVITIES.map((option) => (
                <label
                  className={`role-option ${sensitivity === option.value ? 'on' : ''} ${
                    isAdmin ? '' : 'off'
                  }`}
                  key={option.value}
                >
                  <input
                    type="radio"
                    name="sensitivity"
                    checked={sensitivity === option.value}
                    disabled={!isAdmin}
                    onChange={() => setSensitivity(option.value)}
                  />
                  <span className="ro-body">
                    <span className="ro-label">{option.label}</span>
                    <span className="ro-blurb">{option.blurb}</span>
                  </span>
                </label>
              ))}
            </div>
            {sensitivity === 'RESTRICTED' && named.size === 0 && (
              <p className="af-warn">
                Restricted with nobody named means nobody can open this board — including you.
                Name at least one person below.
              </p>
            )}
          </section>

          <section>
            <h3 className="af-title">Named on this board</h3>
            <p className="af-note">
              An exception, for the cases roles and clients do not cover: a contractor who needs
              one board, or the handful of people allowed into a restricted one. What you set here
              wins over everything else, in both directions.
            </p>

            <div className="client-picks">
              {people.map((person) => {
                const on = named.has(person.id)
                return (
                  <div className={`board-member ${on ? 'on' : ''}`} key={person.id}>
                    <label className="bm-pick">
                      <input type="checkbox" checked={on} onChange={() => toggle(person.id)} />
                      <Avatar name={person.fullName} />
                      <span className="bm-who">
                        <span className="bm-name">{person.fullName}</span>
                        <span className="bm-role">{person.role.toLowerCase()}</span>
                      </span>
                    </label>
                    {on && (
                      <select
                        className="bm-permission"
                        value={named.get(person.id)}
                        onChange={(e) =>
                          setNamed((current) =>
                            new Map(current).set(person.id, e.target.value as BoardPermission),
                          )
                        }
                      >
                        {PERMISSIONS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )
              })}
              {people.length === 0 && (
                <p className="muted">
                  Only managers and administrators can see the list of people to name here.
                </p>
              )}
            </div>
          </section>

          <div className="dialog-actions">
            <button className="btn ghost" onClick={onClose}>Close</button>
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save access'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
