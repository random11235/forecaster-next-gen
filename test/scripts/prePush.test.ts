import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs the pre-push hook (.husky/pre-push) in a fresh directory whose package.json gives `npm run check` a stand-in
// that passes or fails, as a push would run it at the root of a clone.
const root = fileURLToPath(new URL('../..', import.meta.url))
const hook = join(root, '.husky/pre-push')

/** This test's stand-in clone. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-pre-push-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Runs the hook with `npm run check` running `check`, returning its exit code and everything it printed. */
function push(check: string): { code: number | null; output: string } {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'clone', private: true, scripts: { check } }))
  const run = spawnSync('sh', ['-e', hook], { cwd: dir, encoding: 'utf8' })
  return { code: run.status, output: run.stdout + run.stderr }
}

test('a push whose checks fail is refused, showing what failed', () => {
  const { code, output } = push('echo "FAIL test/forecast/pace.test.ts" && exit 1')

  expect(code).not.toBe(0)
  expect(output).toContain('FAIL test/forecast/pace.test.ts')
})

test('a push whose checks pass goes ahead', () => {
  const { code } = push('echo all green')

  expect(code).toBe(0)
})
