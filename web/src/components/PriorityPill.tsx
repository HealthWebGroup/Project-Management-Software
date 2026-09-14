/**
 * The priority control, used by both the table and the kanban.
 *
 * One component rather than one per view, because the alternative is two
 * pickers that drift: the board gets a new level, one of them learns about
 * it, and the same task then shows a different priority depending on which
 * tab you are looking at.
 *
 * It writes nothing itself. The page owns the item list and does the
 * saving, which is what keeps table, kanban and timeline showing the same
 * value at the same moment.
 */
import { useEffect, useRef, useState } from 'react'
import type { Priority } from '../lib/types'
import { PRIORITIES, PRIORITY_LABEL } from '../lib/types'

interface Props {
  value: Priority
  readOnly: boolean
  onChange: (priority: Priority) => void
  /** `quiet` hides an unset priority until hover — right on a card, wrong
      in a table where an empty cell under a heading is already explained. */
  quiet?: boolean
}

export default function PriorityPill({ value, readOnly, onChange, quiet = false }: Props) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Close on Escape as well as on the scrim. A menu that only closes by
  // clicking away is a trap for anyone working from the keyboard.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (readOnly) {
    if (value === 'NONE') return quiet ? null : <span className="prio prio-none">—</span>
    return <span className={`prio prio-${value.toLowerCase()}`}>{PRIORITY_LABEL[value]}</span>
  }

  const unset = value === 'NONE'
  const label = unset ? (quiet ? '+ Priority' : 'Set') : PRIORITY_LABEL[value]

  return (
    <div className="prio-wrap" ref={wrap}>
      <button
        className={`prio prio-${value.toLowerCase()}${unset && quiet ? ' empty' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Priority: ${PRIORITY_LABEL[value]}`}
      >
        {label}
      </button>
      {open && (
        <>
          <div className="card-menu-scrim" onClick={() => setOpen(false)} />
          <div className="prio-list" role="listbox">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                role="option"
                aria-selected={p === value}
                className={`prio-option prio-${p.toLowerCase()}${p === value ? ' on' : ''}`}
                onClick={() => { onChange(p); setOpen(false) }}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
