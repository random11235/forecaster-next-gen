import type { ConnectionEdit } from './connection.js'
import type { InputsEdit, NextScreen } from './inputs.js'
import { inputsScreen, STEP_QUERIES, type InputsOpening, type InputsScreen, type QuerySetupStep, type ShownAgain } from './inputsScreenView.js'
import type { MilestoneForecastView } from './milestoneForecastView.js'
import type { StepQueryEdit } from './queryStep.js'
import type { SetupEdit } from './setup.js'
import type { SetupStep } from './setupSteps.js'
import type { SkipEdit } from './skippedPeriods.js'
import type { TeamEntries } from './teamEntries.js'

/**
 * Every form the EM submits, each as typed: an Inputs form, or a Capacity or pace pattern form beside the forecast
 * (`inputs`); the tracker's periods skipped or counted again (`skip`); the Connect step's (`connection`); setup's own
 * (`setup`); a query step's (`stepQuery`, of the step it edits); and Read again on setup's summary (`readAgain`).
 */
export type Edit =
  | { form: 'inputs'; edit: InputsEdit }
  | { form: 'skip'; edit: SkipEdit }
  | { form: 'connection'; edit: ConnectionEdit }
  | { form: 'setup'; edit: SetupEdit }
  | { form: 'stepQuery'; step: QuerySetupStep; edit: StepQueryEdit }
  | { form: 'readAgain' }

/** Where the EM goes next: a screen, and on the Inputs screen, the setup step it opens at. */
export interface Place {
  screen: NextScreen
  step?: SetupStep
}

/**
 * What a submit comes to: done, and the place to go next (`saved`), with, for a save in place, the Inputs screen to
 * show (`view`); refused, with the whole screen to show again, saying why (`screen`, `view`); or, going back to finding
 * from a query it clears, the EM asked to confirm that first (`confirmClear`). A query step's change the tracker reads
 * as nothing new, and setup's own forms, which open the step they go to, are done too.
 */
export type Outcome =
  | { saved: true; next: Place; view?: InputsScreen }
  | { saved: false; screen: 'inputs'; view: InputsScreen }
  | { saved: false; screen: 'forecast'; view: MilestoneForecastView }
  | { saved: false; confirmClear: true }

/**
 * How a submit's reply opens: as its URL asks (`InputsOpening`), and, for an Inputs form saved as it changes
 * (`inPlace`), answered with the Inputs screen, whose query step asks the tracker nothing.
 */
export interface SubmitOpening extends InputsOpening {
  inPlace?: boolean
}

/**
 * Seam B: one submit, which owns what follows from it. A save that renames the milestone moves the milestone query to
 * the new name, where it is just the tracker's milestone of the old one (`followRenamedMilestone`).
 */
export async function submit(entries: TeamEntries, edit: Edit, opening: SubmitOpening = {}): Promise<Outcome> {
  const again = (shown: ShownAgain = {}): Promise<Outcome> => inputsScreen(entries, opening, shown).then((view) => ({ saved: false, screen: 'inputs', view }))
  switch (edit.form) {
    case 'inputs':
      return submitInputs(entries, edit.edit, opening)
    case 'skip': {
      const submitted = await entries.submitSkip(edit.edit)
      if (submitted.saved) return { saved: true, next: { screen: 'inputs' } }
      return again(submitted.screen === 'inputs' ? { inputs: submitted.view } : {})
    }
    case 'connection': {
      const submitted = await entries.submitConnection(edit.edit)
      return submitted.saved ? { saved: true, next: { screen: 'inputs', step: submitted.next } } : again({ connection: submitted.view })
    }
    case 'setup': {
      const { next } = await entries.submitSetup(edit.edit)
      return { saved: true, next: { screen: 'inputs', ...(next && { step: next }) } }
    }
    case 'readAgain':
      await entries.submitReadAgain()
      return { saved: true, next: { screen: 'inputs' } }
    case 'stepQuery': {
      const submitted = await entries.submitStepQuery(edit.edit, STEP_QUERIES[edit.step])
      if (submitted.kind === 'refused') return again({ refused: { step: edit.step, query: submitted } })
      if (submitted.kind === 'confirmClear') return { saved: false, confirmClear: true }
      return { saved: true, next: { screen: 'inputs', step: edit.step } }
    }
  }
}

/** An Inputs, Capacity or pace pattern form: its milestone renamed followed once saved; saved in place, the Inputs screen to show. */
async function submitInputs(entries: TeamEntries, edit: InputsEdit, opening: SubmitOpening): Promise<Outcome> {
  const { capacityOpen = false, inPlace = false } = opening
  const named = entries.milestoneName()
  const submitted = await entries.submitInputs(edit, { capacityOpen })
  if (!submitted.saved) {
    if (submitted.screen === 'forecast') return submitted
    return { saved: false, screen: 'inputs', view: await inputsScreen(entries, opening, { inputs: submitted.view, unlisted: inPlace }) }
  }
  // a milestone not yet entered has no name to follow from
  const now = entries.milestoneName()
  if (named !== '' && now !== '' && named !== now) await entries.followRenamedMilestone({ from: named, to: now })
  const next: Place = { screen: submitted.next }
  return inPlace ? { saved: true, next, view: await inputsScreen(entries, opening, { unlisted: true }) } : { saved: true, next }
}
