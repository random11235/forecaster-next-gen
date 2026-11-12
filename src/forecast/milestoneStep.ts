import type { Choice } from '../connectors/connector.js'
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

/** One kind's choices, as the picker lists them: those matching what is typed, less those already picked. */
export interface ChoiceList {
  kind: string
  choices: Choice[]
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
  const picked = new Set(saved.picks.map((pick) => pick.query))
  const typed = find.trim().toLowerCase()
  const shown = (choice: Choice): boolean => !picked.has(choice.query) && choice.name.toLowerCase().includes(typed)
  return { ...step, lists: choices.kinds.map(({ kind, choices }) => ({ kind, choices: choices.filter(shown) })) }
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
