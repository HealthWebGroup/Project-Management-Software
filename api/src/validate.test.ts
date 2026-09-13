import { describe, expect, it } from 'vitest'
import { HttpError } from './errors'
import {
  LIMITS, email, httpUrl, integer, isoDate, isoTimestamp, list, oneOf,
  optionalText, readJson, stringList, text,
} from './validate'

const refuses = (fn: () => unknown) => expect(fn).toThrow(HttpError)

describe('text', () => {
  it('trims', () => {
    expect(text('  Aoife Kelly  ', 'Name')).toBe('Aoife Kelly')
  })

  it('refuses empty and whitespace-only', () => {
    refuses(() => text('', 'Name'))
    refuses(() => text('   ', 'Name'))
    refuses(() => text(undefined, 'Name'))
  })

  it('refuses something that is not text', () => {
    refuses(() => text(42, 'Name'))
    refuses(() => text({}, 'Name'))
  })

  it('refuses anything past the limit, and says what the limit is', () => {
    try {
      text('a'.repeat(LIMITS.name + 1), 'The board name')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as HttpError).message).toContain('The board name')
      expect((error as HttpError).message).toContain(String(LIMITS.name))
      expect((error as HttpError).status).toBe(400)
    }
  })

  it('lets an optional value be absent', () => {
    expect(optionalText(undefined, 'Job title')).toBeUndefined()
    expect(optionalText('', 'Job title')).toBe('')
  })
})

describe('email', () => {
  it('lowercases', () => {
    expect(email('Aoife@HealthWebGroup.com')).toBe('aoife@healthwebgroup.com')
  })

  it('refuses an address with no domain', () => {
    refuses(() => email('aoife'))
    refuses(() => email('aoife@nowhere'))
  })

  it('refuses a 10 MB local part rather than storing it', () => {
    refuses(() => email(`${'a'.repeat(2000)}@example.com`))
  })
})

describe('links', () => {
  it('accepts http and https', () => {
    expect(httpUrl('https://example.com')).toBe('https://example.com/')
    expect(httpUrl('http://example.com/x')).toBe('http://example.com/x')
  })

  it('refuses javascript: and data:', () => {
    refuses(() => httpUrl('javascript:alert(1)'))
    refuses(() => httpUrl('data:text/html,<script>alert(1)</script>'))
  })

  it('refuses a bare word', () => {
    refuses(() => httpUrl('example.com'))
  })

  it('treats absent as absent', () => {
    expect(httpUrl(undefined)).toBeUndefined()
    expect(httpUrl('')).toBeUndefined()
  })
})

describe('lists', () => {
  it('caps the length', () => {
    expect(list(new Array(10).fill('x'), 'Clients')).toHaveLength(10)
    refuses(() => list(new Array(LIMITS.list + 1).fill('x'), 'Clients'))
  })

  it('refuses a string where a list belongs', () => {
    // The bug this exists for: `{"ids":"abc"}` used to reach .map on a string
    // and become a 500 instead of a 400.
    refuses(() => list('abc', 'Notification ids'))
    refuses(() => stringList('abc', 'Notification ids'))
  })

  it('refuses a list with something that is not a string in it', () => {
    refuses(() => stringList([{}], 'Notification ids'))
    refuses(() => stringList([1, 2], 'Notification ids'))
  })

  it('treats absent as an empty list', () => {
    expect(list(undefined, 'Clients')).toEqual([])
  })
})

describe('one of a set', () => {
  it('accepts a member and refuses everything else', () => {
    expect(oneOf('ADMIN', ['ADMIN', 'MEMBER'] as const, 'Role')).toBe('ADMIN')
    refuses(() => oneOf('SUPERUSER', ['ADMIN', 'MEMBER'] as const, 'Role'))
    refuses(() => oneOf(undefined, ['ADMIN'] as const, 'Role'))
  })

  it('names the choices in the message', () => {
    try {
      oneOf('X', ['ADMIN', 'MEMBER'] as const, 'Role')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as HttpError).message).toContain('ADMIN, MEMBER')
    }
  })
})

describe('numbers and dates', () => {
  it('clamps a number into its range', () => {
    expect(integer(5, 'Width', 80, 600)).toBe(80)
    expect(integer(9999, 'Width', 80, 600)).toBe(600)
    expect(integer(120, 'Width', 80, 600)).toBe(120)
  })

  it('refuses a number that is not one', () => {
    refuses(() => integer('wide', 'Width', 80, 600))
    refuses(() => integer(Number.NaN, 'Width', 80, 600))
  })

  it('accepts a real date and refuses a fake one', () => {
    expect(isoDate('2026-09-05', 'Due date')).toBe('2026-09-05')
    refuses(() => isoDate('2026-13-45', 'Due date'))
    refuses(() => isoDate('banana', 'Due date'))
  })

  it('refuses a timestamp that cannot be parsed', () => {
    // This one reached `new Date(NaN).toISOString()` and threw a 500.
    refuses(() => isoTimestamp('banana', 'The start time'))
  })

  it('refuses a timestamp from outside any sensible range', () => {
    refuses(() => isoTimestamp('1000-01-01T00:00:00Z', 'The start time'))
    refuses(() => isoTimestamp('3000-01-01T00:00:00Z', 'The start time'))
  })

  it('accepts an ordinary timestamp', () => {
    expect(isoTimestamp('2026-09-05T09:30:00Z', 'The start time'))
      .toBe('2026-09-05T09:30:00.000Z')
  })
})

describe('reading a request body', () => {
  const req = (json: () => Promise<unknown>) => ({ json })

  it('reads an object', async () => {
    await expect(readJson(req(async () => ({ a: 1 })))).resolves.toEqual({ a: 1 })
  })

  it('turns malformed JSON into a 400, not a 500', async () => {
    await expect(
      readJson(req(async () => { throw new SyntaxError('bad') })),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses null and arrays, which crash on the first property read', async () => {
    await expect(readJson(req(async () => null))).rejects.toMatchObject({ status: 400 })
    await expect(readJson(req(async () => [1, 2]))).rejects.toMatchObject({ status: 400 })
  })
})
