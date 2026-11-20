import { describe, expect, test } from 'vitest'
import { mutationTargets } from '../../scripts/mutationTargets.ts'

/** `git diff -U0` of one file, with the given hunk headers. */
function diffOf(path: string, ...hunks: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks.flatMap((hunk) => [hunk, '+changed']),
  ].join('\n')
}

describe('the lines a branch mutates', () => {
  test('a changed source file is mutated on the lines it changed', () => {
    const diff = diffOf('src/engine/pace.ts', '@@ -10,2 +10,3 @@ export function pace() {', '@@ -40 +41 @@')

    expect(mutationTargets(diff, [])).toEqual(['src/engine/pace.ts:10-12', 'src/engine/pace.ts:41-41'])
  })

  test('a new file is mutated throughout', () => {
    const diff = [
      'diff --git a/src/engine/pace.ts b/src/engine/pace.ts',
      'new file mode 100644',
      'index 0000000..2222222',
      '--- /dev/null',
      '+++ b/src/engine/pace.ts',
      '@@ -0,0 +1,30 @@',
      '+line',
    ].join('\n')

    expect(mutationTargets(diff, [])).toEqual(['src/engine/pace.ts:1-30'])
  })

  test('a file not yet added to git is mutated throughout', () => {
    expect(mutationTargets('', ['src/engine/pace.ts'])).toEqual(['src/engine/pace.ts'])
  })

  test('a file moved with no change is not mutated', () => {
    const diff = [
      'diff --git a/src/forecast/pace.ts b/src/pace/pace.ts',
      'similarity index 100%',
      'rename from src/forecast/pace.ts',
      'rename to src/pace/pace.ts',
    ].join('\n')

    expect(mutationTargets(diff, [])).toEqual([])
  })

  test('a file moved and changed is mutated on the lines it changed', () => {
    const diff = [
      'diff --git a/src/forecast/pace.ts b/src/pace/pace.ts',
      'similarity index 90%',
      'rename from src/forecast/pace.ts',
      'rename to src/pace/pace.ts',
      'index 1111111..2222222 100644',
      '--- a/src/forecast/pace.ts',
      '+++ b/src/pace/pace.ts',
      '@@ -1 +1 @@',
      "-import { x } from './x.js'",
      "+import { x } from '../x/index.js'",
    ].join('\n')

    expect(mutationTargets(diff, [])).toEqual(['src/pace/pace.ts:1-1'])
  })

  test('lines only removed leave nothing to mutate', () => {
    expect(mutationTargets(diffOf('src/engine/pace.ts', '@@ -10,2 +9,0 @@'), [])).toEqual([])
  })

  test('files outside src, and files in it that are not TypeScript, are not mutated', () => {
    const changed = [
      'test/engine/pace.test.ts',
      'scripts/checkChanges.ts',
      'docs/design/README.md',
      'package.json',
      'src/connectors/canned/demoFixture.json',
      'src/app/styles.css',
    ]
    const diff = changed.map((path) => diffOf(path, '@@ -1 +1 @@')).join('\n')

    expect(mutationTargets(diff, changed)).toEqual([])
  })

  test("the web build's page script, which only its demo checks, is not mutated", () => {
    const diff = diffOf('src/app/webMain.ts', '@@ -1 +1 @@') + '\n' + diffOf('src/app/webApp.ts', '@@ -1 +1 @@')

    expect(mutationTargets(diff, ['src/app/webMain.ts'])).toEqual(['src/app/webApp.ts:1-1'])
  })
})
