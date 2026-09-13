import { Hono } from 'hono'
import { hashPassword, issueAppToken, openOrTouchSession, verifyPassword } from '../auth'
import { bool, now, recordActivity } from '../db'
import { HttpError } from '../errors'
import { clearThrottle, throttleLogin } from '../security'
import { email as emailField, readJson, text } from '../validate'
import type { Env, Role, Vars } from '../types'

export const auth = new Hono<{ Bindings: Env; Variables: Vars }>()

/**
 * Who am I? With Cloudflare Access in front, this is the only sign-in step
 * the interface needs: Cloudflare has already proved who the person is.
 */
auth.get('/auth/me', async (c) => {
  const principal = c.get('principal')
  const row = await c.env.DB
    .prepare(
      `select id, email, full_name, job_title, role, site_id, must_change_password
         from app_user where id = ?`,
    )
    .bind(principal.userId)
    .first<{
      id: string; email: string; full_name: string; job_title: string | null
      role: Role; site_id: string | null; must_change_password: number
    }>()
  if (!row) throw HttpError.notFound('User')

  await c.env.DB
    .prepare(`update app_user set last_login_at = coalesce(last_login_at, ?) where id = ?`)
    .bind(now(), row.id).run()

  return c.json({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    jobTitle: row.job_title ?? undefined,
    role: row.role,
    siteId: row.site_id ?? undefined,
    mustChangePassword: bool(row.must_change_password),
  })
})

auth.post('/auth/logout', async (c) => {
  const principal = c.get('principal')
  await c.env.DB
    .prepare(`update user_session set ended_at = ?, end_reason = 'SIGNED_OUT'
               where user_id = ? and ended_at is null`)
    .bind(now(), principal.userId).run()
  await recordActivity(c.env.DB, {
    entityType: 'USER', entityId: principal.userId, actorId: principal.userId, action: 'LOGOUT',
  })
  // With Access the browser session lives at Cloudflare's edge; the interface
  // sends the person to /cdn-cgi/access/logout to end that too.
  return c.json({ accessLogoutUrl: '/cdn-cgi/access/logout' })
})

auth.post('/auth/password', async (c) => {
  const principal = c.get('principal')
  const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(c.req)
  const newPassword = text(body.newPassword, 'The new password', 200)
  if (newPassword.length < 12) throw HttpError.badRequest('Use at least 12 characters.')

  const row = await c.env.DB
    .prepare(`select password_hash from app_user where id = ?`)
    .bind(principal.userId).first<{ password_hash: string | null }>()

  if (row?.password_hash &&
      !(await verifyPassword(typeof body.currentPassword === 'string' ? body.currentPassword : '', row.password_hash))) {
    throw HttpError.badRequest('Your current password is not correct.')
  }

  await c.env.DB
    .prepare(`update app_user set password_hash = ?, must_change_password = 0 where id = ?`)
    .bind(await hashPassword(newPassword), principal.userId).run()

  await recordActivity(c.env.DB, {
    entityType: 'USER', entityId: principal.userId, actorId: principal.userId,
    action: 'PASSWORD_CHANGED',
  })
  return c.body(null, 204)
})

/**
 * Password sign-in. Off unless ALLOW_PASSWORD_LOGIN is "true", because
 * hashing properly costs more CPU than the Workers free plan allows - see
 * the note at the top of auth.ts. Local development and emergencies only.
 */
export const publicAuth = new Hono<{ Bindings: Env }>()

publicAuth.post('/auth/login', async (c) => {
  if (c.env.ALLOW_PASSWORD_LOGIN !== 'true' || !c.env.JWT_SECRET) {
    throw HttpError.forbidden(
      'This installation signs in through Cloudflare Access. Open the site and Cloudflare will ask who you are.',
    )
  }

  const body = await readJson<{ email?: unknown; password?: unknown }>(c.req)
  const address = emailField(body.email)
  const password = text(body.password, 'Password', 200)

  // Slow down online guessing. Keyed by address and by the connecting IP, so
  // one attacker cannot lock a colleague out by hammering their address.
  throttleLogin(`email:${address}`)
  throttleLogin(`ip:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`)

  const user = await c.env.DB
    .prepare(
      `select id, organisation_id, email, full_name, role, status, password_hash
         from app_user where lower(email) = lower(?)`,
    )
    .bind(address)
    .first<{
      id: string; organisation_id: string; email: string; full_name: string
      role: Role; status: string; password_hash: string | null
    }>()

  // The same message either way, so the response does not reveal whether an
  // address is registered.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw HttpError.unauthorised('Email or password is incorrect.')
  }
  clearThrottle(`email:${address}`)
  if (user.status !== 'ACTIVE') {
    throw HttpError.forbidden('This account is not active. Contact your administrator.')
  }

  const sessionId = await openOrTouchSession(c.env, user.id)
  await c.env.DB.prepare(`update app_user set last_login_at = ? where id = ?`)
    .bind(now(), user.id).run()
  await recordActivity(c.env.DB, {
    entityType: 'USER', entityId: user.id, actorId: user.id, action: 'LOGIN',
  })

  const token = await issueAppToken(
    {
      sub: user.id, org: user.organisation_id, email: user.email,
      name: user.full_name, role: user.role, sid: sessionId,
    },
    c.env.JWT_SECRET,
  )

  return c.json({
    token,
    expiresInHours: 12,
    user: {
      id: user.id, email: user.email, fullName: user.full_name,
      role: user.role, mustChangePassword: false,
    },
  })
})

/** Tells the interface which sign-in path this installation uses. */
publicAuth.get('/auth/mode', (c) =>
  c.json({
    accessEnabled: Boolean(c.env.ACCESS_TEAM_NAME && c.env.ACCESS_AUD),
    passwordEnabled: c.env.ALLOW_PASSWORD_LOGIN === 'true',
  }),
)
