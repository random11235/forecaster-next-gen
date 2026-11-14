import type { Connection } from '../model/connection.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { SetupStorage } from '../storage/storage.js'
import type { Failure } from '../connectors/connector.js'
import { teamConnection, type Connecting } from './connection.js'
import type { SavedRead } from '../model/savedRead.js'
import { finishedSinceFor, readQuery, weeksRead } from './finished.js'
import { chipsShow, kindName, LEAF_NOTE, readFlag, rejectionOf, type StepReading } from './queryStep.js'
import { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from './stepQuery.js'
import { readOn } from './trackerReads.js'
import { trackerOf, type TrackerFacts } from './trackers.js'

/** The setup steps, in order: connect a tracker, pick the milestone's tickets, pick comparable work, check what they give. */
export const SETUP_STEPS = ['connect', 'milestone', 'comparableWork', 'check'] as const

/** A setup step. */
export type SetupStep = (typeof SETUP_STEPS)[number]

/** What setup reads and saves: the team's connection and queries, the milestone query's read, how setup was closed, and the EM's time zone, which the read is dated in. */
export type SettingUp = Pick<Connecting, 'connections' | 'milestoneQueries' | 'reads'> & { setup: SetupStorage; timeZone: string }

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

/**
 * What is wrong with a query's saved read, and which query's it is; or, with no query named, why a read just asked for
 * failed as a whole, the saved reads staying in use. `change: 'connect'` offers Change, opening the Connect step, for a
 * token or repo the tracker refused.
 */
export interface SummaryFlag {
  of?: FlaggedQuery
  flag: string
  change?: 'connect'
}

/** Which query a summary flag is of: the milestone query, or comparable work's. */
export type FlaggedQuery = 'milestone' | 'comparable'

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
}

/** Closes setup with "Use these" (`useThese`), or by skipping connecting (`skipConnecting`); or opens its steps again (`change`). */
export type SetupEdit = { kind: 'useThese' } | { kind: 'skipConnecting' } | { kind: 'change' }

/** Whether setup changed: "Use these" is refused until the team is connected and its milestone has a query. */
export interface SetupSubmitted {
  saved: boolean
}

/**
 * Seam B: what the Inputs screen shows of the team's setup, at the step `asked` for (Milestone if none) while setting up.
 *
 * Done, and connected, it is the summary, reading nothing from the tracker. Skipped, and not connected, it is the
 * inputs typed. Otherwise the steps: Connect until the team is connected, and Milestone, asked for a later step, until
 * the milestone has a query.
 */
export function setupView(settingUp: SettingUp | undefined, teamId: string, asked?: string): SetupView {
  if (!settingUp) return { kind: 'noSetup' }
  const connection = settingUp.connections.connection(teamId)
  const closed = settingUp.setup.setupClosed(teamId)
  if (closed === 'done' && connection) return summaryOf(settingUp, teamId, connection)
  if (closed === 'skipped' && !connection) return { kind: 'skipped' }
  const picked = hasQuery(settingUp.milestoneQueries.milestoneQuery(teamId))
  const step: SetupStep = !connection ? 'connect' : asked === 'connect' || (picked && isLater(asked)) ? (asked as SetupStep) : 'milestone'
  const at = SETUP_STEPS.indexOf(step)
  const back = SETUP_STEPS[at - 1]
  const next = connection && nextOf(step, picked, hasQuery(settingUp.milestoneQueries.comparableWorkQuery(teamId)))
  return {
    kind: 'steps',
    step,
    steps: SETUP_STEPS.map((each, index) => ({ step: each, mark: index < at ? 'done' : index === at ? 'current' : 'ahead' })),
    ...(back && { back }),
    ...(next && { next }),
  }
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

/** What a read by hand reads and saves with: what a query step reads with, and the EM's time zone, which the summary is dated in. */
export type ReadingAgain = StepReading & { timeZone: string }

/**
 * A read by hand: made (`read`); nothing read, setup not being done (`unchanged`); or failed, a read or more, with the
 * summary saying why (`failed`), the saved read staying in use wherever one failed.
 */
export type ReadAgainSubmitted = { kind: 'read' } | { kind: 'unchanged' } | { kind: 'failed'; view: SetupSummary }

/**
 * Seam B: reads the milestone query again, and comparable work's when it has one, as at `readAt`, as far back as the
 * milestone's inputs need (`finishedSinceFor`); values following the tracker take each new read, typed ones stay as
 * typed. Read only once setup is done. A read that fails saves nothing, so its saved read stays in use, and the
 * summary to show says why: for the tracker unreachable or rate-limited, or the token or repo refused (offering
 * Change), once, reading no further; for a query the tracker now rejects or that reaches outside the connection, as
 * that query's flag, the other still read.
 */
export async function submitReadAgain(reading: ReadingAgain, teamId: string, readAt: string): Promise<ReadAgainSubmitted> {
  if (reading.setup.setupClosed(teamId) !== 'done') return { kind: 'unchanged' }
  const connected = await teamConnection(reading, teamId)
  if (!connected) return { kind: 'unchanged' }
  const { connection, connector } = connected
  const failed = (flags: SummaryFlag[]): ReadAgainSubmitted => ({ kind: 'failed', view: { ...summaryOf(reading, teamId, connection), flags } })
  if (connector === 'keychainFailed') return failed([{ flag: KEYCHAIN_UNUSED }])
  const finishedSince = finishedSinceFor(readAt, reading.milestoneInputs.milestoneInputs(teamId))
  const queries: [FlaggedQuery, string | undefined][] = [
    ['milestone', reading.milestoneQueries.milestoneQuery(teamId)?.query],
    ['comparable', reading.milestoneQueries.comparableWorkQuery(teamId)?.query],
  ]
  const flags: SummaryFlag[] = []
  for (const [of, query] of queries) {
    if (!query) continue
    const read = await readQuery(connector, reading.reads, { teamId, query, finishedSince, readAt })
    if (read.ok) continue
    const rejection = rejectionOf(connection, read)
    if (rejection === undefined) return failed([failedRead(connection, read)])
    flags.push({ of, flag: rejection })
  }
  return flags.length === 0 ? { kind: 'read' } : failed(flags)
}

/** Why a read by hand failed as a whole, the saved reads staying in use: the tracker unreachable or rate-limited, or the token or repo refused. */
function failedRead(connection: Connection, { failure }: Failure): SummaryFlag {
  const tracker = trackerOf(connection)
  switch (failure) {
    case 'unauthorised':
      return { flag: tracker.refused(connection), change: 'connect' }
    case 'notFound':
      return { flag: tracker.notFound(connection), change: 'connect' }
    default:
      return { flag: `${tracker.name} can’t be reached just now, or is limiting requests, so the last read stays in use. Try again in a few minutes.` }
  }
}

/** Why a read by hand read nothing, when this computer's keychain couldn't give the token. */
const KEYCHAIN_UNUSED = 'This computer’s keychain couldn’t be used, so nothing was read and the last read stays in use. Check it’s unlocked and that the Forecaster may use it, then try again.'

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
function flagOf(of: FlaggedQuery, read: SavedRead | undefined, trackerName: string, stepQuery: StepQuery): SummaryFlag[] {
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
 * Seam B: closes the team's setup, or opens its steps again, keeping its connection and queries either way.
 * "Use these" is refused, changing nothing, until the team is connected and its milestone has a query.
 */
export function submitSetup(settingUp: SettingUp, teamId: string, edit: SetupEdit): SetupSubmitted {
  switch (edit.kind) {
    case 'useThese':
      if (!settingUp.connections.connection(teamId) || !hasQuery(settingUp.milestoneQueries.milestoneQuery(teamId))) return { saved: false }
      settingUp.setup.closeSetup(teamId, 'done')
      return { saved: true }
    case 'skipConnecting':
      settingUp.setup.closeSetup(teamId, 'skipped')
      return { saved: true }
    case 'change':
      settingUp.setup.reopenSetup(teamId)
      return { saved: true }
  }
}
