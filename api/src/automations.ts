import { now, parseJson, placeholders, recordActivity, today } from './db'
import { notify } from './routes/notifications'
import type { CellValue, Env } from './types'

/**
 * The automation engine.
 *
 * An automation is one sentence — WHEN something happens, DO something — and
 * this file is the only place that sentence is acted on. Two ways in:
 *
 *   onEvent()   from a request, when a cell changes or an item is created
 *   runDue()    from the daily Cron Trigger, for the date-based rules
 *
 * **One pass, deliberately.** An action can produce a change that another
 * rule would match — set the status to Done, and a rule watching Done would
 * fire. This engine does not follow that chain. Two rules pointing at each
 * other would otherwise run until something gave out, and on a Worker that
 * "something" is a CPU limit in the middle of somebody's edit. A rule acts on
 * what a person did, never on what another rule did, and the interface says
 * so where the rules are written.
 *
 * Query budget matters here: this runs inside the request that saves a cell,
 * and D1 allows 50 queries per invocation. One SELECT for the rules, one
 * batch for every effect, whatever the number of rules.
 */

export type AutomationEvent =
  | { kind: 'CELL_CHANGED'; boardId: string; itemId: string; columnId: string; value: CellValue }
  | { kind: 'ITEM_CREATED'; boardId: string; itemId: string }

interface AutomationRow {
  id: string
  board_id: string
  name: string
  trigger_type: 'STATUS_BECOMES' | 'DATE_ARRIVES' | 'ITEM_CREATED'
  trigger_config: string
  action_type: 'MOVE_TO_GROUP' | 'SET_STATUS' | 'ASSIGN_PEOPLE' | 'NOTIFY'
  action_config: string
  enabled: number
}

interface TriggerConfig {
  columnId?: string
  labelId?: string
  offsetDays?: number
}

interface ActionConfig {
  groupId?: string
  columnId?: string
  labelId?: string
  userIds?: string[]
  who?: 'OWNERS' | 'BOARD'
}

/** What a rule did, in words, for the activity log and the response. */
export interface AutomationResult {
  automationId: string
  name: string
  did: string
}

// --------------------------------------------------------------- events

export async function onEvent(
  env: Env,
  event: AutomationEvent,
  actorId: string | null,
): Promise<AutomationResult[]> {
  const wanted = event.kind === 'ITEM_CREATED' ? 'ITEM_CREATED' : 'STATUS_BECOMES'

  const rules = await env.DB
    .prepare(
      `select id, board_id, name, trigger_type, trigger_config, action_type, action_config, enabled
         from automation
        where board_id = ? and enabled = 1 and trigger_type = ?`,
    )
    .bind(event.boardId, wanted)
    .all<AutomationRow>()

  if (rules.results.length === 0) return []

  const matched = rules.results.filter((rule) => {
    if (event.kind === 'ITEM_CREATED') return true
    const config = parseJson<TriggerConfig>(rule.trigger_config, {})
    return config.columnId === event.columnId && config.labelId === event.value.labelId
  })

  if (matched.length === 0) return []

  const statements: D1PreparedStatement[] = []
  const intents: NotifyIntent[] = []
  const results: AutomationResult[] = []

  for (const rule of matched) {
    const did = await plan(env, rule, event.itemId, event.boardId, actorId, statements, intents)
    if (did) results.push({ automationId: rule.id, name: rule.name, did })
  }

  if (statements.length > 0) await env.DB.batch(statements)
  await deliver(env, intents, actorId)

  for (const result of results) {
    await recordActivity(env.DB, {
      entityType: 'ITEM', entityId: event.itemId, boardId: event.boardId,
      actorId, action: 'AUTOMATION_RAN', detail: `${result.name}: ${result.did}`,
    })
  }

  return results
}

// ----------------------------------------------------------- the schedule

/**
 * The daily pass for date-based rules, run by a Cron Trigger. Deliberately
 * three queries whatever the size of the organisation: the rules, then every
 * cell in the columns those rules watch, then one batch of effects.
 */
export async function runDue(
  env: Env,
  /**
   * Which organisation's rules to run. The nightly Cron Trigger passes
   * nothing and runs them all, which is correct for a scheduled job with no
   * caller. A person pressing "run now" must never reach beyond their own
   * organisation - otherwise one manager's button fires rules on boards, and
   * in companies, they have nothing to do with.
   */
  organisationId?: string,
): Promise<{ matched: number; rules: number }> {
  const rules = await (organisationId
    ? env.DB.prepare(
        `select a.id, a.board_id, a.name, a.trigger_type, a.trigger_config,
                a.action_type, a.action_config, a.enabled
           from automation a
           join board b on b.id = a.board_id
           join workspace w on w.id = b.workspace_id
          where a.enabled = 1 and a.trigger_type = 'DATE_ARRIVES'
            and w.organisation_id = ?`,
      ).bind(organisationId)
    : env.DB.prepare(
        `select a.id, a.board_id, a.name, a.trigger_type, a.trigger_config,
                a.action_type, a.action_config, a.enabled
           from automation a
          where a.enabled = 1 and a.trigger_type = 'DATE_ARRIVES'`,
      ))
    .all<AutomationRow>()

  if (rules.results.length === 0) return { matched: 0, rules: 0 }

  const columnIds = [
    ...new Set(
      rules.results
        .map((r) => parseJson<TriggerConfig>(r.trigger_config, {}).columnId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  if (columnIds.length === 0) return { matched: 0, rules: rules.results.length }

  const cells = await env.DB
    .prepare(
      `select ce.item_id, ce.column_id, ce.value, i.board_id
         from cell ce
         join item i on i.id = ce.item_id
        where ce.column_id in (${placeholders(columnIds.length)}) and i.archived = 0`,
    )
    .bind(...columnIds)
    .all<{ item_id: string; column_id: string; value: string; board_id: string }>()

  const statements: D1PreparedStatement[] = []
  const intents: NotifyIntent[] = []
  // Matched, not sent: the notify action itself refuses to tell the same
  // person about the same item twice in one day.
  let matched = 0

  for (const rule of rules.results) {
    const config = parseJson<TriggerConfig>(rule.trigger_config, {})
    if (!config.columnId) continue
    // "offsetDays: -1" means the rule fires the day BEFORE the date, so the
    // date we are looking for today is today minus the offset.
    const target = shiftDays(today(), -(config.offsetDays ?? 0))

    for (const cell of cells.results) {
      if (cell.column_id !== config.columnId) continue
      if (cell.board_id !== rule.board_id) continue
      const value = parseJson<CellValue>(cell.value, {})
      const date = value.date ?? value.end
      if (date !== target) continue

      const did = await plan(env, rule, cell.item_id, rule.board_id, null, statements, intents)
      if (did) matched++
    }
  }

  if (statements.length > 0) await env.DB.batch(statements)
  await deliver(env, intents, null)
  return { matched, rules: rules.results.length }
}

// --------------------------------------------------------------- actions

/**
 * Turns one rule into statements on the shared batch, and returns a plain
 * description of what it will do. Returns null when the rule cannot act -
 * a group that has since been deleted, say - rather than throwing, because
 * a broken rule must never break the edit that triggered it.
 */
interface NotifyIntent {
  rule: AutomationRow
  itemId: string
  boardId: string
  who: 'OWNERS' | 'BOARD'
}

async function plan(
  env: Env,
  rule: AutomationRow,
  itemId: string,
  boardId: string,
  actorId: string | null,
  statements: D1PreparedStatement[],
  intents: NotifyIntent[],
): Promise<string | null> {
  const config = parseJson<ActionConfig>(rule.action_config, {})
  const timestamp = now()
  let did: string | null = null

  switch (rule.action_type) {
    case 'MOVE_TO_GROUP': {
      if (!config.groupId) return null
      statements.push(
        env.DB.prepare(
          // The select guards the group: if it has been deleted or belongs to
          // another board, this updates nothing instead of corrupting the item.
          `update item set group_id = ?, updated_at = ?
            where id = ? and exists (select 1 from board_group where id = ? and board_id = ?)`,
        ).bind(config.groupId, timestamp, itemId, config.groupId, boardId),
      )
      did = 'moved it to another group'
      break
    }

    case 'SET_STATUS': {
      if (!config.columnId || !config.labelId) return null
      statements.push(
        env.DB.prepare(
          `insert into cell (item_id, column_id, value, updated_at, updated_by)
           select ?, id, ?, ?, ? from board_column where id = ? and board_id = ?
           on conflict(item_id, column_id) do update set
             value = excluded.value, updated_at = excluded.updated_at`,
        ).bind(
          itemId, JSON.stringify({ labelId: config.labelId }), timestamp, actorId,
          config.columnId, boardId,
        ),
      )
      did = 'set the status'
      break
    }

    case 'ASSIGN_PEOPLE': {
      if (!config.columnId || !config.userIds?.length) return null
      statements.push(
        env.DB.prepare(
          `insert into cell (item_id, column_id, value, updated_at, updated_by)
           select ?, id, ?, ?, ? from board_column where id = ? and board_id = ?
           on conflict(item_id, column_id) do update set
             value = excluded.value, updated_at = excluded.updated_at`,
        ).bind(
          itemId, JSON.stringify({ userIds: config.userIds }), timestamp, actorId,
          config.columnId, boardId,
        ),
      )
      did = 'assigned it'
      break
    }

    case 'NOTIFY': {
      // Handed to notify(), which is the one place that decides who may hear
      // about a board - so a rule cannot tell somebody about work they are
      // not allowed to see.
      intents.push({ rule, itemId, boardId, who: config.who ?? 'OWNERS' })
      did = config.who === 'BOARD' ? 'told everyone named on the board' : 'told whoever owns it'
      break
    }
  }

  if (did) {
    statements.push(
      env.DB.prepare(
        `update automation set last_run_at = ?, run_count = run_count + 1 where id = ?`,
      ).bind(timestamp, rule.id),
    )
  }
  return did
}

/**
 * Turn the collected NOTIFY intents into actual notifications.
 *
 * Owners come from the item's people cells; "everyone named on the board"
 * from board_member. Either way notify() has the last word on who hears,
 * and it refuses to tell anyone about a board they cannot open.
 *
 * Told once per person, per item, per day: the daily pass runs again whenever
 * somebody presses "run now" or Cloudflare retries the schedule, and repeating
 * yesterday's news is how a notification list becomes wallpaper.
 */
async function deliver(env: Env, intents: NotifyIntent[], actorId: string | null): Promise<void> {
  if (intents.length === 0) return

  const itemIds = [...new Set(intents.map((i) => i.itemId))]
  const [items, owners, boardPeople] = await Promise.all([
    env.DB.prepare(`select id, title from item where id in (${placeholders(itemIds.length)})`)
      .bind(...itemIds).all<{ id: string; title: string }>(),
    env.DB.prepare(
      `select ce.item_id, ce.value from cell ce
         join board_column bc on bc.id = ce.column_id and bc.type = 'PEOPLE'
        where ce.item_id in (${placeholders(itemIds.length)})`,
    ).bind(...itemIds).all<{ item_id: string; value: string }>(),
    env.DB.prepare(
      `select board_id, user_id from board_member
        where board_id in (${placeholders([...new Set(intents.map((i) => i.boardId))].length)})`,
    ).bind(...new Set(intents.map((i) => i.boardId))).all<{ board_id: string; user_id: string }>(),
  ])

  const titles = new Map(items.results.map((row) => [row.id, row.title]))
  const day = now().slice(0, 10)

  for (const intent of intents) {
    const userIds =
      intent.who === 'BOARD'
        ? boardPeople.results.filter((r) => r.board_id === intent.boardId).map((r) => r.user_id)
        : owners.results
            .filter((r) => r.item_id === intent.itemId)
            .flatMap((r) => parseJson<CellValue>(r.value, {}).userIds ?? [])

    if (userIds.length === 0) continue

    const already = await env.DB
      .prepare(
        `select count(*) as n from notification
          where item_id = ? and title = ? and substr(created_at, 1, 10) = ?`,
      )
      .bind(intent.itemId, intent.rule.name, day)
      .first<{ n: number }>()
    if ((already?.n ?? 0) > 0) continue

    await notify(env, {
      userIds,
      kind: 'AUTOMATION',
      title: intent.rule.name,
      body: titles.get(intent.itemId),
      boardId: intent.boardId,
      itemId: intent.itemId,
      exceptUserId: actorId,
    })
  }
}

// --------------------------------------------------------------- helpers

function shiftDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}
