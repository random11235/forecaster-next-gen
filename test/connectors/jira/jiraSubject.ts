import { jiraConnector } from '../../../src/connectors/jira.js'
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
  ids: Object.values(issues).map((issue) => issue.id),
  batches: manifest.batches,
  roles: {
    // The subtasks carry no fix version of their own: "Checkout v2" reads them as its story's, in the story's place.
    checkout: [
      ...Array.from({ length: 105 }, (_, k) => `leaf-${String(k + 1).padStart(3, '0')}`),
      ...['subtask-1', 'subtask-2', 'subtask-3', 'epic-leaf'],
      ...['reopened-finished', 'reopened-open', 'wont-do-1', 'wont-do-2', 'duplicate', 'both-queries', 'bug'],
    ],
    parents: ['epic', 'story-with-subtasks'],
    // SYN-106 has the story SYN-107 (with the subtasks SYN-109 to SYN-111) and the task SYN-108. A team-managed space
    // nests nothing beneath an epic but stories and their subtasks, so the story stands where GitHub's sub-epic does.
    nestedEpic: { leaves: ['subtask-1', 'subtask-2', 'subtask-3', 'epic-leaf'], underSubEpic: ['subtask-1', 'subtask-2', 'subtask-3'] },
  },
})
