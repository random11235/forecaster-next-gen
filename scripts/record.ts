// Records the raw tracker responses Seam C's contract suite replays. Run with `npm run record` for both
// trackers, or `npm run record:github` / `npm run record:jira` for one; each builds the app first and rewrites that
// tracker's recordings in test/connectors/<tracker>/recordings/.
//
// It runs each connector's own requests, in the scenarios test/connectors/scenarios.ts names, against its synthetic
// tracker only, seeded by scripts/synthetic/: the repo random11235/forecaster-synthetic and the Jira space SYN on
// ralphhockley.atlassian.net. Tokens come from the macOS Keychain (`forecaster-github-recording`,
// `forecaster-jira-recording`); Jira's token belongs to the shared test account forecastertest3@gmail.com, which
// `FORECASTER_JIRA_EMAIL` overrides. Each response
// keeps its status and only the fields the connector reads. Credentials go in request headers, which are never
// recorded, and are never written or printed.
//
// Node runs this file directly, so the files it imports from src/ and test/ are named by their `.ts` and import nothing
// at runtime themselves; the connectors, which do, are loaded from the build in dist/.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Connector, Transport } from '../src/connectors/connector.ts'
import type { Connection } from '../src/model/connection.ts'
import { bodyOf } from '../src/connectors/remote.ts'
import { describeRequest, requestOf, type Recording } from '../test/connectors/recording.ts'
import { FROM_THE_START, GITHUB_CASES, JIRA_CASES, type Scenario, type TrackerCases } from '../test/connectors/scenarios.ts'

type GithubConnection = Extract<Connection, { tracker: 'github' }>
type JiraConnection = Extract<Connection, { tracker: 'jira' }>

/** A tracker's connector, built as `app/` builds it. */
type Connect<C extends Connection> = (connection: C, credential: string, transport: Transport) => Connector

type Recorded = { ok: true; recordings: Record<Scenario, Recording[]> } | { ok: false; message: string }

type Body = Record<string, unknown>

/** A response body cut to the fields the connector reads from `url`, asked for with `requestBody`, if it had one. */
type Trim = (url: string, status: number, body: unknown, requestBody: string | undefined) => unknown

function pick(body: unknown, fields: string[]): Body {
  if (typeof body !== 'object' || body === null) return {}
  const source = body as Body
  return Object.fromEntries(fields.filter((field) => field in source).map((field) => [field, source[field]]))
}

/** `transport`, keeping each request (without its headers) and its response, trimmed to what the connector reads. */
function recording(transport: Transport, trim: Trim): { transport: Transport; recordings: Recording[] } {
  const recordings: Recording[] = []
  return {
    recordings,
    transport: async (url, init) => {
      const response = await transport(url, init)
      const body = await bodyOf(response.clone())
      const request = requestOf(url, init)
      if (!recordings.some((each) => describeRequest(each.request) === describeRequest(request))) {
        recordings.push({ request, response: { status: response.status, body: trim(url, response.status, body, request.body) } })
      }
      return response
    },
  }
}

/** The `cut` in a synthetic tracker's manifest: a `finishedSince` between its early finishes and its later ones. */
function cutOf(tracker: Connection['tracker']): string {
  const manifest = JSON.parse(readFileSync(new URL(`synthetic/manifest-${tracker}.json`, import.meta.url), 'utf8')) as { batches: { cut: string } }
  return manifest.batches.cut
}

/** How one tracker is recorded. */
interface Tracker<C extends Connection> {
  cases: TrackerCases<C>
  /** Its manifest's `cut`: each query is read from it, and from the start. */
  cut: string
  /** A credential the tracker refuses, for recording the refusal. */
  refusedCredential: string
  trim: Trim
  /** What to say when the tracker refuses the recording token. */
  refusedMessage: string
}

/**
 * Runs each scenario's requests through `transport`, recording them: its milestone choices, then each of its reads,
 * from the start and from the manifest's cut, the `finishedSince`s the contract cases read from.
 * Records nothing, saying why, when the synthetic tracker refuses the recording credential or can't give its choices.
 */
async function recordTracker<C extends Connection>(
  tracker: Tracker<C>,
  credential: string,
  transport: Transport,
  connect: Connect<C>,
): Promise<Recorded> {
  const recordings = {} as Record<Scenario, Recording[]>
  for (const [scenario, { connection, refused, reads }] of Object.entries(tracker.cases.scenarios) as [Scenario, TrackerCases<C>['scenarios'][Scenario]][]) {
    const recorder = recording(transport, tracker.trim)
    const connector = connect(connection, refused ? tracker.refusedCredential : credential, recorder.transport)
    const choices = await connector.milestoneChoices()
    if (scenario === 'synthetic' && !choices.ok) {
      if (choices.failure === 'unauthorised') return { ok: false, message: tracker.refusedMessage }
      return { ok: false, message: `The synthetic tracker's milestone choices failed as ${choices.failure}. Nothing was recorded.` }
    }
    for (const query of reads) for (const since of [FROM_THE_START, tracker.cut]) await connector.read(query, since)
    recordings[scenario] = recorder.recordings
  }
  return { ok: true, recordings }
}

// GitHub

const GITHUB_KEYCHAIN = 'forecaster-github-recording'
const GITHUB_TOKEN_EXPIRES = '2026-12-07'

const GITHUB: Tracker<GithubConnection> = {
  cases: GITHUB_CASES,
  cut: cutOf('github'),
  refusedCredential: 'forecaster-refused-token',
  trim: (url, status, body) => {
    if (status !== 200) {
      const error = pick(body, ['message', 'errors'])
      if (Array.isArray(error.errors)) error.errors = error.errors.map((each) => pick(each, ['message']))
      return error
    }
    if (url.includes('/milestones?')) return (body as Body[]).map((milestone) => pick(milestone, ['title']))
    if (url.includes('/labels?')) return (body as Body[]).map((label) => pick(label, ['name']))
    if (url.includes('/search/issues?')) {
      const found = pick(body, ['total_count', 'incomplete_results', 'items'])
      // A read keeps each ticket's id and finish; the epics among the milestone choices, their number and title; and a
      // search for sub-epics, each one's parent.
      found.items = (found.items as Body[]).map((item) => pick(item, ['node_id', 'number', 'title', 'state', 'closed_at', 'parent_issue_url']))
      return found
    }
    throw new Error(`The recording script doesn't know what the connector reads from ${url}`)
  },
  refusedMessage: [
    `GitHub refused the recording token (Keychain item "${GITHUB_KEYCHAIN}"). It may have expired: the token made for`,
    `this expires on ${GITHUB_TOKEN_EXPIRES}. Make a fine-grained token with read-only Issues access to`,
    `random11235/forecaster-synthetic, then store it with:`,
    `  security add-generic-password -U -a "$USER" -s ${GITHUB_KEYCHAIN} -w`,
    'Nothing was recorded.',
  ].join('\n'),
}

/** Records the GitHub scenarios through `transport`; or says plainly that the token was refused. */
export function recordGithub(token: string, transport: Transport, github: Connect<GithubConnection>): Promise<Recorded> {
  return recordTracker(GITHUB, token, transport, github)
}

// Jira

const JIRA_KEYCHAIN = 'forecaster-jira-recording'
/** The shared test account that owns the Jira recording token; `FORECASTER_JIRA_EMAIL` overrides it. */
const JIRA_ACCOUNT_EMAIL = JIRA_CASES.scenarios.synthetic.connection.email
const JIRA_EMAIL_VARIABLE = 'FORECASTER_JIRA_EMAIL'

const JIRA: Tracker<JiraConnection> = {
  cases: JIRA_CASES,
  cut: cutOf('jira'),
  refusedCredential: 'forecaster-refused-token',
  trim: (url, status, body, requestBody) => {
    if (url.endsWith('/_edge/tenant_info')) return status === 200 ? pick(body, ['cloudId']) : {}
    if (status !== 200) return pick(body, ['errorMessages'])
    // The connector reads only whether the project is there, from the status.
    if (/\/project\/[^/]+$/.test(url)) return {}
    if (url.endsWith('/versions')) return (body as Body[]).map((version) => pick(version, ['id', 'name', 'released', 'archived']))
    if (url.includes('/label?')) return pick(body, ['values', 'isLast'])
    const categoryOf = (status: unknown) => ({ statusCategory: pick((status as Body).statusCategory, ['key']) })
    if (url.endsWith('/statuses')) {
      return (body as Body[]).map((issueType) => ({
        statuses: (issueType.statuses as Body[]).map((status) => ({ id: status.id, ...categoryOf(status) })),
      }))
    }
    if (url.endsWith('/search/jql')) {
      const found = pick(body, ['issues', 'isLast', 'nextPageToken'])
      // Each search asks for its own fields: a read's, a subtask's parent, when a ticket was made, or an epic's summary.
      const asked = new Set((JSON.parse(requestBody ?? '{}') as { fields?: string[] }).fields ?? [])
      found.issues = (found.issues as Body[]).map((issue) => {
        const fields = pick(issue.fields, [...asked])
        const kept: Body = {}
        if ('issuetype' in fields) kept.issuetype = pick(fields.issuetype, ['hierarchyLevel'])
        if ('status' in fields) kept.status = categoryOf(fields.status)
        if ('subtasks' in fields) {
          kept.subtasks = (fields.subtasks as Body[]).map((subtask) => ({ id: subtask.id, fields: { status: categoryOf((subtask.fields as Body).status) } }))
        }
        if ('parent' in fields) kept.parent = pick(fields.parent, ['id'])
        if ('created' in fields) kept.created = fields.created
        // An epic is listed by its summary and read by its key.
        if ('summary' in fields) return { id: issue.id, key: issue.key, fields: { ...kept, summary: fields.summary } }
        return { id: issue.id, fields: kept }
      })
      return found
    }
    if (url.endsWith('/changelog/bulkfetch')) {
      const fetched = pick(body, ['issueChangeLogs', 'nextPageToken'])
      fetched.issueChangeLogs = (fetched.issueChangeLogs as Body[]).map((log) => ({
        issueId: log.issueId,
        changeHistories: (log.changeHistories as Body[]).map((change) => ({
          created: change.created,
          items: (change.items as Body[]).map((item) => pick(item, ['fieldId', 'from', 'to'])),
        })),
      }))
      return fetched
    }
    throw new Error(`The recording script doesn't know what the connector reads from ${url}`)
  },
  refusedMessage: [
    `Jira refused the recording token (Keychain item "${JIRA_KEYCHAIN}") for the account ${JIRA_ACCOUNT_EMAIL}`,
    `(or ${JIRA_EMAIL_VARIABLE}, if set). The token may have expired: Jira recording tokens last 30 days. Signed in as`,
    'that account, make a scoped API token with read:jira-work at https://id.atlassian.com/manage-profile/security/api-tokens',
    '(a token works only with the email of the account that made it), then store it with:',
    `  security add-generic-password -U -a "$USER" -s ${JIRA_KEYCHAIN} -w`,
    'Nothing was recorded.',
  ].join('\n'),
}

/** Records the Jira scenarios through `transport`, as the account `email`; or says plainly that the token was refused. */
export function recordJira(email: string, token: string, transport: Transport, jira: Connect<JiraConnection>): Promise<Recorded> {
  const scenarios = Object.fromEntries(
    Object.entries(JIRA.cases.scenarios).map(([scenario, setup]) => [scenario, { ...setup, connection: { ...setup.connection, email } }]),
  ) as TrackerCases<JiraConnection>['scenarios']
  return recordTracker({ ...JIRA, cases: { ...JIRA.cases, scenarios } }, token, transport, jira)
}

// The command line

function keychain(service: string): string | undefined {
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    console.error(`No recording token in the macOS Keychain under "${service}". Store one with:`)
    console.error(`  security add-generic-password -U -a "$USER" -s ${service} -w`)
    return undefined
  }
}

/** A module of the build in dist/, typed as its source in src/. */
function built<M>(path: string): Promise<M> {
  return import(new URL(`../dist/${path}`, import.meta.url).href) as Promise<M>
}

/** Each tracker on the command line: how to record it with real `fetch`, or `undefined`, having said why it can't be. */
const TRACKERS: Record<string, () => Promise<Recorded | undefined>> = {
  github: async () => {
    const token = keychain(GITHUB_KEYCHAIN)
    if (token === undefined) return undefined
    const { githubConnector } = await built<typeof import('../src/connectors/github/githubConnector.ts')>('connectors/github/githubConnector.js')
    return recordGithub(token, fetch, githubConnector)
  },
  jira: async () => {
    const email = process.env[JIRA_EMAIL_VARIABLE] || JIRA_ACCOUNT_EMAIL
    const token = keychain(JIRA_KEYCHAIN)
    if (token === undefined) return undefined
    const { jiraConnector } = await built<typeof import('../src/connectors/jira/jiraConnector.ts')>('connectors/jira/jiraConnector.js')
    return recordJira(email, token, fetch, jiraConnector)
  },
}

function write(tracker: string, recordings: Record<Scenario, Recording[]>): void {
  const dir = new URL(`../test/connectors/${tracker}/recordings/`, import.meta.url)
  mkdirSync(dir, { recursive: true })
  for (const [scenario, recorded] of Object.entries(recordings)) {
    writeFileSync(new URL(`${scenario}.json`, dir), `${JSON.stringify(recorded, null, 2)}\n`)
    console.log(`Recorded ${recorded.length} responses in test/connectors/${tracker}/recordings/${scenario}.json`)
  }
}

if (import.meta.main) {
  const asked = process.argv.slice(2)
  const trackers = asked.length > 0 ? asked : Object.keys(TRACKERS)
  let ok = true
  for (const tracker of trackers) {
    const record = Object.hasOwn(TRACKERS, tracker) ? TRACKERS[tracker] : undefined
    if (!record) {
      console.error(`Unknown tracker "${tracker}": record ${Object.keys(TRACKERS).join(', ')}, or all of them.`)
      ok = false
      continue
    }
    const result = await record()
    if (result === undefined) ok = false
    else if (!result.ok) {
      console.error(result.message)
      ok = false
    } else write(tracker, result.recordings)
  }
  if (!ok) process.exit(1)
}
