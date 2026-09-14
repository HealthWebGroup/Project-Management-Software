import { describe, expect, it } from 'vitest'
import { Access, accessTo, canOpen } from './access'
import { likePattern } from './routes/search'
import type { Principal, Sensitivity } from './types'

/**
 * Search crosses every board in the organisation, so it is the one route
 * where getting access wrong leaks another client's work as a list of task
 * titles. These pin the decision search makes for each row.
 *
 * They deliberately exercise `accessTo` with the shape the search route
 * passes it, rather than testing the route end to end: the bug this file
 * exists to prevent was passing the WRONG OBJECT to the right function,
 * and a test that builds the object correctly by hand would have missed it
 * just as happily as the code did.
 */

const member = (clientIds: string[]): Principal => ({
  userId: 'u1',
  organisationId: 'org1',
  role: 'MEMBER',
  fullName: 'A Member',
  email: 'member@healthwebgroup.com',
  clientIds,
  sessionId: null,
})

const manager: Principal = { ...member([]), userId: 'u2', role: 'MANAGER' }
const admin: Principal = { ...member([]), userId: 'u3', role: 'ADMIN' }

/** Exactly what routes/search.ts builds for each row. */
const rowFor = (boardClientId: string | null, sensitivity: Sensitivity = 'INTERNAL') => ({
  sensitivity,
  client_id: boardClientId,
})

describe('what search may return', () => {
  it('hides a client board from someone not on that client', () => {
    const level = accessTo(member(['harbour']), rowFor('veda'), null)
    expect(canOpen(level)).toBe(false)
  })

  it('shows a client board to someone who is on that client', () => {
    expect(canOpen(accessTo(member(['veda']), rowFor('veda'), null))).toBe(true)
  })

  it('shows internal boards to staff', () => {
    expect(canOpen(accessTo(member([]), rowFor(null), null))).toBe(true)
  })

  it('shows every client to managers and admins', () => {
    expect(canOpen(accessTo(manager, rowFor('veda'), null))).toBe(true)
    expect(canOpen(accessTo(admin, rowFor('veda'), null))).toBe(true)
  })

  it('keeps RESTRICTED boards out of search for everyone by role alone', () => {
    // METADATA is "you may know it exists", which is not enough to list its
    // task titles. An admin included: canOpen(METADATA) must be false.
    expect(accessTo(admin, rowFor('veda', 'RESTRICTED'), null)).toBe(Access.METADATA)
    expect(canOpen(accessTo(admin, rowFor('veda', 'RESTRICTED'), null))).toBe(false)
    expect(canOpen(accessTo(manager, rowFor('veda', 'RESTRICTED'), null))).toBe(false)
    expect(canOpen(accessTo(member(['veda']), rowFor('veda', 'RESTRICTED'), null))).toBe(false)
  })

  it('lets a named person reach a RESTRICTED board they are on', () => {
    expect(canOpen(accessTo(member([]), rowFor('veda', 'RESTRICTED'), 'VIEW'))).toBe(true)
  })

  /**
   * The bug this file was written for.
   *
   * The first draft of the search route selected the ITEM's client id and
   * passed that to accessTo. An item with no client of its own, sitting on
   * a client's board, then arrived as { client_id: null } — which reads as
   * "internal board" and skips the client check completely. Every member
   * would have seen that task's title.
   */
  it('refuses a client board even when the item on it has no client', () => {
    const boardBelongsToVeda = rowFor('veda')
    const whatTheBuggyVersionPassed = rowFor(null)   // the item's null client

    expect(canOpen(accessTo(member(['harbour']), boardBelongsToVeda, null))).toBe(false)
    // …and this is what it would have done instead, which is the leak:
    expect(canOpen(accessTo(member(['harbour']), whatTheBuggyVersionPassed, null))).toBe(true)
  })
})

describe('likePattern', () => {
  it('wraps a plain term in wildcards', () => {
    expect(likePattern('veda')).toBe('%veda%')
  })

  it('lower-cases, because the query compares against lower(title)', () => {
    expect(likePattern('VEDA')).toBe('%veda%')
  })

  it('escapes % so "50%" finds a literal 50%, not everything', () => {
    // Without this, searching "50%" returns every task in the organisation:
    // the pattern becomes %50%% which matches any title containing "50".
    expect(likePattern('50%')).toBe('%50\\%%')
  })

  it('escapes _ so it cannot act as a single-character wildcard', () => {
    expect(likePattern('a_b')).toBe('%a\\_b%')
  })

  it('escapes the escape character itself, and does it first', () => {
    // If \ were escaped after % and _, the backslashes added for those
    // would themselves get escaped and the pattern would be wrong.
    expect(likePattern('a\\b')).toBe('%a\\\\b%')
  })

  it('leaves ordinary punctuation alone', () => {
    expect(likePattern("o'brien & co.")).toBe("%o'brien & co.%")
  })
})
