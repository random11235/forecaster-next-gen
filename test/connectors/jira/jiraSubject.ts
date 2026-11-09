import { jiraConnector } from '../../../src/connectors/jira/jiraConnector.js'
import manifest from '../../../scripts/synthetic/manifest-jira.json' with { type: 'json' }
import { replayedSubject } from '../connectorContract.js'
import { JIRA_CASES } from '../scenarios.js'
import refusedToken from './recordings/refusedToken.json' with { type: 'json' }
import synthetic from './recordings/synthetic.json' with { type: 'json' }
import unknown from './recordings/unknown.json' with { type: 'json' }

// The Jira connector as the contract suite tests it, replaying what `scripts/record.ts` recorded from the space SYN on
// ralphhockley.atlassian.net. A ticket's id is Jira's numeric id, not its key.

const issues: Record<string, { id: string }> = manifest.issues

export const jiraSubject = replayedSubject({
  connect: jiraConnector,
  cases: JIRA_CASES,
  recordings: { synthetic, refusedToken, unknown },
  idOf: (role) => issues[role]?.id,
  batches: manifest.batches,
})
