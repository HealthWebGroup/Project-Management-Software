import { now } from './db'
import type { Env } from './types'

/**
 * Email, as an optional copy of what is already in the app.
 *
 * The in-app bell is the feature; this is a convenience on top of it. If no
 * key is configured, everything here quietly does nothing and the rest of the
 * system is unaffected — which is the point. Nobody should have to open an
 * account with a third party to be told their work is due.
 *
 * One digest per person per run, not one email per notification. A tool that
 * sends six emails in a morning is a tool people filter into a folder they
 * never open.
 */

const ENDPOINT = 'https://api.resend.com/emails'
const MAX_PEOPLE_PER_RUN = 50

export const emailEnabled = (env: Env): boolean =>
  Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM)

interface Pending {
  id: string
  user_id: string
  email: string
  full_name: string
  title: string
  body: string | null
  board_name: string | null
  created_at: string
}

export async function sendDigests(env: Env): Promise<{ sent: number; people: number; reason?: string }> {
  if (!emailEnabled(env)) return { sent: 0, people: 0, reason: 'no email key configured' }

  const rows = await env.DB
    .prepare(
      `select n.id, n.user_id, u.email, u.full_name, n.title, n.body, b.name as board_name,
              n.created_at
         from notification n
         join app_user u on u.id = n.user_id
         left join board b on b.id = n.board_id
        where n.read_at is null
          and n.emailed_at is null
          and u.status = 'ACTIVE'
          and n.created_at >= ?
        order by n.user_id, n.created_at desc`,
    )
    .bind(new Date(Date.now() - 86400000).toISOString())
    .all<Pending>()

  if (rows.results.length === 0) return { sent: 0, people: 0 }

  const byPerson = new Map<string, Pending[]>()
  for (const row of rows.results) {
    const bucket = byPerson.get(row.user_id) ?? []
    bucket.push(row)
    byPerson.set(row.user_id, bucket)
  }

  let sent = 0
  const delivered: string[] = []

  for (const [, items] of [...byPerson].slice(0, MAX_PEOPLE_PER_RUN)) {
    const ok = await deliver(env, items).catch(() => false)
    if (ok) {
      sent++
      // Only mark what actually went out. A failed send stays pending and is
      // tried again tomorrow rather than being silently swallowed.
      for (const item of items) delivered.push(item.id)
    }
  }

  if (delivered.length > 0) {
    const marks = delivered.map(() => '?').join(', ')
    await env.DB
      .prepare(`update notification set emailed_at = ? where id in (${marks})`)
      .bind(now(), ...delivered)
      .run()
  }

  return { sent, people: byPerson.size }
}

async function deliver(env: Env, items: Pending[]): Promise<boolean> {
  const person = items[0]
  const link = env.APP_URL ?? ''
  const lines = items
    .map(
      (item) =>
        `<li style="margin:0 0 10px"><strong>${escape(item.title)}</strong>` +
        (item.body ? `<br><span style="color:#555">${escape(item.body)}</span>` : '') +
        (item.board_name ? `<br><span style="color:#777;font-size:12px">${escape(item.board_name)}</span>` : '') +
        `</li>`,
    )
    .join('')

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [person.email],
      // Trimmed of newlines and length-capped. The title can be an automation
      // rule's name, which a person typed, and a subject line is not the place
      // to find out what happens when that contains a control character.
      subject:
        items.length === 1
          ? subjectSafe(items[0].title)
          : `${items.length} things waiting for you`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">` +
        `<p>Hello ${escape(person.full_name.split(' ')[0])},</p>` +
        `<ul style="padding-left:18px">${lines}</ul>` +
        (link ? `<p><a href="${escape(link)}">Open Work OS</a></p>` : '') +
        `<p style="color:#888;font-size:12px">You are getting this because you have unread ` +
        `notifications. They are all in the app as well.</p></div>`,
    }),
  })

  return response.ok
}

/** The only place notification text meets HTML, so the only place it can bite. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Single quotes too, so the helper is still safe if it is ever used
    // inside a single-quoted attribute rather than the double-quoted one
    // it happens to sit in today.
    .replace(/'/g, '&#39;')
}

/** A subject line: one line, and a sensible length. */
function subjectSafe(value: string): string {
  const flat = value.replace(/[\r\n\t]+/g, ' ').trim()
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat || 'Something is waiting for you'
}
