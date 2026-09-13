/**
 * One board: its groups, rows and cells, with the table, kanban and timeline
 * views over the same data.
 *
 * Cell edits are applied locally first and then sent, so typing never waits
 * for the network. A failed write puts the old value back and says so.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import type { BoardDetail, CellValue, Item } from '../lib/types'
import { useAuth } from '../state/auth'
import { useClients } from '../state/clients'
import { useTimer } from '../state/timer'
import CellEditor from '../components/CellEditor'
import ItemPanel from '../components/ItemPanel'
import KanbanView from '../components/KanbanView'
import TimelineView from '../components/TimelineView'
import AutomationsDialog from '../components/AutomationsDialog'
import BoardAccessDialog from '../components/BoardAccessDialog'
import DensityToggle from '../components/DensityToggle'
import QuickAdd from '../components/QuickAdd'
import SlidingHighlight from '../components/SlidingHighlight'
import { colourClass } from '../components/Pill'

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>()
  const { user } = useAuth()
  const { clients, selectedId: selectedClientId, selected: selectedClient } = useClients()
  const { running, start, stop } = useTimer()
  const [view, setView] = useState<'table' | 'kanban' | 'timeline'>('table')
  const [board, setBoard] = useState<BoardDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  // Who may open this board is an access decision, not a working one.
  const canManage = user?.role === 'ADMIN'

  useEffect(() => {
    if (!boardId) return
    let cancelled = false
    setBoard(null)
    setError(null)
    api
      .get<BoardDetail>(`/api/boards/${boardId}`)
      .then((data) => !cancelled && setBoard(data))
      .catch((e) =>
        !cancelled && setError(e instanceof ApiError ? e.message : 'Could not load this board.'),
      )
    return () => {
      cancelled = true
    }
  }, [boardId])

  // Two keys that remove a reach for the mouse on the screen people spend
  // the most time on. Both are ignored while you are typing somewhere, so
  // "/" in a task title stays a slash.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (typing) return

      if (event.key === '/') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.search')?.focus()
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.qa-input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const flash = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 4000)
  }, [])

  /** Optimistic: paint the change, then persist. Put it back if the save fails. */
  const setCell = useCallback(
    async (itemId: string, columnId: string, value: CellValue) => {
      let previous: CellValue = {}
      setBoard((current) => {
        if (!current) return current
        return {
          ...current,
          items: current.items.map((item) => {
            if (item.id !== itemId) return item
            previous = item.cells[columnId] ?? {}
            return { ...item, cells: { ...item.cells, [columnId]: value } }
          }),
        }
      })
      try {
        const saved = await api.put<CellValue & {
          automations?: { name: string; did: string }[]
        }>(`/api/items/${itemId}/cells/${columnId}`, { value })

        // A rule may have moved the item, set another cell or assigned it.
        // Without this the change happens on the server and the screen quietly
        // disagrees with it until someone reloads - which reads as a bug in
        // the rule rather than a gap in the interface.
        if (saved?.automations?.length) {
          flash(
            saved.automations.length === 1
              ? `"${saved.automations[0].name}" ${saved.automations[0].did}.`
              : `${saved.automations.length} rules ran.`,
          )
          const forBoard = boardId
          const fresh = await api.get<BoardDetail>(`/api/boards/${forBoard}`).catch(() => null)
          // Only if it is still the board on screen. Click through to another
          // board while this is in flight and, without the check, the old
          // board's items land under the new board's URL.
          if (fresh) setBoard((current) => (current?.id === forBoard ? fresh : current))
        }
      } catch (e) {
        setBoard((current) => {
          if (!current) return current
          return {
            ...current,
            items: current.items.map((item) =>
              item.id === itemId ? { ...item, cells: { ...item.cells, [columnId]: previous } } : item,
            ),
          }
        })
        flash(e instanceof ApiError ? e.message : 'That change was not saved.')
      }
    },
    [flash, boardId],
  )

  const addItem = useCallback(
    async (groupId: string, title = 'New item') => {
      if (!boardId) return
      try {
        const created = await api.post<Item>(`/api/boards/${boardId}/items`, {
          groupId,
          title,
        })
        setBoard((current) =>
          current
            ? // Keep whatever the server put on it: column defaults, and
              // anything an "when an item is created" rule set. Blanking the
              // cells here hid those until the next reload.
              { ...current, items: [...current.items, { ...created, cells: created.cells ?? {} }] }
            : current,
        )
      } catch (e) {
        flash(e instanceof ApiError ? e.message : 'Could not add the item.')
      }
    },
    [boardId, flash],
  )

  const renameItem = useCallback(
    async (itemId: string, title: string) => {
      let previous = ''
      setBoard((current) => {
        if (!current) return current
        return {
          ...current,
          items: current.items.map((i) => {
            if (i.id !== itemId) return i
            previous = i.title
            return { ...i, title }
          }),
        }
      })
      try {
        await api.patch(`/api/items/${itemId}`, { title })
      } catch (e) {
        // Put the old title back. Without this a rejected rename stayed on
        // screen indefinitely, four seconds of toast aside.
        setBoard((current) =>
          current
            ? {
                ...current,
                items: current.items.map((i) => (i.id === itemId ? { ...i, title: previous } : i)),
              }
            : current,
        )
        flash(e instanceof ApiError ? e.message : 'Could not rename that item.')
      }
    },
    [flash],
  )

  const deleteItem = useCallback(
    async (itemId: string) => {
      // Only the row that went, and its place in the list. Restoring a whole
      // board snapshot would undo any other edit that succeeded while the
      // delete was in flight.
      let removed: Item | undefined
      let at = 0
      setBoard((current) => {
        if (!current) return current
        at = current.items.findIndex((i) => i.id === itemId)
        removed = current.items[at]
        return { ...current, items: current.items.filter((i) => i.id !== itemId) }
      })
      try {
        await api.del(`/api/items/${itemId}`)
      } catch (e) {
        setBoard((current) => {
          if (!current || !removed) return current
          const items = [...current.items]
          items.splice(Math.max(0, at), 0, removed)
          return { ...current, items }
        })
        flash(e instanceof ApiError ? e.message : 'Could not delete that item.')
      }
    },
    [flash],
  )

  const setItemClient = useCallback(
    async (itemId: string, clientId: string | null) => {
      let previous: string | undefined
      setBoard((current) => {
        if (!current) return current
        return {
          ...current,
          items: current.items.map((i) => {
            if (i.id !== itemId) return i
            previous = i.clientId
            return { ...i, clientId: clientId ?? undefined }
          }),
        }
      })
      try {
        await api.patch(`/api/items/${itemId}`, { clientId })
      } catch (e) {
        setBoard((current) =>
          current
            ? {
                ...current,
                items: current.items.map((i) =>
                  i.id === itemId ? { ...i, clientId: previous } : i,
                ),
              }
            : current,
        )
        flash(e instanceof ApiError ? e.message : 'Could not move that item to another client.')
      }
    },
    [flash],
  )

  const toggleTimer = useCallback(
    async (item: Item) => {
      if (running?.itemId === item.id) {
        await stop()
      } else {
        if (running) await stop()
        await start({ itemId: item.id, clientId: item.clientId })
      }
    },
    [running, start, stop],
  )

  const peopleColumnId = useMemo(
    () => board?.columns.find((c) => c.type === 'PEOPLE')?.id,
    [board],
  )

  const visibleItems = useMemo(() => {
    if (!board) return []
    const needle = search.trim().toLowerCase()
    return board.items.filter((item) => {
      if (item.parentId) return false
      // A board-level client wins; otherwise filter item by item. Items with
      // no client are internal and stay visible whatever is selected.
      if (selectedClientId && item.clientId && item.clientId !== selectedClientId) return false
      if (needle && !item.title.toLowerCase().includes(needle)) return false
      if (mineOnly && peopleColumnId && user) {
        const ids = item.cells[peopleColumnId]?.userIds ?? []
        if (!ids.includes(user.id)) return false
      }
      return true
    })
  }, [board, search, mineOnly, peopleColumnId, user, selectedClientId])

  if (error) return <div className="empty-state"><h1>Not available</h1><p>{error}</p></div>
  if (!board) return <div className="boot">Loading…</div>

  const readOnly = !board.canEdit

  return (
    <div className="board">
      <header className="board-head">
        <div className="board-title-row">
          <div className="board-title-left">
            <h1 title={board.description ?? undefined}>{board.name}</h1>
            <div className="board-flags">
              {board.sensitivity !== 'INTERNAL' && (
                <span className={`sens ${board.sensitivity === 'RESTRICTED' ? 'high' : 'mid'}`}>
                  {board.sensitivity === 'RESTRICTED' ? 'Restricted' : 'Confidential'}
                </span>
              )}
              {readOnly && <span className="sens view">View only</span>}
              {selectedClient && (
                <span className={`sens client ${colourClass(selectedClient.colour)}`}>
                  {selectedClient.name}
                </span>
              )}
            </div>
          </div>

          <SlidingHighlight
            activeId={view}
            className="board-views"
            aria-label="How to view this board"
          >
            {(['table', 'kanban', 'timeline'] as const).map((name) => (
              <button
                key={name}
                data-slide-id={name}
                role="tab"
                aria-selected={view === name}
                className={view === name ? 'on' : ''}
                onClick={() => setView(name)}
              >
                {name === 'table' ? 'Table' : name === 'kanban' ? 'Kanban' : 'Timeline'}
              </button>
            ))}
          </SlidingHighlight>
        </div>

        <div className="board-tools">
          <input
            className="search"
            type="search"
            placeholder="Search items"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="toggle">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            <span>Only mine</span>
          </label>
          <button className="btn ghost small" onClick={() => setShowRules(true)}>
            Rules
          </button>
          {canManage && (
            <button className="btn ghost small" onClick={() => setShowAccess(true)}>
              Access
            </button>
          )}
          <span className="count">{visibleItems.length} items</span>
          <span className="keyhint" aria-hidden="true">
            <kbd>/</kbd> search <kbd>N</kbd> new <kbd>Ctrl</kbd><kbd>K</kbd> go
          </span>
          <DensityToggle />
        </div>
      </header>

      {notice && <div className="notice" role="status">{notice}</div>}

      {view === 'timeline' ? (
        <TimelineView
          board={board}
          items={visibleItems}
          readOnly={readOnly}
          onSetCell={setCell}
          onOpenItem={setOpenItemId}
        />
      ) : view === 'kanban' ? (
        <KanbanView
          board={board}
          items={visibleItems}
          clients={clients}
          readOnly={readOnly}
          onSetCell={setCell}
          onSetClient={setItemClient}
          onOpenItem={setOpenItemId}
        />
      ) : (
      <div className="board-scroll">
        {/* A board with no groups rendered as an empty page with no
            explanation — which is exactly what a brand new project looks
            like, so the first thing anyone saw after creating one was a
            blank screen that read as broken. */}
        {board.groups.length === 0 && (
          <div className="board-empty">
            <h2>No sections yet</h2>
            <p>
              Work on a board lives in sections — To-do, In progress, Done, or whatever
              suits this project. Add one to start.
            </p>
          </div>
        )}

        {board.groups.map((group) => {
          const rows = visibleItems.filter((i) => i.groupId === group.id)
          return (
            <section className="group" key={group.id}>
              <div className={`group-head ${colourClass(group.colour)}`}>
                <h2>{group.title}</h2>
                <span className="group-count">{rows.length}</span>
              </div>

              <div className="grid-scroll">
                <table className="grid">
                  <thead>
                    <tr>
                      <th className="col-item">Item</th>
                      {board.columns.map((column) => (
                        <th key={column.id} style={{ width: column.width, minWidth: column.width }}>
                          {column.title}
                        </th>
                      ))}
                      <th className="col-actions" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr key={item.id} className={`row ${colourClass(group.colour)}`}>
                        <td className="col-item">
                          <div className="item-cell">
                            <ItemTitle
                              title={item.title}
                              readOnly={readOnly}
                              onCommit={(title) => renameItem(item.id, title)}
                            />
                            <button className="open-item" onClick={() => setOpenItemId(item.id)}>
                              Open
                            </button>
                          </div>
                        </td>
                        {board.columns.map((column) => (
                          <td
                            key={column.id}
                            data-label={column.title}
                            style={{ width: column.width, minWidth: column.width }}
                          >
                            <CellEditor
                              column={column}
                              value={item.cells[column.id] ?? {}}
                              members={board.members}
                              readOnly={readOnly}
                              onChange={(value) => setCell(item.id, column.id, value)}
                            />
                          </td>
                        ))}
                        <td className="col-actions">
                          {!readOnly && (
                            <div className="row-actions">
                              <button
                                className={`row-timer ${running?.itemId === item.id ? 'on' : ''}`}
                                title={
                                  running?.itemId === item.id
                                    ? 'Stop the timer on this item'
                                    : 'Start a timer on this item'
                                }
                                onClick={() => void toggleTimer(item)}
                              >
                                {running?.itemId === item.id ? '■' : '▶'}
                              </button>
                              <button
                                className="row-delete"
                                title="Delete item"
                                onClick={() => {
                                  if (window.confirm(`Delete "${item.title}"?`)) deleteItem(item.id)
                                }}
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr className="row empty">
                        <td colSpan={board.columns.length + 2}>Empty</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {!readOnly && (
                <QuickAdd
                  label={`Add to ${group.title}`}
                  onAdd={(title) => addItem(group.id, title)}
                />
              )}
            </section>
          )
        })}
      </div>
      )}

      {openItemId && (
        <ItemPanel
          itemId={openItemId}
          board={board}
          readOnly={readOnly}
          onClose={() => setOpenItemId(null)}
          onCellChange={setCell}
        />
      )}

      {showAccess && (
        <BoardAccessDialog
          board={board}
          onClose={() => setShowAccess(false)}
          onChanged={() => {
            void api
              .get<BoardDetail>(`/api/boards/${board.id}`)
              .then(setBoard)
              .catch(() => undefined)
          }}
        />
      )}

      {showRules && (
        <AutomationsDialog
          board={board}
          onClose={() => setShowRules(false)}
          onChanged={() => {
            // A new rule can move work the moment it next fires, so pull the
            // board again rather than showing a picture that is already stale.
            void api
              .get<BoardDetail>(`/api/boards/${board.id}`)
              .then(setBoard)
              .catch(() => undefined)
          }}
        />
      )}
    </div>
  )
}

function ItemTitle({
  title,
  readOnly,
  onCommit,
}: {
  title: string
  readOnly: boolean
  onCommit: (title: string) => void
}) {
  const [draft, setDraft] = useState(title)
  useEffect(() => setDraft(title), [title])

  return (
    <input
      className="item-title"
      value={draft}
      disabled={readOnly}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim()
        if (trimmed && trimmed !== title) onCommit(trimmed)
        else setDraft(title)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(title)
      }}
    />
  )
}
