import { dayMonth, MAX_TICKETS_PER_PERIOD, type InputsView, type PeriodName, type TrackerPaceView } from '../../forecast/index.js'
import type { PaceMode } from '../../model/milestoneInputs.js'
import { escapeHtml } from '../html.js'
import { renderPaceTrend } from '../paceTrendGraph.js'
import {
  errorLine,
  formAction,
  incompleteMark,
  INPUT_LABELS,
  inputSection,
  notesFor,
  radios,
  type FormError,
  type FormTarget,
  type Section,
} from './inputSection.js'
import { chip, chipForms, type Chip } from './readsDifferently.js'

// Behind inputsScreen.ts: its Pace section.

/** Where the form choosing the pace the forecast uses posts. */
const PACE_MODE_TARGET: FormTarget = { path: '/inputs/pace-mode', anchor: 'pace' }

/** The chip on the pace: its Follow posts as that form does, choosing the tracker's. */
const PACE_CHIP: Chip = { id: 'pace', reading: 'pace', follow: { ...PACE_MODE_TARGET, fields: { paceMode: 'tracker' } } }

/** Each pace's name; the tracker's is the connected tracker's own, GitHub or Jira. */
const PACE_MODE_NAMES: Record<Exclude<PaceMode, 'tracker'>, string> = { range: 'Range', counts: INPUT_LABELS.typedCounts }

/**
 * The pace: which one the forecast uses, the tracker's with a connection, the range, and the typed counts, the notes
 * and the trend beside the one in use.
 */
export function paceSection(screen: InputsView, error: FormError, period: PeriodName): Section {
  const { paceMode, paceUsed: inUse, trackerPace, notes, typedCountsNeeded: typedCounts, paceTrend } = screen.milestone
  const notesIfUsed = (mode: PaceMode): string => (mode === inUse ? notesFor('pace', notes) + notesFor('typedCounts', notes) : '')
  const trendIfUsed = (mode: PaceMode): string => (mode === inUse ? renderPaceTrend(paceTrend, period, '          ') : '')
  const { paceRange: range, paceCounts: counts } = screen.forms
  const chipIfUsed = (mode: PaceMode): string => (mode === inUse ? paceChip(trackerPace, period) : '')
  const modes: readonly PaceMode[] = trackerPace ? ['tracker', 'counts', 'range'] : ['range', 'counts']
  const name = (mode: PaceMode): string => (mode === 'tracker' ? escapeHtml(trackerPace?.tracker ?? '') : PACE_MODE_NAMES[mode])
  const tracker = trackerPace
    ? `
        <div class="pace-following" id="pace-tracker">
          <h3>${escapeHtml(trackerPace.tracker)}</h3>${errorLine(error('paceSkip'))}${trackerReading(trackerPace, period, inUse === 'tracker')}${notesIfUsed('tracker')}${trendIfUsed('tracker')}
        </div>`
    : ''
  return inputSection(
    INPUT_LABELS.pace,
    INPUT_LABELS.pace,
    `How many tickets the team finishes in a ${period}: ${trackerPace ? `the ${period}s ${escapeHtml(trackerPace.tracker)} reads, ` : ''}a range from a slow ${period} to a good one, or typed counts of past ${period}s. Typed counts need at least ${typedCounts.forForecast} for a forecast, and ${typedCounts.reliable} to be reliable. Capacity is set beside the forecast, under Pace.`,
    `        <form method="post" action="${formAction(PACE_MODE_TARGET)}">${errorLine(error('paceMode'))}
${radios('paceMode', 'Pace the forecast uses', modes, paceMode, name)}
          <div class="actions"><button type="submit" class="primary">Use this pace</button></div>
        </form>${chipForms(PACE_CHIP, trackerPace?.readsDifferently)}${tracker}
        <form method="post" action="/inputs/pace#pace-range" id="pace-range">${errorLine(error('paceRange'))}
          <h3>${PACE_MODE_NAMES.range}</h3>
          <div class="pace">
            <label>Low <input type="number" name="low" min="0" max="${MAX_TICKETS_PER_PERIOD}" step="1" value="${escapeHtml(range.low)}" required></label>
            <span class="to">to</span>
            <label>High <input type="number" name="high" min="0" max="${MAX_TICKETS_PER_PERIOD}" step="1" value="${escapeHtml(range.high)}" required></label>
            <span class="unit">tickets per ${period}</span>${chipIfUsed('range')}
          </div>${notesIfUsed('range')}
          <div class="actions"><button type="submit" class="primary">Save and forecast</button></div>
        </form>
        <form method="post" action="/inputs/pace-counts#pace-counts" id="pace-counts">${errorLine(error('paceCounts'))}
          <h3>${PACE_MODE_NAMES.counts}</h3>
          <div class="fields">
            <label class="wide">Tickets done each ${period}, oldest first <input type="text" name="counts" value="${escapeHtml(counts.counts)}" inputmode="numeric" placeholder="6, 4, 9"></label>${chipIfUsed('counts')}
          </div>${notesIfUsed('counts')}${trendIfUsed('counts')}
          <div class="actions"><button type="submit">Save counts</button></div>
        </form>
        <div class="counts">
          <form method="post" action="/inputs/pace-counts/add#pace-counts">
            <div class="fields">
              <label>Newest ${period} <input type="number" name="count" min="0" max="${MAX_TICKETS_PER_PERIOD}" step="1" value="${escapeHtml(counts.count)}" required></label>
              <button type="submit">Add count</button>
            </div>
          </form>
          <form method="post" action="/inputs/pace-counts/remove-last#pace-counts">
            <button type="submit">Remove last</button>
          </form>
        </div>`,
  )
}

/** The typed counts or the range in use, with its chip when the tracker reads pace differently: its periods' counts as bars. */
function paceChip(trackerPace: TrackerPaceView | undefined, period: PeriodName): string {
  if (!trackerPace?.readsDifferently || !trackerPace.reading) return ''
  const { tracker, readsDifferently } = trackerPace
  return `
            <span class="unit">${chip(PACE_CHIP, tracker, readsDifferently, `<p>${escapeHtml(tracker)} reads these ${period}s:</p>${trackerReading(trackerPace, period, false)}`)}</span>`
}

/**
 * The tracker's pace: its counts as bars, oldest first, a quiet period a red stub, with the periods counted and when
 * they were read, and faintly, the counts the read replaced. While pace follows it (`following`), its periods sit behind
 * Show weeks as blocks to type into, each holding its count: typing into one posts them all as typed counts, which
 * switches pace to them.
 */
function trackerReading({ tracker, reading, incomplete, was }: TrackerPaceView, period: PeriodName, following: boolean): string {
  if (!reading)
    return `\n          <p class="reading-line">${period}s finished · ${escapeHtml(tracker)}, ${incomplete ? `read in part${incompleteMark(true)}` : 'not read yet'}</p>`
  const { periods, counts, line, firstFinished, lastFinished, current, skipped } = reading
  const lines = `
          <p class="reading-line">${escapeHtml(line)}</p>${[firstFinished, lastFinished].map((said) => (said ? `\n          <p class="reading-line">${escapeHtml(said)}</p>` : '')).join('')}
          <p class="reading-line">${escapeHtml(current)}</p>${
            was ? `\n          <p class="reading-line was">was ${was.counts.join(', ')} on ${escapeHtml(was.readOn)}</p>` : ''
          }${skipped ? countAgainLine(skipped.line, skipped.starts) : ''}`
  if (periods.length === 0) return lines
  const tallest = Math.max(1, ...counts)
  const bars = periods
    .map(({ start, count, skipped }) =>
      skipped
        ? `<span class="bar gap" title="${period} of ${dayMonth(start)}: ${count}, skipped"><span class="v">–</span></span>`
        : count === 0
          ? `<span class="bar zero" title="${period} of ${dayMonth(start)}: 0"><span class="v">0</span></span>`
          : `<span class="bar" style="height: ${Math.round((count / tallest) * 100)}%" title="${period} of ${dayMonth(start)}: ${count}"><span class="v">${count}</span></span>`,
    )
    .join('')
  const said = periods.map(({ count, skipped }) => (skipped ? 'skipped' : String(count))).join(', ')
  const graph = `
          <div class="pace-bars" role="img" aria-label="Finished tickets per ${period}, oldest first: ${said}">${bars}</div>`
  if (!following) return graph + lines
  const button = (path: string, start: string, label: string): string =>
    `<button type="submit" formaction="${path}#pace-tracker" formnovalidate name="period" value="${start}" class="linkish">${label}</button>`
  const blocks = periods
    .map(({ start, count, skipped }) =>
      skipped
        ? `<span class="block skipped"><s>${count}</s> ${dayMonth(start)} ${button('/inputs/pace-count-again', start, 'count')}</span>`
        : `<span class="block"><label>${dayMonth(start)} <input type="number" name="week" min="0" max="${MAX_TICKETS_PER_PERIOD}" step="1" value="${count}" required></label> ${button('/inputs/pace-skip', start, 'skip')}</span>`,
    )
    .join('\n              ')
  // kept open once a period is skipped, so what was skipped, and counting it again, stay in view
  return `${graph}${lines}
          <details class="week-blocks"${skipped ? ' open' : ''}>
            <summary>Show ${period}s</summary>
            <form method="post" action="/inputs/pace-weeks#pace-counts">
              <p class="hint">Typing into a ${period} switches pace to typed counts, starting from these. Skip a ${period} that says nothing about the pace ahead (a holiday, say), and the one before counts instead.</p>
              <div class="blocks">
              ${blocks}
              </div>
              ${counts.length > 0 ? '<div class="actions"><button type="submit">Use as typed counts</button></div>' : ''}
            </form>
          </details>`
}

/** The skipped periods, as `trackerReads` says them, with a button to count them all again. */
function countAgainLine(line: string, starts: readonly string[]): string {
  const periods = starts.map((start) => `<input type="hidden" name="period" value="${start}">`).join('')
  return `
          <form method="post" action="/inputs/pace-count-again#pace-tracker" class="reading-line skipped-line">${escapeHtml(line)} ${periods}<button type="submit" class="linkish">count ${starts.length === 1 ? 'it' : 'them'} again</button></form>`
}
