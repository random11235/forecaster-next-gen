import type { AmbiguityRanges } from '../model/ambiguity.js'
import type { CapacityEntry } from '../model/capacity.js'
import type { Connection } from '../model/connection.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { SavedRead, TeamQuery } from '../model/savedRead.js'
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

/**
 * Where the local server build keeps the team's connection, beside its other data. The browser build has no
 * connectors, so its storage has no connection. Never a token: that is kept in the OS keychain, by `secrets/`.
 */
export interface ConnectionStorage {
  /** Adds the team's connection, or replaces the one it has: a team has at most one. */
  saveConnection(teamId: string, connection: Connection): void
  /** The team's connection, if it has one. */
  connection(teamId: string): Connection | undefined
  /** Removes the team's connection, if it has one. */
  removeConnection(teamId: string): void
}

/**
 * Where the local server build keeps the last read of each of a team's queries, beside its connection, so screens open
 * without a network call. Not the append-only facts earlier releases wrote: a read replaces the query's saved read
 * whole. Nothing of a ticket but its id and finish time is kept. The browser build has no connectors, so no saved reads.
 */
export interface SavedReadStorage {
  /** Saves the query's read, replacing whatever was saved for it. */
  saveRead(teamQuery: TeamQuery, read: SavedRead): void
  /** The query's last saved read, if it has been read. */
  savedRead(teamQuery: TeamQuery): SavedRead | undefined
}

/**
 * Where the local server build keeps the milestone's picks and query, and comparable work's, beside its inputs, so
 * they outlast restarts. Comparable work's are kept apart from the milestone's, and nothing but the EM clears them: a
 * new name or start date for the milestone leaves them as they are (#158). The browser build has no connectors, so it
 * keeps none.
 */
export interface MilestoneQueryStorage {
  /** Saves the milestone's picks and query, replacing both. */
  saveMilestoneQuery(teamId: string, milestoneQuery: MilestoneQuery): void
  /** The milestone's picks and query, if the EM has picked or written one. */
  milestoneQuery(teamId: string): MilestoneQuery | undefined
  /** Saves comparable work's picks and query, replacing both. */
  saveComparableWorkQuery(teamId: string, comparableWorkQuery: MilestoneQuery): void
  /** Comparable work's picks and query, if the EM has picked or written one. */
  comparableWorkQuery(teamId: string): MilestoneQuery | undefined
}
