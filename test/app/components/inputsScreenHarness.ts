import type { Element } from 'happy-dom'
import { renderInputsScreen } from '../../../src/app/inputsScreen.js'
import type { ConnectionEdit, Forecasting, InputsEdit, InputsOpening, InputsScreen } from '../../../src/forecast/index.js'
import { CONNECTIONS, outcomeOf, pick, submitInputs, type ForecastingForTest } from '../../forecast/forecastingForTest.js'
import { finishedInWeeks, open } from '../../trackerScenario.js'
import { all, byRole, hiddenFields, render } from '../dom.js'

// The Inputs screen's component tests' arrangement: the screen rendered from the views Seam B gives
// (test/forecast/forecastingForTest.ts), started no server.

export const READ_AT = '2026-11-12T09:00:00Z'
export const START = '2026-08-31'
export const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']
// GitHub reads 34 tickets remaining, and 5, 6, 4, 7, 5, 6, 8 finished in the weeks it reads whole
export const TICKETS = [...open(34), ...finishedInWeeks(WEEKS, [5, 6, 4, 7, 5, 6, 8])]

/** The screen as `renderInputsScreen` draws `view`, its candidates' opening, if it has one, kept as `opening-1`. */
export const drawn = (view: InputsScreen) => render(renderInputsScreen(view, () => 'opening-1'))
export const screen = async (team: Forecasting, opening?: InputsOpening) => drawn(await team.inputsScreen(opening))
export const section = (page: ReturnType<typeof render>, name: string) => byRole(page, 'region', { name })
/** What `form` posts, with nothing for the EM to type: where to, and its hidden fields; failing if it has a field to type. */
export function whatItPosts(form: Element) {
  const typed = all(form, 'input:not([type="hidden"])')
  if (typed.length > 0) throw new Error(`Expected nothing to type, but the form has ${typed.map((field) => field.outerHTML).join(', ')}`)
  return [form.getAttribute('action'), hiddenFields(form)]
}
/** The screen `edit` refused draws; an edit saved instead throws. */
export const refused = async (team: Forecasting, edit: InputsEdit) => drawn(outcomeOf(await submitInputs(team, edit), 'refused').view)
/**
 * Checkout v2 from `START` at 40 tickets remaining and 4–8 a week, on `team` connected by `connection` (GitHub unless
 * given), its tickets picked at `READ_AT` unless `picked` is false: the team.
 */
export async function milestoneOn(
  team: ForecastingForTest,
  { connection = CONNECTIONS.github, picked = true }: { connection?: ConnectionEdit; picked?: boolean } = {},
) {
  await team.submit({ form: 'connection', edit: connection })
  await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
  await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '8' })
  if (picked) await pick(team, READ_AT)
  return team
}
