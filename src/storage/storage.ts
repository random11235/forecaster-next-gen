import type { AmbiguityRanges } from '../model/ambiguity.js'
import type { CapacityEntry } from '../model/capacity.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import type { Team } from '../model/team.js'

/**
 * Where the Forecaster keeps its data, organised by team. v1: one local SQLite file (`openSqliteStorage`); the web build
 * keeps it in the EM's browser (`openWebStorage`, #114). The SQLite schema also keeps the tables earlier releases
 * wrote (facts, epic-based milestones, pace and workflow settings, epic commits and levels), which nothing reads since
 * the MVP (#84).
 */
export interface Storage {
  /** True when nothing has been stored yet: the first launch. */
  isEmpty(): boolean
  /** Adds the team, or updates the one with the same ID; a team's `installedAt` is kept from when it was added. */
  saveTeam(team: Team): void
  teams(): Team[]
  /** Adds the milestone's inputs as the EM entered them, or replaces the team's. */
  saveMilestoneInputs(inputs: MilestoneInputs): void
  /** The team's milestone inputs, if the EM has entered them. */
  milestoneInputs(teamId: string): MilestoneInputs | undefined
  /** Adds the team's ambiguity ranges, or replaces the ones it has. */
  saveAmbiguityRanges(ranges: AmbiguityRanges): void
  /** The team's ambiguity ranges, if the EM has edited them. */
  ambiguityRanges(teamId: string): AmbiguityRanges | undefined
  /** Replaces the team's capacity entries with `entries`. */
  saveCapacityEntries(teamId: string, entries: readonly CapacityEntry[]): void
  /** The team's capacity entries, in the order saved; none until the EM types one. */
  capacityEntries(teamId: string): CapacityEntry[]
  /** Switches the team's capacity on or off for its forecasts; off keeps its entries. */
  saveCapacityOn(teamId: string, on: boolean): void
  /** Whether the team's forecasts use its capacity: on until switched off. */
  capacityOn(teamId: string): boolean
  close(): void
}
