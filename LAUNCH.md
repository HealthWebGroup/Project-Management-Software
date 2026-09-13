# Going live

Everything below runs on Cloudflare's **free** plan. No card, no VPS, no
monthly bill. Read the last section if you want the numbers behind that.

You need [Node 20 or newer](https://nodejs.org). Nothing else.

---

## The short version

```
node launch.mjs
```

Run that from this folder. It installs everything, signs you in to
Cloudflare through your own browser, creates the database, loads your data,
builds the interface and deploys.

Then there is one step it cannot do for you — putting Cloudflare Access in
front of the site — and the deployed page walks you through it. Run
`node launch.mjs` once more afterwards and you are live.

That is genuinely it. The rest of this page is what each part means and what
to do when something does not go to plan.

---

## What the script does

| Step | What happens | If it stops here |
|---|---|---|
| 1 | Checks your Node version | Install Node 20+ and run it again |
| 2 | `npm install` in `api/` and `web/` | Read what npm printed; usually a network hiccup |
| 3 | `wrangler login` — **your browser opens**, you approve | If no browser opens, run `npx wrangler login` inside `api/` yourself |
| 4 | Creates the `workos` D1 database, writes its id into `api/wrangler.toml` | Run `npx wrangler d1 list`, copy the id in by hand |
| 5 | Applies the migrations to the real database | Read the error; usually the id in step 4 |
| 6 | Builds the interface | Read the error |
| 7 | `wrangler deploy` | Read the error; the custom domain is off by default, so a zone error should not happen |

It is safe to run more than once. Every step checks whether it has already
been done, so a second run picks up rather than starting over.

**Nothing is ever typed into that terminal that should not be.** Step 3 hands
the token from Cloudflare to wrangler directly — you never paste a password
or an API token, and neither do I.

---

## The one step the script cannot do

Cloudflare Access is what decides who may open the site. It is configured in
the dashboard, so no script can finish it. Until it is done the site shows a
page listing exactly what is missing — that page is expected, not a failure.

**a. Add the application**

Cloudflare dashboard → **Zero Trust** → Access → Applications →
Add an application → **Self-hosted**.

- Application name: `Work OS`
- Application domain: the `workers.dev` address the deploy printed
  (paste the hostname, without `https://`)

**b. Say who is allowed in**

Add a policy:

- Action: **Allow**
- Include → **Emails** → `info@harbourhealthgroup.com`, plus each colleague

> Use **Emails**, not "Emails ending in @healthwebgroup.com". Anyone Access
> lets through is created in Work OS automatically as a member, and a member
> sees every internal board. The Access policy is the front door; everything
> inside this app happens after it.

**c. Copy two values back**

On the application's **Overview** tab, copy the **Application Audience (AUD)
tag**. In `api/wrangler.toml`:

```toml
ACCESS_TEAM_NAME = "your-team-name"   # from https://YOUR-TEAM.cloudflareaccess.com
ACCESS_AUD = "the-long-tag-you-just-copied"
```

Neither of these is a secret — they identify the application, they do not
authorise anything — so they are fine to keep in the file and in git.

**d. Deploy again**

```
node launch.mjs
```

Open the address the deploy printed. Cloudflare asks who you are, you get a
one-time code by email, and you are in as the administrator.

---

## The address

The first deploy publishes to **`workos-api.<your-subdomain>.workers.dev`**.
That is a real, permanent, free address — not a staging URL. Cloudflare Access
protects it exactly as it would protect a custom hostname, so the whole team
can be signed in and working on it today.

`task.healthwebgroup.com` is a rename, not a prerequisite. It needs
`healthwebgroup.com` to be an **active zone on this Cloudflare account** —
Websites in the dashboard, status Active — which means moving the nameservers
from Register365. That is free, and Cloudflare imports your existing records
first, but check the imported list before you switch, **particularly the MX
records**, because those carry your email. Propagation takes a few hours.

When the zone is Active:

1. Uncomment the three `[[routes]]` lines in `api/wrangler.toml`.
2. Change the Access application's domain to `task.healthwebgroup.com`.
3. `node launch.mjs`.

Your data, boards and people are untouched by any of that.

## After you are in

1. **People → Add person** for each colleague. Use the same email address you
   put in the Access policy — that is how the two sides find each other.
2. Give each person their clients. A member or viewer sees only the clients
   you tick, plus internal boards.
3. **Clients → Add client** for anyone beyond Harbour Health.
4. Tell the team that presence and time tracking exist. Under GDPR that
   transparency is not optional, and it is the one part of this I cannot do
   for you.

The board arrives with two rules already running: finished items file
themselves under Completed, and anything with a due date warns whoever owns
it three days out. Both are on the **Rules** button on the board, and both
can be turned off.

---

## What it costs

| | Free allowance | What you will use |
|---|---|---|
| Workers | 100,000 requests/day | A team of ten, nowhere near |
| D1 database | 5 GB, 5M reads + 100k writes/day | Not close |
| Cloudflare Access | 50 users | You need a handful |
| Cron trigger | included | One run a day |
| workers.dev address | included | One, immediately |
| Custom domain | included | One, when you want it |

**£0.** The only paid thing anywhere near this is Workers Paid at $5/month,
and you would only need it for two reasons: password sign-in (off, and
unnecessary — Access is better), or if you outgrow the 10ms of CPU each
request gets. Neither applies at your size.

---

## If something goes wrong

**The site shows "Deployed. One step left."** — Access is not configured yet.
That is section "The one step the script cannot do", above.

**Cloudflare asks who I am but then the app says I cannot sign in** —
the email Access let through is not the one in `BOOTSTRAP_ADMIN_EMAIL`. Check
they match exactly in `api/wrangler.toml`.

**The deploy stops talking about a zone or a route** — the `[[routes]]` block
in `api/wrangler.toml` has been switched on before the domain is active on this
account. Comment it out again. See "The address".

**Everything returns "Please sign in"** — `ACCESS_AUD` is set but wrong.
Re-copy it from the application's Overview tab; it is easy to grab the
application ID by mistake, which looks similar.

**I want to start the database over**

```
cd api
npx wrangler d1 execute workos --remote --command "drop table if exists d1_migrations"
npx wrangler d1 migrations apply workos --remote
```

That re-runs the migrations. It does not delete existing tables, so for a
truly clean start delete the database in the dashboard and run
`node launch.mjs` again.

---

## Keeping it running

- **Deploy a change**: `node launch.mjs`, or just `npx wrangler deploy` from
  `api/` if nothing about the database changed.
- **Watch the logs**: `npx wrangler tail` from `api/`.
- **Restore a mistake**: D1 keeps 30 days of point-in-time recovery on the
  free plan. Try it once before you need it.
- **Back up**: `npx wrangler d1 export workos --remote --output backup.sql`.
