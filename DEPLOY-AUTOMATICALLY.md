# Automatic deployment

Change something, push, and it deploys itself. No launcher, no dashboard,
nothing to remember.

---

## Setting it up — once

Double-click **`MAKE DEPLOY AUTOMATIC.bat`**.

It does everything it can and asks you for exactly two things:

1. **GitHub sign-in.** Your browser opens, you approve. No password typed.
2. **A Cloudflare API token.** You create it in your dashboard (the script
   opens the right page) and paste it into GitHub's own prompt.

That second one is the part nobody can do for you, and that is on purpose: a
token that can deploy to your account should be made by you and go straight
into GitHub's encrypted store, not through a chat window, a file, or a
script's memory. The prompt belongs to GitHub's own tool — this project
never sees the value, never prints it, never writes it down.

**Making the token:** Create Token → the **"Edit Cloudflare Workers"**
template → under Account Resources pick your account → also add **D1:Edit**
so migrations can run. Cloudflare shows the token once.

---

## After that

**To deploy:** change something, double-click **`PUSH TO GITHUB.bat`**.

That is the whole process. GitHub then, on its own:

1. installs everything
2. runs the typecheck and all 112 tests
3. builds the interface
4. applies any database migrations
5. deploys to `task.healthwebgroup.com`

About two minutes. Watch it at
`https://github.com/HealthWebGroup/Project-Management-Software/actions`.

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

**Authentication error** — the token is missing, expired, or lacks
permissions. Re-run `MAKE DEPLOY AUTOMATIC.bat`; it notices the secret is
already there and will leave it alone, so remove it first in
GitHub → Settings → Secrets → Actions.

**Tests failed** — the deploy was stopped on purpose. Fix what broke, push
again. Nothing reached the live site.

**A migration error** — usually a migration file edited after it had
already run. `wrangler d1 migrations apply` skips ones already recorded, so
change is made by adding a new migration, never by editing an old one.

---

## The manual launcher still works

`LAUNCH (double-click me).bat` deploys straight from your laptop, exactly as
before. Keep it. It is the way back if the GitHub connection breaks, and it
is how you would deploy with GitHub down.

---

## The alternative: Cloudflare Workers Builds

Cloudflare can also watch the repository directly, with no API token at all
— the connection is a GitHub App you approve in the browser.

**Workers & Pages → `workos-api` → Settings → Builds → Connect**, then:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Root directory | `/` |
| Branch | `main` |

It trades the token for a dashboard visit, and it does not run the tests
before deploying. Use it if you would rather not hold a token at all;
otherwise the GitHub Actions path above is the better one.

> Whichever you choose, use **one**. Both watching the same branch means two
> deploys racing on every push.
