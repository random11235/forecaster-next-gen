import type { Element } from 'happy-dom'
import { INPUT_LABELS } from '../../../src/app/inputsScreen.js'
import { renderMilestoneForecastScreen } from '../../../src/app/milestoneForecastScreen.js'
import type { MilestoneForecastView } from '../../../src/forecast/index.js'
import { submitInputs, type ForecastingForTest } from '../../forecast/forecastingForTest.js'
import { newTeam } from '../../forecast/forecastViewScenario.js'
import { all, byRole, one, render } from '../dom.js'

// What the Milestone forecast screen's component tests share (#236): its views drawn, read as the EM reads them, and the
// milestones they arrange through Seam B (test/forecast/forecastingForTest.ts).

export const drawn = (view: MilestoneForecastView) => render(renderMilestoneForecastScreen(view))
/** `view`, a forecast, failing if it is not. */
export function forecast(view: MilestoneForecastView): Extract<MilestoneForecastView, { kind: 'forecast' }> {
  if (view.kind !== 'forecast') throw new Error(`Expected a forecast, but it was ${view.kind}`)
  return view
}
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/**
 * A date the view gives, as the screens say it: `2027-04-06` → `6 Apr 2027`. Written out here, not imported from
 * html.ts's `formatDate`, so the test checks the screen's dates against a reading of its own. The words the screen
 * shows as given, such as `INPUT_LABELS`, are imported instead: they are what it says, not how it works it out.
 */
export function dateSaid(isoDate: string | null): string {
  if (isoDate === null) throw new Error('Expected a date, but it was later than the horizon')
  const [year, month, day] = isoDate.split('-')
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`
}
/** The date `view` gives at its headline's percent, as the screens say it. */
export const headline = (view: Extract<MilestoneForecastView, { kind: 'forecast' }>) =>
  dateSaid(view.dates.find(({ percent }) => percent === view.headlinePercent)?.date ?? null)
export const STEPPED_UP = [4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8]
export const ODD_WEEK = [5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4]
/** The fields `form` carries hidden, as name and value. */
export const hiddenFields = (form: Element) => all(form, 'input[type="hidden"]').map((field) => [field.getAttribute('name'), field.getAttribute('value')])
/** The Capacity section, opened as the EM opens it, so what it folds is seen. */
export function opened(page: ReturnType<typeof drawn>): Element {
  const capacity = one(page, '#capacity')
  capacity.setAttribute('open', '')
  return capacity
}

/** Checkout v2 from `startDate` (1 Sep 2026 unless given), its tickets remaining and pace range entered: the forecast. */
export async function entered(ticketsRemaining: string, [low, high]: [string, string], { startDate = '2026-09-01', team = newTeam() } = {}) {
  const handle = await team
  await submitInputs(handle, { kind: 'setMilestone', name: 'Checkout v2', startDate, ticketsRemaining })
  await submitInputs(handle, { kind: 'setPaceRange', low, high })
  return handle
}
/** Checkout v2 from 1 Sep 2026, its tickets remaining, its pace these typed counts. */
export async function onTypedCounts(ticketsRemaining: string, counts: string): Promise<ForecastingForTest> {
  const team = await entered(ticketsRemaining, ['4', '8'])
  await submitInputs(team, { kind: 'setPaceCounts', counts })
  await submitInputs(team, { kind: 'setPaceMode', paceMode: 'counts' })
  return team
}
export const finishGraph = (view: MilestoneForecastView) => byRole(drawn(view), 'figure', { name: /^When the simulations finish/ })
