/**
 * Who can see this client — and, just as importantly, who cannot.
 *
 * The request behind this screen was "only the people working for this
 * client should see their files". The application already enforces that;
 * what it never did was say so. Ticking names in a team list and then
 * having no way to check the result is how a team ends up assuming a client
 * is private when it is not, which is the expensive direction to be wrong in.
 *
 * Two things this is careful about:
 *
 *   1. It never works the answer out itself. Every person arrives from the
 *      server with `canSee` already decided by the same rules the API
 *      enforces, and `access` saying whether the team list has any bearing
 *      on them. The only arithmetic here is
 *      `always || (when-assigned && ticked)` — a formula over server
 *      conclusions, not a second copy of the role rules. A screen about
 *      confidentiality that quietly disagrees with the lock is worse than
 *      no screen.
 *
 *   2. It shows the unsaved state. Inside the team dialog the whole point is
 *      to see what a tick will do before committing to it, so `pending` —
 *      the dialog's in-progress selection — takes the place of the saved
 *      team, and changed lines are marked so the difference is visible.
 *
 * Managers and administrators are listed under their own heading rather than
 * mixed in, because "Niall can see this" and "Niall can see everything" are
 * different facts and only one of them is about this client.
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { ClientRole, ClientVisibility as Visibility, ClientVisibilityPerson } from '../lib/types'
import { Avatar } from './Pill'

interface Props {
  clientId: string
  /**
   * The team dialog's unsaved selection, keyed by user id. Given, it stands
   * in for the saved team so the list previews the effect of a tick.
   */
  pending?: Record<string, ClientRole>
}

/** Plain English for the reason the server gave. */
const WHY: Record<ClientVisibilityPerson['reason'], string> = {
  administrator: 'Administrator — sees every client',
  manager: 'Manager — sees every client',
  assigned: 'On this client’s team',
  guest: 'Guest — only boards they are named on',
  none: 'Not on this client’s team',
}

export default function ClientVisibilityList({ clientId, pending }: Props) {
  const [data, setData] = useState<Visibility | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    let cancelled = false
    api
      .get<Visibility>(`/api/clients/${clientId}/visibility`)
      .then((v) => !cancelled && setData(v))
      .catch(() => !cancelled && setFailed(true))
    return () => { cancelled = true }
  }, [clientId])

  useEffect(() => load(), [load])

  if (failed) {
    // Never imply privacy that has not been confirmed. If the answer could
    // not be fetched, say nothing about who can see what.
    return <p className="vis-failed">Could not check who can see this client.</p>
  }
  if (!data) return <p className="muted">Checking…</p>

  /** The tick as it stands right now — unsaved if the dialog is driving. */
  const ticked = (person: ClientVisibilityPerson): boolean =>
    pending ? pending[person.userId] !== undefined : person.onTeam

  /** The single rule this component applies. Nothing else infers access. */
  const canSee = (person: ClientVisibilityPerson): boolean =>
    person.access === 'always' || (person.access === 'when-assigned' && ticked(person))

  const changed = (person: ClientVisibilityPerson): boolean =>
    pending !== undefined && person.access === 'when-assigned' && ticked(person) !== person.onTeam

  const always = data.people.filter((p) => p.access === 'always')
  const rest = data.people.filter((p) => p.access !== 'always')
  const withAccess = rest.filter(canSee)
  const without = rest.filter((p) => !canSee(p))

  /**
   * The case worth calling out by name: everybody in the organisation is an
   * administrator or a manager, so the team list below decides nothing at
   * all. That is not a bug, and it is the exact reason assigning a team can
   * look like it did nothing — so the screen says it outright instead of
   * showing a tidy list that quietly means nothing.
   */
  const teamChangesNothing = rest.length === 0

  return (
    <div className="vis">
      {teamChangesNothing && (
        <p className="vis-flag">
          Everyone here is an administrator or a manager, and both see every client. Until somebody
          has the role Member or Viewer, assigning a team changes who is <em>named</em> on this
          client, not who can open it. Roles are on the People page.
        </p>
      )}

      <div className="vis-group allowed">
        <h4 className="vis-title">
          Can see {data.clientName}
          <span className="vis-count">{always.length + withAccess.length}</span>
        </h4>
        <ul className="vis-rows">
          {withAccess.map((person) => (
            <Row key={person.userId} person={person}
                 why={ticked(person) ? WHY.assigned : WHY[person.reason]}
                 changed={changed(person)} added />
          ))}
          {always.map((person) => (
            <Row key={person.userId} person={person} why={WHY[person.reason]} muted />
          ))}
        </ul>
        {always.length > 0 && (
          <p className="vis-note">
            Administrators and managers see every client. Taking them off a team does not change
            that — change their role on the People page if they should not.
          </p>
        )}
      </div>

      {without.length > 0 && (
        <div className="vis-group denied">
          <h4 className="vis-title">
            Cannot see it
            <span className="vis-count">{without.length}</span>
          </h4>
          <ul className="vis-rows">
            {without.map((person) => (
              <Row key={person.userId} person={person}
                   why={person.access === 'never' ? WHY.guest : WHY.none}
                   changed={changed(person)} />
            ))}
          </ul>
        </div>
      )}

      <p className="vis-note">
        This covers the client’s boards, tasks, files and notes. Somebody can still be given one
        single board through <strong>Board access</strong> on that board, without being on this
        client.
      </p>
    </div>
  )
}

function Row({
  person, why, changed, added, muted,
}: {
  person: ClientVisibilityPerson
  why: string
  changed?: boolean
  added?: boolean
  muted?: boolean
}) {
  return (
    <li className={`vis-row${muted ? ' by-role' : ''}${changed ? ' changed' : ''}`}>
      <Avatar name={person.fullName} />
      <span className="vis-name">
        <span className="vis-top">
          {person.fullName}
          {person.leadOnClient && <em className="vis-lead">Lead</em>}
        </span>
        <small>{person.jobTitle ?? why}</small>
      </span>
      {person.jobTitle && <span className="vis-why">{why}</span>}
      {changed && <span className="vis-change">{added ? 'Adding' : 'Removing'}</span>}
    </li>
  )
}
