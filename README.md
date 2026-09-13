# Health Web Group Work OS

Task and project management for Health Web Group: multiple clients, multiple
people, and per-person control over who sees which client's work.

Runs entirely on Cloudflare's free tier — **Workers** for the API, **D1** for
the database, and the built interface served by the same Worker.

No server to patch, no Docker, no VPS, and nothing to pay at your size.

**To put it live: [LAUNCH.md](LAUNCH.md).** One command, then one step in the
Cloudflare dashboard.

---

## What is here

```
healthwebgroup-workos/
├── api/                  Cloudflare Worker - the API and the static site
│   ├── src/              TypeScript: routes, permissions, validation
│   ├── migrations/       D1 (SQLite) schema and your starter data
│   └── wrangler.toml     bindings, routes, variables
│   └── seed/             optional demo data — NOT run on deploy
├── web/                  React 18 + TypeScript interface (Vite)
├── launch.mjs            one command that puts it live on Cloudflare
├── LAUNCH.md             what that command does, and the one manual step
└── DEPLOY.md             the same deployment done by hand
```

One Worker serves both: static assets are matched first, `/api/*` is handed to
the code, and anything else falls back to `index.html` so deep links work. That
means one deploy, one hostname, and **no CORS anywhere**, which is the safest
cross-origin policy there is — not needing one.

---

## Running it locally

You need Node 20+. Nothing else.

```bash
cd api
npm install
npm run migrate:local          # creates the local D1 and loads the sample data
cp .dev.vars.example .dev.vars # only needed for password sign-in
npm run dev                    # http://localhost:8787
```

In a second terminal, for hot reloading of the interface:

```bash
cd web
npm install
npm run dev                    # http://localhost:5173, proxies /api to 8787
```

### Signing in locally

Locally there is no Cloudflare Access, so switch the password path on: set
`ALLOW_PASSWORD_LOGIN = "true"` in `wrangler.toml` and give yourself a
password. Generate a hash and load it:

```bash
node -e "
const enc=new TextEncoder(),b=x=>Buffer.from(x).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+\$/,'');
const s=crypto.getRandomValues(new Uint8Array(16));
crypto.subtle.importKey('raw',enc.encode('YourLocalPassword1'),'PBKDF2',false,['deriveBits'])
 .then(k=>crypto.subtle.deriveBits({name:'PBKDF2',salt:s,iterations:100000,hash:'SHA-256'},k,256))
 .then(h=>console.log('pbkdf2\$100000\$'+b(s)+'\$'+b(new Uint8Array(h))))"

npx wrangler d1 execute workos --local --command \
  "update app_user set password_hash='<paste>' where email='info@harbourhealthgroup.com'"
```

**Turn `ALLOW_PASSWORD_LOGIN` back to `"false"` before deploying.** See the
note on hashing below — it is not a stylistic preference.

---

## Authentication

Production uses **Cloudflare Access** (Zero Trust), free for up to 50 users.
People sign in with their Google or Microsoft work account at Cloudflare's
edge, Cloudflare puts a signed token on every request, and the Worker verifies
it against your team's public keys. **No password is ever stored here**, so
there is nothing in this database to steal, no reset flow to get wrong and no
brute-force surface.

Someone signing in for the first time is created automatically as a `MEMBER`.
The address in `BOOTSTRAP_ADMIN_EMAIL` is made an `ADMIN` instead, so you can
get in and set everyone else's role.

### Why passwords are off by default

Workers Free allows **10ms of CPU per request**. PBKDF2 at a secure iteration
count — OWASP says 600,000, and `crypto.subtle` on Workers caps at 100,000 —
costs roughly 35–100ms. Hashing weakly enough to fit would be worse than
useless, so the password path is disabled unless you deliberately switch it
on, and it needs the Workers Paid plan ($5/month) to work reliably.

---

## How it is put together

### One engine, five templates

```
Organisation → Workspace → Board → Group → Item → Subitem
                             ↓        ↓
                          Column ←→ Cell
```

A column is a *definition* (type plus settings JSON); a cell is a *value*.
That is why anyone can add a column without a database migration, and why
"Projects & tasks", "Sales pipeline", "Hiring", "Renewals & admin" and a blank
board are five entries in `src/templates.ts` rather than five applications.

### Cell value shapes

| Column type | Value |
|---|---|
| `TEXT`, `LONG_TEXT` | `{"text": "..."}` |
| `STATUS` | `{"labelId": "working"}` |
| `PEOPLE` | `{"userIds": ["uuid", ...]}` |
| `DATE` | `{"date": "2026-09-05"}` |
| `TIMELINE` | `{"start": "...", "end": "..."}` |
| `NUMBER` | `{"number": 60}` |
| `DROPDOWN` | `{"optionIds": ["domain"]}` |
| `CHECKBOX` | `{"checked": true}` |
| `LINK` | `{"url": "https://…"}` |
| `DEPENDENCY` | `{"itemIds": ["uuid", ...]}` |

Empty means "not set". `src/cells.ts` checks these on the way in.

### Who can see what

Decided in one place — `src/access.ts` — and enforced on the server for every
request, never by hiding buttons. Three things decide it, in order.

**1. A named permission on one board.** Always wins, both ways: it lets a
contractor into a single board, and it is the only way into a restricted one.

**2. Which clients someone is assigned to.** This is the main lever, and it is
what the People screen sets. A `MEMBER` or `VIEWER` reaches boards for their
assigned clients, plus internal boards that belong to no client, and nothing
else. Admins and managers reach every client.

**3. The board's sensitivity against their role.**

| Sensitivity | Who gets in |
|---|---|
| `INTERNAL` | anyone with access to that client — admin and manager administer, member edits, viewer reads |
| `CONFIDENTIAL` | managers and admins only. Hiring boards default to this |
| `RESTRICTED` | named people only, whatever their role. An admin sees it listed and cannot open it |

| Role | What it means |
|---|---|
| `ADMIN` | runs the system: people, roles, every board |
| `MANAGER` | runs the work: every client, can add clients and boards |
| `MEMBER` | does the work, for their assigned clients |
| `VIEWER` | read-only, for their assigned clients |
| `GUEST` | nothing until you add them to a specific board |

The **What they see** button on the People screen answers "what would this
person actually get?" using the same function the API enforces with, so the
preview cannot drift from reality.

### Adding and removing people

**Add person** creates the account with the role and clients you choose, so a
new colleague lands with the right access on day one instead of arriving as a
blank member. It does **not** let them in: sign-in is Cloudflare Access's
decision, so the same address has to go in the Access policy too. The form says
so, because a half-done setup here is the kind of thing that looks fine until
somebody cannot work on their first morning.

A manager can add colleagues; only an administrator can create an administrator
or a manager, change anyone's email address, or delete an account.

Changing someone's email address changes who signs in as them — Access matches
on the address — so that is administrator-only and has to be changed in the
Access policy at the same time.

Deleting is refused the moment an account has any history: items, comments,
logged time or past sessions. Removing the row would take that with it and put
a hole in the audit trail. **Left** is the answer instead — it stops the
sign-in and keeps everything they did.

### Views

A board is one set of data seen three ways, all from the same request:

| View | For |
|---|---|
| **Table** | the working view — edit anything, add columns |
| **Kanban** | drag between statuses, people or clients |
| **Timeline** | a gantt across a calendar, drawn from the Timeline and Due date columns |

The timeline draws a `TIMELINE` cell as a bar you can drag and resize, and a
`DATE` cell as a milestone you can move. Anything with neither is listed
underneath rather than dropped — an item missing from a plan is exactly the
item you needed to see.

### Rules (automations)

One sentence: **when** something happens, **do** something. Written on the
**Rules** button on any board, stored per board, enforced on the server — so
they apply whoever makes the change and whether or not anyone has the page
open.

| When | Then |
|---|---|
| a status becomes *X* | move the item to a group |
| a date arrives (or *n* days before) | set a status |
| an item is created | assign someone |
| | tell whoever owns it, or everyone named on the board |

Date rules run from a **Cron Trigger** at 07:00 UTC daily — free on Workers,
configured in `wrangler.toml`. `POST /api/automations/run-due` runs the same
pass on demand, which is how you check a new rule without waiting a day.

**One pass, deliberately.** A rule acts on what a *person* did, never on what
another rule did. Two rules pointing at each other would otherwise run until
something gave out, and on a Worker that "something" is a CPU limit in the
middle of somebody's edit. The cost is that rules do not chain; the interface
says so where they are written.

Writing rules needs board-administrator access. Reading them only needs access
to the board — if something moved your item, you are entitled to know what.

### Notifications

In-app is the whole feature: a bell with an unread count, fed when work is
assigned to you, when someone comments on an item you own, and by any rule set
to tell you. Every query is filtered by your own id and **there is no route
that reads anyone else's** — not for a manager, not for an administrator.

Email is optional and off unless you configure it. Set two things and the
nightly pass sends one digest per person of whatever is still unread:

```bash
wrangler secret put EMAIL_API_KEY      # a Resend API key
# and in wrangler.toml [vars]:
#   EMAIL_FROM = "Work OS <workos@healthwebgroup.com>"
#   APP_URL    = "https://task.healthwebgroup.com"
```

Leave them unset and nothing leaves the app. A failed send is left pending and
retried the next night rather than being marked as delivered.

### Written for D1's limits

D1's free plan allows **50 queries per request**, so nothing here loops over
rows issuing a query each time. Loading a whole board is six queries; the
dashboard is seven, whatever the number of boards. That constraint made the
code better, not worse.

Free-plan ceilings worth knowing: 500 MB per database, 5 GB total, 5 million
rows read and 100,000 rows written per day. For a team of your size that is
not close.

### Audit trail

`activity_log` is append-only — nothing updates or deletes a row in it.
Opening a restricted board is itself recorded, so "who looked at this" has an
answer, and every access change is logged with what it was before and after.

---

## Hardening

Everything in this section is enforced on the server. None of it depends on
the interface behaving.

### Every request

`src/security.ts` sets the headers on every response and runs one check on
every request that changes something.

| Header | Why |
|---|---|
| `Content-Security-Policy` | scripts load from here and nowhere else, and no `'unsafe-inline'`. This is the line between injected markup being ugly and being a stolen session |
| `frame-ancestors 'none'` + `X-Frame-Options` | nobody can put this in an invisible frame and harvest your clicks |
| `Strict-Transport-Security` | HTTPS from here on |
| `X-Content-Type-Options: nosniff` | the browser does not guess a type it was not given |
| `base-uri 'none'`, `object-src 'none'` | no rewritten link base, no plugin content |

**Cross-site request forgery.** Access authenticates with a cookie, and a
browser attaches a cookie to a form *another site* submitted just as readily
as to one of ours. Every `POST`, `PUT`, `PATCH` and `DELETE` is checked
against `Sec-Fetch-Site` — a header set by the browser that page script cannot
forge — falling back to `Origin`. Reads are never blocked, and a request with
neither header (a script, a mobile app) is allowed, because those carry a
bearer token rather than a cookie and were never the risk.

### Every input

`src/validate.ts` holds the limits, in one place, and they are real: this is a
shared database with a 500 MB ceiling, and most values are written twice —
once as the row, once into the audit trail. Names, titles, notes, comments,
emails and rule names all have a cap that says which field and what the limit
is when it is hit. Lists from a request body are capped too, because each
entry usually becomes one statement in a batch or one bound parameter, and
SQLite stops at 999.

A cell keeps only the keys its column type means; anything else is dropped
rather than stored. Links must be `http` or `https` — `javascript:` in a link
column is a script that runs on this origin with the session of whoever clicks
it, which is stored cross-site scripting wearing a link's clothes. A malformed
body is a 400 that says so, not a 500 and a stack trace.

### Passwords, when they are switched on at all

Off by default. When on: PBKDF2-SHA256, a random salt per hash, a genuinely
constant-time comparison, the same message whether the address exists or the
password was wrong, and a throttle that stops unlimited online guessing. The
token that path issues is accepted **only** while `ALLOW_PASSWORD_LOGIN` is
`"true"` — turning it off closes the door rather than merely stopping new keys
being cut — and it is checked against a live session, so signing out actually
ends the session rather than waiting twelve hours for the token to lapse.

### Tests

`npm test` runs the suite. It covers the access matrix role by role and
sensitivity by sensitivity, cell validation including the `javascript:` case,
every input limit, the cross-site check, and the throttle. These are the parts
where a quiet mistake means somebody reads work that was not theirs, so they
are the parts with tests.

---

## API

Everything under `/api`. With Access in front, the browser is already
authenticated; there is no login call to make.

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/auth/me` | the current user |
| `GET` | `/api/auth/mode` | which sign-in path this installation uses |
| `POST` | `/api/auth/logout` | ends the session, returns the Access logout URL |
| `GET` | `/api/workspaces?clientId=` | workspaces with the boards you may see |
| `GET` | `/api/boards/{id}` | a board: groups, columns, items, cells, members |
| `POST` `PATCH` `DELETE` | `/api/boards…` | create from a template, rename, remove |
| `POST` | `/api/boards/{id}/groups` · `/columns` · `/items` | add structure and work |
| `PATCH` `DELETE` | `/api/groups/{id}` · `/columns/{id}` · `/items/{id}` | edit, remove |
| `PUT` | `/api/items/{id}/cells/{columnId}` | **set one cell** — what the grid calls on every edit |
| `GET` | `/api/items/{id}` | item with updates and activity |
| `POST` | `/api/items/{id}/updates` | post a comment |
| `GET` `POST` `PATCH` | `/api/clients…` | clients with contact details |
| `PUT` | `/api/clients/{id}/team` | who works with this client |
| `GET` | `/api/users` · `/api/users/sites` | colleagues, sites |
| `GET` | `/api/people` | everyone with their role, clients and board exceptions |
| `POST` | `/api/people` | add a colleague before they have signed in |
| `PATCH` | `/api/people/{id}` | name, job title, email, role, suspend or mark as left |
| `DELETE` | `/api/people/{id}` | remove an account — refused once it has any history |
| `PUT` | `/api/people/{id}/clients` | which clients this person can see |
| `GET` | `/api/people/{id}/preview` | exactly what they would see, board by board |
| `GET` `PUT` | `/api/boards/{id}/members` | named exceptions on one board |
| `PATCH` | `/api/boards/{id}/sensitivity` | internal / confidential / restricted |
| `POST` | `/api/presence/heartbeat` | keep the session marked live |
| `GET` | `/api/presence/online` · `/api/presence/sessions` | who is online, login history |
| `GET` `POST` | `/api/time/running` · `/start` · `/stop` · `/log` · `/mine` · `/summary` | timers and reporting |
| `GET` `POST` `PATCH` `DELETE` | `/api/todos…` | your private list |
| `GET` `POST` | `/api/boards/{id}/automations` | rules on a board |
| `PATCH` `DELETE` | `/api/automations/{id}` | turn a rule on or off, remove it |
| `POST` | `/api/automations/run-due` | run the date rules now instead of tonight |
| `GET` | `/api/notifications` · `/settings` | your bell, and whether email is on |
| `POST` | `/api/notifications/read` | mark some or all as read |
| `DELETE` | `/api/notifications/{id}` | remove one of yours |
| `GET` | `/api/dashboard?clientId=&days=` | the whole picture |

---

## Before real data goes in

- [ ] `npm test` passes and `npm run typecheck` is clean
- [ ] `ALLOW_PASSWORD_LOGIN` is `"false"`
- [ ] Cloudflare Access is in front of the whole hostname, not just `/api`
- [ ] **The Access policy names your staff, not a whole domain.** Anyone Access
      lets through is created here automatically as a member, and a member sees
      every internal board. That policy is the door; everything in this app is
      what happens after it
- [ ] `BOOTSTRAP_ADMIN_EMAIL` is you, and everyone else's role is set
- [ ] `migrations/0002_seed.sql` deleted or its sample data removed, and the
      two sample rules at the bottom of `0003_automations.sql` with it
- [ ] Tell the team that presence and time tracking exist — under GDPR that
      transparency is not optional, and it is the part I cannot do for you
- [ ] Check the People screen: everyone's role is right, and nobody has a
      client they should not
- [ ] Set a D1 location hint in the EU if data residency matters to a client
- [ ] Know how to restore: D1 Time Travel gives 30 days of point-in-time
      recovery on the free plan. Try it once before you need it.
