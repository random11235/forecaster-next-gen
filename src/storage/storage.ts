import type { Milestone } from '../model/milestone.js'
import type { Team } from '../model/team.js'
import type { Facts } from '../model/workItem.js'

/** Where the Forecaster keeps its data, organised by team. v1: one local SQLite file (`openSqliteStorage`). */
export interface Storage {
  /** True when nothing has been stored yet: the first launch. */
  isEmpty(): boolean
  saveTeam(team: Team): void
  teams(): Team[]
  /** Adds the team's work items (replacing any with the same ID) and appends their events. */
  addFacts(teamId: string, facts: Facts): void
  facts(teamId: string): Facts
  /** Adds the milestone, or replaces the one with the same ID. */
  saveMilestone(milestone: Milestone): void
  /** The team's milestones, in the order they were first saved. */
  milestones(teamId: string): Milestone[]
  close(): void
}
