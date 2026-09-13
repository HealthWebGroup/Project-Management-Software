import { Hono } from 'hono'
import { accessTo, requireEdit, requireOpen } from '../access'
import { onEvent } from '../automations'
import { validateCell } from '../cells'
import { newId, now, parseCell, recordActivity } from '../db'
import { HttpError } from '../errors'
import { LIMITS, integer, optionalText, readJson, text } from '../validate'
import { loadBoard } from './boards'
import { notify } from './notifications'
import type { CellValue, ColumnType, Env, Vars } from '../types'

export const items = new Hono<{ Bindings: Env; Variables: Vars }>()

interface ItemRow {
  id: string
  board_id: string
  group_id: string | null
  parent_id: string | null
  client_id: string | null
  title: string
  sort_order: number
  created_at: string
  updated_at: string
}

async function loadItem(env: Env, itemId: string): Promise<ItemRow> {
  const item = await env.DB
    .prepare(
      `select id, board_id, group_id, parent_id, client_id, title, sort_order, created_at, updated_at
         from item where id = ?`,
    )
    .bind(itemId)
    .first<ItemRow>()
  if (!item) throw HttpError.notFound('Item')
  return item
}

/** A client id from a request body has to be one this organisation owns. */
async function clientInOrganisation(
  env: Env, organisationId: string, value: unknown,
): Promise<string | null> {
  const wanted = optionalText(value, 'Client', 64)
  if (!wanted) return null
  const row = await env.DB
    .prepare(`select id from client where id = ? and organisation_id = ?`)
    .bind(wanted, organisationId).first<{ id: string }>()
  if (!row) throw HttpError.badRequest('That client is not one of yours.')
  return row.id
}

const toDto = (item: ItemRow, cells: Record<string, CellValue> = {}) => ({
  id: item.id,
  groupId: item.group_id ?? undefined,
  parentId: item.parent_id ?? undefined,
  clientId: item.client_id ?? undefined,
  title: item.title,
  sortOrder: item.sort_order,
  cells,
  createdAt: item.created_at,
  updatedAt: item.updated_at,
})

// ----------------------------------------------------------------- create

items.post('/boards/:boardId/items', async (c) => {
  const principal = c.get('principal')
  const board = await loadBoard(c.env, c.req.param('boardId'), principal)
  requireEdit(accessTo(principal, board, board.permission))

  const body = await readJson<{
    groupId?: unknown; parentId?: unknown; clientId?: unknown; title?: unknown
  }>(c.req)
  const title = text(body.title, 'The item title', LIMITS.title)

  // Every id in the body has to belong to this board, or to this
  // organisation. Otherwise creating an item on a board you CAN open is a way
  // to hang your text off an item on a board you cannot - putting words you
  // chose in front of people you have no business talking to.
  const groupId = optionalText(body.groupId, 'Group', 64) || null
  if (groupId) {
    const group = await c.env.DB
      .prepare(`select id from board_group where id = ? and board_id = ?`)
      .bind(groupId, board.id).first<{ id: string }>()
    if (!group) throw HttpError.badRequest('That group is not on this board.')
  }

  const parentId = optionalText(body.parentId, 'Parent item', 64) || null
  if (parentId) {
    const parent = await c.env.DB
      .prepare(`select id from item where id = ? and board_id = ?`)
      .bind(parentId, board.id).first<{ id: string }>()
    if (!parent) throw HttpError.badRequest('That parent item is not on this board.')
  }

  const clientId = await clientInOrganisation(c.env, principal.organisationId, body.clientId)

  const id = newId()
  const timestamp = now()
  const position = await c.env.DB
    .prepare(`select coalesce(max(sort_order) + 1, 0) as next from item where board_id = ?`)
    .bind(board.id).first<{ next: number }>()

  await c.env.DB
    .prepare(
      `insert into item (id, board_id, group_id, parent_id, client_id, title, sort_order,
                         created_by, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, board.id, groupId, parentId,
      // Fall back to the board's client so an item is never orphaned.
      clientId ?? board.client_id ?? null,
      title, position?.next ?? 0, principal.userId, timestamp, timestamp,
    )
    .run()

  await recordActivity(c.env.DB, {
    entityType: 'ITEM', entityId: id, boardId: board.id,
    actorId: principal.userId, action: 'CREATED', detail: title,
  })

  // Rules that watch for new work. A failing rule must never lose the item
  // the person just created, so this cannot throw out of the request.
  await onEvent(c.env, { kind: 'ITEM_CREATED', boardId: board.id, itemId: id }, principal.userId)
    .catch(() => [])

  return c.json(
    toDto({
      id, board_id: board.id, group_id: groupId, parent_id: parentId,
      client_id: clientId ?? board.client_id ?? null, title,
      sort_order: position?.next ?? 0, created_at: timestamp, updated_at: timestamp,
    }),
  )
})

// ------------------------------------------------------------------ read

items.get('/items/:itemId', async (c) => {
  const principal = c.get('principal')
  const item = await loadItem(c.env, c.req.param('itemId'))
  const board = await loadBoard(c.env, item.board_id, principal)
  requireOpen(accessTo(principal, board, board.permission))

  const [cells, subitems, updates, activity] = await Promise.all([
    c.env.DB.prepare(`select column_id, value from cell where item_id = ?`)
      .bind(item.id).all<{ column_id: string; value: string }>(),

    c.env.DB.prepare(
      `select id, board_id, group_id, parent_id, client_id, title, sort_order, created_at, updated_at
         from item where parent_id = ? order by sort_order`,
    ).bind(item.id).all<ItemRow>(),

    c.env.DB.prepare(
      `select u.id, u.author_id, u.body, u.created_at, a.full_name
         from item_update u left join app_user a on a.id = u.author_id
        where u.item_id = ? order by u.created_at desc limit 100`,
    ).bind(item.id).all<{ id: string; author_id: string | null; body: string; created_at: string; full_name: string | null }>(),

    c.env.DB.prepare(
      `select l.id, l.action, l.detail, l.occurred_at, a.full_name
         from activity_log l left join app_user a on a.id = l.actor_id
        where l.entity_type = 'ITEM' and l.entity_id = ?
        order by l.occurred_at desc limit 50`,
    ).bind(item.id).all<{ id: number; action: string; detail: string | null; occurred_at: string; full_name: string | null }>(),
  ])

  const cellMap: Record<string, CellValue> = {}
  for (const cell of cells.results) cellMap[cell.column_id] = parseCell(cell.value)

  return c.json({
    item: toDto(item, cellMap),
    subitems: subitems.results.map((s) => toDto(s)),
    updates: updates.results.map((u) => ({
      id: u.id, authorId: u.author_id ?? undefined,
      authorName: u.full_name ?? 'Someone', body: u.body, createdAt: u.created_at,
    })),
    activity: activity.results.map((a) => ({
      id: a.id, actorName: a.full_name ?? 'System',
      action: a.action, detail: a.detail ?? undefined, occurredAt: a.occurred_at,
    })),
  })
})

// ---------------------------------------------------------------- update

items.patch('/items/:itemId', async (c) => {
  const principal = c.get('principal')
  const item = await loadItem(c.env, c.req.param('itemId'))
  const board = await loadBoard(c.env, item.board_id, principal)
  requireEdit(accessTo(principal, board, board.permission))

  const body = await readJson<{
    title?: unknown; groupId?: unknown; clientId?: unknown
    sortOrder?: unknown; archived?: unknown
  }>(c.req)

  const title = optionalText(body.title, 'The item title', LIMITS.title) || item.title

  // Same reasoning as on create: a group id from the body has to be a group
  // on this board, and a client id has to be one this organisation owns.
  let groupId = item.group_id
  if (body.groupId !== undefined) {
    const wanted = optionalText(body.groupId, 'Group', 64) || null
    if (wanted) {
      const group = await c.env.DB
        .prepare(`select id from board_group where id = ? and board_id = ?`)
        .bind(wanted, board.id).first<{ id: string }>()
      if (!group) throw HttpError.badRequest('That group is not on this board.')
    }
    groupId = wanted
  }

  const clientId =
    body.clientId === undefined
      ? item.client_id
      : await clientInOrganisation(c.env, principal.organisationId, body.clientId)

  await c.env.DB
    .prepare(
      `update item set title = ?, group_id = ?, client_id = ?, sort_order = ?, archived = ?, updated_at = ?
        where id = ?`,
    )
    .bind(
      title,
      groupId,
      clientId,
      body.sortOrder === undefined ? item.sort_order : integer(body.sortOrder, 'Position', 0, 1_000_000),
      body.archived === undefined ? 0 : body.archived ? 1 : 0,
      now(),
      item.id,
    )
    .run()

  if (body.title !== undefined && title !== item.title) {
    await recordActivity(c.env.DB, {
      entityType: 'ITEM', entityId: item.id, boardId: board.id, actorId: principal.userId,
      action: 'RENAMED', detail: `${item.title} -> ${title}`,
      before: { title: item.title }, after: { title },
    })
  }
  if (body.clientId !== undefined && clientId !== item.client_id) {
    await recordActivity(c.env.DB, {
      entityType: 'ITEM', entityId: item.id, boardId: board.id, actorId: principal.userId,
      action: 'CELL_CHANGED', detail: `Client changed on ${title}`,
    })
  }

  return c.body(null, 204)
})

items.delete('/items/:itemId', async (c) => {
  const principal = c.get('principal')
  const item = await loadItem(c.env, c.req.param('itemId'))
  const board = await loadBoard(c.env, item.board_id, principal)
  requireEdit(accessTo(principal, board, board.permission))

  await recordActivity(c.env.DB, {
    entityType: 'ITEM', entityId: item.id, boardId: board.id,
    actorId: principal.userId, action: 'DELETED', detail: item.title,
  })
  await c.env.DB.prepare(`delete from item where id = ?`).bind(item.id).run()
  return c.body(null, 204)
})

// ----------------------------------------------------------------- cells

/** The call the grid makes on every edit, so it stays deliberately small. */
items.put('/items/:itemId/cells/:columnId', async (c) => {
  const principal = c.get('principal')
  const item = await loadItem(c.env, c.req.param('itemId'))
  const board = await loadBoard(c.env, item.board_id, principal)
  requireEdit(accessTo(principal, board, board.permission))

  const column = await c.env.DB
    .prepare(`select id, board_id, title, type from board_column where id = ?`)
    .bind(c.req.param('columnId'))
    .first<{ id: string; board_id: string; title: string; type: ColumnType }>()
  if (!column) throw HttpError.notFound('Column')
  if (column.board_id !== item.board_id) {
    throw HttpError.badRequest('That column belongs to a different board.')
  }

  const body = await readJson<{ value?: CellValue }>(c.req)
  const value = validateCell(column.type, body.value)

  // A PEOPLE cell decides who gets notified, so an id from another
  // organisation would be a way to put text in a stranger's notification
  // list. Shape alone is not enough - these have to be real colleagues.
  if (column.type === 'PEOPLE' && value.userIds?.length) {
    const marks = value.userIds.map(() => '?').join(', ')
    const found = await c.env.DB
      .prepare(
        `select count(*) as n from app_user
          where organisation_id = ? and id in (${marks})`,
      )
      .bind(principal.organisationId, ...value.userIds)
      .first<{ n: number }>()
    if ((found?.n ?? 0) !== new Set(value.userIds).size) {
      throw HttpError.badRequest('One of those people is not in your organisation.')
    }
  }

  const existing = await c.env.DB
    .prepare(`select value from cell where item_id = ? and column_id = ?`)
    .bind(item.id, column.id).first<{ value: string }>()

  await c.env.DB
    .prepare(
      `insert into cell (item_id, column_id, value, updated_at, updated_by)
       values (?, ?, ?, ?, ?)
       on conflict(item_id, column_id) do update set
         value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(item.id, column.id, JSON.stringify(value), now(), principal.userId)
    .run()

  await c.env.DB.prepare(`update item set updated_at = ? where id = ?`).bind(now(), item.id).run()

  const before = parseCell(existing?.value)

  await recordActivity(c.env.DB, {
    entityType: 'CELL', entityId: item.id, boardId: board.id, actorId: principal.userId,
    action: 'CELL_CHANGED', detail: `${column.title} on ${item.title}`,
    before, after: value,
  })

  // Being given a piece of work is worth being told about; being told you
  // still own what you already owned is not, so only the newly added.
  if (column.type === 'PEOPLE') {
    const had = new Set(before.userIds ?? [])
    const added = (value.userIds ?? []).filter((id) => !had.has(id))
    await notify(c.env, {
      userIds: added,
      kind: 'ASSIGNED',
      title: `${principal.fullName} put you on "${item.title}"`,
      body: board.name,
      boardId: board.id,
      itemId: item.id,
      exceptUserId: principal.userId,
    }).catch(() => undefined)
  }

  let automations: { name: string; did: string }[] = []
  if (column.type === 'STATUS') {
    // A rule that fails must not take the edit down with it: the cell is
    // already saved, and losing the save to a broken rule would be worse
    // than the rule not running.
    automations = await onEvent(
      c.env,
      { kind: 'CELL_CHANGED', boardId: board.id, itemId: item.id, columnId: column.id, value },
      principal.userId,
    ).catch(() => [])
  }

  return c.json(automations.length > 0 ? { ...value, automations } : value)
})

// --------------------------------------------------------------- updates

items.post('/items/:itemId/updates', async (c) => {
  const principal = c.get('principal')
  const item = await loadItem(c.env, c.req.param('itemId'))
  const board = await loadBoard(c.env, item.board_id, principal)
  requireEdit(accessTo(principal, board, board.permission))

  const body = await readJson<{ body?: unknown }>(c.req)
  const comment = text(body.body, 'The comment', LIMITS.longText)

  const id = newId()
  const timestamp = now()
  await c.env.DB
    .prepare(`insert into item_update (id, item_id, author_id, body, created_at) values (?, ?, ?, ?, ?)`)
    .bind(id, item.id, principal.userId, comment, timestamp)
    .run()

  await recordActivity(c.env.DB, {
    entityType: 'ITEM', entityId: item.id, boardId: board.id,
    actorId: principal.userId, action: 'COMMENTED',
  })

  // Whoever owns the item should hear about a comment on it.
  const owners = await c.env.DB
    .prepare(
      `select ce.value from cell ce
         join board_column bc on bc.id = ce.column_id
        where ce.item_id = ? and bc.type = 'PEOPLE'`,
    )
    .bind(item.id).all<{ value: string }>()
  const ownerIds = owners.results.flatMap((row) => parseCell(row.value).userIds ?? [])
  await notify(c.env, {
    userIds: ownerIds,
    kind: 'COMMENTED',
    title: `${principal.fullName} commented on "${item.title}"`,
    body: comment.slice(0, 140),
    boardId: board.id,
    itemId: item.id,
    exceptUserId: principal.userId,
  }).catch(() => undefined)

  return c.json({
    id, authorId: principal.userId, authorName: principal.fullName,
    body: comment, createdAt: timestamp,
  })
})
