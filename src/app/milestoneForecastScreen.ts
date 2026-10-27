import type { EpicRow, ForecastSection, MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { escapeHtml, formatDate, htmlPage, type PageHeader } from './html.js'

const STATUS_TEXT: Record<EpicRow['status'], string> = { notCommitted: 'Not committed: wide range' }

/** The confidence the headline plans for. */
const HEADLINE_PERCENT = 85

const DAY_MS = 86_400_000

/** The Milestone forecast screen (EM home): the milestone's forecast and epics, or its empty state when no milestone is defined. */
export function renderMilestoneForecastScreen(view: MilestoneForecastView): string {
  if (view.kind !== 'milestone') return htmlPage('Milestone forecast', '/', EMPTY_STATE_HEADER, '')
  return htmlPage('Milestone forecast', '/', forecastHeader(view), milestoneSections(view))
}

const EMPTY_STATE_HEADER: PageHeader = {
  heading: 'No milestone defined yet.',
  lede: 'Define a milestone, with its committed date and epics, on the <a href="/inputs">Inputs screen</a> to see its forecast here.',
}

/** The headline answers the screen's question: when the milestone will be 85% sure to finish, against the committed date. */
function forecastHeader(view: Extract<MilestoneForecastView, { kind: 'milestone' }>): PageHeader {
  const context = `${view.name} · committed ${formatDate(view.committedDate)}`
  const { forecast } = view
  if (forecast.kind === 'needsPace') {
    return { context, heading: 'Enter your pace on the <a href="/inputs">Inputs screen</a> to see a forecast.' }
  }
  if (forecast.kind === 'thinData') {
    return { context, heading: 'No forecast yet.', lede: escapeHtml(forecast.message) }
  }
  const sure = forecast.dates.find(({ percent }) => percent === HEADLINE_PERCENT)
  if (!sure) return { context, heading: 'Forecast' }
  if (sure.date === null) {
    return { context, heading: `Not ${HEADLINE_PERCENT}% sure of finishing by <span class="risk">${formatDate(forecast.horizonDate)}.</span>` }
  }
  const daysLate = daysBetween(view.committedDate, sure.date)
  if (daysLate > 0) {
    return {
      context,
      heading: `Plan for <span class="risk">${formatDate(sure.date)}</span> to be ${HEADLINE_PERCENT}% sure: <span class="risk">${days(daysLate)}</span> after the committed date.`,
    }
  }
  const early = daysLate === 0 ? 'on the committed date' : `${days(-daysLate)} before the committed date`
  return { context, heading: `${HEADLINE_PERCENT}% sure of finishing by <span class="good">${formatDate(sure.date)}:</span> ${early}.` }
}

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  return Math.round((Date.parse(toIsoDate) - Date.parse(fromIsoDate)) / DAY_MS)
}

function days(count: number): string {
  return count === 1 ? '1 day' : `${count} days`
}

function milestoneSections(view: Extract<MilestoneForecastView, { kind: 'milestone' }>): string {
  const rows = view.epics
    .map(
      (epic) => `          <tr>
            <td>${escapeHtml(epic.name)}</td>
            <td class="number">${epic.itemsNow}</td>
            <td class="status">${STATUS_TEXT[epic.status]}</td>
          </tr>`,
    )
    .join('\n')
  return `${renderForecast(view.forecast)}
    <section class="brief" aria-label="Epics">
      <div class="heading"><h2>Epics by rank</h2><a href="/inputs">Edit</a></div>
      <table class="epics">
        <thead>
          <tr><th>Epics in this milestone</th><th class="number">Items now</th><th>Status</th></tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </section>`
}

function renderForecast(forecast: ForecastSection): string {
  if (forecast.kind !== 'forecast') return ''
  const dates = forecast.dates
    .map(({ percent, date }) =>
      date === null
        ? `          <li><span class="percent">${percent}%</span> sure: later than <span class="date">${formatDate(forecast.horizonDate)}</span></li>`
        : `          <li><span class="percent">${percent}%</span> sure by <span class="date">${formatDate(date)}</span></li>`,
    )
    .join('\n')
  const pace =
    forecast.pace.mode === 'manual'
      ? `Pace: ${forecast.pace.low}–${forecast.pace.high} tickets per week (manual)`
      : 'Pace: measured'
  const notes = forecast.notes.map((note) => `\n      <p class="note">${escapeHtml(note)}</p>`).join('')
  return `    <section class="brief" aria-label="Forecast">
      <div class="heading"><h2>When it could finish</h2></div>
      <ul class="dates">
${dates}
      </ul>
      <p class="note">${pace}</p>${notes}
    </section>`
}
