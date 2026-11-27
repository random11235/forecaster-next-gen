// Whether the comment that started .github/workflows/factory.yml asks the factory a question (scripts/factoryQuestion.ts):
// writes `asked=true` or `asked=false` to the step's outputs, from the `issue_comment` event GitHub wrote to
// GITHUB_EVENT_PATH.

import { appendFileSync, readFileSync } from 'node:fs'
import { askedIn, type CommentEvent } from './factoryQuestion.ts'

const path = process.env.GITHUB_EVENT_PATH
if (!path) throw new Error('GITHUB_EVENT_PATH is not set')
const asked = askedIn(JSON.parse(readFileSync(path, 'utf8')) as CommentEvent)
console.log(asked ? 'The comment asks the factory a question.' : "The comment doesn't ask the factory anything: nothing to answer.")
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `asked=${asked}\n`)
