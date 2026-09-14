/**
 * Settings — everything that is configured rather than worked on.
 *
 * Four things moved off the everyday screens and in here: how the
 * interface looks, who sees which client, which boards are locked down,
 * and the rules that move work around on their own.
 *
 * The reason they are here and not where they used to be is frequency. A
 * board is opened fifty times a day; its automation rules are changed
 * twice a year. Controls that live beside the work you do every day cost
 * attention every day, whether or not you touch them — so the rare ones
 * move out, and the board keeps only what is used on it.
 *
 * Nothing about permissions changed. Access control is still administrator
 * only, and the API enforces that regardless of what this page renders —
 * hiding a tab is tidiness, never security.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import type { BoardDetail, Workspace } from '../lib/types'
import { useAuth } from '../state/auth'
import AutomationsDialog from '../components/AutomationsDialog'
import BoardAccessDialog from '../components/BoardAccessDialog'
import DensityToggle from '../components/DensityToggle'
import PeoplePage from './PeoplePage'

type Tab = 'display' | 'access' | 'boards'
type Theme = 'system' | 'light' | 'dark'

const THEME_KEY = 'workos.theme'

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    // Private windows and blocked site data both throw here. A theme
    // preference is not worth a crash, so fall back to following the system.
    return 'system'
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  // 'system' means no attribute at all, which is what lets the media query
  // in the stylesheet decide. Stamping data-theme="system" would match
  // neither the light nor the dark rule and leave the page half-styled.
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* not worth failing over */ }
}

export default function SettingsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [params, setParams] = useSearchParams()

  const tab = (params.get('tab') as Tab | null) ?? 'display'
  const setTab = (next: Tab) => setParams({ tab: next }, { replace: true })

  const tabs: { id: Tab; label: string; blurb: string }[] = useMemo(
    () => [
      { id: 'display', label: 'Display', blurb: 'How the interface looks on this computer' },
      ...(isAdmin
        ? ([{ id: 'access', label: 'People & access', blurb: 'Who is on the team and which clients they see' }] as const)
        : []),
      { id: 'boards', label: 'Boards & rules', blurb: 'Who can open each board, and what happens automatically' },
    ],
    [isAdmin],
  )

  // A non-administrator who lands on ?tab=access by a shared link gets the
  // first tab they are allowed rather than a blank page.
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab('display')
  }, [tab, tabs])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="page settings-page">
      <header className="page-head">
        <h1>Settings</h1>
        <p className="page-sub">
          The things you set once. Everything you work on every day is on the boards.
        </p>
      </header>

      <nav className="settings-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            <span className="st-label">{t.label}</span>
            <span className="st-blurb">{t.blurb}</span>
          </button>
        ))}
      </nav>

      {tab === 'display' && <DisplaySettings />}
      {tab === 'access' && isAdmin && <PeoplePage embedded />}
      {tab === 'boards' && <BoardSettings isAdmin={isAdmin} />}
    </section>
  )
}

// --------------------------------------------------------------- display

function DisplaySettings() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  const choose = (next: Theme) => {
    setTheme(next)
    applyTheme(next)
  }

  return (
    <div className="settings-body">
      <section className="settings-block">
        <h2>Theme</h2>
        <p className="settings-note">
          Saved in this browser, on this computer. It does not follow you to
          another machine, and it is not shared with anyone else on the team.
        </p>
        <div className="segmented wide">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} className={theme === t ? 'on' : ''} onClick={() => choose(t)}>
              {t === 'system' ? 'Match my system' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-block">
        <h2>Row spacing</h2>
        <p className="settings-note">
          Compact fits about a third more rows on screen. Comfortable is
          easier to scan when a board is mostly text.
        </p>
        <DensityToggle />
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- boards

function BoardSettings({ isAdmin }: { isAdmin: boolean }) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Both dialogs need the board's columns and members, not just its name,
  // so the detail is fetched when one is opened rather than for every board
  // in the list up front. A dozen boards would otherwise be a dozen
  // requests to render a page that mostly nobody clicks anything on.
  const [opening, setOpening] = useState<string | null>(null)
  const [detail, setDetail] = useState<BoardDetail | null>(null)
  const [dialog, setDialog] = useState<'rules' | 'access' | null>(null)

  async function open(boardId: string, which: 'rules' | 'access') {
    setOpening(boardId)
    try {
      const board = await api.get<BoardDetail>(`/api/boards/${boardId}`)
      setDetail(board)
      setDialog(which)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open that board.')
    } finally {
      setOpening(null)
    }
  }

  const close = () => { setDialog(null); setDetail(null) }

  useEffect(() => {
    let cancelled = false
    api
      .get<Workspace[]>('/api/workspaces')
      .then((data) => !cancelled && setWorkspaces(data))
      .catch((e) =>
        !cancelled && setError(e instanceof ApiError ? e.message : 'Could not load your boards.'),
      )
    return () => { cancelled = true }
  }, [])

  if (error) return <p className="form-notice error">{error}</p>
  if (!workspaces) return <p className="settings-note">Loading…</p>

  const boards = workspaces.flatMap((w) =>
    w.boards.map((b) => ({ ...b, workspace: w.name })),
  )

  return (
    <div className="settings-body">
      <section className="settings-block">
        <h2>Boards</h2>
        <p className="settings-note">
          {isAdmin
            ? 'Who can open each board, and the rules that run on it.'
            : 'The rules that run on each board. Changing who can open a board is an administrator job.'}
        </p>

        {boards.length === 0 && <p className="settings-note">No boards yet.</p>}

        <ul className="settings-list">
          {boards.map((board) => (
            <li key={board.id}>
              <div className="sl-what">
                <span className="sl-name">{board.name}</span>
                <span className="sl-where">{board.workspace}</span>
              </div>
              <div className="sl-actions">
                <button
                  className="btn sm"
                  disabled={opening === board.id}
                  onClick={() => void open(board.id, 'rules')}
                >
                  {opening === board.id ? 'Opening…' : 'Rules'}
                </button>
                {isAdmin && (
                  <button
                    className="btn sm"
                    disabled={opening === board.id}
                    onClick={() => void open(board.id, 'access')}
                  >
                    Who can open it
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {detail && dialog === 'rules' && (
        <AutomationsDialog board={detail} onClose={close} onChanged={() => {}} />
      )}
      {detail && dialog === 'access' && (
        <BoardAccessDialog board={detail} onClose={close} onChanged={() => {}} />
      )}
    </div>
  )
}
