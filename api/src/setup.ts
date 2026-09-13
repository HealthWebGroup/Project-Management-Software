import type { Env } from './types'

/**
 * The state of this installation's configuration.
 *
 * A freshly deployed Worker has a database but no Cloudflare Access
 * application in front of it yet, because that part is done in the
 * dashboard and cannot be done from here. Without this check the first
 * deploy answers every request with "Please sign in" and no way to sign
 * in — a dead site that looks broken rather than unfinished.
 *
 * So: detect it, and say plainly what is left to do.
 */

const PLACEHOLDER = /^REPLACE_WITH_/

export interface SetupState {
  ready: boolean
  /** What still has to happen, in the order it has to happen in. */
  missing: string[]
}

export function setupState(env: Env): SetupState {
  const missing: string[] = []

  if (!env.ACCESS_TEAM_NAME || PLACEHOLDER.test(env.ACCESS_TEAM_NAME)) {
    missing.push(
      'ACCESS_TEAM_NAME is not set. It is your Zero Trust team name — the ' +
      'first part of https://<team>.cloudflareaccess.com in the Zero Trust dashboard.',
    )
  }

  if (!env.ACCESS_AUD || PLACEHOLDER.test(env.ACCESS_AUD)) {
    missing.push(
      'ACCESS_AUD is not set. Create the Access application first, then copy ' +
      'its Application Audience (AUD) tag from Access → Applications → your app → Overview.',
    )
  }

  return { ready: missing.length === 0, missing }
}

/**
 * The page an unconfigured installation shows instead of a locked door.
 *
 * Deliberately plain HTML with no assets: it has to render correctly on the
 * very first request, before anyone has looked at whether the interface
 * built properly, and it must not depend on anything that might itself be
 * the thing that is broken.
 */
export function setupPage(state: SetupState, hostname: string): Response {
  const steps = state.missing.map((line) => `<li>${escapeHtml(line)}</li>`).join('')

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Almost there — Work OS</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 32px 20px;
    font: 15px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: #E7EDEF; color: #06212B;
  }
  main {
    max-width: 620px; background: #fff; border: 1px solid #CFDBE0;
    border-radius: 14px; padding: 34px 34px 30px;
    box-shadow: 0 4px 8px rgba(6,33,43,.07), 0 24px 48px -12px rgba(6,33,43,.22);
  }
  h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: -.02em; }
  .lede { margin: 0 0 22px; color: #6A848E; }
  ol, ul { padding-left: 20px; }
  li { margin: 0 0 10px; }
  code {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
    font-size: 13px; background: #F1F5F7; padding: 2px 6px; border-radius: 5px;
  }
  .mark {
    display: inline-grid; place-items: center; width: 42px; height: 42px;
    border-radius: 12px; background: linear-gradient(140deg,#0E8F9B,#0B5F6B);
    color: #fff; font: 600 14px ui-monospace, monospace; margin-bottom: 14px;
  }
  .foot { margin: 24px 0 0; padding-top: 18px; border-top: 1px solid #E3EBEE;
          font-size: 13px; color: #6A848E; }
  @media (prefers-color-scheme: dark) {
    body { background: #061219; color: #E4EEF0; }
    main { background: #0C1D25; border-color: #213D48; }
    code { background: #12262F; }
    .lede, .foot { color: #7C959E; }
  }
</style>
</head><body><main>
  <div class="mark">HW</div>
  <h1>The app is deployed. One step left.</h1>
  <p class="lede">
    Work OS is running on <code>${escapeHtml(hostname)}</code>, but nothing can
    sign in yet because Cloudflare Access is not in front of it.
  </p>

  <ol>
    <li>Open <strong>Cloudflare dashboard → Zero Trust → Access → Applications</strong>
        and add a <strong>Self-hosted</strong> application for
        <code>${escapeHtml(hostname)}</code>.</li>
    <li>Add a policy that <strong>allows</strong> the email addresses of your team.</li>
    <li>Copy the application's <strong>Application Audience (AUD) tag</strong>
        from its Overview tab.</li>
    <li>Put that tag in <code>ACCESS_AUD</code> in <code>wrangler.toml</code>,
        set <code>ACCESS_TEAM_NAME</code> to your team name, and run
        <code>npx wrangler deploy</code> again.</li>
  </ol>

  <p><strong>What is still missing:</strong></p>
  <ul>${steps}</ul>

  <p class="foot">
    This screen only appears while the configuration is incomplete. Once Access
    is in front of this hostname and the two values are set, it is replaced by
    the app itself — and nobody reaches this page again.
  </p>
</main></body></html>`

  return new Response(html, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Retry-After tells any crawler this is temporary, not a dead site.
      'Retry-After': '3600',
    },
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
