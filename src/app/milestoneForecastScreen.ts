import type {
  CapacityEdit,
  ComparedDate,
  FinishBar,
  ForecastDate,
  InputNote,
  MilestoneForecastView,
  PaceActionEdit,
  PacePatternView,
  PatternAction,
  PeriodName,
} from '../forecast/index.js'
import { dayMonth, escapeHtml, formatDate, htmlPage, type PageHeader } from './html.js'
import { INPUT_LABELS } from './inputsScreen.js'
import { renderPaceTrend } from './paceTrendGraph.js'
import { capacitySentence, renderCapacity } from './lib/capacitySection.js'

export { CAPACITY_OPEN, CAPACITY_OPEN_PATH } from './lib/capacitySection.js'

type Forecast = Extract<MilestoneForecastView, { kind: 'forecast' }>

/** Reads a submitted form's fields, by the field names this screen gives them; the rules they must meet are checked when it is saved. */
type FormReader = (body: URLSearchParams) => CapacityEdit | PaceActionEdit

/** Each form this screen posts, by its action's path, and how its fields are read. */
export const FORECAST_FORMS: ReadonlyMap<string, FormReader> = new Map<string, FormReader>([
  ['/capacity/add', (body) => ({ kind: 'addCapacity', ...capacitySentence(body) })],
  ['/capacity/edit', (body) => ({ kind: 'editCapacity', id: body.get('id') ?? '', ...capacitySentence(body) })],
  ['/capacity/remove', (body) => ({ kind: 'removeCapacity', id: body.get('id') ?? '' })],
  ['/capacity/switch', (body) => ({ kind: 'switchCapacity', on: body.get('on') === 'true' })],
  ['/capacity/new-usual', (body) => ({ kind: 'acceptNewUsual', id: body.get('id') ?? '' })],
  ['/capacity/keep', (body) => ({ kind: 'keepCapacity', id: body.get('id') ?? '' })],
  ['/capacity/end-today', (body) => ({ kind: 'endCapacityToday', id: body.get('id') ?? '' })],
  [
    '/pace-action/apply',
    (body) => ({ kind: 'applyPaceAction', action: body.get('action') ?? '', date: body.get('date') ?? '', period: body.get('period') ?? '' }),
  ],
  ['/pace-action/undo', () => ({ kind: 'undoPaceAction' })],
])

/**
 * The screen's script: opening or folding the Capacity section goes to the screen with it so, as each entry's effect
 * is worked out only with it open. It follows a link, so the web build's page answers it as it does any other.
 * Without it, the section still opens, with no effects shown.
 */
const FORECAST_SCRIPT = `
(() => {
  const capacity = document.getElementById('capacity')
  if (!capacity) return
  const shownOpen = capacity.open
  capacity.addEventListener('toggle', () => {
    if (capacity.open === shownOpen) return
    const link = document.createElement('a')
    link.href = capacity.dataset.toggle
    link.hidden = true
    document.body.append(link)
    link.click()
  })
})()
`

/** The Milestone forecast screen (EM home): the milestone's forecast from its start date, what to fix, or its empty state. */
export function renderMilestoneForecastScreen(view: MilestoneForecastView): string {
  switch (view.kind) {
    case 'empty':
      return htmlPage('/', EMPTY_STATE_HEADER, '')
    case 'problems':
      return htmlPage(
        '/',
        problemsHeader(view.name, view.problems.length),
        `${renderNotes('What to fix', view.problems)}${renderPaceApplied(view.paceApplied, '    ')}${renderRefusal(view.paceActionRefusal, '    ')}`,
      )
    case 'forecast':
      return htmlPage(
        '/',
        forecastHeader(view),
        `${renderNotes('Warnings', view.warnings)}
    <div class="forecast-layout">
      <div class="forecast-main">${renderForecast(view)}
      </div>${renderPaceSide(view)}
    </div>`,
        FORECAST_SCRIPT,
      )
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

/**
 * The headline answers the screen's question: from the start date, the date it is 85% confident of finishing by. A
 * quiet line under it says whether that date includes capacity, and what capacity does to it.
 */
function forecastHeader(view: Forecast): PageHeader {
  const quiet = view.capacityLine === undefined ? {} : { lede: `<span class="quiet">${escapeHtml(view.capacityLine)}</span>` }
  return { ...headline(view), ...quiet }
}

function headline(view: Forecast): PageHeader {
  const context = `${escapeHtml(view.name)} · ${view.ticketsRemainingSaid} remaining`
  const starting = `Starting ${formatDate(view.startDate)}`
  const headline = view.dates.find(({ percent }) => percent === view.headlinePercent)
  if (!headline || headline.date === null) {
    return { context, heading: `${starting}: not ${view.headlinePercent}% confident of finishing by <span class="risk">${formatDate(view.horizonDate)}</span>` }
  }
  return {
    context,
    heading: `${starting}: ${view.headlinePercent}% confident of finishing by <span class="${headline.alreadyPast ? 'risk' : 'good'}">${formatDate(headline.date)}</span>${pastMark(headline)}`,
  }
}

function renderForecast(view: Forecast): string {
  const dates = view.comparison ? renderComparison(view, view.comparison) : renderDates(view)
  return `    <section class="brief" aria-label="Forecast">
      <div class="heading"><h2>When it could finish</h2><a href="/inputs">Edit</a></div>
${dates}
      <p class="note">Ambiguity: ${view.ambiguity.level}, growing ${view.ambiguity.low}–${view.ambiguity.high}×</p>
    </section>${renderFinishGraph(view)}`
}

function renderDates(view: Forecast): string {
  const dates = view.dates
    .map(({ percent, date, alreadyPast }) =>
      date === null
        ? `          <li><span class="percent">${percent}%</span> confident: later than <span class="date">${formatDate(view.horizonDate)}</span></li>`
        : `          <li><span class="percent">${percent}%</span> confident by <span class="date">${formatDate(date)}</span>${pastMark({ alreadyPast })}</li>`,
    )
    .join('\n')
  return `      <ul class="dates">
${dates}
      </ul>`
}

/** With capacity in use: each date with capacity, at usual capacity, and how far capacity moves it. */
function renderComparison(view: Forecast, comparison: readonly ComparedDate[]): string {
  const date = (date: string | null): string => (date === null ? `later than ${formatDate(view.horizonDate)}` : formatDate(date))
  const rows = comparison
    .map(({ percent, withCapacity, atUsual, shift, shifted }) => {
      const moved = shift === null ? '' : `<span class="${shift > 0 ? 'later' : shift < 0 ? 'sooner' : ''}">${shifted}</span>`
      return `          <tr><td><span class="percent">${percent}%</span> confident by</td><td class="date">${date(withCapacity)}</td><td>${date(atUsual)}</td><td>${moved}</td></tr>`
    })
    .join('\n')
  return `      <table class="compared">
        <thead><tr><th></th><th>With capacity</th><th>At usual capacity</th><th></th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`
}

/**
 * When the simulations finish: a bar per period, its height the share of simulations (trials) finishing then, with a
 * marker at each confidence date and the headline's stressed. Each bar carries its date and shares, and shows them as
 * text on hover or keyboard focus. A marker per distinct date sits on its own row, its label clear of the other markers
 * (`finishMarkers`). A period whose capacity isn't usual is shaded and labelled with its percentage.
 */
function renderFinishGraph(view: Forecast): string {
  const bars = view.finishGraph
  // with no trial finishing, or all on the start date (0 tickets), there is nothing to graph
  if (bars.length <= 1) return ''
  const tallest = Math.max(...bars.map(({ share }) => share))
  const columns = bars
    .map(
      (bar, at) =>
        `          <div class="bar${edge(percentOf(at + 0.5, bars.length))}${changed(bar) ? ' changed' : ''}" tabindex="0" data-date="${bar.date}" data-share="${bar.share}" data-finished-by="${bar.finishedBy}">${capacityLabel(bar)}<span class="fill" style="height: ${percentOf(bar.share, tallest)}%"></span><span class="tip">${barText(bar, view.period)}</span></div>`,
    )
    .join('\n')
  const shaded = bars.some(changed) ? ` Shaded ${view.period}s: capacity changes, at the % shown.` : ''
  const markers = finishMarkers(view)
    .map(({ percents, date, left, row, runsLeft }) => {
      const stressed = percents.includes(view.headlinePercent) ? ' headline' : ''
      const side = runsLeft ? ' end' : ''
      return `          <div class="marker${stressed}${side}" style="left: ${left}%; top: ${row * 22}px"><span class="mark${stressed}">${percents.map((percent) => `${percent}%`).join(' · ')} <span class="date">${formatDate(date)}</span></span></div>`
    })
    .join('\n')
  return `
    <section class="brief" aria-label="Finish graph">
      <div class="heading"><h2>${byPeriod(view.period)}</h2></div>
      <figure class="finish-graph" aria-label="When the simulations finish, by ${view.period}">
        <div class="plot">
${markers}
          <div class="bars">
${columns}
          </div>
        </div>
        <div class="axis"><span>${formatDate(bars[0]!.date)}</span><span>${formatDate(bars[bars.length - 1]!.date)}</span></div>
        <figcaption class="note">Share of simulations finishing each ${view.period}, from the start date. The ${view.headlinePercent}% date is the headline.${shaded}</figcaption>
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
 * A label's width as a share of the graph, in % per character, at its 12px type on the graph's widest (about 570px,
 * beside the pace). An estimate: the server can't measure text, so it errs wide.
 */
const LABEL_WIDTH_PER_CHAR = 1.3

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

/** Beside the forecast: the pace it comes from, and the team's capacity, which scales that pace each period. */
function renderPaceSide(view: Forecast): string {
  const { period } = view
  return `
      <aside class="side" aria-label="Pace">
        <div class="heading"><h2>Pace</h2><a href="/inputs#pace">Change</a></div>
        <p class="note">${escapeHtml(view.paceSaid)}</p>${renderPaceTrend(view.paceTrend, period, '        ')}${renderPacePattern(view.pacePattern, view.paceActionRefusal, view.horizonDate)}${renderCapacity(view.capacity, period)}
      </aside>`
}

/**
 * The pace pattern, under the pace bars: one folded line, opened to say what it means and what to do and, with an
 * action, the 85% date with and without it and its button. With no pattern to name, the line alone, faint. An applied
 * action is said with Undo; a refused form opens it, saying why.
 */
function renderPacePattern(view: PacePatternView | undefined, refusal: string | undefined, horizonDate: string): string {
  if (!view) return renderRefusal(refusal, '        ')
  const applied = renderPaceApplied(view.applied, '        ')
  if (view.pattern === undefined) return `\n        <p class="pace-pattern quiet">${escapeHtml(view.line)}</p>${applied}${renderRefusal(refusal, '        ')}`
  const advice = view.advice ? ` ${escapeHtml(view.advice)}` : ''
  const action = view.action ? renderPatternAction(view.action, horizonDate) : ''
  return `
        <details class="pace-pattern"${refusal ? ' open' : ''}><summary>${escapeHtml(view.line)}</summary>
          <p class="note">${escapeHtml(view.meaning ?? '')}${advice}</p>${action}${renderRefusal(refusal, '          ')}
        </details>${applied}`
}

/** The pace action applied, said, with Undo; nothing with none applied. */
function renderPaceApplied(applied: string | undefined, indent: string): string {
  if (!applied) return ''
  return `\n${indent}<form class="pace-applied" method="post" action="/pace-action/undo"><p class="note">${escapeHtml(applied)} <button class="link">Undo</button></p></form>`
}

/** Why the pace action just submitted was refused; nothing when it wasn't. */
function renderRefusal(refusal: string | undefined, indent: string): string {
  return refusal ? `\n${indent}<p class="error" role="alert">${escapeHtml(refusal)}</p>` : ''
}

/** The pattern's action: the 85% date now and with it, from the same seed, and the button applying it. */
function renderPatternAction(action: PatternAction, horizonDate: string): string {
  const { kind, button, dates } = action
  const dated = (day: string | null): string => (day === null ? `later than ${formatDate(horizonDate)}` : formatDate(day))
  const [by, field, on] =
    action.kind === 'startFrom' ? [`from ${dayMonth(action.date)}`, 'date', action.date] : [`leaving out ${dayMonth(action.period)}`, 'period', action.period]
  return `
          <p class="note">${dates.percent}% confident by <span class="date">${dated(dates.now)}</span> now, <span class="date">${dated(dates.applied)}</span> ${by}.</p>
          <form method="post" action="/pace-action/apply"><input type="hidden" name="action" value="${kind}"><input type="hidden" name="${field}" value="${on}"><button>${escapeHtml(button)}</button></form>`
}

/**
 * A bar's hover text, such as "1 Dec 2026: 92% chance of completing by the end of this week, 13% of simulations are
 * completed within.", followed by " At 80% capacity." when its capacity isn't usual.
 */
function barText(bar: FinishBar, period: PeriodName): string {
  const { date, share, finishedBy } = bar
  const capacity = changed(bar) ? ` At ${Math.round(bar.capacity)}% capacity.` : ''
  return `${formatDate(date)}: ${Math.round(finishedBy * 100)}% chance of completing by the end of this ${period}, ${percentText(share)} of simulations are completed within.${capacity}`
}

/** The finish graph's heading: "Week by week", or "Sprint by sprint". */
function byPeriod(period: PeriodName): string {
  return `${period[0]!.toUpperCase()}${period.slice(1)} by ${period}`
}

/** Whether capacity changes this bar's period from the team's usual. */
function changed({ capacity }: FinishBar): boolean {
  return capacity !== 100
}

/** A changed period's capacity, labelled above its bar. */
function capacityLabel(bar: FinishBar): string {
  return changed(bar) ? `<span class="capacity">${Math.round(bar.capacity)}%</span>` : ''
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
