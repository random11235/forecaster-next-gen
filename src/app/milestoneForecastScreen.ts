import type { EpicRow, ForecastSection, MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { commitText, escapeHtml, formatDate, htmlPage } from './html.js'

function statusText(epic: EpicRow): string {
  return epic.commit ? commitText(epic.commit) : 'Not committed: wide range'
}

/** The Milestone forecast screen (EM home): the milestone's forecast and epics, or its empty state when no milestone is defined. */
export function renderMilestoneForecastScreen(view: MilestoneForecastView): string {
  return htmlPage('Milestone forecast', view.kind === 'milestone' ? milestoneSection(view) : EMPTY_STATE)
}

const EMPTY_STATE = `    <section aria-label="Empty state">
      <p>No milestone defined yet.</p>
      <p>Define a milestone, with its committed date and epics, on the <a href="/inputs">Inputs screen</a> to see its forecast here.</p>
    </section>`

function milestoneSection(view: Extract<MilestoneForecastView, { kind: 'milestone' }>): string {
  const rows = view.epics
    .map(
      (epic) => `          <tr>
            <td>${escapeHtml(epic.name)}</td>
            <td class="number">${epic.itemsNow}</td>
            <td>${statusText(epic)}</td>
          </tr>`,
    )
    .join('\n')
  return `    <section aria-label="Milestone">
      <h2>${escapeHtml(view.name)} · committed ${formatDate(view.committedDate)}</h2>
${renderForecast(view.forecast)}
      <table>
        <thead>
          <tr><th>Epics in this milestone</th><th>Items now</th><th>Status</th></tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </section>`
}

function renderForecast(forecast: ForecastSection): string {
  if (forecast.kind === 'needsPace') {
    return `      <section aria-label="Forecast">
        <p>Enter your pace on the <a href="/inputs">Inputs screen</a> to see a forecast.</p>
      </section>`
  }
  if (forecast.kind === 'thinData') {
    return `      <section aria-label="Forecast">
        <p class="note">${escapeHtml(forecast.message)}</p>
      </section>`
  }
  const dates = forecast.dates
    .map(({ percent, date }) =>
      date === null
        ? `          <li>${percent}% sure: later than ${formatDate(forecast.horizonDate)}</li>`
        : `          <li>${percent}% sure by ${formatDate(date)}</li>`,
    )
    .join('\n')
  const pace =
    forecast.pace.mode === 'manual'
      ? `Pace: ${forecast.pace.low}–${forecast.pace.high} tickets per week (manual)`
      : 'Pace: measured'
  const notes = forecast.notes.map((note) => `        <p class="note">${escapeHtml(note)}</p>`).join('\n')
  return `      <section aria-label="Forecast">
        <ul class="dates">
${dates}
        </ul>
        <p>${pace}</p>
${notes}
      </section>`
}
