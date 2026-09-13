import { Hono } from 'hono'
import { accessTo, canAdminister, canOpen, requireAdmin } from '../access'
import { onEvent, runDue } from '../automations'
import { newId, now, parseJson, recordActivity } from '../db'
import { HttpError } from '../errors'
import { LIMITS, integer, oneOf, optionalText, readJson, stringList, text } from '../validate'
import { loadBoard } from './boards'
import type { Env, Vars } from '../types'

/**
 * Rules on a board: WHEN something happens, DO something.
 *
 * Writing rules is a board-administrator job, because a rule quietly changes
 * other people's work. Reading them is open to anyone who can open the board -
 * if something moved your item, you are entitled to know what did it.
 */
export const automations = new Hono<{ Bindings: Env; Variables: Vars }>()

const TRIGGERS = ['STATUS_BECOMES', 'DATE_ARRIVES', 'ITEM_CREATED'] as const
const ACTIONS = ['MOVE_TO_GROUP', 'SET_STATUS', 'ASSIGN_PEOPLE', 'NOTIFY'] as const

type Trigger = (typeof TRIGGERS)[number]
type Action = (typeof ACTIONS)[number]

interface Row {
  id: string
  board_id: string
  name: string
  trigger_type: Trigger
  trigger_config: string
  action_type: Action
  action_config: string
  enabled: number
  created_at: string
  last_run_at: string | null
  run_count: number
}

const toDto = (row: Row) => ({
  id: row.id,
  boardId: row.board_id,
  name: row.name,
  trigger: { type: row.trigger_type, ...parseJson<object>(row.trigger_config, {}) },
  action: { type: row.action_type, ...parseJson<object>(row.action_config, {}) },
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  lastRunAt: row.last_run_at ?? undefined,
  runCount: row.run_count,
})

automations.get('/boards/:boardId/automations', async (c) => {
  const principal = c.get('principal')
  const board = await loadBoard(c.env, c.req.param('boardId'), principal)
  const level = accessTo(principal, board, board.permission)
  if (!canOpen(level)) throw HttpError.forbidden('You do not have access to this board.')

  const rows = await c.env.DB
    .prepare(
      `select id, board_id, name, trigger_type, trigger_config, action_type, action_config,
              enabled, created_at, last_run_at, run_count
         from automation where board_id = ? order by created_at`,
    )
    .bind(board.id)
    .all<Row>()

  return c.json({
    boardId: board.id,
    canEdit: canAdminister(level),
    automations: rows.results.map(toDto),
  })
})

automations.post('/boards/:boardId/automations', async (c) => {
  const principal = c.get('principal')
  const board = await loadBoard(c.env, c.req.param('boardId'), principal)
  requireAdmin(accessTo(principal, board, board.permission))

  const body = await readJson<{
    name?: unknown
    trigger?: { type?: unknown; columnId?: unknown; labelId?: unknown; offsetDays?: unknown }
    action?: {
      type?: unknown; groupId?: unknown; columnId?: unknown
      labelId?: unknown; userIds?: unknown; who?: unknown
    }
  }>(c.req)

  const trigger = body.trigger ?? {}
  const action = body.action ?? {}
  const triggerType = oneOf(trigger.type, TRIGGERS, 'What starts the rule')
  const actionType = oneOf(action.type, ACTIONS, 'What the rule does')

  /**
   * A column the rule points at has to be on this board AND of the right
   * kind. Without the type check, the interface's dropdowns are the only
   * thing keeping a status column out of a date rule - and a rule built by
   * hand, or by a form that reset badly, would be stored and then run.
   */
  async function columnOfType(value: unknown, wanted: string[], what: string): Promise<string> {
    const id = text(value, what, 64)
    const column = await c.env.DB
      .prepare(`select id, type from board_column where id = ? and board_id = ?`)
      .bind(id, board.id).first<{ id: string; type: string }>()
    if (!column) throw HttpError.badRequest(`${what} is not a column on this board.`)
    if (!wanted.includes(column.type)) {
      throw HttpError.badRequest(
        `${what} has to be a ${wanted.map((t) => t.toLowerCase()).join(' or ')} column.`,
      )
    }
    return column.id
  }

  const triggerConfig: Record<string, unknown> = {}
  if (triggerType === 'STATUS_BECOMES') {
    triggerConfig.columnId = await columnOfType(trigger.columnId, ['STATUS'], 'The status column')
    triggerConfig.labelId = text(trigger.labelId, 'The status to watch for', LIMITS.colour)
  } else if (triggerType === 'DATE_ARRIVES') {
    triggerConfig.columnId = await columnOfType(
      trigger.columnId, ['DATE', 'TIMELINE'], 'The date column',
    )
    triggerConfig.offsetDays = integer(trigger.offsetDays ?? 0, 'The number of days', -365, 365)
  }

  const actionConfig: Record<string, unknown> = {}
  if (actionType === 'MOVE_TO_GROUP') {
    const groupId = text(action.groupId, 'The group', 64)
    const group = await c.env.DB
      .prepare(`select id from board_group where id = ? and board_id = ?`)
      .bind(groupId, board.id).first<{ id: string }>()
    if (!group) throw HttpError.badRequest('That group is not on this board.')
    actionConfig.groupId = group.id
  } else if (actionType === 'SET_STATUS') {
    actionConfig.columnId = await columnOfType(action.columnId, ['STATUS'], 'The status column')
    actionConfig.labelId = text(action.labelId, 'The status to set', LIMITS.colour)
  } else if (actionType === 'ASSIGN_PEOPLE') {
    actionConfig.columnId = await columnOfType(action.columnId, ['PEOPLE'], 'The people column')
    const userIds = stringList(action.userIds, 'The people to assign', LIMITS.people)
    if (userIds.length === 0) throw HttpError.badRequest('Pick who to assign.')
    const marks = userIds.map(() => '?').join(', ')
    const found = await c.env.DB
      .prepare(`select count(*) as n from app_user where organisation_id = ? and id in (${marks})`)
      .bind(principal.organisationId, ...userIds).first<{ n: number }>()
    if ((found?.n ?? 0) !== new Set(userIds).size) {
      throw HttpError.badRequest('One of those people is not in your organisation.')
    }
    actionConfig.userIds = userIds
  } else {
    actionConfig.who = action.who ? oneOf(action.who, ['OWNERS', 'BOARD'] as const, 'Who to tell') : 'OWNERS'
  }

  const name = optionalText(body.name, 'The rule name', LIMITS.name) || 'Rule'

  const id = newId()

  await c.env.DB
    .prepare(
      `insert into automation
         (id, board_id, name, trigger_type, trigger_config, action_type, action_config,
          enabled, created_by, created_at)
       values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id, board.id, name,
      triggerType, JSON.stringify(triggerConfig),
      actionType, JSON.stringify(actionConfig),
      principal.userId, now(),
    )
    .run()

  await recordActivity(c.env.DB, {
    entityType: 'BOARD', entityId: board.id, boardId: board.id, actorId: principal.userId,
    action: 'AUTOMATION_ADDED', detail: name,
  })

  const row = await c.env.DB
    .prepare(
      `select id, board_id, name, trigger_type, trigger_config, action_type, action_config,
              enabled, created_at, last_run_at, run_count from automation where id = ?`,
    )
    .bind(id).first<Row>()
  return c.json(toDto(row as Row))
})

automations.patch('/automations/:id', async (c) => {
  const { principal, rule, board } = await forRule(c)
  requireAdmin(accessTo(principal, board, board.permission))

  const body = await readJson<{ enabled?: unknown; name?: unknown }>(c.req)
  await c.env.DB
    .prepare(`update automation set enabled = ?, name = ? where id = ?`)
    .bind(
      body.enabled === undefined ? rule.enabled : body.enabled ? 1 : 0,
      optionalText(body.name, 'The rule name', LIMITS.name) || rule.name,
      rule.id,
    )
    .run()

  await recordActivity(c.env.DB, {
    entityType: 'BOARD', entityId: board.id, boardId: board.id, actorId: principal.userId,
    action: 'AUTOMATION_CHANGED',
    detail: `${rule.name}${body.enabled === false ? ' turned off' : body.enabled ? ' turned on' : ''}`,
  })

  return c.body(null, 204)
})

automations.delete('/automations/:id', async (c) => {
  const { principal, rule, board } = await forRule(c)
  requireAdmin(accessTo(principal, board, board.permission))

  await c.env.DB.prepare(`delete from automation where id = ?`).bind(rule.id).run()
  await recordActivity(c.env.DB, {
    entityType: 'BOARD', entityId: board.id, boardId: board.id, actorId: principal.userId,
    action: 'AUTOMATION_REMOVED', detail: rule.name,
  })
  return c.body(null, 204)
})

/**
 * Run the date rules now rather than waiting for tomorrow morning. Useful the
 * moment you write one, when otherwise you cannot tell whether it works.
 */
automations.post('/automations/run-due', async (c) => {
  const principal = c.get('principal')
  if (principal.role !== 'ADMIN' && principal.role !== 'MANAGER') {
    throw HttpError.forbidden('Only managers and administrators can do this.')
  }
  const result = await runDue(c.env, principal.organisationId)
  return c.json(result)
})

async function forRule(c: {
  env: Env
  req: { param: (key: string) => string }
  get: (key: 'principal') => Vars['principal']
}) {
  const principal = c.get('principal')
  const rule = await c.env.DB
    .prepare(
      `select id, board_id, name, trigger_type, trigger_config, action_type, action_config,
              enabled, created_at, last_run_at, run_count from automation where id = ?`,
    )
    .bind(c.req.param('id'))
    .first<Row>()
  if (!rule) throw HttpError.notFound('Automation')
  const board = await loadBoard(c.env, rule.board_id, principal)
  return { principal, rule, board }
}

export { onEvent }
