import { Hono } from 'hono'
import { accessTo, canOpen } from '../access'
import { newId, now, placeholders } from '../db'
import { emailEnabled } from '../email'
import { HttpError } from '../errors'
import { LIMITS, readJson, stringList } from '../validate'
import type { BoardPermission, Env, Role, Sensitivity, Vars } from '../types'

/**
 * Notifications.
 *
 * Yours and only yours: every query here is filtered by the caller's own id,
 * and there is no route that reads somebody else's list - not for a manager,
 * not for an administrator. The same rule the private to-do list follows.
 *
 * In-app is the record. Email, if it is switched on at all, is a copy sent
 * afterwards; nothing here depends on it working.
 */
export const notifications = new Hono<{ Bindings: Env; Variables: Vars }>()

interface Row {
  id: string
  kind: string
  title: string
  body: string | null
  board_id: string | null
  item_id: string | null
  created_at: string
  read_at: string | null
  board_name: string | null
}

notifications.get('/notifications', async (c) => {
  const principal = c.get('principal')
  const unreadOnly = c.req.query('unread') === 'true'

  const rows = await c.env.DB
    .prepare(
      `select n.id, n.kind, n.title, n.body, n.board_id, n.item_id, n.created_at, n.read_at,
              b.name as board_name
         from notification n
         left join board b on b.id = n.board_id
        where n.user_id = ? ${unreadOnly ? 'and n.read_at is null' : ''}
        order by n.created_at desc
        limit 50`,
    )
    .bind(principal.userId)
    .all<Row>()

  const unread = await c.env.DB
    .prepare(`select count(*) as n from notification where user_id = ? and read_at is null`)
    .bind(principal.userId)
    .first<{ n: number }>()

  return c.json({
    unread: unread?.n ?? 0,
    notifications: rows.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body ?? undefined,
      boardId: row.board_id ?? undefined,
      boardName: row.board_name ?? undefined,
      itemId: row.item_id ?? undefined,
      createdAt: row.created_at,
      read: row.read_at !== null,
    })),
  })
})

/** Whether the optional email copy is switched on, so the interface can say
 *  so honestly instead of implying an email is coming that never will. */
notifications.get('/notifications/settings', async (c) => {
  return c.json({ emailEnabled: emailEnabled(c.env) })
})

notifications.post('/notifications/read', async (c) => {
  const principal = c.get('principal')
  const body = await readJson<{ ids?: unknown }>(c.req).catch(() => ({ ids: undefined }))
  // Checked for shape and capped: `{"ids":"abc"}` used to reach .map on a
  // string and become a 500, and an unbounded list blows SQLite's parameter
  // limit. An empty list still means "mark everything".
  const ids = stringList(body.ids, 'Notification ids', LIMITS.list)

  if (ids.length > 0) {
    const marks = ids.map(() => '?').join(', ')
    await c.env.DB
      .prepare(
        `update notification set read_at = ?
          where user_id = ? and read_at is null and id in (${marks})`,
      )
      .bind(now(), principal.userId, ...ids)
      .run()
  } else {
    await c.env.DB
      .prepare(`update notification set read_at = ? where user_id = ? and read_at is null`)
      .bind(now(), principal.userId)
      .run()
  }

  return c.body(null, 204)
})

notifications.delete('/notifications/:id', async (c) => {
  const principal = c.get('principal')
  const result = await c.env.DB
    .prepare(`delete from notification where id = ? and user_id = ?`)
    .bind(c.req.param('id'), principal.userId)
    .run()
  // Scoped by user_id, so someone else's notification is simply not found
  // rather than being deleted or acknowledged as existing.
  if (result.meta.changes === 0) throw HttpError.notFound('Notification')
  return c.body(null, 204)
})

/**
 * Which of these people could actually open that board?
 *
 * Asked of `accessTo` - the same function every route enforces with - rather
 * than re-stating the rule in SQL, because a second copy of an access rule is
 * a second copy that can drift. Three queries, and only when a notification
 * names a board.
 */
async function whoCanSee(env: Env, boardId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []

  const marks = placeholders(userIds.length)
  const [board, users, clients, named] = await Promise.all([
    // The board's organisation comes back with it, so recipients can be
    // matched against it below. `accessTo` does not look at organisation -
    // it never has to, because every route reaches it through a board that
    // was already org-checked - so that comparison has to happen here.
    env.DB.prepare(
      `select b.id, b.client_id, b.sensitivity, w.organisation_id
         from board b join workspace w on w.id = b.workspace_id
        where b.id = ?`,
    ).bind(boardId).first<{
      id: string; client_id: string | null; sensitivity: Sensitivity; organisation_id: string
    }>(),
    env.DB.prepare(`select id, role, organisation_id from app_user where id in (${marks}) and status = 'ACTIVE'`)
      .bind(...userIds).all<{ id: string; role: Role; organisation_id: string }>(),
    env.DB.prepare(`select user_id, client_id from client_member where user_id in (${marks})`)
      .bind(...userIds).all<{ user_id: string; client_id: string }>(),
    env.DB.prepare(`select user_id, permission from board_member where board_id = ? and user_id in (${marks})`)
      .bind(boardId, ...userIds).all<{ user_id: string; permission: BoardPermission }>(),
  ])
  if (!board) return []

  const permissionOf = new Map(named.results.map((r) => [r.user_id, r.permission]))

  return users.results
    // Somebody else's company never hears about this board, whatever their
    // role happens to be called over there.
    .filter((user) => user.organisation_id === board.organisation_id)
    .filter((user) =>
      canOpen(
        accessTo(
          {
            userId: user.id, organisationId: user.organisation_id, email: '', fullName: '',
            role: user.role, sessionId: null,
            clientIds: clients.results.filter((c) => c.user_id === user.id).map((c) => c.client_id),
          },
          board,
          permissionOf.get(user.id) ?? null,
        ),
      ),
    )
    .map((user) => user.id)
}

/**
 * Raise a notification for a set of people. Used by the item routes when work
 * is assigned or commented on; automations write their own inside the batch.
 * Never notifies the person who caused it - being told about your own action
 * is noise, and noise is what makes people switch notifications off.
 */
export async function notify(
  env: Env,
  entries: {
    userIds: string[]
    kind: string
    title: string
    body?: string
    boardId?: string | null
    itemId?: string | null
    exceptUserId?: string | null
  },
): Promise<void> {
  // Capped: a PEOPLE cell could otherwise name enough people to blow the
  // bound-parameter limit in whoCanSee and fail the whole notification
  // silently, which is worse than telling a smaller number of them.
  let recipients = [...new Set(entries.userIds)]
    .filter((id) => id && id !== entries.exceptUserId)
    .slice(0, LIMITS.people)
  if (recipients.length === 0) return

  // Never tell someone about a board they cannot open. Without this, being
  // assigned to an item is enough to learn a client's name - the same leak
  // the dashboard's hours-by-client had, arriving by a different door.
  if (entries.boardId) {
    recipients = await whoCanSee(env, entries.boardId, recipients)
    if (recipients.length === 0) return
  }

  const timestamp = now()
  await env.DB.batch(
    recipients.map((userId) =>
      env.DB.prepare(
        `insert into notification (id, user_id, kind, title, body, board_id, item_id, created_at)
         select ?, id, ?, ?, ?, ?, ?, ? from app_user where id = ? and status = 'ACTIVE'`,
      ).bind(
        newId(), entries.kind, entries.title, entries.body ?? null,
        entries.boardId ?? null, entries.itemId ?? null, timestamp, userId,
      ),
    ),
  )
}
