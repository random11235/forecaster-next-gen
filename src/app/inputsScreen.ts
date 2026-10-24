import type { ThroughputRange } from '../model/paceSetting.js'
import { escapeHtml, htmlPage } from './html.js'

/** Far above any real team's weekly pace; keeps typos like 1000000 out of the forecast. */
const MAX_TICKETS_PER_WEEK = 1000

/** The pace form as typed: what the EM entered, and why it was refused, if it was. */
export interface PaceForm {
  low: string
  high: string
  error?: string
}

export type ParsedPace = { ok: true; range: ThroughputRange } | { ok: false; form: PaceForm }

/** Reads the submitted pace form: whole tickets per week, low ≤ high. */
export function parsePaceForm(body: URLSearchParams): ParsedPace {
  const low = body.get('low')?.trim() ?? ''
  const high = body.get('high')?.trim() ?? ''
  const refuse = (error: string): ParsedPace => ({ ok: false, form: { low, high, error } })
  if (!/^\d+$/.test(low) || !/^\d+$/.test(high)) return refuse('Enter whole numbers of tickets, 0 or more.')
  const [lowCount, highCount] = [Number(low), Number(high)]
  if (highCount > MAX_TICKETS_PER_WEEK) return refuse(`Enter at most ${MAX_TICKETS_PER_WEEK} tickets per week.`)
  if (lowCount > highCount) return refuse('The low end must not be above the high end.')
  return { ok: true, range: { low: lowCount, high: highCount } }
}

/** The Inputs screen: the milestone's manual pace range. `form` is undefined when there is no milestone yet. */
export function renderInputsScreen(form: PaceForm | undefined): string {
  return htmlPage('Inputs', form ? paceSection(form) : NO_MILESTONE)
}

const NO_MILESTONE = `    <section aria-label="Pace">
      <p>No milestone defined yet. Define a milestone to enter its pace.</p>
    </section>`

function paceSection(form: PaceForm): string {
  const error = form.error ? `\n        <p class="error" role="alert">${escapeHtml(form.error)}</p>` : ''
  return `    <section aria-label="Pace">
      <h2>Pace</h2>
      <p>How many of this milestone's tickets the team finishes in a week, as a range from a slow week to a good one.</p>
      <form method="post" action="/inputs">${error}
        <label>Low <input type="number" name="low" min="0" max="${MAX_TICKETS_PER_WEEK}" step="1" value="${escapeHtml(form.low)}" required></label>
        <label>High <input type="number" name="high" min="0" max="${MAX_TICKETS_PER_WEEK}" step="1" value="${escapeHtml(form.high)}" required></label>
        <span>tickets per week</span>
        <p><button type="submit">Save and forecast</button></p>
      </form>
    </section>`
}
