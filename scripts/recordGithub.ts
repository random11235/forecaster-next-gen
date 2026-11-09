// Records the raw GitHub responses Seam C's contract suite replays (#172). Run with `npm run record:github`, which
// builds the app first; re-running it refreshes the recordings in test/connectors/github/recordings/.
//
// It runs the GitHub connector's own requests against the synthetic repo random11235/forecaster-synthetic only (seeded
// by scripts/synthetic/seed_github.py), with the token from the macOS Keychain item `forecaster-github-recording`, and
// keeps each response's status and only the fields the connector reads. The token goes in request headers, which are
// never recorded, and is never written or printed.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Connection, Transport } from '../src/connectors/connector.js'
import type { githubConnector } from '../src/connectors/github/githubConnector.js'
import type { Recording } from '../test/connectors/replayTransport.js'

const KEYCHAIN_SERVICE = 'forecaster-github-recording'
const TOKEN_EXPIRES = '2026-12-07'

/** A token GitHub refuses, for recording the refusal. */
const REFUSED_TOKEN = 'forecaster-refused-token'

const SYNTHETIC: Extract<Connection, { tracker: 'github' }> = { tracker: 'github', owner: 'random11235', repo: 'forecaster-synthetic' }

/** The queries the contract suite reads, in GitHub's search syntax (see `ContractSubject`). */
export const GITHUB_QUERIES = {
  searchRevamp: 'milestone:"Search revamp"',
  nothing: 'label:"no such label"',
  invalid: 'closed:>2026-13-45',
  outOfScope: 'repo:random11235/forecaster-next-gen',
}

export type GithubScenario = 'synthetic' | 'refusedToken' | 'unknown'

/** Each recording: the connection and token it is made with, and the queries read on it after the milestone choices. */
export const GITHUB_SCENARIOS: Record<GithubScenario, { connection: typeof SYNTHETIC; token: string; reads: string[] }> = {
  synthetic: { connection: SYNTHETIC, token: 'recording', reads: Object.values(GITHUB_QUERIES) },
  refusedToken: { connection: SYNTHETIC, token: REFUSED_TOKEN, reads: [GITHUB_QUERIES.searchRevamp] },
  unknown: { connection: { ...SYNTHETIC, repo: 'forecaster-synthetic-unknown' }, token: 'recording', reads: [GITHUB_QUERIES.searchRevamp] },
}

const REFUSED_MESSAGE = [
  `GitHub refused the recording token (Keychain item "${KEYCHAIN_SERVICE}"). It may have expired: the token made for`,
  `this expires on ${TOKEN_EXPIRES}. Make a fine-grained token with read-only Issues access to`,
  `random11235/forecaster-synthetic, then store it with:`,
  `  security add-generic-password -U -a "$USER" -s ${KEYCHAIN_SERVICE} -w`,
  'Nothing was recorded.',
].join('\n')

type Body = Record<string, unknown>

function pick(body: unknown, fields: string[]): Body {
  const source = body as Body
  return Object.fromEntries(fields.filter((field) => field in source).map((field) => [field, source[field]]))
}

/** A response body cut to the fields the connector reads: what the recordings keep. */
function trim(url: string, status: number, body: unknown): unknown {
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

/** `transport`, keeping each request (without its headers) and the trimmed response it got. */
function recording(transport: Transport): { transport: Transport; recordings: Recording[] } {
  const recordings: Recording[] = []
  return {
    recordings,
    transport: async (url, init) => {
      const response = await transport(url, init)
      const body: unknown = await response.json()
      const method = init?.method ?? 'GET'
      if (!recordings.some(({ request }) => request.method === method && request.url === url)) {
        recordings.push({ request: { method, url }, response: { status: response.status, body: trim(url, response.status, body) } })
      }
      return new Response(JSON.stringify(body), { status: response.status, headers: response.headers })
    },
  }
}

/** Runs each scenario's requests through `transport`, recording them; or says plainly that the token was refused. */
export async function recordGithub(
  token: string,
  transport: Transport,
  github: typeof githubConnector,
): Promise<{ ok: true; recordings: Record<GithubScenario, Recording[]> } | { ok: false; message: string }> {
  const recordings = {} as Record<GithubScenario, Recording[]>
  for (const [scenario, { connection, token: scenarioToken, reads }] of Object.entries(GITHUB_SCENARIOS)) {
    const recorder = recording(transport)
    const connector = github(connection, scenarioToken === 'recording' ? token : scenarioToken, recorder.transport)
    const choices = await connector.milestoneChoices()
    if (scenario === 'synthetic' && !choices.ok && choices.failure === 'unauthorised') return { ok: false, message: REFUSED_MESSAGE }
    for (const query of reads) await connector.read(query, '1970-01-01T00:00:00Z')
    recordings[scenario as GithubScenario] = recorder.recordings
  }
  return { ok: true, recordings }
}

if (import.meta.main) {
  let token: string
  try {
    token = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    console.error(`No recording token in the macOS Keychain under "${KEYCHAIN_SERVICE}". Store one with:`)
    console.error(`  security add-generic-password -U -a "$USER" -s ${KEYCHAIN_SERVICE} -w`)
    process.exit(1)
  }
  const { githubConnector: github }: typeof import('../src/connectors/github/githubConnector.js') = await import(
    new URL('../dist/connectors/github/githubConnector.js', import.meta.url).href
  )
  const result = await recordGithub(token, fetch, github)
  if (!result.ok) {
    console.error(result.message)
    process.exit(1)
  }
  const dir = new URL('../test/connectors/github/recordings/', import.meta.url)
  mkdirSync(dir, { recursive: true })
  for (const [scenario, recordings] of Object.entries(result.recordings)) {
    writeFileSync(new URL(`${scenario}.json`, dir), `${JSON.stringify(recordings, null, 2)}\n`)
    console.log(`Recorded ${recordings.length} responses in test/connectors/github/recordings/${scenario}.json`)
  }
}
