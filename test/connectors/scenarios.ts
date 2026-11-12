import type { Connection } from '../../src/model/connection.js'

/**
 * What Seam C's recordings are made of, for each tracker: the scenarios `scripts/record.ts` records from the synthetic
 * trackers, and the queries read in them, which the contract suite replays.
 *
 * `scripts/record.ts`, which node runs directly, imports this file: keep its runtime imports to none but `node:`.
 */

/** The scenarios each tracker is recorded in: on the synthetic tracker, with a refused token, and on an unknown repo or project. */
export type Scenario = 'synthetic' | 'refusedToken' | 'unknown'

/**
 * The `finishedSince` that reads every finished ticket. Each query is recorded read from it and from the manifest's
 * `cut`, the two a contract case reads from.
 */
export const FROM_THE_START = '1970-01-01T00:00:00Z'

/** Queries in the tracker's own syntax. */
export interface Queries {
  /** The tickets of the open milestone "Search revamp", as its milestone choice reads them. */
  searchRevamp: string
  /** The tickets of the open milestone "Checkout v2": more leaf tickets than one page, with parents and reopens among them. */
  checkout: string
  /** Every open ticket, wherever it is: matching tickets outside the connection, were it not added. */
  open: string
  /** Valid, matching no ticket. */
  nothing: string
  /** One the tracker refuses. */
  invalid: string
  /** One reaching outside the connection's repo or project. */
  outOfScope: string
  /**
   * The picked epic "Epic: payment methods", as its epic choice reads it: naming only the epic, though a sub-epic (on
   * Jira, a story with subtasks) is nested beneath it. A tracker whose connector doesn't expand epics yet leaves it out.
   */
  nestedEpic?: string
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

/**
 * Every scenario but the synthetic one reads only "Search revamp", to record its failure. The synthetic one reads every
 * query, and `quirks`: the tracker's own queries, read by the tests in its folder.
 */
function cases<C extends Connection>(synthetic: C, unknown: C, queries: Queries, quirks: string[] = []): TrackerCases<C> {
  return {
    queries,
    scenarios: {
      synthetic: { connection: synthetic, refused: false, reads: [...Object.values(queries), ...quirks] },
      refusedToken: { connection: synthetic, refused: true, reads: [queries.searchRevamp] },
      unknown: { connection: unknown, refused: false, reads: [queries.searchRevamp] },
    },
  }
}

const GITHUB_SYNTHETIC = { tracker: 'github', owner: 'random11235', repo: 'forecaster-synthetic' } as const

/** GitHub-only queries, read by the tests in `test/connectors/github/`. */
export const GITHUB_QUIRKS = {
  /** The epic "Epic: payment methods" in `parent-issue:`'s short form, which search matches to nothing, with no error. */
  shortFormEpic: 'parent-issue:#106',
}

/** random11235/forecaster-synthetic, in GitHub's search syntax. */
export const GITHUB_CASES = cases<Extract<Connection, { tracker: 'github' }>>(
  GITHUB_SYNTHETIC,
  { ...GITHUB_SYNTHETIC, repo: 'forecaster-synthetic-unknown' },
  {
    searchRevamp: 'milestone:"Search revamp"',
    checkout: 'milestone:"Checkout v2"',
    open: 'is:open',
    nothing: 'label:"no such label"',
    invalid: 'closed:>2026-13-45',
    outOfScope: 'repo:random11235/forecaster-next-gen',
    nestedEpic: 'parent-issue:random11235/forecaster-synthetic#106',
  },
  Object.values(GITHUB_QUIRKS),
)

/** Recorded as the shared test account; `scripts/record.ts` swaps in `FORECASTER_JIRA_EMAIL` when it is set. */
const JIRA_SYNTHETIC = { tracker: 'jira', site: 'ralphhockley.atlassian.net', projectKey: 'SYN', email: 'forecastertest3@gmail.com' } as const

/** The space SYN on ralphhockley.atlassian.net, in JQL. */
export const JIRA_CASES = cases<Extract<Connection, { tracker: 'jira' }>>(
  JIRA_SYNTHETIC,
  { ...JIRA_SYNTHETIC, projectKey: 'SYNUNKNOWN' },
  {
    searchRevamp: 'fixVersion = "Search revamp"',
    checkout: 'fixVersion = "Checkout v2"',
    open: 'statusCategory != Done',
    nothing: 'labels = "no-such-label"',
    invalid: 'labels == comparable',
    outOfScope: 'project = KAN',
    nestedEpic: 'parent = SYN-106',
  },
)
