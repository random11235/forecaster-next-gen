import type { Choice, ChoiceKind, Connector, Failure } from '../connectors/connector.js'
import type { Connection } from '../model/connection.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { SavedRead } from '../model/savedRead.js'
import { teamConnector, type Connecting } from './connection.js'
import { readQuery, ticketsRemaining, type QueryRead } from './finished.js'
import { trackerOf } from './trackers.js'

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
 * `searched` has more than the tracker lists, so once something is typed it is searched in the tracker, not filtered
 * here; the tracker's search may match whole words only.
 */
export interface ChoiceList {
  kind: ChoiceKind
  choices: Choice[]
  searched: boolean
  /** Why the tracker couldn't search this kind; none when it could. */
  failure?: string
}

/**
 * What the Milestone step shows, in the local server build once connected: the choices to pick from, by kind; the
 * picks, as chips; the milestone query they make, always shown, with `note` beside it; and the query's read.
 */
export interface MilestoneStep {
  kind: 'milestoneStep'
  /** What the EM typed to find a choice by. */
  find: string
  lists: ChoiceList[]
  /** Why the choices couldn't be listed; none when they were. */
  choicesFailure?: string
  picks: Choice[]
  /** The milestone query: the picks joined with OR, or as edited by hand; empty until something is picked. */
  query: string
  note: string
  /** The query's last read, as one line: "50 open · 43 finished in the last 8 weeks"; none until it is read. */
  read?: string
  /** What is wrong with that read, beside its line: it matched nothing, or is incomplete. None when it is fine. */
  flag?: string
  /**
   * The milestone query open for editing by hand, in place of finding choices to pick: when the EM asks to edit it as
   * a query, or when the picker can't show it as chips. None while finding.
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
}

/** The Milestone step; none in the browser build, nor before the team connects (`noMilestoneStep`). */
export type MilestoneStepView = { kind: 'noMilestoneStep' } | MilestoneStep

/**
 * How the Milestone step opens: on finding (the default), or with the milestone query open for editing; also open for
 * editing, with the query as typed and why, once a hand-edited query is `refused`.
 */
export interface MilestoneStepOpening {
  editing?: boolean
  refused?: RefusedQuery
}

/** What the step says, editing a query the picker can't show, of going back to finding. */
export const BACK_CLEARS = 'The picker can’t show this query, so going back to finding clears it.'

/**
 * Seam B: the team's Milestone step, opened: the choices are asked for once, here, and kept nowhere, so each opening
 * lists them afresh. Each list holds the choices whose name holds `find`, ignoring case, less those already picked.
 * The milestone query is open for editing when `opening` asks, or when the picker can't show it.
 */
export async function milestoneStepView(
  connecting: Connecting | undefined,
  teamId: string,
  find = '',
  opening: MilestoneStepOpening = {},
): Promise<MilestoneStepView> {
  if (!connecting) return { kind: 'noMilestoneStep' }
  const connector = await teamConnector(connecting, teamId)
  const connection = connecting.connections.connection(teamId)
  if (connector === 'notConnected' || !connection) return { kind: 'noMilestoneStep' }
  const saved = connecting.milestoneQueries.milestoneQuery(teamId) ?? NO_QUERY
  const read = saved.query === '' ? undefined : connecting.reads.savedRead({ teamId, query: saved.query })
  const shownAsChips = chipsShow(saved)
  const { refused } = opening
  const editing: QueryEditing | undefined =
    opening.editing || refused || !shownAsChips
      ? {
          typed: refused?.query ?? saved.query,
          readIn: trackerOf(connection).where(connection),
          ...(refused && { refusal: refused.refusal }),
          ...(!shownAsChips && { backClears: BACK_CLEARS }),
        }
      : undefined
  const step: MilestoneStep = {
    kind: 'milestoneStep',
    find,
    lists: [],
    picks: saved.picks,
    query: saved.query,
    note: LEAF_NOTE,
    ...(read && { read: readLine(read) }),
    ...(read && readFlag(read, trackerOf(connection).name)),
    ...(editing && { editing }),
  }
  if (connector === 'keychainFailed') return { ...step, choicesFailure: KEYCHAIN_FAILED }
  const choices = await connector.milestoneChoices()
  if (!choices.ok) return { ...step, choicesFailure: CHOICES_FAILED }
  const typed = find.trim()
  const unpicked = notPicked(saved.picks)
  const lists: ChoiceList[] = []
  // A kind past the limit is searched once something is typed, one kind after another, to spare the rate limit.
  for (const { kind, choices: listed, pastLimit } of choices.kinds) {
    if (pastLimit && typed !== '') lists.push(await searched(connector, kind, typed, unpicked))
    else lists.push({ kind, choices: listed.filter((choice) => unpicked(choice) && choice.name.toLowerCase().includes(typed.toLowerCase())), searched: pastLimit })
  }
  return { ...step, lists }
}

/**
 * Seam B: one kind past the limit, searched in the tracker for `find`, as the Milestone step's picker asks for it while
 * the EM types: the choices the tracker finds, less those already picked. None before the team connects.
 */
export async function searchedChoiceList(connecting: Connecting, teamId: string, kind: ChoiceKind, find: string): Promise<ChoiceList | undefined> {
  const connector = await teamConnector(connecting, teamId)
  if (connector === 'notConnected') return undefined
  if (connector === 'keychainFailed') return { kind, choices: [], searched: true, failure: KEYCHAIN_FAILED }
  const picks = connecting.milestoneQueries.milestoneQuery(teamId)?.picks ?? []
  return searched(connector, kind, find.trim(), notPicked(picks))
}

/** Whether a choice is none of `picks`. */
function notPicked(picks: Choice[]): (choice: Choice) => boolean {
  const picked = new Set(picks.map((pick) => pick.query))
  return (choice) => !picked.has(choice.query)
}

async function searched(connector: Connector, kind: ChoiceKind, typed: string, unpicked: (choice: Choice) => boolean): Promise<ChoiceList> {
  const found = await connector.searchChoices(kind, typed)
  if (!found.ok) return { kind, choices: [], searched: true, failure: `The tracker couldn’t search its ${kindName(kind)}s just now. Try again in a few minutes.` }
  return { kind, choices: found.choices.filter(unpicked), searched: true }
}

const KEYCHAIN_FAILED = 'This computer’s keychain couldn’t give the token, so nothing can be listed. Check it’s unlocked, then open the step again.'

const CHOICES_FAILED = 'The tracker couldn’t list what to pick from just now. Open the step again in a few minutes.'

/** How far back a read of the milestone query counts finished tickets, in weeks. */
export const FINISHED_WEEKS = 8

/** A read's line: its open tickets, and those finished in the weeks it reads back. */
function readLine(read: SavedRead): string {
  const finished = read.tickets.length - ticketsRemaining(read)
  return `${ticketsRemaining(read)} open · ${finished} finished in the last ${FINISHED_WEEKS} weeks`
}

/** A read's flag: incomplete, asking to narrow the query; or matching nothing. None for a read with all its tickets. */
function readFlag(read: SavedRead, trackerName: string): { flag: string } | undefined {
  if (read.incomplete) return { flag: `This count is incomplete: ${trackerName} gave only part of what the query matches. Narrow the query to read all of it.` }
  if (read.tickets.length === 0) {
    return { flag: `This query matches nothing: no open tickets, and none finished in the last ${FINISHED_WEEKS} weeks. Check it picks out the milestone’s tickets.` }
  }
  return undefined
}

/**
 * The Milestone step's submits: add a choice as a pick, or remove the pick with this query (`PicksEdit`); edit the
 * milestone query by hand, as typed; or go back to finding, which clears the query when the picker can't show it.
 */
export type MilestoneQueryEdit = PicksEdit | { kind: 'editQuery'; query: string } | { kind: 'backToFinding' }

type PicksEdit = { kind: 'addPick'; choice: Choice } | { kind: 'removePick'; query: string }

/**
 * Seam B: changes the milestone query and saves it, then reads it once, as at `readAt`, open tickets and those
 * finished in the last `FINISHED_WEEKS` weeks. A change of the picks saves them with the query they join into (with
 * OR, in the order picked); a query edited by hand is saved as written. A change that changes nothing (a pick already
 * picked, a removal of none, the query as it was) saves and reads nothing; nor does an empty query read anything.
 * Before any of that, a hand-edited query with free text or an empty qualifier is refused, changing nothing. The
 * query is saved only once read, unless its read says it is wrong: the tracker rejecting it, or it reaching outside
 * the connection, refuses it, and the last query that worked stays in use, with its saved read.
 */
export async function submitMilestoneQuery(
  connecting: Connecting,
  teamId: string,
  edit: MilestoneQueryEdit,
  readAt: string,
): Promise<MilestoneQuerySubmitted> {
  const connector = await teamConnector(connecting, teamId)
  const connection = connecting.connections.connection(teamId)
  if (connector === 'notConnected' || !connection) return { kind: 'unchanged' }
  if (edit.kind === 'editQuery') {
    const refusal = trackerOf(connection).queryRefusal(edit.query)
    if (refusal) return { kind: 'refused', query: edit.query, refusal }
  }
  const before = connecting.milestoneQueries.milestoneQuery(teamId) ?? NO_QUERY
  const after =
    edit.kind === 'editQuery' ? await editedQuery(before, edit.query, connector)
    : edit.kind === 'backToFinding' ? (chipsShow(before) ? before : NO_QUERY)
    : picksChanged(before, edit)
  if (after === before) return { kind: 'unchanged' }
  const save = (): void => connecting.milestoneQueries.saveMilestoneQuery(teamId, after)
  if (after.query === '' || connector === 'keychainFailed') {
    save()
    return { kind: 'saved' }
  }
  const finishedSince = new Date(Date.parse(readAt) - FINISHED_WEEKS * 7 * DAY_MS).toISOString()
  const read = await readQuery(connector, connecting.reads, { teamId, query: after.query, finishedSince, readAt })
  const rejection = read.ok ? undefined : rejectionOf(connection, read)
  if (rejection) return { kind: 'refused', query: after.query, refusal: rejection }
  save()
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
 * keychain failed); changed nothing (also before the team connects); or refused the query, keeping the last one in
 * use: a hand-edited query before reading it, or any query the tracker rejected or that reaches outside the connection.
 */
export type MilestoneQuerySubmitted = { kind: 'saved'; read?: QueryRead } | { kind: 'unchanged' } | ({ kind: 'refused' } & RefusedQuery)

/** A query refused: as typed, and why. */
export interface RefusedQuery {
  query: string
  refusal: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Nothing picked, and no milestone query. */
const NO_QUERY: MilestoneQuery = { picks: [], query: '' }

/**
 * The milestone query edited by hand to `typed`, as written; `before` itself when it is the query as it was. Its picks
 * are the choices it is an OR of, when it is one, so the picker can show it as their chips; otherwise none. Those
 * already picked are known; others are asked for, once, only when the query names one that isn't.
 */
async function editedQuery(before: MilestoneQuery, typed: string, connector: Connector | 'keychainFailed'): Promise<MilestoneQuery> {
  const query = typed.trim()
  if (query === before.query) return before
  const parts = orParts(query)
  const picked = (choices: Choice[]): Choice[] | undefined => {
    const found = parts.map((part) => choices.find((choice) => choice.query === part))
    return found.every((choice) => choice !== undefined) ? found : undefined
  }
  const listed = async (): Promise<Choice[]> => {
    if (connector === 'keychainFailed') return []
    const choices = await connector.milestoneChoices()
    return choices.ok ? choices.kinds.flatMap((kind) => kind.choices) : []
  }
  const picks = picked(before.picks) ?? picked([...before.picks, ...(await listed())]) ?? []
  return { picks, query }
}

/** Whether the picker can show the milestone query as its picks' chips: it is an OR of their queries, or empty. */
function chipsShow({ picks, query }: MilestoneQuery): boolean {
  if (query === '') return true
  const parts = orParts(query)
  return parts.length === picks.length && parts.every((part, at) => part === picks[at]!.query)
}

/**
 * The parts of a query joined by OR at its top level, outside quotes and brackets, each trimmed, and none repeated:
 * `label:"a" OR milestone:"b"` has two; `label:a -label:b` is one.
 */
function orParts(query: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let at = 0; at < query.length; at += 1) {
    const char = query[at]!
    if (char === '"' && query[at - 1] !== '\\') quoted = !quoted
    if (quoted) continue
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    const or = depth === 0 && /^\sOR\s/.exec(query.slice(at, at + 4))
    if (or) {
      parts.push(query.slice(start, at).trim())
      start = at + 3
    }
  }
  parts.push(query.slice(start).trim())
  return [...new Set(parts)]
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
