# Deploying

Change something, double-click **`PUSH TO GITHUB.bat`**, and it goes live.
That is the whole process.

GitHub then, on its own:

1. installs everything
2. runs the typecheck and all 112 tests
3. builds the interface
4. applies any database migrations
5. deploys to `task.healthwebgroup.com`

About two minutes. Watch it at
`https://github.com/HealthWebGroup/Project-Management-Software/actions`.

The setup was done once and does not need doing again. Nothing to remember,
no dashboard to visit, no launcher to run.

---

## Two decisions worth knowing about

**The tests run first, and a failure stops the deploy.** It costs forty
seconds per push and it means a broken build never reaches the live site.
Your team sees the last good version instead of a white screen.

**Migrations run before the deploy, not after.** `wrangler deploy` on its
own ships code and leaves the database untouched — so a change that needs a
new column would deploy "successfully" and then fail at runtime for
everyone. That is the worst shape of failure, because nothing looks broken
until somebody tries to use it. Running migrations first means a change
either arrives whole or does not arrive.

---

## Rolling back

Two ways, depending on what went wrong.

**The code:** Cloudflare dashboard → Workers & Pages → `workos-api` →
Deployments → pick the previous one → Rollback. Instant, no rebuild.

**The data:** D1 keeps 30 days of point-in-time recovery on the free plan.
Worth trying once before you need it:

```
cd api
npx wrangler d1 time-travel info workos
```

---

## If a deploy fails

The Actions tab shows exactly which step failed and why.

**Authentication error** — the Cloudflare token is missing, expired, or
lacks permissions. Replace it in GitHub → Settings → Secrets and variables →
Actions → `CLOUDFLARE_API_TOKEN` → Update. The token needs four permissions:

| Scope | Permission | Level |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | D1 | Edit |
| Account | Account Settings | Read |
| Zone | Workers Routes | Edit |

The Zone one is what keeps `task.healthwebgroup.com` attached. Leave IP
filtering and TTL empty — either would stop deploys working later.

**Tests failed** — the deploy was stopped on purpose. Fix what broke, push
again. Nothing reached the live site.

**A migration error** — usually a migration file edited after it had
already run. `wrangler d1 migrations apply` skips ones already recorded, so
a change is made by adding a new migration, never by editing an old one.

---

## Deploying from your laptop instead

If GitHub is ever down, the deploy can be run by hand from the project
folder:

```
cd api
npx wrangler login
npx wrangler d1 migrations apply workos --remote
npx wrangler deploy
```

That skips the tests, so run `npm test` in `api/` first.
