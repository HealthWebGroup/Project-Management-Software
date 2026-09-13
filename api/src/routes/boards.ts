import { Hono } from 'hono'
import { Access, accessTo, canEdit, defaultSensitivity, requireAdmin, requireEdit, requireOpen, isManager } from '../access'
import { bool, flag, newId, now, parseCell, parseSettings, recordActivity } from '../db'
import { HttpError } from '../errors'
import { LIMITS, integer, oneOf, optionalText, readJson, text } from '../validate'
import { GROUP_COLOURS, TEMPLATES } from '../templates'
import type { BoardPermission, BoardTemplate, Env, Sensitivity, Vars } from '../types'

interface BoardRow {
  id: string
  workspace_id: string
  client_id: string | null
  name: string
  description: string | null
  template: BoardTemplate
  sensitivity: Sensitivity
  organisation_id: string
}

/**
 * Loads a board with the caller's permission on it, in one query.
 * D1's free plan allows 50 queries per request, so joining beats looping.
 */
export async function loadBoard(env: Env, boardId: string, principal: { userId: string; organisationId: string }) {
  const row = await env.DB
    .prepare(
      `select b.id, b.workspace_id, b.client_id, b.name, b.description, b.template,
              b.sensitivity, w.organisation_id, m.permission as permission
         from board b
         join workspace w on w.id = b.workspace_id
         left join board_member m on m.board_id = b.id and m.user_id = ?
        where b.id = ?`,
    )
    .bind(principal.userId, boardId)
    .first<BoardRow & { permission: BoardPermission | null }>()

  // Do not confirm that a board in another organisation exists.
  if (!row || row.organisation_id !== principal.organisationId) throw HttpError.notFound('Board')
  return row
}


/** The column types the engine knows how to store and draw. */
const COLUMN_TYPES = [
  'TEXT', 'LONG_TEXT', 'STATUS', 'PEOPLE', 'DATE', 'TIMELINE', 'NUMBER',
  'DROPDOWN', 'CHECKBOX', 'FILE', 'LINK', 'DEPENDENCY', 'FORMULA',
] as const

/**
 * Column settings carry status labels and dropdown options, so they are
 * genuinely open-ended - but they still go in a shared database. Cap the
 * serialised size rather than accepting an arbitrary blob.
 */
function settingsJson(value: unknown, fallback = '{}'): string {
  if (value === undefined) return fallback
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw HttpError.badRequest('Column settings must be an object.')
  }
  const encoded = JSON.stringify(value)
  if (encoded.length > 20_000) {
    throw HttpError.badRequest('Those column settings are too large.')
  }
  return encoded
}

export const boards = new Hono<{ Bindings: Env; Variables: Vars }>()

// ------------------------------------------------------------ workspaces

boards.get('/workspaces', async (c) => {
  const principal = c.get('principal')
  const clientId = c.req.query('clientId') ?? null

  const [workspaceRows, boardRows, counts] = await Promise.all([
    c.env.DB.prepare(
      `select id, name, description, colour from workspace
        where organisation_id = ? order by sort_order, name`,
    ).bind(principal.organisationId).all<{ id: string; name: string; description: string | null; colour: string }>(),

    c.env.DB.prepare(
      `select b.id, b.workspace_id, b.client_id, b.name, b.description, b.template,
              b.sensitivity, m.permission as permission
         from board b
         join workspace w on w.id = b.workspace_id
         left join board_member m on m.board_id = b.id and m.user_id = ?
        where w.organisation_id = ?
        order by b.sort_order, b.name`,
    ).bind(principal.userId, principal.organisationId)
     .all<BoardRow & { permission: BoardPermission | null }>(),

    c.env.DB.prepare(
      `select b.id as board_id, count(i.id) as item_count
         from board b
         join workspace w on w.id = b.workspace_id
         left join item i on i.board_id = b.id and i.archived = 0
        where w.organisation_id = ?
        group by b.id`,
    ).bind(principal.organisationId).all<{ board_id: string; item_count: number }>(),
  ])

  const countBy = new Map(counts.results.map((r) => [r.board_id, r.item_count]))

  return c.json(
    workspaceRows.results
      .map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        description: workspace.description ?? undefined,
        colour: workspace.colour,
        boards: boardRows.results
          .filter((b) => b.workspace_id === workspace.id)
          .filter((b) => accessTo(principal, b, b.permission) !== Access.NONE)
          // A board with no client is internal and shows whatever is selected.
          .filter((b) => !clientId || !b.client_id || b.client_id === clientId)
          .map((b) => ({
            id: b.id,
            name: b.name,
            description: b.description ?? undefined,
            clientId: b.client_id ?? undefined,
            template: b.template,
            sensitivity: b.sensitivity,
            itemCount: countBy.get(b.id) ?? 0,
          })),
      }))
      .filter((workspace) => workspace.boards.length > 0),
  )
})

// ----------------------------------------------------------------- board

boards.get('/boards/:boardId', async (c) => {
  const principal = c.get('principal')
  const board = await loadBoard(c.env, c.req.param('boardId'), principal)
  const level = requireOpen(accessTo(principal, board, board.permission))

  // Opening a locked-down board is itself auditable.
  if (board.sensitivity === 'RESTRICTED') {
    await recordActivity(c.env.DB, {
      entityType: 'BOARD', entityId: board.id, boardId: board.id,
      actorId: principal.userId, action: 'READ', detail: `Opened ${board.name}`,
    })
  }

  const [groups, columns, items, members] = await Promise.all([
    c.env.DB.prepare(
      `select id, title, colour, sort_order, collapsed from board_group
        where board_id = ? order by sort_order`,
    ).bind(board.id).all<{ id: string; title: string; colour: string; sort_order: number; collapsed: number }>(),

    c.env.DB.prepare(
      `select id, title, type, settings, sort_order, width from board_column
        where board_id = ? order by sort_order`,
    ).bind(board.id).all<{ id: string; title: string; type: string; settings: string; sort_order: number; width: number }>(),

    c.env.DB.prepare(
      `select id, group_id, parent_id, client_id, title, sort_order, created_at, updated_at
         from item where board_id = ? and archived = 0 order by sort_order`,
    ).bind(board.id).all<{
      id: string; group_id: string | null; parent_id: string | null; client_id: string | null
      title: string; sort_order: number; created_at: string; updated_at: string
    }>(),

    c.env.DB.prepare(
      `select id, email, full_name, job_title, role, site_id from app_user
        where organisation_id = ? and status = 'ACTIVE' order by full_name`,
    ).bind(principal.organisationId).all<{
      id: string; email: string; full_name: string; job_title: string | null; role: string; site_id: string | null
    }>(),
  ])

  // All cells for this board in one query rather than one per item.
  const cells = await c.env.DB
    .prepare(
      `select c.item_id, c.column_id, c.value
         from cell c join item i on i.id = c.item_id
        where i.board_id = ? and i.archived = 0`,
    )
    .bind(board.id)
    .all<{ item_id: string; column_id: string; value: string }>()

  const cellsByItem = new Map<string, Record<string, unknown>>()
  for (const cell of cells.results) {
    const bucket = cellsByItem.get(cell.item_id) ?? {}
    bucket[cell.column_id] = parseCell(cell.value)
    cellsByItem.set(cell.item_id, bucket)
  }

  return c.json({
    id: board.id,
    workspaceId: board.workspace_id,
    clientId: board.client_id ?? undefined,
    name: board.name,
    description: board.description ?? undefined,
    template: board.template,
    sensitivity: board.sensitivity,
    canEdit: canEdit(level),
    groups: groups.results.map((g) => ({
      id: g.id, title: g.title, colour: g.colour,
      sortOrder: g.sort_order, collapsed: bool(g.collapsed),
    })),
    columns: columns.results.map((col) => ({
      id: col.id, title: col.title, type: col.type,
      settings: parseSettings(col.settings), sortOrder: col.sort_order, width: col.width,
    })),
    items: items.results.map((i) => ({
      id: i.id,
      groupId: i.group_id ?? undefined,
      parentId: i.parent_id ?? undefined,
      clientId: i.client_id ?? undefined,
      title: i.title,
      sortOrder: i.sort_order,
      cells: cellsByItem.get(i.id) ?? {},
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    })),
    members: members.results.map((u) => ({
      id: u.id, email: u.email, fullName: u.full_name,
      jobTitle: u.job_title ?? undefined, role: u.role,
      siteId: u.site_id ?? undefined, mustChangePassword: false,
    })),
  })
})

boards.post('/boards', async (c) => {
  const principal = c.get('principal')
  if (!isManager(principal)) {
    throw HttpError.forbidden('Only managers and administrators can create boards.')
  }

  const body = await readJson<{
    workspaceId?: unknown; clientId?: unknown; name?: unknown
    description?: unknown; template?: unknown
  }>(c.req)

  const workspaceId = text(body.workspaceId, 'Workspace', 64)
  const name = text(body.name, 'The board name')
  const description = optionalText(body.description, 'The description', LIMITS.shortText)
  const templateName = oneOf(
    body.template, Object.keys(TEMPLATES) as BoardTemplate[], 'Template',
  )
  const template = TEMPLATES[templateName]

  // A client id from the body has to be one this organisation owns, or the
  // board is stamped with a client no query on this side will ever match.
  const clientId = optionalText(body.clientId, 'Client', 64) || null
  if (clientId) {
    const client = await c.env.DB
      .prepare(`select id from client where id = ? and organisation_id = ?`)
      .bind(clientId, principal.organisationId).first<{ id: string }>()
    if (!client) throw HttpError.badRequest('That client is not one of yours.')
  }

  const workspace = await c.env.DB
    .prepare(`select id, organisation_id from workspace where id = ?`)
    .bind(workspaceId)
    .first<{ id: string; organisation_id: string }>()
  if (!workspace || workspace.organisation_id !== principal.organisationId) {
    throw HttpError.notFound('Workspace')
  }

  const boardId = newId()
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `insert into board (id, workspace_id, client_id, name, description, template, sensitivity,
                          sort_order, created_by, created_at)
       values (?, ?, ?, ?, ?, ?, ?,
               (select coalesce(max(sort_order) + 1, 0) from board where workspace_id = ?), ?, ?)`,
    ).bind(
      boardId, workspace.id, clientId, name, description || null,
      templateName, defaultSensitivity(templateName), workspace.id, principal.userId, now(),
    ),
  ]

  template.groups.forEach((title, index) => {
    statements.push(
      c.env.DB.prepare(
        `insert into board_group (id, board_id, title, colour, sort_order) values (?, ?, ?, ?, ?)`,
      ).bind(newId(), boardId, title, GROUP_COLOURS[index % GROUP_COLOURS.length], index),
    )
  })

  template.columns.forEach((column, index) => {
    statements.push(
      c.env.DB.prepare(
        `insert into board_column (id, board_id, title, type, settings, sort_order, width)
         values (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newId(), boardId, column.title, column.type, JSON.stringify(column.settings), index, column.width),
    )
  })

  // One batch: the board and its whole structure land together or not at all.
  await c.env.DB.batch(statements)

  await recordActivity(c.env.DB, {
    entityType: 'BOARD', entityId: boardId, boardId,
    actorId: principal.userId, action: 'CREATED', detail: name,
  })

  return c.json({
    id: boardId, name, description: description || undefined,
    clientId: clientId ?? undefined, template: templateName,
    sensitivity: defaultSensitivity(templateName), itemCount: 0,
  })
})

boards.patch('/boards/:boardId', async (c) => {
  const principal = c.get('principal')
  const board = await loadBoard(c.env, c.req.param('boardId'), principal)
  requireAdmin(accessTo(principal, board, board.permission))

  const body = await readJson<{ name?: unknown; description?: unknown }>(c.req)
  await c.env.DB
    .prepare(`update board set name = ?, description = ? where id = ?`)
    .bind(
      optionalText(body.name, 'The board name') || board.name,
      body.description === undefined
        ? board.description
        : optionalText(body.description, 'The description', LIMITS.shortText) || null,
      board.id,
    )
    .run()

  await recordActivity(c.env.DB, {
    entityType: 'BOARD', entityId: board.id, boardId: board.id,
    actorId: principal.userId, action: 'UPDATED', detail: optionalText(body.name, 'The board name') || board.name,
  })
  return c.body(null, 204)
})

boards.delete('/boards/:boardId', async (c) => {
  const principal = c.get('principal')
  const board = await loadBoard(c.env, c.req.param('boardId'), principal)
  requireAdmin(accessTo(principal, board, board.permission))

  await recordActivity(c.env.DB, {
    entityType: 'BOARD', entityId: board.id, boardId: board.id,
    actorId: principal.userId, action: 'DELETED', detail: board.name,
  })
  await c.env.DB.prepare(`delete from board where id = ?`).bind(board.id).run()
  return c.body(null, 204)
})

// ---------------------------------------------------------------- groups

boards.post('/boards/:boardId/groups', async (c) => {
  const principal = c.get('principal')
  const board = await loadBoard(c.env, c.req.param('boardId'), principal)
  requireEdit(accessTo(principal, board, board.permission))

  const body = await readJson<{ title?: unknown; colour?: unknown }>(c.req)
  const title = text(body.title, 'The group title')
  const colour = optionalText(body.colour, 'Colour', LIMITS.colour) || 'blue'

  const id = newId()
  const position = await c.env.DB
    .prepare(`select coalesce(max(sort_order) + 1, 0) as next from board_group where board_id = ?`)
    .bind(board.id).first<{ next: number }>()

  await c.env.DB
    .prepare(`insert into board_group (id, board_id, title, colour, sort_order) values (?, ?, ?, ?, ?)`)
    .bind(id, board.id, title, colour, position?.next ?? 0)
    .run()

  return c.json({
    id, title, colour, sortOrder: position?.next ?? 0, collapsed: false,
  })
})

boards.patch('/groups/:groupId', async (c) => {
  const principal = c.get('principal')
  const group = await c.env.DB
    .prepare(`select id, board_id, title, colour, sort_order, collapsed from board_group where id = ?`)
    .bind(c.req.param('groupId'))
    .first<{ id: string; board_id: string; title: string; colour: string; sort_order: number; collapsed: number }>()
  if (!group) throw HttpError.notFound('Group')

  const board = await loadBoard(c.env, group.board_id, principal)
  requireEdit(accessTo(principal, board, board.permission))

  const body = await readJson<{
    title?: unknown; colour?: unknown; sortOrder?: unknown; collapsed?: unknown
  }>(c.req)
  await c.env.DB
    .prepare(`update board_group set title = ?, colour = ?, sort_order = ?, collapsed = ? where id = ?`)
    .bind(
      optionalText(body.title, 'The group title') || group.title,
      optionalText(body.colour, 'Colour', LIMITS.colour) || group.colour,
      body.sortOrder === undefined ? group.sort_order : integer(body.sortOrder, 'Position', 0, 1_000_000),
      body.collapsed === undefined ? group.collapsed : flag(Boolean(body.collapsed)),
      group.id,
    )
    .run()
  return c.body(null, 204)
})

boards.delete('/groups/:groupId', async (c) => {
  const principal = c.get('principal')
  const group = await c.env.DB
    .prepare(`select id, board_id, title from board_group where id = ?`)
    .bind(c.req.param('groupId'))
    .first<{ id: string; board_id: string; title: string }>()
  if (!group) throw HttpError.notFound('Group')

  const board = await loadBoard(c.env, group.board_id, principal)
  requireEdit(accessTo(principal, board, board.permission))

  const inUse = await c.env.DB
    .prepare(`select count(*) as n from item where group_id = ?`)
    .bind(group.id).first<{ n: number }>()
  if ((inUse?.n ?? 0) > 0) {
    throw HttpError.badRequest('Move or delete the items in this group first.')
  }

  await c.env.DB.prepare(`delete from board_group where id = ?`).bind(group.id).run()
  return c.body(null, 204)
})

// --------------------------------------------------------------- columns

boards.post('/boards/:boardId/columns', async (c) => {
  const principal = c.get('principal')
  const board = await loadBoard(c.env, c.req.param('boardId'), principal)
  requireAdmin(accessTo(principal, board, board.permission))

  const body = await readJson<{ title?: unknown; type?: unknown; settings?: unknown }>(c.req)
  const title = text(body.title, 'The column title')
  // Checked here rather than left to the database's CHECK constraint, which
  // would surface as a 500 with no explanation of what was wrong.
  const type = oneOf(body.type, COLUMN_TYPES, 'Column type')
  const settings = settingsJson(body.settings)

  const id = newId()
  const position = await c.env.DB
    .prepare(`select coalesce(max(sort_order) + 1, 0) as next from board_column where board_id = ?`)
    .bind(board.id).first<{ next: number }>()

  await c.env.DB
    .prepare(`insert into board_column (id, board_id, title, type, settings, sort_order, width)
              values (?, ?, ?, ?, ?, ?, 160)`)
    .bind(id, board.id, title, type, settings, position?.next ?? 0)
    .run()

  return c.json({
    id, title, type, settings: JSON.parse(settings), sortOrder: position?.next ?? 0, width: 160,
  })
})

boards.patch('/columns/:columnId', async (c) => {
  const principal = c.get('principal')
  const column = await c.env.DB
    .prepare(`select id, board_id, title, settings, sort_order, width from board_column where id = ?`)
    .bind(c.req.param('columnId'))
    .first<{ id: string; board_id: string; title: string; settings: string; sort_order: number; width: number }>()
  if (!column) throw HttpError.notFound('Column')

  const board = await loadBoard(c.env, column.board_id, principal)
  requireAdmin(accessTo(principal, board, board.permission))

  const body = await readJson<{
    title?: unknown; settings?: unknown; sortOrder?: unknown; width?: unknown
  }>(c.req)
  await c.env.DB
    .prepare(`update board_column set title = ?, settings = ?, sort_order = ?, width = ? where id = ?`)
    .bind(
      optionalText(body.title, 'The column title') || column.title,
      settingsJson(body.settings, column.settings),
      body.sortOrder === undefined ? column.sort_order : integer(body.sortOrder, 'Position', 0, 1_000_000),
      body.width === undefined ? column.width : integer(body.width, 'Width', 80, 600),
      column.id,
    )
    .run()
  return c.body(null, 204)
})

boards.delete('/columns/:columnId', async (c) => {
  const principal = c.get('principal')
  const column = await c.env.DB
    .prepare(`select id, board_id, title from board_column where id = ?`)
    .bind(c.req.param('columnId'))
    .first<{ id: string; board_id: string; title: string }>()
  if (!column) throw HttpError.notFound('Column')

  const board = await loadBoard(c.env, column.board_id, principal)
  requireAdmin(accessTo(principal, board, board.permission))

  await recordActivity(c.env.DB, {
    entityType: 'COLUMN', entityId: column.id, boardId: board.id,
    actorId: principal.userId, action: 'DELETED', detail: column.title,
  })
  await c.env.DB.prepare(`delete from board_column where id = ?`).bind(column.id).run()
  return c.body(null, 204)
})
