import { submitConnection, type ConnectionEdit } from './connection.js'
import { submitInputs, type InputsEdit, type NextScreen } from './inputs.js'
import { inputsScreen, STEP_QUERIES, type InputsOpening, type InputsScreen, type QuerySetupStep, type ShownAgain } from './inputsScreenView.js'
import type { MilestoneForecastView } from './milestoneForecastView.js'
import { followRenamedMilestone } from './milestoneRenamed.js'
import { submitStepQuery, type StepQueryEdit } from './queryStep.js'
import { submitSetup, type SetupEdit } from './setup.js'
import { submitReadAgain } from './setupReads.js'
import type { SetupStep } from './setupSteps.js'
import { submitSkip, type SkipEdit } from './skippedPeriods.js'
import { connected, type TeamCall } from './teamCall.js'

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
export async function submit(team: TeamCall, edit: Edit, opening: SubmitOpening = {}): Promise<Outcome> {
  const { teamId, at } = team
  const again = (shown: ShownAgain = {}): Promise<Outcome> => inputsScreen(team, opening, shown).then((view) => ({ saved: false, screen: 'inputs', view }))
  switch (edit.form) {
    case 'inputs':
      return inputsFormSubmitted(team, edit.edit, opening)
    case 'skip': {
      const submitted = await submitSkip(connected(team), teamId, edit.edit, team.settings, at)
      return submitted.saved ? { saved: true, next: { screen: 'inputs' } } : again({ inputs: submitted.view })
    }
    case 'connection': {
      const submitted = await submitConnection(connected(team), teamId, edit.edit)
      return submitted.saved ? { saved: true, next: { screen: 'inputs', step: submitted.next } } : again({ connection: submitted.view })
    }
    case 'setup': {
      const { next } = await submitSetup(connected(team), teamId, edit.edit)
      return { saved: true, next: { screen: 'inputs', ...(next && { step: next }) } }
    }
    case 'readAgain':
      await submitReadAgain(connected(team), teamId, at.readAt)
      return { saved: true, next: { screen: 'inputs' } }
    case 'stepQuery': {
      const submitted = await submitStepQuery(connected(team), teamId, edit.edit, at.readAt, STEP_QUERIES[edit.step])
      if (submitted.kind === 'refused') return again({ refused: { step: edit.step, query: submitted } })
      if (submitted.kind === 'confirmClear') return { saved: false, confirmClear: true }
      return { saved: true, next: { screen: 'inputs', step: edit.step } }
    }
  }
}

/**
 * An Inputs, Capacity or pace pattern form: its milestone renamed followed once saved; saved in place, the Inputs
 * screen to show; refused on the Inputs screen, that screen whole, the form as typed.
 */
async function inputsFormSubmitted(team: TeamCall, edit: InputsEdit, opening: SubmitOpening): Promise<Outcome> {
  const { storage, teamId, settings, at, tracker, reading } = team
  const { capacityOpen = false, inPlace = false } = opening
  const milestoneName = (): string => storage.milestoneInputs(teamId)?.name ?? ''
  const named = milestoneName()
  const submitted = submitInputs(storage, teamId, settings, at.today, edit, { capacityOpen, tracker })
  if (!submitted.saved) {
    if (submitted.screen === 'forecast') return submitted
    return { saved: false, screen: 'inputs', view: await inputsScreen(team, opening, { inputs: submitted.view, unlisted: inPlace }) }
  }
  // a milestone not yet entered has no name to follow from; nothing connected has no milestone query to follow
  const now = milestoneName()
  if (reading && named !== '' && now !== '' && named !== now) await followRenamedMilestone(reading, teamId, { from: named, to: now }, at.readAt)
  const next: Place = { screen: submitted.next }
  return inPlace ? { saved: true, next, view: await inputsScreen(team, opening, { unlisted: true }) } : { saved: true, next }
}
