import { HttpError } from './errors'
import { newId, now } from './db'
import type { Env, Principal, Role } from './types'

/* =====================================================================
   Authentication.

   The production path is Cloudflare Access: the person signs in with their
   work account at the edge, Cloudflare puts a signed JWT on the request, and
   this Worker verifies it. No password is ever stored, so there is nothing
   here to steal.

   The password path exists for local development and as a fallback. It uses
   PBKDF2 at 100,000 iterations, which is the most crypto.subtle allows on
   Workers - and which needs more CPU than the free plan's 10ms budget. It is
   therefore off unless ALLOW_PASSWORD_LOGIN is "true", and if you turn it on
   in production you need the Workers Paid plan for it to work reliably.
   ===================================================================== */

const PBKDF2_ITERATIONS = 100_000
const SESSION_IDLE_MINUTES = 30

// ------------------------------------------------------------ base64url

function b64urlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const encoder = new TextEncoder()

// ------------------------------------------------- Cloudflare Access JWT

interface Jwks {
  keys: JsonWebKey[]
}

/** Cached per isolate; Access rotates keys, so this expires. */
const jwksCache = new Map<string, { keys: CryptoKey[]; fetchedAt: number }>()
const JWKS_TTL_MS = 60 * 60 * 1000

async function accessKeys(teamName: string): Promise<CryptoKey[]> {
  const cached = jwksCache.get(teamName)
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys
  }

  const url = `https://${teamName}.cloudflareaccess.com/cdn-cgi/access/certs`
  const response = await fetch(url)
  if (!response.ok) {
    throw HttpError.unauthorised('Could not reach Cloudflare Access to verify your sign-in.')
  }
  const jwks = (await response.json()) as Jwks

  const keys = await Promise.all(
    (jwks.keys ?? []).map((jwk) =>
      crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    ),
  )

  jwksCache.set(teamName, { keys, fetchedAt: Date.now() })
  return keys
}

interface AccessClaims {
  email?: string
  aud?: string | string[]
  iss?: string
  exp?: number
  name?: string
}

/** Returns the verified claims, or null when the token is absent or invalid. */
async function verifyAccessToken(token: string, env: Env): Promise<AccessClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  let claims: AccessClaims
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])))
  } catch {
    return null
  }

  // typeof, not truthiness: a non-numeric exp makes `exp * 1000` NaN, and
  // `NaN < Date.now()` is false - so the expiry check would pass. Failing
  // open on a malformed claim is the wrong direction to fail in.
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null
  if (claims.exp * 1000 < Date.now()) return null

  const expectedIssuer = `https://${env.ACCESS_TEAM_NAME}.cloudflareaccess.com`
  if (claims.iss !== expectedIssuer) return null

  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
  if (!audiences.includes(env.ACCESS_AUD)) return null

  const signed = encoder.encode(`${parts[0]}.${parts[1]}`)
  const signature = b64urlToBytes(parts[2])

  for (const key of await accessKeys(env.ACCESS_TEAM_NAME)) {
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature as unknown as BufferSource,
      signed as unknown as BufferSource,
    )
    if (ok) return claims
  }
  return null
}

// ------------------------------------------------------ password hashing

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64url(salt)}$${bytesToB64url(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const [scheme, iterationText, saltText, hashText] = stored.split('$')
  if (scheme !== 'pbkdf2') return false

  const iterations = Number(iterationText)
  if (!Number.isFinite(iterations) || iterations < 1000) return false

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: b64urlToBytes(saltText) as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  )

  // Constant-time comparison: a timing difference here leaks the hash.
  const a = new Uint8Array(bits)
  const b = b64urlToBytes(hashText)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// ------------------------------------------------------ app-issued tokens

interface AppClaims {
  sub: string
  org: string
  email: string
  name: string
  role: Role
  sid: string
  exp: number
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify'])
}

export async function issueAppToken(claims: Omit<AppClaims, 'exp'>, secret: string, hours = 12) {
  const payload: AppClaims = { ...claims, exp: Math.floor(Date.now() / 1000) + hours * 3600 }
  const header = bytesToB64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = bytesToB64url(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign(
    'HMAC', await hmacKey(secret), encoder.encode(`${header}.${body}`),
  )
  return `${header}.${body}.${bytesToB64url(new Uint8Array(signature))}`
}

async function verifyAppToken(token: string, secret: string): Promise<AppClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    b64urlToBytes(parts[2]) as unknown as BufferSource,
    encoder.encode(`${parts[0]}.${parts[1]}`),
  )
  if (!ok) return null

  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as AppClaims
    return claims.exp * 1000 > Date.now() ? claims : null
  } catch {
    return null
  }
}

// --------------------------------------------------------- user + session

interface UserRow {
  id: string
  organisation_id: string
  email: string
  full_name: string
  role: Role
  status: string
}

/** Which clients this person is assigned to. Empty for admins and managers. */
async function clientIdsFor(env: Env, user: UserRow): Promise<string[]> {
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return []
  const rows = await env.DB
    .prepare(`select client_id from client_member where user_id = ?`)
    .bind(user.id)
    .all<{ client_id: string }>()
  return rows.results.map((r) => r.client_id)
}

/**
 * Finds the person by email, or creates them on first sign-in. Access has
 * already proved who they are, so the only question here is what they may do,
 * and a brand new colleague starts as a plain MEMBER.
 */
async function findOrCreateUser(env: Env, email: string, displayName?: string): Promise<UserRow> {
  const existing = await env.DB
    .prepare(`select id, organisation_id, email, full_name, role, status
              from app_user where lower(email) = lower(?)`)
    .bind(email)
    .first<UserRow>()

  if (existing) {
    if (existing.status !== 'ACTIVE') {
      throw HttpError.forbidden('This account is not active. Contact your administrator.')
    }
    return existing
  }

  const organisation = await env.DB
    .prepare(`select id from organisation order by created_at limit 1`)
    .first<{ id: string }>()
  if (!organisation) {
    throw new HttpError(500, 'This installation has no organisation yet. Run the migrations.')
  }

  // A new colleague starts with no client assignments at all, so they see
  // nothing but internal boards until someone grants them a client.
  const role: Role =
    email.toLowerCase() === (env.BOOTSTRAP_ADMIN_EMAIL ?? '').toLowerCase() ? 'ADMIN' : 'MEMBER'

  const id = newId()
  const fullName = displayName?.trim() || email.split('@')[0]

  await env.DB
    .prepare(`insert into app_user (id, organisation_id, email, full_name, role, status, created_at)
              values (?, ?, ?, ?, ?, 'ACTIVE', ?)`)
    .bind(id, organisation.id, email, fullName, role, now())
    .run()

  return {
    id,
    organisation_id: organisation.id,
    email,
    full_name: fullName,
    role,
    status: 'ACTIVE',
  }
}

/** Reuses the current open session, or opens one. Drives "who is online". */
export async function openOrTouchSession(env: Env, userId: string): Promise<string> {
  const cutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60000).toISOString()

  const open = await env.DB
    .prepare(`select id from user_session
              where user_id = ? and ended_at is null and last_seen_at >= ?
              order by started_at desc limit 1`)
    .bind(userId, cutoff)
    .first<{ id: string }>()

  if (open) {
    await env.DB
      .prepare(`update user_session set last_seen_at = ? where id = ?`)
      .bind(now(), open.id)
      .run()
    return open.id
  }

  // Close anything stale before starting a fresh one.
  await env.DB
    .prepare(`update user_session set ended_at = last_seen_at, end_reason = 'EXPIRED'
              where user_id = ? and ended_at is null`)
    .bind(userId)
    .run()

  const id = newId()
  await env.DB
    .prepare(`insert into user_session (id, user_id, started_at, last_seen_at) values (?, ?, ?, ?)`)
    .bind(id, userId, now(), now())
    .run()
  return id
}

// ------------------------------------------------------- domain gate

/**
 * Is this address allowed to have an account here at all?
 *
 * Empty setting means "anyone Access let through", which is the original
 * behaviour. With domains listed, an address outside them is refused even
 * if Access admitted it — belt and braces, because the two rules live in
 * different places and can drift apart.
 *
 * The bootstrap administrator is always allowed regardless. Without that
 * exception, setting this to a domain the administrator's own address is
 * not on locks the owner out of their own installation, with no way back
 * in except redeploying.
 */
export function emailAllowed(email: string, env: Env): boolean {
  const raw = (env.ALLOWED_EMAIL_DOMAINS ?? '').trim()
  if (!raw) return true

  const address = email.trim().toLowerCase()
  if (address === (env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase()) return true

  const at = address.lastIndexOf('@')
  if (at === -1) return false
  const domain = address.slice(at + 1)

  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
    // A subdomain is not the domain: "evil-healthwebgroup.com" must not pass
    // a rule for "healthwebgroup.com", and neither must "healthwebgroup.com.evil.net".
    .some((allowed) => domain === allowed)
}

// -------------------------------------------------------------- resolve

/**
 * Works out who is calling. Access first, then an app-issued token.
 * Returns null rather than throwing so public routes can stay public.
 */
export async function resolvePrincipal(
  request: Request,
  env: Env,
): Promise<Principal | null> {
  const accessToken =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    readCookie(request, 'CF_Authorization')

  if (accessToken && env.ACCESS_TEAM_NAME && env.ACCESS_AUD) {
    const claims = await verifyAccessToken(accessToken, env)
    if (claims?.email) {
      if (!emailAllowed(claims.email, env)) {
        throw HttpError.forbidden(
          'That address is not allowed to use this system. Sign in with your work account.',
        )
      }
      const user = await findOrCreateUser(env, claims.email, claims.name)
      const [sessionId, clientIds] = await Promise.all([
        openOrTouchSession(env, user.id),
        clientIdsFor(env, user),
      ])
      return {
        userId: user.id,
        organisationId: user.organisation_id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        sessionId,
        clientIds,
      }
    }
  }

  /**
   * The password path's own token.
   *
   * Gated on ALLOW_PASSWORD_LOGIN, not just on the secret existing. Checking
   * the flag only when a token is issued left a second front door open for
   * the life of the secret: turn password login off, and anything already
   * minted - or forged by anyone holding the secret - still walked past
   * Cloudflare Access entirely.
   */
  const header = request.headers.get('Authorization')
  if (header?.startsWith('Bearer ') && env.JWT_SECRET && env.ALLOW_PASSWORD_LOGIN === 'true') {
    const claims = await verifyAppToken(header.slice(7).trim(), env.JWT_SECRET)
    if (claims) {
      // Read the role and assignments from the database rather than the
      // token: a role change should take effect now, not in twelve hours.
      const user = await env.DB
        .prepare(`select id, organisation_id, email, full_name, role, status
                    from app_user where id = ?`)
        .bind(claims.sub)
        .first<UserRow>()
      if (!user || user.status !== 'ACTIVE') return null

      // Signing out has to mean something. The token is valid for twelve
      // hours, so without checking the session it names, logging out - or
      // having a stolen token revoked - changed nothing until it expired.
      if (claims.sid) {
        const session = await env.DB
          .prepare(`select id from user_session where id = ? and user_id = ? and ended_at is null`)
          .bind(claims.sid, user.id).first<{ id: string }>()
        if (!session) return null
      }

      return {
        userId: user.id,
        organisationId: user.organisation_id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        sessionId: claims.sid,
        clientIds: await clientIdsFor(env, user),
      }
    }
  }

  return null
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('Cookie')
  if (!cookies) return null
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

