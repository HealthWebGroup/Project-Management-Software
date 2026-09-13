import type { BoardTemplate, ColumnSettings, ColumnType } from './types'

interface TemplateColumn {
  title: string
  type: ColumnType
  settings: ColumnSettings
  width: number
}

interface Template {
  label: string
  description: string
  groups: string[]
  columns: TemplateColumn[]
}

const label = (id: string, text: string, colour: string) => ({ id, label: text, colour })

const WORK_STATUS = [
  label('not_started', 'Not started', 'grey'),
  label('working', 'Working on it', 'blue'),
  label('blocked', 'Stuck', 'red'),
  label('review', 'In review', 'violet'),
  label('done', 'Done', 'green'),
]

const PRIORITY = [
  label('low', 'Low', 'grey'),
  label('medium', 'Medium', 'blue'),
  label('high', 'High', 'amber'),
  label('critical', 'Critical', 'red'),
]

const OWNER: TemplateColumn = { title: 'Owner', type: 'PEOPLE', settings: {}, width: 110 }
const STATUS: TemplateColumn = {
  title: 'Status', type: 'STATUS', settings: { labels: WORK_STATUS }, width: 150,
}
const DUE: TemplateColumn = { title: 'Due date', type: 'DATE', settings: {}, width: 130 }

/**
 * The board templates, as configuration. A new kind of tracking is an entry
 * in this object - not a new application.
 */
export const TEMPLATES: Record<BoardTemplate, Template> = {
  PROJECTS: {
    label: 'Projects & tasks',
    description: 'Delivery work, broken into tasks with an owner, a status and a date.',
    groups: ['To do', 'In progress', 'Completed'],
    columns: [
      OWNER,
      STATUS,
      { title: 'Priority', type: 'STATUS', settings: { labels: PRIORITY }, width: 120 },
      { title: 'Timeline', type: 'TIMELINE', settings: {}, width: 190 },
      DUE,
      {
        title: 'Progress',
        type: 'NUMBER',
        settings: { unit: '%', min: 0, max: 100, display: 'bar' },
        width: 130,
      },
      { title: 'Notes', type: 'LONG_TEXT', settings: {}, width: 220 },
    ],
  },

  PIPELINE: {
    label: 'Sales pipeline',
    description: 'New business from first contact to signed, with a value and a next step.',
    groups: ['New leads', 'In discussion', 'Won or lost'],
    columns: [
      OWNER,
      {
        title: 'Stage',
        type: 'STATUS',
        settings: {
          labels: [
            label('lead', 'Lead', 'grey'),
            label('contacted', 'Contacted', 'blue'),
            label('proposal', 'Proposal sent', 'violet'),
            label('negotiating', 'Negotiating', 'amber'),
            label('won', 'Won', 'green'),
            label('lost', 'Lost', 'red'),
          ],
        },
        width: 160,
      },
      { title: 'Value', type: 'NUMBER', settings: { unit: '€' }, width: 120 },
      { title: 'Source', type: 'TEXT', settings: {}, width: 150 },
      { title: 'Next step', type: 'TEXT', settings: {}, width: 200 },
      { title: 'Follow up on', type: 'DATE', settings: {}, width: 130 },
    ],
  },

  HIRING: {
    label: 'Hiring',
    description: 'Applicants through to a start date. Created confidential by default.',
    groups: ['Open roles', 'In process', 'Offer & onboarding'],
    columns: [
      { title: 'Candidate', type: 'TEXT', settings: {}, width: 160 },
      { title: 'Role', type: 'TEXT', settings: {}, width: 160 },
      { title: 'Hiring manager', type: 'PEOPLE', settings: {}, width: 130 },
      {
        title: 'Stage',
        type: 'STATUS',
        settings: {
          labels: [
            label('applied', 'Applied', 'grey'),
            label('screening', 'Screening', 'blue'),
            label('interview', 'Interview', 'blue'),
            label('offer', 'Offer', 'violet'),
            label('checks', 'References', 'amber'),
            label('onboarding', 'Onboarding', 'blue'),
            label('hired', 'Hired', 'green'),
            label('declined', 'Declined', 'grey'),
          ],
        },
        width: 180,
      },
      { title: 'Right to work', type: 'CHECKBOX', settings: {}, width: 130 },
      { title: 'Start date', type: 'DATE', settings: {}, width: 130 },
    ],
  },

  RENEWALS: {
    label: 'Renewals & admin',
    description: 'Anything with an expiry date and a named person responsible.',
    groups: ['Domains & hosting', 'Licences & registrations', 'Business admin'],
    columns: [
      { title: 'Responsible', type: 'PEOPLE', settings: {}, width: 120 },
      {
        title: 'Status',
        type: 'STATUS',
        settings: {
          labels: [
            label('valid', 'Valid', 'green'),
            label('due_90', 'Renewal due', 'blue'),
            label('due_30', 'Action needed', 'amber'),
            label('expired', 'Expired', 'red'),
            label('submitted', 'Submitted', 'violet'),
          ],
        },
        width: 150,
      },
      {
        title: 'Category',
        type: 'DROPDOWN',
        settings: {
          options: [
            label('domain', 'Domain', 'violet'),
            label('hosting', 'Hosting', 'blue'),
            label('licence', 'Licence', 'teal'),
            label('insurance', 'Insurance', 'green'),
            label('software', 'Software', 'amber'),
          ],
        },
        width: 150,
      },
      { title: 'Expiry date', type: 'DATE', settings: {}, width: 140 },
      { title: 'Paid', type: 'CHECKBOX', settings: {}, width: 110 },
      { title: 'Reference', type: 'LINK', settings: {}, width: 160 },
    ],
  },

  CUSTOM: {
    label: 'Blank board',
    description: 'An owner, a status and a date. Add whatever else you need.',
    groups: ['Group 1'],
    columns: [OWNER, STATUS, DUE],
  },
}

export const GROUP_COLOURS = ['blue', 'violet', 'green', 'amber']
