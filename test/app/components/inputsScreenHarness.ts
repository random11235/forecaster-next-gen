import type { Element } from 'happy-dom'
import { renderInputsScreen } from '../../../src/app/inputsScreen.js'
import type { Forecasting, InputsEdit, InputsOpening, InputsScreen } from '../../../src/forecast/index.js'
import { submitInputs } from '../../forecast/forecastingForTest.js'
import { finishedInWeeks, open } from '../../trackerScenario.js'
import { all, byRole, render } from '../dom.js'

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
/** Where `form` posts, and the fields it carries hidden, as name and value: all it posts, with nothing to type. */
export const hidden = (form: Element) => [
  form.getAttribute('action'),
  all(form, 'input').map((field) => (field.getAttribute('type') === 'hidden' ? [field.getAttribute('name'), field.getAttribute('value')] : field.outerHTML)),
]
/** The screen `edit` refused draws; an edit saved instead throws. */
export const refused = async (team: Forecasting, edit: InputsEdit) => {
  const outcome = await submitInputs(team, edit)
  if (outcome.kind !== 'refused') throw new Error(`Expected the form refused, but it was ${outcome.kind}`)
  return drawn(outcome.view)
}
