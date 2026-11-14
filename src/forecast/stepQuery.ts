import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { MilestoneQueryStorage } from '../storage/storage.js'

/**
 * Which of the team's queries a query step edits, picked or written by hand the same way: the milestone query
 * (`MILESTONE_QUERY`), or comparable work's (`COMPARABLE_WORK`, #158). It says how the step names the query and where
 * its picks and query are kept; its `kind` says which step it is, and so all that step does differently (see
 * `ComparableWorkStep`).
 */
export interface StepQuery {
  kind: 'milestoneQuery' | 'comparableWork'
  /** The query as the step labels it: "Milestone query". */
  name: string
  /** What the query is to pick out, as the step says when it matches nothing: "the milestone’s tickets". */
  picksOut: string
  /** The team's picks and query, if the EM has picked or written one. */
  saved(storage: MilestoneQueryStorage, teamId: string): MilestoneQuery | undefined
  /** Saves the team's picks and query, replacing both. */
  save(storage: MilestoneQueryStorage, teamId: string, query: MilestoneQuery): void
}

/** The milestone query, which picks out the milestone's tickets: what the Milestone step edits. */
export const MILESTONE_QUERY: StepQuery = {
  kind: 'milestoneQuery',
  name: 'Milestone query',
  picksOut: 'the milestone’s tickets',
  saved: (storage, teamId) => storage.milestoneQuery(teamId),
  save: (storage, teamId, query) => storage.saveMilestoneQuery(teamId, query),
}

/**
 * Comparable work's query, which picks out recent work like the milestone's to measure its pace from: what the
 * Comparable work step edits. Kept apart from the milestone query, it carries over to the next milestone: nothing but
 * the EM changes or clears it.
 */
export const COMPARABLE_WORK: StepQuery = {
  kind: 'comparableWork',
  name: 'Comparable-work query',
  picksOut: 'work like the milestone’s',
  saved: (storage, teamId) => storage.comparableWorkQuery(teamId),
  save: (storage, teamId, query) => storage.saveComparableWorkQuery(teamId, query),
}
