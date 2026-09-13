/**
 * The sign-in page.
 *
 * In production nobody reaches this: Cloudflare Access asks for the email,
 * mails a one-time code, and only then does the request arrive here already
 * identified. The password form is the local-development path, and is off
 * unless ALLOW_PASSWORD_LOGIN is set.
 */
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'
import { ApiError } from '../lib/api'

export default function LoginPage() {
  const { user, signIn, loading, mode } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <div className="boot">Loading…</div>
  if (user && !user.mustChangePassword) return <Navigate to="/" replace />

  // Cloudflare Access signs people in before the page even loads, so there is
  // no form to show - only an explanation if they somehow got here signed out.
  if (mode && mode.accessEnabled && !mode.passwordEnabled) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="auth-mark">HW</span>
            <div>
              <h1>Health Web Group</h1>
              <p>Work OS</p>
            </div>
          </div>
          <p className="auth-foot">Your session has ended.</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Sign in again
          </button>
        </div>
      </div>
    )
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const signedIn = await signIn(email, password)
      navigate(signedIn.mustChangePassword ? '/change-password' : '/', { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-split">
        {/* The half that says what this is. On a phone it collapses away
            entirely — nobody signing in on a train needs the pitch. */}
        <aside className="auth-pitch" aria-hidden="true">
          <div className="auth-brand">
            <span className="auth-mark">HW</span>
            <div>
              <h1>Health Web Group</h1>
              <p>Work OS</p>
            </div>
          </div>

          <p className="auth-lede">Client work, in one place.</p>

          <ul className="auth-points">
            <li><span>01</span> Boards, kanban and timeline over the same work</li>
            <li><span>02</span> Rules that move work on automatically</li>
            <li><span>03</span> Access set per person, per client</li>
          </ul>

          {/* This line used to name "Riverside Medical" and "Coastal Care" —
              invented clients left over from the demo seed. Putting fictional
              client names on a real company's sign-in screen is the kind of
              detail that makes software look untrustworthy to the first
              colleague who notices it. */}
          <p className="auth-sign">Health Web Group</p>
        </aside>

      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand compact">
          <span className="auth-mark">HW</span>
          <div>
            <h1>Sign in</h1>
            <p>Health Web Group</p>
          </div>
        </div>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            required
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-foot">
          Trouble signing in? Contact your system administrator.
        </p>
      </form>
      </div>
    </div>
  )
}
