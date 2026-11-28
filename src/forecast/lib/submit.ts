import { submitConnection, type ConnectionEdit } from './connection.js'
import { submitInputs, type InputsEdit, type NextScreen } from './inputs.js'
import { inputsScreen, STEP_QUERIES, type InputsOpening, type InputsScreen, type QuerySetupStep, type ShownAgain } from './inputsScreenView.js'
import type { MilestoneForecastView } from './milestoneForecastView.js'
import { followRenamedMilestone } from './milestoneRenamed.js'
import { submitStepQuery, type StepQueryEdit } from './queryStep.js'
import { reachBack } from './reachBack.js'
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

/**
 * Where the EM goes next, told by its `kind`: a screen (`screen`); or on the Inputs screen, the setup step it opens at
 * (`step`), a query step with its query open for editing (`editing`) or asking the EM to confirm going back to finding
 * clears it (`confirmingBack`), or the tracker's pace (`paceTracker`).
 */
export type Place =
  | { kind: 'screen'; screen: NextScreen }
  | { kind: 'step'; step: SetupStep }
  | { kind: 'editing'; step: QuerySetupStep }
  | { kind: 'confirmingBack'; step: QuerySetupStep }
  | { kind: 'paceTracker' }

/** The Inputs screen, at the setup step it opens at, if any. */
const inputsAt = (step: SetupStep | undefined): Place => (step ? { kind: 'step', step } : { kind: 'screen', screen: 'inputs' })

/**
 * What a renamed milestone's query came to, once the save that renamed it was done: it followed the new name and was
 * read (`followed`); it followed, but the tracker couldn't be read (`followedUnread`); or the tracker refused the new
 * name's query, which is left as it was (`refused`). A save with no query to follow says nothing of it.
 */
export type Followed = 'followed' | 'followedUnread' | 'refused'

/**
 * What a submit comes to, told by its `kind`: done, and the place to go next (`saved`); done in place, with the Inputs
 * screen to show (`savedInPlace`); either, for a save that renamed the milestone, with what its query came to
 * (`followed`); refused, with the whole screen to show again, saying why: the Inputs screen (`refused`) or, for a form
 * beside the forecast, the Milestone forecast screen (`refusedOnForecast`); refused, changing nothing, and the place to
 * go to, for setup's own forms, whose steps say why there (`refusedThere`); or, going back to finding from a query it
 * clears, the EM asked to confirm that first, at the place that asks it (`confirmClear`). A query step's change the tracker reads as nothing new is done too.
 */
export type Outcome =
  | { kind: 'saved'; next: Place; followed?: Followed }
  | { kind: 'savedInPlace'; view: InputsScreen; followed?: Followed }
  | { kind: 'refused'; view: InputsScreen }
  | { kind: 'refusedOnForecast'; view: MilestoneForecastView }
  | { kind: 'refusedThere'; next: Place }
  | { kind: 'confirmClear'; next: Place }

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
  const again = (shown: ShownAgain): Promise<Outcome> => refused(team, opening, shown)
  switch (edit.form) {
    case 'inputs':
      return inputsFormSubmitted(team, edit.edit, opening)
    case 'skip': {
      const submitted = await submitSkip(connected(team), team, edit.edit)
      return submitted.saved ? { kind: 'saved', next: { kind: 'paceTracker' } } : again({ inputs: submitted.view })
    }
    case 'connection': {
      const submitted = await submitConnection(connected(team), teamId, edit.edit)
      return submitted.saved ? { kind: 'saved', next: { kind: 'step', step: submitted.next } } : again({ connection: submitted.view })
    }
    case 'setup': {
      const { saved, next } = await submitSetup(connected(team), teamId, edit.edit)
      return { kind: saved ? 'saved' : 'refusedThere', next: inputsAt(next) }
    }
    case 'readAgain':
      if ((await submitReadAgain(connected(team), teamId, at.readAt)).kind === 'read') await paceReachedBack(team, { ended: true })
      return { kind: 'saved', next: { kind: 'screen', screen: 'inputs' } }
    case 'stepQuery': {
      const submitted = await submitStepQuery(connected(team), teamId, edit.edit, at.readAt, STEP_QUERIES[edit.step])
      if (submitted.kind === 'refused') return again({ refused: { step: edit.step, query: submitted } })
      if (submitted.kind === 'confirmClear') return { kind: 'confirmClear', next: { kind: 'confirmingBack', step: edit.step } }
      if (submitted.kind === 'saved' && submitted.read?.ok) await paceReachedBack(team, { ended: true })
      // a query edited by hand stays open for editing; every other change goes back to finding
      return { kind: 'saved', next: { kind: edit.edit.kind === 'editQuery' ? 'editing' : 'step', step: edit.step } }
    }
  }
}

/**
 * An Inputs, Capacity or pace pattern form: its milestone renamed followed once saved; a cadence saved reading the
 * tracker further back where its periods need it (`reachBack`, #415); saved in place, the Inputs screen to show;
 * refused on the Inputs screen, that screen whole, the form as typed.
 */
async function inputsFormSubmitted(team: TeamCall, edit: InputsEdit, opening: SubmitOpening): Promise<Outcome> {
  const { storage, teamId } = team
  const { capacityOpen = false, inPlace = false } = opening
  const milestoneName = (): string => storage.milestoneInputs(teamId)?.name ?? ''
  const named = milestoneName()
  const submitted = submitInputs(team, edit, { capacityOpen })
  if (!submitted.saved) {
    if (submitted.screen === 'forecast') return { kind: 'refusedOnForecast', view: submitted.view }
    return refused(team, opening, { inputs: submitted.view, unlisted: inPlace })
  }
  const followed = await renameFollowed(team, { from: named, to: milestoneName() })
  await cadenceReachedBack(team, edit)
  const said = followed && { followed }
  if (inPlace) return { kind: 'savedInPlace', view: await inputsScreen(team, opening, { unlisted: true }), ...said }
  return { kind: 'saved', next: { kind: 'screen', screen: submitted.next }, ...said }
}

/**
 * After a cadence is saved, the pace's queries read again as far back as its periods need: a read made at a shorter
 * cadence reaches too few of them whole. The browser build reads nothing.
 */
async function cadenceReachedBack(team: TeamCall, edit: InputsEdit): Promise<void> {
  if (edit.kind === 'setCadence') await paceReachedBack(team, { ended: false })
}

/**
 * After a read, the pace's queries read again as far back as comparable work's needs: ended, its window ends at its
 * last finished ticket, which a read reaching back from today may not reach 8 periods before (#424). Not `ended`, as
 * far back as the milestone's inputs need, where they changed.
 */
async function paceReachedBack({ reading, storage, teamId, at }: TeamCall, { ended }: { ended: boolean }): Promise<void> {
  const inputs = storage.milestoneInputs(teamId)
  if (!reading || !inputs) return
  await reachBack(reading, teamId, inputs, at.readAt, { ended })
}

/**
 * The milestone query followed from the milestone renamed, and what it came to; none where there was nothing to
 * follow: a milestone not yet entered has no name to follow from, and nothing connected no milestone query.
 */
async function renameFollowed({ reading, teamId, at }: TeamCall, renamed: { from: string; to: string }): Promise<Followed | undefined> {
  if (!reading || renamed.from === '' || renamed.to === '' || renamed.from === renamed.to) return undefined
  const followed = await followRenamedMilestone(reading, teamId, renamed, at.readAt)
  if (followed.kind === 'refused') return 'refused'
  if (followed.kind !== 'saved') return undefined
  return followed.read?.ok === false ? 'followedUnread' : 'followed'
}

/** Refused: the Inputs screen, whole, as `opening` asks and the refused form shows it again (`shown`). */
async function refused(team: TeamCall, opening: SubmitOpening, shown: ShownAgain): Promise<Outcome> {
  return { kind: 'refused', view: await inputsScreen(team, opening, shown) }
}
