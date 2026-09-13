import { Hono } from 'hono'
import { accessTo, isManager, requireOpen } from '../access'
import { openOrTouchSession } from '../auth'
import { bool, isoMinus, minutesBetween, newId, now } from '../db'
import { HttpError } from '../errors'
import { LIMITS, integer, isoTimestamp, optionalText, readJson } from '../validate'
import type { BoardPermission, Env, Sensitivity, Vars } from '../types'

export const team = new Hono<{ Bindings: Env; Variables: Vars }>()

const ONLINE_WINDOW_MINUTES = 6

// ----------------------------------------------------------------- users

team.get('/users', async (c) => {
  const principal = c.get('principal')
  const rows = await c.env.DB
    .prepare(
      `select id, email, full_name, job_title, role, site_id from app_user
        where organisation_id = ? and status = 'ACTIVE' order by full_name`,
    )
    .bind(principal.organisationId)
    .all<{ id: string; email: string; full_name: string; job_title: string | null; role: string; site_id: string | null }>()

  return c.json(
    rows.results.map((u) => ({
      id: u.id, email: u.email, fullName: u.full_name,
      jobTitle: u.job_title ?? undefined, role: u.role,
      siteId: u.site_id ?? undefined, mustChangePassword: false,
    })),
  )
})

team.get('/users/sites', async (c) => {
  const principal = c.get('principal')
  const rows = await c.env.DB
    .prepare(`select id, name from site where organisation_id = ? and active = 1 order by name`)
    .bind(principal.organisationId).all<{ id: string; name: string }>()
  return c.json(rows.results)
})

// -------------------------------------------------------------- presence

/**
 * Who is signed in, and for how long.
 *
 * This is staff data. Everyone can see this page and everyone can see their
 * own history, which is what makes it presence rather than covert monitoring;
 * the whole team's history is limited to managers. Tell your team it exists
 * before switching it on - under GDPR that transparency is not optional.
 */
team.post('/presence/heartbeat', async (c) => {
  const principal = c.get('principal')
  await openOrTouchSession(c.env, principal.userId)
  return c.body(null, 204)
})

team.get('/presence/online', async (c) => {
  const principal = c.get('principal')
  const since = new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60000).toISOString()

  const rows = await c.env.DB
    .prepare(
      `select s.user_id, s.started_at, s.last_seen_at, u.full_name, u.job_title, u.role
         from user_session s
         join app_user u on u.id = s.user_id
        where s.ended_at is null and s.last_seen_at >= ? and u.organisation_id = ?
        order by s.started_at`,
    )
    .bind(since, principal.organisationId)
    .all<{
      user_id: string; started_at: string; last_seen_at: string
      full_name: string; job_title: string | null; role: string
    }>()

  const at = now()
  return c.json(
    rows.results.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      jobTitle: row.job_title ?? undefined,
      role: row.role,
      sessionStartedAt: row.started_at,
      minutesOnline: minutesBetween(row.started_at, at),
      lastSeenAt: row.last_seen_at,
    })),
  )
})

team.get('/presence/sessions', async (c) => {
  const principal = c.get('principal')
  const requested = c.req.query('userId') ?? null
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 14) || 14, 1), 90)

  // With no userId a manager sees everyone; anyone else sees only themselves,
  // and a plain member cannot read a colleague's history at all.
  const everyone = !requested && isManager(principal)
  const target = requested && !isManager(principal) ? principal.userId : requested

  const rows = everyone
    ? await c.env.DB.prepare(
        `select s.id, s.user_id, s.started_at, s.ended_at, s.last_seen_at, u.full_name
           from user_session s join app_user u on u.id = s.user_id
          where u.organisation_id = ? and s.started_at >= ?
          order by s.started_at desc limit 300`,
      ).bind(principal.organisationId, isoMinus(days)).all<SessionRow>()
    : await c.env.DB.prepare(
        `select s.id, s.user_id, s.started_at, s.ended_at, s.last_seen_at, u.full_name
           from user_session s join app_user u on u.id = s.user_id
          where s.user_id = ? and u.organisation_id = ?
          order by s.started_at desc limit 200`,
      ).bind(target ?? principal.userId, principal.organisationId).all<SessionRow>()

  const at = now()
  return c.json(
    rows.results.map((row) => ({
      id: row.id,
      userId: row.user_id,
      fullName: row.full_name,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      minutes: minutesBetween(row.started_at, row.ended_at ?? at),
      live: row.ended_at === null,
    })),
  )
})

interface SessionRow {
  id: string
  user_id: string
  started_at: string
  ended_at: string | null
  last_seen_at: string
  full_name: string
}

// ------------------------------------------------------------------ time

interface TimeRow {
  id: string
  user_id: string
  client_id: string | null
  item_id: string | null
  board_id: string | null
  started_at: string
  ended_at: string | null
  minutes: number | null
  note: string | null
  billable: number
  user_name?: string
  client_name?: string | null
  client_colour?: string | null
  item_title?: string | null
}

const TIME_SELECT = `
  select t.id, t.user_id, t.client_id, t.item_id, t.board_id, t.started_at, t.ended_at,
         t.minutes, t.note, t.billable,
         u.full_name as user_name, cl.name as client_name, cl.colour as client_colour,
         i.title as item_title
    from time_entry t
    join app_user u on u.id = t.user_id
    left join client cl on cl.id = t.client_id
    left join item i on i.id = t.item_id`

const timeDto = (row: TimeRow) => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name ?? 'Unknown',
  clientId: row.client_id ?? undefined,
  clientName: row.client_name ?? undefined,
  clientColour: row.client_colour ?? 'grey',
  itemId: row.item_id ?? undefined,
  itemTitle: row.item_title ?? undefined,
  startedAt: row.started_at,
  endedAt: row.ended_at ?? undefined,
  minutes: row.minutes ?? undefined,
  note: row.note ?? undefined,
  billable: bool(row.billable),
  running: row.ended_at === null,
})

team.get('/time/running', async (c) => {
  const principal = c.get('principal')
  const row = await c.env.DB
    .prepare(`${TIME_SELECT} where t.user_id = ? and t.ended_at is null`)
    .bind(principal.userId).first<TimeRow>()
  return row ? c.json(timeDto(row)) : c.body(null, 204)
})


/**
 * Resolve the item a timer or a logged entry points at.
 *
 * The important part is the access check. Without it, posting any item id
 * returns that item's title and client name in the response - which is a way
 * to read a line of a confidential board without ever opening it. The id has
 * to be guessed, but "hard to guess" is not an access control.
 */
async function itemForTime(env: Env, principal: Vars['principal'], itemId: string) {
  const item = await env.DB
    .prepare(`select id, board_id, client_id from item where id = ?`)
    .bind(itemId)
    .first<{ id: string; board_id: string; client_id: string | null }>()
  if (!item) throw HttpError.notFound('Item')

  const board = await env.DB
    .prepare(
      `select b.id, b.client_id, b.sensitivity, w.organisation_id, m.permission as permission
         from board b
         join workspace w on w.id = b.workspace_id
         left join board_member m on m.board_id = b.id and m.user_id = ?
        where b.id = ?`,
    )
    .bind(principal.userId, item.board_id)
    .first<{
      id: string; client_id: string | null; sensitivity: Sensitivity
      organisation_id: string; permission: BoardPermission | null
    }>()
  if (!board || board.organisation_id !== principal.organisationId) throw HttpError.notFound('Item')
  requireOpen(accessTo(principal, board, board.permission))
  return item
}

/** A client id from the body has to be one this organisation actually has. */
async function clientForTime(env: Env, organisationId: string, clientId: unknown): Promise<string | null> {
  const wanted = optionalText(clientId, 'Client', 64)
  if (!wanted) return null
  const row = await env.DB
    .prepare(`select id from client where id = ? and organisation_id = ?`)
    .bind(wanted, organisationId).first<{ id: string }>()
  if (!row) throw HttpError.badRequest('That client is not one of yours.')
  return row.id
}

team.post('/time/start', async (c) => {
  const principal = c.get('principal')

  const running = await c.env.DB
    .prepare(`select id from time_entry where user_id = ? and ended_at is null`)
    .bind(principal.userId).first<{ id: string }>()
  if (running) throw HttpError.badRequest('You already have a timer running. Stop it first.')

  const body = await readJson<{
    itemId?: unknown; clientId?: unknown; note?: unknown; billable?: unknown
  }>(c.req)
  const itemId = optionalText(body.itemId, 'Item', 64) || null
  const note = optionalText(body.note, 'The note', LIMITS.shortText)

  let clientId = await clientForTime(c.env, principal.organisationId, body.clientId)
  let boardId: string | null = null
  if (itemId) {
    const item = await itemForTime(c.env, principal, itemId)
    boardId = item.board_id
    clientId = clientId ?? item.client_id
  }

  const id = newId()
  await c.env.DB
    .prepare(
      `insert into time_entry (id, user_id, client_id, item_id, board_id, started_at, note, billable, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, principal.userId, clientId, itemId, boardId, now(),
      note || null, body.billable === false ? 0 : 1, now())
    .run()

  const row = await c.env.DB.prepare(`${TIME_SELECT} where t.id = ?`).bind(id).first<TimeRow>()
  return c.json(timeDto(row!))
})

team.post('/time/stop', async (c) => {
  const principal = c.get('principal')
  const running = await c.env.DB
    .prepare(`select id, started_at, note from time_entry where user_id = ? and ended_at is null`)
    .bind(principal.userId).first<{ id: string; started_at: string; note: string | null }>()
  if (!running) throw HttpError.badRequest('You do not have a timer running.')

  const body = await readJson<{ note?: unknown }>(c.req).catch(() => ({ note: undefined }))
  const ended = now()
  const minutes = Math.max(1, minutesBetween(running.started_at, ended))

  await c.env.DB
    .prepare(`update time_entry set ended_at = ?, minutes = ?, note = ? where id = ?`)
    .bind(ended, minutes, optionalText(body.note, 'The note', LIMITS.shortText) || running.note, running.id)
    .run()

  const row = await c.env.DB.prepare(`${TIME_SELECT} where t.id = ?`).bind(running.id).first<TimeRow>()
  return c.json(timeDto(row!))
})

/** Time entered by hand, for work done away from the screen. */
team.post('/time/log', async (c) => {
  const principal = c.get('principal')
  const body = await readJson<{
    clientId?: unknown; itemId?: unknown; minutes?: unknown
    note?: unknown; billable?: unknown; startedAt?: unknown
  }>(c.req)

  if (body.minutes === undefined || Number(body.minutes) <= 0) {
    throw HttpError.badRequest('Enter how many minutes to log.')
  }
  if (Number(body.minutes) > 24 * 60) {
    throw HttpError.badRequest('That is more than a day. Split it across entries.')
  }
  const minutes = integer(body.minutes, 'Minutes', 1, 24 * 60)
  const itemId = optionalText(body.itemId, 'Item', 64) || null
  const note = optionalText(body.note, 'The note', LIMITS.shortText)

  let boardId: string | null = null
  let clientId = await clientForTime(c.env, principal.organisationId, body.clientId)
  if (itemId) {
    const item = await itemForTime(c.env, principal, itemId)
    boardId = item.board_id
    clientId = clientId ?? item.client_id
  }

  // An unparseable date used to reach `new Date(NaN).toISOString()` and throw
  // a 500; a wild one silently skewed every report that windows on time.
  const startedAt =
    isoTimestamp(body.startedAt, 'The start time') ??
    new Date(Date.now() - minutes * 60000).toISOString()
  const id = newId()

  await c.env.DB
    .prepare(
      `insert into time_entry (id, user_id, client_id, item_id, board_id, started_at, ended_at,
                               minutes, note, billable, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, principal.userId, clientId, itemId, boardId, startedAt,
      new Date(Date.parse(startedAt) + minutes * 60000).toISOString(), minutes,
      note || null, body.billable === false ? 0 : 1, now())
    .run()

  const row = await c.env.DB.prepare(`${TIME_SELECT} where t.id = ?`).bind(id).first<TimeRow>()
  return c.json(timeDto(row!))
})

team.get('/time/mine', async (c) => {
  const principal = c.get('principal')
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500)
  const rows = await c.env.DB
    .prepare(`${TIME_SELECT} where t.user_id = ? order by t.started_at desc limit ?`)
    .bind(principal.userId, limit).all<TimeRow>()
  return c.json(rows.results.map(timeDto))
})

team.get('/time/summary', async (c) => {
  const principal = c.get('principal')
  if (!isManager(principal)) {
    throw HttpError.forbidden("Only managers and administrators can see the whole team's hours.")
  }
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 30) || 30, 1), 365)
  const from = isoMinus(days)

  const [byClient, byPerson, totals] = await Promise.all([
    c.env.DB.prepare(
      `select t.client_id, coalesce(cl.name, 'Internal / unassigned') as name,
              coalesce(cl.colour, 'grey') as colour, sum(t.minutes) as total
         from time_entry t
         join app_user u on u.id = t.user_id
         left join client cl on cl.id = t.client_id
        where t.ended_at is not null and t.started_at >= ? and u.organisation_id = ?
        group by t.client_id order by total desc`,
    ).bind(from, principal.organisationId)
     .all<{ client_id: string | null; name: string; colour: string; total: number }>(),

    c.env.DB.prepare(
      `select t.user_id, u.full_name, sum(t.minutes) as total
         from time_entry t join app_user u on u.id = t.user_id
        where t.ended_at is not null and t.started_at >= ? and u.organisation_id = ?
        group by t.user_id order by total desc`,
    ).bind(from, principal.organisationId).all<{ user_id: string; full_name: string; total: number }>(),

    c.env.DB.prepare(
      `select sum(t.minutes) as total,
              sum(case when t.billable = 1 then t.minutes else 0 end) as billable
         from time_entry t join app_user u on u.id = t.user_id
        where t.ended_at is not null and t.started_at >= ? and u.organisation_id = ?`,
    ).bind(from, principal.organisationId).first<{ total: number | null; billable: number | null }>(),
  ])

  return c.json({
    from,
    to: now(),
    totalMinutes: totals?.total ?? 0,
    billableMinutes: totals?.billable ?? 0,
    byClient: byClient.results.map((r) => ({
      clientId: r.client_id ?? undefined, clientName: r.name, colour: r.colour, minutes: r.total,
    })),
    byPerson: byPerson.results.map((r) => ({
      userId: r.user_id, fullName: r.full_name, minutes: r.total,
    })),
  })
})
