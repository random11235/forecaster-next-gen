import { periodName } from '../forecast/cadence.js'
import { counted } from '../forecast/counted.js'
import type { InputNote } from '../forecast/milestoneAssessment.js'
import type { FinishBar, ForecastDate, MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { escapeHtml, formatDate, htmlPage, type PageHeader } from './html.js'
import { INPUT_LABELS } from './inputsScreen.js'
import { renderPaceTrend } from './paceTrendGraph.js'

type Forecast = Extract<MilestoneForecastView, { kind: 'forecast' }>

/** The Milestone forecast screen (EM home): the milestone's forecast from its start date, what to fix, or its empty state. */
export function renderMilestoneForecastScreen(view: MilestoneForecastView): string {
  switch (view.kind) {
    case 'empty':
      return htmlPage('/', EMPTY_STATE_HEADER, '')
    case 'problems':
      return htmlPage('/', problemsHeader(view.name, view.problems.length), renderNotes('What to fix', view.problems))
    case 'forecast':
      return htmlPage('/', forecastHeader(view), `${renderNotes('Warnings', view.warnings)}${renderPaceTrend(view.paceTrend, periodName(view.cadenceDays), '    ')}${renderForecast(view)}`)
  }
}

const EMPTY_STATE_HEADER: PageHeader = {
  heading: 'No milestone defined yet.',
  lede: 'Enter the milestone, its start date, tickets remaining and pace on the <a href="/inputs">Inputs screen</a> to see its forecast here.',
}

function problemsHeader(name: string, problems: number): PageHeader {
  return {
    ...(name !== '' && { context: escapeHtml(name) }),
    heading: `Fix ${problems === 1 ? 'this' : 'these'} on the <a href="/inputs">Inputs screen</a> to see a forecast.`,
  }
}

/** The headline answers the screen's question: from the start date, the date it is 85% confident of finishing by. */
function forecastHeader(view: Forecast): PageHeader {
  const context = `${escapeHtml(view.name)} · ${counted(view.ticketsRemaining, 'ticket')} remaining`
  const starting = `Starting ${formatDate(view.startDate)}`
  const headline = view.dates.find(({ percent }) => percent === view.headlinePercent)
  if (!headline || headline.date === null) {
    return { context, heading: `${starting}: not ${view.headlinePercent}% confident of finishing by <span class="risk">${formatDate(view.horizonDate)}</span>` }
  }
  return { context, heading: `${starting}: ${view.headlinePercent}% confident of finishing by <span class="${headline.alreadyPast ? 'risk' : 'good'}">${formatDate(headline.date)}</span>${pastMark(headline)}` }
}

function renderForecast(view: Forecast): string {
  const dates = view.dates
    .map(({ percent, date, alreadyPast }) =>
      date === null
        ? `          <li><span class="percent">${percent}%</span> confident: later than <span class="date">${formatDate(view.horizonDate)}</span></li>`
        : `          <li><span class="percent">${percent}%</span> confident by <span class="date">${formatDate(date)}</span>${pastMark({ alreadyPast })}</li>`,
    )
    .join('\n')
  return `    <section class="brief" aria-label="Forecast">
      <div class="heading"><h2>When it could finish</h2><a href="/inputs">Edit</a></div>
      <ul class="dates">
${dates}
      </ul>
      <p class="note">Pace: ${paceUsed(view)}</p>
      <p class="note">Ambiguity: ${view.ambiguity.level}, growing ${view.ambiguity.low}–${view.ambiguity.high}×</p>
    </section>${renderFinishGraph(view)}`
}

/**
 * When the simulations finish: a bar per period, its height the share of simulations (trials) finishing then, with a
 * marker at each confidence date and the headline's stressed. Each bar carries its date and shares, and shows them as
 * text on hover or keyboard focus. A marker per distinct date sits on its own row, its label clear of the other markers
 * (`finishMarkers`).
 */
function renderFinishGraph(view: Forecast): string {
  const bars = view.finishGraph
  // with no trial finishing, or all on the start date (0 tickets), there is nothing to graph
  if (bars.length <= 1) return ''
  const tallest = Math.max(...bars.map(({ share }) => share))
  const columns = bars
    .map(
      (bar, at) =>
        `          <div class="bar${edge(percentOf(at + 0.5, bars.length))}" tabindex="0" data-date="${bar.date}" data-share="${bar.share}" data-finished-by="${bar.finishedBy}"><span class="fill" style="height: ${percentOf(bar.share, tallest)}%"></span><span class="tip">${barText(bar, view.cadenceDays)}</span></div>`,
    )
    .join('\n')
  const markers = finishMarkers(view)
    .map(({ percents, date, left, row, runsLeft }) => {
      const stressed = percents.includes(view.headlinePercent) ? ' headline' : ''
      const side = runsLeft ? ' end' : ''
      return `          <div class="marker${stressed}${side}" style="left: ${left}%; top: ${row * 22}px"><span class="mark${stressed}">${percents.map((percent) => `${percent}%`).join(' · ')} <span class="date">${formatDate(date)}</span></span></div>`
    })
    .join('\n')
  return `
    <section class="brief" aria-label="Finish graph">
      <div class="heading"><h2>When the simulations finish</h2></div>
      <figure class="finish-graph" aria-label="When the simulations finish, by ${periodName(view.cadenceDays)}">
        <div class="plot">
${markers}
          <div class="bars">
${columns}
          </div>
        </div>
        <div class="axis"><span>${formatDate(bars[0]!.date)}</span><span>${formatDate(bars.at(-1)!.date)}</span></div>
        <figcaption class="note">Share of simulations finishing each ${periodName(view.cadenceDays)}, from the start date. The ${view.headlinePercent}% date is the headline.</figcaption>
      </figure>
    </section>`
}

/** A marker on the finish graph: a date the forecast gives, with every percent that shares it. */
interface FinishMarker {
  percents: number[]
  date: string
  /** How far across the graph its line stands, in %. */
  left: number
  /** Its label's row above the bars, 0 at the top; its line runs from there down through the rows below. */
  row: number
  /** Whether its label runs left of its line, rather than right. */
  runsLeft: boolean
}

/**
 * A label's width as a share of the graph, in % per character, at its 12px type on the graph's widest (about 920px). An
 * estimate: the server can't measure text, so it errs wide.
 */
const LABEL_WIDTH_PER_CHAR = 0.8

/**
 * The finish graph's markers, one per distinct date, each labelled with all the percents that finish by it. A marker's
 * line runs down through the rows below its label, so each label runs away from the lines above it: labels run right
 * with the earliest date on the top row, or, when one would run off the right edge, left with the latest date on top.
 * Should neither fit every label, those that fit run right above those that run left.
 */
function finishMarkers(view: Forecast): FinishMarker[] {
  const bars = view.finishGraph
  const byDate = new Map<string, number[]>()
  for (const { percent, date } of view.dates) {
    if (date !== null && bars.some((bar) => bar.date === date)) byDate.set(date, [...(byDate.get(date) ?? []), percent])
  }
  const placed = [...byDate].map(([date, percents]) => {
    const left = percentOf(bars.findIndex((bar) => bar.date === date) + 0.5, bars.length)
    const width = (percents.map((percent) => `${percent}%`).join(' · ').length + 1 + formatDate(date).length) * LABEL_WIDTH_PER_CHAR
    return { percents, date, left, fitsRight: left + width <= 100, fitsLeft: left - width >= 0 }
  })
  const allLeft = !placed.every(({ fitsRight }) => fitsRight) && placed.every(({ fitsLeft }) => fitsLeft)
  const runsRight = placed.filter(({ fitsRight }) => fitsRight && !allLeft)
  const runsLeft = placed.filter((marker) => !runsRight.includes(marker)).reverse()
  return [...runsRight, ...runsLeft].map(({ percents, date, left }, row) => ({ percents, date, left, row, runsLeft: row >= runsRight.length }))
}

/** The pace the dates come from: "4–8 tickets per week (range)", or "typed counts, 6 sprints". */
function paceUsed({ pace, cadenceDays }: Forecast): string {
  const period = periodName(cadenceDays)
  return pace.source === 'counts' ? `typed counts, ${counted(pace.counts.length, period)}` : `${pace.low}–${pace.high} tickets per ${period} (range)`
}

/** A bar's hover text, such as "1 Dec 2026: 92% chance of completing by the end of this week, 13% of simulations are completed within." */
function barText({ date, share, finishedBy }: FinishBar, cadenceDays: number): string {
  const period = periodName(cadenceDays)
  return `${formatDate(date)}: ${Math.round(finishedBy * 100)}% chance of completing by the end of this ${period}, ${percentText(share)} of simulations are completed within.`
}

/** A share as a whole percent, or "under 1%" for a share that rounds to 0 but holds some simulations. */
function percentText(share: number): string {
  return share > 0 && share < 0.005 ? 'under 1%' : `${Math.round(share * 100)}%`
}

/** Bars near either edge of the graph, at `left`% across it, open their hover text inwards so it stays on the page. */
function edge(left: number): string {
  if (left < 30) return ' start'
  return left > 70 ? ' end' : ''
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
