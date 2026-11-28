import type { Choice, ChoiceKind } from '../../connectors/connector.js'
import type { Storage, TeamQueries } from '../../storage/storage.js'
import { narrowedToAFew, openCandidates, type CandidateOpening, type Candidates } from './candidates.js'
import { comparableWorkPace, type ComparableWorkPace } from './comparableWorkPace.js'
import { teamConnection, withTeamQueries, type Connecting } from './connection.js'
import { finishedSinceFor, readQuery, type QueryRead } from './queryRead.js'
import { MILESTONE_QUERY, type QueryName, type StepQuery } from './stepQuery.js'
import type { ReadClock } from './pace.js'
import { trackerOf, type TrackerFacts } from './trackers.js'
import { CHOICES_FAILED, foundInTracker, KEYCHAIN_FAILED, listedHere, markedThisMilestone, notPicked, type ChoiceList } from './choiceLists.js'
import { readFlag, readLine, rejectionOf } from './readSaid.js'
import { chipsShow, editedQuery, NO_QUERY, picksChanged, type PicksEdit } from './stepQueryEdit.js'

export type { ChoiceList } from './choiceLists.js'
export type { ComparableWorkPace } from './comparableWorkPace.js'

/** What the Milestone step says once, beside the milestone query: the only two things a read adds to it. */
export const LEAF_NOTE = 'Leaf tickets only. Epics include their sub-epics.'

/**
 * What a query step adds to its note while a label is among its picks (#416): the query matches a ticket only while it
 * has the label, so one the team takes off as the ticket moves through its workflow, or as it closes, loses the ticket
 * and its finish. A read can't tell a ticket that lost its label from one taken out of the milestone. Comparable work's
 * open tickets don't count, so for its query only the finish is lost.
 */
function labelNote(tracker: TrackerFacts, { kind }: StepQuery): string {
  const lost = kind === 'milestoneQuery' ? 'the ticket leaves tickets remaining, and its finish leaves pace' : 'its finish leaves pace'
  const lasting = tracker.lastingKinds.charAt(0).toUpperCase() + tracker.lastingKinds.slice(1)
  return `A label counts a ticket only while the ticket has it: taken off as the ticket moves on or closes, ${lost}. ${lasting} stays with a ticket until it’s finished.`
}

/** The note beside a query step's query: the leaf note, and the label note while a label is picked. */
function noteFor(tracker: TrackerFacts, stepQuery: StepQuery, picks: Choice[]): string {
  return picks.some((pick) => pick.kind === 'label') ? `${LEAF_NOTE} ${labelNote(tracker, stepQuery)}` : LEAF_NOTE
}

/**
 * What a query step shows, in the local server build once connected: the choices to pick from, by kind; the picks, as
 * chips; the query they make, always shown, with `note` beside it; and the query's read. The Milestone step shows no
 * more (`MilestoneStep`); the Comparable work step adds its main button, its pace and its candidates
 * (`ComparableWorkStep`).
 */
export type QueryStep = MilestoneStep | ComparableWorkStep

/** The Milestone step, editing the milestone query (`MILESTONE_QUERY`). */
export interface MilestoneStep extends PickedQuery {
  kind: 'milestoneStep'
}

/**
 * The Comparable work step, editing comparable work's query (`COMPARABLE_WORK`): optional, its open tickets ignored,
 * leading with the pace in use, and listing its choices as candidates to read.
 */
export interface ComparableWorkStep extends PickedQuery {
  kind: 'comparableWorkStep'
  /**
   * The pace it leads with (#204), from the saved reads alone, asking the tracker nothing; none until there is one.
   * Its `flag`, that comparable work's query isn't used, goes beside the read when the step has none of its own.
   */
  pace?: ComparableWorkPace
  /** Its candidates (#205), while it is finding choices to pick; none while its query is open for editing. */
  candidates?: StepCandidates
}

/**
 * The candidates a Comparable work step shows: those read so far in its `opening`, which the page keeps for its script
 * to read more in. Those read as the step opens are the ones the EM opened (`QueryStepOpening.opened`) among its
 * lists, and those its find box narrows them to when they are a few (`narrowedToAFew`).
 */
export interface StepCandidates {
  opening: CandidateOpening
  shown: Candidates
}

/** What both query steps show of the query they edit. */
interface PickedQuery {
  /** The query as the step labels it: "Milestone query", "Comparable-work query". */
  queryName: QueryName
  /** What the EM typed to find a choice by. */
  find: string
  lists: ChoiceList[]
  /** Why the choices couldn't be listed; none when they were. */
  choicesFailure?: string
  picks: Choice[]
  /** The query: the picks joined with OR, or as edited by hand; empty until something is picked. */
  query: string
  note: string
  /**
   * The query's last read, as one line: "50 open · 43 finished in the last 8 weeks", or for comparable work's, whose
   * open tickets don't count, "43 finished in the last 8 weeks"; none until it is read, nor when that read is
   * incomplete, as part of a count would pass for the count.
   */
  read?: string
  /** What is wrong with that read: it matched nothing, beside its line; or is incomplete, in its place. None when it is fine. */
  flag?: string
  /**
   * Why the query a change of the picks just joined into was refused, in the tracker's words, shown beside the chips
   * while the EM stays finding: the last query that worked, and its chips, stay in use. None until one is.
   */
  refusal?: string
  /**
   * The query open for editing by hand, in place of finding choices to pick: when the EM asks to edit it as a query,
   * or when the picker can't show it as chips. None while finding.
   */
  editing?: QueryEditing
}

/** The milestone query open for editing by hand. */
export interface QueryEditing {
  /** The query in the box: the milestone query, or as typed when refused. */
  typed: string
  /** The connected repo or Jira project, which the query reads within. */
  readIn: string
  /** Why the query just submitted was refused, before reading it; none until one is. */
  refusal?: string
  /** That going back to finding clears the query, when the picker can't show it; none when it can, as chips. */
  backClears?: string
  /** The EM asked to go back to finding, which clears this query: asked to confirm it first. Never when the picker can show the query. */
  confirmingBack?: true
}

/** A query step; none in the browser build, nor before the team connects (`noQueryStep`). */
export type QueryStepView = { kind: 'noQueryStep' } | QueryStep

/**
 * How a query step opens: on finding (the default), or with its query open for editing; also open for editing, with
 * the query as typed and why, once a hand-edited query is `refused`, but still finding, with why beside the chips, once
 * the query a change of the picks joined into is; and `confirmingBack`, asking the EM to confirm going back to finding
 * from a query that it clears. `unlisted`, it asks the tracker nothing and lists no choices: for a reply whose steps
 * are counted among the screen's sections but not shown. `opened`, the Comparable work step reads, as candidates, the
 * choices in its lists with these queries.
 */
export interface QueryStepOpening {
  editing?: boolean
  refused?: RefusedQuery
  confirmingBack?: boolean
  unlisted?: boolean
  opened?: readonly string[]
}

/**
 * What a query step reads with, in the local server build: what it connects with, and the milestone's inputs, whose
 * cadence and skipped periods set how far back a read reaches (`finishedSinceFor`).
 */
export interface StepReading extends Connecting {
  milestoneInputs: Pick<Storage, 'milestoneInputs'>
}

/**
 * What a query step opens with: what it reads with, the milestone's inputs also laying out the Comparable work step's
 * pace and candidates, and when it opens (`at`): the instant its candidates are read at, and today in the EM's time
 * zone, which each finish is counted on its calendar day in.
 */
export interface QueryStepping extends StepReading {
  at: ReadClock
}

/** What the step says, editing a query the picker can't show, of going back to finding. */
export const BACK_CLEARS = 'The picker can’t show this query, so going back to finding clears it.'

/**
 * Seam B: the team's query step, opened, whole: the Milestone step for the milestone query (`stepQuery` unless given),
 * the Comparable work step for comparable work's. The choices are asked for once, here, and kept nowhere, so each
 * opening lists them afresh. Each list holds the choices whose name holds `find`, ignoring case, less those already
 * picked. The query is open for editing when `opening` asks, or when the picker can't show it. The Comparable work
 * step also leads with its pace (`comparableWorkPace`), and, while finding, opens its candidates (`openCandidates`),
 * reading those `opening` names and those `find` narrows its lists to.
 */
export async function queryStepView(
  stepping: QueryStepping | undefined,
  teamId: string,
  find = '',
  opening: QueryStepOpening = {},
  stepQuery: StepQuery = MILESTONE_QUERY,
): Promise<QueryStepView> {
  const current = stepping && withTeamQueries(stepping, 'current')
  const picked = current && (await pickedQuery(current, teamId, find, opening, stepQuery))
  if (!current || !picked) return { kind: 'noQueryStep' }
  if (stepQuery.kind === 'milestoneQuery') return { kind: 'milestoneStep', ...picked }
  return comparableWorkStep(current, teamId, picked, opening)
}

/**
 * The Comparable work step: what it shows of its query (`picked`), with its main button, its pace and, while finding,
 * its candidates.
 */
async function comparableWorkStep(
  stepping: QueryStepping & TeamQueries,
  teamId: string,
  picked: PickedQuery,
  { opened = [] }: QueryStepOpening,
): Promise<ComparableWorkStep> {
  const { milestoneInputs, at } = stepping
  const pace = comparableWorkPace(stepping, milestoneInputs.milestoneInputs(teamId), teamId, at)
  const step: ComparableWorkStep = { kind: 'comparableWorkStep', ...picked, ...(pace && { pace }) }
  if (picked.editing) return step
  const opening = openCandidates(stepping, milestoneInputs, teamId, at)
  const listed = picked.lists.flatMap((list) => list.choices)
  const openedListed = opened.flatMap((query) => listed.filter((choice) => choice.query === query))
  const shown = await opening.read([...openedListed, ...narrowedToAFew(picked.lists, picked.find)])
  return { ...step, candidates: { opening, shown } }
}

/** What a query step shows of the query it edits (`stepQuery`); none before the team connects. */
async function pickedQuery(
  connecting: Connecting & TeamQueries,
  teamId: string,
  find: string,
  opening: QueryStepOpening,
  stepQuery: StepQuery,
): Promise<PickedQuery | undefined> {
  const connected = await teamConnection(connecting, teamId)
  if (!connected) return undefined
  const { connection, connector } = connected
  const tracker = trackerOf(connection)
  const saved = stepQuery.saved(connecting.milestoneQueries, teamId) ?? NO_QUERY
  const read = saved.query === '' ? undefined : connecting.reads.savedRead({ teamId, query: saved.query })
  const shownAsChips = chipsShow(tracker, saved)
  const refused = opening.refused?.fromPicks ? undefined : opening.refused
  const editing: QueryEditing | undefined =
    opening.editing || refused || !shownAsChips
      ? {
          typed: refused?.query ?? saved.query,
          readIn: tracker.where(connection),
          ...(refused && { refusal: refused.refusal }),
          ...(!shownAsChips && { backClears: BACK_CLEARS }),
          ...(!shownAsChips && opening.confirmingBack && { confirmingBack: true }),
        }
      : undefined
  const step: PickedQuery = {
    queryName: stepQuery.name,
    find,
    lists: [],
    picks: saved.picks,
    query: saved.query,
    note: noteFor(tracker, stepQuery, saved.picks),
    ...(read && !read.incomplete && { read: readLine(read, stepQuery) }),
    ...(read && readFlag(read, tracker.name, stepQuery)),
    ...(!editing && opening.refused?.fromPicks && { refusal: opening.refused.refusal }),
    ...(editing && { editing }),
  }
  if (opening.unlisted) return step
  if (connector === 'keychainFailed') return { ...step, choicesFailure: KEYCHAIN_FAILED }
  const choices = await connector.milestoneChoices()
  if (!choices.ok) return { ...step, choicesFailure: CHOICES_FAILED }
  const typed = find.trim()
  const unpicked = notPicked(saved.picks)
  const marked = markedThisMilestone(connecting.milestoneQueries, teamId)
  const lists: ChoiceList[] = []
  // A kind past the limit is searched once something is typed, one kind after another, to spare the rate limit.
  for (const kind of choices.kinds) {
    lists.push(marked(kind.pastLimit && typed !== '' ? await foundInTracker(connector, kind.kind, typed, unpicked) : listedHere(kind, typed, unpicked)))
  }
  return { ...step, lists }
}

/**
 * Seam B: one kind past the limit, searched in the tracker for `find`, as the Milestone step's picker asks for it while
 * the EM types: the choices the tracker finds, less those already picked. With nothing typed (the find box cleared), it
 * is the first 100 the tracker lists, searching nothing. None before the team connects. Picked means picked for
 * `stepQuery`, the milestone query unless given.
 */
export async function searchedChoiceList(
  connecting: Connecting,
  teamId: string,
  kind: ChoiceKind,
  find: string,
  stepQuery: StepQuery = MILESTONE_QUERY,
): Promise<ChoiceList | undefined> {
  const { milestoneQueries } = withTeamQueries(connecting, 'current')
  const connected = await teamConnection(connecting, teamId)
  if (!connected) return undefined
  if (connected.connector === 'keychainFailed') return { kind, choices: [], searchedInTracker: true, failure: KEYCHAIN_FAILED }
  const unpicked = notPicked(stepQuery.saved(milestoneQueries, teamId)?.picks ?? [])
  const marked = markedThisMilestone(milestoneQueries, teamId)
  const typed = find.trim()
  if (typed !== '') return marked(await foundInTracker(connected.connector, kind, typed, unpicked))
  const choices = await connected.connector.milestoneChoices()
  if (!choices.ok) return { kind, choices: [], searchedInTracker: true, failure: CHOICES_FAILED }
  const listed = choices.kinds.find((each) => each.kind === kind)
  return listed ? marked(listedHere(listed, '', unpicked)) : { kind, choices: [], searchedInTracker: true }
}

/**
 * A query step's submits: add a choice as a pick, or remove the pick with this query (`PicksEdit`); edit its query
 * by hand, as typed; go back to finding, which clears the query when the picker can't show it,
 * once the EM has `confirmed` that; or, in the Comparable work step, start afresh, clearing the picks and query at once.
 */
export type StepQueryEdit = PicksEdit | { kind: 'editQuery'; query: string } | { kind: 'backToFinding'; confirmed: boolean } | { kind: 'startAfresh' }

/**
 * Seam B: changes the milestone query and saves it, then reads it once, as at `readAt`, open tickets and those
 * finished as far back as the milestone's cadence and skipped periods need (`finishedSinceFor`). A change of the picks saves them with the query they join into (with
 * OR, in the order picked); a query edited by hand is saved as written. A change that changes nothing (a pick already
 * picked, a removal of none, the query as it was) saves and reads nothing; nor does an empty query read anything.
 * Before any of that, a hand-edited query with free text or an empty qualifier is refused, changing nothing. The
 * query is saved only once read, unless its read says it is wrong: the tracker rejecting it, or it reaching outside
 * the connection, refuses it, and the last query that worked stays in use, with its saved read. Going back to finding
 * from a query the picker can't show changes nothing until confirmed. Starting afresh clears the picks and query
 * together, reading nothing. The query changed is `stepQuery`, the milestone query unless given. The query and its
 * reads are the `current` ones, so while setup is open they are saved into its draft, as each step entry point reads
 * and saves.
 */
export async function submitStepQuery(
  connecting: StepReading,
  teamId: string,
  edit: StepQueryEdit,
  readAt: string,
  stepQuery: StepQuery = MILESTONE_QUERY,
): Promise<StepQuerySubmitted> {
  return changeStepQuery(withTeamQueries(connecting, 'current'), teamId, edit, readAt, stepQuery)
}

/**
 * `submitStepQuery`'s change, made on the queries and reads `connecting` gives, in whichever target: `saved` too, for
 * a change the forecast follows at once (`followRenamedMilestone`).
 */
export async function changeStepQuery(
  connecting: StepReading & TeamQueries,
  teamId: string,
  edit: StepQueryEdit,
  readAt: string,
  stepQuery: StepQuery = MILESTONE_QUERY,
): Promise<StepQuerySubmitted> {
  const connected = await teamConnection(connecting, teamId)
  if (!connected) return { kind: 'unchanged' }
  const { connection, connector } = connected
  const tracker = trackerOf(connection)
  if (edit.kind === 'editQuery') {
    const refusal = tracker.queryRefusal(edit.query)
    if (refusal) return { kind: 'refused', query: edit.query, refusal }
  }
  const before = stepQuery.saved(connecting.milestoneQueries, teamId) ?? NO_QUERY
  const clears = edit.kind === 'backToFinding' && !chipsShow(tracker, before)
  if (clears && !edit.confirmed) return { kind: 'confirmClear' }
  const after =
    edit.kind === 'editQuery'
      ? await editedQuery(tracker, before, edit.query, connector)
      : edit.kind === 'backToFinding'
        ? clears
          ? NO_QUERY
          : before
        : edit.kind === 'startAfresh'
          ? before.query === '' && before.picks.length === 0
            ? before
            : NO_QUERY
          : picksChanged(before, edit)
  if (after === before) return { kind: 'unchanged' }
  const save = (): void => stepQuery.save(connecting.milestoneQueries, teamId, after)
  if (after.query === '' || connector === 'keychainFailed') {
    save()
    return { kind: 'saved' }
  }
  const finishedSince = finishedSinceFor(readAt, connecting.milestoneInputs.milestoneInputs(teamId))
  const read = await readQuery(connector, connecting.reads, { teamId, query: after.query, finishedSince, readAt })
  const rejection = read.ok ? undefined : rejectionOf(connection, read)
  if (rejection) return { kind: 'refused', query: after.query, refusal: rejection, ...(edit.kind !== 'editQuery' && { fromPicks: true as const }) }
  save()
  // one pick's read is the query's; a pick's own read failing leaves its chip without its pace, and nothing else
  if (stepQuery.kind === 'comparableWork' && after.picks.length > 1 && chipsShow(tracker, after)) {
    for (const pick of after.picks) await readQuery(connector, connecting.reads, { teamId, query: pick.query, finishedSince, readAt })
  }
  return { kind: 'saved', read }
}

/**
 * What a submit did: saved the milestone query, with its read when one was made (none for an empty query, or when the
 * keychain failed); changed nothing (also before the team connects); refused the query, keeping the last one in
 * use: a hand-edited query before reading it, or any query the tracker rejected or that reaches outside the connection;
 * or changed nothing yet, as going back to finding would clear the query, which the EM is to confirm (`confirmClear`).
 */
export type StepQuerySubmitted = { kind: 'saved'; read?: QueryRead } | { kind: 'unchanged' } | ({ kind: 'refused' } & RefusedQuery) | { kind: 'confirmClear' }

/** A query refused: as typed, or as the picks joined into (`fromPicks`), and why. */
export interface RefusedQuery {
  query: string
  refusal: string
  /** The query a change of the picks joined into, not one edited by hand: the EM stays finding, with the chips. */
  fromPicks?: true
}
