#!/usr/bin/env node
/* =====================================================================
   Turn on email-code sign-in.

       node setup-login.mjs

   What it does, in order:

     1  adds "One-time PIN" as a login method on your Zero Trust account
        - this is the emailed six-digit code, run by Cloudflare itself,
          with no third-party account and nothing to configure
     2  lets your Access application use it
     3  narrows who may sign in to addresses ending @healthwebgroup.com

   Why this exists: the dashboard page that holds step 1 has moved
   between Cloudflare's dashboard versions, and without a login method
   Access has no way to verify anybody - so it falls back to the
   Cloudflare account login, which is the loop you were stuck in.

   ---------------------------------------------------------------------
   It does not ask for a password or an API token. It uses the sign-in
   wrangler already stored on this computer. That token never leaves this
   machine. Where it is not permitted to do something, the script says so
   and stops rather than trying another way in.
   ===================================================================== */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const API_DIR = join(HERE, 'api')

const DOMAIN = process.env.WORKOS_DOMAIN || 'healthwebgroup.com'
const HOSTNAME = process.env.WORKOS_HOST || 'task.healthwebgroup.com'

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}
const say = (m) => console.log(`\n${c.b(m)}`)
const note = (m) => console.log(`   ${c.dim(m)}`)
const good = (m) => console.log(`   ${c.green('✓')} ${m}`)
const warn = (m) => console.log(`   ${c.amber('!')} ${m}`)

function stop(title, ...lines) {
  console.log(`\n${c.red('✕')} ${c.b(title)}`)
  for (const l of lines) console.log(`  ${l}`)
  console.log()
  process.exit(1)
}

function findToken() {
  const home = homedir()
  for (const path of [
    join(home, 'AppData', 'Roaming', 'xdg.config', '.wrangler', 'config', 'default.toml'),
    join(home, '.wrangler', 'config', 'default.toml'),
    join(home, '.config', '.wrangler', 'config', 'default.toml'),
    join(home, 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'),
    join(home, 'AppData', 'Roaming', '.wrangler', 'config', 'default.toml'),
  ]) {
    if (!existsSync(path)) continue
    const token = readFileSync(path, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1]
    if (token) return token
  }
  return null
}

function findAccountId() {
  const r = spawnSync('npx', ['--yes', 'wrangler', 'whoami'], {
    cwd: API_DIR,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.match(/\b([0-9a-f]{32})\b/)?.[1] ?? null
}

async function cf(token, path, options = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  let body
  try {
    body = await res.json()
  } catch {
    body = { success: false, errors: [{ message: `HTTP ${res.status}` }] }
  }
  return { status: res.status, body }
}

const why = (b) =>
  (b?.errors ?? []).map((e) => `${e.code ? `[${e.code}] ` : ''}${e.message ?? ''}`).join('; ') ||
  'no reason given'

// ----------------------------------------------------------------- go

console.log(`
${c.b('Work OS — turn on email-code sign-in')}
${c.dim('Nothing is typed into this window.')}
`)

const token = findToken()
if (!token) {
  stop(
    'No stored Cloudflare sign-in found.',
    'Run the launcher first — it signs you in through your browser.',
  )
}
const account = findAccountId()
if (!account) stop('Could not read your Cloudflare account id.')
good(`Account ${account.slice(0, 8)}…`)

// ------------------------------------------------ 1. the login method

say('1. Adding One-time PIN as a login method')

const idps = await cf(token, `/accounts/${account}/access/identity_providers`)
let pin = (idps.body?.result ?? []).find((p) => p.type === 'onetimepin')

if (pin) {
  good('One-time PIN is already switched on')
} else {
  const made = await cf(token, `/accounts/${account}/access/identity_providers`, {
    method: 'POST',
    body: JSON.stringify({ name: 'One-time PIN', type: 'onetimepin', config: {} }),
  })
  if (made.body?.success) {
    pin = made.body.result
    good('One-time PIN switched on')
  } else if (
    // 1010 is Cloudflare's "this already exists". It often arrives with an
    // empty message, so matching on the words alone reported a success as a
    // failure — check the code, not the prose.
    (made.body?.errors ?? []).some((e) => e.code === 1010) ||
    /exist|duplicate|already/i.test(why(made.body))
  ) {
    good('One-time PIN is already switched on')
  } else {
    stop(
      'Could not switch on One-time PIN.',
      `Cloudflare said: ${why(made.body)}`,
      '',
      'The sign-in wrangler holds is for deploying Workers, and your account',
      'may not let it manage Zero Trust. Do this one bit by hand:',
      '',
      `  ${c.cyan('https://one.dash.cloudflare.com')}`,
      '  Left sidebar → Team & Resources → Identity providers',
      '  (older dashboards: Settings → Authentication → Login methods)',
      `  → Add new → ${c.b('One-time PIN')} → Save`,
      '',
      'Then run this again — it will carry on from step 2.',
    )
  }
}

// ------------------------------------------------- 2. let the app use it

say(`2. Letting the application for ${HOSTNAME} use it`)

const apps = await cf(token, `/accounts/${account}/access/apps`)
const covers = (a) =>
  [a.domain, ...(a.destinations ?? []).map((d) => d?.uri ?? d?.hostname), ...(a.self_hosted_domains ?? [])]
    .filter(Boolean)
    .map((d) => String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    .some((d) => d === HOSTNAME.toLowerCase() || d.startsWith(`${HOSTNAME.toLowerCase()}/`))

const app = (apps.body?.result ?? []).find(covers)

if (!app) {
  warn('This sign-in cannot see your Access applications, so it cannot finish.')
  console.log(`
${c.amber(c.b('Two clicks left, and they are quick:'))}

  ${c.b('a)')}  ${c.cyan('https://one.dash.cloudflare.com')} → Access controls → Applications
      → ${c.cyan('task')} → ${c.b('Authentication')}
      → turn ON ${c.b('“Accept all available identity providers”')} → Save

  ${c.b('b)')}  Same page → the policy called ${c.cyan('Email')}
      → Include: change ${c.b('Emails')} to ${c.b('Emails ending in')}
      → value ${c.cyan(`@${DOMAIN}`)} → Save

${c.dim('Step 1 above is done, so the list in (a) now has One-time PIN in it —')}
${c.dim('before, it was empty, which is why sign-in kept bouncing you to the')}
${c.dim('Cloudflare account login.')}
`)
  process.exit(0)
}

good(`Found “${app.name}”`)

// An empty allowed_idps list means "every login method on the account",
// which is exactly the toggle labelled "Accept all available identity
// providers" in the dashboard.
const opened = await cf(token, `/accounts/${account}/access/apps/${app.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ allowed_idps: [], auto_redirect_to_identity: true }),
})
if (opened.body?.success) {
  good('The application now accepts One-time PIN')
} else {
  warn(`Could not change it: ${why(opened.body)}`)
}

// ------------------------------------------------------ 3. the domain

say(`3. Restricting sign-in to @${DOMAIN}`)

const policies = await cf(token, `/accounts/${account}/access/apps/${app.id}/policies`)
const allow = (policies.body?.result ?? []).find((p) => p.decision === 'allow')

if (!allow) {
  warn('No Allow policy found on that application — add one in the dashboard.')
} else {
  const updated = await cf(
    token,
    `/accounts/${account}/access/apps/${app.id}/policies/${allow.id}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        name: allow.name || 'Team',
        decision: 'allow',
        include: [{ email_domain: { domain: DOMAIN } }],
      }),
    },
  )
  if (updated.body?.success) {
    good(`Only addresses ending @${DOMAIN} may sign in`)
  } else {
    warn(`Could not change the policy: ${why(updated.body)}`)
  }
}

console.log(`
${c.green(c.b('Done.'))}

Open ${c.cyan(`https://${HOSTNAME}`)} in a ${c.b('fresh')} window — an old tab may
still be holding the failed session.

You should be asked for your email, get a six-digit code at that address,
and land in the app.

${c.dim(`Anyone with an @${DOMAIN} address can now sign in and becomes a member,`)}
${c.dim('seeing internal boards but no client work until you assign them one.')}
`)
