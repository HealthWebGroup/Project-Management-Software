import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { Todo } from '../lib/types'
import { useClients } from '../state/clients'
import { colourClass } from './Pill'

function dueTone(due?: string): '' | 'soon' | 'late' {
  if (!due) return ''
  const target = new Date(due + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (target.getTime() < today.getTime()) return 'late'
  if (target.getTime() <= today.getTime() + 2 * 86400000) return 'soon'
  return ''
}

function dueLabel(due?: string): string {
  if (!due) return ''
  const target = new Date(due + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days < 0) return `${Math.abs(days)}d late`
  return target.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
}

/**
 * A private scratch list. Deliberately not a board: no owner, no status, no
 * audit trail - somewhere to put the six small things you are holding in your
 * head, and tick them off.
 */
export default function MyTasks({ onClose }: { onClose: () => void }) {
  const { selected } = useClients()
  const [todos, setTodos] = useState<Todo[] | null>(null)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [attachClient, setAttachClient] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    api
      .get<Todo[]>('/api/todos')
      .then(setTodos)
      .catch(() => setError('Could not load your list.'))
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const open = useMemo(() => (todos ?? []).filter((t) => !t.done), [todos])
  const done = useMemo(() => (todos ?? []).filter((t) => t.done), [todos])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    const text = title.trim()
    if (!text) return
    setError(null)
    try {
      const created = await api.post<Todo>('/api/todos', {
        title: text,
        dueOn: due || undefined,
        clientId: attachClient && selected ? selected.id : undefined,
      })
      setTodos((current) => [...(current ?? []), created])
      // Cleared only once it is actually saved. Clearing first meant a failed
      // save took the typed task with it and left only an error message.
      setTitle('')
      setDue('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add that.')
    }
  }

  async function toggle(todo: Todo) {
    // Paint it immediately; a to-do list that lags feels broken.
    setTodos((current) =>
      (current ?? []).map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)),
    )
    try {
      await api.patch(`/api/todos/${todo.id}`, { done: !todo.done })
    } catch {
      setTodos((current) =>
        (current ?? []).map((t) => (t.id === todo.id ? { ...t, done: todo.done } : t)),
      )
      setError('That did not save.')
    }
  }

  async function remove(todo: Todo) {
    const snapshot = todos
    setTodos((current) => (current ?? []).filter((t) => t.id !== todo.id))
    try {
      await api.del(`/api/todos/${todo.id}`)
    } catch {
      setTodos(snapshot)
      setError('Could not delete that.')
    }
  }

  async function clearDone() {
    const snapshot = todos
    setTodos((current) => (current ?? []).filter((t) => !t.done))
    try {
      await api.del('/api/todos/done')
    } catch {
      setTodos(snapshot)
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel tasks-panel" role="dialog" aria-label="My tasks">
        <header className="panel-head">
          <div>
            <h2>My tasks</h2>
            <p className="tasks-note">Private to you. Nobody else can see this list.</p>
          </div>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form className="task-add" onSubmit={add}>
          <input
            ref={inputRef}
            className="task-input"
            placeholder="Add something…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="task-add-row">
            <label className="task-due">
              <span>Due</span>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            {selected && (
              <label className="task-attach">
                <input
                  type="checkbox"
                  checked={attachClient}
                  onChange={(e) => setAttachClient(e.target.checked)}
                />
                <span>Tag {selected.name}</span>
              </label>
            )}
            <button className="btn primary small" type="submit" disabled={!title.trim()}>
              Add
            </button>
          </div>
        </form>

        <div className="panel-body">
          {error && <p className="form-error">{error}</p>}
          {!todos && <p className="muted">Loading…</p>}

          {todos && open.length === 0 && done.length === 0 && (
            <p className="tasks-empty">Nothing on your list. Enjoy it while it lasts.</p>
          )}

          <ul className="task-list">
            {open.map((todo) => (
              <li className="task" key={todo.id}>
                <label className="task-tick">
                  <input type="checkbox" checked={false} onChange={() => toggle(todo)} />
                </label>
                <span className="task-body">
                  <span className="task-title">{todo.title}</span>
                  <span className="task-meta">
                    {todo.dueOn && (
                      <span className={`task-due-chip ${dueTone(todo.dueOn)}`}>
                        {dueLabel(todo.dueOn)}
                      </span>
                    )}
                    {todo.clientName && (
                      <span className={`pill ${colourClass(todo.clientColour)}`}>
                        {todo.clientName}
                      </span>
                    )}
                  </span>
                </span>
                <button className="task-delete" onClick={() => remove(todo)} aria-label="Delete">
                  ×
                </button>
              </li>
            ))}
          </ul>

          {done.length > 0 && (
            <>
              <div className="task-done-head">
                <span>Done</span>
                <button className="btn ghost small" onClick={clearDone}>
                  Clear
                </button>
              </div>
              <ul className="task-list done">
                {done.map((todo) => (
                  <li className="task" key={todo.id}>
                    <label className="task-tick">
                      <input type="checkbox" checked readOnly onClick={() => toggle(todo)} />
                    </label>
                    <span className="task-body">
                      <span className="task-title">{todo.title}</span>
                    </span>
                    <button className="task-delete" onClick={() => remove(todo)} aria-label="Delete">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
