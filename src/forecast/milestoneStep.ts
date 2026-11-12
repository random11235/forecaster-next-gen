import type { Choice, Connector } from '../connectors/connector.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { SavedRead } from '../model/savedRead.js'
import { teamConnector, type Connecting } from './connection.js'
import { readQuery, ticketsRemaining, type QueryRead } from './finished.js'

/** What the Milestone step says once, beside the milestone query: the only two things a read adds to it. */
export const LEAF_NOTE = 'Leaf tickets only. Epics include their sub-epics.'

/** Each kind of choice as the screens name it, by the kind connectors give it. */
const KIND_NAMES: Readonly<Record<string, string>> = { milestone: 'milestone', fixVersion: 'fix version', epic: 'epic', label: 'label' }

/** A kind of choice as the screens name it: a chip is marked with it, and a list headed by it. */
export function kindName(kind: string): string {
  return KIND_NAMES[kind] ?? kind
}

/**
 * One kind's choices, as the picker lists them: those matching what is typed, less those already picked. A kind
 * `searched` has more than the tracker lists, so once something is typed it is searched in the tracker, not filtered
 * here; the tracker's search may match whole words only.
 */
export interface ChoiceList {
  kind: string
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
  /** The milestone query: the picks joined with OR; empty until something is picked. */
  query: string
  note: string
  /** The query's last read, as one line: "50 open · 43 finished in the last 8 weeks"; none until it is read. */
  read?: string
}

/** The Milestone step; none in the browser build, nor before the team connects (`noMilestoneStep`). */
export type MilestoneStepView = { kind: 'noMilestoneStep' } | MilestoneStep

/**
 * Seam B: the team's Milestone step, opened: the choices are asked for once, here, and kept nowhere, so each opening
 * lists them afresh. Each list holds the choices whose name holds `find`, ignoring case, less those already picked.
 */
export async function milestoneStepView(connecting: Connecting | undefined, teamId: string, find = ''): Promise<MilestoneStepView> {
  if (!connecting) return { kind: 'noMilestoneStep' }
  const connector = await teamConnector(connecting, teamId)
  if (connector === 'notConnected') return { kind: 'noMilestoneStep' }
  const saved = connecting.milestoneQueries.milestoneQuery(teamId) ?? { picks: [], query: '' }
  const read = saved.query === '' ? undefined : connecting.reads.savedRead({ teamId, query: saved.query })
  const step: MilestoneStep = { kind: 'milestoneStep', find, lists: [], picks: saved.picks, query: saved.query, note: LEAF_NOTE, ...(read && { read: readLine(read) }) }
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
export async function searchedChoiceList(connecting: Connecting, teamId: string, kind: string, find: string): Promise<ChoiceList | undefined> {
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

async function searched(connector: Connector, kind: string, typed: string, unpicked: (choice: Choice) => boolean): Promise<ChoiceList> {
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

/** The Milestone step's submits: add a choice as a pick, or remove the pick with this query. */
export type MilestoneQueryEdit = { kind: 'addPick'; choice: Choice } | { kind: 'removePick'; query: string }

/**
 * Seam B: changes the milestone's picks, saving them with the milestone query they join into (with OR, in the order
 * picked), then reads that query once, as at `readAt`, open tickets and those finished in the last `FINISHED_WEEKS`
 * weeks. A change that changes nothing (a pick already picked, or a removal of none) saves and reads nothing; nor
 * does an empty query read anything. Returns the read, if one was made; none before the team connects.
 */
export async function submitMilestoneQuery(
  connecting: Connecting,
  teamId: string,
  edit: MilestoneQueryEdit,
  readAt: string,
): Promise<QueryRead | undefined> {
  const connector = await teamConnector(connecting, teamId)
  if (connector === 'notConnected') return undefined
  const before = connecting.milestoneQueries.milestoneQuery(teamId)?.picks ?? []
  const picks = picksAfter(before, edit)
  if (picks === before) return undefined
  const milestoneQuery: MilestoneQuery = { picks, query: picks.map((pick) => pick.query).join(' OR ') }
  connecting.milestoneQueries.saveMilestoneQuery(teamId, milestoneQuery)
  if (milestoneQuery.query === '' || connector === 'keychainFailed') return undefined
  const finishedSince = new Date(Date.parse(readAt) - FINISHED_WEEKS * 7 * DAY_MS).toISOString()
  return readQuery(connector, connecting.reads, { teamId, query: milestoneQuery.query, finishedSince, readAt })
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The picks after `edit`; `picks` itself when the edit changes nothing. */
function picksAfter(picks: Choice[], edit: MilestoneQueryEdit): Choice[] {
  const query = edit.kind === 'addPick' ? edit.choice.query : edit.query
  const has = picks.some((pick) => pick.query === query)
  if (edit.kind === 'addPick') return has ? picks : [...picks, edit.choice]
  return has ? picks.filter((pick) => pick.query !== query) : picks
}
