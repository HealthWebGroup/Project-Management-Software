import { Hono } from 'hono'
import { Access, accessTo, canAdminister, isAdmin } from '../access'
import { newId, now, recordActivity } from '../db'
import { HttpError } from '../errors'
import { email as emailField, list, oneOf, optionalText, readJson, text } from '../validate'
import type { BoardPermission, ClientRole, Env, Role, Sensitivity, UserStatus, Vars } from '../types'

/**
 * People and access.
 *
 * Two levers, deliberately:
 *
 *   Role      what someone can do in general
 *   Clients   which work they can see at all
 *
 * A MEMBER assigned to two clients sees those two clients' boards and the
 * internal ones, and nothing else. Board-level overrides exist for the
 * exceptions - one contractor on one board, or a restricted board that only
 * three named people should open.
 */
export const people = new Hono<{ Bindings: Env; Variables: Vars }>()

const ROLES: Role[] = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER', 'GUEST']
const STATUSES: UserStatus[] = ['ACTIVE', 'SUSPENDED', 'LEAVER']

interface PersonRow {
  id: string
  email: string
  full_name: string
  job_title: string | null
  role: Role
  status: UserStatus
  last_login_at: string | null
}

people.get('/people', async (c) => {
  const principal = c.get('principal')
  // Administrators only, deliberately. A manager has every power needed to
  // do the work - clients, projects, tasks, rules - and none over who may
  // see what. Keeping those two apart is the whole point of the split: the
  // people who run the work should not be able to widen their own view of
  // it, or anyone else's, without the owner deciding.
  if (!isAdmin(principal)) {
    throw HttpError.forbidden('Only an administrator can change who sees what.')
  }

  const [rows, assignments, overrides] = await Promise.all([
    c.env.DB.prepare(
      `select id, email, full_name, job_title, role, status, last_login_at
         from app_user where organisation_id = ? order by full_name`,
    ).bind(principal.organisationId).all<PersonRow>(),

    c.env.DB.prepare(
      `select m.user_id, m.client_id, m.role_on_client, cl.name, cl.code, cl.colour
         from client_member m
         join client cl on cl.id = m.client_id
        where cl.organisation_id = ?`,
    ).bind(principal.organisationId).all<{
      user_id: string; client_id: string; role_on_client: ClientRole
      name: string; code: string; colour: string
    }>(),

    c.env.DB.prepare(
      `select bm.user_id, bm.board_id, bm.permission, b.name
         from board_member bm
         join board b on b.id = bm.board_id
         join workspace w on w.id = b.workspace_id
        where w.organisation_id = ?`,
    ).bind(principal.organisationId).all<{
      user_id: string; board_id: string; permission: BoardPermission; name: string
    }>(),
  ])

  return c.json(
    rows.results.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      jobTitle: row.job_title ?? undefined,
      role: row.role,
      status: row.status,
      lastLoginAt: row.last_login_at ?? undefined,
      /** Admins and managers reach every client whether assigned or not. */
      seesEveryClient: row.role === 'ADMIN' || row.role === 'MANAGER',
      clients: assignments.results
        .filter((a) => a.user_id === row.id)
        .map((a) => ({
          clientId: a.client_id, name: a.name, code: a.code,
          colour: a.colour, roleOnClient: a.role_on_client,
        })),
      boardOverrides: overrides.results
        .filter((o) => o.user_id === row.id)
        .map((o) => ({ boardId: o.board_id, boardName: o.name, permission: o.permission })),
    })),
  )
})

/**
 * Add someone before they have ever signed in.
 *
 * Worth being clear about what this does and does not do: it creates the
 * account with the role and clients you choose, so that when they first sign
 * in they land with the right access instead of as a blank member. It does
 * NOT let them in - Cloudflare Access decides that, and they must also be
 * covered by the Access policy. The interface says so on the form.
 */
people.post('/people', async (c) => {
  const principal = c.get('principal')
  if (!isAdmin(principal)) {
    throw HttpError.forbidden('Only an administrator can add people.')
  }

  const body = await readJson<{
    email?: unknown; fullName?: unknown; jobTitle?: unknown
    role?: unknown; clients?: unknown
  }>(c.req)

  const email = emailField(body.email)
  const fullName = text(body.fullName, 'Their name')
  const jobTitle = optionalText(body.jobTitle, 'Their job title')
  const assignments = list<{ clientId: string; roleOnClient?: ClientRole }>(
    body.clients, 'The client list',
  )

  const role = body.role ? oneOf(body.role, ROLES, 'Role') : 'MEMBER'
  // A manager can add colleagues, but cannot mint someone with power over them.
  if ((role === 'ADMIN' || role === 'MANAGER') && !isAdmin(principal)) {
    throw HttpError.forbidden('Only an administrator can add an administrator or a manager.')
  }

  const clash = await c.env.DB
    .prepare(`select id, full_name, status from app_user where lower(email) = ?`)
    .bind(email)
    .first<{ id: string; full_name: string; status: UserStatus }>()
  if (clash) {
    throw HttpError.badRequest(
      clash.status === 'ACTIVE'
        ? `${clash.full_name} already uses that email address.`
        : `${clash.full_name} already uses that address, but their account is ${clash.status.toLowerCase()}. Reactivate them instead of adding a duplicate.`,
    )
  }

  const id = newId()
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `insert into app_user (id, organisation_id, email, full_name, job_title, role, status, created_at)
       values (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
    ).bind(id, principal.organisationId, email, fullName, jobTitle || null, role, now()),
  ]
  for (const entry of assignments) {
    statements.push(
      c.env.DB.prepare(
        `insert into client_member (client_id, user_id, role_on_client, assigned_at)
         select id, ?, ?, ? from client where id = ? and organisation_id = ?`,
      ).bind(id, entry.roleOnClient ?? 'MEMBER', now(), entry.clientId, principal.organisationId),
    )
  }
  await c.env.DB.batch(statements)

  await recordActivity(c.env.DB, {
    entityType: 'USER', entityId: id, actorId: principal.userId, action: 'USER_ADDED',
    detail: `${fullName} (${email}) as ${role}`,
  })

  return c.json({
    id, email, fullName, jobTitle: jobTitle || undefined,
    role, status: 'ACTIVE' as UserStatus,
    seesEveryClient: role === 'ADMIN' || role === 'MANAGER',
    clients: [], boardOverrides: [],
  })
})

people.patch('/people/:userId', async (c) => {
  const principal = c.get('principal')
  if (!isAdmin(principal)) {
    throw HttpError.forbidden('Only an administrator can change people.')
  }

  const target = await load(c.env, c.req.param('userId'), principal.organisationId)
  const body = await readJson<{
    role?: unknown; status?: unknown; jobTitle?: unknown
    fullName?: unknown; email?: unknown
  }>(c.req)

  const wantedRole = body.role === undefined ? undefined : oneOf(body.role, ROLES, 'Role')
  const wantedStatus = body.status === undefined ? undefined : oneOf(body.status, STATUSES, 'Status')

  // Only an administrator can hand out administrator.
  if (wantedRole && wantedRole !== target.role) {
    if (!isAdmin(principal)) {
      throw HttpError.forbidden('Only an administrator can change someone’s role.')
    }
    if (target.id === principal.userId && wantedRole !== 'ADMIN') {
      // Otherwise the last admin can lock everyone out, including themselves.
      throw HttpError.badRequest('You cannot remove your own administrator role.')
    }
    if (target.role === 'ADMIN' && wantedRole !== 'ADMIN' && (await adminCount(c.env, principal.organisationId)) <= 1) {
      throw HttpError.badRequest('That is the only administrator. Promote someone else first.')
    }
  }

  if (wantedStatus && wantedStatus !== 'ACTIVE' && target.id === principal.userId) {
    throw HttpError.badRequest('You cannot suspend your own account.')
  }
  if (wantedStatus && wantedStatus !== 'ACTIVE' && target.role === 'ADMIN'
      && (await adminCount(c.env, principal.organisationId)) <= 1) {
    throw HttpError.badRequest('That is the only active administrator. Promote someone else first.')
  }

  // The email is the identity Cloudflare Access matches on, so changing it
  // changes who can sign in as this person. Administrators only.
  let email = target.email
  if (body.email !== undefined && emailField(body.email) !== target.email.toLowerCase()) {
    if (!isAdmin(principal)) {
      throw HttpError.forbidden('Only an administrator can change someone’s email address.')
    }
    email = emailField(body.email)
    const clash = await c.env.DB
      .prepare(`select id from app_user where lower(email) = ? and id <> ?`)
      .bind(email, target.id).first<{ id: string }>()
    if (clash) throw HttpError.badRequest('Someone else already uses that email address.')
  }

  const fullName = optionalText(body.fullName, 'Their name') || target.full_name
  const jobTitle = optionalText(body.jobTitle, 'Their job title')

  await c.env.DB
    .prepare(
      `update app_user set role = ?, status = ?, job_title = ?, full_name = ?, email = ?
        where id = ?`,
    )
    .bind(wantedRole ?? target.role, wantedStatus ?? target.status,
      body.jobTitle === undefined ? target.job_title : jobTitle || null,
      fullName, email, target.id)
    .run()

  await recordActivity(c.env.DB, {
    entityType: 'USER', entityId: target.id, actorId: principal.userId, action: 'ACCESS_CHANGED',
    detail: `${target.full_name}: ${wantedRole ?? target.role}${wantedStatus && wantedStatus !== target.status ? `, ${wantedStatus}` : ''}`,
    before: { role: target.role, status: target.status },
    after: { role: wantedRole ?? target.role, status: wantedStatus ?? target.status },
  })

  return c.body(null, 204)
})

/** Replaces the whole set of clients this person can see. */
people.put('/people/:userId/clients', async (c) => {
  const principal = c.get('principal')
  if (!isAdmin(principal)) {
    throw HttpError.forbidden('Only an administrator can change who sees which client.')
  }

  const target = await load(c.env, c.req.param('userId'), principal.organisationId)
  const body = await readJson<{ clients?: unknown }>(c.req)
  const wanted = list<{ clientId: string; roleOnClient?: ClientRole }>(body.clients, 'The client list')

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`delete from client_member where user_id = ?`).bind(target.id),
  ]
  for (const entry of wanted) {
    statements.push(
      c.env.DB.prepare(
        `insert into client_member (client_id, user_id, role_on_client, assigned_at)
         select id, ?, ?, ? from client where id = ? and organisation_id = ?`,
      ).bind(target.id, entry.roleOnClient ?? 'MEMBER', now(), entry.clientId, principal.organisationId),
    )
  }
  await c.env.DB.batch(statements)

  await recordActivity(c.env.DB, {
    entityType: 'USER', entityId: target.id, actorId: principal.userId, action: 'CLIENTS_CHANGED',
    detail: `${target.full_name} now sees ${wanted.length} client${wanted.length === 1 ? '' : 's'}`,
  })

  return c.body(null, 204)
})

/**
 * Remove an account outright. Refused once they have done anything, because
 * deleting them would take their work, their logged time and their part of
 * the audit trail with it. Mark them as a leaver instead - that stops the
 * sign-in and keeps the history.
 */
people.delete('/people/:userId', async (c) => {
  const principal = c.get('principal')
  if (!isAdmin(principal)) {
    throw HttpError.forbidden('Only an administrator can delete an account.')
  }

  const target = await load(c.env, c.req.param('userId'), principal.organisationId)
  if (target.id === principal.userId) {
    throw HttpError.badRequest('You cannot delete your own account.')
  }

  const traces = await c.env.DB
    .prepare(
      `select
         (select count(*) from time_entry where user_id = ?) as time_entries,
         (select count(*) from item_update where author_id = ?) as comments,
         (select count(*) from item where created_by = ?) as items,
         (select count(*) from user_session where user_id = ?) as sessions`,
    )
    .bind(target.id, target.id, target.id, target.id)
    .first<{ time_entries: number; comments: number; items: number; sessions: number }>()

  const total =
    (traces?.time_entries ?? 0) + (traces?.comments ?? 0) +
    (traces?.items ?? 0) + (traces?.sessions ?? 0)

  if (total > 0) {
    throw HttpError.badRequest(
      `${target.full_name} has already worked in here — ${traces?.items ?? 0} items, ` +
      `${traces?.comments ?? 0} updates, ${traces?.time_entries ?? 0} time entries. ` +
      'Deleting the account would take that history with it. Set them to "Left" instead.',
    )
  }

  await c.env.DB.prepare(`delete from app_user where id = ?`).bind(target.id).run()
  await recordActivity(c.env.DB, {
    entityType: 'USER', entityId: target.id, actorId: principal.userId, action: 'USER_DELETED',
    detail: `${target.full_name} (${target.email})`,
  })

  return c.body(null, 204)
})

// ------------------------------------------------------- board overrides

people.get('/boards/:boardId/members', async (c) => {
  const principal = c.get('principal')
  // Check the role first: otherwise the 404-versus-403 difference tells a
  // stranger whether a board id exists in this organisation.
  if (!isAdmin(principal)) {
    throw HttpError.forbidden('Only an administrator can see board access.')
  }
  const board = await boardFor(c.env, c.req.param('boardId'), principal.userId, principal.organisationId)
  if (!canAdminister(accessTo(principal, board, board.permission))) {
    throw HttpError.forbidden('You cannot administer this board.')
  }

  const rows = await c.env.DB
    .prepare(
      `select bm.user_id, bm.permission, u.full_name, u.email
         from board_member bm join app_user u on u.id = bm.user_id
        where bm.board_id = ? order by u.full_name`,
    )
    .bind(board.id)
    .all<{ user_id: string; permission: BoardPermission; full_name: string; email: string }>()

  return c.json({
    boardId: board.id,
    boardName: board.name,
    sensitivity: board.sensitivity,
    members: rows.results.map((r) => ({
      userId: r.user_id, fullName: r.full_name, email: r.email, permission: r.permission,
    })),
  })
})

people.put('/boards/:boardId/members', async (c) => {
  const principal = c.get('principal')
  if (!isAdmin(principal)) {
    throw HttpError.forbidden('Only an administrator can change board access.')
  }
  const board = await boardFor(c.env, c.req.param('boardId'), principal.userId, principal.organisationId)

  // The check that makes RESTRICTED mean something. Without it a manager can
  // name themselves on a board they cannot open, and an explicit board_member
  // row beats sensitivity - so the lock opens from the inside.
  if (!canAdminister(accessTo(principal, board, board.permission))) {
    throw HttpError.forbidden(
      board.sensitivity === 'RESTRICTED'
        ? 'This board is restricted to named people. Only someone already named on it, with administer rights, can change that list.'
        : 'You cannot administer this board.',
    )
  }

  const body = await readJson<{ members?: unknown }>(c.req)
  const wanted = list<{ userId: string; permission?: BoardPermission }>(body.members, 'The member list')
  for (const entry of wanted) {
    if (entry.permission) oneOf(entry.permission, ['VIEW', 'EDIT', 'ADMIN'] as const, 'Permission')
  }

  // Locking yourself out of a restricted board leaves nobody who can undo it.
  if (
    board.sensitivity === 'RESTRICTED' &&
    !wanted.some((m) => m.userId === principal.userId && (m.permission ?? 'EDIT') === 'ADMIN')
  ) {
    throw HttpError.badRequest(
      'Keep yourself on this restricted board with administer rights, or nobody will be able to change it again.',
    )
  }

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`delete from board_member where board_id = ?`).bind(board.id),
  ]
  for (const entry of wanted) {
    statements.push(
      c.env.DB.prepare(
        `insert into board_member (board_id, user_id, permission)
         select ?, id, ? from app_user where id = ? and organisation_id = ?`,
      ).bind(board.id, entry.permission ?? 'EDIT', entry.userId, principal.organisationId),
    )
  }
  await c.env.DB.batch(statements)

  await recordActivity(c.env.DB, {
    entityType: 'BOARD', entityId: board.id, boardId: board.id, actorId: principal.userId,
    action: 'ACCESS_CHANGED', detail: `${wanted.length} named people on ${board.name}`,
  })

  return c.body(null, 204)
})

/** Change how locked down a board is. */
people.patch('/boards/:boardId/sensitivity', async (c) => {
  const principal = c.get('principal')
  if (!isAdmin(principal)) {
    throw HttpError.forbidden('Only an administrator can change how restricted a board is.')
  }
  const board = await boardFor(c.env, c.req.param('boardId'), principal.userId, principal.organisationId)

  const body = await readJson<{ sensitivity?: unknown }>(c.req)
  const allowed = ['INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const
  const sensitivity = oneOf(body.sensitivity, allowed, 'Sensitivity')

  // Making a board restricted with nobody named on it locks everyone out,
  // including the administrator doing it, with no route back in.
  if (sensitivity === 'RESTRICTED') {
    const named = await c.env.DB
      .prepare(`select count(*) as n from board_member where board_id = ?`)
      .bind(board.id).first<{ n: number }>()
    if ((named?.n ?? 0) === 0) {
      throw HttpError.badRequest(
        'Name at least one person on this board before restricting it — otherwise nobody, including you, will be able to open it.',
      )
    }
  }

  await c.env.DB
    .prepare(`update board set sensitivity = ? where id = ?`)
    .bind(sensitivity, board.id).run()

  await recordActivity(c.env.DB, {
    entityType: 'BOARD', entityId: board.id, boardId: board.id, actorId: principal.userId,
    action: 'ACCESS_CHANGED', detail: `${board.name} is now ${sensitivity.toLowerCase()}`,
    before: { sensitivity: board.sensitivity }, after: { sensitivity },
  })

  return c.body(null, 204)
})

/**
 * What would this person actually see? Answering it from the same function
 * the API enforces with means the preview cannot drift from reality.
 */
people.get('/people/:userId/preview', async (c) => {
  const principal = c.get('principal')
  if (!isAdmin(principal)) throw HttpError.forbidden('Only an administrator can do this.')

  const target = await load(c.env, c.req.param('userId'), principal.organisationId)

  const [clientRows, boardRows] = await Promise.all([
    c.env.DB.prepare(`select client_id from client_member where user_id = ?`)
      .bind(target.id).all<{ client_id: string }>(),
    c.env.DB.prepare(
      `select b.id, b.name, b.client_id, b.sensitivity, cl.name as client_name,
              bm.permission as permission
         from board b
         join workspace w on w.id = b.workspace_id
         left join client cl on cl.id = b.client_id
         left join board_member bm on bm.board_id = b.id and bm.user_id = ?
        where w.organisation_id = ? order by b.sort_order, b.name`,
    ).bind(target.id, principal.organisationId).all<{
      id: string; name: string; client_id: string | null; sensitivity: Sensitivity
      client_name: string | null; permission: BoardPermission | null
    }>(),
  ])

  const asPrincipal = {
    userId: target.id,
    organisationId: principal.organisationId,
    email: target.email,
    fullName: target.full_name,
    role: target.role,
    sessionId: null,
    clientIds: clientRows.results.map((r) => r.client_id),
  }

  return c.json({
    userId: target.id,
    fullName: target.full_name,
    role: target.role,
    boards: boardRows.results.map((b) => {
      const level = accessTo(asPrincipal, b, b.permission)
      return {
        boardId: b.id,
        boardName: b.name,
        clientName: b.client_name ?? undefined,
        sensitivity: b.sensitivity,
        access:
          level === Access.NONE ? 'none'
          : level === Access.METADATA ? 'listed only'
          : level === Access.VIEW ? 'can view'
          : level === Access.EDIT ? 'can edit'
          : 'can administer',
        viaOverride: Boolean(b.permission),
      }
    }),
  })
})

// ------------------------------------------------------------- helpers

async function load(env: Env, userId: string, organisationId: string): Promise<PersonRow> {
  const row = await env.DB
    .prepare(
      `select id, email, full_name, job_title, role, status, last_login_at
         from app_user where id = ? and organisation_id = ?`,
    )
    .bind(userId, organisationId)
    .first<PersonRow>()
  if (!row) throw HttpError.notFound('Person')
  return row
}

/**
 * The board, with everything `accessTo` needs to judge it - including the
 * caller's own named permission on it.
 *
 * Being a manager is not enough to administer a board: a RESTRICTED board is
 * named people only, and that has to hold when the thing being changed is the
 * list of named people itself. Otherwise "restricted" means "restricted until
 * a manager adds themselves", which is not a control at all.
 */
async function boardFor(env: Env, boardId: string, userId: string, organisationId: string) {
  const row = await env.DB
    .prepare(
      `select b.id, b.name, b.sensitivity, b.client_id, m.permission as permission
         from board b
         join workspace w on w.id = b.workspace_id
         left join board_member m on m.board_id = b.id and m.user_id = ?
        where b.id = ? and w.organisation_id = ?`,
    )
    .bind(userId, boardId, organisationId)
    .first<{
      id: string; name: string; sensitivity: Sensitivity
      client_id: string | null; permission: BoardPermission | null
    }>()
  if (!row) throw HttpError.notFound('Board')
  return row
}

async function adminCount(env: Env, organisationId: string): Promise<number> {
  const row = await env.DB
    .prepare(`select count(*) as n from app_user
               where organisation_id = ? and role = 'ADMIN' and status = 'ACTIVE'`)
    .bind(organisationId)
    .first<{ n: number }>()
  return row?.n ?? 0
}
