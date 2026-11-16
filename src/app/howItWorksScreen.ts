import type { HowItWorksView } from '../forecast/howItWorksView.js'
import { htmlPage } from './html.js'

/**
 * The How it works screen: why a single date misleads, how the Forecaster plays the work out, and how the EM makes the
 * forecast better, each in pictures with a line under them. The pictures are inline SVG drawn from the example's forecast.
 */
export function renderHowItWorksScreen(view: HowItWorksView): string {
  const { ticketsRemaining, growth, pace } = view.example
  return htmlPage(
    '/how-it-works',
    {
      context: `Example: ${ticketsRemaining} tickets remaining, medium ambiguity, ${pace.low}–${pace.high} a week`,
      heading: 'A forecast, not an estimate',
      lede: 'Like the weather: a date, and how sure we are of it. The Forecaster plays out your milestone 10,000 times, using your team’s pace and how much the work may grow. Then it counts how often each date came true. The more real weeks you give it, the clearer the risk it shows.',
    },
    `${renderProblem(view)}
${renderHowItWorks(view, growth)}
${renderBetter()}`,
  )
}

function part(number: number, name: string, say: string, body: string): string {
  return `    <section class="explain" aria-label="${name}">
      <div class="heading"><span class="number">${number}</span><h2>${name}</h2></div>
      <p class="say">${say}</p>
${body}
    </section>`
}

function renderProblem(view: HowItWorksView): string {
  return part(
    1,
    'The problem',
    'A date from the average pace is a coin flip at best.',
    `      <div class="problem">
        <figure>
          ${burndown(view)}
          <figcaption>A <b>burndown</b> spends the average pace on the tickets we start with, or guess at. The bars show the share of simulations finishing each week, once the work may grow.</figcaption>
        </figure>
        <ul class="points">
          <li><span class="mark">~50%</span><span>Even if nothing grows, hitting the average-pace date is a coin toss.</span></li>
          <li><span class="mark">+?</span><span>Work grows once it starts. Tickets split; new ones appear.</span></li>
          <li><span class="mark good">↻</span><span>Estimating is expensive and leans on one view. A tool’s results can be challenged and replayed, time and time again.</span></li>
          <li><span class="mark good">→</span><span>A forecast shows the whole spread of dates, not one. One person’s estimate is hard to question.</span></li>
        </ul>
      </div>`,
  )
}

function renderHowItWorks(view: HowItWorksView, growth: HowItWorksView['example']['growth']): string {
  const step = (label: string, picture: string, caption: string): string => `        <figure>
          <span class="step">${label}</span>
          ${picture}
          <figcaption>${caption}</figcaption>
        </figure>`
  return part(
    2,
    'How it works',
    'One simulation: grow the work, then spend a pace each week until it’s done. Repeat 10,000 times.',
    `      <div class="pictures four">
${step('1 · Grow the work', grow(view), `Draw a growth from your <b>ambiguity</b> range (medium: ${growth.low}–${growth.high}×).`)}
${step('2 · Spend a pace each week', spend(), 'Draw each week’s pace from your <b>range or typed counts</b> until no tickets are left.')}
${step('3 · Repeat', repeat(view), 'Every simulation draws again, so each <b>finishes in a different week</b>.')}
${step('4 · Read the dates', read(view), 'Count the finishes. The <b>85% date</b> is the week by which 85 in 100 simulations were done.')}
      </div>`,
  )
}

function renderBetter(): string {
  const tip = (picture: string, heading: string, line: string): string => `        <div class="tip">
          ${picture}
          <div><h3>${heading}</h3><p>${line}</p></div>
        </div>`
  return part(
    3,
    'Making it better',
    'The forecast is only as good as the quality of your inputs. Four habits narrow the spread and keep it true.',
    `      <div class="pictures two">
${tip(typedCounts(), 'Type real counts, 8 weeks or more', 'Counts are the team’s record; a range is a guess. With fewer than 8 the forecast warns.')}
${tip(ticketSizes(), 'Keep tickets a similar size', 'Split big tickets before counting. A steadier pace gives a narrower spread.')}
${tip(ambiguities(), 'Pick ambiguity honestly', 'Not yet broken down? Choose high. Low is for work the team has done before.')}
${tip(reforecast(), 'Re-forecast every week', 'Update tickets remaining and add the week’s count. The spread narrows as the work gets done.')}
      </div>`,
  )
}

// The pictures. Each is an SVG drawn to its own scale; colours come from the page's tokens through classes.

function svg(width: number, height: number, label: string, shapes: string[]): string {
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">${shapes.join('')}</svg>`
}

function rect(x: number, y: number, width: number, height: number, kind = 'bar', radius = 2): string {
  return `<rect class="${kind}" x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${radius}"/>`
}

function line(x1: number, y1: number, x2: number, y2: number, kind: string): string {
  return `<line class="${kind}" x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}"/>`
}

function label(x: number, y: number, text: string | number, kind = '', anchor = 'start'): string {
  return `<text${kind ? ` class="${kind}"` : ''} x="${round(x)}" y="${round(y)}" text-anchor="${anchor}">${text}</text>`
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** The weeks a simulation can finish in: from the first to the last with any share. */
function finishSpan({ finishes }: HowItWorksView): { first: number; last: number } {
  const finishing = finishes.filter(({ share }) => share > 0).map(({ period }) => period)
  return { first: Math.min(...finishing), last: Math.max(...finishing) }
}

/** The average pace's straight line from the tickets remaining to 0, over the share of simulations finishing each week. */
function burndown(view: HowItWorksView): string {
  const { ticketsRemaining } = view.example
  const { perPeriod, period, met } = view.averagePace
  const { first, last } = finishSpan(view)
  const left = 36,
    right = 404,
    top = 14,
    bottom = 190,
    lastWeek = Math.max(12, last + 1)
  const x = (week: number): number => left + (week / lastWeek) * (right - left)
  const y = (tickets: number): number => bottom - (tickets / ticketsRemaining) * (bottom - top)
  const tallest = Math.max(...view.finishes.map(({ share }) => share))
  const shapes: string[] = []
  for (let tickets = 0; tickets <= ticketsRemaining; tickets += 10) {
    shapes.push(line(left, y(tickets), right, y(tickets), 'grid'), label(left - 6, y(tickets) + 4, tickets, '', 'end'))
  }
  for (const { period: week, share } of view.finishes) {
    const height = (share / tallest) * (bottom - top) * 0.55
    if (share > 0) shapes.push(rect(x(week) - 9, bottom - height, 18, height))
  }
  shapes.push(
    line(x(0), y(ticketsRemaining), x(ticketsRemaining / perPeriod), y(0), 'burn'),
    line(left, bottom, right, bottom, 'axis'),
    label(x(1.5), y(ticketsRemaining) + 4, 'tickets left'),
    label(x(ticketsRemaining / perPeriod) + 6, y(ticketsRemaining) + 26, `average pace (${perPeriod}/wk): week ${period}`, 'risk'),
    label(x(ticketsRemaining / perPeriod) + 6, y(ticketsRemaining) + 42, `met in ${Math.round(met * 100)}% of simulations`, 'risk'),
    label(right, bottom - (bottom - top) * 0.55 - 10, `simulated finishes: weeks ${first}–${last}`, 'strong', 'end'),
  )
  for (let week = 0; week <= lastWeek; week += 2) shapes.push(label(x(week), bottom + 16, week, '', 'middle'))
  return svg(
    420,
    210,
    `A straight burndown at the average pace reaches 0 in week ${period}; simulated finishes fall between weeks ${first} and ${last}.`,
    shapes,
  )
}

/** The tickets remaining, and the same grown by a growth from the range. */
function grow({ example }: HowItWorksView): string {
  const grown = Math.round(example.ticketsRemaining * 1.4)
  const unit = 180 / (example.ticketsRemaining * example.growth.high)
  return svg(200, 120, `${example.ticketsRemaining} tickets grow by 1.4 times to ${grown}.`, [
    label(0, 14, 'today'),
    rect(0, 22, example.ticketsRemaining * unit, 22),
    label(example.ticketsRemaining * unit + 6, 38, example.ticketsRemaining, 'strong'),
    label(0, 70, 'grown ×1.4'),
    rect(0, 78, example.ticketsRemaining * unit, 22),
    rect(example.ticketsRemaining * unit, 78, (grown - example.ticketsRemaining) * unit, 22, 'bar light'),
    label(grown * unit + 6, 94, grown, 'strong'),
  ])
}

/** One simulation's weeks spending its paces on 42 tickets. */
function spend(): string {
  const paces = [6, 4, 7, 5, 8, 6, 7],
    tickets = 42,
    unit = 180 / 45
  const shapes = [label(0, 20, `${tickets} tickets`)]
  let spent = 0
  paces.forEach((pace, week) => {
    const used = Math.min(pace, tickets - spent)
    const middle = (spent + used / 2) * unit
    shapes.push(
      rect(spent * unit, 30, used * unit - 1.5, 30, week % 2 ? 'bar light' : 'bar', 0),
      label(middle, 50, pace, 'ink', 'middle'),
      label(middle, 76, `w${week + 1}`, '', 'middle'),
    )
    spent += used
  })
  shapes.push(label(0, 104, `done in week ${paces.length}`, 'strong'))
  return svg(200, 120, `Weekly paces of ${paces.join(', ')} use up ${tickets} tickets in week ${paces.length}.`, shapes)
}

/** Six simulations as dots on a line of weeks. */
function repeat(view: HowItWorksView): string {
  const { first, last } = finishSpan(view)
  const left = 8,
    right = 192
  const x = (week: number): number => left + ((week - first) / Math.max(last - first, 1)) * (right - left)
  const shapes = view.someFinishes.flatMap((week, at) => [
    line(left, 12 + at * 15, x(week), 12 + at * 15, 'grid'),
    `<circle class="dot" cx="${round(x(week))}" cy="${12 + at * 15}" r="4"/>`,
  ])
  shapes.push(line(left, 102, right, 102, 'axis'), label(left, 116, `wk ${first}`), label(right, 116, `wk ${last}`, '', 'end'))
  return svg(200, 120, `Six simulations finish in weeks ${view.someFinishes.join(', ')}.`, shapes)
}

/** The share of simulations finishing each week, with the 50% and 85% weeks marked. */
function read(view: HowItWorksView): string {
  const { first, last } = finishSpan(view)
  const left = 4,
    right = 196,
    top = 30,
    bottom = 102,
    width = (right - left) / (last - first + 1)
  const x = (week: number): number => left + (week - first) * width
  const tallest = Math.max(...view.finishes.map(({ share }) => share))
  const shapes = view.finishes
    .filter(({ share }) => share > 0)
    .map(({ period: week, share }) => rect(x(week) + 1, bottom - (share / tallest) * (bottom - top), width - 2, (share / tallest) * (bottom - top), 'bar', 1.5))
  view.weeks.forEach(({ percent, period: week }, at) => {
    const headline = at === view.weeks.length - 1
    const marker = x(week) + width - 1
    shapes.push(
      line(marker, 8, marker, bottom, headline ? 'marker headline' : 'marker'),
      label(marker + (headline ? 4 : -4), 12, `${percent}% wk ${week}`, headline ? 'strong' : '', headline ? 'start' : 'end'),
    )
  })
  shapes.push(line(left, bottom, right, bottom, 'axis'), label(left, 116, `wk ${first}`), label(right, 116, `wk ${last}`, '', 'end'))
  const [half, sure] = view.weeks
  return svg(200, 120, `Finishes by week, with 50% done by week ${half!.period} and 85% by week ${sure!.period}.`, shapes)
}

function typedCounts(): string {
  const counts = [6, 5, 7, 4, 6, 8, 5, 6]
  return svg(140, 60, 'Eight weeks of typed counts.', [
    ...counts.map((count, week) => rect(week * 17, 44 - count * 5, 14, count * 5, 'bar', 1.5)),
    line(0, 44, 134, 44, 'axis'),
    label(0, 58, '8 weeks'),
  ])
}

function ticketSizes(): string {
  const wide = [2, 4, 7, 9, 8, 6, 4, 3, 2, 1],
    narrow = [1, 6, 12, 6, 1]
  return svg(140, 60, 'A wide spread of finishes above a narrow one.', [
    ...wide.map((share, at) => rect(10 + at * 12, 26 - share * 2.2, 10, share * 2.2, 'bar light', 1)),
    ...narrow.map((share, at) => rect(40 + at * 12, 58 - share * 2.2, 10, share * 2.2, 'bar', 1)),
  ])
}

function ambiguities(): string {
  const x = (growth: number): number => 30 + ((growth - 1) / 2) * 104
  const levels: [string, number, number][] = [
    ['low', 1, 1.5],
    ['med', 1, 2],
    ['high', 1.5, 3],
  ]
  return svg(140, 60, 'Growth ranges: low 1 to 1.5 times, medium 1 to 2 times, high 1.5 to 3 times.', [
    ...levels.flatMap(([level, low, high], at) => [
      label(0, 12 + at * 17, level),
      rect(x(low), 4 + at * 17, x(high) - x(low), 10, at === 2 ? 'bar dark' : 'bar'),
    ]),
    label(x(1), 58, '1×'),
    label(x(3), 58, '3×', '', 'end'),
  ])
}

function reforecast(): string {
  const spreads: [number, number][] = [
    [0, 120],
    [20, 100],
    [40, 82],
    [56, 70],
  ]
  return svg(
    140,
    60,
    'The spread of finishes narrows with each re-forecast.',
    spreads.map(([from, to], at) => rect(from + 10, 4 + at * 13, to - from, 8, at === spreads.length - 1 ? 'bar' : 'bar light', 4)),
  )
}
