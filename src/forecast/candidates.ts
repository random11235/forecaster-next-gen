import type { Choice, Failure } from '../connectors/connector.js'
import type { Connection } from '../model/connection.js'
import type { SavedRead } from '../model/savedRead.js'
import type { SavedReadStorage, Storage } from '../storage/storage.js'
import { periodName, type PeriodName } from './cadence.js'
import { teamConnection, type Connecting } from './connection.js'
import { calendarDayIn, completeRead, finishedPerPeriod, finishedSinceFor, ticketsRemaining } from './finished.js'
import type { ChoiceList } from './queryStep.js'
import { paceReads, paceReadsStorage, wholePeriods } from './paceReads.js'
import type { DatedCounts } from './paceWindow.js'
import { medianOf, paceVersusMilestoneOwn, type PaceVersus } from './paceVersusOwn.js'
import { trackerOf } from './trackers.js'

/**
 * Candidates for comparable work (#205): the Comparable work step's choices, each read on demand, so a repo with
 * hundreds of labels and epics doesn't spend the tracker's rate limit. The step lists them without data; a candidate
 * is read when the EM opens it, or narrows the list to a few by typing, and its read lasts for the opening of the step.
 */

/** The most candidates the EM's typing narrows the list to that are read at once. */
export const FEW_CANDIDATES = 5

/** The most periods a candidate's strip shows. */
export const STRIP_PERIODS = 8

/** A candidate's read: what the EM weighs it by. */
export interface CandidateRead {
  /** Its finished tickets in each of the last periods the read reaches whole, up to `STRIP_PERIODS`, oldest first. */
  strip: DatedCounts
  /** Its median finished a period, over the strip. */
  median: number
  /** How that median compares with the milestone's own. */
  versus: PaceVersus
  /** Its tickets finished in the weeks the read reaches back (`FINISHED_WEEKS`). */
  finished: number
  /** Of those, how many comparable work's read doesn't already count; none until comparable work is read. */
  adds?: number
  /** The calendar day it last finished one, in the EM's time zone; none when it finished none. */
  lastFinished?: string
  /** Its open tickets now. */
  open: number
}

/** A candidate for comparable work: its choice, whether it is the milestone itself, and its read or why it failed. */
export type Candidate = { choice: Choice; thisMilestone: boolean } & ({ read: CandidateRead } | { failure: string })

/**
 * Which group a candidate falls in: slower than the milestone, about the same, or faster; when the milestone has too
 * few periods of its own to compare, by median; then nothing finished; then those whose read failed.
 */
export type CandidateGroupKind = 'slower' | 'aboutTheSame' | 'faster' | 'byMedian' | 'nothingFinished' | 'readFailed'

/** One group, its candidates slowest first. */
export interface CandidateGroup {
  group: CandidateGroupKind
  candidates: Candidate[]
}

/** The candidates read so far in an opening, grouped; groups with none are left out. */
export interface Candidates {
  /** The milestone's own median a period since its start date; none when it has too few periods to compare. */
  milestoneOwn?: number
  groups: CandidateGroup[]
  /** What each strip counts by: the milestone's cadence, a week before it has one. */
  period: PeriodName
}

/** One opening of the Comparable work step's candidates, which reads each at most once. */
export interface CandidateOpening {
  /** Reads those of `choices` not yet read in this opening, and gives every candidate read in it, grouped. */
  read(choices: readonly Choice[]): Promise<Candidates>
}

/** When the candidates are read: the UTC instant, today, and the EM's time zone (an IANA name). */
export interface CandidatesAt {
  readAt: string
  today: string
  timeZone: string
}

/**
 * Seam B: opens the team's candidates for comparable work, reading none yet. Each is read through the connector once,
 * as the comparable-work query is, back `FINISHED_WEEKS` weeks, and kept only by this opening, never saved. Its
 * periods are laid on the milestone's cadence from its start date (from today before it has one).
 */
export function openCandidates(
  connecting: Connecting,
  storage: Pick<Storage, 'milestoneInputs'>,
  teamId: string,
  at: CandidatesAt,
): CandidateOpening {
  const stored = paceReadsStorage(storage, connecting)
  const read = new Map<string, Promise<Candidate>>()
  let connected: ReturnType<typeof teamConnection> | undefined
  const own = paceReads(stored, teamId, at)
  const ownCounts = own?.milestone?.counts.slice(own.beforeStart) ?? []
  const milestoneQuery = stored.milestoneQuery(teamId)?.query
  const picked = finishedIds(stored, teamId, stored.comparableWorkQuery(teamId)?.query)
  const inputs = storage.milestoneInputs(teamId)
  const laid = { startDate: inputs?.startDate ?? at.today, cadenceDays: inputs?.cadenceDays ?? 7 }
  const candidate = async (choice: Choice): Promise<Candidate> => {
    const marked = { choice, thisMilestone: choice.query === milestoneQuery }
    const team = await (connected ??= teamConnection(connecting, teamId))
    if (!team) return { ...marked, failure: NOT_CONNECTED }
    if (team.connector === 'keychainFailed') return { ...marked, failure: KEYCHAIN_FAILED }
    const result = await team.connector.read(choice.query, finishedSinceFor(at.readAt))
    if (!result.ok) return { ...marked, failure: failureOf(team.connection, result) }
    if (result.incomplete) return { ...marked, failure: `${trackerOf(team.connection).name} gave only part of what it matches, so it isn’t counted.` }
    const byId = new Map(result.tickets.map((ticket) => [ticket.id, ticket]))
    return { ...marked, read: candidateRead({ tickets: [...byId.values()], incomplete: false, readAt: at.readAt }, ownCounts, picked, laid, at) }
  }
  return {
    async read(choices) {
      for (const choice of choices) if (!read.has(choice.query)) read.set(choice.query, candidate(choice))
      return grouped(await Promise.all(read.values()), ownCounts, periodName(laid.cadenceDays))
    },
  }
}

/**
 * The choices the EM's typing (`find`) narrows the step's lists to, when they are a few (`FEW_CANDIDATES` or fewer):
 * those to read. None while nothing is typed, or more than a few are left.
 */
export function narrowedToAFew(lists: readonly ChoiceList[], find: string): Choice[] {
  const choices = lists.flatMap((list) => list.choices)
  return find.trim() === '' || choices.length > FEW_CANDIDATES ? [] : choices
}

const NOT_CONNECTED = 'The team isn’t connected to a tracker, so it can’t be read.'

const KEYCHAIN_FAILED = 'This computer’s keychain couldn’t give the token, so it can’t be read. Check it’s unlocked, then open it again.'

/** Why a candidate's read failed, worded for the step. */
function failureOf(connection: Connection, failure: Failure): string {
  const tracker = trackerOf(connection)
  switch (failure.failure) {
    case 'invalidQuery':
      return `${tracker.name} rejected its query: ${failure.message}`
    case 'outOfScope':
      return tracker.outOfScope(connection)
    case 'unavailable':
      return `${tracker.name} couldn’t read it just now. Open it again in a few minutes.`
    case 'notFound':
    case 'unauthorised':
      return `${tracker.name} refused to read it. Check the connection.`
  }
}

/** The finished tickets' ids in the query's saved read, when it has a complete one. */
function finishedIds(reads: Pick<SavedReadStorage, 'savedRead'>, teamId: string, query: string | undefined): Set<string> | undefined {
  const read = completeRead(reads, teamId, query)
  return read && new Set(read.tickets.filter((ticket) => ticket.finishedAt !== undefined).map((ticket) => ticket.id))
}

function candidateRead(
  read: SavedRead,
  ownCounts: readonly number[],
  picked: Set<string> | undefined,
  { startDate, cadenceDays }: { startDate: string; cadenceDays: number },
  { today, timeZone }: CandidatesAt,
): CandidateRead {
  const periods = Math.min(STRIP_PERIODS, wholePeriods([read], { startDate, cadenceDays, today, timeZone }).periods)
  const strip = finishedPerPeriod(read, { startDate, cadenceDays, today, timeZone, periods })
  const median = strip.counts.length === 0 ? 0 : medianOf(strip.counts)
  const finished = read.tickets.filter((ticket) => ticket.finishedAt !== undefined)
  const last = finished.map((ticket) => ticket.finishedAt!).sort().at(-1)
  return {
    strip,
    median,
    versus: paceVersusMilestoneOwn(median, ownCounts),
    finished: finished.length,
    ...(picked && { adds: finished.filter((ticket) => !picked.has(ticket.id)).length }),
    ...(last !== undefined && { lastFinished: calendarDayIn(timeZone)(last) }),
    open: ticketsRemaining(read),
  }
}

/** The order groups are shown in. */
const GROUP_ORDER: readonly CandidateGroupKind[] = ['slower', 'aboutTheSame', 'faster', 'byMedian', 'nothingFinished', 'readFailed']

/** The candidates, grouped, each group slowest first and then by name. */
function grouped(candidates: Candidate[], ownCounts: readonly number[], period: PeriodName): Candidates {
  const comparing = paceVersusMilestoneOwn(0, ownCounts).kind !== 'tooFewToCompare'
  const groupOf = (candidate: Candidate): CandidateGroupKind => {
    if (!('read' in candidate)) return 'readFailed'
    if (candidate.read.finished === 0) return 'nothingFinished'
    const { kind } = candidate.read.versus
    return kind === 'tooFewToCompare' ? 'byMedian' : kind
  }
  const median = (candidate: Candidate): number => ('read' in candidate ? candidate.read.median : 0)
  const groups = GROUP_ORDER.map((group) => ({
    group,
    candidates: candidates
      .filter((candidate) => groupOf(candidate) === group)
      .sort((a, b) => median(a) - median(b) || a.choice.name.localeCompare(b.choice.name)),
  })).filter(({ candidates }) => candidates.length > 0)
  return { ...(comparing && { milestoneOwn: medianOf(ownCounts) }), groups, period }
}
