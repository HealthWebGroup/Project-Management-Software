import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError, setToken } from '../lib/api'
import type { LoginResponse, User } from '../lib/types'

export interface AuthMode {
  accessEnabled: boolean
  passwordEnabled: boolean
}

interface AuthState {
  user: User | null
  loading: boolean
  /** How this installation signs people in. Null until it has been asked. */
  mode: AuthMode | null
  /** Non-null when the server says its configuration is not finished. */
  setupNeeded: string[] | null
  signIn: (email: string, password: string) => Promise<User>
  signOut: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<AuthMode | null>(null)
  /**
   * A freshly deployed installation has no Cloudflare Access application in
   * front of it yet — that part is done in the dashboard and cannot be done
   * from here. The server answers 503 with a checklist; showing that beats
   * an app that loads and then fails at everything.
   */
  const [setupNeeded, setSetupNeeded] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // With Cloudflare Access the person is already signed in by the time
      // the page loads, so ask who they are before showing any login form.
      try {
        const me = await api.get<User>('/api/auth/me')
        if (!cancelled) setUser(me)
      } catch (e) {
        if (e instanceof ApiError && e.status === 503 && Array.isArray(e.detail?.missing)) {
          if (!cancelled) {
            setSetupNeeded(e.detail.missing as string[])
            setLoading(false)
          }
          return
        }
        setToken(null)
        try {
          const found = await api.get<AuthMode>('/api/auth/mode')
          if (!cancelled) setMode(found)
        } catch {
          if (!cancelled) setMode({ accessEnabled: false, passwordEnabled: false })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      mode,
      setupNeeded,
      async signIn(email: string, password: string) {
        const response = await api.post<LoginResponse>('/api/auth/login', { email, password })
        setToken(response.token)
        setUser(response.user)
        return response.user
      },
      signOut() {
        setToken(null)
        setUser(null)
        // Close our session, then end the Cloudflare Access one too -
        // clearing only ours would sign the person straight back in.
        api
          .post<{ accessLogoutUrl?: string }>('/api/auth/logout')
          .then((result) => {
            window.location.href = result?.accessLogoutUrl ?? '/'
          })
          .catch(() => {
            window.location.href = '/'
          })
      },
      async refresh() {
        const me = await api.get<User>('/api/auth/me')
        setUser(me)
      },
    }),
    [user, loading, mode, setupNeeded],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
