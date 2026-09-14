/**
 * Create a board.
 *
 * The API has supported this since the beginning and nothing in the
 * interface ever called it, so the only boards that existed were the ones
 * the seed put there. That is why a new client felt like a dead end: you
 * could add the client, and then there was no way to make anywhere for
 * their work to live.
 *
 * A board created from here is stamped with the client, which is what
 * keeps each client's work separate — their boards, their tasks, their
 * timeline, and nothing from anybody else.
 */
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { BoardSummary, BoardTemplate, Workspace } from '../lib/types'
import Dialog from './Dialog'

/**
 * Mirrors api/src/templates.ts. It is duplicated rather than fetched
 * because it is four lines of copy that changes once a year, and an extra
 * request on every dialog open costs more than the duplication does —
 * but if a template is added there, add it here too.
 */
const TEMPLATES: { id: BoardTemplate; label: string; blurb: string; groups: string }[] = [
  { id: 'PROJECTS', label: 'Projects & tasks', blurb: 'Delivery work with an owner, a status and a date.', groups: 'To do · In progress · Completed' },
  { id: 'PIPELINE', label: 'Sales pipeline', blurb: 'New business from first contact to signed.', groups: 'New leads · In discussion · Won or lost' },
  { id: 'RENEWALS', label: 'Renewals & admin', blurb: 'Domains, licences and anything with an expiry date.', groups: 'Domains & hosting · Licences · Business admin' },
  { id: 'HIRING', label: 'Hiring', blurb: 'Open roles and candidates through to onboarding.', groups: 'Open roles · In process · Offer & onboarding' },
  { id: 'CUSTOM', label: 'Empty board', blurb: 'One group and three columns. Build it yourself.', groups: 'Group 1' },
]

interface Props {
  workspaces: Workspace[]
  clientId?: string
  clientName?: string
  onClose: () => void
  onCreated: (board: BoardSummary) => void
}

export default function NewBoardDialog({
  workspaces, clientId, clientName, onClose, onCreated,
}: Props) {
  // Default to the workspace that already holds this client's work, so the
  // common case needs no decision at all.
  const preferred =
    workspaces.find((w) => w.boards.some((b) => b.clientId === clientId)) ?? workspaces[0]

  const [name, setName] = useState(clientName ? `${clientName} — ` : '')
  const [template, setTemplate] = useState<BoardTemplate>('PROJECTS')
  const [workspaceId, setWorkspaceId] = useState(preferred?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!workspaceId) { setError('There is no workspace to put this board in.'); return }
    setBusy(true)
    setError(null)
    try {
      const board = await api.post<BoardSummary>('/api/boards', {
        workspaceId,
        clientId,
        name: name.trim(),
        template,
      })
      onCreated(board)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create that board.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={clientName ? `New board for ${clientName}` : 'New board'} onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        {error && <p className="form-notice error">{error}</p>}

        <label className="field">
          <span>Board name</span>
          <input
            required
            autoFocus
            placeholder="Website rebuild"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <fieldset className="field tpl-field">
          <legend>Start from</legend>
          <div className="tpl-list">
            {TEMPLATES.map((t) => (
              <label key={t.id} className={template === t.id ? 'tpl on' : 'tpl'}>
                <input
                  type="radio"
                  name="template"
                  value={t.id}
                  checked={template === t.id}
                  onChange={() => setTemplate(t.id)}
                />
                <span className="tpl-label">{t.label}</span>
                <span className="tpl-blurb">{t.blurb}</span>
                <span className="tpl-groups">{t.groups}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Only worth asking when there is genuinely a choice. */}
        {workspaces.length > 1 && (
          <label className="field">
            <span>Workspace</span>
            <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create board'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
