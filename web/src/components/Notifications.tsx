import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { NotificationList } from '../lib/types'

/**
 * The bell.
 *
 * Every one of these is yours alone — the API has no route that reads anyone
 * else's, not even for an administrator. Reading one marks it read; "Mark all
 * read" clears the rest, because a badge that will not clear is a badge people
 * learn to ignore.
 */

const POLL_MS = 60_000

export default function Notifications() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<NotificationList | null>(null)
  const [emailOn, setEmailOn] = useState<boolean | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  // Three things call load(): the poll, opening the panel, and marking all
  // read. Without a sequence number a poll that started first can land last
  // and put the unread badge back after you have cleared it.
  const sequence = useRef(0)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  async function load() {
    const mine = ++sequence.current
    try {
      const next = await api.get<NotificationList>('/api/notifications')
      if (alive.current && mine === sequence.current) setData(next)
    } catch {
      /* the bell is not worth an error message on every screen */
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false)
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

  async function openPanel() {
    setOpen(true)
    await load()
    if (emailOn === null) {
      await api
        .get<{ emailEnabled: boolean }>('/api/notifications/settings')
        .then((s) => setEmailOn(s.emailEnabled))
        .catch(() => setEmailOn(false))
    }
  }

  async function markAllRead() {
    await api.post('/api/notifications/read', {}).catch(() => undefined)
    await load()
  }

  const unread = data?.unread ?? 0

  return (
    <div className="bell-wrap" ref={wrap}>
      <button
        className={`bell ${unread > 0 ? 'has-unread' : ''}`}
        onClick={() => (open ? setOpen(false) : void openPanel())}
        title={unread > 0 ? `${unread} unread` : 'Notifications'}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
          <path
            d="M10 2.5a4.5 4.5 0 0 0-4.5 4.5v2.6L4 12.5h12l-1.5-2.9V7A4.5 4.5 0 0 0 10 2.5Z"
            fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
          />
          <path d="M8 15a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <header className="bell-head">
            <h3>Notifications</h3>
            {unread > 0 && (
              <button className="btn ghost small" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </header>

          <ul className="bell-list">
            {(data?.notifications ?? []).map((note) => (
              <li key={note.id} className={note.read ? '' : 'unread'}>
                <button
                  className="bell-item"
                  onClick={async () => {
                    await api.post('/api/notifications/read', { ids: [note.id] }).catch(() => undefined)
                    setOpen(false)
                    if (note.boardId) navigate(`/boards/${note.boardId}`)
                    await load()
                  }}
                >
                  <span className="bell-title">{note.title}</span>
                  {note.body && <span className="bell-body">{note.body}</span>}
                  <span className="bell-when">
                    {note.boardName ? `${note.boardName} · ` : ''}
                    {ago(note.createdAt)}
                  </span>
                </button>
              </li>
            ))}
            {data && data.notifications.length === 0 && (
              <li className="bell-empty">
                Nothing yet. You will hear about work assigned to you, comments on items you own,
                and anything a rule is set to tell you about.
              </li>
            )}
          </ul>

          {emailOn !== null && (
            <p className="bell-foot">
              {emailOn
                ? 'A daily summary of anything still unread is emailed to you each morning.'
                : 'In-app only — no email is configured, so nothing here leaves the app.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
}
