import { jiraConnector } from '../../../src/connectors/jira/jiraConnector.js'
import manifest from '../../../scripts/synthetic/manifest-jira.json' with { type: 'json' }
import { JIRA_QUERIES, JIRA_SCENARIOS, type Scenario } from '../../../scripts/record.js'
import type { ContractSubject } from '../connectorContract.js'
import { replayTransport, type Recording } from '../replayTransport.js'
import refusedToken from './recordings/refusedToken.json' with { type: 'json' }
import synthetic from './recordings/synthetic.json' with { type: 'json' }
import unknown from './recordings/unknown.json' with { type: 'json' }

// The Jira connector as the contract suite tests it, replaying what `scripts/record.ts` recorded from the space SYN on
// ralphhockley.atlassian.net. A ticket's id is Jira's numeric id, not its key.

const RECORDINGS: Record<Scenario, Recording[]> = { synthetic, refusedToken, unknown }

/** Recordings keep no headers, so any credential stands in for the one they were recorded with. */
const REPLAYED_CREDENTIAL = 'replayed@example.invalid:replayed-token'

function replaying(scenario: Scenario) {
  return jiraConnector(JIRA_SCENARIOS[scenario].connection, REPLAYED_CREDENTIAL, replayTransport(RECORDINGS[scenario]))
}

const issues: Record<string, { id: string }> = manifest.issues

export const jiraSubject: ContractSubject = {
  synthetic: () => replaying('synthetic'),
  refusedToken: () => replaying('refusedToken'),
  unknown: () => replaying('unknown'),
  unreachable: () =>
    jiraConnector(JIRA_SCENARIOS.synthetic.connection, REPLAYED_CREDENTIAL, async () => {
      throw new TypeError('fetch failed')
    }),
  unrecorded: () => jiraConnector(JIRA_SCENARIOS.synthetic.connection, REPLAYED_CREDENTIAL, replayTransport([])),
  queries:JIRA_QUERIES,
  idOf: (role) => {
    const issue = issues[role]
    if (!issue) throw new Error(`No synthetic issue has the role ${role}`)
    return issue.id
  },
  batches: { laterStart: manifest.batches.later_start, laterEnd: manifest.batches.later_end, cut: manifest.batches.cut },
}
