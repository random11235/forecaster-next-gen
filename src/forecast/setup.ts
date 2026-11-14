import type { ThroughputRange } from '../engine/index.js'
import type { Connection } from '../model/connection.js'
import type { MilestoneInputs, PaceMode, TicketsSource } from '../model/milestoneInputs.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { SetupDraft } from '../model/setupDraft.js'
import type { MilestoneQueryStorage, SavedReadStorage, SetupStorage, Storage } from '../storage/storage.js'
import type { Connecting } from './connection.js'
import type { SavedRead } from '../model/savedRead.js'
import { periodName, type PeriodName } from './cadence.js'
import { weeksRead } from './finished.js'
import { chipsShow, kindName, LEAF_NOTE, readFlag } from './queryStep.js'
import { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from './stepQuery.js'
import { measure, paceReadingView, readOn, type PaceReadingView } from './trackerReads.js'
import { trackerOf, type TrackerFacts } from './trackers.js'

/** The setup steps, in order: connect a tracker, pick the milestone's tickets, pick comparable work, check what they give. */
export const SETUP_STEPS = ['connect', 'milestone', 'comparableWork', 'check'] as const

/** A setup step. */
export type SetupStep = (typeof SETUP_STEPS)[number]

/**
 * What setup reads and saves: the team's connection and queries, the milestone query's read, how setup was closed, the
 * milestone's inputs, whose sources Check chooses, today, which the tracker's pace is counted to, and the EM's time
 * zone, which the read is dated in.
 */
export type SettingUp = Pick<Connecting, 'connections' | 'milestoneQueries' | 'reads'> & {
  setup: SetupStorage
  milestoneInputs: Pick<Storage, 'milestoneInputs' | 'saveMilestoneInputs'>
  today: string
  timeZone: string
}

/** Where a step stands from the one shown: before it (`done`), it, or after it (`ahead`). */
export type StepMark = 'done' | 'current' | 'ahead'

/**
 * What the Inputs screen shows of setup: nothing in the browser build (`noSetup`); the steps, one at a time, while
 * setting up; once done, a summary of the connection; or, connecting skipped, nothing but a way to connect a tracker
 * (`skipped`), the inputs typed as the MVP has them.
 */
export type SetupView = { kind: 'noSetup' } | { kind: 'skipped' } | SetupSummary | SetupSteps

/**
 * Setup done: the tracker, the repo or project read, and when the milestone's tickets were last read, if they were;
 * what the milestone query reads, and comparable work's when it has one; the leaf-and-epics line, once; and only
 * what is wrong with those reads.
 */
export interface SetupSummary {
  kind: 'summary'
  tracker: string
  where: string
  /** In the EM's time zone: "4 Nov 09:12". */
  readOn?: string
  milestone: SummaryRow
  /** None without comparable work. */
  comparable?: SummaryRow
  /** "Leaf tickets only. Epics include their sub-epics." */
  note: string
  /** Problem flags only: none for a working setup. */
  flags: SummaryFlag[]
}

/** A summary row: the picks, each named with its kind as the screens name it ("epic", "fix version"), or the query as written by hand. */
export type SummaryRow = { picks: { name: string; kind: string }[] } | { query: string }

/** What is wrong with a query's saved read, and which query's it is. */
export interface SummaryFlag {
  of: 'milestone' | 'comparable'
  flag: string
}

/** The setup step shown, each step marked from it, and the steps Back and Next (or Skip) go to, where they can. */
export interface SetupSteps {
  kind: 'steps'
  step: SetupStep
  steps: { step: SetupStep; mark: StepMark }[]
  /** None on Connect. */
  back?: SetupStep
  /** Setup opened again from its summary, with Change: Cancel throws its draft away, back to the summary. None in a first setup. */
  cancel?: true
  /**
   * None until the step can be left forward: Connect until connected, Milestone until it has a query, and Check,
   * which closes with "Use these" instead. Comparable work's is Skip until it has a query.
   */
  next?: { step: SetupStep; label: 'next' | 'skip' }
  /** At Check, its rows; none at any other step. */
  check?: SetupCheck
}

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
  /** None with no milestone entered yet, which has no source to choose. */
  source?: TicketsSource
}

/** Check's row for pace: the tracker, or the EM's own pace, the range or, when that is what they use, the typed counts. */
export interface PaceCheck {
  yours: { source: 'range'; range: ThroughputRange | undefined } | { source: 'counts'; counts: number[] }
  /** The milestone's period, which the range is per. */
  period: PeriodName
  /** The tracker's pace from the draft reads; none until a complete read reaches a whole period. */
  reading?: PaceReadingView
  /** No reading, as a read pace would come from is incomplete. */
  incomplete: boolean
  /** None with no milestone entered yet, which has no source to choose. */
  source?: PaceMode
  /** The tracker, then the EM's own. */
  choices: readonly [PaceMode, PaceMode]
}

/**
 * Closes setup with "Use these" (`useThese`), by skipping connecting (`skipConnecting`), or, opened again from its
 * summary, with Cancel (`cancel`); or opens its steps again (`change`).
 */
export type SetupEdit =
  | { kind: 'useThese' }
  | { kind: 'skipConnecting' }
  | { kind: 'change' }
  | { kind: 'cancel' }
  /** At Check, the source of a value, `ticketsRemaining` (`tracker` or `typed`) or `pace` (`tracker` or the EM's own), held in the draft. */
  | { kind: 'chooseSource'; value: string; source: string }

/**
 * Whether setup changed: "Use these" is refused until the team is connected and its milestone has a query; Cancel,
 * unless setup was opened again from its summary.
 */
export interface SetupSubmitted {
  saved: boolean
}

/**
 * Seam B: what the Inputs screen shows of the team's setup, at the step `asked` for (Milestone if none) while setting up.
 *
 * Done, and connected, it is the summary, reading nothing from the tracker, until Change opens the steps again. Skipped,
 * and not connected, it is the inputs typed. Otherwise the steps, as the setup draft has them: Connect until the team is
 * connected, and Milestone, asked for a later step, until the milestone has a query.
 */
export function setupView(settingUp: SettingUp | undefined, teamId: string, asked?: string): SetupView {
  if (!settingUp) return { kind: 'noSetup' }
  const connection = settingUp.connections.connection(teamId)
  const closed = settingUp.setup.setupClosed(teamId)
  const reopened = closed === 'done' && settingUp.setup.setupDraft(teamId) !== undefined
  if (closed === 'done' && connection && !reopened) return summaryOf(settingUp, teamId, connection)
  if (closed === 'skipped' && !connection) return { kind: 'skipped' }
  const drafted = throughDraft(settingUp)
  const picked = hasQuery(drafted.milestoneQueries.milestoneQuery(teamId))
  const step: SetupStep = !connection ? 'connect' : asked === 'connect' || (picked && isLater(asked)) ? (asked as SetupStep) : 'milestone'
  const at = SETUP_STEPS.indexOf(step)
  const back = SETUP_STEPS[at - 1]
  const next = connection && nextOf(step, picked, hasQuery(drafted.milestoneQueries.comparableWorkQuery(teamId)))
  const check = step === 'check' ? checkOf(settingUp, teamId) : undefined
  return {
    kind: 'steps',
    step,
    steps: SETUP_STEPS.map((each, index) => ({ step: each, mark: index < at ? 'done' : index === at ? 'current' : 'ahead' })),
    ...(back && { back }),
    ...(reopened && { cancel: true as const }),
    ...(next && { next }),
    ...(check && { check }),
  }
}

/** Check's rows: the saved values and sources, the draft's choices over them, and what the draft reads measure. */
function checkOf(settingUp: SettingUp, teamId: string): SetupCheck | undefined {
  const measured = measure(throughDraft(settingUp), teamId, settingUp.milestoneInputs, settingUp.today)
  if (!measured) return undefined
  const inputs = settingUp.milestoneInputs.milestoneInputs(teamId)
  const chosen = settingUp.setup.setupDraft(teamId)?.sources
  const tickets = measured.ticketsRemaining
  const pace = measured.pace
  const own = ownPace(inputs)
  return {
    tracker: measured.tracker,
    ticketsRemaining: {
      yours: inputs?.ticketsRemaining,
      reading: tickets?.count,
      incomplete: tickets?.incomplete ?? false,
      ...(inputs && { source: chosen?.ticketsRemaining ?? inputs.ticketsSource }),
    },
    pace: {
      yours: own === 'counts' ? { source: 'counts', counts: inputs?.paceCounts ?? [] } : { source: 'range', range: inputs?.paceRange },
      period: periodName(inputs?.cadenceDays ?? 7),
      ...(pace && { reading: paceReadingView(pace) }),
      incomplete: measured.paceIncomplete,
      ...(inputs && { source: chosen?.pace ?? inputs.paceMode }),
      choices: ['tracker', own],
    },
  }
}

/** The EM's own pace, offered at Check beside the tracker's: the typed counts when they use them, else the range. */
function ownPace(inputs: MilestoneInputs | undefined): 'range' | 'counts' {
  return inputs?.paceMode === 'counts' ? 'counts' : 'range'
}

/** Whether setup's steps are open: in a first setup, or opened again from its summary with Change. */
function isOpen(setup: SetupStorage, teamId: string): boolean {
  const closed = setup.setupClosed(teamId)
  return closed === undefined || (closed === 'done' && setup.setupDraft(teamId) !== undefined)
}

/**
 * The draft with a value's source chosen at Check, or none when it isn't offered: the team must be connected, setup
 * open and the milestone entered, the value tickets remaining or pace, and the source one Check offers it.
 */
function withSource(settingUp: SettingUp, teamId: string, { value, source }: { value: string; source: string }): SetupDraft | undefined {
  const inputs = settingUp.milestoneInputs.milestoneInputs(teamId)
  if (!inputs || !settingUp.connections.connection(teamId) || !isOpen(settingUp.setup, teamId)) return undefined
  const draft = settingUp.setup.setupDraft(teamId) ?? NO_DRAFT
  if (value === 'ticketsRemaining' && (source === 'tracker' || source === 'typed')) return { ...draft, sources: { ...draft.sources, ticketsRemaining: source } }
  const pace = (['tracker', ownPace(inputs)] as const).find((offered) => offered === source)
  if (value === 'pace' && pace) return { ...draft, sources: { ...draft.sources, pace } }
  return undefined
}

/** Whether `asked` names a step after Milestone. */
function isLater(asked: string | undefined): boolean {
  return asked === 'comparableWork' || asked === 'check'
}

/** The step Next (or Skip) goes to from `step`, if it can be left forward yet. */
function nextOf(step: SetupStep, picked: boolean, comparable: boolean): SetupSteps['next'] {
  switch (step) {
    case 'connect':
      return { step: 'milestone', label: 'next' }
    case 'milestone':
      return picked ? { step: 'comparableWork', label: 'next' } : undefined
    case 'comparableWork':
      return { step: 'check', label: comparable ? 'next' : 'skip' }
    case 'check':
      return undefined
  }
}

/** Whether a step's query is saved, and not left empty by removing its last pick or starting afresh. */
const hasQuery = (saved: MilestoneQuery | undefined): boolean => (saved?.query ?? '') !== ''

function summaryOf(settingUp: SettingUp, teamId: string, connection: Connection): SetupSummary {
  const tracker = trackerOf(connection)
  const query = settingUp.milestoneQueries.milestoneQuery(teamId)?.query
  const read = query === undefined ? undefined : settingUp.reads.savedRead({ teamId, query })
  const comparable = settingUp.milestoneQueries.comparableWorkQuery(teamId)
  const comparableRead = comparable && hasQuery(comparable) ? settingUp.reads.savedRead({ teamId, query: comparable.query }) : undefined
  return {
    kind: 'summary',
    tracker: tracker.name,
    where: tracker.where(connection),
    ...(read && { readOn: readOn(read.readAt, settingUp.timeZone) }),
    milestone: rowOf(tracker, settingUp.milestoneQueries.milestoneQuery(teamId) ?? { picks: [], query: '' }),
    ...(comparable && hasQuery(comparable) && { comparable: rowOf(tracker, comparable) }),
    note: LEAF_NOTE,
    flags: [...flagOf('milestone', read, tracker.name, MILESTONE_QUERY), ...flagOf('comparable', comparableRead, tracker.name, COMPARABLE_WORK)],
  }
}

/**
 * What is wrong with a query's saved read, as its step says it (`readFlag`): incomplete, or the milestone's matching
 * nothing; or comparable work's finishing nothing, so pace is the milestone's own. None for a read that is fine, or none.
 */
function flagOf(of: SummaryFlag['of'], read: SavedRead | undefined, trackerName: string, stepQuery: StepQuery): SummaryFlag[] {
  if (!read) return []
  const flag = readFlag(read, trackerName, stepQuery)?.flag ?? (of === 'comparable' && !read.tickets.some((ticket) => ticket.finishedAt !== undefined) ? comparableUnused(read) : undefined)
  return flag === undefined ? [] : [{ of, flag }]
}

/** Comparable work's read finishing nothing: "…nothing finished in the last 9 weeks, so pace comes from the milestone’s own tickets…". */
function comparableUnused(read: SavedRead): string {
  return `This query matches nothing finished in the last ${weeksRead(read)} weeks, so pace comes from the milestone’s own tickets. Check it picks out ${COMPARABLE_WORK.picksOut}.`
}

/** A query's row: its picks with their kinds when the picker shows it as their chips, else the query as written. */
function rowOf(tracker: TrackerFacts, saved: MilestoneQuery): SummaryRow {
  return chipsShow(tracker, saved) ? { picks: saved.picks.map(({ name, kind }) => ({ name, kind: kindName(kind) })) } : { query: saved.query }
}

/**
 * Seam B: closes the team's setup, or opens its steps again, keeping its connection either way.
 *
 * "Use these" applies the setup draft, its queries and their reads together, then closes setup to its summary; it is
 * refused, changing nothing, until the team is connected and its milestone has a query. Change, from the summary, opens
 * the steps on a new draft, so nothing chosen in them changes the forecast until "Use these"; Cancel throws that draft
 * away, back to the summary as it was, and is refused in a first setup, which has no summary to go back to. Connecting
 * skipped, Change opens the steps at Connect.
 */
export function submitSetup(settingUp: SettingUp, teamId: string, edit: SetupEdit): SetupSubmitted {
  const { setup } = settingUp
  switch (edit.kind) {
    case 'useThese':
      if (!settingUp.connections.connection(teamId) || !hasQuery(throughDraft(settingUp).milestoneQueries.milestoneQuery(teamId))) return { saved: false }
      applySources(settingUp, teamId)
      applyDraft(settingUp, teamId)
      setup.closeSetup(teamId, 'done')
      return { saved: true }
    case 'chooseSource': {
      const draft = withSource(settingUp, teamId, edit)
      if (!draft) return { saved: false }
      setup.saveSetupDraft(teamId, draft)
      return { saved: true }
    }
    case 'skipConnecting':
      setup.discardSetupDraft(teamId)
      setup.closeSetup(teamId, 'skipped')
      return { saved: true }
    case 'change':
      if (setup.setupClosed(teamId) === 'done') setup.saveSetupDraft(teamId, setup.setupDraft(teamId) ?? NO_DRAFT)
      else setup.reopenSetup(teamId)
      return { saved: true }
    case 'cancel':
      if (setup.setupClosed(teamId) !== 'done') return { saved: false }
      setup.discardSetupDraft(teamId)
      return { saved: true }
  }
}

/** A draft with nothing chosen yet: the steps show the saved queries and reads. */
const NO_DRAFT: SetupDraft = { reads: [] }

/** Saves the sources chosen at Check into the milestone's inputs, each value's own kept for whichever source is used. */
function applySources({ milestoneInputs, setup }: SettingUp, teamId: string): void {
  const sources = setup.setupDraft(teamId)?.sources
  const inputs = milestoneInputs.milestoneInputs(teamId)
  if (!sources || !inputs) return
  milestoneInputs.saveMilestoneInputs({ ...inputs, ticketsSource: sources.ticketsRemaining ?? inputs.ticketsSource, paceMode: sources.pace ?? inputs.paceMode })
}

/** Saves the draft's queries and reads over the saved ones, and discards it. */
function applyDraft({ milestoneQueries, reads, setup }: DraftedThrough, teamId: string): void {
  const draft = setup.setupDraft(teamId)
  if (!draft) return
  if (draft.milestoneQuery) milestoneQueries.saveMilestoneQuery(teamId, draft.milestoneQuery)
  if (draft.comparableWorkQuery) milestoneQueries.saveComparableWorkQuery(teamId, draft.comparableWorkQuery)
  for (const { query, read } of draft.reads) reads.saveRead({ teamId, query }, read)
  setup.discardSetupDraft(teamId)
}

/** What a draft is held over: the saved queries and reads, and where setup keeps the draft. */
type DraftedThrough = Pick<Connecting, 'milestoneQueries' | 'reads'> & { setup: SetupStorage }

/**
 * Seam B: what the setup steps read and save with, `connecting` with its queries and their reads held in the team's
 * setup draft while setup is open: each step's picks, hand-written queries and reads are saved into the draft, and
 * read from it before the saved ones, so the steps show them while the forecast and the Inputs values keep the saved
 * ones until "Use these" (`submitSetup`). A read made in setup is the query's latest there, and the saved one, if any,
 * the read before it. Setup closed, it is `connecting` as it is.
 */
export function throughDraft<T extends DraftedThrough>(connecting: T): T {
  const { milestoneQueries: saved, reads: savedReads, setup } = connecting
  const open = (teamId: string): boolean => isOpen(setup, teamId)
  const draftOf = (teamId: string): SetupDraft | undefined => (open(teamId) ? setup.setupDraft(teamId) : undefined)
  const redraft = (teamId: string, change: (draft: SetupDraft) => SetupDraft): boolean => {
    if (!open(teamId)) return false
    setup.saveSetupDraft(teamId, change(setup.setupDraft(teamId) ?? NO_DRAFT))
    return true
  }
  const draftRead = ({ teamId, query }: { teamId: string; query: string }) => draftOf(teamId)?.reads.find((each) => each.query === query)?.read
  const milestoneQueries: MilestoneQueryStorage = {
    milestoneQuery: (teamId) => draftOf(teamId)?.milestoneQuery ?? saved.milestoneQuery(teamId),
    comparableWorkQuery: (teamId) => draftOf(teamId)?.comparableWorkQuery ?? saved.comparableWorkQuery(teamId),
    saveMilestoneQuery: (teamId, milestoneQuery) => {
      if (!redraft(teamId, (draft) => ({ ...draft, milestoneQuery }))) saved.saveMilestoneQuery(teamId, milestoneQuery)
    },
    saveComparableWorkQuery: (teamId, comparableWorkQuery) => {
      if (!redraft(teamId, (draft) => ({ ...draft, comparableWorkQuery }))) saved.saveComparableWorkQuery(teamId, comparableWorkQuery)
    },
  }
  const reads: SavedReadStorage = {
    savedRead: (teamQuery) => draftRead(teamQuery) ?? savedReads.savedRead(teamQuery),
    previousRead: (teamQuery) => (draftRead(teamQuery) ? savedReads.savedRead(teamQuery) : savedReads.previousRead(teamQuery)),
    saveRead: (teamQuery, read) => {
      const kept = redraft(teamQuery.teamId, (draft) => ({ ...draft, reads: [...draft.reads.filter((each) => each.query !== teamQuery.query), { query: teamQuery.query, read }] }))
      if (!kept) savedReads.saveRead(teamQuery, read)
    },
  }
  return { ...connecting, milestoneQueries, reads }
}
