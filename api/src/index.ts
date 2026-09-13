import { Hono } from 'hono'
import { resolvePrincipal } from './auth'
import { HttpError, onError } from './errors'
import { requireSameOrigin, securityHeaders } from './security'
import { setupPage, setupState } from './setup'
import { runDue } from './automations'
import { sendDigests } from './email'
import { auth, publicAuth } from './routes/auth'
import { automations } from './routes/automations'
import { boards } from './routes/boards'
import { clients } from './routes/clients'
import { dashboard } from './routes/dashboard'
import { items } from './routes/items'
import { notifications } from './routes/notifications'
import { people } from './routes/people'
import { team } from './routes/team'
import { todos } from './routes/todos'
import type { Env, Vars } from './types'

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

app.onError(onError)

/**
 * Security headers on every response, and a cross-site check on every request
 * that changes something.
 *
 * The interface is served from the same origin as the API, so there is no
 * CORS here at all - the safest cross-origin policy is not needing one. But
 * "no CORS" does not mean "no cross-site risk": Access authenticates with a
 * cookie, and a browser attaches a cookie to a form another site submitted
 * just as readily as to one of ours. requireSameOrigin is what separates them.
 */
app.use('*', async (c, next) => {
  requireSameOrigin(c.req.raw)
  await next()
  securityHeaders(c.res.headers)
  c.header('Cache-Control', 'no-store')
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

/**
 * Before anything else: is this installation actually configured?
 *
 * A Worker deployed without its Access application in front of it would
 * otherwise answer every request with "Please sign in" and offer no way to
 * do so. That looks like a broken site rather than an unfinished one, and
 * the difference matters on the first day.
 *
 * `/api/health` above stays reachable either way, so an uptime check still
 * gets a straight answer.
 */
app.use('*', async (c, next) => {
  const state = setupState(c.env)
  if (state.ready) return next()

  // The password path is the deliberate exception: it is how the system is
  // reached in local development, where there is no Access at all.
  if (c.env.ALLOW_PASSWORD_LOGIN === 'true') return next()

  if (c.req.path.startsWith('/api/')) {
    return c.json(
      {
        status: 503,
        message:
          'This installation is not finished: Cloudflare Access is not configured yet. ' +
          'Open the site in a browser for the remaining steps.',
        missing: state.missing,
      },
      503,
    )
  }
  return setupPage(state, new URL(c.req.url).hostname)
})

// Public: the sign-in mode, and the password path when it is switched on.
app.route('/api', publicAuth)

// Everything below this line needs a caller.
app.use('/api/*', async (c, next) => {
  const principal = await resolvePrincipal(c.req.raw, c.env)
  if (!principal) {
    throw HttpError.unauthorised(
      'Please sign in. If this keeps happening, your Cloudflare Access session may have expired.',
    )
  }
  c.set('principal', principal)
  await next()
})

app.route('/api', auth)
app.route('/api', boards)
app.route('/api', items)
app.route('/api', clients)
app.route('/api', people)
app.route('/api', team)
app.route('/api', todos)
app.route('/api', automations)
app.route('/api', notifications)
app.route('/api', dashboard)

app.all('/api/*', (c) => c.json({ status: 404, message: 'No such endpoint.' }, 404))

/**
 * Two ways in: ordinary requests, and the daily Cron Trigger that runs the
 * date-based automations. The schedule is set in wrangler.toml; Cron Triggers
 * are included on the Workers free plan.
 */
export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runDue(env)
        .then((result) =>
          console.log(`automations: ${result.matched} rules matched from ${result.rules} date rules`),
        )
        // Email is a separate step on purpose: if sending fails, the rules
        // have still run and the notifications are still in the app.
        .then(() => sendDigests(env))
        .then((result) =>
          console.log(
            result.reason
              ? `email: skipped (${result.reason})`
              : `email: ${result.sent} of ${result.people} digests sent`,
          ),
        )
        // A failing nightly pass must be visible in the logs, not silent.
        .catch((error) => console.error('nightly pass failed', error)),
    )
  },
}
