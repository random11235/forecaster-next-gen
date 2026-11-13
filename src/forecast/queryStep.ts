import type { Choice, ChoiceKind, ChoicesOfKind, Connector, Failure } from '../connectors/connector.js'
import type { Connection } from '../model/connection.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { SavedRead } from '../model/savedRead.js'
import type { MilestoneQueryStorage } from '../storage/storage.js'
import { teamConnection, type Connecting } from './connection.js'
import { FINISHED_WEEKS, finishedSinceFor, readQuery, ticketsRemaining, type QueryRead } from './finished.js'
import { trackerOf, type TrackerFacts } from './trackers.js'

/**
 * Which of the team's queries a step edits, picked or written by hand the same way: the milestone query
 * (`MILESTONE_QUERY`), or comparable work's (`COMPARABLE_WORK`, #158). It says how the step names the query, whether
 * the step can be skipped, what of its read counts, and where its picks and query are kept.
 */
export interface StepQuery {
  /** The query as the step labels it: "Milestone query". */
  name: string
  /** What the query is to pick out, as the step says when it matches nothing: "the milestone’s tickets". */
  picksOut: string
  /** The step can be left with no query: its main button reads Skip until something is added, then Next. */
  optional: boolean
  /** Its read's open tickets count, as tickets remaining; comparable work's are ignored, only its finished ones count. */
  countsOpen: boolean
  /**
   * Each of several picks is read too, whenever the query is, so the step can show what each brings: comparable work's
   * chips each show their own pace.
   */
  readsEachPick: boolean
  /** The team's picks and query, if the EM has picked or written one. */
  saved(storage: MilestoneQueryStorage, teamId: string): MilestoneQuery | undefined
  /** Saves the team's picks and query, replacing both. */
  save(storage: MilestoneQueryStorage, teamId: string, query: MilestoneQuery): void
}

/** The milestone query, which picks out the milestone's tickets: what the Milestone step edits. */
export const MILESTONE_QUERY: StepQuery = {
  name: 'Milestone query',
  picksOut: 'the milestone’s tickets',
  optional: false,
  countsOpen: true,
  readsEachPick: false,
  saved: (storage, teamId) => storage.milestoneQuery(teamId),
  save: (storage, teamId, query) => storage.saveMilestoneQuery(teamId, query),
}

/**
 * Comparable work's query, which picks out recent work like the milestone's to measure its pace from: what the
 * Comparable work step edits. It is optional, and only its finished tickets count. Kept apart from the milestone query,
 * it carries over to the next milestone: nothing but the EM changes or clears it.
 */
export const COMPARABLE_WORK: StepQuery = {
  name: 'Comparable-work query',
  picksOut: 'work like the milestone’s',
  optional: true,
  countsOpen: false,
  readsEachPick: true,
  saved: (storage, teamId) => storage.comparableWorkQuery(teamId),
  save: (storage, teamId, query) => storage.saveComparableWorkQuery(teamId, query),
}

/** What the Milestone step says once, beside the milestone query: the only two things a read adds to it. */
export const LEAF_NOTE = 'Leaf tickets only. Epics include their sub-epics.'

/** Each kind of choice as the screens name it, by the kind connectors give it. */
const KIND_NAMES: Readonly<Record<ChoiceKind, string>> = { milestone: 'milestone', fixVersion: 'fix version', epic: 'epic', label: 'label' }

/** A kind of choice as the screens name it: a chip is marked with it, and a list headed by it. */
export function kindName(kind: ChoiceKind): string {
  return KIND_NAMES[kind]
}

/**
 * One kind's choices, as the picker lists them: those matching what is typed, less those already picked. A kind
 * `searchedInTracker` has more than the tracker lists, so once something is typed it is searched in the tracker, not
 * filtered here; the tracker's search may match whole words only.
 */
export interface ChoiceList {
  kind: ChoiceKind
  choices: Choice[]
  searchedInTracker: boolean
  /**
   * The query of its choice that is the milestone query, when the milestone query is that one choice: marked "this
   * milestone" in the Comparable work step's lists, as a candidate is, without reading it. None when no choice listed is.
   */
  thisMilestone?: string
  /** Why the tracker couldn't search this kind; none when it could. */
  failure?: string
}

/**
 * What the Milestone step shows, in the local server build once connected: the choices to pick from, by kind; the
 * picks, as chips; the milestone query they make, always shown, with `note` beside it; and the query's read.
 */
export interface QueryStep {
  kind: 'queryStep'
  /** What the EM typed to find a choice by. */
  find: string
  lists: ChoiceList[]
  /** Why the choices couldn't be listed; none when they were. */
  choicesFailure?: string
  picks: Choice[]
  /** The milestone query: the picks joined with OR, or as edited by hand; empty until something is picked. */
  query: string
  note: string
  /**
   * The query's last read, as one line: "50 open · 43 finished in the last 8 weeks", or for a query whose open tickets
   * don't count, "43 finished in the last 8 weeks"; none until it is read, nor when that read is incomplete, as part
   * of a count would pass for the count.
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
   * The milestone query open for editing by hand, in place of finding choices to pick: when the EM asks to edit it as
   * a query, or when the picker can't show it as chips. None while finding.
   */
  editing?: QueryEditing
  /** An optional step's main button: `skip` until something is added, then `next`. None for a step that isn't optional. */
  onward?: 'skip' | 'next'
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

/** The Milestone step; none in the browser build, nor before the team connects (`noQueryStep`). */
export type QueryStepView = { kind: 'noQueryStep' } | QueryStep

/**
 * How the Milestone step opens: on finding (the default), or with the milestone query open for editing; also open for
 * editing, with the query as typed and why, once a hand-edited query is `refused`, but still finding, with why beside
 * the chips, once the query a change of the picks joined into is; and `confirmingBack`, asking the EM
 * to confirm going back to finding from a query that it clears. `unlisted`, it asks the tracker nothing and lists no
 * choices: for a reply whose Milestone step is counted among the screen's sections but not shown.
 */
export interface QueryStepOpening {
  editing?: boolean
  refused?: RefusedQuery
  confirmingBack?: boolean
  unlisted?: boolean
}

/** What the step says, editing a query the picker can't show, of going back to finding. */
export const BACK_CLEARS = 'The picker can’t show this query, so going back to finding clears it.'

/**
 * Seam B: the team's Milestone step, opened: the choices are asked for once, here, and kept nowhere, so each opening
 * lists them afresh. Each list holds the choices whose name holds `find`, ignoring case, less those already picked.
 * The milestone query is open for editing when `opening` asks, or when the picker can't show it. The step edits
 * `stepQuery`, the milestone query unless given.
 */
export async function queryStepView(
  connecting: Connecting | undefined,
  teamId: string,
  find = '',
  opening: QueryStepOpening = {},
  stepQuery: StepQuery = MILESTONE_QUERY,
): Promise<QueryStepView> {
  const connected = connecting && (await teamConnection(connecting, teamId))
  if (!connected) return { kind: 'noQueryStep' }
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
  const step: QueryStep = {
    kind: 'queryStep',
    find,
    lists: [],
    picks: saved.picks,
    query: saved.query,
    note: LEAF_NOTE,
    ...(read && !read.incomplete && { read: readLine(read, stepQuery) }),
    ...(read && readFlag(read, tracker.name, stepQuery)),
    ...(!editing && opening.refused?.fromPicks && { refusal: opening.refused.refusal }),
    ...(editing && { editing }),
    ...(stepQuery.optional && { onward: saved.query === '' ? 'skip' : 'next' }),
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

/** One kind's list as the tracker listed it, filtered here by what is `typed` and less the choices not `unpicked`. */
function listedHere({ kind, choices, pastLimit }: ChoicesOfKind, typed: string, unpicked: (choice: Choice) => boolean): ChoiceList {
  const matching = choices.filter((choice) => unpicked(choice) && choice.name.toLowerCase().includes(typed.toLowerCase()))
  return { kind, choices: matching, searchedInTracker: pastLimit }
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
  const connected = await teamConnection(connecting, teamId)
  if (!connected) return undefined
  if (connected.connector === 'keychainFailed') return { kind, choices: [], searchedInTracker: true, failure: KEYCHAIN_FAILED }
  const unpicked = notPicked(stepQuery.saved(connecting.milestoneQueries, teamId)?.picks ?? [])
  const marked = markedThisMilestone(connecting.milestoneQueries, teamId)
  const typed = find.trim()
  if (typed !== '') return marked(await foundInTracker(connected.connector, kind, typed, unpicked))
  const choices = await connected.connector.milestoneChoices()
  if (!choices.ok) return { kind, choices: [], searchedInTracker: true, failure: CHOICES_FAILED }
  const listed = choices.kinds.find((each) => each.kind === kind)
  return listed ? marked(listedHere(listed, '', unpicked)) : { kind, choices: [], searchedInTracker: true }
}

/**
 * A list, with the choice in it whose query is the milestone query marked (`thisMilestone`). The Milestone step never
 * lists it, as it is picked there.
 */
function markedThisMilestone(queries: MilestoneQueryStorage, teamId: string): (list: ChoiceList) => ChoiceList {
  const milestoneQuery = queries.milestoneQuery(teamId)?.query
  return (list) => (list.choices.some((choice) => choice.query === milestoneQuery) ? { ...list, thisMilestone: milestoneQuery! } : list)
}

/** Whether a choice is none of `picks`. */
function notPicked(picks: Choice[]): (choice: Choice) => boolean {
  const picked = new Set(picks.map((pick) => pick.query))
  return (choice) => !picked.has(choice.query)
}

/** One kind's list as the tracker's search finds it for `typed`, less the choices not `unpicked`; or why it couldn't search. */
async function foundInTracker(connector: Connector, kind: ChoiceKind, typed: string, unpicked: (choice: Choice) => boolean): Promise<ChoiceList> {
  const found = await connector.searchChoices(kind, typed)
  if (!found.ok) {
    return { kind, choices: [], searchedInTracker: true, failure: `The tracker couldn’t search its ${kindName(kind)}s just now. Try again in a few minutes.` }
  }
  return { kind, choices: found.choices.filter(unpicked), searchedInTracker: true }
}

const KEYCHAIN_FAILED = 'This computer’s keychain couldn’t give the token, so nothing can be listed. Check it’s unlocked, then open the step again.'

const CHOICES_FAILED = 'The tracker couldn’t list what to pick from just now. Open the step again in a few minutes.'

/** A read's line: its open tickets, when they count, and those finished in the weeks it reads back. */
function readLine(read: SavedRead, { countsOpen }: StepQuery): string {
  const finished = `${read.tickets.length - ticketsRemaining(read)} finished in the last ${FINISHED_WEEKS} weeks`
  return countsOpen ? `${ticketsRemaining(read)} open · ${finished}` : finished
}

/**
 * A read's flag: incomplete, asking to narrow the query; or, for a query whose open tickets count, matching nothing.
 * None for a read with all its tickets. Whether comparable work's is used is its pace's to flag (`comparableWorkPace`),
 * over the periods pace counts.
 */
function readFlag(read: SavedRead, trackerName: string, { picksOut, countsOpen }: StepQuery): { flag: string } | undefined {
  if (read.incomplete) {
    return { flag: `${trackerName} gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.` }
  }
  if (countsOpen && read.tickets.length === 0) {
    return { flag: `This query matches nothing: no open tickets, and none finished in the last ${FINISHED_WEEKS} weeks. Check it picks out ${picksOut}.` }
  }
  return undefined
}

/**
 * The Milestone step's submits: add a choice as a pick, or remove the pick with this query (`PicksEdit`); edit the
 * milestone query by hand, as typed; go back to finding, which clears the query when the picker can't show it,
 * once the EM has `confirmed` that; or, in the Comparable work step, start afresh, clearing the picks and query at once.
 */
export type StepQueryEdit =
  | PicksEdit
  | { kind: 'editQuery'; query: string }
  | { kind: 'backToFinding'; confirmed: boolean }
  | { kind: 'startAfresh' }

type PicksEdit = { kind: 'addPick'; choice: Choice } | { kind: 'removePick'; query: string }

/**
 * Seam B: changes the milestone query and saves it, then reads it once, as at `readAt`, open tickets and those
 * finished in the last `FINISHED_WEEKS` weeks. A change of the picks saves them with the query they join into (with
 * OR, in the order picked); a query edited by hand is saved as written. A change that changes nothing (a pick already
 * picked, a removal of none, the query as it was) saves and reads nothing; nor does an empty query read anything.
 * Before any of that, a hand-edited query with free text or an empty qualifier is refused, changing nothing. The
 * query is saved only once read, unless its read says it is wrong: the tracker rejecting it, or it reaching outside
 * the connection, refuses it, and the last query that worked stays in use, with its saved read. Going back to finding
 * from a query the picker can't show changes nothing until confirmed. Starting afresh clears the picks and query
 * together, reading nothing. The query changed is `stepQuery`, the milestone query unless given.
 */
export async function submitStepQuery(
  connecting: Connecting,
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
    edit.kind === 'editQuery' ? await editedQuery(tracker, before, edit.query, connector)
    : edit.kind === 'backToFinding' ? (clears ? NO_QUERY : before)
    : edit.kind === 'startAfresh' ? (before.query === '' && before.picks.length === 0 ? before : NO_QUERY)
    : picksChanged(before, edit)
  if (after === before) return { kind: 'unchanged' }
  const save = (): void => stepQuery.save(connecting.milestoneQueries, teamId, after)
  if (after.query === '' || connector === 'keychainFailed') {
    save()
    return { kind: 'saved' }
  }
  const finishedSince = finishedSinceFor(readAt)
  const read = await readQuery(connector, connecting.reads, { teamId, query: after.query, finishedSince, readAt })
  const rejection = read.ok ? undefined : rejectionOf(connection, read)
  if (rejection) return { kind: 'refused', query: after.query, refusal: rejection, ...(edit.kind !== 'editQuery' && { fromPicks: true as const }) }
  save()
  // one pick's read is the query's; a pick's own read failing leaves its chip without its pace, and nothing else
  if (stepQuery.readsEachPick && after.picks.length > 1 && chipsShow(tracker, after)) {
    for (const pick of after.picks) await readQuery(connector, connecting.reads, { teamId, query: pick.query, finishedSince, readAt })
  }
  return { kind: 'saved', read }
}

/**
 * Why the tracker's failure to read a query rejects it, worded for the Milestone step: it reaches outside the
 * connection, or the tracker refused it, in its own words. None for a failure that says nothing of the query.
 */
function rejectionOf(connection: Connection, failure: Failure): string | undefined {
  const tracker = trackerOf(connection)
  if (failure.failure === 'outOfScope') return tracker.outOfScope(connection)
  if (failure.failure === 'invalidQuery') return `${tracker.name} rejected this query: ${failure.message}`
  return undefined
}

/**
 * What a submit did: saved the milestone query, with its read when one was made (none for an empty query, or when the
 * keychain failed); changed nothing (also before the team connects); refused the query, keeping the last one in
 * use: a hand-edited query before reading it, or any query the tracker rejected or that reaches outside the connection;
 * or changed nothing yet, as going back to finding would clear the query, which the EM is to confirm (`confirmClear`).
 */
export type StepQuerySubmitted =
  | { kind: 'saved'; read?: QueryRead }
  | { kind: 'unchanged' }
  | ({ kind: 'refused' } & RefusedQuery)
  | { kind: 'confirmClear' }

/** A query refused: as typed, or as the picks joined into (`fromPicks`), and why. */
export interface RefusedQuery {
  query: string
  refusal: string
  /** The query a change of the picks joined into, not one edited by hand: the EM stays finding, with the chips. */
  fromPicks?: true
}

/** Nothing picked, and no milestone query. */
const NO_QUERY: MilestoneQuery = { picks: [], query: '' }

/**
 * The milestone query edited by hand to `typed`, as written; `before` itself when it is the query as it was. Its picks
 * are the choices it is an OR of, when it is one and names none twice, so the picker can show it as their chips;
 * otherwise none, as chips that said something else than the query would mislead.
 */
async function editedQuery(tracker: TrackerFacts, before: MilestoneQuery, typed: string, connector: Connector | 'keychainFailed'): Promise<MilestoneQuery> {
  const query = typed.trim()
  if (query === before.query) return before
  const parts = tracker.orParts(query)
  const picks = new Set(parts).size === parts.length ? await choicesOf(tracker, parts, before.picks, connector) : undefined
  return { picks: picks ?? [], query }
}

/**
 * The choice each of `parts` is the query of, in their order; none unless every part is one. The tracker is asked no
 * more than is needed: nothing when they are all already `picked`; else for its choices, once; and then, for a part
 * still not found, it searches each kind it has more of than it lists for what the part names. An epic past those
 * listed is named by its number, not its title, so no search finds it: only one already picked comes back as a chip.
 */
async function choicesOf(tracker: TrackerFacts, parts: string[], picked: Choice[], connector: Connector | 'keychainFailed'): Promise<Choice[] | undefined> {
  const known = new Map(picked.map((choice) => [choice.query, choice]))
  const found = (): Choice[] | undefined => {
    const choices = parts.map((part) => known.get(part))
    return choices.every((choice) => choice !== undefined) ? choices : undefined
  }
  if (found() || connector === 'keychainFailed') return found()
  const listed = await connector.milestoneChoices()
  if (!listed.ok) return undefined
  for (const choice of listed.kinds.flatMap((kind) => kind.choices)) if (!known.has(choice.query)) known.set(choice.query, choice)
  const pastLimit = listed.kinds.filter((kind) => kind.pastLimit).map((kind) => kind.kind)
  for (const part of parts) {
    if (known.has(part)) continue
    const named = tracker.named(part)
    // A part naming nothing to search for is no choice, so the rest need no search.
    const choice = named === undefined ? undefined : await searchedFor(connector, pastLimit, named, part)
    if (!choice) return undefined
    known.set(part, choice)
  }
  return found()
}

/** The choice whose query is `part`, as a search of `kinds`, one after another, for what it `named` finds it; none when no search does. */
async function searchedFor(connector: Connector, kinds: ChoiceKind[], named: string, part: string): Promise<Choice | undefined> {
  for (const kind of kinds) {
    const found = await connector.searchChoices(kind, named)
    const choice = found.ok ? found.choices.find((each) => each.query === part) : undefined
    if (choice) return choice
  }
  return undefined
}

/**
 * Whether the picker can show the milestone query as its picks' chips: it is an OR of their queries, in their order,
 * or empty.
 */
function chipsShow(tracker: TrackerFacts, { picks, query }: MilestoneQuery): boolean {
  if (query === '') return true
  const parts = tracker.orParts(query)
  return parts.length === picks.length && parts.every((part, at) => part === picks[at]!.query)
}

/** The milestone query after a change of the picks; `before` itself when it changes nothing. */
function picksChanged(before: MilestoneQuery, edit: PicksEdit): MilestoneQuery {
  const picks = picksAfter(before.picks, edit)
  return picks === before.picks ? before : { picks, query: joined(picks) }
}

/** The milestone query the picks join into: their queries, with OR, in the order picked. */
function joined(picks: Choice[]): string {
  return picks.map((pick) => pick.query).join(' OR ')
}

/** The picks after `edit`; `picks` itself when the edit changes nothing. */
function picksAfter(picks: Choice[], edit: PicksEdit): Choice[] {
  const query = edit.kind === 'addPick' ? edit.choice.query : edit.query
  const has = picks.some((pick) => pick.query === query)
  if (edit.kind === 'addPick') return has ? picks : [...picks, edit.choice]
  return has ? picks.filter((pick) => pick.query !== query) : picks
}
