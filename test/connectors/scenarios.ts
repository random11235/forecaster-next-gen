import type { ChoiceKind } from '../../src/connectors/connector.js'
import type { Connection } from '../../src/model/connection.js'

/**
 * What Seam C's recordings are made of, for each tracker: the scenarios `scripts/record.ts` records from the synthetic
 * trackers, and the choices searched for and queries read in them, which the contract suite replays.
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

/** Text no synthetic choice has in its name: a search for it is recorded finding nothing. */
export const NO_SUCH_CHOICE = 'zzqxnosuchchoice'

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
  /**
   * The picked epic "Epic: payment methods", as its epic choice reads it: naming only the epic, though a sub-epic (on
   * Jira, a story with subtasks) is nested beneath it.
   */
  nestedEpic: string
}

/** A search of one kind's choices for `text`, which finds the choice named `finds`, one the milestone choices list too. */
export interface ChoiceSearch {
  kind: ChoiceKind
  text: string
  finds: string
}

/**
 * One recording: the connection it is made on, whether with a credential the tracker refuses, and what is asked on it
 * after the milestone choices: the choices searched for, then the queries read.
 */
export interface ScenarioSetup<C extends Connection> {
  connection: C
  refused: boolean
  searches: ChoiceSearch[]
  reads: string[]
}

export interface TrackerCases<C extends Connection> {
  queries: Queries
  /** The tracker's own message refusing `queries.invalid`, as recorded. */
  invalidMessage: string
  /**
   * Queries reaching outside the connection's repo or project, by what they name. A connector refuses them before any
   * request, so none is recorded.
   */
  outOfScope: [names: string, query: string][]
  /**
   * A search of each kind the tracker has. The first is of a kind the tracker keeps by repo or project, so it fails on
   * one that doesn't exist.
   */
  searches: ChoiceSearch[]
  scenarios: Record<Scenario, ScenarioSetup<C>>
}

/**
 * Every scenario but the synthetic one makes only the first search and reads only "Search revamp", to record their
 * failures. The synthetic one makes every search and reads every query, and `quirks`: the tracker's own queries, read
 * by the tests in its folder.
 */
function cases<C extends Connection>(
  synthetic: C,
  unknown: C,
  { queries, invalidMessage, outOfScope, searches }: Pick<TrackerCases<C>, 'queries' | 'invalidMessage' | 'outOfScope' | 'searches'>,
  quirks: string[] = [],
): TrackerCases<C> {
  return {
    queries,
    invalidMessage,
    outOfScope,
    searches,
    scenarios: {
      synthetic: { connection: synthetic, refused: false, searches, reads: [...Object.values(queries), ...quirks] },
      refusedToken: { connection: synthetic, refused: true, searches: searches.slice(0, 1), reads: [queries.searchRevamp] },
      unknown: { connection: unknown, refused: false, searches: searches.slice(0, 1), reads: [queries.searchRevamp] },
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
    queries: {
      searchRevamp: 'milestone:"Search revamp"',
      checkout: 'milestone:"Checkout v2"',
      open: 'is:open',
      nothing: 'label:"no such label"',
      invalid: 'closed:>2026-13-45',
      nestedEpic: 'parent-issue:random11235/forecaster-synthetic#106',
    },
    invalidMessage: '"2026-13-45" is not a recognized date/time format. Please provide an ISO 8601 date/time value, such as YYYY-MM-DD.',
    outOfScope: [
      ['another repo', 'repo:random11235/forecaster-next-gen'],
      ['an organisation', 'org:random11235'],
    ],
    searches: [
      { kind: 'epic', text: 'payment', finds: 'Epic: payment methods' },
      { kind: 'label', text: 'comparable', finds: 'comparable' },
      { kind: 'milestone', text: 'revamp', finds: 'Search revamp' },
    ],
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
    queries: {
      searchRevamp: 'fixVersion = "Search revamp"',
      checkout: 'fixVersion = "Checkout v2"',
      open: 'statusCategory != Done',
      nothing: 'labels = "no-such-label"',
      invalid: 'labels == comparable',
      nestedEpic: 'parent = SYN-106',
    },
    invalidMessage:
      "Error in JQL Query: Expecting either a value, list or function but got '='. You must surround '=' in quotation marks to use it as a value. (line 1, character 30)",
    outOfScope: [['another Jira project', 'project = KAN']],
    searches: [
      { kind: 'fixVersion', text: 'revamp', finds: 'Search revamp' },
      { kind: 'epic', text: 'payment', finds: 'Epic: payment methods' },
      { kind: 'label', text: 'compar', finds: 'comparable' },
    ],
  },
)
