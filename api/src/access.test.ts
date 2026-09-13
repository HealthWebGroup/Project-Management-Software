import { describe, expect, it } from 'vitest'
import { Access, accessTo, canAdminister, canEdit, canOpen, defaultSensitivity } from './access'
import type { Principal, Role, Sensitivity } from './types'

/**
 * The access rules, tested as a matrix.
 *
 * This is the one piece of the system where a quiet mistake means somebody
 * reads a client's work they were never meant to see. Every route asks
 * `accessTo` and nothing else, so covering it here covers all of them.
 */

const HARBOUR = 'client-harbour'
const RIVERSIDE = 'client-riverside'

function person(role: Role, clientIds: string[] = []): Principal {
  return {
    userId: `u-${role}`,
    organisationId: 'org',
    email: `${role.toLowerCase()}@example.com`,
    fullName: role,
    role,
    sessionId: null,
    clientIds,
  }
}

const board = (sensitivity: Sensitivity, clientId: string | null = null) => ({
  sensitivity,
  client_id: clientId,
})

describe('an internal board belonging to a client', () => {
  const harbourBoard = board('INTERNAL', HARBOUR)

  it('lets an administrator administer it', () => {
    expect(accessTo(person('ADMIN'), harbourBoard)).toBe(Access.ADMIN)
  })

  it('lets a manager administer it without being assigned to the client', () => {
    expect(accessTo(person('MANAGER'), harbourBoard)).toBe(Access.ADMIN)
  })

  it('lets an assigned member edit it', () => {
    expect(accessTo(person('MEMBER', [HARBOUR]), harbourBoard)).toBe(Access.EDIT)
  })

  it('gives an assigned viewer read-only access', () => {
    expect(accessTo(person('VIEWER', [HARBOUR]), harbourBoard)).toBe(Access.VIEW)
  })

  it('shuts out a member assigned to a different client', () => {
    expect(accessTo(person('MEMBER', [RIVERSIDE]), harbourBoard)).toBe(Access.NONE)
  })

  it('shuts out a member assigned to nothing', () => {
    expect(accessTo(person('MEMBER'), harbourBoard)).toBe(Access.NONE)
  })

  it('shuts out a guest, assigned or not', () => {
    expect(accessTo(person('GUEST', [HARBOUR]), harbourBoard)).toBe(Access.NONE)
  })
})

describe('an internal board belonging to no client', () => {
  const internal = board('INTERNAL', null)

  it('is visible to a member with no client assignments at all', () => {
    expect(accessTo(person('MEMBER'), internal)).toBe(Access.EDIT)
  })

  it('is still closed to a guest', () => {
    expect(accessTo(person('GUEST'), internal)).toBe(Access.NONE)
  })
})

describe('a confidential board', () => {
  const hiring = board('CONFIDENTIAL', null)

  it('is administered by an administrator', () => {
    expect(accessTo(person('ADMIN'), hiring)).toBe(Access.ADMIN)
  })

  it('is editable by a manager', () => {
    expect(accessTo(person('MANAGER'), hiring)).toBe(Access.EDIT)
  })

  it('is closed to a member, however they are assigned', () => {
    expect(accessTo(person('MEMBER', [HARBOUR, RIVERSIDE]), hiring)).toBe(Access.NONE)
  })

  it('is closed to a viewer', () => {
    expect(accessTo(person('VIEWER', [HARBOUR]), hiring)).toBe(Access.NONE)
  })
})

describe('a restricted board', () => {
  const restricted = board('RESTRICTED', null)

  it('lets an administrator know it exists but not open it', () => {
    const level = accessTo(person('ADMIN'), restricted)
    expect(level).toBe(Access.METADATA)
    expect(canOpen(level)).toBe(false)
  })

  it('is invisible to a manager', () => {
    expect(accessTo(person('MANAGER'), restricted)).toBe(Access.NONE)
  })

  it('is invisible to a member', () => {
    expect(accessTo(person('MEMBER', [HARBOUR]), restricted)).toBe(Access.NONE)
  })

  it('opens only for someone named on it', () => {
    expect(accessTo(person('MEMBER'), restricted, 'VIEW')).toBe(Access.VIEW)
    expect(accessTo(person('GUEST'), restricted, 'EDIT')).toBe(Access.EDIT)
  })
})

describe('a named permission on one board', () => {
  it('lets a guest into a board their role would never reach', () => {
    expect(accessTo(person('GUEST'), board('INTERNAL', HARBOUR), 'EDIT')).toBe(Access.EDIT)
  })

  it('lets a member into a client they are not assigned to', () => {
    expect(accessTo(person('MEMBER', [RIVERSIDE]), board('INTERNAL', HARBOUR), 'VIEW'))
      .toBe(Access.VIEW)
  })

  it('caps an administrator at view when that is what they were given', () => {
    // It wins in both directions: the point of naming people is that the
    // named list is the answer, not a floor under the role.
    expect(accessTo(person('ADMIN'), board('INTERNAL', HARBOUR), 'VIEW')).toBe(Access.VIEW)
  })
})

describe('the guard rails', () => {
  it('refuses everything when there is no caller', () => {
    expect(accessTo(null, board('INTERNAL'))).toBe(Access.NONE)
  })

  it('refuses everything when there is no board', () => {
    expect(accessTo(person('ADMIN'), null)).toBe(Access.NONE)
  })

  it('orders the levels so the helpers agree with each other', () => {
    expect(canOpen(Access.METADATA)).toBe(false)
    expect(canOpen(Access.VIEW)).toBe(true)
    expect(canEdit(Access.VIEW)).toBe(false)
    expect(canEdit(Access.EDIT)).toBe(true)
    expect(canAdminister(Access.EDIT)).toBe(false)
    expect(canAdminister(Access.ADMIN)).toBe(true)
  })

  it('starts a hiring board confidential and everything else internal', () => {
    expect(defaultSensitivity('HIRING')).toBe('CONFIDENTIAL')
    expect(defaultSensitivity('PROJECTS')).toBe('INTERNAL')
    expect(defaultSensitivity('CUSTOM')).toBe('INTERNAL')
  })
})
