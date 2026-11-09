import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// The recording script's command line, run as `npm run record` runs it: by node directly, not through vitest. Node
// loads the files it imports from src/ and test/ as they are, so this fails if one of them gains a runtime import.

const root = fileURLToPath(new URL('../..', import.meta.url))

test('the recording script loads under node, and refuses a tracker it does not know without recording anything', () => {
  const run = spawnSync(process.execPath, ['scripts/record.ts', 'trello'], { cwd: root, encoding: 'utf8' })

  expect(run.stderr).toContain('Unknown tracker "trello": record github, jira, or all of them.')
  expect(run.stdout).toBe('')
  expect(run.status).toBe(1)
})
