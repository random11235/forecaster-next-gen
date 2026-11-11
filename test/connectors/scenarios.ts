import type { Connection } from '../../src/connectors/connector.js'

/**
 * What Seam C's recordings are made of, for each tracker: the scenarios `scripts/record.ts` records from the synthetic
 * trackers, and the queries read in them, which the contract suite replays.
 *
 * `scripts/record.ts`, which node runs directly, imports this file: keep its runtime imports to none but `node:`.
 */

/** The scenarios each tracker is recorded in: on the synthetic tracker, with a refused token, and on an unknown repo or project. */
export type Scenario = 'synthetic' | 'refusedToken' | 'unknown'

/** Queries in the tracker's own syntax. */
export interface Queries {
  /** The tickets of the open milestone "Search revamp", as its milestone choice reads them. */
  searchRevamp: string
  /** Valid, matching no ticket. */
  nothing: string
  /** One the tracker refuses. */
  invalid: string
  /** One reaching outside the connection's repo or project. */
  outOfScope: string
}

/** One recording: the connection it is made on, whether with a credential the tracker refuses, and the queries read on it after the milestone choices. */
export interface ScenarioSetup<C extends Connection> {
  connection: C
  refused: boolean
  reads: string[]
}

export interface TrackerCases<C extends Connection> {
  queries: Queries
  scenarios: Record<Scenario, ScenarioSetup<C>>
}

/** Every scenario but the synthetic one reads only "Search revamp", to record its failure. */
function cases<C extends Connection>(synthetic: C, unknown: C, queries: Queries): TrackerCases<C> {
  return {
    queries,
    scenarios: {
      synthetic: { connection: synthetic, refused: false, reads: Object.values(queries) },
      refusedToken: { connection: synthetic, refused: true, reads: [queries.searchRevamp] },
      unknown: { connection: unknown, refused: false, reads: [queries.searchRevamp] },
    },
  }
}

const GITHUB_SYNTHETIC = { tracker: 'github', owner: 'random11235', repo: 'forecaster-synthetic' } as const

/** random11235/forecaster-synthetic, in GitHub's search syntax. */
export const GITHUB_CASES = cases<Extract<Connection, { tracker: 'github' }>>(
  GITHUB_SYNTHETIC,
  { ...GITHUB_SYNTHETIC, repo: 'forecaster-synthetic-unknown' },
  {
    searchRevamp: 'milestone:"Search revamp"',
    nothing: 'label:"no such label"',
    invalid: 'closed:>2026-13-45',
    outOfScope: 'repo:random11235/forecaster-next-gen',
  },
)

/** Recorded as the shared test account; `scripts/record.ts` swaps in `FORECASTER_JIRA_EMAIL` when it is set. */
const JIRA_SYNTHETIC = { tracker: 'jira', site: 'ralphhockley.atlassian.net', projectKey: 'SYN', email: 'forecastertest3@gmail.com' } as const

/** The space SYN on ralphhockley.atlassian.net, in JQL. "Search revamp" is fix version 10001. */
export const JIRA_CASES = cases<Extract<Connection, { tracker: 'jira' }>>(
  JIRA_SYNTHETIC,
  { ...JIRA_SYNTHETIC, projectKey: 'SYNUNKNOWN' },
  {
    searchRevamp: 'fixVersion = 10001',
    nothing: 'labels = "no-such-label"',
    invalid: 'labels == comparable',
    outOfScope: 'project = KAN',
  },
)
