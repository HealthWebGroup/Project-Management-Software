#!/usr/bin/env node
/* =====================================================================
   Turn on automatic deployment, and push what is here now.

       node auto-deploy.mjs

   After this, deploying is: change something, run PUSH TO GITHUB.bat.
   GitHub builds it, runs the tests, applies any database migrations and
   deploys. No launcher, no dashboard, nothing to remember.

   ---------------------------------------------------------------------
   Two credentials are involved, and neither passes through Claude, this
   script, or any file:

     GitHub   `gh auth login` opens github.com in your browser. You
              approve there; GitHub hands the credential to git.

     Cloudflare  You create an API token in your dashboard and paste it
              into GitHub's own prompt, which this script opens with
              `gh secret set`. The value goes straight from your keyboard
              into GitHub's encrypted store. It is never printed, never
              written to disk here, and never shown back.

   If either step cannot be done safely the script stops and says why,
   rather than asking you to paste something somewhere it should not go.
   ===================================================================== */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

const HERE = dirname(fileURLToPath(import.meta.url))
// A stray repository inside a subfolder silently swallows that whole folder:
// the push succeeds and the code is simply missing on GitHub. One was left
// behind by an early file delivery. If it holds no commits there is nothing
// in it to lose, so clear it rather than asking for a hidden folder to be
// deleted by hand. If it does hold commits, stop — that is somebody's work.
function clearNestedRepos() {
  const nested = readdirSync(HERE, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '.git' && e.name !== 'node_modules')
    .map((e) => e.name)
    .filter((name) => existsSync(join(HERE, name, '.git')))

  for (const name of nested) {
    const dot = join(HERE, name, '.git')
    const head = capture('git', ['-C', join(HERE, name), 'rev-parse', 'HEAD'])
    if (head.code === 0) {
      stop(
        `There is a second git repository inside ${name}/, and it has history.`,
        'Left alone it swallows that folder and the push arrives without it.',
        '',
        `  Its latest commit is ${c.cyan(head.out.slice(0, 12))}.`,
        '',
        'Nothing here will touch it. If it is not needed, move it somewhere',
        `safe and delete ${c.cyan(`${name}\\.git`)}, then run this again.`,
      )
    }
    try {
      rmSync(dot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      good(`Cleared an empty repository inside ${name}/`)
    } catch {
      const parked = `${dot}-unused-${Date.now()}`
      try {
        renameSync(dot, parked)
        good(`Moved an empty repository inside ${name}/ aside`)
      } catch {
        stop(
          `Could not clear the empty repository inside ${name}/.`,
          'Something on the machine is holding it open — usually an editor or',
          'a file explorer window sitting in that folder.',
          '',
          'Close those, then run this again.',
        )
      }
    }
  }
}

const REPO = process.env.WORKOS_REPO || 'HealthWebGroup/Project-Management-Software'
const ACCOUNT = '1f547b22b96f44190204427c7b1a21a6'

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}
let step = 0
const say = (m) => console.log(`\n${c.b(`${++step}.`)} ${c.b(m)}`)
const note = (m) => console.log(`   ${c.dim(m)}`)
const good = (m) => console.log(`   ${c.green('✓')} ${m}`)
const warn = (m) => console.log(`   ${c.amber('!')} ${m}`)

function stop(title, ...lines) {
  console.log(`\n${c.red('✕')} ${c.b(title)}`)
  for (const l of lines) console.log(`  ${l}`)
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

const run = (cmd, args, opts = {}) => {
  const { shell, argv } = shaped(cmd, args)
  return spawnSync(cmd, argv, { cwd: HERE, stdio: 'inherit', shell, ...opts }).status ?? 1
}

function capture(cmd, args) {
  const { shell, argv } = shaped(cmd, args)
  const r = spawnSync(cmd, argv, { cwd: HERE, encoding: 'utf8', shell })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim()
}

const openInBrowser = (url) => {
  const opener =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawnSync(opener[0], opener[1], { stdio: 'ignore', shell: process.platform === 'win32' })
}

console.log(`
${c.b('Work OS — automatic deployment')}
${c.dim('After this: change something, push, and it deploys itself.')}
`)

// 1 -------------------------------------------------------------------
say('Checking the tools')
if (capture('git', ['--version']).code !== 0) {
  stop('Git is not installed.', `Get it from ${c.cyan('https://git-scm.com/downloads')}, then run this again.`)
}
if (capture('gh', ['--version']).code !== 0) {
  stop(
    'The GitHub CLI is not installed.',
    'It is what lets you sign in through your browser rather than typing a token.',
    '',
    `  Install from ${c.cyan('https://cli.github.com')}`,
    '  Then run this again.',
  )
}
good('git and gh')

// 2 -------------------------------------------------------------------
say('Signing in to GitHub')
if (capture('gh', ['auth', 'status']).code !== 0) {
  note('Your browser will open. Approve it there, then come back.')
  if (run('gh', ['auth', 'login', '--web', '--git-protocol', 'https']) !== 0) {
    stop('Could not sign in to GitHub.')
  }
}
const me = capture('gh', ['api', 'user', '--jq', '.login'])
good(me.code === 0 ? `Signed in as ${me.out}` : 'Signed in')

// 3 -------------------------------------------------------------------
say('Making sure the deploy instructions are in place')

/* The workflow file lives at .github/workflows/deploy.yml. Windows and a
   number of sync tools treat a dot-folder called .github as protected, so
   it cannot reliably be delivered as a file — it is written here instead.
   That also means it can never go missing: run this script and it is
   correct again, whatever happened to the folder. */
const WORKFLOW = `name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: |
            api/package-lock.json
            web/package-lock.json

      - name: Install
        run: |
          npm --prefix api ci --no-audit --no-fund
          npm --prefix web ci --no-audit --no-fund

      # Cheap, and it means a broken build never reaches the live site.
      - name: Check
        run: |
          npm --prefix api run typecheck
          npm --prefix api test

      - name: Build the interface
        run: npm --prefix web run build

      # Before the deploy, not after. Shipping code against a database that
      # has not caught up fails at runtime for everyone, and nothing looks
      # broken until somebody tries to use it.
      - name: Apply database migrations
        working-directory: api
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: npx --yes wrangler d1 migrations apply workos --remote

      - name: Deploy
        working-directory: api
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: npx --yes wrangler deploy

      - name: Where it went
        run: echo "Live at https://task.healthwebgroup.com"
`

const workflowPath = join(HERE, '.github', 'workflows', 'deploy.yml')
const already = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : null
if (already === WORKFLOW) {
  good('Deploy instructions already correct')
} else {
  mkdirSync(join(HERE, '.github', 'workflows'), { recursive: true })
  writeFileSync(workflowPath, WORKFLOW)
  good(already ? 'Deploy instructions updated' : 'Deploy instructions written')
}

// 4 -------------------------------------------------------------------
say('Checking what is about to be sent')

if (!existsSync(join(HERE, '.git'))) {
  if (run('git', ['init', '-b', 'main']) !== 0) stop('Could not start a repository here.')
}
clearNestedRepos()

run('git', ['add', '-A'])
const staged = capture('git', ['diff', '--cached', '--name-only'])
const files = staged.out ? staged.out.split('\n').filter(Boolean) : []

const leaks = files.filter((f) => /(^|\/)\.dev\.vars$|(^|\/)\.env$|\.pem$|\.key$/i.test(f))
if (leaks.length) {
  stop('Refusing to push: these look like secrets.', ...leaks.map((f) => `  ${c.red(f)}`))
}
good(`${files.length} files staged, no secrets among them`)

// 5 -------------------------------------------------------------------
say(`Publishing to ${REPO}`)

if (capture('gh', ['repo', 'view', REPO, '--json', 'name']).code !== 0) {
  note('That repository does not exist yet — creating it as private.')
  if (run('gh', ['repo', 'create', REPO, '--private', '--source', '.', '--remote', 'origin']) !== 0) {
    stop('Could not create the repository.')
  }
} else if (capture('git', ['remote', 'get-url', 'origin']).code !== 0) {
  run('git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`])
}

const remoteHas = capture('git', ['ls-remote', '--heads', 'origin'])
if (remoteHas.code === 0 && remoteHas.out) {
  console.log(`
${c.amber(c.b('That repository already has code in it.'))}
It holds the old Java version, which nothing uses any more. Pushing replaces
the default branch with what is in this folder. Nothing on this computer is
deleted either way.
`)
  const answer = await ask('Replace it? [y/N] ')
  if (!/^y/i.test(answer)) {
    console.log(`\n${c.dim('Nothing pushed. Run this again when you are ready.')}\n`)
    process.exit(0)
  }
}

const message = process.argv.slice(2).join(' ') || 'Work OS'
run('git', ['-c', 'user.email=noreply@healthwebgroup.com', '-c', 'user.name=Health Web Group',
            'commit', '-m', message, '--allow-empty'])

// If the commit did not happen there is nothing to push, and git's own
// complaint ("src refspec main does not match any") describes the symptom
// rather than the cause. Check, and say the real thing.
if (capture('git', ['rev-parse', '--verify', 'HEAD']).code !== 0) {
  stop(
    'The commit did not happen, so there is nothing to push.',
    'Scroll up for what git said — it is the line just above this one.',
  )
}

run('git', ['branch', '-M', 'main'])
if (run('git', ['push', '-u', 'origin', 'main', '--force-with-lease']) !== 0) {
  if (run('git', ['push', '-u', 'origin', 'main', '--force']) !== 0) stop('Could not push.')
}
good(`Pushed to https://github.com/${REPO}`)

// 6 -------------------------------------------------------------------
say('Giving GitHub permission to deploy')

const secrets = capture('gh', ['secret', 'list', '--repo', REPO])
if (secrets.code === 0 && /CLOUDFLARE_API_TOKEN/.test(secrets.out)) {
  good('CLOUDFLARE_API_TOKEN is already set — leaving it alone')
} else {
  const url =
    `https://dash.cloudflare.com/${ACCOUNT}/api-tokens`

  console.log(`
${c.b('GitHub needs a Cloudflare token to deploy on your behalf.')}

${c.dim('This is the one thing nobody can do for you, and it is deliberate:')}
${c.dim('a token that can deploy to your account should be created by you,')}
${c.dim('and go straight into GitHub without passing through anything else.')}

  ${c.b('a)')}  Your browser is opening ${c.cyan('Cloudflare → API Tokens')}
  ${c.b('b)')}  ${c.b('Create Token')} → use the ${c.b('"Edit Cloudflare Workers"')} template
  ${c.b('c)')}  Under Account Resources pick ${c.cyan("Business@healthwebgroup.com's Account")}
      ${c.dim('Add D1:Edit as well, so migrations can run.')}
  ${c.b('d)')}  Create it and copy the token. Cloudflare shows it once.

${c.amber('Then paste it at the prompt below. It goes straight into GitHub’s')}
${c.amber('encrypted store — this window never prints it and never saves it.')}
`)

  openInBrowser(url)
  await ask('Press Enter once you have the token copied… ')

  // gh does the prompting. The value never enters this script's memory,
  // never reaches a variable here, and is not echoed to the terminal.
  console.log()
  if (run('gh', ['secret', 'set', 'CLOUDFLARE_API_TOKEN', '--repo', REPO]) !== 0) {
    stop(
      'Could not save the token.',
      'Nothing was stored. You can do it by hand with:',
      `  ${c.cyan(`gh secret set CLOUDFLARE_API_TOKEN --repo ${REPO}`)}`,
    )
  }
  good('Token stored in GitHub, encrypted')
}

// 7 -------------------------------------------------------------------
say('Starting the first automatic deploy')

const fired = capture('gh', ['workflow', 'run', 'deploy.yml', '--repo', REPO, '--ref', 'main'])
if (fired.code === 0) {
  good('Started')
} else {
  warn('Could not start it from here — the push above will have started one anyway.')
}

console.log(`
${c.green(c.b('Done. Deployment is automatic from now on.'))}

  ${c.b('To deploy:')}   change something, then double-click
                ${c.cyan('PUSH TO GITHUB.bat')}

  ${c.b('To watch:')}    ${c.cyan(`https://github.com/${REPO}/actions`)}

  ${c.b('Live at:')}     ${c.cyan('https://task.healthwebgroup.com')}

Every push runs the typecheck and the tests first, so a broken build never
reaches the live site. Database migrations run before the deploy, so a
change that needs one arrives whole rather than half-applied.

${c.dim('DEPLOY-AUTOMATICALLY.md has the detail, including how to roll back.')}
`)
