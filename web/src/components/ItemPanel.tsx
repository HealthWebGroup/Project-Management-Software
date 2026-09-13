import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { BoardDetail, CellValue, ItemDetail } from '../lib/types'
import CellEditor from './CellEditor'

interface Props {
  itemId: string
  board: BoardDetail
  readOnly: boolean
  onClose: () => void
  onCellChange: (itemId: string, columnId: string, value: CellValue) => void
}

const ACTION_WORDS: Record<string, string> = {
  CREATED: 'created this item',
  RENAMED: 'renamed it',
  DELETED: 'deleted it',
  CELL_CHANGED: 'changed',
  COMMENTED: 'posted an update',
  READ: 'opened it',
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-IE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ItemPanel({ itemId, board, readOnly, onClose, onCellChange }: Props) {
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [tab, setTab] = useState<'fields' | 'updates' | 'activity'>('fields')

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    api
      .get<ItemDetail>(`/api/items/${itemId}`)
      .then((data) => !cancelled && setDetail(data))
      .catch((e) =>
        !cancelled && setError(e instanceof ApiError ? e.message : 'Could not load this item.'),
      )
    return () => {
      cancelled = true
    }
  }, [itemId])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function postComment(event: React.FormEvent) {
    event.preventDefault()
    const body = comment.trim()
    if (!body) return
    setPosting(true)
    try {
      const created = await api.post<ItemDetail['updates'][number]>(
        `/api/items/${itemId}/updates`,
        { body },
      )
      setDetail((current) =>
        current ? { ...current, updates: [created, ...current.updates] } : current,
      )
      setComment('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not post that update.')
    } finally {
      setPosting(false)
    }
  }

  // The board holds the live cell values; the panel edits the same source.
  const liveItem = board.items.find((i) => i.id === itemId)

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label="Item detail">
        <header className="panel-head">
          <h2>{liveItem?.title ?? detail?.item.title ?? 'Item'}</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <nav className="panel-tabs">
          <button className={tab === 'fields' ? 'on' : ''} onClick={() => setTab('fields')}>
            Fields
          </button>
          <button className={tab === 'updates' ? 'on' : ''} onClick={() => setTab('updates')}>
            Updates {detail ? `(${detail.updates.length})` : ''}
          </button>
          <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>
            Activity
          </button>
        </nav>

        <div className="panel-body">
          {error && <p className="form-error">{error}</p>}

          {tab === 'fields' && (
            <div className="panel-fields">
              {board.columns.map((column) => (
                <div className="panel-field" key={column.id}>
                  <span className="panel-label">{column.title}</span>
                  <div className="panel-control">
                    <CellEditor
                      column={column}
                      value={liveItem?.cells[column.id] ?? {}}
                      members={board.members}
                      readOnly={readOnly}
                      onChange={(value) => onCellChange(itemId, column.id, value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'updates' && (
            <div className="panel-updates">
              {!readOnly && (
                <form onSubmit={postComment} className="comment-form">
                  <textarea
                    placeholder="Add an update for the team…"
                    value={comment}
                    rows={3}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <button className="btn primary small" type="submit" disabled={posting || !comment.trim()}>
                    {posting ? 'Posting…' : 'Post update'}
                  </button>
                </form>
              )}
              {!detail && <p className="muted">Loading…</p>}
              {detail?.updates.length === 0 && <p className="muted">No updates yet.</p>}
              {detail?.updates.map((update) => (
                <article className="update" key={update.id}>
                  <div className="update-head">
                    <strong>{update.authorName}</strong>
                    <span>{when(update.createdAt)}</span>
                  </div>
                  <p>{update.body}</p>
                </article>
              ))}
            </div>
          )}

          {tab === 'activity' && (
            <ol className="activity">
              {!detail && <li className="muted">Loading…</li>}
              {detail?.activity.length === 0 && <li className="muted">Nothing recorded yet.</li>}
              {detail?.activity.map((entry) => (
                <li key={entry.id}>
                  <span className="act-when">{when(entry.occurredAt)}</span>
                  <span className="act-what">
                    <strong>{entry.actorName}</strong>{' '}
                    {ACTION_WORDS[entry.action] ?? entry.action.toLowerCase()}
                    {entry.detail ? ` — ${entry.detail}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </>
  )
}
