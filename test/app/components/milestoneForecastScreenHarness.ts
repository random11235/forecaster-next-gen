import { INPUT_LABELS } from '../../../src/app/inputsScreen.js'
import { renderMilestoneForecastScreen } from '../../../src/app/milestoneForecastScreen.js'
import type { MilestoneForecastView } from '../../../src/forecast/index.js'
import type { ForecastingForTest } from '../../forecast/forecastingForTest.js'
import { enter, newTeam } from '../../forecast/forecastViewScenario.js'
import { byRole, render } from '../dom.js'

// What the Milestone forecast screen's component tests share (#236): its views drawn, read as the EM reads them, the
// figures a view gives as the screen says them, and the milestone they enter as Seam B's tests do
// (test/forecast/forecastViewScenario.ts).

export const drawn = (view: MilestoneForecastView) => render(renderMilestoneForecastScreen(view))
export const finishGraph = (view: MilestoneForecastView) => byRole(drawn(view), 'figure', { name: /^When the simulations finish/ })

type Forecast = Extract<MilestoneForecastView, { kind: 'forecast' }>
type Problems = Extract<MilestoneForecastView, { kind: 'problems' }>

/** `view`, a forecast, failing if it is not. */
export function forecast(view: MilestoneForecastView): Forecast {
  if (view.kind !== 'forecast') throw new Error(`Expected a forecast, but it was ${view.kind}`)
  return view
}
/** `view`, inputs that can't be forecast yet, failing if it is not, or names none. */
export function problems(view: MilestoneForecastView): Problems {
  if (view.kind !== 'problems' || view.problems.length === 0) throw new Error(`Expected problems, but it was ${view.kind}`)
  return view
}
/** What to fix, as the screen lists `view`'s problems: each beside its input's label. */
export const whatToFix = (view: Problems) => view.problems.map(({ input, message }) => `⚠ ${INPUT_LABELS[input]}: ${message}`).join(' ')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
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
export const headline = (view: Forecast) => dateSaid(view.dates.find(({ percent }) => percent === view.headlinePercent)?.date ?? null)
/** A share of the simulations the view gives, from 0 to 1, as the screens say it: a whole percent; under 1% above none. */
export const shareSaid = (share: number) => (share > 0 && share < 0.005 ? 'under 1%' : `${Math.round(share * 100)}%`)

/**
 * Checkout v2 from `startDate` (1 Sep 2026 unless given), its tickets remaining and pace range entered through Seam
 * B's `enter`, on `team` (a new one unless given): the team.
 */
export async function entered(
  ticketsRemaining: string,
  [low, high]: [string, string],
  { startDate = '2026-09-01', team }: { startDate?: string; team?: ForecastingForTest } = {},
): Promise<ForecastingForTest> {
  const handle = team ?? (await newTeam())
  await enter(handle, { startDate, ticketsRemaining }, { low, high })
  return handle
}
