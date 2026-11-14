import type { PairedPace, PaceTrend } from '../forecast/paceTrend.js'
import type { PeriodName } from '../forecast/cadence.js'

/** The graph's drawing size in SVG units: it stretches to its box's width and is drawn this many pixels high. */
const WIDTH = 240
const HEIGHT = 64

/** A period before the milestone started: a short hatched stub in place of the milestone's own bar, in SVG units. */
const BEFORE_START_HEIGHT = 6

/**
 * The pace trend: the counts in use as small bars, oldest first, and the straight line fitted through them, from the
 * middle of the first period to the middle of the last. Following the tracker with comparable work, each period pairs
 * comparable work's bar with the milestone's own, hatched before it started, and the series pace comes from is
 * marked. Information only: it says the line's two ends, not what they mean.
 */
export function renderPaceTrend(trend: PaceTrend | undefined, period: PeriodName, indent: string): string {
  if (!trend) return ''
  const { counts, start, end, paired } = trend
  const shown = paired ? [...paired.comparableWork, ...paired.milestone.slice(paired.beforeStart)] : counts
  // the line can run below 0 or above the tallest count, so the scale covers both
  const low = Math.min(0, start, end)
  const high = Math.max(1, start, end, ...shown)
  const y = (value: number): number => round(HEIGHT - ((value - low) / (high - low)) * HEIGHT)
  const slot = WIDTH / counts.length
  const gap = Math.min(4, slot * 0.2)
  const bar = (count: number, x: number, width: number, kind = ''): string =>
    `<rect${kind ? ` class="${kind}"` : ''} x="${round(x)}" y="${y(Math.max(count, 0))}" width="${round(width)}" height="${round(y(0) - y(count))}"/>`
  const bars = paired ? pairedBars(paired, slot, gap, bar, y(0)) : counts.map((count, at) => bar(count, at * slot + gap / 2, slot - gap)).join('')
  const line = `<line x1="${round(slot / 2)}" y1="${y(start)}" x2="${round(WIDTH - slot / 2)}" y2="${y(end)}"/>`
  const label = paired
    ? `Pace trend, oldest first: ${pairedSaid(paired, period)}, with a straight line fitted through ${seriesName(paired.from)} from ${tickets(start)} to ${tickets(end)} tickets a ${period}.`
    : `Pace trend: typed counts of ${counts.join(', ')}, oldest first, with a straight line fitted through them from ${tickets(start)} to ${tickets(end)} tickets a ${period}.`
  const through = paired ? `${seriesName(paired.from)} ${counts.length} ${period}s` : `${counts.length} ${period}s`
  const defs = paired && paired.beforeStart > 0 ? HATCH : ''
  return `
${indent}<figure class="pace-trend" role="img" aria-label="${label}">
${indent}  <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" height="${HEIGHT}" preserveAspectRatio="none" aria-hidden="true">${defs}<g class="trend-bars">${bars}</g><g class="trend-line">${line}</g></svg>
${indent}  <figcaption>Trend: ${tickets(start)} → ${tickets(end)} tickets a ${period}, a straight line through ${through}, oldest first.</figcaption>${paired ? `\n${indent}  ${legend(paired)}` : ''}
${indent}</figure>`
}

/** The hatching a period before the milestone started is drawn with. */
const HATCH =
  '<defs><pattern id="pace-trend-before" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="4"/></pattern></defs>'

/**
 * Each period's two bars: comparable work's, then the milestone's own, or a hatched stub before it started. The series
 * pace isn't drawn from is drawn faint.
 */
function pairedBars(
  { from, comparableWork, milestone, beforeStart }: PairedPace,
  slot: number,
  gap: number,
  bar: (count: number, x: number, width: number, kind: string) => string,
  floor: number,
): string {
  const width = (slot - gap) / 2
  const inUse = (series: PairedPace['from']): string => (series === from ? ' in-use' : '')
  return comparableWork
    .map((count, at) => {
      const x = at * slot + gap / 2
      const own =
        at < beforeStart
          ? `<rect class="before" x="${round(x + width)}" y="${round(floor - BEFORE_START_HEIGHT)}" width="${round(width)}" height="${BEFORE_START_HEIGHT}"/>`
          : bar(milestone[at]!, x + width, width, `own${inUse('milestone')}`)
      return bar(count, x, width, `comparable${inUse('comparableWork')}`) + own
    })
    .join('')
}

/** The key under the paired bars, the series pace comes from marked "pace". */
function legend({ from, beforeStart }: PairedPace): string {
  const marked = (series: PairedPace['from']): string => (series === from ? ', the pace' : '')
  return `<p class="legend"><i class="comparable"></i> comparable work${marked('comparableWork')} <i class="own"></i> the milestone’s own${marked('milestone')}${beforeStart > 0 ? ' <i class="before"></i> before it started' : ''}</p>`
}

/** The two series as the screen reader hears them, each period before the milestone started said so. */
function pairedSaid({ from, comparableWork, milestone, beforeStart }: PairedPace, period: PeriodName): string {
  const own = milestone.map((count, at) => (at < beforeStart ? 'not started' : String(count)))
  const pace = (series: PairedPace['from']): string => (series === from ? ', the pace' : '')
  return `comparable work's finished tickets each ${period}${pace('comparableWork')}, ${comparableWork.join(', ')}; the milestone's own${pace('milestone')}, ${own.join(', ')}`
}

function seriesName(from: PairedPace['from']): string {
  return from === 'comparableWork' ? 'comparable work’s' : 'the milestone’s own'
}

/** A line value as the EM reads it: to 1 decimal place, without a trailing ".0". */
function tickets(value: number): string {
  return String(Math.round(value * 10) / 10)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
