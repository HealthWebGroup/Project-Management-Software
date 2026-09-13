import { useMemo, useState } from 'react'
import type { BoardDetail, CellValue, Client, Item } from '../lib/types'
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
}

const UNSET = '__unset__'

export default function KanbanView({
  board, items, clients, readOnly, onSetCell, onSetClient, onOpenItem,
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
                const days = daysUntil(due)
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
                      <button className="card-title" onClick={() => onOpenItem(item.id)}>
                        {item.title}
                      </button>
                      {!readOnly && (
                        <CardMenu
                          lanes={lanes}
                          current={lane.key}
                          onMove={(key) => moveTo(item.id, key, lane.key)}
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
                      <span className="card-people">
                        {owners.length === 0 ? (
                          <span className="card-unassigned">Unassigned</span>
                        ) : (
                          owners.map((o) => <Avatar key={o.id} name={o.fullName} />)
                        )}
                      </span>
                      {due && (
                        <span
                          className={`card-due ${
                            days !== null && days < 0 ? 'overdue' : days !== null && days <= 7 ? 'soon' : ''
                          }`}
                        >
                          {new Date(due + 'T00:00:00').toLocaleDateString('en-IE', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                      )}
                    </footer>
                  </article>
                )
              })}

              {lane.items.length === 0 && <p className="lane-empty">Drop a card here</p>}
            </div>
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

/** Touch devices cannot drag, so every card also carries a move menu. */
function CardMenu({
  lanes,
  current,
  onMove,
}: {
  lanes: Lane[]
  current: string
  onMove: (laneKey: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card-menu">
      <button className="card-menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Move card">
        ⋯
      </button>
      {open && (
        <>
          <div className="card-menu-scrim" onClick={() => setOpen(false)} />
          <div className="card-menu-list">
            <span className="cm-title">Move to</span>
            {lanes
              .filter((lane) => lane.key !== current)
              .map((lane) => (
                <button
                  key={lane.key}
                  onClick={() => {
                    onMove(lane.key)
                    setOpen(false)
                  }}
                >
                  {lane.title}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  )
}
