import { Hono } from 'hono'
import { bool, newId, now } from '../db'
import { HttpError } from '../errors'
import { integer, isoDate, optionalText, readJson, text } from '../validate'
import type { Env, Vars } from '../types'

/**
 * Private lists.
 *
 * Every query is scoped to the caller, and there is deliberately no route that
 * reads someone else's list - not even for an administrator. This is the one
 * place in the system that is nobody's business but the person who wrote it,
 * and the way to keep it that way is to never build the door.
 */
export const todos = new Hono<{ Bindings: Env; Variables: Vars }>()

const RECENTLY_DONE_HOURS = 24

interface TodoRow {
  id: string
  title: string
  done: number
  due_on: string | null
  sort_order: number
  client_id: string | null
  client_name: string | null
  client_colour: string | null
}

const dto = (row: TodoRow) => ({
  id: row.id,
  title: row.title,
  done: bool(row.done),
  dueOn: row.due_on ?? undefined,
  sortOrder: row.sort_order,
  clientId: row.client_id ?? undefined,
  clientName: row.client_name ?? undefined,
  clientColour: row.client_colour ?? undefined,
})

const SELECT = `
  select t.id, t.title, t.done, t.due_on, t.sort_order, t.client_id,
         c.name as client_name, c.colour as client_colour
    from todo t left join client c on c.id = t.client_id`

todos.get('/todos', async (c) => {
  const principal = c.get('principal')
  // Open items, then anything finished in the last day so ticking something
  // off does not make it vanish before you have enjoyed it.
  const rows = await c.env.DB
    .prepare(
      `${SELECT}
        where t.user_id = ? and (t.done = 0 or t.completed_at >= ?)
        order by t.done, t.sort_order, t.completed_at desc`,
    )
    .bind(principal.userId, new Date(Date.now() - RECENTLY_DONE_HOURS * 3600000).toISOString())
    .all<TodoRow>()

  return c.json(rows.results.map(dto))
})

todos.post('/todos', async (c) => {
  const principal = c.get('principal')
  const body = await readJson<{ title?: unknown; dueOn?: unknown; clientId?: unknown }>(c.req)
  const title = text(body.title, 'The task', 300)
  const dueOn = isoDate(body.dueOn, 'The due date')

  // The client id is echoed back with its name attached, so an id from
  // another organisation would be a way to read that client's name.
  const wantedClient = optionalText(body.clientId, 'Client', 64)
  let clientId: string | null = null
  if (wantedClient) {
    const row = await c.env.DB
      .prepare(`select id from client where id = ? and organisation_id = ?`)
      .bind(wantedClient, principal.organisationId).first<{ id: string }>()
    if (!row) throw HttpError.badRequest('That client is not one of yours.')
    clientId = row.id
  }

  const id = newId()
  const position = await c.env.DB
    .prepare(`select coalesce(max(sort_order) + 1, 0) as next from todo where user_id = ? and done = 0`)
    .bind(principal.userId).first<{ next: number }>()

  await c.env.DB
    .prepare(
      `insert into todo (id, user_id, client_id, title, done, due_on, sort_order, created_at)
       values (?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(id, principal.userId, clientId, title, dueOn || null, position?.next ?? 0, now())
    .run()

  const row = await c.env.DB.prepare(`${SELECT} where t.id = ?`).bind(id).first<TodoRow>()
  return c.json(dto(row!))
})

/** Clears everything already ticked off. Must come before /todos/:todoId. */
todos.delete('/todos/done', async (c) => {
  const principal = c.get('principal')
  await c.env.DB
    .prepare(`delete from todo where user_id = ? and done = 1`)
    .bind(principal.userId).run()
  return c.body(null, 204)
})

todos.patch('/todos/:todoId', async (c) => {
  const principal = c.get('principal')
  const existing = await mineOrRefuse(c.env, c.req.param('todoId'), principal.userId)

  const body = await readJson<{
    title?: unknown; done?: unknown; dueOn?: unknown; sortOrder?: unknown
  }>(c.req)
  const done = body.done === undefined ? bool(existing.done) : Boolean(body.done)
  // The same 300-character limit as on create. Without it here, the cap was
  // one PATCH away from being no cap at all.
  const title = optionalText(body.title, 'The task', 300) || existing.title

  await c.env.DB
    .prepare(
      `update todo set title = ?, done = ?, due_on = ?, sort_order = ?, completed_at = ?
        where id = ? and user_id = ?`,
    )
    .bind(
      title,
      done ? 1 : 0,
      body.dueOn === undefined ? existing.due_on : isoDate(body.dueOn, 'The due date') || null,
      body.sortOrder === undefined ? existing.sort_order : integer(body.sortOrder, 'Position', 0, 1_000_000),
      done ? (bool(existing.done) ? existing.completed_at : now()) : null,
      existing.id,
      principal.userId,
    )
    .run()

  const row = await c.env.DB.prepare(`${SELECT} where t.id = ?`).bind(existing.id).first<TodoRow>()
  return c.json(dto(row!))
})

todos.delete('/todos/:todoId', async (c) => {
  const principal = c.get('principal')
  const existing = await mineOrRefuse(c.env, c.req.param('todoId'), principal.userId)
  await c.env.DB
    .prepare(`delete from todo where id = ? and user_id = ?`)
    .bind(existing.id, principal.userId).run()
  return c.body(null, 204)
})

interface OwnedRow {
  id: string
  title: string
  done: number
  due_on: string | null
  sort_order: number
  completed_at: string | null
}

/** Not "forbidden" - do not confirm that someone else's to-do exists. */
async function mineOrRefuse(env: Env, todoId: string, userId: string): Promise<OwnedRow> {
  const row = await env.DB
    .prepare(`select id, title, done, due_on, sort_order, completed_at from todo where id = ? and user_id = ?`)
    .bind(todoId, userId)
    .first<OwnedRow>()
  if (!row) throw HttpError.notFound('To-do')
  return row
}
