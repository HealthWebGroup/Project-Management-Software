import { HttpError } from './errors'

/**
 * Input limits, in one place.
 *
 * Every one of these is a real column in a shared D1 database with a 500 MB
 * ceiling on the free plan. Without caps, one ordinary member with a loop can
 * fill it — and the row is usually written twice, because the audit trail
 * keeps the before and after of every change.
 *
 * The numbers are generous enough that nobody legitimate will meet them and
 * small enough that nobody can abuse them. When one is hit the message says
 * which field and what the limit is, rather than failing at the database.
 */

export const LIMITS = {
  name: 200,
  title: 500,
  email: 254, // the actual maximum length of an email address
  shortText: 500,
  longText: 20_000, // a comment or a note; long, but not a novel
  url: 2_000,
  colour: 32,
  /** How many entries a caller may send in one list. */
  list: 200,
  /** How many people one cell may name. */
  people: 100,
}

/**
 * A required string: trimmed, length-checked, and refused if empty.
 */
export function text(value: unknown, field: string, max = LIMITS.name): string {
  const trimmed = optionalText(value, field, max)
  if (!trimmed) throw HttpError.badRequest(`${field} cannot be empty.`)
  return trimmed
}

/**
 * An optional string. Returns undefined when absent, and an empty string
 * stays empty — callers decide whether that means "clear it" or "leave it".
 */
export function optionalText(value: unknown, field: string, max = LIMITS.name): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw HttpError.badRequest(`${field} must be text.`)
  const trimmed = value.trim()
  if (trimmed.length > max) {
    throw HttpError.badRequest(`${field} is too long — ${max} characters at most.`)
  }
  return trimmed
}

/** An email address, lowercased. Deliberately permissive in shape, strict in length. */
export function email(value: unknown, field = 'Email address'): string {
  const raw = text(value, field, LIMITS.email).toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    throw HttpError.badRequest('Enter a valid email address.')
  }
  return raw
}

/**
 * A link somebody else will click.
 *
 * Only http and https. `javascript:` in an href runs on our origin with the
 * clicker's session — a stored cross-site scripting hole dressed up as a
 * link column — and `data:` is the same trick in a different hat.
 */
export function httpUrl(value: unknown, field = 'Link'): string | undefined {
  const raw = optionalText(value, field, LIMITS.url)
  if (!raw) return undefined
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw HttpError.badRequest(`${field} must be a full web address, starting with https://`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw HttpError.badRequest(`${field} must start with http:// or https://`)
  }
  return parsed.toString().slice(0, LIMITS.url)
}

/**
 * A list from the request body, capped.
 *
 * Each of these usually becomes one statement in a D1 batch or one bound
 * parameter in an IN list. SQLite stops at 999 parameters, so an uncapped
 * array is a denial of service written by the caller.
 */
export function list<T>(value: unknown, field: string, max = LIMITS.list): T[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw HttpError.badRequest(`${field} must be a list.`)
  if (value.length > max) {
    throw HttpError.badRequest(`Too many entries in ${field} — ${max} at most.`)
  }
  return value as T[]
}

/** A list of strings, capped, with every entry checked. */
export function stringList(value: unknown, field: string, max = LIMITS.list): string[] {
  return list<unknown>(value, field, max).map((entry) => {
    if (typeof entry !== 'string' || entry.length > LIMITS.name) {
      throw HttpError.badRequest(`${field} contains something that is not an identifier.`)
    }
    return entry
  })
}

/** One of a fixed set, or a clean 400 naming the choices. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw HttpError.badRequest(`${field} must be one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

/** A whole number inside a range. */
export function integer(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw HttpError.badRequest(`${field} must be a number.`)
  return Math.min(Math.max(Math.round(n), min), max)
}

/** A YYYY-MM-DD date that is also a real date. */
export function isoDate(value: unknown, field: string): string | undefined {
  const raw = optionalText(value, field, 10)
  if (!raw) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw HttpError.badRequest(`${field} must be a date like 2026-09-05.`)
  }
  return raw
}

/** A full timestamp that is actually parseable. */
export function isoTimestamp(value: unknown, field: string): string | undefined {
  const raw = optionalText(value, field, 40)
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) throw HttpError.badRequest(`${field} is not a valid date and time.`)
  // Nothing sensible is dated before this system existed or years into the
  // future, and a wild value silently corrupts every report that windows on it.
  const year = new Date(parsed).getUTCFullYear()
  if (year < 2000 || year > 2100) {
    throw HttpError.badRequest(`${field} is outside any sensible range.`)
  }
  return new Date(parsed).toISOString()
}

/**
 * Read a JSON body without letting a malformed one become a 500.
 *
 * A broken body is the caller's mistake, so it deserves a 400 that says so —
 * not an unhandled exception, a stack trace in the logs and a message telling
 * an honest user to "try again" when trying again cannot possibly work.
 */
export async function readJson<T extends object>(request: {
  json: () => Promise<unknown>
}): Promise<T> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw HttpError.badRequest('That request was not valid JSON.')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('That request body was not in the expected shape.')
  }
  return body as T
}
