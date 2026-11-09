import { githubConnector } from '../../../src/connectors/github/githubConnector.js'
import manifest from '../../../scripts/synthetic/manifest-github.json' with { type: 'json' }
import { GITHUB_QUERIES, GITHUB_SCENARIOS, type Scenario } from '../../../scripts/record.js'
import type { ContractSubject } from '../connectorContract.js'
import { replayTransport, type Recording } from '../replayTransport.js'
import refusedToken from './recordings/refusedToken.json' with { type: 'json' }
import synthetic from './recordings/synthetic.json' with { type: 'json' }
import unknown from './recordings/unknown.json' with { type: 'json' }

// The GitHub connector as the contract suite tests it, replaying what `scripts/record.ts` recorded from
// random11235/forecaster-synthetic.

const RECORDINGS: Record<Scenario, Recording[]> = { synthetic, refusedToken, unknown }

function replaying(scenario: Scenario) {
  const { connection, token } = GITHUB_SCENARIOS[scenario]
  return githubConnector(connection, token === 'recording' ? 'replayed-token' : token, replayTransport(RECORDINGS[scenario]))
}

const issues: Record<string, { node_id: string }> = manifest.issues

export const githubSubject: ContractSubject = {
  synthetic: () => replaying('synthetic'),
  refusedToken: () => replaying('refusedToken'),
  unknown: () => replaying('unknown'),
  unreachable: () =>
    githubConnector(GITHUB_SCENARIOS.synthetic.connection, 'replayed-token', async () => {
      throw new TypeError('fetch failed')
    }),
  queries: GITHUB_QUERIES,
  idOf: (role) => {
    const issue = issues[role]
    if (!issue) throw new Error(`No synthetic issue has the role ${role}`)
    return issue.node_id
  },
  batches: { laterStart: manifest.batches.later_start, laterEnd: manifest.batches.later_end, cut: manifest.batches.cut },
}
