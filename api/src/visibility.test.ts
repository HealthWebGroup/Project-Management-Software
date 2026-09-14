import { describe, expect, it } from 'vitest'
import { accessTo, canOpen } from './access'
import type { ClientRole, Principal, Role } from './types'

/**
 * "Who can see this client" is shown to a person deciding whether a
 * client's commercial notes are safe. If that answer ever disagrees with
 * what the application actually enforces, it is worse than showing
 * nothing — it is a confident wrong answer about confidentiality.
 *
 * The route computes it by mirroring two functions: `clientIdsFor` in
 * auth.ts (ADMIN and MANAGER get an empty client list because they see
 * everything) and the client check inside `accessTo`. These tests hold
 * those two together: the same inputs go through the real `accessTo` and
 * through a copy of the route's rule, and the two must always agree.
 *
 * If somebody later restricts managers to their assigned clients — the
 * change that was offered and declined — the `accessTo` side of these
 * tests starts failing, which is exactly the reminder needed to update
 * the route rather than leave it quietly lying.
 */

/** The rule routes/clients.ts uses to fill in `canSee`. */
function routeSaysCanSee(role: Role, onTeam: boolean): boolean {
  const byRole = role === 'ADMIN' || role === 'MANAGER'
  return byRole || (role !== 'GUEST' && onTeam)
}

/** What the application actually enforces when opening that client's board. */
function appActuallyAllows(role: Role, onTeam: boolean, clientId: string): boolean {
  const principal: Principal = {
    userId: 'u', organisationId: 'org', email: 'a@b.com', fullName: 'A',
    role, sessionId: null,
    // Mirrors clientIdsFor: admins and managers carry an empty list.
    clientIds: role === 'ADMIN' || role === 'MANAGER' ? [] : onTeam ? [clientId] : [],
  }
  return canOpen(accessTo(principal, { sensitivity: 'INTERNAL', client_id: clientId }, null))
}

const ROLES: Role[] = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER', 'GUEST']

describe('the visibility answer matches what is enforced', () => {
  for (const role of ROLES) {
    for (const onTeam of [true, false]) {
      it(`${role}, ${onTeam ? 'on the team' : 'not on the team'}`, () => {
        expect(routeSaysCanSee(role, onTeam)).toBe(appActuallyAllows(role, onTeam, 'veda'))
      })
    }
  }
})

describe('the specific cases the client asked about', () => {
  it('a manager sees a client they are NOT on the team of', () => {
    // This is the whole reason "assign a team" looked like it did nothing:
    // Niall and Daren are managers.
    expect(appActuallyAllows('MANAGER', false, 'veda')).toBe(true)
    expect(routeSaysCanSee('MANAGER', false)).toBe(true)
  })

  it('a member does NOT see a client they are not on', () => {
    expect(appActuallyAllows('MEMBER', false, 'veda')).toBe(false)
    expect(routeSaysCanSee('MEMBER', false)).toBe(false)
  })

  it('a member DOES see a client once assigned', () => {
    expect(appActuallyAllows('MEMBER', true, 'veda')).toBe(true)
    expect(routeSaysCanSee('MEMBER', true)).toBe(true)
  })
})

describe('the reason shown beside each person', () => {
  /** Mirrors the route's `reason`. */
  function reasonFor(role: Role, assigned: ClientRole | undefined): string {
    const byRole = role === 'ADMIN' || role === 'MANAGER'
    return byRole
      ? (role === 'ADMIN' ? 'administrator' : 'manager')
      : role === 'GUEST' ? 'guest'
      : assigned !== undefined ? 'assigned'
      : 'none'
  }

  it('says "manager", not "assigned", for a manager who is also on the team', () => {
    // Saying "assigned" would imply that taking them off the team removes
    // their access. It does not, and that is a dangerous thing to imply on
    // a screen about confidentiality.
    expect(reasonFor('MANAGER', 'LEAD')).toBe('manager')
  })

  it('says "assigned" for a member on the team', () => {
    expect(reasonFor('MEMBER', 'MEMBER')).toBe('assigned')
  })

  it('says "none" for a member who is not', () => {
    expect(reasonFor('MEMBER', undefined)).toBe('none')
  })

  it('says "guest" for a guest, on the team or not', () => {
    expect(reasonFor('GUEST', 'MEMBER')).toBe('guest')
    expect(reasonFor('GUEST', undefined)).toBe('guest')
  })
})

describe('the `access` field the team dialog previews with', () => {
  /** Mirrors the route. */
  function accessFor(role: Role): 'always' | 'when-assigned' | 'never' {
    const byRole = role === 'ADMIN' || role === 'MANAGER'
    return byRole ? 'always' : role === 'GUEST' ? 'never' : 'when-assigned'
  }

  /** What the dialog computes from it, and the only rule it applies. */
  const previewCanSee = (role: Role, ticked: boolean): boolean => {
    const a = accessFor(role)
    return a === 'always' || (a === 'when-assigned' && ticked)
  }

  for (const role of ROLES) {
    for (const ticked of [true, false]) {
      it(`preview agrees with enforcement: ${role}, ${ticked ? 'ticked' : 'unticked'}`, () => {
        expect(previewCanSee(role, ticked)).toBe(appActuallyAllows(role, ticked, 'veda'))
      })
    }
  }

  it('says ticking changes nothing for a manager', () => {
    expect(accessFor('MANAGER')).toBe('always')
  })

  it('says ticking can never let a guest in', () => {
    expect(accessFor('GUEST')).toBe('never')
  })
})

describe('guests are not granted a client by the team list', () => {
  /**
   * The bug the table above caught in the first draft of the route.
   *
   * Putting a guest on a client's team looks like it should let them in, and
   * the route said it did. `accessTo` disagrees: a GUEST gets NONE on an
   * INTERNAL board by role, and client assignment never overrides that. A
   * guest reaches exactly the boards they have been named on individually.
   *
   * Promising access the application then refuses is the one failure mode a
   * confidentiality screen must not have, so it is pinned here.
   */
  it('a guest on the team still cannot open the client board', () => {
    expect(appActuallyAllows('GUEST', true, 'veda')).toBe(false)
    expect(routeSaysCanSee('GUEST', true)).toBe(false)
  })

  it('a guest named on one board reaches that board only', () => {
    const guest: Principal = {
      userId: 'g', organisationId: 'org', email: 'g@outside.com', fullName: 'G',
      role: 'GUEST', sessionId: null, clientIds: [],
    }
    const board = { sensitivity: 'INTERNAL' as const, client_id: 'veda' }
    expect(canOpen(accessTo(guest, board, 'VIEW'))).toBe(true)
    expect(canOpen(accessTo(guest, board, null))).toBe(false)
  })
})
