/**
 * The priority control, used by both the table and the kanban.
 *
 * One component rather than one per view, because the alternative is two
 * pickers that drift: the board gets a new level, one of them learns about
 * it, and the same task then shows a different priority depending on which
 * tab you are looking at.
 *
 * The menu goes through Popover, which renders it on <body>. Inside a
 * kanban lane it was being clipped away to nothing — see the note in
 * Popover.tsx.
 *
 * It writes nothing itself. The page owns the item list and does the
 * saving, which is what keeps table, kanban and timeline showing the same
 * value at the same moment.
 */
import { useRef, useState } from 'react'
import type { Priority } from '../lib/types'
import { PRIORITIES, PRIORITY_LABEL } from '../lib/types'
import Popover from './Popover'

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
  const button = useRef<HTMLButtonElement>(null)

  if (readOnly) {
    if (value === 'NONE') return quiet ? null : <span className="prio prio-none">—</span>
    return <span className={`prio prio-${value.toLowerCase()}`}>{PRIORITY_LABEL[value]}</span>
  }

  const unset = value === 'NONE'
  const label = unset ? (quiet ? '+ Priority' : 'Set') : PRIORITY_LABEL[value]

  return (
    <div className="prio-wrap">
      <button
        ref={button}
        type="button"
        className={`prio prio-${value.toLowerCase()}${unset && quiet ? ' empty' : ''}${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Priority: ${PRIORITY_LABEL[value]}`}
      >
        {label}
      </button>

      {open && (
        <Popover anchor={button.current} onClose={() => setOpen(false)} className="prio-list">
          <div role="listbox" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={p === value}
                className={`prio-option prio-${p.toLowerCase()}${p === value ? ' on' : ''}`}
                onClick={() => { onChange(p); setOpen(false) }}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}
