import { useEffect, useRef, useState } from 'react'
import type { CellValue, Column, User } from '../lib/types'
import Pill, { Avatar, colourClass } from './Pill'

interface Props {
  column: Column
  value: CellValue
  members: User[]
  readOnly: boolean
  onChange: (value: CellValue) => void
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function shortDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
}

/** Days until a date. Negative means it has passed. */
export function daysUntil(iso?: string): number | null {
  if (!iso) return null
  const target = new Date(iso + 'T00:00:00').getTime()
  if (Number.isNaN(target)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today.getTime()) / 86400000)
}

export default function CellEditor({ column, value, members, readOnly, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
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

  switch (column.type) {
    // ------------------------------------------------------------- status
    case 'STATUS': {
      const labels = column.settings.labels ?? []
      const current = labels.find((l) => l.id === value.labelId)
      return (
        <div className="cell-wrap" ref={wrapRef}>
          <button
            className={`status-cell ${current ? colourClass(current.colour) : 'unset'}`}
            disabled={readOnly}
            onClick={() => setOpen((o) => !o)}
          >
            {current ? current.label : '—'}
          </button>
          {open && (
            <div className="popover">
              {labels.map((label) => (
                <button
                  key={label.id}
                  className={`popover-row ${colourClass(label.colour)}`}
                  onClick={() => {
                    onChange({ labelId: label.id })
                    setOpen(false)
                  }}
                >
                  {label.label}
                </button>
              ))}
              <button className="popover-row clear" onClick={() => { onChange({}); setOpen(false) }}>
                Clear
              </button>
            </div>
          )}
        </div>
      )
    }

    // ------------------------------------------------------------- people
    case 'PEOPLE': {
      const ids = value.userIds ?? []
      const chosen = members.filter((m) => ids.includes(m.id))
      return (
        <div className="cell-wrap" ref={wrapRef}>
          <button className="people-cell" disabled={readOnly} onClick={() => setOpen((o) => !o)}>
            {chosen.length === 0 ? (
              <span className="muted">—</span>
            ) : (
              chosen.map((m) => <Avatar key={m.id} name={m.fullName} />)
            )}
          </button>
          {open && (
            <div className="popover wide">
              {members.map((m) => {
                const selected = ids.includes(m.id)
                return (
                  <button
                    key={m.id}
                    className={`popover-row person ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      const nextIds = selected ? ids.filter((i) => i !== m.id) : [...ids, m.id]
                      onChange(nextIds.length ? { userIds: nextIds } : {})
                    }}
                  >
                    <Avatar name={m.fullName} />
                    <span className="person-name">{m.fullName}</span>
                    {selected && <span className="tick">✓</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    // --------------------------------------------------------------- date
    case 'DATE': {
      const days = daysUntil(value.date)
      const tone =
        days === null ? '' : days < 0 ? 'overdue' : days <= 30 ? 'soon' : ''
      return (
        <label className={`date-cell ${tone}`}>
          <input
            type="date"
            value={value.date ?? ''}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.value ? { date: e.target.value } : {})}
          />
          <span className="date-shown">{value.date ? formatDate(value.date) : '—'}</span>
        </label>
      )
    }

    // ----------------------------------------------------------- timeline
    case 'TIMELINE': {
      return (
        <div className="cell-wrap" ref={wrapRef}>
          <button className="timeline-cell" disabled={readOnly} onClick={() => setOpen((o) => !o)}>
            {value.start || value.end ? (
              <span>
                {shortDate(value.start)} – {shortDate(value.end)}
              </span>
            ) : (
              <span className="muted">—</span>
            )}
          </button>
          {open && (
            <div className="popover pad">
              <label className="mini-field">
                <span>Start</span>
                <input
                  type="date"
                  value={value.start ?? ''}
                  onChange={(e) => onChange({ ...value, start: e.target.value || undefined })}
                />
              </label>
              <label className="mini-field">
                <span>End</span>
                <input
                  type="date"
                  value={value.end ?? ''}
                  // The server refuses this pair anyway; catching it here
                  // means a clear nudge instead of a rejected save, and stops
                  // the timeline drawing a bar with a negative width.
                  min={value.start ?? undefined}
                  onChange={(e) => {
                    const end = e.target.value || undefined
                    if (end && value.start && end < value.start) return
                    onChange({ ...value, end })
                  }}
                />
              </label>
              <button className="btn ghost small" onClick={() => { onChange({}); setOpen(false) }}>
                Clear
              </button>
            </div>
          )}
        </div>
      )
    }

    // ------------------------------------------------------------- number
    case 'NUMBER': {
      const unit = column.settings.unit ?? ''
      const asBar = column.settings.display === 'bar'
      const n = typeof value.number === 'number' ? value.number : null
      return (
        <div className="number-cell">
          {asBar && (
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, n ?? 0))}%` }} />
            </span>
          )}
          {/* Committed on blur rather than on every keystroke. Typing "100"
              used to send three saves - 1, 10, 100 - which is three writes
              and, if they land out of order, a stored 10. */}
          <NumberCell
            value={n}
            readOnly={readOnly}
            onCommit={(next) => onChange(next === null ? {} : { number: next })}
          />
          {unit && <span className="unit">{unit}</span>}
        </div>
      )
    }

    // ----------------------------------------------------------- dropdown
    case 'DROPDOWN': {
      const options = column.settings.options ?? []
      const ids = value.optionIds ?? []
      const chosen = options.filter((o) => ids.includes(o.id))
      return (
        <div className="cell-wrap" ref={wrapRef}>
          <button className="dropdown-cell" disabled={readOnly} onClick={() => setOpen((o) => !o)}>
            {chosen.length === 0 ? (
              <span className="muted">—</span>
            ) : (
              chosen.map((o) => (
                <Pill key={o.id} colour={o.colour}>
                  {o.label}
                </Pill>
              ))
            )}
          </button>
          {open && (
            <div className="popover wide">
              {options.map((option) => {
                const selected = ids.includes(option.id)
                return (
                  <button
                    key={option.id}
                    className={`popover-row ${colourClass(option.colour)} ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      const nextIds = selected ? ids.filter((i) => i !== option.id) : [...ids, option.id]
                      onChange(nextIds.length ? { optionIds: nextIds } : {})
                    }}
                  >
                    {option.label}
                    {selected && <span className="tick">✓</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    // ----------------------------------------------------------- checkbox
    case 'CHECKBOX':
      return (
        <label className="checkbox-cell">
          <input
            type="checkbox"
            checked={value.checked === true}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.checked ? { checked: true } : {})}
          />
        </label>
      )

    // --------------------------------------------------------------- link
    case 'LINK':
      return (
        <div className="link-cell">
          {/* Shown whether or not you may edit - read-only is precisely the
              case that needs a way to follow the link, since a disabled input
              cannot be focused, selected or copied from. */}
          {safeUrl(value.url) ? (
            <a
              href={safeUrl(value.url)}
              target="_blank"
              rel="noreferrer noopener"
              className="link-open"
              title={value.url}
            >
              ↗
            </a>
          ) : null}
          {readOnly ? (
            <span className="link-text" title={value.url}>{value.url || '—'}</span>
          ) : (
            <input
              type="url"
              placeholder="—"
              value={value.url ?? ''}
              onChange={(e) => onChange(e.target.value ? { url: e.target.value } : {})}
            />
          )}
        </div>
      )

    // ------------------------------------------------------- text default
    default:
      return (
        <TextCell
          value={value.text ?? ''}
          readOnly={readOnly}
          multiline={column.type === 'LONG_TEXT'}
          onCommit={(text) => onChange(text ? { text } : {})}
        />
      )
  }
}

function TextCell({
  value,
  readOnly,
  multiline,
  onCommit,
}: {
  value: string
  readOnly: boolean
  multiline: boolean
  onCommit: (text: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)

  // Only take a new value from outside when this field is not being typed in.
  // A board refetch - the one that runs after a rule fires - would otherwise
  // replace half-typed text mid-sentence.
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])

  return (
    <input
      className={`text-cell ${multiline ? 'long' : ''}`}
      value={draft}
      onFocus={() => { editing.current = true }}
      placeholder="—"
      disabled={readOnly}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        editing.current = false
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(value)
          editing.current = false
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** The same draft-then-commit shape as TextCell, for numbers. */
function NumberCell({
  value,
  readOnly,
  onCommit,
}: {
  value: number | null
  readOnly: boolean
  onCommit: (value: number | null) => void
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setDraft(value === null ? '' : String(value))
  }, [value])

  function commit() {
    editing.current = false
    const trimmed = draft.trim()
    if (trimmed === '') return value === null ? undefined : onCommit(null)
    const next = Number(trimmed)
    if (!Number.isFinite(next)) return setDraft(value === null ? '' : String(value))
    if (next !== value) onCommit(next)
  }

  return (
    <input
      type="number"
      className="number-input"
      value={draft}
      disabled={readOnly}
      onFocus={() => { editing.current = true }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(value === null ? '' : String(value))
          editing.current = false
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/**
 * A link is only ever rendered if it is http or https.
 *
 * The server refuses anything else on the way in, but a cell written before
 * that check existed would still be here — and `javascript:` in an href runs
 * on our own origin with the session of whoever clicks it.
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
