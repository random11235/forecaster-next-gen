// Records the raw tracker responses Seam C's contract suite replays (#172, #173). Run with `npm run record` for both
// trackers, or `npm run record:github` / `npm run record:jira` for one; each builds the app first and rewrites that
// tracker's recordings in test/connectors/<tracker>/recordings/.
//
// It runs each connector's own requests against its synthetic tracker only, seeded by scripts/synthetic/: the repo
// random11235/forecaster-synthetic and the Jira space SYN on ralphhockley.atlassian.net. Tokens come from the macOS
// Keychain (`forecaster-github-recording`, `forecaster-jira-recording`), and Jira's account email from the environment
// (`FORECASTER_JIRA_EMAIL`). Each response keeps its status and only the fields the connector reads. Credentials go in
// request headers, which are never recorded, and are never written or printed.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Connection, Connector, Transport } from '../src/connectors/connector.js'
import type { githubConnector } from '../src/connectors/github/githubConnector.js'
import type { jiraConnector } from '../src/connectors/jira/jiraConnector.js'
import type { Recording } from '../test/connectors/replayTransport.js'

/** The scenarios each tracker is recorded in: on the synthetic tracker, with a refused token, and on an unknown repo or project. */
export type Scenario = 'synthetic' | 'refusedToken' | 'unknown'

type Recorded = { ok: true; recordings: Record<Scenario, Recording[]> } | { ok: false; message: string }

type Body = Record<string, unknown>

function pick(body: unknown, fields: string[]): Body {
  if (typeof body !== 'object' || body === null) return {}
  const source = body as Body
  return Object.fromEntries(fields.filter((field) => field in source).map((field) => [field, source[field]]))
}

/** `transport`, keeping each request (without its headers) and its response, trimmed to what the connector reads. */
function recording(transport: Transport, trim: (url: string, status: number, body: unknown) => unknown): { transport: Transport; recordings: Recording[] } {
  const recordings: Recording[] = []
  return {
    recordings,
    transport: async (url, init) => {
      const response = await transport(url, init)
      const text = await response.text()
      let body: unknown = text
      try {
        body = JSON.parse(text)
      } catch {}
      const request: Recording['request'] = { method: init?.method ?? 'GET', url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) }
      const same = (recorded: Recording['request']) => recorded.method === request.method && recorded.url === request.url && recorded.body === request.body
      if (!recordings.some((each) => same(each.request))) {
        recordings.push({ request, response: { status: response.status, body: trim(url, response.status, body) } })
      }
      return new Response(text, { status: response.status, headers: response.headers })
    },
  }
}

/**
 * Runs each scenario's requests through `transport`, recording them: its milestone choices, then each of its reads.
 * Records nothing, saying why, when the synthetic tracker refuses the recording token or can't give its choices.
 */
async function recordScenarios<C>(
  scenarios: Record<Scenario, { connection: C; credential: string; reads: string[] }>,
  connect: (connection: C, credential: string, transport: Transport) => Connector,
  transport: Transport,
  trim: (url: string, status: number, body: unknown) => unknown,
  refusedMessage: string,
): Promise<Recorded> {
  const recordings = {} as Record<Scenario, Recording[]>
  for (const [scenario, { connection, credential, reads }] of Object.entries(scenarios) as [Scenario, (typeof scenarios)[Scenario]][]) {
    const recorder = recording(transport, trim)
    const connector = connect(connection, credential, recorder.transport)
    const choices = await connector.milestoneChoices()
    if (scenario === 'synthetic' && !choices.ok) {
      if (choices.failure === 'unauthorised') return { ok: false, message: refusedMessage }
      return { ok: false, message: `The synthetic tracker's milestone choices failed as ${choices.failure}. Nothing was recorded.` }
    }
    for (const query of reads) await connector.read(query, '1970-01-01T00:00:00Z')
    recordings[scenario] = recorder.recordings
  }
  return { ok: true, recordings }
}

// GitHub

const GITHUB_KEYCHAIN = 'forecaster-github-recording'
const GITHUB_TOKEN_EXPIRES = '2026-12-07'

/** A token GitHub refuses, for recording the refusal. */
const GITHUB_REFUSED_TOKEN = 'forecaster-refused-token'

const GITHUB_SYNTHETIC: Extract<Connection, { tracker: 'github' }> = { tracker: 'github', owner: 'random11235', repo: 'forecaster-synthetic' }

/** The queries the contract suite reads, in GitHub's search syntax (see `ContractSubject`). */
export const GITHUB_QUERIES = {
  searchRevamp: 'milestone:"Search revamp"',
  nothing: 'label:"no such label"',
  invalid: 'closed:>2026-13-45',
  outOfScope: 'repo:random11235/forecaster-next-gen',
}

/** Each recording: the connection and token it is made with, and the queries read on it after the milestone choices. */
export const GITHUB_SCENARIOS: Record<Scenario, { connection: typeof GITHUB_SYNTHETIC; token: string; reads: string[] }> = {
  synthetic: { connection: GITHUB_SYNTHETIC, token: 'recording', reads: Object.values(GITHUB_QUERIES) },
  refusedToken: { connection: GITHUB_SYNTHETIC, token: GITHUB_REFUSED_TOKEN, reads: [GITHUB_QUERIES.searchRevamp] },
  unknown: { connection: { ...GITHUB_SYNTHETIC, repo: 'forecaster-synthetic-unknown' }, token: 'recording', reads: [GITHUB_QUERIES.searchRevamp] },
}

const GITHUB_REFUSED_MESSAGE = [
  `GitHub refused the recording token (Keychain item "${GITHUB_KEYCHAIN}"). It may have expired: the token made for`,
  `this expires on ${GITHUB_TOKEN_EXPIRES}. Make a fine-grained token with read-only Issues access to`,
  `random11235/forecaster-synthetic, then store it with:`,
  `  security add-generic-password -U -a "$USER" -s ${GITHUB_KEYCHAIN} -w`,
  'Nothing was recorded.',
].join('\n')

/** A GitHub response body cut to the fields the connector reads. */
function trimGithub(url: string, status: number, body: unknown): unknown {
  if (status !== 200) {
    const error = pick(body, ['message', 'errors'])
    if (Array.isArray(error.errors)) error.errors = error.errors.map((each) => pick(each, ['message']))
    return error
  }
  if (url.includes('/milestones?')) return (body as Body[]).map((milestone) => pick(milestone, ['title']))
  if (url.includes('/search/issues?')) {
    const found = pick(body, ['total_count', 'incomplete_results', 'items'])
    found.items = (found.items as Body[]).map((item) => pick(item, ['node_id', 'state', 'closed_at']))
    return found
  }
  throw new Error(`The recording script doesn't know what the connector reads from ${url}`)
}

/** Records the GitHub scenarios through `transport`; or says plainly that the token was refused. */
export async function recordGithub(token: string, transport: Transport, github: typeof githubConnector): Promise<Recorded> {
  const scenarios = Object.fromEntries(
    Object.entries(GITHUB_SCENARIOS).map(([scenario, { connection, token: scenarioToken, reads }]) => [
      scenario,
      { connection, credential: scenarioToken === 'recording' ? token : scenarioToken, reads },
    ]),
  ) as Record<Scenario, { connection: typeof GITHUB_SYNTHETIC; credential: string; reads: string[] }>
  return recordScenarios(scenarios, github, transport, trimGithub, GITHUB_REFUSED_MESSAGE)
}

// Jira

const JIRA_KEYCHAIN = 'forecaster-jira-recording'
const JIRA_EMAIL_VARIABLE = 'FORECASTER_JIRA_EMAIL'

/** An account and token Jira refuses, for recording the refusal. */
const JIRA_REFUSED_CREDENTIAL = 'refused@example.invalid:forecaster-refused-token'

const JIRA_SYNTHETIC: Extract<Connection, { tracker: 'jira' }> = { tracker: 'jira', site: 'ralphhockley.atlassian.net', projectKey: 'SYN' }

/** The queries the contract suite reads, in JQL (see `ContractSubject`). "Search revamp" is fix version 10001. */
export const JIRA_QUERIES = {
  searchRevamp: 'fixVersion = 10001',
  nothing: 'labels = "no-such-label"',
  invalid: 'labels == comparable',
  outOfScope: 'project = KAN',
}

/** Each recording: the connection it is made on, whether with the recording credential, and the queries read on it. */
export const JIRA_SCENARIOS: Record<Scenario, { connection: typeof JIRA_SYNTHETIC; refused: boolean; reads: string[] }> = {
  synthetic: { connection: JIRA_SYNTHETIC, refused: false, reads: Object.values(JIRA_QUERIES) },
  refusedToken: { connection: JIRA_SYNTHETIC, refused: true, reads: [JIRA_QUERIES.searchRevamp] },
  unknown: { connection: { ...JIRA_SYNTHETIC, projectKey: 'SYNUNKNOWN' }, refused: false, reads: [JIRA_QUERIES.searchRevamp] },
}

const JIRA_REFUSED_MESSAGE = [
  `Jira refused the recording token (Keychain item "${JIRA_KEYCHAIN}") with the account email in ${JIRA_EMAIL_VARIABLE}.`,
  'The token may have expired: Jira recording tokens last 30 days. Make a scoped API token with read:jira-work at',
  'https://id.atlassian.com/manage-profile/security/api-tokens, for the account that can see the space SYN on',
  'ralphhockley.atlassian.net, then store it with:',
  `  security add-generic-password -U -a "$USER" -s ${JIRA_KEYCHAIN} -w`,
  'Nothing was recorded.',
].join('\n')

/** A Jira response body cut to the fields the connector reads. */
function trimJira(url: string, status: number, body: unknown): unknown {
  if (url.endsWith('/_edge/tenant_info')) return status === 200 ? pick(body, ['cloudId']) : {}
  if (status !== 200) return pick(body, ['errorMessages'])
  // The connector reads only whether the project is there, from the status.
  if (/\/project\/[^/]+$/.test(url)) return {}
  if (url.endsWith('/versions')) return (body as Body[]).map((version) => pick(version, ['id', 'name', 'released', 'archived']))
  if (url.endsWith('/search/jql')) {
    const found = pick(body, ['issues', 'isLast', 'nextPageToken'])
    found.issues = (found.issues as Body[]).map((issue) => {
      const fields = issue.fields as Body
      const status = fields.status as Body
      return { id: issue.id, fields: { status: { statusCategory: pick(status.statusCategory, ['key']) }, ...pick(fields, ['statuscategorychangedate']) } }
    })
    return found
  }
  throw new Error(`The recording script doesn't know what the connector reads from ${url}`)
}

/** Records the Jira scenarios through `transport`, as the account `email`; or says plainly that the token was refused. */
export async function recordJira(email: string, token: string, transport: Transport, jira: typeof jiraConnector): Promise<Recorded> {
  const scenarios = Object.fromEntries(
    Object.entries(JIRA_SCENARIOS).map(([scenario, { connection, refused, reads }]) => [
      scenario,
      { connection, credential: refused ? JIRA_REFUSED_CREDENTIAL : `${email}:${token}`, reads },
    ]),
  ) as Record<Scenario, { connection: typeof JIRA_SYNTHETIC; credential: string; reads: string[] }>
  return recordScenarios(scenarios, jira, transport, trimJira, JIRA_REFUSED_MESSAGE)
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

function write(tracker: string, recordings: Record<Scenario, Recording[]>): void {
  const dir = new URL(`../test/connectors/${tracker}/recordings/`, import.meta.url)
  mkdirSync(dir, { recursive: true })
  for (const [scenario, recorded] of Object.entries(recordings)) {
    writeFileSync(new URL(`${scenario}.json`, dir), `${JSON.stringify(recorded, null, 2)}\n`)
    console.log(`Recorded ${recorded.length} responses in test/connectors/${tracker}/recordings/${scenario}.json`)
  }
}

async function record(tracker: 'github' | 'jira'): Promise<boolean> {
  let result: Recorded
  if (tracker === 'github') {
    const token = keychain(GITHUB_KEYCHAIN)
    if (token === undefined) return false
    const { githubConnector: github }: typeof import('../src/connectors/github/githubConnector.js') = await import(
      new URL('../dist/connectors/github/githubConnector.js', import.meta.url).href
    )
    result = await recordGithub(token, fetch, github)
  } else {
    const email = process.env[JIRA_EMAIL_VARIABLE]
    if (!email) {
      console.error(`Set ${JIRA_EMAIL_VARIABLE} to the email of the Atlassian account the Jira recording token belongs to.`)
      return false
    }
    const token = keychain(JIRA_KEYCHAIN)
    if (token === undefined) return false
    const { jiraConnector: jira }: typeof import('../src/connectors/jira/jiraConnector.js') = await import(
      new URL('../dist/connectors/jira/jiraConnector.js', import.meta.url).href
    )
    result = await recordJira(email, token, fetch, jira)
  }
  if (!result.ok) {
    console.error(result.message)
    return false
  }
  write(tracker, result.recordings)
  return true
}

if (import.meta.main) {
  const asked = process.argv.slice(2)
  const trackers = asked.length > 0 ? asked : ['github', 'jira']
  let ok = true
  for (const tracker of trackers) {
    if (tracker !== 'github' && tracker !== 'jira') {
      console.error(`Unknown tracker "${tracker}": record github, jira, or both.`)
      ok = false
      continue
    }
    if (!(await record(tracker))) ok = false
  }
  if (!ok) process.exit(1)
}
