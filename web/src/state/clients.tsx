import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import type { Client } from '../lib/types'

const SELECTED_KEY = 'harbour.client'

interface ClientState {
  clients: Client[]
  loading: boolean
  /** null means "All clients". */
  selectedId: string | null
  selected: Client | null
  /**
   * Which categorical chart colour a client owns, 1-6. Derived from the full
   * client list, never from whatever is currently filtered - so narrowing a
   * chart must never repaint the clients that remain.
   */
  chartSlot: (clientId?: string | null) => number
  select: (clientId: string | null) => void
  refresh: () => Promise<void>
}

const ClientContext = createContext<ClientState | null>(null)

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY)
    } catch {
      return null
    }
  })

  const refresh = useCallback(async () => {
    try {
      const rows = await api.get<Client[]>('/api/clients')
      setClients(rows)
      // A remembered choice can name a client this person can no longer see -
      // they left the account, or lost the assignment. Leaving it selected
      // filters every board's items away with nothing on screen saying why.
      setSelectedId((current) =>
        current && !rows.some((row) => row.id === current) ? null : current,
      )
    } catch {
      // Swallowed deliberately, but not silently: an unhandled rejection here
      // left `clients` empty forever with nothing to show for it.
      setClients([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const select = useCallback((clientId: string | null) => {
    setSelectedId(clientId)
    try {
      if (clientId) localStorage.setItem(SELECTED_KEY, clientId)
      else localStorage.removeItem(SELECTED_KEY)
    } catch {
      /* the choice just will not be remembered next visit */
    }
  }, [])

  const value = useMemo<ClientState>(
    () => ({
      clients,
      loading,
      selectedId,
      selected: clients.find((c) => c.id === selectedId) ?? null,
      chartSlot: (clientId?: string | null) => {
        if (!clientId) return 0
        const ordered = [...clients].sort((a, b) => a.id.localeCompare(b.id))
        const index = ordered.findIndex((c) => c.id === clientId)
        return index < 0 ? 0 : (index % 6) + 1
      },
      select,
      refresh,
    }),
    [clients, loading, selectedId, select, refresh],
  )

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
}

export function useClients(): ClientState {
  const context = useContext(ClientContext)
  if (!context) throw new Error('useClients must be used inside ClientProvider')
  return context
}
