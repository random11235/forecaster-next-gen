// The factory's next step on a spec (scripts/factoryFrontier.ts), run by .github/workflows/factory.yml's gate. SPEC_JSON
// is what `gh api graphql` gave for the spec's sub-issues; it writes `action` (build, open-pr or stop), and `ticket` or
// `why`, to the step's outputs.

import { appendFileSync, readFileSync } from 'node:fs'
import { nextStep, type SubIssue } from './factoryFrontier.ts'

const path = process.env.SPEC_JSON
if (!path) throw new Error('SPEC_JSON is not set')
const response = JSON.parse(readFileSync(path, 'utf8')) as { data: { repository: { issue: { subIssues: { nodes: SubIssue[] } } } } }
const next = nextStep(response.data.repository.issue.subIssues.nodes)
const lines = Object.entries(next).map(([name, value]) => `${name}=${String(value)}`)
console.log(lines.join('\n'))
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
