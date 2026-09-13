#!/usr/bin/env node
/* =====================================================================
   Put Cloudflare Access in front of Work OS.

       node setup-access.mjs

   This is the step that otherwise has to be clicked through in the
   Cloudflare dashboard: create the Access application, add a policy
   naming who may sign in, read the Application Audience (AUD) tag back
   out, write it into wrangler.toml, and redeploy.

   ---------------------------------------------------------------------
   About the credential, because it matters.

   This script does not ask you for a password or an API token, and none
   is typed into this window. It reads the OAuth token that `wrangler
   login` already stored on THIS computer, in your own user profile, and
   uses it exactly the way wrangler itself does — to talk to your account.
   The token is never printed, never written anywhere else, and never
   leaves this machine. If the token turns out not to carry permission
   for Access, the script says so plainly and tells you what to click
   instead; it does not try to widen its own access.
   ===================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

const HERE = dirname(fileURLToPath(import.meta.url))
const API_DIR = join(HERE, 'api')
const TOML = join(API_DIR, 'wrangler.toml')

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

function stop(title, ...lines) {
  console.log(`\n${c.red('✕')} ${c.b(title)}`)
  for (const l of lines) console.log(`  ${l}`)
  console.log()
  process.exit(1)
}

// ------------------------------------------------- find the stored token

/**
 * Wrangler keeps its OAuth token in a config file under the user profile.
 * The location moved between versions and differs per platform, so try the
 * places it is actually known to live rather than assuming one.
 */
function findToken() {
  const home = homedir()
  const candidates = [
    join(home, 'AppData', 'Roaming', 'xdg.config', '.wrangler', 'config', 'default.toml'),
    join(home, '.wrangler', 'config', 'default.toml'),
    join(home, '.config', '.wrangler', 'config', 'default.toml'),
    join(home, 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'),
    join(home, 'AppData', 'Roaming', '.wrangler', 'config', 'default.toml'),
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    const token = text.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1]
    if (token) return { token, path }
  }
  return null
}

/** The account id, taken from wrangler rather than asked for. */
function findAccountId() {
  const result = spawnSync('npx', ['--yes', 'wrangler', 'whoami'], {
    cwd: API_DIR,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return out.match(/\b([0-9a-f]{32})\b/)?.[1] ?? null
}

async function cf(token, path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  let body
  try {
    body = await response.json()
  } catch {
    body = { success: false, errors: [{ message: `HTTP ${response.status}` }] }
  }
  return { status: response.status, body }
}

const describe = (body) =>
  (body?.errors ?? []).map((e) => `${e.code ? `[${e.code}] ` : ''}${e.message}`).join('; ') ||
  'no reason given'

// ----------------------------------------------------------------- go

console.log(`
${c.b('Work OS — put Cloudflare Access in front of it')}
${c.dim('Uses the sign-in wrangler already did. Nothing is typed into this window.')}
`)

// ------------------------------------------------ the hand-carried tag

/**
 * `--aud <tag>` skips every API call. It exists because the Access API is
 * the part most likely to be refused - a token scoped for deploying Workers
 * need not be allowed to manage Zero Trust - and because a tag copied off
 * the dashboard is just as good as one read programmatically. This path
 * touches nothing but wrangler.toml.
 */
const audFlag = process.argv.indexOf('--aud')
if (audFlag !== -1) {
  const tag = process.argv[audFlag + 1]
  if (!tag || tag.startsWith('--')) {
    stop('No tag given.', `Usage:  ${c.cyan('node setup-access.mjs --aud <the-tag>')}`)
  }
  if (!/^[0-9a-f]{40,}$/i.test(tag)) {
    console.log(`
${c.amber(c.b('That does not look like an AUD tag.'))}
An Application Audience tag is a long hexadecimal string, usually 64
characters. The ${c.b('Application ID')} sits beside it and is shorter, with
dashes — that is the one people copy by mistake, and it produces a site
that asks everyone to sign in and never lets them in.

Given: ${c.cyan(tag)}
`)
    try {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const go = await rl.question('Use it anyway? [y/N] ')
      rl.close()
      if (!/^y/i.test(go.trim())) {
        console.log(`\n${c.dim('Nothing changed.')}\n`)
        process.exit(0)
      }
    } catch {
      stop('Refusing to write a tag that looks wrong.', 'Re-copy it from the Overview tab.')
    }
  }

  let file = readFileSync(TOML, 'utf8')
  file = file.replace(/ACCESS_AUD = "[^"]*"/, `ACCESS_AUD = "${tag}"`)
  writeFileSync(TOML, file)
  good(`ACCESS_AUD written (${tag.slice(0, 12)}…)`)

  const teamFlag = process.argv.indexOf('--team')
  if (teamFlag !== -1 && process.argv[teamFlag + 1]) {
    let again = readFileSync(TOML, 'utf8')
    again = again.replace(/ACCESS_TEAM_NAME = "[^"]*"/, `ACCESS_TEAM_NAME = "${process.argv[teamFlag + 1]}"`)
    writeFileSync(TOML, again)
    good(`ACCESS_TEAM_NAME set to ${process.argv[teamFlag + 1]}`)
  }

  say('Deploying')
  const out = spawnSync('npx', ['--yes', 'wrangler', 'deploy'], {
    cwd: API_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if ((out.status ?? 1) !== 0) stop('The deploy failed.', 'Scroll up for what Cloudflare said.')
  console.log(`\n${c.green(c.b('Done.'))}  Open ${c.cyan('https://task.healthwebgroup.com')}\n`)
  process.exit(0)
}

say('1. Finding the sign-in wrangler stored')
const found = findToken()
if (!found) {
  stop(
    'No stored Cloudflare sign-in was found on this computer.',
    'Run the launcher first — it signs you in through your browser.',
    `  ${c.cyan('LAUNCH (double-click me).bat')}`,
  )
}
good(`Using the token wrangler saved (${found.path.replace(homedir(), '~')})`)

const accountId = findAccountId()
if (!accountId) stop('Could not read your Cloudflare account id.', 'Is wrangler signed in?')
good(`Account ${accountId.slice(0, 8)}…`)

// ------------------------------------------------------------ the app

const HOSTNAME = process.env.WORKOS_HOST || 'task.healthwebgroup.com'
const OWNER = process.env.WORKOS_ADMIN || 'info@harbourhealthgroup.com'

say(`2. Checking what already exists for ${HOSTNAME}`)
const list = await cf(found.token, `/accounts/${accountId}/access/apps`)

if (!list.body?.success) {
  if (list.status === 403 || list.status === 401) {
    stop(
      'That sign-in is not allowed to manage Cloudflare Access.',
      `Cloudflare said: ${describe(list.body)}`,
      '',
      'This is a permission boundary, not a bug — the token wrangler holds is',
      'for deploying Workers, and Access may sit outside it on this account.',
      '',
      'Do it in the dashboard instead; it is six fields:',
      `  ${c.cyan('https://one.dash.cloudflare.com')} → Access → Applications`,
      `  → Add an application → Self-hosted → domain ${c.cyan(HOSTNAME)}`,
      `  → policy: Allow, Include → Emails → ${c.cyan(OWNER)}`,
      '  → Overview tab → copy the Application Audience (AUD) tag',
      '',
      'Then paste that tag to Claude, or run:',
      `  ${c.cyan('node setup-access.mjs --aud <the-tag>')}`,
    )
  }
  stop('Could not read your Access applications.', describe(list.body))
}

/**
 * Does this application already cover the hostname?
 *
 * Cloudflare has two shapes for this. The original one put a single
 * `domain` on the application. The current one gives an application a list
 * of `destinations`, each with a `uri`, so one app can protect several
 * hostnames — and `domain` may be absent or carry a trailing slash or path.
 *
 * Matching only on `domain` meant an application created in the dashboard
 * today was invisible here, and the script went on to create a second one
 * for the same hostname. Cloudflare refuses that with error 1010, which
 * says nothing useful. Check every shape.
 */
function covers(a) {
  const wanted = HOSTNAME.toLowerCase().replace(/\/+$/, '')
  const candidates = [
    a.domain,
    ...(a.destinations ?? []).map((d) => d?.uri ?? d?.hostname),
    ...(a.self_hosted_domains ?? []),
  ]
  return candidates
    .filter(Boolean)
    .map((d) => String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    .some((d) => d === wanted || d.startsWith(`${wanted}/`))
}

let app = (list.body.result ?? []).find(covers)

if (app) {
  good(`Found your existing application “${app.name}” — using it, not making another`)
} else {
  note(`No existing application covers ${HOSTNAME}.`)
  const seen = (list.body.result ?? []).map(
    (a) => `${a.name} → ${(a.destinations ?? []).map((d) => d?.uri).filter(Boolean).join(', ') || a.domain || '?'}`,
  )
  if (seen.length) {
    note(`This account has: ${seen.join(' | ')}`)
  }
  say(`3. Creating the Access application for ${HOSTNAME}`)
  const created = await cf(found.token, `/accounts/${accountId}/access/apps`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Work OS',
      domain: HOSTNAME,
      type: 'self_hosted',
      session_duration: '24h',
      app_launcher_visible: true,
      auto_redirect_to_identity: false,
    }),
  })
  if (!created.body?.success) {
    const duplicate = (created.body?.errors ?? []).some((e) => e.code === 1010)
    if (duplicate) {
      stop(
        `Cloudflare already has an application using ${HOSTNAME}.`,
        'It exists, but this script could not match it — which means it is',
        'shaped differently from what was expected.',
        '',
        'Take the AUD tag from the dashboard instead and hand it over directly:',
        `  ${c.cyan('https://one.dash.cloudflare.com')} → Access → Applications`,
        '  → your app → Details (or Overview) → Application Audience (AUD) tag',
        '',
        'then run:',
        `  ${c.cyan('node setup-access.mjs --aud <the-tag>')}`,
      )
    }
    stop('Could not create the application.', describe(created.body))
  }
  app = created.body.result
  good(`Created “${app.name}”`)
}

// --------------------------------------------------------- the policy

say('4. Saying who is allowed in')
const policies = await cf(found.token, `/accounts/${accountId}/access/apps/${app.id}/policies`)
const already = (policies.body?.result ?? []).some((p) => p.decision === 'allow')

if (already) {
  good('An Allow policy is already on this application — leaving it alone')
  note('Add colleagues in the dashboard, or to the Work OS People screen.')
} else {
  const emails = (process.env.WORKOS_TEAM ?? OWNER)
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)

  const policy = await cf(found.token, `/accounts/${accountId}/access/apps/${app.id}/policies`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Team',
      decision: 'allow',
      // Named addresses, deliberately - not "everyone at this domain".
      // Anyone Access lets through is created inside Work OS as a member,
      // and a member can see every internal board.
      include: emails.map((email) => ({ email: { email } })),
    }),
  })
  if (!policy.body?.success) stop('Could not add the policy.', describe(policy.body))
  good(`Allowed: ${emails.join(', ')}`)
}

// ------------------------------------------------------------ the tag

say('5. Reading the Application Audience (AUD) tag')
const aud = app.aud
if (!aud) stop('The application was created but has no AUD tag yet.', 'Try running this again in a moment.')
good(`AUD ${aud.slice(0, 12)}…`)

say('6. Writing it into wrangler.toml')
let toml = readFileSync(TOML, 'utf8')
const before = toml
toml = toml.replace(/ACCESS_AUD = "[^"]*"/, `ACCESS_AUD = "${aud}"`)

// The team name has to match exactly or every sign-in is refused, and it is
// the single easiest thing to mistype. Ask Cloudflare for it rather than
// guessing: the Access organisation carries the real auth domain,
// e.g. "healthwebgroup.cloudflareaccess.com" — the first label is the name.
const org = await cf(found.token, `/accounts/${accountId}/access/organizations`)
const authDomain = org.body?.result?.auth_domain
const team = authDomain?.split('.')[0]

if (team) {
  toml = toml.replace(/ACCESS_TEAM_NAME = "[^"]*"/, `ACCESS_TEAM_NAME = "${team}"`)
} else {
  note('Could not read your team name from Cloudflare — leaving it as it is.')
}

if (toml === before) {
  note('wrangler.toml already had this value.')
} else {
  writeFileSync(TOML, toml)
  good('Written')
}

const teamNow = toml.match(/ACCESS_TEAM_NAME = "([^"]*)"/)?.[1]
if (team) {
  good(`Team name read from Cloudflare: ${team}`)
} else {
  console.log(`
${c.amber(c.b('Check this one value before deploying:'))}
   ACCESS_TEAM_NAME is currently ${c.cyan(teamNow ?? '(unset)')}

It must match the first part of your Zero Trust address,
${c.cyan('https://YOUR-TEAM.cloudflareaccess.com')} — shown at the top of
${c.cyan('https://one.dash.cloudflare.com')}. If it is wrong, sign-in is
refused for everybody.
`)
}

// -------------------------------------------------------------- deploy

let answer = 'y'
try {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  answer = await rl.question('Deploy now? [Y/n] ')
  rl.close()
} catch {
  /* no console to ask in; just deploy */
}

if (/^n/i.test(answer.trim())) {
  console.log(`\n${c.dim('Nothing deployed. Run the launcher when you are ready.')}\n`)
  process.exit(0)
}

say('7. Deploying')
const deploy = spawnSync('npx', ['--yes', 'wrangler', 'deploy'], {
  cwd: API_DIR,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if ((deploy.status ?? 1) !== 0) stop('The deploy failed.', 'Scroll up for what Cloudflare said.')

console.log(`
${c.green(c.b('Done.'))}

Open ${c.cyan(`https://${HOSTNAME}`)}

Cloudflare will ask who you are and email you a one-time code. You arrive as
the administrator, with your Harbour Health board already there.

${c.dim('Add colleagues under People inside the app, and to the Access policy in')}
${c.dim('the Cloudflare dashboard — the two lists should match.')}
`)
