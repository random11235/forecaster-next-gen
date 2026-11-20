import { describe, expect, test } from 'vitest'
import { mutationTargets } from '../../scripts/mutationTargets.ts'

/** `git diff -U0` of one file, with the hunks given as [start, count] of the lines it now has. */
function diffOf(path: string, hunks: [number, number][]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks.map(([start, count]) => `@@ -1,1 +${start}${count === 1 ? '' : `,${count}`} @@`),
    '+changed',
  ].join('\n')
}

describe('the files a branch mutates', () => {
  test('a changed source file is mutated in the lines it changes', () => {
    expect(
      mutationTargets(
        diffOf('src/engine/pace.ts', [
          [3, 1],
          [10, 4],
        ]),
        [],
      ),
    ).toEqual(['src/engine/pace.ts:3-3', 'src/engine/pace.ts:10-13'])
  })

  test('a moved file is mutated only in the lines it changes, so code it moves unchanged is not instrumented', () => {
    const moved = [
      'diff --git a/src/engine/simulate.ts b/src/engine/lib/simulate.ts',
      'similarity index 99%',
      'rename from src/engine/simulate.ts',
      'rename to src/engine/lib/simulate.ts',
      '--- a/src/engine/simulate.ts',
      '+++ b/src/engine/lib/simulate.ts',
      '@@ -3 +3 @@',
      "+import { createRandom } from '../random.js'",
      'diff --git a/src/engine/dates.ts b/src/engine/lib/dates.ts',
      'similarity index 100%',
      'rename from src/engine/dates.ts',
      'rename to src/engine/lib/dates.ts',
    ].join('\n')
    expect(mutationTargets(moved, [])).toEqual(['src/engine/lib/simulate.ts:3-3'])
  })

  test('a file whose change only deletes lines has nothing to mutate', () => {
    expect(mutationTargets(diffOf('src/engine/pace.ts', [[7, 0]]), [])).toEqual([])
  })

  test('a new file not yet committed is mutated whole', () => {
    expect(mutationTargets('', ['src/forecast/lib/new.ts'])).toEqual(['src/forecast/lib/new.ts'])
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
    expect(mutationTargets(changed.map((path) => diffOf(path, [[1, 1]])).join('\n'), changed)).toEqual([])
  })

  test('a diff naming files without the a/ and b/ prefixes it is read with is refused, not taken as nothing to mutate', () => {
    const mnemonic = diffOf('src/engine/pace.ts', [[3, 1]])
      .replace('--- a/', '--- i/')
      .replace('+++ b/', '+++ w/')
    expect(() => mutationTargets(mnemonic, [])).toThrow('the diff names a file without the b/ prefix: +++ w/src/engine/pace.ts')
  })

  test('an added line that itself starts with ++ is a change in the file, not a file the diff names', () => {
    const diff = [
      'diff --git a/src/engine/pace.ts b/src/engine/pace.ts',
      '--- a/src/engine/pace.ts',
      '+++ b/src/engine/pace.ts',
      '@@ -1,0 +2,2 @@',
      '+++ b/src/engine/other.ts',
      '+++ count',
      '@@ -9 +11 @@',
      '+changed',
    ].join('\n')
    expect(mutationTargets(diff, [])).toEqual(['src/engine/pace.ts:2-3', 'src/engine/pace.ts:11-11'])
  })

  test("the web build's page script, which only its demo checks, is not mutated", () => {
    const diff = [diffOf('src/app/webMain.ts', [[1, 1]]), diffOf('src/app/webApp.ts', [[1, 1]])].join('\n')
    expect(mutationTargets(diff, [])).toEqual(['src/app/webApp.ts:1-1'])
  })
})
