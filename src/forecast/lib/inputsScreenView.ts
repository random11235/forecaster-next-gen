import type { ConnectStep } from './connection.js'
import type { InputsView } from './inputs.js'
import type { QueryStep, QueryStepOpening, RefusedQuery } from './queryStep.js'
import type { SetupView } from './setup.js'
import type { SetupStep } from './setupSteps.js'
import { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from './stepQuery.js'
import type { CapacityShown, TeamEntries } from './teamEntries.js'

/** A setup step that picks or writes one of the team's queries: the Milestone step, or the Comparable work step. */
export type QuerySetupStep = Extract<SetupStep, 'milestone' | 'comparableWork'>

/** The query each query step edits. */
export const STEP_QUERIES: Readonly<Record<QuerySetupStep, StepQuery>> = { milestone: MILESTONE_QUERY, comparableWork: COMPARABLE_WORK }

/**
 * How the Inputs screen opens, as its URL asks: at the setup step `step` names (as the URL sends it), the query step
 * shown with its query open for editing when `editing` names it, and then `confirmingBack` asking the EM to confirm
 * going back to finding clears it; the Comparable work step reading, as candidates, the choices `opened` names; each
 * query step's lists narrowed to what its find box sent (`find`). `capacityOpen`: a form posted from the Milestone
 * forecast screen's open Capacity section, which a refusal shows again open.
 */
export interface InputsOpening extends CapacityShown {
  step?: string | null
  editing?: QuerySetupStep
  confirmingBack?: boolean
  opened?: readonly string[]
  find?: Partial<Record<QuerySetupStep, string>>
}

/**
 * The Inputs screen, whole: the milestone, its pace and the team's growth (`inputs`); in the local server build, the
 * Connect step (`connection`), setup (`setup`: the step the EM is on, or once closed its summary or the inputs typed)
 * and, while setup is on a query step, that step (`step`). The browser build has none of these three.
 */
export interface InputsScreen {
  inputs: InputsView
  connection?: ConnectStep
  setup?: Exclude<SetupView, { kind: 'noSetup' }>
  step?: QueryStep
}

/**
 * How a refused form shows the screen again, beyond what `InputsOpening` asks: with its `inputs` as typed; with the
 * Connect step as typed (`connection`), which opens setup there; with the query step `refused`, which opens there on
 * that refusal. `unlisted`, the query step asks the tracker nothing: a save in place replaces only the sections saved.
 */
export interface ShownAgain {
  inputs?: InputsView
  connection?: ConnectStep
  refused?: { step: QuerySetupStep; query: RefusedQuery }
  unlisted?: boolean
}

/**
 * Seam B: the Inputs screen, whole, as `opening` asks, or as a refused form shows it again (`again`). Only the query
 * step shown is built, so the tracker is asked nothing for one once setup is closed.
 */
export async function inputsScreen(entries: TeamEntries, opening: InputsOpening, again: ShownAgain = {}): Promise<InputsScreen> {
  const { refused, connection } = again
  const setup = await entries.openSetup({
    asked: opening.step ?? null,
    ...(refused && { refused: refused.step }),
    ...(connection && { refused: 'connect' as const }),
  })
  const shown = setup.kind === 'steps' && isQueryStep(setup.step) ? setup.step : undefined
  const step = shown && (await queryStep(entries, shown, opening, again))
  const inputs = again.inputs ?? (await entries.inputsView())
  const connect = connection ?? (await entries.connectionView())
  return {
    inputs,
    ...(connect.kind !== 'noConnect' && { connection: connect }),
    ...(setup.kind !== 'noSetup' && { setup }),
    ...(step && step.kind !== 'noQueryStep' && { step }),
  }
}

/** The query step `shown`, opening as `opening` asks, or on its query just refused. */
async function queryStep(entries: TeamEntries, shown: QuerySetupStep, opening: InputsOpening, { refused, unlisted = false }: ShownAgain) {
  const editing = opening.editing === shown
  const stepOpening: QueryStepOpening =
    refused?.step === shown
      ? { refused: refused.query }
      : { editing, confirmingBack: editing && opening.confirmingBack === true, unlisted, opened: opening.opened ?? [] }
  return entries.queryStepView(opening.find?.[shown] ?? '', stepOpening, STEP_QUERIES[shown])
}

const isQueryStep = (step: SetupStep): step is QuerySetupStep => step === 'milestone' || step === 'comparableWork'
