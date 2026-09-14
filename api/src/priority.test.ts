import { describe, expect, it } from 'vitest'
import { HttpError } from './errors'
import { PRIORITIES, PRIORITY_RANK, isPriority, rankOf, readPriority } from './priority'

describe('priority levels', () => {
  it('has exactly the five the database allows', () => {
    // If this ever disagrees with the check constraint in 0005_priority.sql,
    // a value passes validation here and is then rejected by SQLite - which
    // surfaces to the user as a 500 on a perfectly reasonable click.
    expect([...PRIORITIES]).toEqual(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  })

  it('ranks them in ascending urgency with NONE at the bottom', () => {
    const ranks = PRIORITIES.map((p) => PRIORITY_RANK[p])
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(PRIORITY_RANK.NONE).toBe(0)
    expect(PRIORITY_RANK.CRITICAL).toBeGreaterThan(PRIORITY_RANK.HIGH)
  })

  it('gives every level a distinct rank', () => {
    // Two levels sharing a rank would make `order by priority_rank` unstable
    // between them, so a board would reshuffle for no visible reason.
    const ranks = Object.values(PRIORITY_RANK)
    expect(new Set(ranks).size).toBe(ranks.length)
  })
})

describe('isPriority', () => {
  it('accepts every real level', () => {
    for (const p of PRIORITIES) expect(isPriority(p)).toBe(true)
  })

  it('refuses lower case, near misses and non-strings', () => {
    for (const bad of ['high', 'High', 'URGENT', 'MED', '', ' HIGH', 'HIGH ',
                       null, undefined, 3, {}, ['HIGH']]) {
      expect(isPriority(bad)).toBe(false)
    }
  })
})

describe('readPriority', () => {
  it('returns undefined when the caller did not mention priority', () => {
    // undefined has to mean "leave what is stored alone". If this ever
    // returned 'NONE', every edit of a title anywhere would quietly wipe
    // the priority off that item.
    expect(readPriority(undefined)).toBeUndefined()
    expect(readPriority(null)).toBeUndefined()
  })

  it('returns NONE when NONE was actually sent', () => {
    // Distinct from the case above: this is somebody clearing it on purpose.
    expect(readPriority('NONE')).toBe('NONE')
  })

  it('passes through every valid level', () => {
    for (const p of PRIORITIES) expect(readPriority(p)).toBe(p)
  })

  it('refuses anything else rather than coercing it', () => {
    for (const bad of ['high', 'URGENT', 42, true, {}, []]) {
      expect(() => readPriority(bad)).toThrow(HttpError)
    }
  })

  it('names the allowed values in the error, so the message is actionable', () => {
    try {
      readPriority('URGENT')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as HttpError).message).toContain('CRITICAL')
      expect((e as HttpError).status).toBe(400)
    }
  })
})

describe('rankOf', () => {
  it('sorts a mixed list critical-first when used descending', () => {
    const items = [
      { title: 'c', priority: 'LOW' as const },
      { title: 'a', priority: 'CRITICAL' as const },
      { title: 'd', priority: 'NONE' as const },
      { title: 'b', priority: 'HIGH' as const },
    ]
    const sorted = [...items].sort((x, y) => rankOf(y.priority) - rankOf(x.priority))
    expect(sorted.map((i) => i.title)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('leaves equal priorities in the order they arrived', () => {
    // The board sorts by priority then by sort_order. If equal priorities
    // did not hold their relative order, arranging a list by hand and then
    // setting two items to the same priority would scramble the arrangement.
    const items = [
      { title: 'first', priority: 'MEDIUM' as const },
      { title: 'second', priority: 'MEDIUM' as const },
      { title: 'third', priority: 'MEDIUM' as const },
    ]
    const sorted = [...items].sort((x, y) => rankOf(y.priority) - rankOf(x.priority))
    expect(sorted.map((i) => i.title)).toEqual(['first', 'second', 'third'])
  })
})
