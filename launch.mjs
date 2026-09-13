#!/usr/bin/env node
/* =====================================================================
   Launch Work OS on Cloudflare.

       node launch.mjs

   Runs on Windows, macOS and Linux — it is plain Node, so there is no
   PowerShell-versus-bash question and no script to mark executable.

   What it does, in order, stopping at the first thing that fails:

     1  checks Node is new enough
     2  installs dependencies for the API and the interface
     3  signs you in to Cloudflare, if you are not already
     4  creates the D1 database, and writes its id into wrangler.toml
     5  applies the migrations to the real database
     6  builds the interface
     7  deploys

   It is safe to run more than once. Every step checks whether it has
   already been done, so a second run after a failure picks up where the
   first stopped rather than making a second database.

   It never asks for a password or an API token: step 3 opens your own
   browser, you approve there, and Cloudflare hands the token to wrangler
   directly.
   ===================================================================== */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

const HERE = dirname(fileURLToPath(import.meta.url))
const API = join(HERE, 'api')
const WEB = join(HERE, 'web')
const TOML = join(API, 'wrangler.toml')
const LOG = join(HERE, 'launch-log.txt')
const DB_NAME = 'workos'
const CUSTOM_HOST = 'task.healthwebgroup.com'

/* Run with --domain to switch the app from its workers.dev address onto
   task.healthwebgroup.com. Kept as a flag on the same script rather than a
   separate one, so there is only ever one thing to keep working. */
const WANTS_DOMAIN = process.argv.includes('--domain')

/* ---------------------------------------------------------------------
   The transcript.

   This used to be done by piping the whole script through PowerShell's
   Tee-Object. That worked, and it cost the thing that mattered more:
   a piped process has no console to ask questions with, so when wrangler
   offered to register a workers.dev subdomain it was answered "no"
   automatically and the deploy failed on the very step the question would
   have solved.

   So the script keeps its own transcript instead, and the window stays
   interactive. Anything the script prints is recorded; anything a child
   command prints is recorded when we captured it, and noted when we handed
   the console over so the user could answer.
   --------------------------------------------------------------------- */
try {
  writeFileSync(LOG, `Work OS launch log\nStarted: ${new Date().toISOString()}\nNode: ${process.version}\n\n`)
} catch {
  /* a read-only folder should not stop a deploy */
}

/** Append to the transcript, with the colour codes stripped out. */
function log(text) {
  try {
    appendFileSync(LOG, String(text).replace(/\u001b\[[0-9;]*m/g, ''))
  } catch {
    /* ignore */
  }
}

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

let step = 0
const say = (msg) => { log(`\n=== ${++step}. ${msg} ===\n`); console.log(`\n${c.b(`${step}.`)} ${c.b(msg)}`) }
const note = (msg) => { log(`   ${msg}\n`); console.log(`   ${c.dim(msg)}`) }
const good = (msg) => { log(`   OK: ${msg}\n`); console.log(`   ${c.green('✓')} ${msg}`) }

function stop(title, ...lines) {
  log(`\nFAILED: ${title}\n${lines.join('\n')}\n`)
  console.log(`\n${c.red('✕')} ${c.b(title)}`)
  for (const line of lines) console.log(`  ${line}`)
  console.log(`\n  ${c.dim(`A copy of all this is in ${LOG}`)}`)
  console.log(`  ${c.dim('Send that file to Claude and it will read it.')}`)
  console.log()
  process.exit(1)
}

/* On Windows, spawnSync with shell:true pastes the arguments into a command
   line without quoting them, so an argument with a space in it arrives as
   several. That is how `user.name=Health Web Group` became a git subcommand
   called `Web`, and how a path under "Health Web Group\Project Management
   software" comes apart. Real executables (git, gh) do not need the shell at
   all, so they are launched directly; the .cmd shims (npm, npx) do, and
   everything handed to them is quoted. */
const WIN = process.platform === 'win32'
const NEEDS_SHELL = /^(npm|npx|yarn|pnpm)(\.cmd)?$/i
const useShell = (cmd) => WIN && NEEDS_SHELL.test(cmd)
const quote = (a) => (/[\s&|<>^()"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a)
const shaped = (cmd, args) =>
  useShell(cmd) ? { shell: true, argv: args.map(quote) } : { shell: false, argv: args }

/** Run a command, showing its output. Returns the exit code. */
function run(cmd, args, cwd) {
  // stdio 'inherit' hands this window to the command, so it can ask you
  // questions and you can answer them. That is the whole point.
  log(`\n$ ${cmd} ${args.join(' ')}   (interactive - its output is on screen)\n`)
  const { shell, argv } = shaped(cmd, args)
  const result = spawnSync(cmd, argv, { cwd, stdio: 'inherit', shell })
  log(`  exit code: ${result.status ?? 1}\n`)
  return result.status ?? 1
}

/** Run a command quietly and hand back what it printed. */
function capture(cmd, args, cwd) {
  const { shell, argv } = shaped(cmd, args)
  const result = spawnSync(cmd, argv, { cwd, encoding: 'utf8', shell })
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
  log(`\n$ ${cmd} ${args.join(' ')}\n${out}\n`)
  return { code: result.status ?? 1, out }
}

const wrangler = (args, cwd = API) => run('npx', ['--yes', 'wrangler', ...args], cwd)
const wranglerQuiet = (args, cwd = API) => capture('npx', ['--yes', 'wrangler', ...args], cwd)

// ------------------------------------------------------------------ go

console.log(`
${c.b('Work OS — launch on Cloudflare')}
${c.dim('Everything below runs on the free plan. Nothing here costs money.')}
`)

// 1 -----------------------------------------------------------------
say('Checking Node')
const major = Number(process.versions.node.split('.')[0])
if (major < 20) {
  stop(
    `Node ${process.versions.node} is too old.`,
    'Wrangler needs Node 20 or newer.',
    `Install it from ${c.cyan('https://nodejs.org')} and run this again.`,
  )
}
good(`Node ${process.versions.node}`)

// 2 -----------------------------------------------------------------
say('Installing dependencies')
note('First run downloads a few hundred megabytes. Later runs are quick.')
for (const [label, dir] of [['api', API], ['web', WEB]]) {
  const first = capture('npm', ['install', '--no-audit', '--no-fund'], dir)
  process.stdout.write(first.out)

  if (first.code !== 0) {
    // npm refuses to install when a package's peer requirement disagrees with
    // what this project pins - and that can start happening on a project that
    // installed cleanly last week, because a new version of a dependency
    // published a stricter peer range. The lockfiles shipped alongside this
    // should prevent it; this is the second line of defence, so that a fresh
    // machine is never stopped dead by someone else's release.
    if (/ERESOLVE/i.test(first.out)) {
      note('npm found a version disagreement between two packages.')
      note('Retrying with --legacy-peer-deps, which is safe here…')
      if (run('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps'], dir) !== 0) {
        stop(
          `npm install failed in ${label}/.`,
          'Both the normal install and the fallback were refused.',
          'Send Claude the launch-log.txt file next to this script.',
        )
      }
      good(`${label}: installed on the second attempt`)
      continue
    }
    stop(`npm install failed in ${label}/.`, 'Scroll up for what npm said.')
  }
}
good('Dependencies installed')

// 3 -----------------------------------------------------------------
say('Signing in to Cloudflare')
const who = wranglerQuiet(['whoami'])
if (who.code !== 0 || /not authenticated|You are not logged in/i.test(who.out)) {
  note('A browser window will open. Approve it there, then come back.')
  note('Nothing is typed into this window — Cloudflare hands the token straight to wrangler.')
  if (wrangler(['login']) !== 0) {
    stop(
      'Could not sign in.',
      'If no browser opened, run this by hand in the api folder:',
      `  ${c.cyan('npx wrangler login')}`,
      'then run this script again.',
    )
  }
} else {
  const account = who.out.match(/[│|]\s*([^│|]+?)\s*[│|]\s*([0-9a-f]{32})/)
  good(account ? `Signed in — account: ${account[1].trim()}` : 'Already signed in')
}

// 4 -----------------------------------------------------------------
say('Setting up the database')
let toml = readFileSync(TOML, 'utf8')

if (toml.includes('REPLACE_WITH_YOUR_D1_DATABASE_ID')) {
  const listed = wranglerQuiet(['d1', 'list', '--json'])
  let id = null

  if (listed.code === 0) {
    try {
      const rows = JSON.parse(listed.out.slice(listed.out.indexOf('[')))
      id = rows.find((row) => row.name === DB_NAME)?.uuid ?? null
    } catch {
      /* fall through to creating it */
    }
  }

  if (id) {
    good(`Found the existing "${DB_NAME}" database`)
  } else {
    note(`Creating the "${DB_NAME}" database…`)
    if (wrangler(['d1', 'create', DB_NAME]) !== 0) {
      stop('Could not create the database.', 'Scroll up for what Cloudflare said.')
    }
    const again = wranglerQuiet(['d1', 'list', '--json'])
    try {
      const rows = JSON.parse(again.out.slice(again.out.indexOf('[')))
      id = rows.find((row) => row.name === DB_NAME)?.uuid ?? null
    } catch {
      /* handled below */
    }
    if (!id) {
      stop(
        'The database was created but its id could not be read back.',
        `Run ${c.cyan('npx wrangler d1 list')} in the api folder, copy the id for "${DB_NAME}",`,
        `and paste it into ${c.cyan('api/wrangler.toml')} as database_id. Then run this again.`,
      )
    }
  }

  toml = toml.replace('REPLACE_WITH_YOUR_D1_DATABASE_ID', id)
  writeFileSync(TOML, toml)
  good(`database_id written into wrangler.toml (${id.slice(0, 8)}…)`)
} else {
  good('database_id is already set')
}

// 5 -----------------------------------------------------------------
say('Loading the schema and your starter data')
note('This runs against the real database, not a local copy.')
if (wrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote']) !== 0) {
  stop('Migrations failed.', 'Scroll up for what Cloudflare said.')
}
good('Database ready')

// 5b ----------------------------------------------------------------
if (WANTS_DOMAIN) {
  say(`Pointing the app at ${CUSTOM_HOST}`)

  let toml2 = readFileSync(TOML, 'utf8')
  const alreadyOn = /^\[\[routes\]\]/m.test(toml2)

  if (!alreadyOn) {
    toml2 = toml2
      .replace('# [[routes]]', '[[routes]]')
      .replace(`# pattern = "${CUSTOM_HOST}"`, `pattern = "${CUSTOM_HOST}"`)
      .replace('# custom_domain = true', 'custom_domain = true')
    writeFileSync(TOML, toml2)
    good('Custom domain switched on in wrangler.toml')
  } else {
    good('Custom domain was already switched on')
  }

  note('If the deploy below fails on a zone, the domain is not ready yet —')
  note('the script will say so and tell you how to put it back.')
}

// 6 -----------------------------------------------------------------
say('Building the interface')
if (run('npm', ['run', 'build'], WEB) !== 0) {
  stop('The build failed.', 'Scroll up for the error.')
}
good('Built')

// 7 -----------------------------------------------------------------
say('Deploying')
let deployed = capture('npx', ['--yes', 'wrangler', 'deploy'], API)
console.log(deployed.out)

// Wrangler asks one question the first time an account ever publishes to
// workers.dev: what subdomain to claim. Captured output has no console to
// ask with, so it answers itself "no" and then fails on the missing
// subdomain - the exact thing the question would have settled. So when that
// is what happened, hand the window over and let it actually ask.
if (deployed.code !== 0 && /workers\.dev subdomain|workers\/onboarding/i.test(deployed.out)) {
  console.log(`
${c.amber('─'.repeat(68))}
${c.amber(c.b('  READ THIS BEFORE YOU TYPE'))}
${c.amber('─'.repeat(68))}

Cloudflare is about to ask two questions.

  ${c.b('1.')}  "Would you like to register a workers.dev subdomain now?"
      ${c.green('Answer  y')}

  ${c.b('2.')}  "What would you like your workers.dev subdomain to be?"

      This is ${c.b('one word')} — the name of your whole Cloudflare workers
      space. ${c.red(c.b('It is NOT a web address.'))}

        ${c.red('✕')}  task.healthwebgroup.com   ${c.dim('- dots are rejected')}
        ${c.red('✕')}  task                      ${c.dim('- long since taken by someone else')}
        ${c.green('✓')}  healthwebgroup

      The name is shared with every Cloudflare user in the world, so
      short or common words are gone. ${c.b('If one is refused, it simply asks')}
      ${c.b('again — just try the next one.')} Work down this list:

           ${c.cyan('healthwebgroup')}
           ${c.cyan('healthwebgroup-ie')}
           ${c.cyan('hwg-work')}
           ${c.cyan('harbour-hwg')}
           ${c.cyan('healthwebgroup2026')}

      Your app will then live at ${c.cyan('workos-api.<that-name>.workers.dev')}

${c.dim('Your own domain, task.healthwebgroup.com, is a separate thing and is')}
${c.dim('still coming. This name does not replace it and does not compete.')}
${c.amber('─'.repeat(68))}
`)
  const interactive = run('npx', ['--yes', 'wrangler', 'deploy'], API)
  if (interactive === 0) {
    // It worked, but the URL was printed to the screen rather than captured.
    // Ask Cloudflare where it ended up instead of guessing.
    const listed = capture('npx', ['--yes', 'wrangler', 'deployments', 'list'], API)
    deployed = { code: 0, out: listed.out }
  } else {
    deployed = { code: interactive, out: deployed.out }
  }
}

if (deployed.code !== 0) {
  // Checked before the zone case, because Cloudflare's message for this one
  // also mentions "routes" and used to be misread as a custom-domain problem.
  // This is a one-time account setting: every Cloudflare account has to claim
  // a workers.dev subdomain once, and nothing can be published to workers.dev
  // until it has. It is one field in the dashboard.
  if (/workers\.dev subdomain|workers\/onboarding/i.test(deployed.out)) {
    const link = deployed.out.match(/https:\/\/dash\.cloudflare\.com\/\S+\/workers\/onboarding/)
    stop(
      'Your Cloudflare account has no workers.dev subdomain yet.',
      'This is a one-off: every account claims a name once, and everything',
      'published to workers.dev afterwards sits under it. It is free.',
      '',
      `  1. Open ${c.cyan(link ? link[0] : 'https://dash.cloudflare.com → Workers & Pages')}`,
      `  2. Choose a subdomain - ${c.cyan('healthwebgroup')} is a sensible one.`,
      '  3. Run this script again.',
      '',
      `Your app will then live at ${c.cyan('workos-api.<that-name>.workers.dev')}.`,
    )
  }

  if (/zone|route|not found|Could not find/i.test(deployed.out)) {
    if (WANTS_DOMAIN) {
      // Leave the project exactly as it was, so a plain run still works.
      let revert = readFileSync(TOML, 'utf8')
      revert = revert
        .replace(/^\[\[routes\]\]/m, '# [[routes]]')
        .replace(new RegExp(`^pattern = "${CUSTOM_HOST}"`, 'm'), `# pattern = "${CUSTOM_HOST}"`)
        .replace(/^custom_domain = true/m, '# custom_domain = true')
      writeFileSync(TOML, revert)

      stop(
        `${CUSTOM_HOST} is not ready yet.`,
        `Cloudflare will only attach it once ${c.cyan('healthwebgroup.com')} is an`,
        'Active zone on this account — which means the nameservers at',
        'Register365 have to point at Cloudflare, and that takes a few hours.',
        '',
        `  1. ${c.cyan('https://dash.cloudflare.com')} → Websites → Add a domain → Free plan`,
        '  2. Check the MX records it imports against Register365 before you',
        '     confirm — those carry your email.',
        '  3. Change the nameservers at Register365 to the two it gives you.',
        `  4. Wait until the domain shows ${c.b('Active')}, then run this again.`,
        '',
        'Nothing was broken: the config has been put back, so double-clicking',
        'the normal launcher still works and your site stays up meanwhile.',
      )
    }
    stop(
      'Cloudflare could not attach the custom domain.',
      'That happens when healthwebgroup.com is not an active zone on this',
      'Cloudflare account yet — check Websites in the dashboard.',
      '',
      `The ${c.cyan('[[routes]]')} block in ${c.cyan('api/wrangler.toml')} ships commented out for`,
      'exactly this reason, so if you are seeing this, it has been switched on.',
      'Comment it out again and run this once more — the workers.dev address',
      'works immediately and Access protects it just as well.',
    )
  }
  stop('The deploy failed.', 'Scroll up for what Cloudflare said.')
}

const urls = [...deployed.out.matchAll(/https:\/\/[^\s]+/g)].map((m) => m[0])
const live =
  urls.find((u) => u.includes('task.healthwebgroup.com')) ??
  urls.find((u) => u.includes('workers.dev')) ??
  urls[0]

// ------------------------------------------------------------- finish
console.log(`
${c.green(c.b('Deployed.'))}
${live ? `  ${c.cyan(live)}` : ''}

${c.b('One step left, and it is done in the dashboard rather than here.')}

Open that address now. Until Cloudflare Access is in front of it, the site
shows a page telling you exactly what is missing — that is expected, not a
failure.

${c.dim('The address above is the free workers.dev one. It works immediately and')}
${c.dim('needs no DNS at all — Access protects it just as well as a custom domain.')}
${c.dim('task.healthwebgroup.com can come later, and changes nothing but the URL.')}

  ${c.b('a)')}  ${c.cyan('https://one.dash.cloudflare.com/')} → set up Zero Trust if you
      have not already. Pick a team name — short, and permanent, because
      it becomes your sign-in address. Choose the ${c.b('Free')} plan (50 people).

  ${c.b('b)')}  Access → Applications → Add an application → ${c.b('Self-hosted')}
      Application name:   ${c.cyan('Work OS')}
      Application domain: ${c.cyan(live ? live.replace(/^https:\/\//, '') : 'your workers.dev address above')}

  ${c.b('c)')}  Add a policy: Action ${c.b('Allow')}, Include → ${c.b('Emails')} →
      ${c.cyan('info@harbourhealthgroup.com')} and one row per colleague.
      ${c.dim('Use "Emails", not "Emails ending in" — anyone Access lets through')}
      ${c.dim('becomes a member here automatically and sees every internal board.')}

  ${c.b('d)')}  On the application's Overview tab, copy the
      ${c.b('Application Audience (AUD) tag')}. ${c.dim('Not the Application ID beside it,')}
      ${c.dim('which looks almost identical and produces a site nobody can enter.')}

  ${c.b('e)')}  In ${c.cyan('api/wrangler.toml')} set:
        ACCESS_AUD        = the tag you just copied
        ACCESS_TEAM_NAME  = your team name, the first part of
                            https://YOUR-TEAM.cloudflareaccess.com

  ${c.b('f)')}  Run this again. It skips everything already done and redeploys.

${c.dim('LAUNCH.md has the same steps with more detail, including how to add your')}
${c.dim('colleagues afterwards and how to move to the custom domain later.')}
`)

// Offer to open the dashboard, since that is where they are going next.
try {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Open the Zero Trust dashboard now? [Y/n] ')
  rl.close()
  if (!/^n/i.test(answer.trim())) {
    const opener =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', 'https://one.dash.cloudflare.com/']]
      : process.platform === 'darwin' ? ['open', ['https://one.dash.cloudflare.com/']]
      : ['xdg-open', ['https://one.dash.cloudflare.com/']]
    spawnSync(opener[0], opener[1], { stdio: 'ignore' })
  }
} catch {
  /* no terminal to prompt in — the instructions above are enough */
}
