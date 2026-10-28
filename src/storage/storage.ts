import type { AmbiguityRanges, EpicAmbiguity } from '../model/ambiguity.js'
import type { EpicCommit } from '../model/epicCommit.js'
import type { Milestone } from '../model/milestone.js'
import type { PaceSetting } from '../model/paceSetting.js'
import type { Team } from '../model/team.js'
import type { WorkflowSettings } from '../model/workflow.js'
import type { Facts } from '../model/workItem.js'

/** Where the Forecaster keeps its data, organised by team. v1: one local SQLite file (`openSqliteStorage`). */
export interface Storage {
  /** True when nothing has been stored yet: the first launch. */
  isEmpty(): boolean
  /** Adds the team, or updates the one with the same ID; a team's `installedAt` is kept from when it was added. */
  saveTeam(team: Team): void
  teams(): Team[]
  /** Adds the team's work items (replacing any with the same ID) and appends their events. */
  addFacts(teamId: string, facts: Facts): void
  facts(teamId: string): Facts
  /** Adds the milestone, or replaces the one with the same ID. */
  saveMilestone(milestone: Milestone): void
  /** The team's milestones, in the order they were first saved. */
  milestones(teamId: string): Milestone[]
  /** Adds the milestone's pace setting, or replaces the one it has. */
  savePaceSetting(setting: PaceSetting): void
  /** The milestone's pace setting, if the EM has entered one. */
  paceSetting(teamId: string, milestoneId: string): PaceSetting | undefined
  /** Adds the team's workflow settings, or replaces the ones it has. */
  saveWorkflowSettings(settings: WorkflowSettings): void
  /** The team's workflow settings, if any are stored. */
  workflowSettings(teamId: string): WorkflowSettings | undefined
  /** Adds the epic's commit, or replaces the one it has: only the latest commit counts. */
  saveEpicCommit(commit: EpicCommit): void
  /** The team's epic commits, one per epic the EM has committed. */
  epicCommits(teamId: string): EpicCommit[]
  /** Adds the team's ambiguity ranges, or replaces the ones it has. */
  saveAmbiguityRanges(ranges: AmbiguityRanges): void
  /** The team's ambiguity ranges, if the EM has edited them. */
  ambiguityRanges(teamId: string): AmbiguityRanges | undefined
  /** Adds the epic's ambiguity level in the milestone, or replaces the one it has. */
  saveEpicAmbiguity(setting: EpicAmbiguity): void
  /** The ambiguity levels the EM has set for the milestone's epics. */
  epicAmbiguities(teamId: string, milestoneId: string): EpicAmbiguity[]
  close(): void
}
