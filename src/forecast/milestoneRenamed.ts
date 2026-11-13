import type { Choice, ChoiceKind, Connector } from '../connectors/connector.js'
import { teamConnection, type Connecting } from './connection.js'
import { submitMilestoneQuery, type MilestoneQuerySubmitted } from './milestoneStep.js'

/** The kinds of choice that are the tracker's own milestone: a GitHub milestone, a Jira fix version. */
const MILESTONE_KINDS: readonly ChoiceKind[] = ['milestone', 'fixVersion']

/**
 * Seam B: the milestone, renamed `from` one name `to` another, as the EM moves on to the next milestone (#207). A
 * milestone query that is just the tracker's milestone (or Jira fix version) named `from`, picked as one chip, follows
 * it to the tracker's milestone of the same kind named `to`, when the tracker has one, and is read again as at
 * `readAt`, as the Milestone step reads a change. Any other milestone query (of epics or labels, of several picks, or
 * written by hand) is left as it was, as is one when the tracker has no milestone of the new name.
 */
export async function followRenamedMilestone(
  connecting: Connecting,
  teamId: string,
  { from, to }: { from: string; to: string },
  readAt: string,
): Promise<MilestoneQuerySubmitted> {
  if (from === to) return { kind: 'unchanged' }
  const saved = connecting.milestoneQueries.milestoneQuery(teamId)
  const pick = saved?.picks.length === 1 ? saved.picks[0]! : undefined
  if (!pick || pick.query !== saved?.query || pick.name !== from || !MILESTONE_KINDS.includes(pick.kind)) return { kind: 'unchanged' }
  const connected = await teamConnection(connecting, teamId)
  if (!connected || connected.connector === 'keychainFailed') return { kind: 'unchanged' }
  const renamed = await choiceNamed(connected.connector, pick.kind, to)
  if (!renamed) return { kind: 'unchanged' }
  return submitMilestoneQuery(connecting, teamId, { kind: 'editQuery', query: renamed.query }, readAt)
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
