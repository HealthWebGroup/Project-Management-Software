import { describe, expect, it } from 'vitest'
import { HttpError } from './errors'
import { clearThrottle, requireSameOrigin, securityHeaders, throttleLogin } from './security'

function request(method: string, headers: Record<string, string> = {}) {
  return new Request('https://task.healthwebgroup.com/api/items', { method, headers })
}

describe('the cross-site check', () => {
  it('lets a request from our own page through', () => {
    expect(() => requireSameOrigin(request('POST', { 'Sec-Fetch-Site': 'same-origin' })))
      .not.toThrow()
  })

  it('refuses a request another site made', () => {
    // The attack this stops: a form on someone else's page, submitted with
    // the reader's Cloudflare Access cookie attached by the browser.
    expect(() => requireSameOrigin(request('POST', { 'Sec-Fetch-Site': 'cross-site' })))
      .toThrow(HttpError)
  })

  it('refuses a same-site-but-different-subdomain request', () => {
    expect(() => requireSameOrigin(request('POST', { 'Sec-Fetch-Site': 'same-site' })))
      .toThrow(HttpError)
  })

  it('refuses when the Origin header names somewhere else', () => {
    expect(() => requireSameOrigin(request('POST', { Origin: 'https://evil.example' })))
      .toThrow(HttpError)
  })

  it('allows when the Origin header is our own', () => {
    expect(() =>
      requireSameOrigin(request('POST', { Origin: 'https://task.healthwebgroup.com' })),
    ).not.toThrow()
  })

  it('allows a request with neither header, which is a script or an app', () => {
    // Those carry a bearer token rather than a cookie, so they were never the
    // risk this check exists for.
    expect(() => requireSameOrigin(request('POST'))).not.toThrow()
  })

  it('never blocks a read', () => {
    expect(() => requireSameOrigin(request('GET', { 'Sec-Fetch-Site': 'cross-site' })))
      .not.toThrow()
    expect(() => requireSameOrigin(request('HEAD', { Origin: 'https://evil.example' })))
      .not.toThrow()
  })
})

describe('the headers on every response', () => {
  const headers = new Headers()
  securityHeaders(headers)

  it('forbids scripts from anywhere but here', () => {
    const csp = headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('forbids being framed, which is what clickjacking needs', () => {
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(headers.get('X-Frame-Options')).toBe('DENY')
  })

  it('forbids a rewritten base tag and plugin content', () => {
    const csp = headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('asks for HTTPS from here on', () => {
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=31536000')
  })

  it('stops the browser guessing a content type', () => {
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

describe('the sign-in throttle', () => {
  it('allows a reasonable number of attempts and then stops', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < 10; i++) expect(() => throttleLogin(key)).not.toThrow()
    expect(() => throttleLogin(key)).toThrow(HttpError)
  })

  it('returns 429 rather than something that looks like a wrong password', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < 10; i++) throttleLogin(key)
    try {
      throttleLogin(key)
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as HttpError).status).toBe(429)
    }
  })

  it('forgets the attempts once someone signs in successfully', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < 9; i++) throttleLogin(key)
    clearThrottle(key)
    for (let i = 0; i < 10; i++) expect(() => throttleLogin(key)).not.toThrow()
  })

  it('counts each key separately, so one address cannot lock out another', () => {
    const mine = `test-${Math.random()}`
    const theirs = `test-${Math.random()}`
    for (let i = 0; i < 11; i++) {
      try { throttleLogin(mine) } catch { /* expected */ }
    }
    expect(() => throttleLogin(theirs)).not.toThrow()
  })
})
