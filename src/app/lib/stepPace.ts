import { dayMonth } from '../../forecast/calendarDate.js'
import type { ComparableWorkPace, PairedPeriod, PickPace } from '../../forecast/comparableWorkPace.js'
import { escapeHtml } from '../html.js'

// The Comparable work step's pace (queryStepSection.ts): the pace it leads with, its periods paired as bars, and each
// pick's own pace on its chip.

/**
 * The pace the step leads with: the pace in use as the headline, how far it is from the milestone's own beneath, and
 * the two paired per period as bars, those before the milestone started hatched. Nothing until there is a pace.
 */
export function paceHtml(pace: ComparableWorkPace | undefined): string {
  if (pace?.said.inUse === undefined) return ''
  const comparing = pace.periods.some((period) => period.comparableWork !== undefined)
  const delta =
    pace.comparison !== undefined
      ? `\n            <p class="delta ${pace.comparison.versus.kind}">${escapeHtml(pace.said.comparison ?? '')}</p>`
      : comparing
        ? ''
        : '\n            <p class="delta">Add comparable work to measure pace from work like this milestone’s.</p>'
  const top = Math.max(1, ...pace.periods.flatMap((period) => [period.milestone ?? 0, period.comparableWork ?? 0]))
  const periods = pace.periods.map((period) => periodHtml(period, top)).join('\n')
  const own = pace.periods.some((period) => period.milestone !== undefined)
  const legend = `${comparing ? '<i class="comparable"></i> comparable work ' : ''}${own ? '<i class="own"></i> the milestone’s own' : ''}${pace.periods.some((period) => period.beforeStart) ? ' <i class="before"></i> before it started' : ''}`
  return `
          <div class="step-pace">
            <p class="headline">${escapeHtml(pace.said.inUse)} <small>${escapeHtml(pace.said.from ?? '')}</small></p>${delta}
            <ol class="pairs" aria-label="Tickets finished each period, oldest first">
${periods}
            </ol>
            <p class="legend">${legend}</p>
          </div>`
}

/** Tallest bar's height, in pixels. */
const PAIR_HEIGHT = 80

/**
 * One period's pair of bars: comparable work's, when it has a query, beside the milestone's own, when its read is
 * complete, hatched before it started.
 */
function periodHtml({ start, milestone, comparableWork, beforeStart }: PairedPeriod, top: number): string {
  const bar = (count: number, kind: string): string => `<i class="${kind}" style="height:${Math.max(2, Math.round((count / top) * PAIR_HEIGHT))}px"></i>`
  const said = `${dayMonth(start)}: ${[
    ...(comparableWork === undefined ? [] : [`comparable work ${comparableWork}`]),
    ...(milestone === undefined ? [] : [`the milestone’s own ${milestone}`]),
  ].join(', ')}${beforeStart ? ', before it started' : ''}`
  return `              <li class="period${beforeStart ? ' before' : ''}" title="${escapeHtml(said)}"><span class="two">${comparableWork === undefined ? '' : bar(comparableWork, 'comparable')}${milestone === undefined ? '' : bar(milestone, beforeStart ? 'before' : 'own')}</span><span class="when">${escapeHtml(dayMonth(start))}</span></li>`
}

/** A pick's chip's own pace: its strip of the periods paired, how many it finished, and with several picks how many only it brings in. */
export function pickPaceHtml(pick: PickPace | undefined): string {
  if (!pick) return ''
  const top = Math.max(1, ...pick.strip)
  const strip = pick.strip.map((count) => `<i style="height:${Math.round((count / top) * 12)}px"></i>`).join('')
  const only = pick.onlyHere === undefined ? '' : `, +${pick.onlyHere} only here`
  return ` <span class="strip" role="img" aria-label="Finished each period: ${pick.strip.join(', ')}">${strip}</span> <span class="kind">${pick.finished} finished${only}</span>`
}
