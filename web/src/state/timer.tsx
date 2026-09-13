import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import type { TimeEntry } from '../lib/types'

interface TimerState {
  running: TimeEntry | null
  /** Seconds elapsed on the running timer, ticking once a second. */
  elapsed: number
  start: (opts: { itemId?: string; clientId?: string; note?: string }) => Promise<void>
  stop: (note?: string) => Promise<TimeEntry | null>
  error: string | null
  clearError: () => void
}

const TimerContext = createContext<TimerState | null>(null)

export function TimerProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Pick up a timer left running in another tab or on another day.
  useEffect(() => {
    api
      .get<TimeEntry | undefined>('/api/time/running')
      .then((entry) => setRunning(entry ?? null))
      .catch(() => setRunning(null))
  }, [])

  useEffect(() => {
    if (!running) {
      setElapsed(0)
      return
    }
    const startedAt = new Date(running.startedAt).getTime()
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [running])

  const start = useCallback(async (opts: { itemId?: string; clientId?: string; note?: string }) => {
    setError(null)
    try {
      setRunning(await api.post<TimeEntry>('/api/time/start', opts))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the timer.')
    }
  }, [])

  const stop = useCallback(async (note?: string) => {
    setError(null)
    try {
      const finished = await api.post<TimeEntry>('/api/time/stop', { note })
      setRunning(null)
      return finished
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stop the timer.')
      return null
    }
  }, [])

  const value = useMemo<TimerState>(
    () => ({ running, elapsed, start, stop, error, clearError: () => setError(null) }),
    [running, elapsed, start, stop, error],
  )

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>
}

export function useTimer(): TimerState {
  const context = useContext(TimerContext)
  if (!context) throw new Error('useTimer must be used inside TimerProvider')
  return context
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
