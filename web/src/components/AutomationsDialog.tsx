import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type {
  Automation, AutomationAction, AutomationList, AutomationTrigger, BoardDetail,
} from '../lib/types'
import Dialog from './Dialog'
import { colourClass } from './Pill'

/**
 * Rules, written as sentences.
 *
 * The builder is a row of dropdowns that reads left to right - "When Status
 * becomes Done, move it to Completed" - because that is how someone thinks
 * about the rule, and a form that matches the thought is a form nobody has to
 * be taught.
 */

interface Props {
  board: BoardDetail
  onClose: () => void
  onChanged: () => void
}

const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  STATUS_BECOMES: 'a status becomes',
  DATE_ARRIVES: 'a date arrives',
  ITEM_CREATED: 'an item is created',
}

const ACTION_LABEL: Record<AutomationAction, string> = {
  MOVE_TO_GROUP: 'move it to',
  SET_STATUS: 'set',
  ASSIGN_PEOPLE: 'assign it to',
  NOTIFY: 'tell',
}

export default function AutomationsDialog({ board, onClose, onChanged }: Props) {
  const [list, setList] = useState<AutomationList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const statusColumns = board.columns.filter((c) => c.type === 'STATUS')
  const dateColumns = board.columns.filter((c) => c.type === 'DATE' || c.type === 'TIMELINE')
  const peopleColumns = board.columns.filter((c) => c.type === 'PEOPLE')

  async function load() {
    try {
      setList(await api.get<AutomationList>(`/api/boards/${board.id}/automations`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the rules.')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id])

  async function toggle(rule: Automation) {
    setBusy(true)
    try {
      await api.patch(`/api/automations/${rule.id}`, { enabled: !rule.enabled })
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change that rule.')
    }
    setBusy(false)
  }

  async function remove(rule: Automation) {
    setBusy(true)
    try {
      await api.del(`/api/automations/${rule.id}`)
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete that rule.')
    }
    setBusy(false)
  }

  return (
    <Dialog title={`Rules on ${board.name}`} onClose={onClose}>
      <p className="dialog-note">
        A rule is one sentence: <strong>when</strong> something happens, <strong>do</strong>{' '}
        something. They run on the server, so they apply whoever makes the change and whether or
        not anyone has this page open.
      </p>

      {error && <p className="form-error">{error}</p>}
      {!list && <p className="muted">Loading…</p>}

      {list && (
        <>
          <ul className="rule-list">
            {list.automations.map((rule) => (
              <li className={`rule ${rule.enabled ? '' : 'off'}`} key={rule.id}>
                <div className="rule-body">
                  <p className="rule-sentence">{sentence(rule, board)}</p>
                  <p className="rule-meta">
                    {rule.runCount === 0
                      ? 'Has not run yet'
                      : `Ran ${rule.runCount} time${rule.runCount === 1 ? '' : 's'}`}
                    {rule.lastRunAt &&
                      ` · last ${new Date(rule.lastRunAt).toLocaleDateString('en-IE')}`}
                    {!rule.enabled && ' · turned off'}
                  </p>
                </div>
                {list.canEdit && (
                  <div className="rule-actions">
                    <button className="btn ghost small" disabled={busy} onClick={() => toggle(rule)}>
                      {rule.enabled ? 'Turn off' : 'Turn on'}
                    </button>
                    <button className="btn danger small" disabled={busy} onClick={() => remove(rule)}>
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
            {list.automations.length === 0 && (
              <li className="muted rule-empty">No rules on this board yet.</li>
            )}
          </ul>

          {list.canEdit && !adding && (
            <button className="btn primary" onClick={() => setAdding(true)}>
              Add a rule
            </button>
          )}

          {list.canEdit && adding && (
            <Builder
              board={board}
              statusColumns={statusColumns}
              dateColumns={dateColumns}
              peopleColumns={peopleColumns}
              onCancel={() => setAdding(false)}
              onSaved={async () => {
                setAdding(false)
                await load()
                onChanged()
              }}
              onError={setError}
            />
          )}

          <p className="rule-caveat">
            A rule acts on what a <em>person</em> did, never on what another rule did. Two rules
            cannot set each other off in a loop — which also means chaining one into another will
            not work, by design.
          </p>
        </>
      )}

      <div className="dialog-actions">
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

// -------------------------------------------------------------- the builder

function Builder({
  board, statusColumns, dateColumns, peopleColumns, onCancel, onSaved, onError,
}: {
  board: BoardDetail
  statusColumns: BoardDetail['columns']
  dateColumns: BoardDetail['columns']
  peopleColumns: BoardDetail['columns']
  onCancel: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    statusColumns.length > 0 ? 'STATUS_BECOMES' : 'ITEM_CREATED',
  )
  const [triggerColumn, setTriggerColumn] = useState(statusColumns[0]?.id ?? '')
  const [triggerLabel, setTriggerLabel] = useState('')
  const [offsetDays, setOffsetDays] = useState(-3)

  const [action, setAction] = useState<AutomationAction>('MOVE_TO_GROUP')
  const [groupId, setGroupId] = useState(board.groups[0]?.id ?? '')
  const [actionColumn, setActionColumn] = useState(statusColumns[0]?.id ?? '')
  const [actionLabel, setActionLabel] = useState('')
  const [userIds, setUserIds] = useState<string[]>([])
  const [who, setWho] = useState<'OWNERS' | 'BOARD'>('OWNERS')
  const [busy, setBusy] = useState(false)

  const triggerDateColumns = dateColumns
  const triggerLabels =
    statusColumns.find((c) => c.id === triggerColumn)?.settings.labels ?? []
  const actionLabels = statusColumns.find((c) => c.id === actionColumn)?.settings.labels ?? []

  /**
   * Two dropdowns share one piece of state — the trigger's column is either a
   * status column or a date column, depending on the trigger type — and the
   * same is true of the action's. Switching type used to leave the old id in
   * place: the select rendered blank because nothing matched, while the state
   * behind it still held, say, a status column about to be saved as a date
   * rule. So: reset on every switch, and check the chosen id is actually one
   * of the options offered rather than merely non-empty.
   */
  const inList = (id: string, columns: BoardDetail['columns']) => columns.some((c) => c.id === id)
  const hasLabel = (columnId: string, labelId: string) =>
    (statusColumns.find((c) => c.id === columnId)?.settings.labels ?? []).some((l) => l.id === labelId)

  function chooseTrigger(next: AutomationTrigger) {
    setTrigger(next)
    setTriggerLabel('')
    setTriggerColumn(
      next === 'STATUS_BECOMES' ? statusColumns[0]?.id ?? ''
      : next === 'DATE_ARRIVES' ? dateColumns[0]?.id ?? ''
      : '',
    )
  }

  function chooseAction(next: AutomationAction) {
    setAction(next)
    setActionLabel('')
    setUserIds([])
    setActionColumn(
      next === 'SET_STATUS' ? statusColumns[0]?.id ?? ''
      : next === 'ASSIGN_PEOPLE' ? peopleColumns[0]?.id ?? ''
      : '',
    )
  }

  // The server checks all of this too. Disabling the button just stops the
  // pointless round trip and the opaque rejection at the end of it.
  const ready =
    (trigger === 'STATUS_BECOMES'
      ? inList(triggerColumn, statusColumns) && hasLabel(triggerColumn, triggerLabel)
      : true) &&
    (trigger === 'DATE_ARRIVES' ? inList(triggerColumn, dateColumns) : true) &&
    (action === 'MOVE_TO_GROUP' ? board.groups.some((g) => g.id === groupId) : true) &&
    (action === 'SET_STATUS'
      ? inList(actionColumn, statusColumns) && hasLabel(actionColumn, actionLabel)
      : true) &&
    (action === 'ASSIGN_PEOPLE'
      ? inList(actionColumn, peopleColumns) &&
        userIds.length > 0 &&
        userIds.every((id) => board.members.some((m) => m.id === id))
      : true)

  async function save() {
    setBusy(true)
    try {
      await api.post(`/api/boards/${board.id}/automations`, {
        name: describe(),
        trigger:
          trigger === 'STATUS_BECOMES'
            ? { type: trigger, columnId: triggerColumn, labelId: triggerLabel }
            : trigger === 'DATE_ARRIVES'
              ? { type: trigger, columnId: triggerColumn, offsetDays }
              : { type: trigger },
        action:
          action === 'MOVE_TO_GROUP'
            ? { type: action, groupId }
            : action === 'SET_STATUS'
              ? { type: action, columnId: actionColumn, labelId: actionLabel }
              : action === 'ASSIGN_PEOPLE'
                ? { type: action, columnId: actionColumn, userIds }
                : { type: action, who },
      })
      onSaved()
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Could not save that rule.')
      setBusy(false)
    }
  }

  function describe(): string {
    const when =
      trigger === 'STATUS_BECOMES'
        ? `When ${columnName(board, triggerColumn)} becomes ${
            triggerLabels.find((l) => l.id === triggerLabel)?.label ?? '…'
          }`
        : trigger === 'DATE_ARRIVES'
          ? `${offsetSentence(offsetDays)} ${columnName(board, triggerColumn)}`
          : 'When an item is created'
    const then =
      action === 'MOVE_TO_GROUP'
        ? `move it to ${board.groups.find((g) => g.id === groupId)?.title ?? '…'}`
        : action === 'SET_STATUS'
          ? `set ${columnName(board, actionColumn)} to ${
              actionLabels.find((l) => l.id === actionLabel)?.label ?? '…'
            }`
          : action === 'ASSIGN_PEOPLE'
            ? `assign it to ${userIds
                .map((id) => board.members.find((m) => m.id === id)?.fullName ?? '…')
                .join(', ')}`
            : who === 'BOARD'
              ? 'tell everyone named on the board'
              : 'tell whoever owns it'
    return `${when}, ${then}`
  }

  return (
    <div className="rule-builder">
      <p className="rule-preview">{describe()}</p>

      <div className="rule-clause">
        <span className="rule-word">When</span>
        <select value={trigger} onChange={(e) => chooseTrigger(e.target.value as AutomationTrigger)}>
          {statusColumns.length > 0 && (
            <option value="STATUS_BECOMES">{TRIGGER_LABEL.STATUS_BECOMES}</option>
          )}
          {triggerDateColumns.length > 0 && (
            <option value="DATE_ARRIVES">{TRIGGER_LABEL.DATE_ARRIVES}</option>
          )}
          <option value="ITEM_CREATED">{TRIGGER_LABEL.ITEM_CREATED}</option>
        </select>

        {trigger === 'STATUS_BECOMES' && (
          <>
            <select
              value={triggerColumn}
              onChange={(e) => {
                setTriggerColumn(e.target.value)
                // A label belongs to one column. Carrying it across would
                // save a label from column A onto column B.
                setTriggerLabel('')
              }}
            >
              {statusColumns.map((column) => (
                <option key={column.id} value={column.id}>{column.title}</option>
              ))}
            </select>
            <span className="rule-word">is set to</span>
            <select value={triggerLabel} onChange={(e) => setTriggerLabel(e.target.value)}>
              <option value="">choose…</option>
              {triggerLabels.map((label) => (
                <option key={label.id} value={label.id}>{label.label}</option>
              ))}
            </select>
          </>
        )}

        {trigger === 'DATE_ARRIVES' && (
          <>
            <select value={offsetDays} onChange={(e) => setOffsetDays(Number(e.target.value))}>
              <option value={-7}>7 days before</option>
              <option value={-3}>3 days before</option>
              <option value={-1}>the day before</option>
              <option value={0}>on the day of</option>
              <option value={1}>the day after</option>
            </select>
            <select value={triggerColumn} onChange={(e) => setTriggerColumn(e.target.value)}>
              <option value="">choose a date column…</option>
              {triggerDateColumns.map((column) => (
                <option key={column.id} value={column.id}>{column.title}</option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="rule-clause">
        <span className="rule-word">then</span>
        <select value={action} onChange={(e) => chooseAction(e.target.value as AutomationAction)}>
          <option value="MOVE_TO_GROUP">{ACTION_LABEL.MOVE_TO_GROUP} a group</option>
          {statusColumns.length > 0 && <option value="SET_STATUS">set a status</option>}
          {peopleColumns.length > 0 && <option value="ASSIGN_PEOPLE">assign someone</option>}
          <option value="NOTIFY">tell someone</option>
        </select>

        {action === 'MOVE_TO_GROUP' && (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {board.groups.map((group) => (
              <option key={group.id} value={group.id}>{group.title}</option>
            ))}
          </select>
        )}

        {action === 'SET_STATUS' && (
          <>
            <select
              value={actionColumn}
              onChange={(e) => {
                setActionColumn(e.target.value)
                setActionLabel('')
              }}
            >
              {statusColumns.map((column) => (
                <option key={column.id} value={column.id}>{column.title}</option>
              ))}
            </select>
            <span className="rule-word">to</span>
            <select value={actionLabel} onChange={(e) => setActionLabel(e.target.value)}>
              <option value="">choose…</option>
              {actionLabels.map((label) => (
                <option key={label.id} value={label.id}>{label.label}</option>
              ))}
            </select>
          </>
        )}

        {action === 'ASSIGN_PEOPLE' && (
          <>
            <select value={actionColumn} onChange={(e) => setActionColumn(e.target.value)}>
              {peopleColumns.map((column) => (
                <option key={column.id} value={column.id}>{column.title}</option>
              ))}
            </select>
            <select
              value={userIds[0] ?? ''}
              onChange={(e) => setUserIds(e.target.value ? [e.target.value] : [])}
            >
              <option value="">choose…</option>
              {board.members.map((member) => (
                <option key={member.id} value={member.id}>{member.fullName}</option>
              ))}
            </select>
          </>
        )}

        {action === 'NOTIFY' && (
          <select value={who} onChange={(e) => setWho(e.target.value as 'OWNERS' | 'BOARD')}>
            <option value="OWNERS">whoever owns it</option>
            <option value="BOARD">everyone named on the board</option>
          </select>
        )}
      </div>

      <div className="rule-builder-actions">
        <button className="btn ghost small" onClick={onCancel}>Cancel</button>
        <button className="btn primary small" onClick={save} disabled={busy || !ready}>
          {busy ? 'Saving…' : 'Save rule'}
        </button>
      </div>
    </div>
  )
}

// -------------------------------------------------------------- sentences

function columnName(board: BoardDetail, columnId?: string): string {
  return board.columns.find((c) => c.id === columnId)?.title ?? 'a column'
}

function offsetSentence(days: number): string {
  if (days === 0) return 'On the day of'
  if (days === 1) return 'The day after'
  if (days === -1) return 'The day before'
  return days < 0 ? `${Math.abs(days)} days before` : `${days} days after`
}

/** The stored sentence, rebuilt from live board data so a renamed column or
 *  label reads correctly rather than showing what it was called last week. */
function sentence(rule: Automation, board: BoardDetail) {
  const status = board.columns.find((c) => c.id === rule.trigger.columnId)
  const label = status?.settings.labels?.find((l) => l.id === rule.trigger.labelId)
  const group = board.groups.find((g) => g.id === rule.action.groupId)
  const actionColumn = board.columns.find((c) => c.id === rule.action.columnId)
  const actionLabel = actionColumn?.settings.labels?.find((l) => l.id === rule.action.labelId)

  const when =
    rule.trigger.type === 'STATUS_BECOMES' ? (
      <>
        When <b>{status?.title ?? 'a status'}</b> becomes{' '}
        <span className={`pill ${colourClass(label?.colour)}`}>{label?.label ?? '—'}</span>
      </>
    ) : rule.trigger.type === 'DATE_ARRIVES' ? (
      <>
        {offsetSentence(rule.trigger.offsetDays ?? 0)} <b>{columnName(board, rule.trigger.columnId)}</b>
      </>
    ) : (
      <>When an item is created</>
    )

  const then =
    rule.action.type === 'MOVE_TO_GROUP' ? (
      <>
        move it to <b>{group?.title ?? '—'}</b>
      </>
    ) : rule.action.type === 'SET_STATUS' ? (
      <>
        set <b>{actionColumn?.title ?? '—'}</b> to{' '}
        <span className={`pill ${colourClass(actionLabel?.colour)}`}>{actionLabel?.label ?? '—'}</span>
      </>
    ) : rule.action.type === 'ASSIGN_PEOPLE' ? (
      <>
        assign it to{' '}
        <b>
          {(rule.action.userIds ?? [])
            .map((id) => board.members.find((m) => m.id === id)?.fullName ?? 'someone')
            .join(', ')}
        </b>
      </>
    ) : (
      <>{rule.action.who === 'BOARD' ? 'tell everyone named on the board' : 'tell whoever owns it'}</>
    )

  return (
    <>
      {when}, {then}
    </>
  )
}
