import { Hono } from 'hono'
import { accessTo, canOpen } from '../access'
import { bool, daysBetween, isoMinus, parseCell, parseSettings, today } from '../db'
import type { BoardPermission, CellValue, ColumnSettings, ColumnType, Env, Sensitivity, Vars } from '../types'

/**
 * The one screen that answers "where does everything stand" across every board
 * the caller can see.
 *
 * Written as a fixed handful of queries rather than a loop over boards: D1's
 * free plan allows 50 queries per request, and a per-board loop would blow
 * through that the moment the agency has a few clients.
 */
export const dashboard = new Hono<{ Bindings: Env; Variables: Vars }>()

const DONE_LABELS = new Set(['done', 'complete', 'completed', 'closed', 'valid', 'leaver', 'discharged'])

interface StatusSlice { labelId: string; label: string; colour: string; count: number }
interface WorkloadRow { userId: string; fullName: string; open: number; overdue: number }

dashboard.get('/dashboard', async (c) => {
  const principal = c.get('principal')
  const clientId = c.req.query('clientId') ?? null
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 30) || 30, 1), 365)
  const now = today()
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

  const [boardRows, columnRows, itemRows, cellRows, userRows, clientRows, timeRows] = await Promise.all([
    c.env.DB.prepare(
      `select b.id, b.name, b.client_id, b.sensitivity, m.permission as permission
         from board b
         join workspace w on w.id = b.workspace_id
         left join board_member m on m.board_id = b.id and m.user_id = ?
        where w.organisation_id = ?`,
    ).bind(principal.userId, principal.organisationId)
     .all<{ id: string; name: string; client_id: string | null; sensitivity: Sensitivity; permission: BoardPermission | null }>(),

    c.env.DB.prepare(
      `select col.id, col.board_id, col.type, col.settings, col.sort_order
         from board_column col
         join board b on b.id = col.board_id
         join workspace w on w.id = b.workspace_id
        where w.organisation_id = ? and col.type in ('STATUS','PEOPLE','DATE')
        order by col.sort_order`,
    ).bind(principal.organisationId)
     .all<{ id: string; board_id: string; type: ColumnType; settings: string; sort_order: number }>(),

    c.env.DB.prepare(
      `select i.id, i.board_id, i.client_id, i.title
         from item i
         join board b on b.id = i.board_id
         join workspace w on w.id = b.workspace_id
        where w.organisation_id = ? and i.archived = 0 and i.parent_id is null`,
    ).bind(principal.organisationId)
     .all<{ id: string; board_id: string; client_id: string | null; title: string }>(),

    c.env.DB.prepare(
      `select ce.item_id, ce.column_id, ce.value
         from cell ce
         join board_column col on col.id = ce.column_id
         join board b on b.id = col.board_id
         join workspace w on w.id = b.workspace_id
        where w.organisation_id = ? and col.type in ('STATUS','PEOPLE','DATE')`,
    ).bind(principal.organisationId).all<{ item_id: string; column_id: string; value: string }>(),

    c.env.DB.prepare(
      `select id, full_name from app_user where organisation_id = ? and status = 'ACTIVE'`,
    ).bind(principal.organisationId).all<{ id: string; full_name: string }>(),

    c.env.DB.prepare(
      `select id, name, colour, status from client where organisation_id = ?`,
    ).bind(principal.organisationId).all<{ id: string; name: string; colour: string; status: string }>(),

    c.env.DB.prepare(
      `select t.client_id, t.minutes, t.billable, cl.name as client_name, cl.colour as client_colour
         from time_entry t
         join app_user u on u.id = t.user_id
         left join client cl on cl.id = t.client_id
        where t.ended_at is not null and t.started_at >= ? and u.organisation_id = ?`,
    ).bind(isoMinus(days), principal.organisationId)
     .all<{ client_id: string | null; minutes: number | null; billable: number; client_name: string | null; client_colour: string | null }>(),
  ])

  // Only boards this person may actually open, and matching the client filter.
  const visibleBoards = new Map<string, { name: string }>()
  for (const board of boardRows.results) {
    if (!canOpen(accessTo(principal, board, board.permission))) continue
    if (clientId && board.client_id && board.client_id !== clientId) continue
    visibleBoards.set(board.id, { name: board.name })
  }

  // First column of each kind per board, matching what the board view shows.
  const statusColumn = new Map<string, { id: string; settings: ColumnSettings }>()
  const peopleColumn = new Map<string, string>()
  const dateColumn = new Map<string, string>()
  for (const column of columnRows.results) {
    if (!visibleBoards.has(column.board_id)) continue
    if (column.type === 'STATUS' && !statusColumn.has(column.board_id)) {
      statusColumn.set(column.board_id, { id: column.id, settings: parseSettings(column.settings) })
    } else if (column.type === 'PEOPLE' && !peopleColumn.has(column.board_id)) {
      peopleColumn.set(column.board_id, column.id)
    } else if (column.type === 'DATE' && !dateColumn.has(column.board_id)) {
      dateColumn.set(column.board_id, column.id)
    }
  }

  const cellsByItem = new Map<string, Map<string, CellValue>>()
  for (const cell of cellRows.results) {
    const bucket = cellsByItem.get(cell.item_id) ?? new Map<string, CellValue>()
    bucket.set(cell.column_id, parseCell(cell.value))
    cellsByItem.set(cell.item_id, bucket)
  }

  const userNames = new Map(userRows.results.map((u) => [u.id, u.full_name]))
  const clientById = new Map(clientRows.results.map((cl) => [cl.id, cl]))

  let openItems = 0
  let overdue = 0
  let dueThisWeek = 0
  let unassigned = 0
  const statusCounts = new Map<string, StatusSlice>()
  const workload = new Map<string, WorkloadRow>()
  const atRisk: unknown[] = []

  for (const item of itemRows.results) {
    const board = visibleBoards.get(item.board_id)
    if (!board) continue
    if (clientId && item.client_id && item.client_id !== clientId) continue

    const cells = cellsByItem.get(item.id)
    const status = statusColumn.get(item.board_id)
    const labelId = status ? cells?.get(status.id)?.labelId : undefined
    const label = status?.settings.labels?.find((l) => l.id === labelId)

    if (status) {
      const key = labelId ?? '__none__'
      const existing = statusCounts.get(key)
      statusCounts.set(key, {
        labelId: key,
        label: label?.label ?? 'No status',
        colour: label?.colour ?? 'grey',
        count: (existing?.count ?? 0) + 1,
      })
    }

    if (labelId && DONE_LABELS.has(labelId.toLowerCase())) continue

    openItems++

    const peopleId = peopleColumn.get(item.board_id)
    const owners = peopleId ? cells?.get(peopleId)?.userIds ?? [] : []
    if (owners.length === 0) unassigned++

    const dateId = dateColumn.get(item.board_id)
    const due = dateId ? cells?.get(dateId)?.date : undefined
    const late = due ? due < now : false
    const soon = due ? !late && due <= weekEnd : false

    for (const ownerId of owners) {
      const row = workload.get(ownerId) ?? {
        userId: ownerId, fullName: userNames.get(ownerId) ?? 'Unknown', open: 0, overdue: 0,
      }
      row.open++
      if (late) row.overdue++
      workload.set(ownerId, row)
    }

    if (late) overdue++
    else if (soon) dueThisWeek++

    if (late || soon) {
      const client = item.client_id ? clientById.get(item.client_id) : undefined
      atRisk.push({
        itemId: item.id,
        title: item.title,
        boardId: item.board_id,
        boardName: board.name,
        clientId: item.client_id ?? undefined,
        clientName: client?.name,
        owners: owners.map((id) => userNames.get(id) ?? 'Unknown'),
        dueOn: due,
        daysLate: late && due ? daysBetween(due, now) : 0,
        statusLabel: label?.label ?? 'No status',
        statusColour: label?.colour ?? 'grey',
      })
    }
  }

  atRisk.sort((a, b) =>
    String((a as { dueOn?: string }).dueOn ?? '9999').localeCompare(
      String((b as { dueOn?: string }).dueOn ?? '9999'),
    ),
  )

  // Hours have to respect the same client scoping as everything else.
  // Without this, someone who cannot open a client's boards still sees that
  // client's name and hours here - which is a leak, not a rounding error.
  const seesEveryClient = principal.role === 'ADMIN' || principal.role === 'MANAGER'
  const allowedClients = new Set(principal.clientIds)

  const hoursByClient = new Map<string, { name: string; colour: string; minutes: number }>()
  let minutesLogged = 0
  let billableMinutes = 0
  for (const entry of timeRows.results) {
    if (clientId && entry.client_id !== clientId) continue
    if (!seesEveryClient && entry.client_id && !allowedClients.has(entry.client_id)) continue
    const minutes = entry.minutes ?? 0
    minutesLogged += minutes
    if (bool(entry.billable)) billableMinutes += minutes
    const key = entry.client_id ?? 'internal'
    const row = hoursByClient.get(key) ?? {
      name: entry.client_name ?? 'Internal / unassigned',
      colour: entry.client_colour ?? 'grey',
      minutes: 0,
    }
    row.minutes += minutes
    hoursByClient.set(key, row)
  }

  return c.json({
    openItems,
    overdue,
    dueThisWeek,
    unassigned,
    activeClients: clientRows.results.filter((cl) => cl.status === 'ACTIVE').length,
    minutesLogged,
    billableMinutes,
    statusBreakdown: [...statusCounts.values()],
    workload: [...workload.values()].sort((a, b) => b.open - a.open),
    hoursByClient: [...hoursByClient.entries()]
      .map(([key, row]) => ({
        clientId: key === 'internal' ? undefined : key,
        clientName: row.name,
        colour: row.colour,
        minutes: row.minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    atRisk: atRisk.slice(0, 25),
  })
})
