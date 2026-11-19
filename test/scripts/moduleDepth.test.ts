import { describe, expect, test } from 'vitest'
import { moduleDepths, shallowestModules } from '../../scripts/moduleDepth.ts'

/** A source file of `lines` lines, each ending in a newline, the first ones `head`. */
const file = (lines: number, ...head: string[]): string =>
  [...head, ...Array<string>(lines - head.length).fill('// hidden')].map((line) => `${line}\n`).join('')

describe('module depth', () => {
  test("an entry point at a module's root counts its exported functions and types, and its own lines", () => {
    const depths = moduleDepths({
      'forecast/inputs.ts': file(
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

  test('a function kept in a const, a class and an enum count; a constant does not', () => {
    const depths = moduleDepths({
      'engine/dates.ts': file(
        6,
        'export const a = (x: number): number => x',
        'export const b = async () => {}',
        'export class C {}',
        'export enum D {}',
        'export const LIMIT = 5',
      ),
    })

    expect(depths).toEqual([{ file: 'engine/dates.ts', exports: 4, lines: 6 }])
  })

  test("what it imports from its own subfolders, and what those import there, is hidden behind it; a sibling it imports, or a file outside, is not; a subfolder's file is no entry point", () => {
    const depths = moduleDepths({
      'forecast/trackerReads.ts': file(
        10,
        "import { paceOf } from './lib/pace.js'",
        "import { inputs } from './inputs.js'",
        "import type { Team } from '../model/team.js'",
      ),
      'forecast/lib/pace.ts': file(20, "import { counts } from './periodCounts.js'"),
      'forecast/lib/periodCounts.ts': file(30),
      'forecast/lib/unused.ts': file(100),
      'forecast/inputs.ts': file(5),
      'model/team.ts': file(7),
    })

    expect(depths).toEqual([
      { file: 'forecast/trackerReads.ts', exports: 0, lines: 60 },
      { file: 'forecast/inputs.ts', exports: 0, lines: 5 },
      { file: 'model/team.ts', exports: 0, lines: 7 },
    ])
  })

  test("a connector's entry point hides its connector's folder, and the names it passes on from there count as its exports", () => {
    const depths = moduleDepths({
      'connectors/github.ts': file(3, "export { githubConnector, type GithubThing } from './github/githubConnector.js'"),
      'connectors/github/githubConnector.ts': file(40, "import { send } from '../remote.js'"),
      'connectors/remote.ts': file(8),
    })

    expect(depths).toEqual([
      { file: 'connectors/github.ts', exports: 2, lines: 43 },
      { file: 'connectors/remote.ts', exports: 0, lines: 8 },
    ])
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
})
