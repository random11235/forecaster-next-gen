// Whether the comment that started .github/workflows/factory.yml asks the factory a question (factory/factoryQuestion.ts):
// writes askedOutputs' lines to the step's outputs, from the `issue_comment` event GitHub wrote to GITHUB_EVENT_PATH,
// or, when REVIEW_COMMENT_JSON is set, from the review comment on a line that factory-relay.yml named, as fetched.

import { appendFileSync, readFileSync } from 'node:fs'
import { factoryConfig } from './factoryConfig.ts'
import { askedOutputs, relayedEvent, type CommentEvent, type ReviewComment } from './factoryQuestion.ts'

const read = (name: string): unknown => {
  const path = process.env[name]
  if (!path) throw new Error(`${name} is not set`)
  return JSON.parse(readFileSync(path, 'utf8'))
}
const event = process.env.REVIEW_COMMENT_JSON ? relayedEvent(read('REVIEW_COMMENT_JSON') as ReviewComment) : (read('GITHUB_EVENT_PATH') as CommentEvent)
const outputs = askedOutputs(event, factoryConfig())
console.log(outputs.startsWith('asked=true') ? 'The comment asks the factory a question.' : "The comment doesn't ask the factory anything: nothing to answer.")
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs)
