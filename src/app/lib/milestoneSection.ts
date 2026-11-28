import { MAX_TICKETS_REMAINING, type InputsView, type TicketsSourceView } from '../../forecast/index.js'
import type { TicketsSource } from '../../model/milestoneInputs.js'
import { escapeHtml } from '../html.js'
import {
  errorLine,
  formAction,
  incompleteMark,
  INPUT_LABELS,
  inputSection,
  notesFor,
  radios,
  type FormError,
  type FormTarget,
  type Section,
} from './inputSection.js'
import { chip, chipForms, type Chip } from './readsDifferently.js'

// Behind inputsScreen.ts: its Milestone section.

/** Where the form choosing where tickets remaining comes from posts. */
const TICKETS_SOURCE_TARGET: FormTarget = { path: '/inputs/tickets-source', anchor: 'milestone' }

/** The chip on tickets remaining: its Follow posts as that form does, choosing the tracker. */
const TICKETS_CHIP: Chip = { id: 'tickets', reading: 'ticketsRemaining', follow: { ...TICKETS_SOURCE_TARGET, fields: { ticketsSource: 'tracker' } } }

/**
 * The milestone's name, start date and tickets remaining. With a connection, tickets remaining has a source to choose
 * (`ticketsSource`): following the tracker, it shows the latest read's count, with no field to type in; typed, the
 * field as in the MVP. The source's radios sit by the field but post their own form, saved as soon as one is chosen.
 */
export function milestoneSection(screen: InputsView, error: FormError): Section {
  const { ticketsSource, notes } = screen.milestone
  const form = screen.forms.milestone
  const following = ticketsSource?.source === 'tracker'
  const typedField = `<label>${INPUT_LABELS.ticketsRemaining} <input type="number" name="ticketsRemaining" min="0" max="${MAX_TICKETS_REMAINING}" step="1" value="${escapeHtml(form.ticketsRemaining)}" required></label>`
  const tickets = ticketsSource
    ? `<div class="tickets-source">
              ${radios('ticketsSource', `Where ${INPUT_LABELS.ticketsRemaining.toLowerCase()} comes from`, TICKETS_SOURCES, ticketsSource.source, (source) => (source === 'tracker' ? escapeHtml(ticketsSource.tracker) : 'Typed'), { form: TICKETS_SOURCE_FORM }).trim()}
              ${following ? trackerTickets(ticketsSource) : typedField + ticketsChip(ticketsSource)}
            </div>`
    : typedField
  return inputSection(
    'Milestone',
    'Milestone',
    'Its name, start date, and tickets left.',
    `        <form method="post" action="/inputs/milestone#milestone">${errorLine(error('milestone'))}
          <div class="fields">
            <label class="wide">${INPUT_LABELS.name} <input type="text" name="name" value="${escapeHtml(form.name)}" required></label>${notesFor('name', notes)}
            <label>${INPUT_LABELS.startDate} <input type="date" name="startDate" value="${escapeHtml(form.startDate)}" required></label>${notesFor('startDate', notes)}
            ${tickets}${notesFor('ticketsRemaining', notes)}
          </div>
          <div class="actions"><button type="submit" class="primary">Save milestone</button></div>
        </form>${
          ticketsSource
            ? `
        <form method="post" action="${formAction(TICKETS_SOURCE_TARGET)}" id="${TICKETS_SOURCE_FORM}">${errorLine(error('ticketsSource'))}
          <div class="actions"><button type="submit">Use this source</button></div>
        </form>${
          // opening a reading is posted by the page's script, which shows no reply; a refusal shows here, by the first chip
          errorLine(error('readingOpened'))
        }${chipForms(TICKETS_CHIP, ticketsSource.readsDifferently)}`
            : ''
        }`,
  )
}

const TICKETS_SOURCE_FORM = 'tickets-source'
const TICKETS_SOURCES: readonly TicketsSource[] = ['tracker', 'typed']

/** Tickets remaining typed, with its chip when the tracker reads it differently. */
function ticketsChip({ tracker, reading, readsDifferently }: TicketsSourceView): string {
  if (!readsDifferently || !reading) return ''
  return `
              ${chip(TICKETS_CHIP, tracker, readsDifferently, `<p>${escapeHtml(tracker)} reads <b>${reading.count}</b> tickets remaining, read ${escapeHtml(reading.readOn)}.${incompleteMark(reading.incomplete)}</p>`)}`
}

/**
 * Tickets remaining as the tracker last read it, and when; marked incomplete when the read was part of the tickets.
 * Faintly beneath, the value the read replaced.
 */
function trackerTickets({ tracker, reading, was }: TicketsSourceView): string {
  if (!reading) return `<p class="reading"><span class="reading-line">tickets remaining · ${escapeHtml(tracker)}, not read yet</span></p>`
  return `<p class="reading"><span class="reading-value">${reading.count}</span>${incompleteMark(reading.incomplete)}
              <span class="reading-line">tickets remaining · ${escapeHtml(tracker)}, read ${escapeHtml(reading.readOn)}</span>${
                was ? `\n              <span class="reading-line was">was ${was.count} on ${escapeHtml(was.readOn)}</span>` : ''
              }</p>`
}
