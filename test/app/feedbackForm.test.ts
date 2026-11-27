import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// Send feedback opens `.github/ISSUE_TEMPLATE/feedback.yml` (#389), naming its fields in its link
// (test/app/components/htmlPage.feedback.test.ts). GitHub reads the form; this checks the parts the link and triage
// count on, line by line, as the repo has no YAML parser.
const form = readFileSync(new URL('../../.github/ISSUE_TEMPLATE/feedback.yml', import.meta.url), 'utf8')

test('the Feedback form titles its issue Feedback and labels it feedback and needs-triage, for any reporter', () => {
  expect(form).toMatch(/^title: 'Feedback: '$/m)
  expect(form).toMatch(/^labels: \[feedback, needs-triage\]$/m)
})

test('it has the version and screen fields that Send feedback fills in', () => {
  expect(form).toMatch(/^ {4}id: version$/m)
  expect(form).toMatch(/^ {4}id: screen$/m)
})
