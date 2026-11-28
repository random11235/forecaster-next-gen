// The title and body of a spec's PR to the default branch (factory/factorySpecPullRequest.ts), for the `propose` job of
// .github/workflows/factory.yml. SPEC_JSON is the spec as GitHub's REST API gives it, SUB_ISSUES_JSON its sub-issues,
// `gh api --paginate --slurp`'s pages; RUN_URL is the run. It writes `title` and `body.md` into OUT_DIR.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { specPullRequest, type SpecTicket } from './factorySpecPullRequest.ts'

const read = <T>(name: string): T => {
  const path = process.env[name]
  if (!path) throw new Error(`${name} is not set`)
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
const out = process.env.OUT_DIR
if (!out) throw new Error('OUT_DIR is not set')
const { title, body } = specPullRequest(read<SpecTicket>('SPEC_JSON'), read<SpecTicket[][]>('SUB_ISSUES_JSON').flat(), process.env.RUN_URL ?? '')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'title'), title)
writeFileSync(join(out, 'body.md'), body)
console.log(title)
