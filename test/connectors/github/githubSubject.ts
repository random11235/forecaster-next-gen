import { githubConnector } from '../../../src/connectors/github/githubConnector.js'
import manifest from '../../../scripts/synthetic/manifest-github.json' with { type: 'json' }
import { replayedSubject } from '../connectorContract.js'
import { GITHUB_CASES } from '../scenarios.js'
import refusedToken from './recordings/refusedToken.json' with { type: 'json' }
import synthetic from './recordings/synthetic.json' with { type: 'json' }
import unknown from './recordings/unknown.json' with { type: 'json' }

// The GitHub connector as the contract suite tests it, replaying what `scripts/record.ts` recorded from
// random11235/forecaster-synthetic. A ticket's id is its node id.

const issues: Record<string, { node_id: string }> = manifest.issues

export const githubSubject = replayedSubject({
  connect: githubConnector,
  cases: GITHUB_CASES,
  recordings: { synthetic, refusedToken, unknown },
  idOf: (role) => issues[role]?.node_id,
  batches: manifest.batches,
})
