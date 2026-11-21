import type { ThroughputRange } from '../../engine/index.js'
import type { MilestoneInputs, PaceMode, TicketsSource } from '../../model/milestoneInputs.js'
import type { SetupDraft } from '../../model/setupDraft.js'
import type { SetupState, Storage } from '../../storage/storage.js'
import { periodName, type PeriodName } from './cadence.js'
import { submitConnection, withTeamQueries } from './connection.js'
import { newMilestone } from './milestoneInputs.js'
import type { StepReading } from './queryStep.js'
import { readPicks } from './setupReads.js'
import { summaryOf, type SetupSummary } from './setupSummary.js'
import { SETUP_STEPS, setupStepOf, type SetupStep } from './setupSteps.js'
import { hasQuery } from './stepQuery.js'
import { measure, paceReadingView, trackerPace, type PaceReadingView } from './trackerReads.js'

export { COUNTS_WAIT } from './setupSummary.js'
export type { SetupStep } from './setupSteps.js'

/**
 * What setup, its summary and its reads read and save with, built once per request: what a query step reads with (the
 * team's connection and queries, their reads and setup's state), the milestone's inputs, whose sources Check chooses,
 * today, which the tracker's pace is counted to, and the EM's time zone, which reads are dated in. It is also what the
 * views read of the tracker (`TrackerReads`).
 */
export type SetupContext = StepReading & {
  milestoneInputs: Pick<Storage, 'milestoneInputs' | 'saveMilestoneInputs'>
  today: string
  timeZone: string
}

/** The milestone's inputs, or a new milestone's while none is entered: its sources are chosen at Check before it has a name. */
const inputsOrNew = ({ milestoneInputs }: SetupContext, teamId: string): MilestoneInputs => milestoneInputs.milestoneInputs(teamId) ?? newMilestone(teamId)

/** Where a step stands from the one shown: before it (`done`), it, or after it (`ahead`). */
export type StepMark = 'done' | 'current' | 'ahead'

/**
 * What the Inputs screen shows of setup: nothing in the browser build (`noSetup`); the steps, one at a time, while
 * setting up; once done, a summary of the connection; or, connecting skipped, nothing but a way to connect a tracker
 * (`skipped`), the inputs typed as the MVP has them.
 */
export type SetupView = { kind: 'noSetup' } | { kind: 'skipped' } | SetupSummary | SetupSteps

/** The setup step shown, each step marked from it, and the steps Back and Next (or Skip) go to, where they can. */
export interface SetupSteps {
  kind: 'steps'
  step: SetupStep
  steps: { step: SetupStep; mark: StepMark }[]
  /** None on Connect. */
  back?: SetupStep
  /**
   * None until the step can be left forward: Connect until connected, Milestone until it has a query, and Check,
   * which closes with "Use these" instead. Comparable work's is Skip until it has a query.
   */
  next?: { step: SetupStep; label: 'next' | 'skip' }
  /** Why the steps can't be cancelled, in place of Cancel: the connection they opened on was changed in them. */
  noCancel?: string
  /** At Check, its rows; none at any other step. */
  check?: SetupCheck
}

/** Why steps opened again can't be cancelled once the connection they opened on was changed: Cancel would keep the change but not what it read. */
export const NO_CANCEL =
  'The connection changed in these steps, so they can’t be cancelled: Cancel would keep the new connection with the old picks and reads. Go on to Check and use these.'

/**
 * Check (#220): for each value the tracker can supply, the EM's value now, the tracker's reading from the setup
 * draft's reads, and which source to use, starting on the value's current source until chosen there.
 */
export interface SetupCheck {
  /** The connected tracker, which the rows and their wording name: GitHub or Jira. */
  tracker: string
  ticketsRemaining: TicketsCheck
  pace: PaceCheck
}

/** Check's row for tickets remaining: the tracker or typed. */
export interface TicketsCheck {
  /** As typed, kept while the tracker's is used; none until typed. */
  yours: number | undefined
  /** The milestone query's open tickets in its draft read; none until it is read. */
  reading: number | undefined
  /** The tracker didn't return every ticket the query matched, so `reading` is part of them. */
  incomplete: boolean
  /** A new milestone's, typed, with no milestone entered yet. */
  source: TicketsSource
}

/** Check's row for pace: the tracker, or the EM's own pace, the range or, when that is what they use, the typed counts too. */
export interface PaceCheck {
  /** The EM's own pace: the one chosen at Check, else the one they use, else the range. */
  yours: { source: 'range'; range: ThroughputRange | undefined } | { source: 'counts'; counts: number[] }
  /** The milestone's period, which the range is per. */
  period: PeriodName
  /** The tracker's pace from the draft reads; none until a complete read reaches a whole period. */
  reading?: PaceReadingView
  /** No reading, as a read pace would come from is incomplete. */
  incomplete: boolean
  /** No reading, as the milestone has no start date yet to count pace's periods from: none entered, on a first setup. */
  noStartDate: boolean
  /** A new milestone's, the range, with no milestone entered yet. */
  source: PaceMode
  /** The tracker, then the range, then the typed counts when they are what the EM uses. */
  choices: readonly PaceMode[]
}

/**
 * Closes setup with "Use these" (`useThese`), by skipping connecting (`skipConnecting`), or, opened again from its
 * summary, with Cancel (`cancel`); or opens its steps again (`change`), at the Connect step from a refused token's
 * flag (`at: 'connect'`).
 */
export type SetupEdit =
  | { kind: 'useThese' }
  | { kind: 'skipConnecting' }
  | { kind: 'change'; at?: 'connect' }
  | { kind: 'cancel' }
  /** At Check, the source of a value, held in the draft. */
  | ({ kind: 'chooseSource' } & ChosenSource)

/** A value's source chosen at Check: tickets remaining's, the tracker or typed; or pace's, the tracker or the EM's own. */
export type ChosenSource = { value: 'ticketsRemaining'; source: TicketsSource } | { value: 'pace'; source: PaceMode }

/**
 * Whether setup changed: "Use these" is refused until the team is connected and its milestone has a query; Cancel,
 * unless setup was opened again from its summary. And where the Inputs screen opens next: at the step `next` names, or,
 * with none, as it opens by itself, at the summary, at the inputs typed, or at Connect until connected.
 */
export interface SetupSubmitted {
  saved: boolean
  next?: SetupStep
}

/**
 * How the Inputs screen opens setup's steps: at the step its URL asks for (`asked`, as the URL sends it), unless a
 * step's form was just refused, which opens that step (`refused`) to say why.
 */
export interface SetupOpening {
  asked?: string | null
  refused?: SetupStep
}

/**
 * Seam B: what the Inputs screen shows of the team's setup as it opens (`setupView`), at the step `opening` asks for.
 * Opening at Check reads, as at `readAt`, each pick the summary has no count for yet (`readPicks`).
 */
export async function openSetup(settingUp: SetupContext | undefined, teamId: string, opening: SetupOpening, readAt: string): Promise<SetupView> {
  const view = setupView(settingUp, teamId, opening.refused ?? setupStepOf(opening.asked))
  if (settingUp && view.kind === 'steps' && view.step === 'check') await readPicks(settingUp, teamId, readAt)
  return view
}

/**
 * Seam B: what the Inputs screen shows of the team's setup, at the step `asked` for (Milestone if none) while setting up.
 *
 * Closed done, and connected, it is the summary, reading nothing from the tracker, until Change opens the steps again.
 * Closed skipped, and not connected, it is the inputs typed. Otherwise the steps, as the setup draft has them: Connect
 * until the team is connected, and Milestone, asked for a later step, until the milestone has a query. Once the
 * connection they opened on is changed in them, they say they can't be cancelled (`noCancel`).
 */
export function setupView(settingUp: SetupContext | undefined, teamId: string, asked?: SetupStep): SetupView {
  if (!settingUp) return { kind: 'noSetup' }
  const connection = settingUp.connections.connection(teamId)
  const state = settingUp.setup.setupState(teamId)
  if (!state.open && state.closed === 'done' && connection) return summaryOf(withTeamQueries(settingUp, 'saved'), teamId, connection)
  if (!state.open && state.closed === 'skipped' && !connection) return { kind: 'skipped' }
  const { milestoneQueries } = withTeamQueries(settingUp, 'current')
  const picked = hasQuery(milestoneQueries.milestoneQuery(teamId))
  const pastMilestone = asked !== undefined && SETUP_STEPS.indexOf(asked) > SETUP_STEPS.indexOf('milestone')
  const step: SetupStep = !connection ? 'connect' : asked === 'connect' || (picked && pastMilestone) ? asked : 'milestone'
  const at = SETUP_STEPS.indexOf(step)
  const back = SETUP_STEPS[at - 1]
  const next = connection && nextOf(step, picked, hasQuery(milestoneQueries.comparableWorkQuery(teamId)))
  const check = step === 'check' ? checkOf(settingUp, teamId) : undefined
  return {
    kind: 'steps',
    step,
    steps: SETUP_STEPS.map((each, index) => ({ step: each, mark: index < at ? 'done' : index === at ? 'current' : 'ahead' })),
    ...(back && { back }),
    ...(next && { next }),
    ...(cancelRefused(state) && { noCancel: NO_CANCEL }),
    ...(check && { check }),
  }
}

/** Whether Cancel is refused: the steps changed the connection they opened on, which Cancel can't put back with its token. */
const cancelRefused = (state: SetupState): boolean => state.open && state.connection === 'changed'

/** The step Next (or Skip) goes to from `step`, if it can be left forward yet: the one after it. */
function nextOf(step: SetupStep, picked: boolean, comparable: boolean): SetupSteps['next'] {
  const after = SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1]
  if (!after || (step === 'milestone' && !picked)) return undefined
  return { step: after, label: step === 'comparableWork' && !comparable ? 'skip' : 'next' }
}

/** Check's rows: the saved values and sources, the draft's choices over them, and what the draft reads measure. */
function checkOf(settingUp: SetupContext, teamId: string): SetupCheck | undefined {
  const measured = measure(withTeamQueries(settingUp, 'current'), teamId)
  if (!measured) return undefined
  const inputs = inputsOrNew(settingUp, teamId)
  const chosen = settingUp.setup.setupDraft(teamId)?.sources
  const tickets = measured.ticketsRemaining
  const { reading: pace, incomplete } = trackerPace(inputs, settingUp.today, measured)
  const paceSource = chosen?.pace ?? inputs.paceMode
  const own = paceSource === 'tracker' ? inputs.paceMode : paceSource
  return {
    tracker: measured.tracker,
    ticketsRemaining: {
      yours: inputs.ticketsRemaining,
      reading: tickets?.count,
      incomplete: tickets?.incomplete ?? false,
      source: chosen?.ticketsRemaining ?? inputs.ticketsSource,
    },
    pace: {
      yours: own === 'counts' ? { source: 'counts', counts: inputs.paceCounts } : { source: 'range', range: inputs.paceRange },
      period: periodName(inputs.cadenceDays),
      ...(pace && { reading: paceReadingView(pace) }),
      incomplete,
      noStartDate: !pace && !incomplete && inputs.startDate === undefined,
      source: paceSource,
      choices: paceChoices(inputs),
    },
  }
}

/** The paces Check offers: the tracker and the range, and the typed counts when they are what the EM uses. */
function paceChoices(inputs: MilestoneInputs): readonly PaceMode[] {
  return inputs.paceMode === 'counts' ? ['tracker', 'range', 'counts'] : ['tracker', 'range']
}

/**
 * The draft's sources with a value's source chosen at Check, or none when it isn't offered: the team must be connected
 * and setup open, the value tickets remaining or pace, and the source one Check offers it.
 */
function withSource(settingUp: SetupContext, teamId: string, chosen: ChosenSource): SetupDraft['sources'] {
  if (!settingUp.connections.connection(teamId) || !settingUp.setup.setupState(teamId).open) return undefined
  const sources = settingUp.setup.setupDraft(teamId)?.sources
  if (chosen.value === 'ticketsRemaining') return { ...sources, ticketsRemaining: chosen.source }
  if (!paceChoices(inputsOrNew(settingUp, teamId)).includes(chosen.source)) return undefined
  return { ...sources, pace: chosen.source }
}

/**
 * Seam B: closes the team's setup, or opens its steps again, keeping its connection either way.
 *
 * "Use these" applies the setup draft, its queries and their reads together, then closes setup to its summary; it is
 * refused, changing nothing, until the team is connected and its milestone has a query. Change, from the summary or
 * from connecting skipped, opens the steps on a new draft, so nothing chosen in them changes the forecast until "Use
 * these"; connecting skipped, they open at Connect. Cancel throws that draft away, removing a connection made in the
 * steps, back to how setup was before they opened: the summary, connecting skipped, or a first setup's steps, a
 * connection the team had before them kept. Once the steps changed the connection they opened on, Cancel is refused,
 * changing nothing (`noCancel`): the old connection's token is gone, so it can't be put back.
 */
export async function submitSetup(settingUp: SetupContext, teamId: string, edit: SetupEdit): Promise<SetupSubmitted> {
  const saved = await edited(settingUp, teamId, edit)
  const next = nextAfter(settingUp, teamId, edit)
  return { saved, ...(next && { next }) }
}

/** Makes `edit`, if it can be made: whether it was. */
async function edited(settingUp: SetupContext, teamId: string, edit: SetupEdit): Promise<boolean> {
  const { setup } = settingUp
  switch (edit.kind) {
    case 'useThese': {
      const { milestoneQueries } = withTeamQueries(settingUp, 'current')
      if (!settingUp.connections.connection(teamId) || !hasQuery(milestoneQueries.milestoneQuery(teamId))) return false
      applySources(settingUp, teamId)
      settingUp.queries.applySetupDraft(teamId)
      setup.saveSetupState(teamId, { open: false, closed: 'done' })
      return true
    }
    case 'chooseSource': {
      const sources = withSource(settingUp, teamId, edit)
      if (sources) setup.saveDraftSources(teamId, sources)
      return sources !== undefined
    }
    case 'skipConnecting':
      setup.discardSetupDraft(teamId)
      setup.saveSetupState(teamId, { open: false, closed: 'skipped' })
      return true
    case 'change': {
      const state = setup.setupState(teamId)
      if (state.open) return true
      setup.discardSetupDraft(teamId)
      setup.saveSetupState(teamId, { open: true, reopened: state.closed })
      return true
    }
    case 'cancel':
      return cancelled(settingUp, teamId)
  }
}

/** Cancels the steps, if they can be: their draft thrown away, a connection made in them removed, and setup as before they opened. */
async function cancelled(settingUp: SetupContext, teamId: string): Promise<boolean> {
  const { setup } = settingUp
  const state = setup.setupState(teamId)
  if (!state.open || cancelRefused(state)) return false
  if (state.connection === 'made' && settingUp.connections.connection(teamId)) {
    if (!(await submitConnection(settingUp, teamId, { kind: 'disconnect' })).saved) return false
  }
  setup.discardSetupDraft(teamId)
  setup.saveSetupState(teamId, state.reopened ? { open: false, closed: state.reopened } : { open: true })
  return true
}

/**
 * The step the Inputs screen opens at after `edit`, made or refused: Check again for a source chosen there; Connect for
 * Change from a refused token's flag; Milestone when the steps are open there with the team connected; else none.
 */
function nextAfter(settingUp: SetupContext, teamId: string, edit: SetupEdit): SetupStep | undefined {
  if (edit.kind === 'chooseSource') return 'check'
  if (edit.kind === 'change' && edit.at) return edit.at
  const view = setupView(settingUp, teamId)
  return view.kind === 'steps' && view.step === 'milestone' ? 'milestone' : undefined
}

/**
 * Saves the sources chosen at Check into the milestone's inputs, each value's own kept for whichever source is used.
 * With no milestone entered yet, a new one takes them, entered only when they aren't a new milestone's own.
 */
function applySources(settingUp: SetupContext, teamId: string): void {
  const { milestoneInputs, setup } = settingUp
  const sources = setup.setupDraft(teamId)?.sources
  const saved = milestoneInputs.milestoneInputs(teamId)
  const inputs = inputsOrNew(settingUp, teamId)
  if (!sources) return
  const applied = { ...inputs, ticketsSource: sources.ticketsRemaining ?? inputs.ticketsSource, paceMode: sources.pace ?? inputs.paceMode }
  if (saved || applied.ticketsSource !== inputs.ticketsSource || applied.paceMode !== inputs.paceMode) milestoneInputs.saveMilestoneInputs(applied)
}
