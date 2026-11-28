// The factory's next step on a spec (factory/factoryFrontier.ts), run by .github/workflows/factory.yml's gate. SPEC is
// the spec's number, SPEC_JSON what `gh api graphql` gave for its sub-issues, and HOP how many runs chained before this
// one (0, or unset, for a run its label started); it writes `action` (build, open-pr or stop), and `ticket` or `why`,
// to the step's outputs.

import { appendFileSync, readFileSync } from 'node:fs'
import { nextStep, stepOutputs, subIssuesOf, type SubIssuesResponse } from './factoryFrontier.ts'

const path = process.env.SPEC_JSON
const spec = Number(process.env.SPEC)
if (!path) throw new Error('SPEC_JSON is not set')
const hop = Number(process.env.HOP || 0)
if (!Number.isInteger(spec) || spec <= 0) throw new Error('SPEC is not an issue number')
if (!Number.isInteger(hop) || hop < 0) throw new Error('HOP is not a count of runs')
const outputs = stepOutputs(nextStep(spec, subIssuesOf(JSON.parse(readFileSync(path, 'utf8')) as SubIssuesResponse), hop))
console.log(outputs)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs)
