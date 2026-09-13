import { HttpError } from './errors'

/**
 * The headers and checks that apply to every request, in one place.
 */

/**
 * A content security policy.
 *
 * The interface is a single built bundle served from this same Worker, so it
 * needs nothing from anywhere else — which means the policy can be strict
 * rather than aspirational. Everything comes from 'self'; nothing may frame
 * us; nothing may be framed by us; forms may only submit here.
 *
 * `style-src` allows inline styles because the interface sets a handful of
 * computed positions (the width of a timeline bar, a progress bar) as style
 * attributes. Scripts get no such allowance: `script-src 'self'` with no
 * 'unsafe-inline' is the line that matters, and it is the difference between
 * a stray bit of injected markup being ugly and it being a session theft.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

export function securityHeaders(response: Headers): void {
  response.set('Content-Security-Policy', CSP)
  response.set('X-Content-Type-Options', 'nosniff')
  response.set('X-Frame-Options', 'DENY')
  response.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // A year, and only meaningful over HTTPS — which is the only way Workers
  // serve a custom domain anyway.
  response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  // Nothing here uses a camera, a microphone or a location.
  response.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()')
}

/**
 * Refuse a state-changing request that came from somebody else's page.
 *
 * Cloudflare Access authenticates with a cookie, and a cookie is sent by the
 * browser whether the request came from our interface or from a form on a
 * site the user happened to open. This is the check that tells those apart.
 *
 * Two signals, either of which is enough:
 *
 *   Sec-Fetch-Site  set by the browser, cannot be forged by page script.
 *                   'same-origin' is ours; 'cross-site' is not.
 *   Origin          the origin of the page that made the request.
 *
 * A request with neither is allowed through, because that is what a
 * command-line client or a mobile app looks like — and those carry a bearer
 * token rather than a cookie, so they were never the risk. The point is not
 * to authenticate the caller; it is to stop a browser being used as one.
 */
export function requireSameOrigin(request: Request): void {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return

  const site = request.headers.get('Sec-Fetch-Site')
  if (site) {
    if (site === 'same-origin' || site === 'none') return
    throw HttpError.forbidden(
      'That request came from another site. If you are using the app normally, reload the page and try again.',
    )
  }

  const origin = request.headers.get('Origin')
  if (!origin) return
  const here = new URL(request.url).origin
  if (origin !== here) {
    throw HttpError.forbidden(
      'That request came from another site. If you are using the app normally, reload the page and try again.',
    )
  }
}

/**
 * A crude throttle for the password path.
 *
 * Held in the isolate's memory, so it is per-instance and resets when the
 * Worker is recycled. That is genuinely weak — it will not stop a determined
 * distributed attack — but it turns an unlimited-rate online guessing attack
 * into a slow one, at no cost and with no extra service. The real defence is
 * that this path is off by default and Cloudflare Access sits in front.
 *
 * Not used for the Access path, which does not accept a password at all.
 */
const attempts = new Map<string, { count: number; first: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

export function throttleLogin(key: string): void {
  const now = Date.now()
  const seen = attempts.get(key)

  if (!seen || now - seen.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now })
    // Keep the map from growing without bound if the isolate lives a long time.
    if (attempts.size > 5000) {
      for (const [id, entry] of attempts) {
        if (now - entry.first > WINDOW_MS) attempts.delete(id)
      }
    }
    return
  }

  seen.count++
  if (seen.count > MAX_ATTEMPTS) {
    throw new HttpError(429, 'Too many sign-in attempts. Wait a few minutes and try again.')
  }
}

/** Forget the attempts for a key once its owner proves who they are. */
export function clearThrottle(key: string): void {
  attempts.delete(key)
}
