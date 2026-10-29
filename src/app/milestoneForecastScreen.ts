import { periodName } from '../forecast/cadence.js'
import { counted } from '../forecast/counted.js'
import type { InputNote } from '../forecast/milestoneInputs.js'
import type { MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { escapeHtml, formatDate, htmlPage, type PageHeader } from './html.js'
import { INPUT_LABELS } from './inputsScreen.js'

type Forecast = Extract<MilestoneForecastView, { kind: 'forecast' }>

/** The Milestone forecast screen (EM home): the milestone's forecast from its start date, what to fix, or its empty state. */
export function renderMilestoneForecastScreen(view: MilestoneForecastView): string {
  switch (view.kind) {
    case 'empty':
      return htmlPage('Milestone forecast', '/', EMPTY_STATE_HEADER, '')
    case 'problems':
      return htmlPage('Milestone forecast', '/', problemsHeader(view.name), renderNotes('What to fix', view.problems))
    case 'forecast':
      return htmlPage('Milestone forecast', '/', forecastHeader(view), `${renderForecast(view)}${renderNotes('Warnings', view.warnings)}`)
  }
}

const EMPTY_STATE_HEADER: PageHeader = {
  heading: 'No milestone defined yet.',
  lede: 'Enter the milestone, its start date, tickets remaining and pace on the <a href="/inputs">Inputs screen</a> to see its forecast here.',
}

function problemsHeader(name: string): PageHeader {
  return {
    ...(name !== '' && { context: escapeHtml(name) }),
    heading: 'Fix these on the <a href="/inputs">Inputs screen</a> to see a forecast.',
  }
}

/** The headline answers the screen's question: from the start date, when the milestone is 85% sure to finish. */
function forecastHeader(view: Forecast): PageHeader {
  const context = `${escapeHtml(view.name)} · ${counted(view.ticketsRemaining, 'ticket')} remaining`
  const starting = `Starting ${formatDate(view.startDate)}`
  const sure = view.dates.find(({ percent }) => percent === view.headlinePercent)
  if (!sure || sure.date === null) {
    return { context, heading: `${starting}: not ${view.headlinePercent}% sure of finishing by <span class="risk">${formatDate(view.horizonDate)}</span>` }
  }
  return { context, heading: `${starting}: ${view.headlinePercent}% sure of finishing by <span class="good">${formatDate(sure.date)}</span>` }
}

function renderForecast(view: Forecast): string {
  const dates = view.dates
    .map(({ percent, date }) =>
      date === null
        ? `          <li><span class="percent">${percent}%</span> sure: later than <span class="date">${formatDate(view.horizonDate)}</span></li>`
        : `          <li><span class="percent">${percent}%</span> sure by <span class="date">${formatDate(date)}</span></li>`,
    )
    .join('\n')
  return `    <section class="brief" aria-label="Forecast">
      <div class="heading"><h2>When it could finish</h2><a href="/inputs">Edit</a></div>
      <ul class="dates">
${dates}
      </ul>
      <p class="note">Pace: ${view.pace.low}–${view.pace.high} tickets per ${periodName(view.cadenceDays)} (range)</p>
      <p class="note">Ambiguity: ${view.ambiguity.level}, growing ${view.ambiguity.low}–${view.ambiguity.high}×</p>
    </section>`
}

/** Notes about the inputs, each naming its input by its label on the Inputs screen. */
function renderNotes(label: string, notes: readonly InputNote[]): string {
  if (notes.length === 0) return ''
  const lines = notes
    .map(({ input, message }) => `\n      <p class="warning">⚠ <strong>${INPUT_LABELS[input]}:</strong> ${escapeHtml(message)}</p>`)
    .join('')
  return `
    <section class="brief" aria-label="${label}">${lines}
    </section>`
}
