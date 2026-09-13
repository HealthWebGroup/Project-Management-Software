> **Start with [LAUNCH.md](LAUNCH.md).** It automates most of this — one
> command, then one thing in the Cloudflare dashboard. This file is the long
> way round: the same steps done by hand, useful when something needs
> understanding rather than repeating.

# Deploying to Cloudflare

Target: **https://task.healthwebgroup.com**, on the free tier.

Work through this in order. Step 1 is the only one with a consequence outside
this app, so read it before you start clicking.

---

## 0. What you need

- A free Cloudflare account
- Node 20 or newer on your laptop
- Your Register365 sign-in, to change nameservers once
- About 45 minutes, most of it waiting for DNS

You will **not** need Hostinger for this app. Your Business plan keeps hosting
the healthwebgroup.com website exactly as it does now.

---

## 1. Move DNS for healthwebgroup.com to Cloudflare

**Read this bit properly.** Cloudflare can only attach a Worker to a custom
hostname if Cloudflare is answering DNS for that domain. There is a way around
it (Cloudflare for SaaS) but it is a paid Business feature, so the free route
means moving nameservers.

What that does and does not mean:

| | |
|---|---|
| Register365 stays your **registrar** | You still renew and own the domain there |
| Cloudflare becomes your **DNS host** | It answers lookups for healthwebgroup.com |
| Your website does not move | It stays on Hostinger; only the DNS records point at it |
| Email does not move | MX records come across with everything else |

Steps:

1. Sign in to Cloudflare → **Add a domain** → `healthwebgroup.com` → **Free** plan.
2. Cloudflare scans your existing DNS and imports it. **Check the imported list
   against Register365 before continuing** — particularly the `A` record for the
   website, any `www` record, and every `MX` and `TXT` record for email. A
   missing MX record is how a domain move takes email down.
3. Cloudflare shows you two nameservers, something like
   `xxx.ns.cloudflare.com`.
4. In Register365 → **My Domains → healthwebgroup.com → Nameservers** → replace
   the existing ones with Cloudflare's two.
5. Wait. Usually under an hour, occasionally 24. Cloudflare emails you when the
   domain is active.

Check it yourself rather than trusting the browser:

```bash
dig +short NS healthwebgroup.com
dig +short healthwebgroup.com          # your website's IP, unchanged
```

> If moving nameservers is not something you want to do, stop here and tell me.
> The alternative is a small VPS at about $9/month, and I will switch the
> project back — the Java version is still in your Git history.

---

## 2. Set up Cloudflare Access (this is your login)

Zero Trust is free for up to 50 users, and it is what replaces passwords.

1. Cloudflare dashboard → **Zero Trust**. On first use it asks you to pick a
   **team name** — choose something like `healthwebgroup`. Your sign-in page
   becomes `https://healthwebgroup.cloudflareaccess.com`.
2. **Settings → Authentication → Login methods.** Add one:
   - **Google** or **Microsoft Entra ID** if you use Workspace or Microsoft 365
     — best option, everyone uses the account they already have
   - **One-time PIN** if not — Cloudflare emails a code, no setup at all
3. **Access → Applications → Add an application → Self-hosted**:
   - Application name: `Work OS`
   - Session duration: `24 hours`
   - Public hostname: `task.healthwebgroup.com`
4. Add a policy:
   - Name: `Health Web Group staff`
   - Action: **Allow**
   - Include: **Emails ending in** `@healthwebgroup.com`
   - Add a second Include for any individual address outside that domain
5. Open the application's **Overview** tab and copy the **Application Audience
   (AUD) Tag** — a long hex string.

Put both values into `api/wrangler.toml`:

```toml
ACCESS_TEAM_NAME = "healthwebgroup"
ACCESS_AUD = "the-long-hex-string-you-just-copied"
BOOTSTRAP_ADMIN_EMAIL = "your.address@healthwebgroup.com"
```

**`BOOTSTRAP_ADMIN_EMAIL` is how you become an administrator** — the first
person to sign in with that address gets the ADMIN role. Everyone else starts
as a plain member until you promote them.

---

## 3. Create the database

```bash
cd api
npm install
npx wrangler login          # opens a browser, authorises this machine
npx wrangler d1 create workos
```

It prints a `database_id`. Paste it into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

If data residency matters to a client, create it pinned to the EU instead:

```bash
npx wrangler d1 create workos --location weur
```

Then load the schema:

```bash
npx wrangler d1 migrations apply workos --remote
```

`--remote` is doing the work there. Without it you have only set up a local
copy on your laptop.

> To start with an empty system rather than the sample clients and boards,
> delete `migrations/0002_seed.sql` **before** running that command, and cut
> the two sample rules from the bottom of `0003_automations.sql`.

### The nightly pass

`wrangler.toml` carries a Cron Trigger (`crons = ["0 7 * * *"]`). Deploying
registers it; nothing else to switch on, and Cron Triggers are free. Each
morning it runs the date-based rules — "three days before a due date, tell
whoever owns it" — and, if email is configured, sends the digests.

You can watch it with `npx wrangler tail`, and run the same pass on demand
from the app rather than waiting until tomorrow.

### Email (optional, and off by default)

Notifications work in the app with nothing configured. To also send a daily
digest of unread ones:

```bash
npx wrangler secret put EMAIL_API_KEY      # paste your Resend API key
```

and add to `[vars]` in `wrangler.toml`:

```toml
EMAIL_FROM = "Work OS <workos@healthwebgroup.com>"
APP_URL    = "https://task.healthwebgroup.com"
```

The sending domain has to be verified with the provider first, or every
message is rejected. **Do not put the key in `wrangler.toml`** — `secret put`
keeps it out of the file, and out of git.

---

## 4. Deploy

```bash
cd ../web && npm install && npm run build
cd ../api && npx wrangler deploy
```

One command puts both the API and the interface on
**https://task.healthwebgroup.com**. Wrangler creates the DNS record for the
subdomain itself, because Cloudflare is now answering DNS.

Open it. Cloudflare Access asks who you are before the app loads at all. Sign
in, and you land on the dashboard as an administrator.

---

## 5. First hour

1. **Team & time → check you appear** as online. That confirms sessions work.
2. Add your colleagues to the Access policy (step 2.4) — they create themselves
   in the app the first time they sign in.
3. Set their roles. Until there is an admin screen:
   ```bash
   npx wrangler d1 execute workos --remote --command \
     "update app_user set role='MANAGER' where email='a.kelly@healthwebgroup.com'"
   ```
4. Replace the sample clients with your real ones, and delete the samples.

---

## 6. Updating it later

```bash
cd web && npm run build
cd ../api && npx wrangler deploy
```

New database changes go in a numbered file in `migrations/`, then:

```bash
npx wrangler d1 migrations apply workos --remote
```

Never edit a migration that has already run anywhere.

---

## 7. Backups

D1 has **Time Travel**: 30 days of point-in-time recovery on the free plan, on
by default, nothing to configure.

```bash
npx wrangler d1 time-travel info workos
npx wrangler d1 time-travel restore workos --timestamp 2026-08-28T09:00:00Z
```

For a copy you hold yourself:

```bash
npx wrangler d1 export workos --remote --output backup-$(date +%F).sql
```

Put that on a monthly reminder, and **restore one into a scratch database once**
so you know the procedure before you need it under pressure.

---

## 8. When something is wrong

| Symptom | Look at |
|---|---|
| Cloudflare says the domain is not active | Nameservers have not propagated: `dig +short NS healthwebgroup.com` |
| The site loads but every call is 401 | `ACCESS_AUD` or `ACCESS_TEAM_NAME` is wrong in `wrangler.toml`. They must match the Access application exactly |
| "no such table" | You applied migrations locally but not with `--remote` |
| Access never asks who you are | The application's hostname does not match `task.healthwebgroup.com` |
| Deploy fails on the route | The domain is not on this Cloudflare account yet |
| Changes to the interface do nothing | You forgot `npm run build` in `web/` before deploying |

```bash
npx wrangler tail                                    # live logs from production
npx wrangler d1 execute workos --remote --command "select count(*) from item"
```

---

## 9. What this costs

Nothing, at your size. Workers Free covers 100,000 requests a day; D1 Free
covers 5 million row reads and 100,000 row writes a day, and 5 GB. A team of
five doing a normal day's work is nowhere near any of those.

The two things that would change that: switching password login on (Workers
Paid, $5/month), or growing past 50 people on Access.
