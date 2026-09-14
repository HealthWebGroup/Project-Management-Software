/**
 * Priority: one definition, used by the API, the tests and the interface.
 *
 * It lives in its own file rather than inline in the items route because
 * three places need to agree on it — the column check in the database, the
 * validator on the way in, and the ordering used by the board and the
 * dashboard. When those three disagree you get a value that saves and then
 * sorts wrongly, which is the kind of bug nobody reports because it just
 * looks like the list is in a funny order.
 */

import { HttpError } from './errors'

export const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

export type Priority = (typeof PRIORITIES)[number]

/**
 * The sort weight. Higher is more urgent, so `order by priority_rank desc`
 * puts the critical work at the top, and NONE sits at 0 below everything
 * anybody has actually decided about.
 *
 * These numbers are spaced by one on purpose: there is no room to slip a
 * level in between, which is a feature. Five levels is already one more
 * than most teams use, and a sixth would make the list a ranking exercise
 * rather than a triage.
 */
export const PRIORITY_RANK: Record<Priority, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
}

export const isPriority = (value: unknown): value is Priority =>
  typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value)

/**
 * Read a priority off a request body.
 *
 * `undefined` means the caller did not mention priority and whatever is
 * already stored should stay. That is different from sending 'NONE', which
 * means somebody cleared it deliberately — so this returns undefined for
 * the first and a value for the second, and the caller decides.
 *
 * Anything else is refused rather than coerced. Silently turning a typo
 * into NONE would lose a decision somebody made.
 */
export function readPriority(value: unknown): Priority | undefined {
  if (value === undefined || value === null) return undefined
  if (!isPriority(value)) {
    throw HttpError.badRequest(
      `Priority has to be one of ${PRIORITIES.join(', ')}.`,
    )
  }
  return value
}

export const rankOf = (priority: Priority): number => PRIORITY_RANK[priority]
