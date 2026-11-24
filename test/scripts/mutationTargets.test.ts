import { describe, expect, test } from 'vitest'
import { mutationTargets } from '../../scripts/mutationTargets.ts'

/**
 * `git diff -U0` of one file, as mutateDiff.ts asks for it, with the given hunks. `from` is the path it had, or
 * undefined for a new file; `header` is the file's extended header (`new file mode`, `rename from`), and `paths` how
 * its `---`/`+++` lines name it, when git quotes or pads them.
 */
function diffOf(
  path: string,
  hunks: string[][],
  {
    from = path,
    header = ['index 1111111..2222222 100644'],
    paths = [`a/${from}`, `b/${path}`],
  }: {
    from?: string | undefined
    header?: string[]
    paths?: [string, string]
  } = {},
): string {
  return [
    `diff --git a/${from ?? path} b/${path}`,
    ...header,
    ...(hunks.length === 0 ? [] : [`--- ${from === undefined ? '/dev/null' : paths[0]}`, `+++ ${paths[1]}`]),
    ...hunks.flat(),
  ].join('\n')
}

describe('the lines a branch mutates', () => {
  test('a changed source file is mutated on the lines it changed', () => {
    const diff = diffOf('src/engine/pace.ts', [
      ['@@ -10,2 +10,3 @@ export function pace() {', '+a', '+b', '+c'],
      ['@@ -40 +41 @@', '+d'],
    ])

    expect(mutationTargets(diff, [])).toEqual(['src/engine/pace.ts:10-12', 'src/engine/pace.ts:41-41'])
  })

  test('an added line that starts like a file header is still a line of the same file', () => {
    const diff = diffOf('src/engine/pace.ts', [
      ['@@ -10 +10,2 @@', '+++ b/src/other.ts', '+-- a/src/other.ts'],
      ['@@ -40 +41 @@', '+d'],
    ])

    expect(mutationTargets(diff, [])).toEqual(['src/engine/pace.ts:10-11', 'src/engine/pace.ts:41-41'])
  })

  test('a new file is mutated throughout', () => {
    const diff = diffOf('src/engine/pace.ts', [['@@ -0,0 +1,30 @@', '+line']], { from: undefined, header: ['new file mode 100644'] })

    expect(mutationTargets(diff, [])).toEqual(['src/engine/pace.ts:1-30'])
  })

  test('a file not yet added to git is mutated throughout', () => {
    expect(mutationTargets('', ['src/engine/pace.ts'])).toEqual(['src/engine/pace.ts'])
  })

  test('a file moved with no change is not mutated, and the next file is mutated on its own lines', () => {
    const moved = diffOf('src/pace/pace.ts', [], {
      from: 'src/forecast/pace.ts',
      header: ['similarity index 100%', 'rename from src/forecast/pace.ts', 'rename to src/pace/pace.ts'],
    })
    const changed = diffOf('src/engine/growth.ts', [['@@ -3 +3 @@', '+x']])

    expect(mutationTargets(`${moved}\n${changed}`, [])).toEqual(['src/engine/growth.ts:3-3'])
  })

  test('a file moved and changed is mutated on the lines it changed', () => {
    const diff = diffOf('src/pace/pace.ts', [['@@ -1 +1 @@', "-import { x } from './x.js'", "+import { x } from '../x/index.js'"]], {
      from: 'src/forecast/pace.ts',
      header: ['similarity index 90%', 'rename from src/forecast/pace.ts', 'rename to src/pace/pace.ts', 'index 1111111..2222222 100644'],
    })

    expect(mutationTargets(diff, [])).toEqual(['src/pace/pace.ts:1-1'])
  })

  test('lines only removed leave nothing to mutate', () => {
    expect(mutationTargets(diffOf('src/engine/pace.ts', [['@@ -10,2 +9,0 @@', '-a', '-b']]), [])).toEqual([])
  })

  test('a path git pads with a tab, or quotes, is read as the path it names', () => {
    const spaced = diffOf('src/engine/a b.ts', [['@@ -1 +1 @@', '+x']], { paths: ['a/src/engine/a b.ts\t', 'b/src/engine/a b.ts\t'] })
    const quoted = diffOf('src/engine/"q".ts', [['@@ -2 +2 @@', '+x']], {
      paths: ['"a/src/engine/\\"q\\".ts"', '"b/src/engine/\\"q\\".ts"'],
    })

    expect(mutationTargets(`${spaced}\n${quoted}`, [])).toEqual(['src/engine/a b.ts:1-1', 'src/engine/"q".ts:2-2'])
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
    const diff = changed.map((path) => diffOf(path, [['@@ -1 +1 @@', '+x']])).join('\n')

    expect(mutationTargets(diff, changed)).toEqual([])
  })

  test("the web build's page script is mutated like the rest of the source, as its tests run it (#237)", () => {
    const diff = diffOf('src/app/webMain.ts', [['@@ -1 +1 @@', '+x']])

    expect(mutationTargets(diff, ['src/app/webMain.ts'])).toEqual(['src/app/webMain.ts:1-1', 'src/app/webMain.ts'])
  })
})
