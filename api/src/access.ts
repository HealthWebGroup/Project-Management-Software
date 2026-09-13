import { HttpError } from './errors'
import type { BoardPermission, Principal, Sensitivity } from './types'

/**
 * What a caller may do with a board.
 *
 * METADATA means "may know the board exists, may not open it". It is what an
 * admin gets on a RESTRICTED board they have not been named on: they can see
 * it in the list and manage it as an object, without reading the contents.
 */
export const Access = {
  NONE: 0,
  METADATA: 1,
  VIEW: 2,
  EDIT: 3,
  ADMIN: 4,
} as const

export type AccessLevel = (typeof Access)[keyof typeof Access]

export const canOpen = (level: AccessLevel): boolean => level >= Access.VIEW
export const canEdit = (level: AccessLevel): boolean => level >= Access.EDIT
export const canAdminister = (level: AccessLevel): boolean => level >= Access.ADMIN

export interface BoardForAccess {
  sensitivity: Sensitivity
  /** Null means an internal board, not tied to any client. */
  client_id?: string | null
}

/**
 * The single place board permissions are decided. Routes ask this and nothing
 * else - never the interface, never the caller's claim about what they may do.
 *
 * Three things decide it, in order:
 *
 *   1. An explicit board_member row. Always wins, in both directions: it can
 *      grant a guest access to one board, or be the only way into a
 *      RESTRICTED one.
 *   2. Client assignment. A MEMBER or VIEWER only reaches boards belonging to
 *      a client they are assigned to, plus internal boards with no client.
 *      Admins and managers are assigned to everything implicitly.
 *   3. The board's sensitivity against the caller's role.
 */
export function accessTo(
  principal: Principal | null,
  board: BoardForAccess | null,
  explicit?: BoardPermission | null,
): AccessLevel {
  if (!principal || !board) return Access.NONE

  // 1. A named permission on this specific board.
  if (explicit) {
    return explicit === 'VIEW' ? Access.VIEW : explicit === 'EDIT' ? Access.EDIT : Access.ADMIN
  }

  const seesEveryClient = principal.role === 'ADMIN' || principal.role === 'MANAGER'

  // 2. Client scoping. An internal board (no client) is visible to staff.
  if (!seesEveryClient && board.client_id) {
    if (!principal.clientIds.includes(board.client_id)) return Access.NONE
  }

  // 3. Sensitivity against role.
  switch (board.sensitivity) {
    // Named people only. Nobody reaches this by role alone - if you are not
    // on the board, you are not on the board.
    case 'RESTRICTED':
      return principal.role === 'ADMIN' ? Access.METADATA : Access.NONE

    // Commercially sensitive: contracts, pay, anything you would not leave
    // open on a screen in the office.
    case 'CONFIDENTIAL':
      if (principal.role === 'ADMIN') return Access.ADMIN
      if (principal.role === 'MANAGER') return Access.EDIT
      return Access.NONE

    // Ordinary work.
    case 'INTERNAL':
      switch (principal.role) {
        case 'ADMIN':
        case 'MANAGER':
          return Access.ADMIN
        case 'MEMBER':
          return Access.EDIT
        case 'VIEWER':
          return Access.VIEW
        case 'GUEST':
        default:
          return Access.NONE
      }
  }
}

export function requireOpen(level: AccessLevel): AccessLevel {
  if (!canOpen(level)) throw HttpError.forbidden('You do not have access to this board.')
  return level
}

export function requireEdit(level: AccessLevel): AccessLevel {
  if (!canEdit(level)) throw HttpError.forbidden('You have view-only access to this board.')
  return level
}

export function requireAdmin(level: AccessLevel): AccessLevel {
  if (!canAdminister(level)) {
    throw HttpError.forbidden('Only a board administrator can change its structure.')
  }
  return level
}

/**
 * New boards start at the sensitivity that matches what they hold. Loosening
 * one later is a deliberate act; discovering it was open all along is not.
 */
export function defaultSensitivity(template: string): Sensitivity {
  return template === 'HIRING' ? 'CONFIDENTIAL' : 'INTERNAL'
}

export const isManager = (principal: Principal): boolean =>
  principal.role === 'ADMIN' || principal.role === 'MANAGER'

export const isAdmin = (principal: Principal): boolean => principal.role === 'ADMIN'
