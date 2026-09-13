import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../state/auth'

export default function ChangePasswordPage() {
  const { user, refresh, loading } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <div className="boot">Loading…</div>
  if (!user) return <Navigate to="/login" replace />

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (next !== confirm) {
      setError('The two new passwords do not match.')
      return
    }
    if (next.length < 12) {
      setError('Use at least 12 characters.')
      return
    }
    setBusy(true)
    try {
      await api.post('/api/auth/password', { currentPassword: current, newPassword: next })
      await refresh()
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <span className="auth-mark">HW</span>
          <div>
            <h1>Set a new password</h1>
            <p>Required before you can use the system</p>
          </div>
        </div>

        <label className="field">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" required
                 value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" required
                 value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input type="password" autoComplete="new-password" required
                 value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  )
}
