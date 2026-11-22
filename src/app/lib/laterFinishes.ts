import type { LastFinish, LaterFinishes } from '../../forecast/index.js'

// Behind milestoneForecastScreen.ts and howItWorksScreen.ts: the quiet note each puts under its finish graph.

/** A last finish within the horizon, which each screen words its own way: "by 8 Aug 2028", or "in week 13". */
export type LastFinishBy = Extract<LastFinish, { kind: 'by' }>

/**
 * The simulations finishing after a finish graph's last bar, in one quiet line under it: "1% of simulations finish
 * later, the last by 8 Aug 2028.", or "…, some later than the horizon." Nothing when none do. `lastBy` words when the
 * last finishes, after "the last".
 */
export function renderLaterFinishes(later: LaterFinishes | undefined, lastBy: (last: LastFinishBy) => string): string {
  if (!later) return ''
  const share = percentText(later.share)
  const whenLast = later.last.kind === 'beyondHorizon' ? 'some later than the horizon' : `the last ${lastBy(later.last)}`
  return `<p class="note quiet">${share[0]!.toUpperCase()}${share.slice(1)} of simulations finish later, ${whenLast}.</p>`
}

/** A share as a whole percent, or "under 1%" for a share that rounds to 0 but holds some simulations. */
export function percentText(share: number): string {
  return share > 0 && share < 0.005 ? 'under 1%' : `${Math.round(share * 100)}%`
}
