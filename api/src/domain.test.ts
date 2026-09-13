import { describe, expect, it } from 'vitest'
import { emailAllowed } from './auth'
import type { Env } from './types'

/**
 * Who may have an account here.
 *
 * The interesting cases are the near-misses. A domain check written as
 * "ends with healthwebgroup.com" lets evil-healthwebgroup.com straight in,
 * and one written as "contains" is worse still. These tests exist to fail
 * if anyone ever rewrites this as a suffix match.
 */

const env = (over: Partial<Env> = {}) =>
  ({
    BOOTSTRAP_ADMIN_EMAIL: 'business@healthwebgroup.com',
    ALLOWED_EMAIL_DOMAINS: 'healthwebgroup.com',
    ...over,
  }) as Env

describe('emailAllowed', () => {
  it('admits an address on the allowed domain', () => {
    expect(emailAllowed('sinead@healthwebgroup.com', env())).toBe(true)
  })

  it('refuses an address on another domain', () => {
    expect(emailAllowed('someone@gmail.com', env())).toBe(false)
  })

  it('is case insensitive', () => {
    expect(emailAllowed('Sinead@HealthWebGroup.COM', env())).toBe(true)
  })

  it('ignores surrounding whitespace', () => {
    expect(emailAllowed('  sinead@healthwebgroup.com  ', env())).toBe(true)
  })

  // The whole point of the test file.
  it('refuses a domain that merely ends with the allowed one', () => {
    expect(emailAllowed('attacker@evil-healthwebgroup.com', env())).toBe(false)
    expect(emailAllowed('attacker@nothealthwebgroup.com', env())).toBe(false)
  })

  it('refuses the allowed domain used as a prefix of another', () => {
    expect(emailAllowed('attacker@healthwebgroup.com.evil.net', env())).toBe(false)
  })

  it('refuses a subdomain of the allowed domain', () => {
    expect(emailAllowed('attacker@mail.healthwebgroup.com', env())).toBe(false)
  })

  it('uses the last @ so a display trick cannot smuggle a domain in', () => {
    expect(emailAllowed('attacker@healthwebgroup.com@evil.net', env())).toBe(false)
  })

  it('refuses an address with no @ at all', () => {
    expect(emailAllowed('healthwebgroup.com', env())).toBe(false)
  })

  it('always admits the bootstrap administrator, whatever their domain', () => {
    expect(emailAllowed('business@healthwebgroup.com', env())).toBe(true)
    expect(
      emailAllowed('info@harbourhealthgroup.com', env({ BOOTSTRAP_ADMIN_EMAIL: 'info@harbourhealthgroup.com' })),
    ).toBe(true)
  })

  it('admits everyone when no domains are configured', () => {
    expect(emailAllowed('anyone@anywhere.com', env({ ALLOWED_EMAIL_DOMAINS: '' }))).toBe(true)
    expect(emailAllowed('anyone@anywhere.com', env({ ALLOWED_EMAIL_DOMAINS: undefined }))).toBe(true)
  })

  it('accepts several domains, with or without a leading @', () => {
    const many = env({ ALLOWED_EMAIL_DOMAINS: 'healthwebgroup.com, @harbourhealthgroup.com' })
    expect(emailAllowed('a@healthwebgroup.com', many)).toBe(true)
    expect(emailAllowed('b@harbourhealthgroup.com', many)).toBe(true)
    expect(emailAllowed('c@elsewhere.com', many)).toBe(false)
  })
})
