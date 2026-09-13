import { HttpError } from './errors'
import { LIMITS } from './validate'
import type { CellValue, ColumnType } from './types'

/**
 * Cell values are JSON objects whose shape depends on the column type.
 * The conventions, in one place, checked on the way in:
 *
 *   TEXT / LONG_TEXT  {"text": "..."}
 *   STATUS            {"labelId": "working"}
 *   PEOPLE            {"userIds": ["uuid", ...]}
 *   DATE              {"date": "2026-09-05"}
 *   TIMELINE          {"start": "2026-08-11", "end": "2026-09-05"}
 *   NUMBER            {"number": 60}
 *   DROPDOWN          {"optionIds": ["riverside", ...]}
 *   CHECKBOX          {"checked": true}
 *   LINK              {"url": "https://...", "label": "..."}
 *   DEPENDENCY        {"itemIds": ["uuid", ...]}
 *   FILE              {"files": [{"id": "...", "name": "..."}]}
 *   FORMULA           computed, never written directly
 *
 * An empty object always means "not set" and is valid for every type.
 */
export function validateCell(type: ColumnType, value: CellValue | null | undefined): CellValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  if (Object.keys(value).length === 0) return {}

  switch (type) {
    case 'TEXT':
      requireString(value.text, 'text', LIMITS.title)
      return pick(value, ['text'])

    case 'LONG_TEXT':
      requireString(value.text, 'text', LIMITS.longText)
      return pick(value, ['text'])

    case 'STATUS':
      requireString(value.labelId, 'labelId', LIMITS.colour)
      return pick(value, ['labelId'])

    case 'PEOPLE':
      requireIdList(value.userIds, 'userIds', LIMITS.people)
      return pick(value, ['userIds'])

    case 'DEPENDENCY':
      requireIdList(value.itemIds, 'itemIds')
      return pick(value, ['itemIds'])

    case 'DATE':
      requireDate(value.date, 'date')
      return pick(value, ['date'])

    case 'TIMELINE': {
      const start = requireDate(value.start, 'start')
      const end = requireDate(value.end, 'end')
      if (start && end && end < start) {
        throw HttpError.badRequest('The end date cannot be before the start date.')
      }
      return pick(value, ['start', 'end'])
    }

    case 'NUMBER':
      if (value.number !== undefined) {
        if (typeof value.number !== 'number' || !Number.isFinite(value.number)) {
          throw HttpError.badRequest('That is not a number.')
        }
      }
      return pick(value, ['number'])

    case 'DROPDOWN':
      if (value.optionIds !== undefined) {
        if (!Array.isArray(value.optionIds) || value.optionIds.length > LIMITS.list) {
          throw HttpError.badRequest('Dropdown values must be a short list of option ids.')
        }
        for (const option of value.optionIds) {
          requireString(option, 'optionIds', LIMITS.colour)
        }
      }
      return pick(value, ['optionIds'])

    case 'CHECKBOX':
      if (value.checked !== undefined && typeof value.checked !== 'boolean') {
        throw HttpError.badRequest('A checkbox is either ticked or not.')
      }
      return pick(value, ['checked'])

    case 'LINK': {
      // Only http and https. A `javascript:` address in a link column becomes
      // a script that runs on our own origin, with the session of whoever
      // clicks it - a cross-site scripting hole wearing a link's clothes.
      requireString(value.url, 'url', LIMITS.url)
      requireString(value.label, 'label', LIMITS.name)
      if (value.url) {
        let parsed: URL
        try {
          parsed = new URL(value.url)
        } catch {
          throw HttpError.badRequest('A link must be a full web address, starting with https://')
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw HttpError.badRequest('A link must start with http:// or https://')
        }
      }
      return pick(value, ['url', 'label'])
    }

    case 'FILE':
      if (value.files !== undefined && !Array.isArray(value.files)) {
        throw HttpError.badRequest('Files must be a list.')
      }
      return pick(value, ['files'])

    case 'FORMULA':
      throw HttpError.badRequest('A formula column is calculated, not entered.')
  }

  return value
}

/**
 * Keep only the keys this column type means, and drop the rest.
 *
 * Whatever comes in here is stringified into the cell AND into the audit
 * trail's before and after. Echoing back unknown keys would let one member
 * with a loop store megabytes twice over in a 500 MB database.
 */
function pick(value: CellValue, keys: (keyof CellValue)[]): CellValue {
  const out: CellValue = {}
  for (const key of keys) {
    if (value[key] !== undefined) (out as Record<string, unknown>)[key] = value[key]
  }
  return out
}

function requireString(value: unknown, key: string, max = LIMITS.title): void {
  if (value === undefined) return
  if (typeof value !== 'string') throw HttpError.badRequest(`Expected text for ${key}.`)
  if (value.length > max) {
    throw HttpError.badRequest(`That is too long for ${key} — ${max} characters at most.`)
  }
}

function requireDate(value: unknown, key: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw HttpError.badRequest(`Could not read the date in ${key}. Use YYYY-MM-DD.`)
  }
  if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw HttpError.badRequest(`${value} is not a real date.`)
  }
  return value
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireIdList(value: unknown, key: string, max = LIMITS.list): void {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) throw HttpError.badRequest(`${key} must be a list.`)
  if (value.length > max) throw HttpError.badRequest(`Too many entries in ${key} — ${max} at most.`)
  for (const entry of value) {
    if (typeof entry !== 'string' || !UUID.test(entry)) {
      throw HttpError.badRequest(`'${String(entry)}' is not a valid identifier.`)
    }
  }
}
