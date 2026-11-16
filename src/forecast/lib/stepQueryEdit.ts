import type { Choice, ChoiceKind, Connector } from '../../connectors/connector.js'
import type { MilestoneQuery } from '../../model/milestoneQuery.js'
import type { TrackerFacts } from '../trackers.js'

// The query a query step's edit makes: its picks changed, or the query edited by hand and read back into chips.

/** Add a choice as a pick, or remove the pick with this query. */
export type PicksEdit = { kind: 'addPick'; choice: Choice } | { kind: 'removePick'; query: string }

/** Nothing picked, and no milestone query. */
export const NO_QUERY: MilestoneQuery = { picks: [], query: '' }

/**
 * The milestone query edited by hand to `typed`, as written; `before` itself when it is the query as it was. Its picks
 * are the choices it is an OR of, when it is one and names none twice, so the picker can show it as their chips;
 * otherwise none, as chips that said something else than the query would mislead.
 */
export async function editedQuery(
  tracker: TrackerFacts,
  before: MilestoneQuery,
  typed: string,
  connector: Connector | 'keychainFailed',
): Promise<MilestoneQuery> {
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
export function chipsShow(tracker: TrackerFacts, { picks, query }: MilestoneQuery): boolean {
  if (query === '') return true
  const parts = tracker.orParts(query)
  return parts.length === picks.length && parts.every((part, at) => part === picks[at]!.query)
}

/** The milestone query after a change of the picks; `before` itself when it changes nothing. */
export function picksChanged(before: MilestoneQuery, edit: PicksEdit): MilestoneQuery {
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
