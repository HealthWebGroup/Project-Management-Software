/**
 * The board as columns of cards, grouped by status, by person, or by client.
 *
 * Lanes are derived on every render from the items and the chosen grouping,
 * not stored. Dragging a card writes the cell that the grouping is based on,
 * which is what makes the card move - the lane is a view of the data, never
 * a place the card lives.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardDetail, CellValue, Client, Item, Priority } from '../lib/types'
import PriorityPill from './PriorityPill'
import Popover from './Popover'
import { Avatar, colourClass } from './Pill'
import { daysUntil } from './CellEditor'

type GroupMode = { kind: 'status'; columnId: string } | { kind: 'person' } | { kind: 'client' }

interface Lane {
  key: string
  title: string
  colour: string
  items: Item[]
}

interface Props {
  board: BoardDetail
  items: Item[]
  clients: Client[]
  readOnly: boolean
  onSetCell: (itemId: string, columnId: string, value: CellValue) => void
  onSetClient: (itemId: string, clientId: string | null) => void
  onOpenItem: (itemId: string) => void
  /** Creates the item and hands it back, so the new card can be dropped
      into the lane it was added to rather than into "no status". */
  onAddItem: (groupId: string, title: string) => Promise<Item | null>
  onRename: (itemId: string, title: string) => void
  onSetPriority: (itemId: string, priority: Priority) => void
  onDelete: (itemId: string) => void
}

const UNSET = '__unset__'

export default function KanbanView({
  board, items, clients, readOnly, onSetCell, onSetClient, onOpenItem,
  onAddItem, onRename, onSetPriority, onDelete,
}: Props) {
  const statusColumns = useMemo(
    () => board.columns.filter((c) => c.type === 'STATUS'),
    [board.columns],
  )
  const peopleColumn = useMemo(
    () => board.columns.find((c) => c.type === 'PEOPLE'),
    [board.columns],
  )
  const dateColumn = useMemo(
    () => board.columns.find((c) => c.type === 'DATE'),
    [board.columns],
  )
  const progressColumn = useMemo(
    () => board.columns.find((c) => c.type === 'NUMBER' && c.settings.display === 'bar'),
    [board.columns],
  )

  const [mode, setMode] = useState<GroupMode>(() =>
    statusColumns.length > 0 ? { kind: 'status', columnId: statusColumns[0].id } : { kind: 'client' },
  )
  const [dragItem, setDragItem] = useState<string | null>(null)
  // Which lane the card left. Needed to move one owner out rather than
  // replacing everybody when an item has more than one.
  const [dragFrom, setDragFrom] = useState<string | null>(null)
  const [overLane, setOverLane] = useState<string | null>(null)

  // ------------------------------------------------------------ the lanes

  const lanes: Lane[] = useMemo(() => {
    if (mode.kind === 'status') {
      const column = board.columns.find((c) => c.id === mode.columnId)
      const labels = column?.settings.labels ?? []
      const built: Lane[] = labels.map((label) => ({
        key: label.id,
        title: label.label,
        colour: label.colour,
        items: items.filter((i) => i.cells[mode.columnId]?.labelId === label.id),
      }))
      const none = items.filter((i) => {
        const chosen = i.cells[mode.columnId]?.labelId
        return !chosen || !labels.some((l) => l.id === chosen)
      })
      if (none.length > 0) built.unshift({ key: UNSET, title: 'No status', colour: 'grey', items: none })
      return built
    }

    if (mode.kind === 'person') {
      if (!peopleColumn) return []
      const built: Lane[] = board.members.map((member) => ({
        key: member.id,
        title: member.fullName,
        colour: 'teal',
        items: items.filter((i) => (i.cells[peopleColumn.id]?.userIds ?? []).includes(member.id)),
      }))
      const none = items.filter((i) => (i.cells[peopleColumn.id]?.userIds ?? []).length === 0)
      // Empty lanes stay. Hiding them kept the board tidy and made the view's
      // main action impossible: with no lane for a colleague who has nothing
      // yet, there was nowhere to drop their first task.
      const lanes = built
      lanes.unshift({ key: UNSET, title: 'Unassigned', colour: 'grey', items: none })
      return lanes
    }

    const built: Lane[] = clients.map((client) => ({
      key: client.id,
      title: client.name,
      colour: client.colour,
      items: items.filter((i) => i.clientId === client.id),
    }))
    const internal = items.filter((i) => !i.clientId)
    const lanes = built
    lanes.unshift({ key: UNSET, title: 'Internal', colour: 'grey', items: internal })
    return lanes
  }, [mode, board.columns, board.members, items, clients, peopleColumn])

  // ------------------------------------------------------------- dropping

  /**
   * `fromLane` matters when an item has more than one owner: it appears in
   * every owner's lane, and dragging one copy used to replace the whole list
   * with the destination, silently removing everybody else. Moving a card out
   * of Aoife's lane should mean "not Aoife, now Ciara" — not "nobody but
   * Ciara".
   */
  function moveTo(itemId: string, laneKey: string, fromLane?: string) {
    if (readOnly) return
    if (mode.kind === 'status') {
      onSetCell(itemId, mode.columnId, laneKey === UNSET ? {} : { labelId: laneKey })
    } else if (mode.kind === 'person' && peopleColumn) {
      const item = items.find((i) => i.id === itemId)
      const current = item?.cells[peopleColumn.id]?.userIds ?? []
      if (laneKey === UNSET) {
        onSetCell(itemId, peopleColumn.id, {})
        return
      }
      const kept = fromLane && fromLane !== UNSET ? current.filter((id) => id !== fromLane) : current
      const next = kept.includes(laneKey) ? kept : [...kept, laneKey]
      onSetCell(itemId, peopleColumn.id, { userIds: next })
    } else if (mode.kind === 'client') {
      onSetClient(itemId, laneKey === UNSET ? null : laneKey)
    }
  }

  const clientOf = (item: Item) => clients.find((c) => c.id === item.clientId)

  return (
    <div className="kanban">
      <div className="kanban-tools">
        <span className="kt-label">Group by</span>
        <div className="segmented">
          {statusColumns.map((column) => (
            <button
              key={column.id}
              className={mode.kind === 'status' && mode.columnId === column.id ? 'on' : ''}
              onClick={() => setMode({ kind: 'status', columnId: column.id })}
            >
              {column.title}
            </button>
          ))}
          {peopleColumn && (
            <button
              className={mode.kind === 'person' ? 'on' : ''}
              onClick={() => setMode({ kind: 'person' })}
            >
              Person
            </button>
          )}
          <button
            className={mode.kind === 'client' ? 'on' : ''}
            onClick={() => setMode({ kind: 'client' })}
          >
            Client
          </button>
        </div>
        <span className="kt-hint">Drag a card between columns, or use ⋯ on a card</span>
      </div>

      <div className="lanes">
        {lanes.map((lane) => (
          <section
            key={lane.key}
            className={`lane ${colourClass(lane.colour)} ${overLane === lane.key ? 'over' : ''}`}
            onDragOver={(e) => {
              if (readOnly || !dragItem) return
              e.preventDefault()
              setOverLane(lane.key)
            }}
            onDragLeave={() => setOverLane((k) => (k === lane.key ? null : k))}
            onDrop={(e) => {
              e.preventDefault()
              if (dragItem) moveTo(dragItem, lane.key, dragFrom ?? undefined)
              setDragItem(null)
              setDragFrom(null)
              setOverLane(null)
            }}
          >
            <header className="lane-head">
              <span className="lane-dot" aria-hidden="true" />
              <h3>{lane.title}</h3>
              <span className="lane-count">{lane.items.length}</span>
            </header>

            <div className="lane-body">
              {lane.items.map((item) => {
                const client = clientOf(item)
                const owners = peopleColumn
                  ? board.members.filter((m) =>
                      (item.cells[peopleColumn.id]?.userIds ?? []).includes(m.id))
                  : []
                const due = dateColumn ? item.cells[dateColumn.id]?.date : undefined
                const progress = progressColumn ? item.cells[progressColumn.id]?.number : undefined

                return (
                  <article
                    key={item.id}
                    className={`card ${dragItem === item.id ? 'dragging' : ''}`}
                    draggable={!readOnly}
                    onDragStart={(event) => {
                      setDragItem(item.id)
                      setDragFrom(lane.key)
                      // Firefox cancels a drag whose dragstart sets no data,
                      // so without this line drag-and-drop never begins there.
                      // The id travels in state; this is the handshake.
                      event.dataTransfer.setData('text/plain', item.id)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                      setDragItem(null)
                      setDragFrom(null)
                      setOverLane(null)
                    }}
                  >
                    <div className="card-top">
                      <CardTitle
                        title={item.title}
                        readOnly={readOnly}
                        onOpen={() => onOpenItem(item.id)}
                        onRename={(next) => onRename(item.id, next)}
                      />
                      {!readOnly && (
                        <CardMenu
                          lanes={lanes}
                          current={lane.key}
                          onMove={(key) => moveTo(item.id, key, lane.key)}
                          onDelete={() => onDelete(item.id)}
                        />
                      )}
                    </div>

                    {client && mode.kind !== 'client' && (
                      <span className={`card-client ${colourClass(client.colour)}`}>
                        {client.name}
                      </span>
                    )}

                    {typeof progress === 'number' && (
                      <span className="card-bar" aria-label={`${progress}% complete`}>
                        <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
                      </span>
                    )}

                    <footer className="card-foot">
                      {/* Priority first in the footer: it is the thing people
                          change most often after status, and burying it in
                          the detail panel was why nobody was setting it. In
                          the footer an unset priority costs no height - on
                          its own row it left an empty band on every card. */}
                      <PriorityPill
                        value={item.priority}
                        readOnly={readOnly}
                        quiet
                        onChange={(p) => onSetPriority(item.id, p)}
                      />
                      {/* Assigning from the card, not from the panel. This is
                          the "easy to assign" part: one click on the avatars,
                          pick a name, done — and because it writes the same
                          people cell the table writes, the change is on every
                          view at once. */}
                      {peopleColumn && !readOnly ? (
                        <AssignPicker
                          members={board.members}
                          chosen={item.cells[peopleColumn.id]?.userIds ?? []}
                          onChange={(userIds) =>
                            onSetCell(item.id, peopleColumn.id, userIds.length ? { userIds } : {})
                          }
                        />
                      ) : (
                        <span className="card-people">
                          {owners.length === 0 ? (
                            <span className="card-unassigned">Unassigned</span>
                          ) : (
                            owners.map((o) => <Avatar key={o.id} name={o.fullName} />)
                          )}
                        </span>
                      )}
                      {/* The date, and settable from here. It used to appear
                          only when a date already existed, so a board where
                          nobody had set one showed no dates and offered no
                          way to add one - the single most useful thing on a
                          kanban card was invisible and unreachable. */}
                      {dateColumn && (
                        <DueDate
                          value={due}
                          readOnly={readOnly}
                          onChange={(date) =>
                            onSetCell(item.id, dateColumn.id, date ? { date } : {})
                          }
                        />
                      )}
                    </footer>
                  </article>
                )
              })}

              {lane.items.length === 0 && <p className="lane-empty">Nothing here yet</p>}
            </div>

            {/* Adding happens in the lane, so the new task already has the
                status, the owner or the client that lane stands for. */}
            {!readOnly && board.groups.length > 0 && (
              <AddCard
                onAdd={async (title) => {
                  const created = await onAddItem(board.groups[0].id, title)
                  if (created && lane.key !== UNSET) moveTo(created.id, lane.key)
                }}
              />
            )}
          </section>
        ))}

        {lanes.length === 0 && (
          <p className="lane-empty standalone">
            {mode.kind === 'client'
              ? 'Nothing to show. No clients have been added yet.'
              : `Nothing to show. This board has no ${
                  mode.kind === 'person' ? 'people' : 'status'
                } column yet.`}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The card's title: a button until you want to change it, an input after.
 *
 * Clicking opens the item, which is what a title should do. Renaming is on
 * the pencil and on double-click, so the common action and the occasional
 * one do not fight over the same click.
 */
function CardTitle({
  title, readOnly, onOpen, onRename,
}: {
  title: string
  readOnly: boolean
  onOpen: () => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const input = useRef<HTMLInputElement>(null)

  // If the title changes underneath us - a rule renamed it, or somebody
  // else did - take the new one, but never while it is being typed into.
  useEffect(() => { if (!editing) setDraft(title) }, [title, editing])
  useEffect(() => { if (editing) input.current?.select() }, [editing])

  function commit() {
    const next = draft.trim()
    setEditing(false)
    if (!next) { setDraft(title); return }   // an empty title is not a rename
    if (next !== title) onRename(next)
  }

  if (editing) {
    return (
      <input
        ref={input}
        className="card-title-edit"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { setDraft(title); setEditing(false) }
        }}
        aria-label="Task name"
      />
    )
  }

  return (
    <>
      <button className="card-title" onClick={onOpen} onDoubleClick={() => !readOnly && setEditing(true)}>
        {title}
      </button>
      {!readOnly && (
        <button className="card-edit" onClick={() => setEditing(true)} aria-label={`Rename ${title}`}>
          ✎
        </button>
      )}
    </>
  )
}

/** Put people on a task from the card. Toggles, so it also takes them off. */
function AssignPicker({
  members, chosen, onChange,
}: {
  members: BoardDetail['members']
  chosen: string[]
  onChange: (userIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const on = members.filter((m) => chosen.includes(m.id))

  return (
    <div className="assign-wrap">
      <button
        ref={button}
        type="button"
        className={open ? 'assign-btn open' : 'assign-btn'}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Assign people"
      >
        {on.length === 0
          ? <span className="card-unassigned">+ Assign</span>
          : on.map((o) => <Avatar key={o.id} name={o.fullName} />)}
      </button>

      {open && (
        <Popover anchor={button.current} onClose={() => setOpen(false)} className="assign-list">
          <span className="cm-title">Who is on this</span>
          {members.map((m) => {
            const isOn = chosen.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                className={isOn ? 'on' : ''}
                onClick={() =>
                  onChange(isOn ? chosen.filter((id) => id !== m.id) : [...chosen, m.id])
                }
              >
                <Avatar name={m.fullName} />
                {m.fullName}
                {isOn && <span className="assign-tick">✓</span>}
              </button>
            )
          })}
          {members.length === 0 && <span className="cm-empty">Nobody on this board yet</span>}
        </Popover>
      )}
    </div>
  )
}

/**
 * The due date, set from the card.
 *
 * A kanban card with no date on it cannot tell you what is late, which is
 * most of what a board is for. This reads and writes the board's DATE
 * column - the same cell the table edits - so a date set here is on the
 * table and the timeline immediately.
 */
function DueDate({
  value, readOnly, onChange,
}: {
  value?: string
  readOnly: boolean
  onChange: (date: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const days = daysUntil(value)

  const shown = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
    : null

  // "3 days late" and "due tomorrow" are what people actually need; the date
  // itself is the detail. Both are shown, the urgency first.
  const when =
    days === null ? null
    : days < 0 ? `${Math.abs(days)}d late`
    : days === 0 ? 'today'
    : days === 1 ? 'tomorrow'
    : days <= 7 ? `in ${days}d`
    : null

  const tone = days === null ? '' : days < 0 ? ' overdue' : days <= 7 ? ' soon' : ''

  if (readOnly) {
    return value ? <span className={`card-due${tone}`}>{when ?? shown}</span> : null
  }

  return (
    <div className="due-wrap">
      <button
        ref={button}
        type="button"
        className={value ? `card-due${tone}${open ? ' open' : ''}` : `card-due empty${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={value ? `Due ${shown}` : 'Set a due date'}
      >
        {value ? (when ? `${shown} · ${when}` : shown) : '+ Date'}
      </button>

      {open && (
        <Popover anchor={button.current} onClose={() => setOpen(false)} className="due-panel">
          <label className="due-field">
            <span>Due date</span>
            <input
              type="date"
              value={value ?? ''}
              autoFocus
              onChange={(e) => { onChange(e.target.value || undefined); setOpen(false) }}
            />
          </label>
          {value && (
            <button type="button" className="due-clear" onClick={() => { onChange(undefined); setOpen(false) }}>
              Clear the date
            </button>
          )}
        </Popover>
      )}
    </div>
  )
}

/**
 * Add a task without leaving the lane.
 *
 * The field stays open and keeps focus after each Enter, so adding six
 * tasks off a meeting note is six lines of typing rather than six rounds of
 * click-type-click. It is readOnly while saving rather than disabled -
 * disabling an input blurs it, and focus does not reliably come back.
 */
function AddCard({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) input.current?.focus() }, [open])

  async function submit() {
    const next = title.trim()
    if (!next || busy) return
    setBusy(true)
    await onAdd(next)
    setBusy(false)
    setTitle('')
    requestAnimationFrame(() => input.current?.focus())
  }

  if (!open) {
    return (
      <button className="lane-add" onClick={() => setOpen(true)}>
        + Add task
      </button>
    )
  }

  return (
    <div className="lane-compose">
      <input
        ref={input}
        value={title}
        readOnly={busy}
        placeholder="What needs doing?"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void submit() }
          if (e.key === 'Escape') { setTitle(''); setOpen(false) }
        }}
        aria-label="New task"
      />
      <div className="lane-compose-foot">
        <button className="btn primary sm" onClick={() => void submit()} disabled={!title.trim() || busy}>
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button className="btn sm" onClick={() => { setTitle(''); setOpen(false) }}>Cancel</button>
      </div>
    </div>
  )
}

/** Touch devices cannot drag, so every card also carries a move menu. */
function CardMenu({
  lanes,
  current,
  onMove,
  onDelete,
}: {
  lanes: Lane[]
  current: string
  onMove: (laneKey: string) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  return (
    <div className="card-menu">
      <button
        ref={button}
        type="button"
        className={open ? 'card-menu-btn open' : 'card-menu-btn'}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Move or delete this card"
      >
        ⋯
      </button>

      {open && (
        <Popover anchor={button.current} onClose={() => setOpen(false)} className="card-menu-list">
          <span className="cm-title">Move to</span>
          {lanes
            .filter((lane) => lane.key !== current)
            .map((lane) => (
              <button
                key={lane.key}
                type="button"
                onClick={() => { onMove(lane.key); setOpen(false) }}
              >
                {lane.title}
              </button>
            ))}
          <span className="cm-sep" />
          <button
            type="button"
            className="cm-danger"
            onClick={() => {
              // No confirm dialog: a browser confirm() blocks everything,
              // and the board already keeps an activity log of deletions.
              onDelete()
              setOpen(false)
            }}
          >
            Delete task
          </button>
        </Popover>
      )}
    </div>
  )
}
