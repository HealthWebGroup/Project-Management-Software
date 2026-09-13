#!/usr/bin/env node
/* =====================================================================
   Put this project on GitHub.

       node push.mjs

   Once it is there, Cloudflare can build and deploy on every push and
   you never run a launcher again. DEPLOY-AUTOMATICALLY.md has the five
   dashboard clicks that switch that on.

   ---------------------------------------------------------------------
   About credentials.

   This never asks for a password or a token, and none is typed into this
   window. It uses `gh auth login`, which opens github.com in your browser
   for you to approve — the same shape as the Cloudflare sign-in the
   launcher does. GitHub hands the credential to git directly. Neither
   this script nor Claude ever sees it.

   If the GitHub CLI is not installed, the script says so and stops
   rather than falling back to asking you for anything.
   ===================================================================== */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

const HERE = dirname(fileURLToPath(import.meta.url))

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

console.log(`
${c.b('Work OS — put the code on GitHub')}
${c.dim('Nothing is typed into this window. GitHub asks you in your browser.')}
`)

// 1 -------------------------------------------------------------------
say('Checking the tools')
if (capture('git', ['--version']).code !== 0) {
  stop('Git is not installed.', `Get it from ${c.cyan('https://git-scm.com/downloads')} and run this again.`)
}
good('git')

if (capture('gh', ['--version']).code !== 0) {
  stop(
    'The GitHub CLI is not installed.',
    'It is what lets you sign in through your browser instead of typing a token.',
    '',
    `  Install from ${c.cyan('https://cli.github.com')}`,
    '  Then run this again.',
  )
}
good('gh')

// 2 -------------------------------------------------------------------
say('Signing in to GitHub')
if (capture('gh', ['auth', 'status']).code !== 0) {
  note('Your browser will open. Approve it there, then come back.')
  note('Nothing is typed here — GitHub hands the credential straight to git.')
  if (run('gh', ['auth', 'login', '--web', '--git-protocol', 'https']) !== 0) {
    stop('Could not sign in to GitHub.', 'Run `gh auth login` by hand and then run this again.')
  }
}
const who = capture('gh', ['api', 'user', '--jq', '.login'])
good(who.code === 0 ? `Signed in as ${who.out}` : 'Signed in')

// 3 -------------------------------------------------------------------
say('Checking what is about to be sent')
if (!existsSync(join(HERE, '.git'))) {
  if (run('git', ['init', '-b', 'main']) !== 0) stop('Could not start a repository here.')
  good('Repository started')
}

clearNestedRepos()

run('git', ['add', '-A'])
const staged = capture('git', ['diff', '--cached', '--name-only'])
const files = staged.out ? staged.out.split('\n').filter(Boolean) : []

// The secret check. .dev.vars holds a development signing key; the real
// one is a Cloudflare secret and is not in any file here. Refusing beats
// explaining afterwards.
const leaks = files.filter((f) => /(^|\/)\.dev\.vars$|(^|\/)\.env$|\.pem$|\.key$/i.test(f))
if (leaks.length) {
  stop(
    'Refusing to push: these look like secrets.',
    ...leaks.map((f) => `  ${c.red(f)}`),
    '',
    'Add them to .gitignore, run `git rm --cached <file>`, and try again.',
  )
}
good(`${files.length} files, no secrets among them`)
note(files.length > 12 ? `${files.slice(0, 6).join(', ')} … and ${files.length - 6} more` : files.join(', '))

// 4 -------------------------------------------------------------------
say(`Publishing to ${REPO}`)

const exists = capture('gh', ['repo', 'view', REPO, '--json', 'name'])
if (exists.code !== 0) {
  note('That repository does not exist yet — creating it as private.')
  if (run('gh', ['repo', 'create', REPO, '--private', '--source', '.', '--remote', 'origin']) !== 0) {
    stop('Could not create the repository.', 'Scroll up for what GitHub said.')
  }
} else {
  note('The repository exists.')
  const remote = capture('git', ['remote', 'get-url', 'origin'])
  if (remote.code !== 0) {
    run('git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`])
  }
}

// The repository currently holds the superseded Java version. Replacing it
// is almost certainly what is wanted, but not something to do quietly.
const remoteHas = capture('git', ['ls-remote', '--heads', 'origin'])
if (remoteHas.code === 0 && remoteHas.out) {
  console.log(`
${c.amber(c.b('That repository already has code in it.'))}

It holds the old Java version of this project, which nothing uses any more.
Pushing replaces what is on the default branch with what is in this folder.
Nothing is deleted from your computer either way.
`)
  try {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question('Replace it? [y/N] ')
    rl.close()
    if (!/^y/i.test(answer.trim())) {
      console.log(`\n${c.dim('Nothing pushed.')}\n`)
      process.exit(0)
    }
  } catch {
    stop('Cannot ask, so not replacing anything.', 'Run this from a normal window.')
  }
}

const message = process.argv.slice(2).join(' ') || 'Work OS on Cloudflare'
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

if (run('git', ['branch', '-M', 'main']) !== 0) stop('Could not name the branch.')
if (run('git', ['push', '-u', 'origin', 'main', '--force-with-lease']) !== 0) {
  if (run('git', ['push', '-u', 'origin', 'main', '--force']) !== 0) {
    stop('Could not push.', 'Scroll up for what git said.')
  }
}

console.log(`
${c.green(c.b('Pushed.'))}
  ${c.cyan(`https://github.com/${REPO}`)}

${c.b('To make deployment automatic, once:')}

  1. ${c.cyan('https://dash.cloudflare.com')} → Workers & Pages → ${c.cyan('workos-api')}
  2. Settings → ${c.b('Builds')} → Connect → pick this repository
  3. Build command:   ${c.cyan('npm run build')}
     Deploy command:  ${c.cyan('npm run deploy')}
     Root directory:  ${c.cyan('/')}
  4. Save.

From then on: change something, run this script, and Cloudflare builds and
deploys it. The deploy command runs the database migrations first, so a
change that needs one is not left half-applied.

${c.dim('DEPLOY-AUTOMATICALLY.md has the same steps with the reasoning.')}
`)
