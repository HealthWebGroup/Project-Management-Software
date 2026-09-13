/**
 * What a freshly deployed installation shows.
 *
 * The Worker is up and the database is loaded, but Cloudflare Access is not
 * in front of the hostname yet — and that part is done in the dashboard, so
 * no amount of code here can finish it. Without this screen the app loads
 * and then fails at everything, which looks like a broken deployment rather
 * than an unfinished one.
 *
 * It disappears on its own the moment the configuration is complete.
 */

const HOST = typeof window === 'undefined' ? '' : window.location.hostname

export default function SetupPage({ missing }: { missing: string[] }) {
  return (
    <div className="setup-page">
      <main className="setup-card">
        <span className="auth-mark">HW</span>

        <h1>Deployed. One step left.</h1>
        <p className="setup-lede">
          Work OS is running on <code>{HOST}</code> and the database is ready. Nobody
          can sign in yet, because Cloudflare Access is not in front of it — and that
          is set up in the Cloudflare dashboard rather than here.
        </p>

        <ol className="setup-steps">
          <li>
            <div>
              <h2>Add the Access application</h2>
            <p>
              Cloudflare dashboard → <strong>Zero Trust</strong> → Access → Applications →
              Add an application → <strong>Self-hosted</strong>. Set the application domain
              to <code>{HOST}</code>.
            </p>
            </div>
          </li>
          <li>
            <div>
              <h2>Say who is allowed in</h2>
            <p>
              Add a policy with action <strong>Allow</strong>, then Include →{' '}
              <strong>Emails</strong> and list your team. Anyone Access lets through is
              created here automatically as a member, so keep this list to actual
              colleagues rather than a whole domain.
            </p>
            </div>
          </li>
          <li>
            <div>
              <h2>Copy two values back</h2>
            <p>
              From the application's Overview tab, copy the{' '}
              <strong>Application Audience (AUD) tag</strong> into <code>ACCESS_AUD</code>{' '}
              in <code>api/wrangler.toml</code>. Set <code>ACCESS_TEAM_NAME</code> to your
              team name — the first part of{' '}
              <code>https://YOUR-TEAM.cloudflareaccess.com</code>.
            </p>
            </div>
          </li>
          <li>
            <div>
              <h2>Deploy again</h2>
            <p>
              Run <code>node launch.mjs</code>. It skips everything already done and just
              redeploys. This screen is then replaced by the app.
            </p>
            </div>
          </li>
        </ol>

        <section className="setup-missing">
          <h2>Still missing</h2>
          <ul>
            {missing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <p className="setup-foot">
          Everything here runs on Cloudflare's free plan — Workers, D1 and Access for up
          to 50 people. Nothing on this page costs money.
        </p>
      </main>
    </div>
  )
}
