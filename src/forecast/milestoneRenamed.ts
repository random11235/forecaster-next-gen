import type { Choice, ChoiceKind, Connector } from '../connectors/connector.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { TeamQueries } from '../storage/storage.js'
import { teamConnection, withTeamQueries } from './connection.js'
import { changeStepQuery, type StepQuerySubmitted, type StepReading } from './queryStep.js'

/** The kinds of choice that are the tracker's own milestone: a GitHub milestone, a Jira fix version. */
const MILESTONE_KINDS: readonly ChoiceKind[] = ['milestone', 'fixVersion']

/**
 * Seam B: the milestone, renamed `from` one name `to` another, as the EM moves on to the next milestone (#207). A
 * milestone query that is just the tracker's milestone (or Jira fix version) named `from`, picked as one chip, follows
 * it to the tracker's milestone of the same kind named `to`, when the tracker has one, and is read again as at
 * `readAt`, as the Milestone step reads a change. Any other milestone query (of epics or labels, of several picks, or
 * written by hand) is left as it was, as is one when the tracker has no milestone of the new name.
 *
 * The saved query follows, as the forecast reads it at once, setup open or not; then the steps' (`current`), so they
 * stay on the same milestone: while setup is open, a milestone query of the draft's own follows too, into the draft,
 * and is read there. Its answer is the saved query's.
 */
export async function followRenamedMilestone(
  connecting: StepReading,
  teamId: string,
  renamed: { from: string; to: string },
  readAt: string,
): Promise<StepQuerySubmitted> {
  const saved = withTeamQueries(connecting, 'saved')
  const current = withTeamQueries(connecting, 'current')
  // the steps' query is the saved one unless the draft holds its own; it follows when it is the draft's own, or when
  // the saved one followed; a follow refused is not asked of the tracker again
  const stepsOwn = !sameQuery(current.milestoneQueries.milestoneQuery(teamId), saved.milestoneQueries.milestoneQuery(teamId))
  const followed = await followIn(saved, teamId, renamed, readAt)
  if (stepsOwn || followed.kind === 'saved') await followIn(current, teamId, renamed, readAt)
  return followed
}

/** The milestone query in `connecting`'s target, followed from the milestone renamed, where it is just that milestone. */
async function followIn(
  connecting: StepReading & TeamQueries,
  teamId: string,
  { from, to }: { from: string; to: string },
  readAt: string,
): Promise<StepQuerySubmitted> {
  if (from === to) return { kind: 'unchanged' }
  const query = connecting.milestoneQueries.milestoneQuery(teamId)
  const pick = query?.picks.length === 1 ? query.picks[0]! : undefined
  if (!pick || pick.query !== query?.query || pick.name !== from || !MILESTONE_KINDS.includes(pick.kind)) return { kind: 'unchanged' }
  const connected = await teamConnection(connecting, teamId)
  if (!connected || connected.connector === 'keychainFailed') return { kind: 'unchanged' }
  const choice = await choiceNamed(connected.connector, pick.kind, to)
  if (!choice) return { kind: 'unchanged' }
  return changeStepQuery(connecting, teamId, { kind: 'editQuery', query: choice.query }, readAt)
}

/** Whether two milestone queries are the same: the same query, of the same picks, in whatever order they were picked. */
function sameQuery(one: MilestoneQuery | undefined, other: MilestoneQuery | undefined): boolean {
  if (!one || !other) return one === other
  const picks = ({ picks }: MilestoneQuery): string[] => picks.map(({ kind, name, query }) => JSON.stringify([kind, name, query])).sort()
  return one.query === other.query && JSON.stringify(picks(one)) === JSON.stringify(picks(other))
}

/** The tracker's choice of `kind` named `name`: among those it lists, else, for a kind past the limit, found by its search. */
async function choiceNamed(connector: Connector, kind: ChoiceKind, name: string): Promise<Choice | undefined> {
  const listed = await connector.milestoneChoices()
  if (!listed.ok) return undefined
  const ofKind = listed.kinds.find((each) => each.kind === kind)
  const named = (choices: Choice[]): Choice | undefined => choices.find((choice) => choice.name === name)
  const found = named(ofKind?.choices ?? [])
  if (found || !ofKind?.pastLimit) return found
  const searched = await connector.searchChoices(kind, name)
  return searched.ok ? named(searched.choices) : undefined
}
