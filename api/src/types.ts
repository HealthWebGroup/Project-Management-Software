/** Bindings and variables this Worker is given, declared in wrangler.toml. */
export interface Env {
  DB: D1Database

  /** Cloudflare Zero Trust team name: https://<team>.cloudflareaccess.com */
  ACCESS_TEAM_NAME: string
  /** Application Audience tag of the Access application in front of this app. */
  ACCESS_AUD: string
  /** The first person to sign in with this address is made an administrator. */
  BOOTSTRAP_ADMIN_EMAIL: string
  /**
   * Which email domains may sign in, comma separated, without the "@" —
   * e.g. "healthwebgroup.com". Leave empty to allow anyone Access admits.
   *
   * This deliberately repeats a rule that Cloudflare Access already applies.
   * Access is the front door and can be changed by anyone with dashboard
   * access, including by accident: widening one policy from "Emails ending
   * in" to "Everyone" is two clicks and no warning. This check sits in the
   * application, where changing it needs a deploy.
   */
  ALLOWED_EMAIL_DOMAINS?: string
  /** "true" only for local development - see README. */
  ALLOW_PASSWORD_LOGIN: string
  /** Secret, set with `wrangler secret put JWT_SECRET`. Password path only. */
  JWT_SECRET?: string

  /**
   * Email is optional. Leave these unset and notifications stay in-app only,
   * which is a complete feature on its own - nothing here depends on an
   * outside service being reachable or paid for.
   *
   *   EMAIL_API_KEY  secret: `wrangler secret put EMAIL_API_KEY`
   *   EMAIL_FROM     e.g. "Work OS <workos@healthwebgroup.com>"
   *   APP_URL        used for the link in the email
   */
  EMAIL_API_KEY?: string
  EMAIL_FROM?: string
  APP_URL?: string
}

/**
 * What someone can do across the whole account.
 *
 *   ADMIN    runs the system: people, roles, every board
 *   MANAGER  runs the work: every client and board, can add clients and boards
 *   MEMBER   does the work: only the clients they are assigned to
 *   VIEWER   read-only, and again only their assigned clients
 *   GUEST    nothing by default; needs to be added to specific boards
 *
 * Which clients a MEMBER or VIEWER is assigned to is what you set on the
 * People screen. That is the main lever; board-level exceptions exist for
 * the cases it does not cover.
 */
export type Role = 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER' | 'GUEST'

/**
 * How restricted a board is.
 *
 *   INTERNAL      ordinary work - anyone with access to that client
 *   CONFIDENTIAL  commercially sensitive - managers and admins
 *   RESTRICTED    named people only, whatever their role
 */
export type Sensitivity = 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED'

export type BoardTemplate = 'PROJECTS' | 'PIPELINE' | 'HIRING' | 'RENEWALS' | 'CUSTOM'
export type ClientStatus = 'PROSPECT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
export type ClientRole = 'LEAD' | 'MEMBER'
export type BoardPermission = 'VIEW' | 'EDIT' | 'ADMIN'
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'LEAVER'

export type ColumnType =
  | 'TEXT' | 'LONG_TEXT' | 'STATUS' | 'PEOPLE' | 'DATE' | 'TIMELINE'
  | 'NUMBER' | 'DROPDOWN' | 'CHECKBOX' | 'FILE' | 'LINK' | 'DEPENDENCY' | 'FORMULA'

/** The authenticated caller, resolved once per request. */
export interface Principal {
  userId: string
  organisationId: string
  email: string
  fullName: string
  role: Role
  sessionId: string | null
  /**
   * Client ids this person is assigned to. Empty for admins and managers,
   * who see everything - check the role before reading this.
   */
  clientIds: string[]
}

/** Cell values are JSON objects whose shape depends on the column type. */
export interface CellValue {
  text?: string
  labelId?: string
  userIds?: string[]
  itemIds?: string[]
  date?: string
  start?: string
  end?: string
  number?: number
  optionIds?: string[]
  checked?: boolean
  url?: string
  label?: string
  files?: unknown[]
}

export interface StatusLabel {
  id: string
  label: string
  colour: string
}

export interface ColumnSettings {
  labels?: StatusLabel[]
  options?: StatusLabel[]
  unit?: string
  min?: number
  max?: number
  display?: string
  derivedFrom?: string
}

/** Hono context variables. */
export type Vars = { principal: Principal }
