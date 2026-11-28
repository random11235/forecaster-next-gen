// What the `close` job of .github/workflows/factory.yml does once a spec's PR merges (factory/factorySpecMerged.ts).
// `node factory/factorySpecClose.ts spec` reads the `pull_request_target` event (GITHUB_EVENT_PATH) and writes `spec`, the
// spec whose PR merged, to the step's outputs, or nothing if the PR isn't a spec's. `node factory/factorySpecClose.ts
// plan` reads SPEC_JSON, the spec as GitHub's REST API gives it, and SUB_ISSUES_JSON, `gh api --paginate --slurp`'s
// pages of its sub-issues, and writes the plan's lines to PLAN, or `none=true` to the outputs if it has no tickets.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { closingLines, closingPlan, mergedSpec, type ClosedPullRequest, type Issue } from './factorySpecMerged.ts'

const read = <T>(name: string): T => {
  const path = process.env[name]
  if (!path) throw new Error(`${name} is not set`)
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
const output = (line: string) => {
  console.log(line)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`)
}

if (process.argv[2] === 'spec') {
  const event = read<{ pull_request: ClosedPullRequest; repository: { default_branch: string } }>('GITHUB_EVENT_PATH')
  const spec = mergedSpec(event.pull_request, event.repository.default_branch)
  if (spec !== undefined) output(`spec=${spec}`)
} else if (process.argv[2] === 'plan') {
  if (!process.env.PLAN) throw new Error('PLAN is not set')
  const plan = closingPlan(read<Issue>('SPEC_JSON'), read<Issue[][]>('SUB_ISSUES_JSON').flat())
  writeFileSync(process.env.PLAN, plan ? closingLines(plan) : '')
  if (plan) console.log(closingLines(plan))
  else {
    console.log('::notice::The issue spec/<n> names has no tickets (sub-issues), so it is no spec: nothing to close.')
    output('none=true')
  }
} else {
  throw new Error('say `spec` or `plan`')
}
