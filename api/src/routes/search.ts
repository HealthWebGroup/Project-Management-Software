/**
 * Find a task anywhere.
 *
 * "Where is the VEDA work?" was a question this application could not
 * answer. The command palette searched boards, clients and pages — the
 * containers — but never the tasks inside them, so finding one meant
 * opening each client's board in turn and reading. With five clients and a
 * board each, that is the difference between a two-second answer and a
 * two-minute hunt.
 *
 * Access is the whole risk here. Every other screen is scoped to one board
 * the caller has already been allowed to open; this route deliberately
 * crosses all of them, so it is exactly where a missing check hands
 * somebody task titles from a client they cannot see. Every row goes
 * through `accessTo` — the same decision function every other route uses,
 * never a second copy of the rules.
 *
 * One subtlety worth stating, because the first draft of this file got it
 * wrong: `accessTo` scopes by the BOARD's client, not the item's. An item
 * can carry its own client id, and passing that instead would mean an item
 * with no client sitting on a client's board skipped the client check
 * altogether — which is a leak, not a rounding error. The board's client
 * is what decides who may see the board, so the board's client is what is
 * passed.
 */
import { Hono } from 'hono'
import { accessTo, canOpen } from '../access'
import type { BoardPermission, Env, Sensitivity, Vars } from '../types'
import type { Priority } from '../priority'

export const search = new Hono<{ Bindings: Env; Variables: Vars }>()

/** Enough to be useful in a palette; small enough to stay one fast query. */
const LIMIT = 25

/**
 * Build the LIKE pattern for a search term.
 *
 * Exported so it can be tested on its own. The escaping is the part worth
 * pinning: `%` and `_` are wildcards in LIKE, so a user typing "50%" would
 * otherwise match every task in the organisation rather than the one with
 * "50%" in its title — and `\` has to be escaped first, or escaping the
 * others would corrupt it.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`).toLowerCase()}%`
}

search.get('/search', async (c) => {
  const principal = c.get('principal')
  const raw = (c.req.query('q') ?? '').trim()

  // One character matches half the database and helps nobody.
  if (raw.length < 2) return c.json({ items: [] })

  // LIKE is the tool available: D1 has no full-text index here, and an
  // organisation's worth of task titles is small. Escaping matters though —
  // a stray % typed into a search box should find a literal %, not
  // everything in the database.
  const needle = likePattern(raw)

  const rows = await c.env.DB
    .prepare(
      `select i.id, i.title, i.priority,
              b.id as board_id, b.name as board_name,
              b.sensitivity, b.client_id as board_client_id,
              cl.name as client_name, cl.colour as client_colour,
              m.permission as permission
         from item i
         join board b on b.id = i.board_id
         join workspace w on w.id = b.workspace_id
         left join client cl on cl.id = coalesce(i.client_id, b.client_id)
         left join board_member m on m.board_id = b.id and m.user_id = ?
        where w.organisation_id = ?
          and i.archived = 0
          and lower(i.title) like ? escape '\\'
        order by i.updated_at desc
        limit ?`,
    )
    // Over-fetch, because the access check below drops rows and a list that
    // shrinks to three is worse than one that was never long.
    .bind(principal.userId, principal.organisationId, needle, LIMIT * 4)
    .all<{
      id: string; title: string; priority: Priority
      board_id: string; board_name: string
      sensitivity: Sensitivity; board_client_id: string | null
      client_name: string | null; client_colour: string | null
      permission: BoardPermission | null
    }>()

  const visible = rows.results.filter((r) =>
    canOpen(
      accessTo(
        principal,
        { sensitivity: r.sensitivity, client_id: r.board_client_id },
        r.permission,
      ),
    ),
  )

  return c.json({
    items: visible.slice(0, LIMIT).map((r) => ({
      id: r.id,
      title: r.title,
      priority: r.priority,
      boardId: r.board_id,
      boardName: r.board_name,
      clientName: r.client_name ?? undefined,
      clientColour: r.client_colour ?? undefined,
    })),
  })
})
