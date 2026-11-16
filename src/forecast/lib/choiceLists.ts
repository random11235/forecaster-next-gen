import type { Choice, ChoiceKind, ChoicesOfKind, Connector } from '../../connectors/connector.js'
import type { MilestoneQueryStorage } from '../../storage/storage.js'

// The query steps' choice lists: each kind's choices as the picker lists them, filtered here or searched in the tracker.

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

/** One kind's list as the tracker listed it, filtered here by what is `typed` and less the choices not `unpicked`. */
export function listedHere({ kind, choices, pastLimit }: ChoicesOfKind, typed: string, unpicked: (choice: Choice) => boolean): ChoiceList {
  const matching = choices.filter((choice) => unpicked(choice) && choice.name.toLowerCase().includes(typed.toLowerCase()))
  return { kind, choices: matching, searchedInTracker: pastLimit }
}

/**
 * A list, with the choice in it whose query is the milestone query marked (`thisMilestone`). The Milestone step never
 * lists it, as it is picked there.
 */
export function markedThisMilestone(queries: MilestoneQueryStorage, teamId: string): (list: ChoiceList) => ChoiceList {
  const milestoneQuery = queries.milestoneQuery(teamId)?.query
  return (list) => (list.choices.some((choice) => choice.query === milestoneQuery) ? { ...list, thisMilestone: milestoneQuery! } : list)
}

/** Whether a choice is none of `picks`. */
export function notPicked(picks: Choice[]): (choice: Choice) => boolean {
  const picked = new Set(picks.map((pick) => pick.query))
  return (choice) => !picked.has(choice.query)
}

/** One kind's list as the tracker's search finds it for `typed`, less the choices not `unpicked`; or why it couldn't search. */
export async function foundInTracker(connector: Connector, kind: ChoiceKind, typed: string, unpicked: (choice: Choice) => boolean): Promise<ChoiceList> {
  const found = await connector.searchChoices(kind, typed)
  if (!found.ok) {
    return { kind, choices: [], searchedInTracker: true, failure: `The tracker couldn’t search its ${kindName(kind)}s just now. Try again in a few minutes.` }
  }
  return { kind, choices: found.choices.filter(unpicked), searchedInTracker: true }
}

export const KEYCHAIN_FAILED = 'This computer’s keychain couldn’t give the token, so nothing can be listed. Check it’s unlocked, then open the step again.'

export const CHOICES_FAILED = 'The tracker couldn’t list what to pick from just now. Open the step again in a few minutes.'
