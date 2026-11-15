import type { AmbiguityRanges } from '../model/ambiguity.js'
import type { CapacityEntry } from '../model/capacity.js'
import type { Connection } from '../model/connection.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { SavedRead, TeamQuery } from '../model/savedRead.js'
import type { ReadFailures } from '../model/readFailures.js'
import type { SetupDraft } from '../model/setupDraft.js'
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
 * whole, keeping the one it replaced as the previous read, one back. Nothing of a ticket but its id and finish time is
 * kept. The browser build has no connectors, so no saved reads.
 */
export interface SavedReadStorage {
  /** Saves the query's read, replacing whatever was saved for it, which becomes its previous read. */
  saveRead(teamQuery: TeamQuery, read: SavedRead): void
  /** The query's last saved read, if it has been read. */
  savedRead(teamQuery: TeamQuery): SavedRead | undefined
  /** The read the query's last saved read replaced, if it has been read twice: what the faint previous value comes from (#214). */
  previousRead(teamQuery: TeamQuery): SavedRead | undefined
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

/** How the team's setup steps were closed: `done` with "Use these", or `skipped` when the EM typed the inputs instead. */
export type SetupClosed = 'done' | 'skipped'

/**
 * Where the team's setup steps stand (#217): closed, `done` or `skipped`, the Inputs screen showing the summary or the
 * inputs typed instead of the steps; or open. Open, they are a first setup, or opened again from how they were closed
 * (`reopened`), which Cancel goes back to; and they say what this opening did to the team's connection, if anything:
 * `made` it, where there was none, which Cancel undoes, or `changed` it, which Cancel can't undo. A team with nothing
 * stored is open, in a first setup that has made nothing.
 */
export type SetupState = { open: false; closed: SetupClosed } | { open: true; reopened?: SetupClosed; connection?: 'made' | 'changed' }

/**
 * Where the team's setup steps stand (#217), and beside it the setup draft: what the EM has chosen in the steps and not
 * yet applied (#218); and why the last reads failed (#222). The browser build has no setup steps.
 */
export interface SetupStorage {
  /** Where the team's setup steps stand: open, in a first setup, until saved otherwise. */
  setupState(teamId: string): SetupState
  /** Replaces where the team's setup steps stand. */
  saveSetupState(teamId: string, state: SetupState): void
  /** What the EM has chosen inside setup and not yet applied (#218), if anything: kept apart from the saved queries and reads. */
  setupDraft(teamId: string): SetupDraft | undefined
  /** Replaces the team's setup draft whole. */
  saveSetupDraft(teamId: string, draft: SetupDraft): void
  /**
   * Applies the team's setup draft ("Use these"), if it has one: its queries and reads saved over the saved ones, each
   * read made in setup the query's latest, the saved one before it its previous; why its picks' reads failed over why
   * theirs did, a pick read well in it failing no longer; then the draft discarded.
   */
  applySetupDraft(teamId: string): void
  /** Throws the team's setup draft away (Cancel), if it has one. */
  discardSetupDraft(teamId: string): void
  /** Why the team's last reads failed (#222), if they did: the summary says so, the saved reads in use. */
  readFailures(teamId: string): ReadFailures | undefined
  /** Replaces why the team's reads failed whole: with none left, there are none. */
  saveReadFailures(teamId: string, failures: ReadFailures): void
}

/**
 * Which of the team's queries and reads are meant (#244): `current`, what the setup steps read and save with, the
 * team's setup draft over what's saved while setup is open, what's saved while it's closed; `saved`, what's saved only,
 * which the Milestone forecast screen and the Inputs screen's values read; and `everywhere`, what's saved, read and
 * saved, and while setup is open the draft too, wherever it holds the same as what's saved: a change the forecast
 * takes at once, which the steps follow (a skip, a renamed milestone).
 */
export type QueryTarget = 'current' | 'saved' | 'everywhere'

/** The team's queries and their reads, in one target. */
export interface TeamQueries {
  milestoneQueries: MilestoneQueryStorage
  reads: SavedReadStorage
}

/**
 * Where the local server build keeps the team's queries and reads, by target, the setup draft held behind it, so
 * nothing outside storage overlays the draft itself. The browser build has no connectors, so it keeps none.
 */
export interface TeamQueryStorage {
  /** The team's queries and reads in `target`. */
  teamQueries(target: QueryTarget): TeamQueries
}
