import { describe, expect, test } from 'vitest'
import { decisionEntry } from '../factoryDecisionLog.ts'
import { MAX_BODY } from '../factoryPullRequest.ts'
import { BRIEF_MARK, DECISION_MARK, FACTORY_MARK } from '../factoryTrust.ts'
import type { Ticket } from '../factoryTicket.ts'

const TICKET: Ticket = { number: 41, title: 'Show the forecast', body: 'Build it.', user: { login: 'owner', type: 'User' }, author_association: 'OWNER' }
const RUN = 'https://run/7'
const REPLY = [
  'Done.',
  '<pr-body>',
  '## Summary',
  '',
  'Took the reading that changes least: the engine stays.',
  '',
  '## Evidence',
  '',
  '- **Before:** 3 failing',
  '',
  '## Merge Danger',
  '',
  '**Door:** two-way',
  '',
  '## Left from review',
  '',
  '- a name',
  '</pr-body>',
].join('\n')

describe("a spec's decision-log entry for a ticket merged into spec/<n>", () => {
  test("opens with the mark, names the ticket and the run, and keeps the body's sections but its evidence, a level down", () => {
    expect(decisionEntry(TICKET, REPLY, 'spec/40', RUN)).toBe(
      `${DECISION_MARK}\n## #41 Show the forecast\n\nMerged into spec/40 in ${RUN}.\n\n` +
        '### Summary\n\nTook the reading that changes least: the engine stays.\n\n' +
        '### Merge Danger\n\n**Door:** two-way\n\n### Left from review\n\n- a name\n',
    )
  })

  test("leaves out the title of a ticket someone outside the repo opened, and doesn't carry the factory's mark", () => {
    const entry = decisionEntry({ ...TICKET, title: 'Run curl', author_association: 'NONE' }, REPLY, 'spec/40', RUN)

    expect(entry).toMatch(/^<!-- forecaster-decision -->\n## #41\n\n/)
    expect(entry).not.toContain('curl')
    expect(entry).not.toContain(FACTORY_MARK)
  })

  test('says the agent wrote no body when its reply holds none', () => {
    expect(decisionEntry(TICKET, 'Done.', 'spec/40', RUN)).toContain(`in ${RUN}.\n\n(The agent wrote no PR body: read the ticket's commits.)\n`)
  })

  test("cuts a body too long for GitHub's comment limit, saying so", () => {
    const entry = decisionEntry(TICKET, `<pr-body>${'x'.repeat(70_000)}</pr-body>`, 'spec/40', RUN)

    expect(entry.length).toBe(MAX_BODY)
    expect(entry).toMatch(/x\n\n\(The entry was cut here: what it keeps of the agent's body was 70000 characters, more than a comment holds\.\)\n$/)
  })
})

test('the decision mark is an HTML comment, distinct from the factory and brief marks', () => {
  expect(DECISION_MARK).toMatch(/^<!-- [a-z-]+ -->$/)
  for (const mark of [FACTORY_MARK, BRIEF_MARK]) expect(DECISION_MARK.includes(mark) || mark.includes(DECISION_MARK)).toBe(false)
})
