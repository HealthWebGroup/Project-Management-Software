import { Hono } from 'hono'
import { isManager } from '../access'
import { isoMinus, newId, now, recordActivity } from '../db'
import { HttpError } from '../errors'
import { LIMITS, email, httpUrl, isoDate, list, oneOf, optionalText, readJson, text } from '../validate'
import { boardStatements } from './boards'
import type { ClientRole, ClientStatus, Env, Role, Vars } from '../types'

export const clients = new Hono<{ Bindings: Env; Variables: Vars }>()

interface ClientRow {
  id: string
  name: string
  code: string
  status: ClientStatus
  colour: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  website: string | null
  address: string | null
  notes: string | null
  started_on: string | null
}

const STATUSES: ClientStatus[] = ['PROSPECT', 'ACTIVE', 'PAUSED', 'ARCHIVED']

clients.get('/clients', async (c) => {
  const principal = c.get('principal')

  const [rows, team, counts, minutes] = await Promise.all([
    c.env.DB.prepare(
      `select id, name, code, status, colour, contact_name, contact_email, contact_phone,
              website, address, notes, started_on
         from client where organisation_id = ? order by name`,
    ).bind(principal.organisationId).all<ClientRow>(),

    c.env.DB.prepare(
      `select m.client_id, m.user_id, m.role_on_client, u.full_name, u.job_title
         from client_member m
         join app_user u on u.id = m.user_id
         join client c on c.id = m.client_id
        where c.organisation_id = ?`,
    ).bind(principal.organisationId).all<{
      client_id: string; user_id: string; role_on_client: ClientRole
      full_name: string; job_title: string | null
    }>(),

    c.env.DB.prepare(
      `select client_id, count(*) as n from item
        where archived = 0 and client_id is not null group by client_id`,
    ).all<{ client_id: string; n: number }>(),

    c.env.DB.prepare(
      `select client_id, sum(minutes) as total from time_entry
        where ended_at is not null and started_at >= ? and client_id is not null
        group by client_id`,
    ).bind(isoMinus(30)).all<{ client_id: string; total: number | null }>(),
  ])

  const countBy = new Map(counts.results.map((r) => [r.client_id, r.n]))
  const minutesBy = new Map(minutes.results.map((r) => [r.client_id, r.total ?? 0]))

  // The same scoping every other screen applies. Without it this route hands
  // a member the whole client book - names, contacts, commercial notes and
  // hours for clients they cannot open a single board of. It is the leak the
  // dashboard's hours-by-client had, with more fields attached.
  const seesEveryClient = isManager(principal)
  const allowed = new Set(principal.clientIds)
  const visible = seesEveryClient
    ? rows.results
    : rows.results.filter((row) => allowed.has(row.id))

  return c.json(
    visible.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      status: row.status,
      colour: row.colour,
      contactName: row.contact_name ?? undefined,
      contactEmail: row.contact_email ?? undefined,
      contactPhone: row.contact_phone ?? undefined,
      website: row.website ?? undefined,
      address: row.address ?? undefined,
      notes: row.notes ?? undefined,
      startedOn: row.started_on ?? undefined,
      // The named point of contact reads first, then everyone else by name.
      team: team.results
        .filter((m) => m.client_id === row.id)
        .sort((a, b) =>
          a.role_on_client !== b.role_on_client
            ? a.role_on_client === 'LEAD' ? -1 : 1
            : a.full_name.localeCompare(b.full_name),
        )
        .map((m) => ({
          userId: m.user_id,
          fullName: m.full_name,
          jobTitle: m.job_title ?? undefined,
          roleOnClient: m.role_on_client,
        })),
      openItems: countBy.get(row.id) ?? 0,
      minutesThisMonth: minutesBy.get(row.id) ?? 0,
    })),
  )
})

clients.post('/clients', async (c) => {
  const principal = c.get('principal')
  if (!isManager(principal)) {
    throw HttpError.forbidden('Only managers and administrators can add clients.')
  }

  const body = await readJson<Record<string, unknown>>(c.req)
  const name = text(body.name, 'The client name')
  const code = text(body.code, 'The client code', 12).toUpperCase()
  const contactEmail = body.contactEmail ? email(body.contactEmail, 'The contact email') : undefined
  const website = httpUrl(body.website, 'The website')
  const notes = optionalText(body.notes, 'Notes', LIMITS.longText)
  const address = optionalText(body.address, 'The address', LIMITS.shortText)
  const contactName = optionalText(body.contactName, 'The contact name')
  const contactPhone = optionalText(body.contactPhone, 'The phone number', 40)
  const colour = optionalText(body.colour, 'Colour', LIMITS.colour) || 'blue'
  const startedOn = isoDate(body.startedOn, 'The start date')

  const clash = await c.env.DB
    .prepare(`select id from client where organisation_id = ? and upper(code) = ?`)
    .bind(principal.organisationId, code).first<{ id: string }>()
  if (clash) throw HttpError.badRequest(`Another client already uses the code ${code}.`)

  const status = body.status ? oneOf(body.status, STATUSES, 'Status') : 'ACTIVE'

  const id = newId()
  await c.env.DB
    .prepare(
      `insert into client (id, organisation_id, name, code, status, colour, contact_name,
                           contact_email, contact_phone, website, address, notes, started_on, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, principal.organisationId, name, code, status, colour,
      contactName || null, contactEmail || null, contactPhone || null,
      website || null, address || null, notes || null, startedOn || null, now(),
    )
    .run()

  // ------------------------------------------------------------------
  // Give the client somewhere to put work.
  //
  // A client row on its own is an address book entry. Until this was here,
  // adding a client produced exactly that: the client appeared in the
  // switcher and on the clients page, and then there was no board, so no
  // kanban, no timeline and nowhere to type a task. The software looked
  // broken at the first thing anybody does with it.
  //
  // So a new client gets a board, from the PROJECTS template, in the
  // workspace that holds client work. It can be renamed, added to, or
  // deleted - but it is never nothing.
  // ------------------------------------------------------------------
  let firstBoardId: string | undefined
  try {
    // The workspace that client work lives in. Preferring one whose board
    // rows already carry a client beats matching on the name, which a team
    // is free to change; the name is only the tie-breaker.
    const workspace = await c.env.DB
      .prepare(
        `select w.id
           from workspace w
           left join board b on b.workspace_id = w.id and b.client_id is not null
          where w.organisation_id = ?
          group by w.id
          order by count(b.id) desc, w.sort_order, w.name
          limit 1`,
      )
      .bind(principal.organisationId)
      .first<{ id: string }>()

    if (workspace) {
      firstBoardId = newId()
      await c.env.DB.batch(
        boardStatements(c.env.DB, {
          boardId: firstBoardId,
          workspaceId: workspace.id,
          clientId: id,
          name: `${name} — projects`,
          description: `Work for ${name}. Rename or delete this board, or add more.`,
          template: 'PROJECTS',
          createdBy: principal.userId,
        }),
      )
    }
  } catch {
    // The client is already saved and is the thing that was asked for. If
    // the starter board fails, the client must not fail with it - they can
    // add a board by hand, and a client that vanished because of a board
    // would be far worse than a client with no board.
    firstBoardId = undefined
  }

  await recordActivity(c.env.DB, {
    entityType: 'CLIENT', entityId: id, actorId: principal.userId, action: 'CREATED', detail: name,
  })

  return c.json({
    id, name, code, status, colour, firstBoardId,
    contactName: contactName || undefined,
    contactEmail: contactEmail || undefined,
    contactPhone: contactPhone || undefined,
    website: body.website || undefined,
    address: body.address || undefined,
    notes: body.notes || undefined,
    startedOn: body.startedOn || undefined,
    team: [], openItems: 0, minutesThisMonth: 0,
  })
})

clients.patch('/clients/:clientId', async (c) => {
  const principal = c.get('principal')
  if (!isManager(principal)) {
    throw HttpError.forbidden('Only managers and administrators can edit clients.')
  }

  const existing = await c.env.DB
    .prepare(
      `select id, organisation_id, name, code, status, colour, contact_name, contact_email,
              contact_phone, website, address, notes, started_on
         from client where id = ?`,
    )
    .bind(c.req.param('clientId'))
    .first<ClientRow & { organisation_id: string }>()
  if (!existing || existing.organisation_id !== principal.organisationId) {
    throw HttpError.notFound('Client')
  }

  const body = await readJson<Record<string, unknown>>(c.req)
  const code = optionalText(body.code, 'The client code', 12)?.toUpperCase()
  if (code && code !== existing.code.toUpperCase()) {
    const clash = await c.env.DB
      .prepare(`select id from client where organisation_id = ? and upper(code) = ? and id <> ?`)
      .bind(principal.organisationId, code, existing.id).first<{ id: string }>()
    if (clash) throw HttpError.badRequest(`Another client already uses the code ${code}.`)
  }

  await c.env.DB
    .prepare(
      `update client set name = ?, code = ?, status = ?, colour = ?, contact_name = ?,
              contact_email = ?, contact_phone = ?, website = ?, address = ?, notes = ?, started_on = ?
        where id = ?`,
    )
    .bind(
      optionalText(body.name, 'The client name') || existing.name,
      code || existing.code,
      body.status ? oneOf(body.status, STATUSES, 'Status') : existing.status,
      optionalText(body.colour, 'Colour', LIMITS.colour) || existing.colour,
      optionalText(body.contactName, 'The contact name') ?? existing.contact_name,
      body.contactEmail === undefined
        ? existing.contact_email
        : body.contactEmail ? email(body.contactEmail, 'The contact email') : null,
      optionalText(body.contactPhone, 'The phone number', 40) ?? existing.contact_phone,
      body.website === undefined ? existing.website : httpUrl(body.website, 'The website') ?? null,
      optionalText(body.address, 'The address', LIMITS.shortText) ?? existing.address,
      optionalText(body.notes, 'Notes', LIMITS.longText) ?? existing.notes,
      body.startedOn === undefined ? existing.started_on : isoDate(body.startedOn, 'The start date') ?? null,
      existing.id,
    )
    .run()

  await recordActivity(c.env.DB, {
    entityType: 'CLIENT', entityId: existing.id, actorId: principal.userId,
    action: 'UPDATED', detail: optionalText(body.name, 'The client name') || existing.name,
  })
  return c.body(null, 204)
})

/** Replaces the whole team for a client - the screen sends the full list. */
/**
 * Who can actually see this client, and why.
 *
 * Computed on the server on purpose. The rule lives in two places in the
 * code — `clientIdsFor` in auth.ts decides what goes in a principal's
 * client list, and `accessTo` in access.ts checks a board against it — and
 * a third copy written in the interface would be free to drift from both.
 * When the drifting copy is the one a person reads before deciding whether
 * a client's commercial notes are safe, that is not a cosmetic bug.
 *
 * So this mirrors those two functions and nothing else:
 *
 *   ADMIN or MANAGER  -> sees every client, whatever the team list says
 *   GUEST             -> never, not even on the team; a guest reaches a
 *                        board only by being named on that one board
 *   anyone else       -> sees it only if they are on the team
 *
 * That guest line was wrong in the first draft of this route, which said a
 * guest on the team could see the client. `accessTo` returns NONE for a
 * guest on an INTERNAL board no matter what client they are assigned to, so
 * the screen would have promised access the application then refuses. The
 * cross-check in visibility.test.ts is what found it.
 *
 * What it deliberately does NOT try to answer: someone can also be named
 * on a single board through Board access, which grants that one board
 * without granting the client. The interface says so rather than this
 * route guessing at it.
 */
clients.get('/clients/:clientId/visibility', async (c) => {
  const principal = c.get('principal')

  const client = await c.env.DB
    .prepare(`select id, organisation_id, name from client where id = ? and organisation_id = ?`)
    .bind(c.req.param('clientId'), principal.organisationId)
    .first<{ id: string; name: string }>()
  if (!client) throw HttpError.notFound('Client')

  // You may only ask who can see a client you can see yourself. Otherwise
  // this route hands a member the name of every client in the book, plus a
  // map of who works on what - which is most of what the scoping on
  // GET /clients exists to withhold. "Not found" rather than "forbidden",
  // so it does not confirm the client exists either.
  if (!isManager(principal) && !principal.clientIds.includes(client.id)) {
    throw HttpError.notFound('Client')
  }

  const [people, team] = await Promise.all([
    c.env.DB.prepare(
      `select id, full_name, job_title, role from app_user
        where organisation_id = ? and status = 'ACTIVE' order by full_name`,
    ).bind(principal.organisationId).all<{
      id: string; full_name: string; job_title: string | null; role: Role
    }>(),

    c.env.DB.prepare(
      `select user_id, role_on_client from client_member where client_id = ?`,
    ).bind(client.id).all<{ user_id: string; role_on_client: ClientRole }>(),
  ])

  const onTeam = new Map(team.results.map((t) => [t.user_id, t.role_on_client]))

  const rows = people.results.map((u) => {
    const byRole = u.role === 'ADMIN' || u.role === 'MANAGER'
    const assigned = onTeam.get(u.id)
    // A guest is not granted anything by being on the team. Keeping this
    // one line honest is the whole point of the screen.
    const canSee = byRole || (u.role !== 'GUEST' && assigned !== undefined)
    return {
      userId: u.id,
      fullName: u.full_name,
      jobTitle: u.job_title ?? undefined,
      role: u.role,
      onTeam: assigned !== undefined,
      leadOnClient: assigned === 'LEAD',
      canSee,
      /**
       * What the team list can and cannot do for this person.
       *
       * The team dialog has to show the effect of a tick BEFORE it is saved,
       * and the only honest way to do that without copying the role rules
       * into the browser is to send the rules' conclusion as data. So:
       *
       *   always        - by role; ticking or unticking changes nothing
       *   when-assigned - the tick is exactly what decides it
       *   never         - a guest; only an individual board can let them in
       *
       * The interface then computes nothing but
       * `always || (when-assigned && ticked)`, which cannot drift from the
       * roles because it does not know them.
       */
      access: byRole ? 'always' : u.role === 'GUEST' ? 'never' : 'when-assigned',
      // Why, in the order that actually decides it: a manager on the team
      // still sees it because of the role, and saying "assigned" there
      // would imply that removing them from the team would take it away.
      reason: byRole
        ? (u.role === 'ADMIN' ? 'administrator' : 'manager')
        : u.role === 'GUEST' ? 'guest'
        : assigned !== undefined ? 'assigned'
        : 'none',
    }
  })

  return c.json({
    clientName: client.name,
    people: rows,
  })
})

clients.put('/clients/:clientId/team', async (c) => {
  const principal = c.get('principal')
  if (!isManager(principal)) {
    throw HttpError.forbidden('Only managers and administrators can change who works with a client.')
  }

  const client = await c.env.DB
    .prepare(`select id, organisation_id, name from client where id = ?`)
    .bind(c.req.param('clientId'))
    .first<{ id: string; organisation_id: string; name: string }>()
  if (!client || client.organisation_id !== principal.organisationId) throw HttpError.notFound('Client')

  const body = await readJson<{ members?: unknown }>(c.req)
  const members = list<{ userId: string; roleOnClient?: ClientRole }>(body.members, 'The team')

  if (members.filter((m) => m.roleOnClient === 'LEAD').length > 1) {
    throw HttpError.badRequest('A client can have only one lead.')
  }

  // Delete then insert in one batch, so the pair is atomic and ordered.
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`delete from client_member where client_id = ?`).bind(client.id),
  ]
  for (const member of members) {
    statements.push(
      c.env.DB.prepare(
        `insert into client_member (client_id, user_id, role_on_client, assigned_at)
         select ?, id, ?, ? from app_user where id = ? and organisation_id = ?`,
      ).bind(client.id, member.roleOnClient ?? 'MEMBER', now(), member.userId, principal.organisationId),
    )
  }
  await c.env.DB.batch(statements)

  await recordActivity(c.env.DB, {
    entityType: 'CLIENT', entityId: client.id, actorId: principal.userId,
    action: 'TEAM_CHANGED', detail: `${members.length} people on ${client.name}`,
  })
  return c.body(null, 204)
})
