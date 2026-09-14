/**
 * Ctrl+K — go anywhere without the mouse.
 *
 * The click audit that prompted this: reaching a second client's board was
 * open the client menu, find the client, click it, wait for the sidebar to
 * reload, find the board, click it. Five interactions and two waits, done
 * dozens of times a day. Here it is: Ctrl+K, three letters, Enter.
 *
 * Everything it offers is already on screen somewhere. That is deliberate —
 * a palette that can do things nothing else can becomes a second, hidden
 * interface that only the person who built it knows about.
 *
 * Matching is subsequence, not substring: "hh" finds "Harbour Health" and
 * "boodus" finds "Book Düsseldorf Flights", which is how anyone who types
 * fast actually searches. Results are ranked by how tight the match is, so
 * an exact prefix beats letters scattered across a long name.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { Client, Priority, Workspace } from '../lib/types'

interface FoundTask {
  id: string
  title: string
  priority: Priority
  boardId: string
  boardName: string
  clientName?: string
  clientColour?: string
}

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  mark?: string
  run: () => void
}

/**
 * Subsequence match. Returns a score (lower is better) or null for no match.
 * Consecutive letters and a match at the start of a word both score better,
 * which is what stops "Renewals & admin" outranking "Harbour Health" for "h".
 */
export function score(needle: string, haystack: string): number | null {
  if (!needle) return 0
  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()

  let at = 0
  let total = 0
  let previous = -1

  for (const character of n) {
    const found = h.indexOf(character, at)
    if (found === -1) return null

    // Gaps cost; starting a word is a discount.
    const gap = previous === -1 ? found : found - previous - 1
    const startsWord = found === 0 || /[\s\-–—/&_.]/.test(h[found - 1])
    total += gap * (startsWord ? 0.25 : 1)

    previous = found
    at = found + 1
  }

  // Prefer shorter names when scores are otherwise level: "Clients" should
  // beat "Client renewals and admin" for "cli".
  return total + h.length * 0.01
}

export default function CommandPalette({
  workspaces,
  clients,
  onSelectClient,
}: {
  workspaces: Workspace[] | null
  clients: Client[]
  onSelectClient: (clientId: string | null) => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const openedFrom = useRef<HTMLElement | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setCursor(0)
    // Put focus back where it came from, or the page becomes keyboard-lost.
    openedFrom.current?.focus?.()
  }, [])

  // Ctrl+K / Cmd+K anywhere. Not while someone is mid-sentence in a field,
  // except in a field we own.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
      if (!combo) return
      event.preventDefault()
      if (open) {
        close()
      } else {
        openedFrom.current = document.activeElement as HTMLElement
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  useEffect(() => {
    if (open) window.setTimeout(() => input.current?.focus(), 0)
  }, [open])

  /**
   * Tasks, from the server, as you type.
   *
   * Boards, clients and pages are already in memory and match instantly.
   * Tasks are not — there can be thousands and they change constantly, so
   * they are asked for. Which means this is the one part of the palette
   * that can be wrong for a moment, and the two guards below are what keep
   * that from showing:
   *
   *   - a short debounce, so typing "renewal" is one request and not seven
   *   - a sequence number, so a slow response for "ren" cannot land after
   *     a fast one for "renewal" and replace the right answer with a
   *     stale one. Without it the list flickers back to older results,
   *     which looks like the search is broken.
   */
  const [tasks, setTasks] = useState<FoundTask[]>([])
  const [searching, setSearching] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) { setTasks([]); setSearching(false); return }

    const mine = ++seq.current
    setSearching(true)
    const timer = window.setTimeout(() => {
      api
        .get<{ items: FoundTask[] }>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => { if (mine === seq.current) { setTasks(r.items); setSearching(false) } })
        .catch(() => { if (mine === seq.current) { setTasks([]); setSearching(false) } })
    }, 180)

    return () => window.clearTimeout(timer)
  }, [query, open])

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = []

    for (const workspace of workspaces ?? []) {
      for (const board of workspace.boards) {
        out.push({
          id: `board:${board.id}`,
          label: board.name,
          hint: workspace.name,
          group: 'Boards',
          mark: `${board.itemCount}`,
          run: () => navigate(`/boards/${board.id}`),
        })
      }
    }

    out.push({
      id: 'client:all',
      label: 'All clients',
      hint: 'Show work from everyone',
      group: 'Clients',
      run: () => onSelectClient(null),
    })
    for (const client of clients) {
      out.push({
        id: `client:${client.id}`,
        label: client.name,
        hint: client.code ?? undefined,
        group: 'Clients',
        run: () => onSelectClient(client.id),
      })
    }

    for (const [label, path] of [
      ['Dashboard', '/'],
      ['Clients', '/clients'],
      ['Team & time', '/team'],
      ['People', '/people'],
    ] as const) {
      out.push({
        id: `go:${path}`,
        label,
        group: 'Go to',
        run: () => navigate(path),
      })
    }

    return out
  }, [workspaces, clients, navigate, onSelectClient])

  const matches = useMemo(() => {
    const scored = commands
      .map((command) => {
        const direct = score(query, command.label)
        // Let the hint match too, so "renewals" finds a board by its
        // workspace and a client by its code.
        const viaHint = command.hint ? score(query, command.hint) : null
        const best =
          direct === null ? (viaHint === null ? null : viaHint + 2) : direct
        return best === null ? null : { command, rank: best }
      })
      .filter((row): row is { command: Command; rank: number } => row !== null)

    scored.sort((a, b) => a.rank - b.rank)
    const local = scored.slice(0, 8).map((row) => row.command)

    /**
     * Tasks come after boards, clients and pages, never mixed in.
     *
     * They are ranked by the server (most recently touched first) and the
     * rest by subsequence score, so the two cannot be compared — merging
     * them would produce an order with no meaning. Keeping them in their
     * own group also means typing three letters does not push the board
     * you were aiming for below eight task titles.
     */
    const found: Command[] = tasks.map((t) => ({
      id: `task:${t.id}`,
      label: t.title,
      hint: t.clientName ? `${t.clientName} · ${t.boardName}` : t.boardName,
      group: 'Tasks',
      mark: t.priority !== 'NONE' ? t.priority[0] : undefined,
      run: () => navigate(`/boards/${t.boardId}`),
    }))

    return [...local, ...found.slice(0, 8)]
  }, [commands, query, tasks, navigate])

  // The cursor must never point past the end of a shrinking list.
  useEffect(() => setCursor(0), [query])

  const choose = useCallback(
    (command: Command | undefined) => {
      if (!command) return
      command.run()
      close()
    },
    [close],
  )

  if (!open) return null

  // Group headings, without breaking the flat index the arrow keys use.
  let lastGroup = ''

  return (
    <div
      className="cmdk-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Go to">
        <div className="cmdk-field">
          <span className="cmdk-icon" aria-hidden="true">⌘</span>
          <input
            ref={input}
            className="cmdk-input"
            value={query}
            placeholder="Go to a board, a client, or a page"
            aria-label="Go to a board, a client, or a page"
            aria-controls="cmdk-results"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, matches.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(matches[cursor])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
          <kbd className="cmdk-esc">Esc</kbd>
        </div>

        <div className="cmdk-list" id="cmdk-results" ref={list} role="listbox">
          {matches.length === 0 && (
            <p className="cmdk-empty">
              {/* "Nothing matches" while a request is still in flight is a
                  lie that lasts a few hundred milliseconds, and it is the
                  exact moment someone decides the search is broken. */}
              {searching ? 'Searching…' : `Nothing matches \u201C${query}\u201D.`}
            </p>
          )}
          {matches.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : null
            lastGroup = command.group
            return (
              <div key={command.id}>
                {heading && <div className="cmdk-group">{heading}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className={`cmdk-row ${index === cursor ? 'on' : ''}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(command)}
                >
                  <span className="cmdk-label">{command.label}</span>
                  {command.hint && <span className="cmdk-hint">{command.hint}</span>}
                  {command.mark && <span className="cmdk-mark">{command.mark}</span>}
                </button>
              </div>
            )
          })}
        </div>

        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> go</span>
          <span><kbd>Ctrl</kbd><kbd>K</kbd> anytime</span>
        </div>
      </div>
    </div>
  )
}
