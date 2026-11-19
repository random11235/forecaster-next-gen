import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { moduleDepths, SHALLOWEST_LISTED, shallowestModules } from '../../scripts/moduleDepth.ts'
import { typeScriptSourcesUnder } from '../../scripts/sourceFiles.ts'

/** A source file of `lines` code lines, each ending in a newline, the first ones `head`. */
const sourceOf = (lines: number, ...head: string[]): string =>
  [...head, ...Array<string>(lines - head.length).fill('hidden()')].map((line) => `${line}\n`).join('')

describe('module depth', () => {
  test("an entry point at a module's root counts its exported functions and types, and its own lines", () => {
    const depths = moduleDepths({
      'forecast/inputs.ts': sourceOf(
        10,
        'export function a() {}',
        'export async function b() {}',
        'export interface C {}',
        'export type D = 1',
        'function hidden() {}',
      ),
    })

    expect(depths).toEqual([{ file: 'forecast/inputs.ts', exports: 4, lines: 10 }])
  })

  test('lines hidden are code lines: blank lines and comments, line or block, do not count', () => {
    const source = [
      '// A line comment',
      '/**',
      ' * A block comment, over lines',
      ' */',
      '',
      'export function a() {} // code, with a comment after it',
      '   ',
      '/* a block comment on one line */',
      'const b = 1 /* code, with a block comment after it */',
      '/* a block comment that ends before code */ const c = 2',
      '',
    ].join('\n')

    expect(moduleDepths({ 'model/dates.ts': source })).toEqual([{ file: 'model/dates.ts', exports: 1, lines: 3 }])
  })

  test('a function kept in a const, a class and an enum count; a constant does not', () => {
    const depths = moduleDepths({
      'model/dates.ts': sourceOf(
        6,
        'export const a = (x: number): number => x',
        'export const b = async () => {}',
        'export class C {}',
        'export enum D {}',
        'export const LIMIT = 5',
      ),
    })

    expect(depths).toEqual([{ file: 'model/dates.ts', exports: 4, lines: 6 }])
  })

  test('a function expression and a generic arrow kept in a const count', () => {
    const depths = moduleDepths({
      'model/dates.ts': sourceOf(2, 'export const a = function (x: number) { return x }', 'export const b = <T>(x: T): T => x'),
    })

    expect(depths).toEqual([{ file: 'model/dates.ts', exports: 2, lines: 2 }])
  })

  test('a name in an export list counts by what it is where it is declared: a function or type does, a constant does not', () => {
    const depths = moduleDepths({
      'engine/index.ts': sourceOf(1, "export { simulateCase, ENGINE_VERSION, type Case as SimulationCase } from './simulate.js'"),
      'engine/simulate.ts': sourceOf(3, 'export function simulateCase() {}', "export const ENGINE_VERSION = '1'", 'export interface Case {}'),
    })

    expect(depths).toEqual([{ file: 'engine/index.ts', exports: 2, lines: 4 }])
  })

  test('an export list naming its own declarations counts them by what they are', () => {
    const depths = moduleDepths({
      'model/team.ts': sourceOf(4, 'const local = () => 1', 'const LIMIT = 5', 'type Local = 1', 'export { local, LIMIT, type Local }'),
    })

    expect(depths).toEqual([{ file: 'model/team.ts', exports: 2, lines: 4 }])
  })

  test('names passed on from one file in two export lists all count', () => {
    const depths = moduleDepths({
      'engine/index.ts': sourceOf(2, "export { a } from './x.js'", "export { b } from './x.js'"),
      'engine/x.ts': sourceOf(2, 'export function a() {}', 'export function b() {}'),
    })

    expect(depths).toEqual([{ file: 'engine/index.ts', exports: 2, lines: 4 }])
  })

  test('a const typed as a function, and a nameless default function or class, count', () => {
    const depths = moduleDepths({
      'model/a.ts': sourceOf(2, 'export const g: (x: number) => number = (x) => x', 'export const LIMIT: number = 5'),
      'model/b.ts': sourceOf(1, 'export default function (x: number) {}'),
      'model/c.ts': sourceOf(1, 'export default class {}'),
    })

    expect(depths.map(({ file, exports }) => ({ file, exports }))).toEqual([
      { file: 'model/a.ts', exports: 1 },
      { file: 'model/b.ts', exports: 1 },
      { file: 'model/c.ts', exports: 1 },
    ])
  })

  test("a namespace passed on with `export * as` counts the other file's functions and types", () => {
    const depths = moduleDepths({
      'engine/index.ts': sourceOf(1, "export * as types from './types.js'"),
      'engine/types.ts': sourceOf(3, 'export interface A {}', 'export type B = 1', 'export const C = 2'),
    })

    expect(depths).toEqual([{ file: 'engine/index.ts', exports: 2, lines: 4 }])
  })

  test("everything it passes on with `export *` counts as the other file's exports do", () => {
    const depths = moduleDepths({
      'engine/index.ts': sourceOf(1, "export * from './types.js'"),
      'engine/types.ts': sourceOf(3, 'export interface A {}', 'export type B = 1', 'export const C = 2'),
    })

    expect(depths).toEqual([{ file: 'engine/index.ts', exports: 2, lines: 4 }])
  })

  test('what it imports from its lib/, and what those import there, is hidden behind it; a lib/ file is no entry point', () => {
    const depths = moduleDepths({
      'forecast/trackerReads.ts': sourceOf(10, "import { paceOf } from './lib/pace.js'"),
      'forecast/lib/pace.ts': sourceOf(20, "import { counts } from './periodCounts.js'"),
      'forecast/lib/periodCounts.ts': sourceOf(30),
      'forecast/lib/unused.ts': sourceOf(100),
    })

    expect(depths).toEqual([{ file: 'forecast/trackerReads.ts', exports: 0, lines: 60 }])
  })

  test('what it loads with a dynamic import is hidden behind it too', () => {
    const depths = moduleDepths({
      'app/main.ts': sourceOf(4, "const { serve } = await import('./lib/serve.js')"),
      'app/lib/serve.ts': sourceOf(20),
    })

    expect(depths).toEqual([{ file: 'app/main.ts', exports: 0, lines: 24 }])
  })

  test('a sibling it imports is not hidden behind it, but is an entry point of its own', () => {
    const depths = moduleDepths({
      'forecast/trackerReads.ts': sourceOf(10, "import { inputs } from './inputs.js'"),
      'forecast/inputs.ts': sourceOf(5),
    })

    expect(depths).toEqual([
      { file: 'forecast/trackerReads.ts', exports: 0, lines: 10 },
      { file: 'forecast/inputs.ts', exports: 0, lines: 5 },
    ])
  })

  test("another module's file it imports is not hidden behind it", () => {
    const depths = moduleDepths({
      'forecast/trackerReads.ts': sourceOf(10, "import type { Team } from '../model/team.js'"),
      'model/team.ts': sourceOf(7),
    })

    expect(depths).toEqual([
      { file: 'forecast/trackerReads.ts', exports: 0, lines: 10 },
      { file: 'model/team.ts', exports: 0, lines: 7 },
    ])
  })

  test("a connector's entry point hides its connector's folder, not another connector's", () => {
    const depths = moduleDepths({
      'connectors/github.ts': sourceOf(
        3,
        "import { githubConnector } from './github/githubConnector.js'",
        "import { jiraConnector } from './jira/jiraConnector.js'",
      ),
      'connectors/github/githubConnector.ts': sourceOf(40, "import { send } from '../remote.js'"),
      'connectors/jira/jiraConnector.ts': sourceOf(50),
      'connectors/remote.ts': sourceOf(8),
    })

    expect(depths).toEqual([
      { file: 'connectors/github.ts', exports: 0, lines: 43 },
      { file: 'connectors/remote.ts', exports: 0, lines: 8 },
    ])
  })

  test("a module with an index.ts has it as its one entry point, hiding each of the module's files it reaches", () => {
    const depths = moduleDepths({
      'engine/index.ts': sourceOf(2, "export { simulateCase } from './simulate.js'"),
      'engine/simulate.ts': sourceOf(50, "import { periodEndDate } from './dates.js'", 'export function simulateCase() {}'),
      'engine/dates.ts': sourceOf(20, "import { day } from './lib/day.js'"),
      'engine/lib/day.ts': sourceOf(5),
      'engine/random.ts': sourceOf(30),
    })

    expect(depths).toEqual([{ file: 'engine/index.ts', exports: 1, lines: 77 }])
  })
})

describe('the shallowest modules, as the CI summary lists them', () => {
  test('the ten entry points exporting the most per line hidden, shallowest first, each with both numbers', () => {
    const depths = Array.from({ length: 12 }, (_, i) => ({ file: `model/m${i}.ts`, exports: i, lines: 100 }))

    const report = shallowestModules([{ file: 'engine/index.ts', exports: 30, lines: 60 }, ...depths])

    expect(report.split('\n')).toEqual([
      '### The shallowest modules',
      '',
      "Each module's entry point by its exported functions and types per line they hide, the shallowest first: a prompt to look with `/codebase-design`, not a failure.",
      '',
      '| Entry point | Exports | Lines hidden | Exports per 100 lines |',
      '|---|--:|--:|--:|',
      '| `src/engine/index.ts` | 30 | 60 | 50.0 |',
      '| `src/model/m11.ts` | 11 | 100 | 11.0 |',
      '| `src/model/m10.ts` | 10 | 100 | 10.0 |',
      '| `src/model/m9.ts` | 9 | 100 | 9.0 |',
      '| `src/model/m8.ts` | 8 | 100 | 8.0 |',
      '| `src/model/m7.ts` | 7 | 100 | 7.0 |',
      '| `src/model/m6.ts` | 6 | 100 | 6.0 |',
      '| `src/model/m5.ts` | 5 | 100 | 5.0 |',
      '| `src/model/m4.ts` | 4 | 100 | 4.0 |',
      '| `src/model/m3.ts` | 3 | 100 | 3.0 |',
      '',
    ])
  })

  test("run over the real src/ as CI runs it, it lists as many as it shows of src/'s entry points", () => {
    const script = fileURLToPath(new URL('../../scripts/reportShallowModules.ts', import.meta.url))
    const src = fileURLToPath(new URL('../../src', import.meta.url))
    const entryPoints = moduleDepths(Object.fromEntries(typeScriptSourcesUnder(src).map(({ file, source }) => [file, source]))).map(({ file }) => file)

    const report = execFileSync(process.execPath, [script], { encoding: 'utf8' })

    const listed = [...report.matchAll(/^\| `src\/([^`]+)`/gm)].map(([, file = '']) => file)
    expect(listed).toHaveLength(SHALLOWEST_LISTED)
    expect(listed.filter((file) => !entryPoints.includes(file))).toEqual([])
    // Independent of the rule under test: each is a file at a module's root, and a module with an index.ts lists only it.
    const notAtARoot = listed.filter((file) => file.split('/').length !== 2 || !existsSync(join(src, file)))
    const besideAnIndex = listed.filter((file) => existsSync(join(src, dirname(file), 'index.ts')) && basename(file) !== 'index.ts')
    expect([...notAtARoot, ...besideAnIndex]).toEqual([])
  })
})
