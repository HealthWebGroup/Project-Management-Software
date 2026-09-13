import type { CellValue, ColumnSettings } from './types'

/** ISO-8601 UTC, matching what the schema's defaults write. */
export const now = (): string => new Date().toISOString()

export const today = (): string => new Date().toISOString().slice(0, 10)

export const newId = (): string => crypto.randomUUID()

/** SQLite has no boolean; the schema stores 0 and 1. */
export const bool = (value: unknown): boolean => value === 1 || value === true
export const flag = (value: boolean | undefined | null): number => (value ? 1 : 0)

/**
 * D1's free plan allows 50 queries per request, so anything that would loop
 * over rows issuing a query each time has to be written as one statement with
 * an IN list instead. These helpers build those safely.
 */
export function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ')
}

/** Reads a JSON text column, returning a fallback rather than throwing. */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    const parsed = JSON.parse(raw)
    return parsed == null ? fallback : (parsed as T)
  } catch {
    return fallback
  }
}

export const parseCell = (raw: unknown): CellValue => parseJson<CellValue>(raw, {})
export const parseSettings = (raw: unknown): ColumnSettings => parseJson<ColumnSettings>(raw, {})

/** Days between two YYYY-MM-DD dates; negative means the first is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(to + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86400000)
}

export function isoMinus(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString()
}

export function minutesBetween(from: string, to: string): number {
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / 60000))
}

/** Append-only audit trail. Never updated, never deleted. */
export async function recordActivity(
  db: D1Database,
  entry: {
    entityType: string
    entityId: string
    boardId?: string | null
    actorId?: string | null
    action: string
    detail?: string | null
    before?: unknown
    after?: unknown
  },
): Promise<void> {
  await db
    .prepare(
      `insert into activity_log
         (entity_type, entity_id, board_id, actor_id, action, detail, before_value, after_value, occurred_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.entityType,
      entry.entityId,
      entry.boardId ?? null,
      entry.actorId ?? null,
      entry.action,
      entry.detail ? entry.detail.slice(0, 500) : null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      now(),
    )
    .run()
}
