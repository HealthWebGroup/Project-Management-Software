export type Role = 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER' | 'GUEST'

export type ColumnType =
  | 'TEXT' | 'LONG_TEXT' | 'STATUS' | 'PEOPLE' | 'DATE' | 'TIMELINE'
  | 'NUMBER' | 'DROPDOWN' | 'CHECKBOX' | 'FILE' | 'LINK' | 'DEPENDENCY' | 'FORMULA'

export type BoardTemplate = 'PROJECTS' | 'PIPELINE' | 'HIRING' | 'RENEWALS' | 'CUSTOM'

export type Sensitivity = 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED'

export interface User {
  id: string
  email: string
  fullName: string
  jobTitle?: string
  role: Role
  siteId?: string
  mustChangePassword: boolean
}

export interface LoginResponse {
  token: string
  expiresInHours: number
  user: User
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

export interface Column {
  id: string
  title: string
  type: ColumnType
  settings: ColumnSettings
  sortOrder: number
  width: number
}

export interface Group {
  id: string
  title: string
  colour: string
  sortOrder: number
  collapsed: boolean
}

/** Cell values are objects whose shape depends on the column type. */
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
}

export interface Item {
  id: string
  groupId?: string
  parentId?: string
  clientId?: string
  title: string
  sortOrder: number
  cells: Record<string, CellValue>
  createdAt?: string
  updatedAt?: string
}

export interface BoardDetail {
  id: string
  workspaceId: string
  name: string
  description?: string
  clientId?: string
  template: BoardTemplate
  sensitivity: Sensitivity
  groups: Group[]
  columns: Column[]
  items: Item[]
  members: User[]
  canEdit: boolean
}

export interface BoardSummary {
  id: string
  name: string
  description?: string
  clientId?: string
  template: BoardTemplate
  sensitivity: Sensitivity
  itemCount: number
}

export interface Workspace {
  id: string
  name: string
  description?: string
  colour: string
  boards: BoardSummary[]
}

export interface ItemUpdate {
  id: string
  authorId?: string
  authorName: string
  body: string
  createdAt: string
}

export interface ActivityEntry {
  id: number
  actorName: string
  action: string
  detail?: string
  occurredAt: string
}

export interface ItemDetail {
  item: Item
  subitems: Item[]
  updates: ItemUpdate[]
  activity: ActivityEntry[]
}

// ------------------------------------------------------------- clients

export type ClientStatus = 'PROSPECT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
export type ClientRole = 'LEAD' | 'MEMBER'

export interface ClientMember {
  userId: string
  fullName: string
  jobTitle?: string
  roleOnClient: ClientRole
}

export interface Client {
  id: string
  name: string
  code: string
  status: ClientStatus
  colour: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  website?: string
  address?: string
  notes?: string
  startedOn?: string
  team: ClientMember[]
  openItems: number
  minutesThisMonth: number
}

// ------------------------------------------------------------ presence

export interface OnlineUser {
  userId: string
  fullName: string
  jobTitle?: string
  role: Role
  sessionStartedAt: string
  minutesOnline: number
  lastSeenAt: string
}

export interface SessionRow {
  id: string
  userId: string
  fullName: string
  startedAt: string
  endedAt?: string
  minutes: number
  live: boolean
}

// ---------------------------------------------------------------- time

export interface TimeEntry {
  id: string
  userId: string
  userName: string
  clientId?: string
  clientName?: string
  clientColour?: string
  itemId?: string
  itemTitle?: string
  startedAt: string
  endedAt?: string
  minutes?: number
  note?: string
  billable: boolean
  running: boolean
}

export interface ClientHours {
  clientId?: string
  clientName: string
  colour: string
  minutes: number
}

export interface PersonHours {
  userId: string
  fullName: string
  minutes: number
}

export interface TimeSummary {
  from: string
  to: string
  totalMinutes: number
  billableMinutes: number
  byClient: ClientHours[]
  byPerson: PersonHours[]
}

// ------------------------------------------------------------ dashboard

export interface StatusSlice {
  labelId: string
  label: string
  colour: string
  count: number
}

export interface WorkloadRow {
  userId: string
  fullName: string
  open: number
  overdue: number
}

export interface AtRiskItem {
  itemId: string
  title: string
  boardId: string
  boardName: string
  clientId?: string
  clientName?: string
  owners: string[]
  dueOn?: string
  daysLate: number
  statusLabel: string
  statusColour: string
}

export interface Dashboard {
  openItems: number
  overdue: number
  dueThisWeek: number
  unassigned: number
  activeClients: number
  minutesLogged: number
  billableMinutes: number
  statusBreakdown: StatusSlice[]
  workload: WorkloadRow[]
  hoursByClient: ClientHours[]
  atRisk: AtRiskItem[]
}

// ---------------------------------------------------------------- todos

export interface Todo {
  id: string
  title: string
  done: boolean
  dueOn?: string
  sortOrder: number
  clientId?: string
  clientName?: string
  clientColour?: string
}

// ------------------------------------------------------- people & access

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'LEAVER'
export type BoardPermission = 'VIEW' | 'EDIT' | 'ADMIN'

export interface PersonClient {
  clientId: string
  name: string
  code: string
  colour: string
  roleOnClient: ClientRole
}

export interface BoardOverride {
  boardId: string
  boardName: string
  permission: BoardPermission
}

export interface Person {
  id: string
  email: string
  fullName: string
  jobTitle?: string
  role: Role
  status: UserStatus
  lastLoginAt?: string
  /** Admins and managers reach every client whether assigned or not. */
  seesEveryClient: boolean
  clients: PersonClient[]
  boardOverrides: BoardOverride[]
}

export interface AccessPreviewRow {
  boardId: string
  boardName: string
  clientName?: string
  sensitivity: Sensitivity
  access: string
  viaOverride: boolean
}

export interface AccessPreview {
  userId: string
  fullName: string
  role: Role
  boards: AccessPreviewRow[]
}

// ----------------------------------------------------------- automations

export type AutomationTrigger = 'STATUS_BECOMES' | 'DATE_ARRIVES' | 'ITEM_CREATED'
export type AutomationAction = 'MOVE_TO_GROUP' | 'SET_STATUS' | 'ASSIGN_PEOPLE' | 'NOTIFY'

export interface Automation {
  id: string
  boardId: string
  name: string
  trigger: {
    type: AutomationTrigger
    columnId?: string
    labelId?: string
    offsetDays?: number
  }
  action: {
    type: AutomationAction
    groupId?: string
    columnId?: string
    labelId?: string
    userIds?: string[]
    who?: 'OWNERS' | 'BOARD'
  }
  enabled: boolean
  createdAt: string
  lastRunAt?: string
  runCount: number
}

export interface AutomationList {
  boardId: string
  canEdit: boolean
  automations: Automation[]
}

// --------------------------------------------------------- notifications

export interface Notification {
  id: string
  kind: string
  title: string
  body?: string
  boardId?: string
  boardName?: string
  itemId?: string
  createdAt: string
  read: boolean
}

export interface NotificationList {
  unread: number
  notifications: Notification[]
}

// ------------------------------------------------------- board membership

export interface BoardMember {
  userId: string
  fullName: string
  email: string
  permission: BoardPermission
}

export interface BoardAccess {
  boardId: string
  boardName: string
  sensitivity: Sensitivity
  members: BoardMember[]
}
