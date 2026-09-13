import { describe, expect, it } from 'vitest'
import { Access, accessTo, canEdit, canOpen, isAdmin, isManager } from './access'
import type { Principal } from './types'

/**
 * The split the team asked for.
 *
 * Everyone does the work; one person decides who may see it. These tests
 * pin both halves, because it is the kind of rule that quietly erodes —
 * someone widens a check to unblock a colleague and nobody notices that
 * the restriction has gone.
 */

const who = (role: Principal['role'], clientIds: string[] = []): Principal => ({
  userId: `u-${role}`,
  organisationId: 'org',
  email: `${role}@healthwebgroup.com`,
  fullName: role,
  role,
  sessionId: 's',
  clientIds,
})

const yogesh = who('ADMIN')
const niall = who('MANAGER')
const daren = who('MANAGER')
const member = who('MEMBER', ['client-a'])

describe('who may grant access', () => {
  it('only the administrator counts as an administrator', () => {
    expect(isAdmin(yogesh)).toBe(true)
    expect(isAdmin(niall)).toBe(false)
    expect(isAdmin(daren)).toBe(false)
    expect(isAdmin(member)).toBe(false)
  })
})

describe('who may do the work', () => {
  it('managers are not a lesser role for getting things done', () => {
    expect(isManager(niall)).toBe(true)
    expect(isManager(daren)).toBe(true)
    expect(isManager(yogesh)).toBe(true)
  })

  it('a manager can edit any internal board', () => {
    const board = { sensitivity: 'INTERNAL' as const, client_id: null }
    expect(canEdit(accessTo(niall, board))).toBe(true)
    expect(canEdit(accessTo(daren, board))).toBe(true)
  })

  it('a manager reaches every client without being assigned one', () => {
    const board = { sensitivity: 'INTERNAL' as const, client_id: 'client-z' }
    expect(niall.clientIds).toEqual([])
    expect(canEdit(accessTo(niall, board))).toBe(true)
  })

  it('so Niall and Daren see each other’s work', () => {
    const board = { sensitivity: 'INTERNAL' as const, client_id: 'client-a' }
    expect(canOpen(accessTo(niall, board))).toBe(true)
    expect(canOpen(accessTo(daren, board))).toBe(true)
  })
})

describe('what a manager still cannot reach', () => {
  it('a restricted board admits nobody by role alone', () => {
    const board = { sensitivity: 'RESTRICTED' as const, client_id: null }
    expect(canOpen(accessTo(niall, board))).toBe(false)
    expect(canOpen(accessTo(daren, board))).toBe(false)
    // Even the administrator only learns it exists.
    expect(accessTo(yogesh, board)).toBe(Access.METADATA)
    expect(canOpen(accessTo(yogesh, board))).toBe(false)
  })

  it('but a named permission still lets a specific person in', () => {
    const board = { sensitivity: 'RESTRICTED' as const, client_id: null }
    expect(canEdit(accessTo(niall, board, 'EDIT'))).toBe(true)
  })
})

describe('a member is still scoped to their clients', () => {
  it('reaches an assigned client', () => {
    expect(canOpen(accessTo(member, { sensitivity: 'INTERNAL', client_id: 'client-a' }))).toBe(true)
  })

  it('and not an unassigned one', () => {
    expect(canOpen(accessTo(member, { sensitivity: 'INTERNAL', client_id: 'client-b' }))).toBe(false)
  })

  it('and cannot open a confidential board', () => {
    expect(canOpen(accessTo(member, { sensitivity: 'CONFIDENTIAL', client_id: null }))).toBe(false)
    expect(canOpen(accessTo(niall, { sensitivity: 'CONFIDENTIAL', client_id: null }))).toBe(true)
  })
})
