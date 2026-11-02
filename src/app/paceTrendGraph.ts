import type { PaceTrend } from '../forecast/paceTrend.js'
import type { PeriodName } from '../forecast/cadence.js'

/** The graph's drawing size in SVG units: it stretches to its box's width and is drawn this many pixels high. */
const WIDTH = 240
const HEIGHT = 64

/**
 * The pace trend: the typed counts as small bars, oldest first, and the straight line fitted through them, from the
 * middle of the first bar to the middle of the last. Information only: it says the line's two ends, not what they mean.
 */
export function renderPaceTrend(trend: PaceTrend | undefined, period: PeriodName, indent: string): string {
  if (!trend) return ''
  const { counts, start, end } = trend
  // the line can run below 0 or above the tallest count, so the scale covers both
  const low = Math.min(0, start, end)
  const high = Math.max(1, start, end, ...counts)
  const y = (value: number): number => round(HEIGHT - ((value - low) / (high - low)) * HEIGHT)
  const slot = WIDTH / counts.length
  const gap = Math.min(4, slot * 0.2)
  const bars = counts
    .map((count, at) => `<rect x="${round(at * slot + gap / 2)}" y="${y(Math.max(count, 0))}" width="${round(slot - gap)}" height="${round(y(0) - y(count))}"/>`)
    .join('')
  const line = `<line x1="${round(slot / 2)}" y1="${y(start)}" x2="${round(WIDTH - slot / 2)}" y2="${y(end)}"/>`
  const label = `Pace trend: typed counts of ${counts.join(', ')}, oldest first, with a straight line fitted through them from ${tickets(start)} to ${tickets(end)} tickets a ${period}.`
  return `
${indent}<figure class="pace-trend" role="img" aria-label="${label}">
${indent}  <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" height="${HEIGHT}" preserveAspectRatio="none" aria-hidden="true"><g class="trend-bars">${bars}</g><g class="trend-line">${line}</g></svg>
${indent}  <figcaption>Trend: ${tickets(start)} → ${tickets(end)} tickets a ${period}, a straight line through ${counts.length} ${period}s, oldest first.</figcaption>
${indent}</figure>`
}

/** A line value as the EM reads it: to 1 decimal place, without a trailing ".0". */
function tickets(value: number): string {
  return String(Math.round(value * 10) / 10)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
