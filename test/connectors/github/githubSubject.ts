import { githubConnector } from '../../../src/connectors/github.js'
import manifest from '../../../scripts/synthetic/manifest-github.json' with { type: 'json' }
import type { Transport } from '../../../src/connectors/connector.js'
import { json, noWait } from '../backoff.js'
import { REPLAYED_CREDENTIAL, replayedSubject } from '../connectorContract.js'
import { GITHUB_CASES } from '../scenarios.js'
import refusedToken from './recordings/refusedToken.json' with { type: 'json' }
import synthetic from './recordings/synthetic.json' with { type: 'json' }
import unknown from './recordings/unknown.json' with { type: 'json' }

// The GitHub connector as the contract suite tests it, replaying what `scripts/record.ts` recorded from
// random11235/forecaster-synthetic. A ticket's id is its node id.

const issues: Record<string, { node_id: string }> = manifest.issues

/**
 * A GitHub whose search finds 1,500 issues: as GitHub does, it gives pages of them up to the 1,000th result, and
 * refuses a page past it. The synthetic repo has too few issues to reach the cap, so this stands in for one that has.
 */
const searchCapped: Transport = async (url) => {
  const page = Number(new URL(url).searchParams.get('page') ?? '1')
  const per = Number(new URL(url).searchParams.get('per_page') ?? '30')
  if (page * per > 1000) return json(422, { message: 'Cannot access beyond the first 1000 results, or the 1000th result.' })
  const items = Array.from({ length: per }, (_, k) => ({ node_id: `I_capped_${page}_${k}`, state: 'open', closed_at: null }))
  return json(200, { total_count: 1500, incomplete_results: false, items })
}

export const githubSubject = replayedSubject({
  connect: githubConnector,
  cases: GITHUB_CASES,
  recordings: { synthetic, refusedToken, unknown },
  idOf: (role) => issues[role]?.node_id,
  ids: Object.values(issues).map((issue) => issue.node_id),
  batches: manifest.batches,
  capped: () => githubConnector(GITHUB_CASES.scenarios.synthetic.connection, REPLAYED_CREDENTIAL, searchCapped, noWait),
  roles: {
    checkout: [
      ...Array.from({ length: 105 }, (_, k) => `leaf-${String(k + 1).padStart(3, '0')}`),
      ...['child-1', 'child-2', 'child-3', 'epic-leaf'],
      ...['reopened-finished', 'reopened-open', 'not-planned-1', 'not-planned-2', 'duplicate', 'both-queries'],
    ],
    parents: ['epic', 'parent'],
    // #106 has the sub-epic #107 (with #108 to #110) and the leaf #111.
    nestedEpic: { leaves: ['child-1', 'child-2', 'child-3', 'epic-leaf'], underSubEpic: ['child-1', 'child-2', 'child-3'] },
  },
})
