import { periodName } from '../forecast/cadence.js'
import { counted } from '../forecast/counted.js'
import type { InputNote } from '../forecast/milestoneInputs.js'
import type { ForecastDate, MilestoneForecastView } from '../forecast/milestoneForecastView.js'
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
  return { context, heading: `${starting}: ${view.headlinePercent}% sure of finishing by <span class="${sure.alreadyPast ? 'risk' : 'good'}">${formatDate(sure.date)}</span>${pastMark(sure)}` }
}

function renderForecast(view: Forecast): string {
  const dates = view.dates
    .map(({ percent, date, alreadyPast }) =>
      date === null
        ? `          <li><span class="percent">${percent}%</span> sure: later than <span class="date">${formatDate(view.horizonDate)}</span></li>`
        : `          <li><span class="percent">${percent}%</span> sure by <span class="date">${formatDate(date)}</span>${pastMark({ alreadyPast })}</li>`,
    )
    .join('\n')
  return `    <section class="brief" aria-label="Forecast">
      <div class="heading"><h2>When it could finish</h2><a href="/inputs">Edit</a></div>
      <ul class="dates">
${dates}
      </ul>
      <p class="note">Pace: ${view.pace.low}–${view.pace.high} tickets per ${periodName(view.cadenceDays)} (range)</p>
      <p class="note">Ambiguity: ${view.ambiguity.level}, growing ${view.ambiguity.low}–${view.ambiguity.high}×</p>
    </section>${renderFinishGraph(view)}`
}

/**
 * When the trials finish: a bar per period, its height the share of trials finishing then, with a marker at each
 * confidence date and the headline's stressed. Each bar carries its date and shares for the hover text. Markers sit on
 * their own rows, in percent order, so their labels never overlap.
 */
function renderFinishGraph(view: Forecast): string {
  const bars = view.finishGraph
  if (bars.length === 0) return ''
  const tallest = Math.max(...bars.map(({ share }) => share))
  const columns = bars
    .map(
      ({ date, share, finishedBy }) =>
        `          <div class="bar" data-date="${date}" data-share="${share}" data-finished-by="${finishedBy}"><span class="fill" style="height: ${percentOf(share, tallest)}%"></span></div>`,
    )
    .join('\n')
  const markers = view.dates
    .flatMap(({ percent, date }, row) => {
      const at = bars.findIndex((bar) => bar.date === date)
      if (at < 0) return []
      const left = percentOf(at + 0.5, bars.length)
      const stressed = percent === view.headlinePercent ? ' headline' : ''
      const side = left > 70 ? ' end' : ''
      return [
        `          <div class="marker${stressed}${side}" style="left: ${left}%; top: ${row * 22}px"><span class="mark${stressed}">${percent}% <span class="date">${formatDate(date!)}</span></span></div>`,
      ]
    })
    .join('\n')
  return `
    <section class="brief" aria-label="Finish graph">
      <div class="heading"><h2>When the trials finish</h2></div>
      <figure class="finish-graph" aria-label="When the trials finish, by ${periodName(view.cadenceDays)}">
        <div class="plot">
${markers}
          <div class="bars">
${columns}
          </div>
        </div>
        <div class="axis"><span>${formatDate(bars[0]!.date)}</span><span>${formatDate(bars.at(-1)!.date)}</span></div>
        <figcaption class="note">Share of trials finishing each ${periodName(view.cadenceDays)}, from the start date. The ${view.headlinePercent}% date is the headline.</figcaption>
      </figure>
    </section>`
}

/** `part` as a percentage of `whole`, to 2 decimal places. */
function percentOf(part: number, whole: number): number {
  return Math.round((part / whole) * 10_000) / 100
}

/** A forecast date before today is marked, so a past start date's finish can't be read as one still to come. */
function pastMark({ alreadyPast }: Pick<ForecastDate, 'alreadyPast'>): string {
  return alreadyPast ? ' <span class="past">(already past)</span>' : ''
}

/** Notes about the inputs, each naming its input by its label on the Inputs screen, unless the note already does. */
function renderNotes(label: string, notes: readonly InputNote[]): string {
  if (notes.length === 0) return ''
  const lines = notes
    .map(({ input, message }) => {
      const named = message.startsWith(INPUT_LABELS[input]) ? '' : `<strong>${INPUT_LABELS[input]}:</strong> `
      return `\n      <p class="warning">⚠ ${named}${escapeHtml(message)}</p>`
    })
    .join('')
  return `
    <section class="brief" aria-label="${label}">${lines}
    </section>`
}
