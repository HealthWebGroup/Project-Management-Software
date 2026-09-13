import { describe, expect, it } from 'vitest'
import { validateCell } from './cells'
import { HttpError } from './errors'

/**
 * Cell validation is the gate every board edit passes through, and the place
 * where "it is only a text field" turns into stored script or a full database.
 */

const refuses = (fn: () => unknown) => {
  expect(fn).toThrow(HttpError)
}

describe('what a cell keeps', () => {
  it('keeps only the keys the column type means', () => {
    const value = validateCell('TEXT', {
      text: 'hello',
      // Anything else is dropped rather than stored - the value is written
      // twice, once as the cell and once into the audit trail.
      labelId: 'sneaky',
      userIds: ['x'],
    } as never)
    expect(value).toEqual({ text: 'hello' })
  })

  it('treats an empty object as "not set"', () => {
    expect(validateCell('STATUS', {})).toEqual({})
    expect(validateCell('STATUS', undefined)).toEqual({})
    expect(validateCell('STATUS', null)).toEqual({})
  })

  it('refuses an array where an object belongs', () => {
    expect(validateCell('TEXT', [] as never)).toEqual({})
  })
})

describe('lengths', () => {
  it('refuses text longer than a title should be', () => {
    refuses(() => validateCell('TEXT', { text: 'a'.repeat(600) }))
  })

  it('allows a long note in a long-text column', () => {
    expect(validateCell('LONG_TEXT', { text: 'a'.repeat(5000) })).toEqual({ text: 'a'.repeat(5000) })
  })

  it('refuses a note beyond even that', () => {
    refuses(() => validateCell('LONG_TEXT', { text: 'a'.repeat(30_000) }))
  })
})

describe('links', () => {
  it('accepts an ordinary web address', () => {
    expect(validateCell('LINK', { url: 'https://example.com/x' }))
      .toEqual({ url: 'https://example.com/x' })
  })

  it('refuses javascript:, which would run on our own origin', () => {
    refuses(() => validateCell('LINK', { url: 'javascript:alert(document.cookie)' }))
  })

  it('refuses a data: address, which is the same trick', () => {
    refuses(() => validateCell('LINK', { url: 'data:text/html,<script>alert(1)</script>' }))
  })

  it('refuses something that is not a URL at all', () => {
    refuses(() => validateCell('LINK', { url: 'not a url' }))
  })
})

describe('people', () => {
  it('accepts a list of identifiers', () => {
    const ids = ['22222222-0000-4000-8000-000000000001']
    expect(validateCell('PEOPLE', { userIds: ids })).toEqual({ userIds: ids })
  })

  it('refuses anything that is not an identifier', () => {
    refuses(() => validateCell('PEOPLE', { userIds: ['not-a-uuid'] }))
  })

  it('refuses a list long enough to be an attack', () => {
    const many = new Array(500).fill('22222222-0000-4000-8000-000000000001')
    refuses(() => validateCell('PEOPLE', { userIds: many }))
  })
})

describe('dates', () => {
  it('accepts a real date', () => {
    expect(validateCell('DATE', { date: '2026-09-05' })).toEqual({ date: '2026-09-05' })
  })

  it('refuses a date in the wrong shape', () => {
    refuses(() => validateCell('DATE', { date: '5 September' }))
  })

  it('accepts a timeline that runs forwards', () => {
    expect(validateCell('TIMELINE', { start: '2026-09-01', end: '2026-09-05' }))
      .toEqual({ start: '2026-09-01', end: '2026-09-05' })
  })

  it('accepts a timeline of a single day', () => {
    expect(validateCell('TIMELINE', { start: '2026-09-01', end: '2026-09-01' }))
      .toEqual({ start: '2026-09-01', end: '2026-09-01' })
  })

  it('refuses a timeline that ends before it starts', () => {
    refuses(() => validateCell('TIMELINE', { start: '2026-09-10', end: '2026-09-01' }))
  })
})

describe('numbers and checkboxes', () => {
  it('accepts a number', () => {
    expect(validateCell('NUMBER', { number: 60 })).toEqual({ number: 60 })
  })

  it('refuses text dressed as a number', () => {
    refuses(() => validateCell('NUMBER', { number: '60' as never }))
  })

  it('refuses a number that is not finite', () => {
    refuses(() => validateCell('NUMBER', { number: Number.POSITIVE_INFINITY }))
    refuses(() => validateCell('NUMBER', { number: Number.NaN }))
  })

  it('refuses a checkbox that is not a yes or a no', () => {
    refuses(() => validateCell('CHECKBOX', { checked: 'yes' as never }))
  })
})

describe('formula columns', () => {
  it('cannot be written to directly', () => {
    refuses(() => validateCell('FORMULA', { number: 1 }))
  })
})
