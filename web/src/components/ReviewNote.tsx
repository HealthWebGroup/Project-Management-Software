/**
 * The review note on a task: what is actually happening with it.
 *
 * "Reached out, waiting to hear back." "Sitting in deployment." That is the
 * information a team loses when a board only records status labels — a
 * label says which column a task is in, and a note says why it is still
 * there. The two answer different questions and a board needs both.
 *
 * Shown on the board itself rather than inside the task panel. A note one
 * click deep gets read by nobody, and a note nobody reads is a note nobody
 * writes, so the whole thing quietly dies. It is on the row and on the
 * card, in the author's words, with who and when.
 *
 * Notes are appended, never edited in place: they go into item_update,
 * which is the same append-only table the task panel's thread uses. The
 * newest one shows here and the rest stay as history — "what happened with
 * this" is a question you ask weeks later, and an overwriting field cannot
 * answer it.
 */
import { useEffect, useRef, useState } from 'react'
import type { LastNote } from '../lib/types'

interface Props {
  note?: LastNote
  readOnly: boolean
  /** Appends a note. The page owns the save and the item list. */
  onAdd: (body: string) => Promise<void>
  /** Opens the task, where the full history lives. */
  onOpenHistory?: () => void
  /** `card` is the tighter kanban rendering. */
  variant?: 'row' | 'card'
}

/** "2h ago" beats a timestamp: the age is the point, not the clock time. */
function ago(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
}

export default function ReviewNote({
  note, readOnly, onAdd, onOpenHistory, variant = 'row',
}: Props) {
  const [writing, setWriting] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (writing) box.current?.focus() }, [writing])

  async function submit() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    await onAdd(body)
    setBusy(false)
    setDraft('')
    setWriting(false)
  }

  if (writing) {
    return (
      <div className={`note note-${variant} writing`}>
        <textarea
          ref={box}
          rows={variant === 'card' ? 3 : 2}
          value={draft}
          readOnly={busy}
          placeholder="What is happening with this? e.g. emailed them, waiting to hear back"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter saves; Shift+Enter is a new line. A note is usually one
            // sentence, so making the common case need a mouse is wrong.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() }
            if (e.key === 'Escape') { setDraft(''); setWriting(false) }
          }}
          aria-label="Review note"
        />
        <div className="note-actions">
          <button className="btn primary sm" onClick={() => void submit()} disabled={!draft.trim() || busy}>
            {busy ? 'Saving…' : 'Save note'}
          </button>
          <button className="btn sm" onClick={() => { setDraft(''); setWriting(false) }}>Cancel</button>
          <span className="note-hint">Enter to save · Shift+Enter for a new line</span>
        </div>
      </div>
    )
  }

  if (!note) {
    if (readOnly) return null
    return (
      <button className={`note note-${variant} empty`} onClick={() => setWriting(true)}>
        + Add a note
      </button>
    )
  }

  return (
    <div className={`note note-${variant}${variant === "row" ? " note-row" : ""}`}>
      <p className="note-body">{note.body}</p>
      <div className="note-meta">
        <span className="note-who">{note.author ?? 'Someone'}</span>
        <span className="note-when">{ago(note.at)}</span>
        {!readOnly && (
          <button className="note-add" onClick={() => setWriting(true)}>Update</button>
        )}
        {onOpenHistory && (
          <button className="note-history" onClick={onOpenHistory}>History</button>
        )}
      </div>
    </div>
  )
}
