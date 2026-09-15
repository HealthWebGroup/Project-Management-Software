import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardDetail, CellValue, Item } from '../lib/types'
import { Avatar, colourClass } from './Pill'

/**
 * The timeline. Every board here already carries a Timeline column and a Due
 * date column that nothing was drawing; this turns them into bars on a
 * calendar, which is the whole reason those columns exist.
 *
 * Two shapes of work end up on the same axis:
 *   a TIMELINE cell  {start, end}  ->  a bar you can move and resize
 *   a DATE cell      {date}        ->  a milestone you can move
 *
 * Anything with neither is listed underneath rather than quietly dropped. An
 * item missing from a plan is exactly the item you needed to see.
 */

const DAY = 86400000
const ROW = 34

/**
 * How much of the width the item names take.
 *
 * On a phone 260px of a 390px screen left about sixty pixels of actual
 * calendar — every bar clipped, the plan unreadable, and the one thing the
 * timeline exists to show invisible. Names get a third of the screen there
 * and the plan gets the rest; a truncated name you can scroll back to beats
 * a plan you cannot see at all.
 */
const SIDE_WIDE = 260
const SIDE_PHONE = 116

function useSideWidth(): number {
  const query = '(max-width: 700px)'
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone ? SIDE_PHONE : SIDE_WIDE
}

type Zoom = 'day' | 'week' | 'month'
const PX_PER_DAY: Record<Zoom, number> = { day: 30, week: 11, month: 4.2 }

interface Bar {
  item: Item
  kind: 'range' | 'milestone'
  start: number
  end: number
  colour: string
  statusLabel?: string
  done: boolean
  owners: string[]
}

interface Props {
  board: BoardDetail
  items: Item[]
  readOnly: boolean
  onSetCell: (itemId: string, columnId: string, value: CellValue) => void
  onOpenItem: (itemId: string) => void
}

const DONE = new Set(['done', 'complete', 'completed', 'closed', 'valid'])

/**
 * Dates on this axis are calendar days, not moments, so all three of these
 * work in UTC and stay consistent with each other.
 *
 * The first version parsed with `new Date('2026-09-01T00:00:00')` — local
 * midnight — and formatted with `toISOString()` — the UTC date. In Ireland in
 * summer that pair is off by one: local midnight is 23:00 the previous day in
 * UTC, so every bar you dragged saved a day early, and the same code was
 * correct in winter. A seasonal bug is a bug nobody can reproduce on demand.
 */
const midnight = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Today as the person looking at the screen would name it, then read on the
 * same UTC scale as everything else. `toISOString()` alone would give the UTC
 * calendar day, which in Sydney is yesterday all morning and in New York is
 * tomorrow all evening — so the today line, "jump to today" and every overdue
 * flag would land on the wrong day.
 */
const startOfToday = () => {
  const local = new Date()
  return Date.UTC(local.getFullYear(), local.getMonth(), local.getDate())
}

export default function TimelineView({ board, items, readOnly, onSetCell, onOpenItem }: Props) {
  const SIDE = useSideWidth()
  const [zoom, setZoom] = useState<Zoom>('week')
  const scroller = useRef<HTMLDivElement | null>(null)
  const centred = useRef(false)

  const timelineColumn = useMemo(
    () => board.columns.find((c) => c.type === 'TIMELINE'),
    [board.columns],
  )
  const dateColumn = useMemo(() => board.columns.find((c) => c.type === 'DATE'), [board.columns])
  const statusColumn = useMemo(() => board.columns.find((c) => c.type === 'STATUS'), [board.columns])
  const peopleColumn = useMemo(() => board.columns.find((c) => c.type === 'PEOPLE'), [board.columns])

  const nameOf = useMemo(() => {
    const map = new Map(board.members.map((m) => [m.id, m.fullName]))
    return (id: string) => map.get(id) ?? 'Unknown'
  }, [board.members])

  /** One bar per item that has dates, plus the list of those that do not. */
  const { bars, undated } = useMemo(() => {
    const built = new Map<string, Bar>()
    const without: Item[] = []

    for (const item of items) {
      const range = timelineColumn ? item.cells[timelineColumn.id] : undefined
      const single = dateColumn ? item.cells[dateColumn.id]?.date : undefined

      const label = statusColumn
        ? statusColumn.settings.labels?.find(
            (l) => l.id === item.cells[statusColumn.id]?.labelId,
          )
        : undefined
      const owners = peopleColumn
        ? (item.cells[peopleColumn.id]?.userIds ?? []).map(nameOf)
        : []
      const common = {
        item,
        colour: label?.colour ?? 'grey',
        statusLabel: label?.label,
        done: label ? DONE.has(label.id.toLowerCase()) : false,
        owners,
      }

      if (range?.start && range?.end) {
        built.set(item.id, {
          ...common, kind: 'range',
          start: midnight(range.start),
          // A bar runs to the END of its last day, which is what makes a
          // one-day task look like a day rather than a hairline.
          end: midnight(range.end) + DAY,
        })
      } else if (single) {
        built.set(item.id, { ...common, kind: 'milestone', start: midnight(single), end: midnight(single) + DAY })
      } else {
        without.push(item)
      }
    }
    return { bars: [...built.values()], undated: without }
  }, [items, timelineColumn, dateColumn, statusColumn, peopleColumn, nameOf])

  /** The axis: everything that has to fit, plus today, plus a little air. */
  const { from, days } = useMemo(() => {
    const today = startOfToday()
    let lo = today
    let hi = today + 14 * DAY
    for (const bar of bars) {
      lo = Math.min(lo, bar.start)
      hi = Math.max(hi, bar.end)
    }
    const padded = lo - 3 * DAY
    return { from: padded, days: Math.max(14, Math.ceil((hi + 5 * DAY - padded) / DAY)) }
  }, [bars])

  const perDay = PX_PER_DAY[zoom]
  const width = days * perDay
  const xOf = (ms: number) => ((ms - from) / DAY) * perDay
  const todayX = xOf(startOfToday())

  // Open on today rather than on whatever happened months ago.
  useEffect(() => {
    if (centred.current || !scroller.current || bars.length === 0) return
    scroller.current.scrollLeft = Math.max(0, todayX - 220)
    centred.current = true
  }, [todayX, bars.length])

  const rows = useMemo(() => {
    const grouped = board.groups.map((group) => ({
      group,
      bars: bars.filter((b) => b.item.groupId === group.id),
    }))
    // An item can belong to no group. Filtering only by group id dropped
    // those from the chart while still counting them in "n scheduled", so the
    // legend and the picture disagreed with nothing to explain why.
    const known = new Set(board.groups.map((g) => g.id))
    const loose = bars.filter((b) => !b.item.groupId || !known.has(b.item.groupId))
    if (loose.length > 0) {
      grouped.push({
        group: { id: '__ungrouped__', title: 'No group', colour: 'grey', sortOrder: 999, collapsed: false },
        bars: loose,
      })
    }
    return grouped.filter((row) => row.bars.length > 0)
  }, [board.groups, bars])

  if (!timelineColumn && !dateColumn) {
    return (
      <div className="empty-state">
        <h2>Nothing to plot</h2>
        <p>
          This board has no Timeline or Due date column, so there are no dates to draw. Add one in
          the table view and the work will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <div className="tl-zoom">
          {(['day', 'week', 'month'] as Zoom[]).map((option) => (
            <button
              key={option}
              className={zoom === option ? 'on' : ''}
              onClick={() => setZoom(option)}
            >
              {option === 'day' ? 'Days' : option === 'week' ? 'Weeks' : 'Months'}
            </button>
          ))}
        </div>
        <button
          className="btn ghost small"
          onClick={() => {
            if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 220)
          }}
        >
          Jump to today
        </button>
        <span className="tl-legend">
          {bars.length} scheduled
          {undated.length > 0 && <em> · {undated.length} without dates</em>}
        </span>
      </div>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner" style={{ width: SIDE + width }}>
          <Header from={from} days={days} perDay={perDay} zoom={zoom} side={SIDE} />

          <div className="tl-body">
            <Grid from={from} days={days} perDay={perDay} zoom={zoom} side={SIDE} />
            {todayX >= 0 && todayX <= width && (
              <div className="tl-today" style={{ left: SIDE + todayX }} title="Today" />
            )}

            {rows.map(({ group, bars: groupBars }) => (
              <div className="tl-group" key={group.id}>
                <div className="tl-group-row" style={{ width: SIDE + width }}>
                  <div className={`tl-group-head ${colourClass(group.colour)}`} style={{ width: SIDE }}>
                    {group.title}
                    <span className="tl-group-count">{groupBars.length}</span>
                  </div>
                </div>
                {groupBars.map((bar) => (
                  <Row
                    key={bar.item.id}
                    bar={bar}
                    from={from}
                    perDay={perDay}
                    width={width}
                    side={SIDE}
                    readOnly={readOnly || (bar.kind === 'range' && !timelineColumn)}
                    onOpen={() => onOpenItem(bar.item.id)}
                    onMove={(start, end) => {
                      if (bar.kind === 'range' && timelineColumn) {
                        onSetCell(bar.item.id, timelineColumn.id, {
                          start: toIso(start), end: toIso(end - DAY),
                        })
                      } else if (bar.kind === 'milestone' && dateColumn) {
                        onSetCell(bar.item.id, dateColumn.id, { date: toIso(start) })
                      }
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {undated.length > 0 && (
        <section className="tl-undated">
          <h3>
            No dates yet ({undated.length})
          </h3>
          <p className="muted">
            These are not on the plan above because nothing says when they happen. Give them a
            timeline or a due date in the table view and they will appear.
          </p>
          <div className="tl-undated-list">
            {undated.map((item) => (
              <button key={item.id} className="tl-undated-item" onClick={() => onOpenItem(item.id)}>
                {item.title}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ axis

function Header({ from, days, perDay, zoom, side }: { from: number; days: number; perDay: number; zoom: Zoom; side: number }) {
  const months: { label: string; left: number; width: number }[] = []
  const ticks: { label: string; left: number; weekend: boolean; first: boolean }[] = []

  // Every reading here is UTC, matching the axis. Mixing in a local getter is
  // how a month label ends up one column out of step with its own bars.
  let cursor = 0
  while (cursor < days) {
    const at = new Date(from + cursor * DAY)
    const monthStart = cursor
    const month = at.getUTCMonth()
    while (cursor < days && new Date(from + cursor * DAY).getUTCMonth() === month) cursor++
    months.push({
      label: at.toLocaleDateString('en-IE', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      left: monthStart * perDay,
      width: (cursor - monthStart) * perDay,
    })
  }

  for (let i = 0; i < days; i++) {
    const at = new Date(from + i * DAY)
    const day = at.getUTCDay()
    const weekend = day === 0 || day === 6
    if (zoom === 'day') {
      ticks.push({ label: String(at.getUTCDate()), left: i * perDay, weekend, first: at.getUTCDate() === 1 })
    } else if (zoom === 'week' && day === 1) {
      ticks.push({ label: String(at.getUTCDate()), left: i * perDay, weekend: false, first: at.getUTCDate() <= 7 })
    }
  }

  return (
    <div className="tl-head">
      <div className="tl-head-side" style={{ width: side }}>
        <span>Item</span>
      </div>
      <div className="tl-head-axis">
        <div className="tl-months">
          {months.map((m) => (
            <span className="tl-month" key={m.left} style={{ left: m.left, width: m.width }}>
              {m.width > 46 ? m.label : ''}
            </span>
          ))}
        </div>
        <div className="tl-ticks">
          {ticks.map((t) => (
            <span
              className={`tl-tick ${t.weekend ? 'weekend' : ''} ${t.first ? 'first' : ''}`}
              key={t.left}
              style={{ left: t.left }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Weekend shading and month rules, drawn once behind every row. */
function Grid({ from, days, perDay, zoom, side }: { from: number; days: number; perDay: number; zoom: Zoom; side: number }) {
  const marks = useMemo(() => {
    const out: { left: number; width: number; kind: 'weekend' | 'month' }[] = []
    for (let i = 0; i < days; i++) {
      const at = new Date(from + i * DAY)
      const day = at.getUTCDay()
      if (zoom !== 'month' && (day === 0 || day === 6)) {
        out.push({ left: i * perDay, width: perDay, kind: 'weekend' })
      }
      if (at.getUTCDate() === 1) out.push({ left: i * perDay, width: 1, kind: 'month' })
    }
    return out
  }, [from, days, perDay, zoom])

  return (
    <div className="tl-grid" style={{ left: side }}>
      {marks.map((m, i) => (
        <span
          key={i}
          className={`tl-mark ${m.kind}`}
          style={{ left: m.left, width: m.width }}
        />
      ))}
    </div>
  )
}

// ------------------------------------------------------------------- row

function Row({
  bar, from, perDay, width, readOnly, onOpen, onMove, side,
}: {
  bar: Bar
  from: number
  perDay: number
  width: number
  readOnly: boolean
  onOpen: () => void
  onMove: (start: number, end: number) => void
  side: number
}) {
  // While dragging we paint from local state; on release we hand the new
  // dates up and let the board's optimistic update take over.
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null)
  const start = drag?.start ?? bar.start
  const end = drag?.end ?? bar.end

  const span = ((end - start) / DAY) * perDay
  // A milestone must stay legible when a day is four pixels wide, so it keeps
  // a minimum size and is centred on its own day rather than starting there.
  const barWidth = bar.kind === 'milestone' ? Math.max(15, span) : Math.max(perDay * 0.8, span)
  const left = ((start - from) / DAY) * perDay + (bar.kind === 'milestone' ? (span - barWidth) / 2 : 0)

  const today = startOfToday()
  const late = !bar.done && end <= today

  function begin(event: React.PointerEvent, mode: 'move' | 'left' | 'right') {
    if (readOnly) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const originX = event.clientX
    const origin = { start: bar.start, end: bar.end }

    function move(e: PointerEvent) {
      const shiftDays = Math.round((e.clientX - originX) / perDay)
      if (shiftDays === 0) return setDrag(null)
      if (mode === 'move') {
        setDrag({ start: origin.start + shiftDays * DAY, end: origin.end + shiftDays * DAY })
      } else if (mode === 'left') {
        // Never let an edge cross the other one: a bar that ends before it
        // starts is a bug the user has to undo, not a shortcut.
        const next = Math.min(origin.start + shiftDays * DAY, origin.end - DAY)
        setDrag({ start: next, end: origin.end })
      } else {
        const next = Math.max(origin.end + shiftDays * DAY, origin.start + DAY)
        setDrag({ start: origin.start, end: next })
      }
    }

    function detach() {
      try {
        target.releasePointerCapture(event.pointerId)
      } catch {
        /* the capture may already be gone */
      }
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', cancel)
    }

    function up() {
      detach()
      setDrag((current) => {
        if (current) onMove(current.start, current.end)
        return null
      })
    }

    /**
     * A cancelled pointer - the browser taking over for a scroll, a window
     * losing focus - used to leave the listeners attached and the bar stuck
     * at its dragged offset, with a second pair added on the next attempt.
     */
    function cancel() {
      detach()
      setDrag(null)
    }

    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', cancel)
  }

  const label = (ms: number) =>
    new Date(ms).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const when =
    bar.kind === 'milestone' ? label(start) : `${label(start)} – ${label(end - DAY)}`

  return (
    <div className="tl-row" style={{ height: ROW }}>
      <div className="tl-row-side" style={{ width: side }}>
        <button className="tl-row-title" onClick={onOpen} title={bar.item.title}>
          {bar.item.title}
        </button>
        {bar.owners.length > 0 && (
          <span className="tl-row-owners">
            {bar.owners.slice(0, 2).map((name) => (
              <Avatar key={name} name={name} title={name} />
            ))}
          </span>
        )}
      </div>

      <div className="tl-lane" style={{ width }}>
        <div
          className={`tl-bar ${colourClass(bar.colour)} ${bar.kind} ${late ? 'late' : ''} ${
            readOnly ? 'locked' : ''
          } ${drag ? 'dragging' : ''}`}
          style={{ left, width: barWidth }}
          title={`${bar.item.title}\n${when}${bar.statusLabel ? `\n${bar.statusLabel}` : ''}${
            late ? '\nPast its end date' : ''
          }`}
          /* Rescheduling has to work without a mouse. Arrows move the bar a
             day; with shift they move its end, which is the resize. */
          role="button"
          tabIndex={0}
          aria-label={`${bar.item.title}, ${when}${readOnly ? '' : '. Use the arrow keys to move it, shift and the arrow keys to change its length.'}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpen()
              return
            }
            if (readOnly || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
            e.preventDefault()
            const step = e.key === 'ArrowLeft' ? -DAY : DAY
            if (e.shiftKey) {
              if (bar.kind !== 'range') return
              const nextEnd = Math.max(bar.end + step, bar.start + DAY)
              onMove(bar.start, nextEnd)
            } else {
              onMove(bar.start + step, bar.end + step)
            }
          }}
          onPointerDown={(e) => begin(e, 'move')}
          onDoubleClick={onOpen}
        >
          {!readOnly && bar.kind === 'range' && (
            <span className="tl-handle left" onPointerDown={(e) => begin(e, 'left')} />
          )}
          <span className="tl-bar-label">{bar.item.title}</span>
          {!readOnly && bar.kind === 'range' && (
            <span className="tl-handle right" onPointerDown={(e) => begin(e, 'right')} />
          )}
        </div>
      </div>
    </div>
  )
}
