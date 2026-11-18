import { describe, expect, test } from 'vitest'
import { codeOf } from './sourceCode.js'
import type { SourceFile } from './sourceFiles.js'

/** Where in a file the type checker is switched off, as `file:line`, and what switches it off. */
interface TypeCheckOff {
  at: string
  found: 'any' | '!'
}

/** `any` in a type position: after `:`, `as` or `<`, or before `[]`. */
const ANY = /(?::\s*|\bas\s+|<\s*)any\b|\bany\s*\[\s*\]/g

/**
 * A non-null `!`: one straight after a name, a `)` or a quote, but not the start of `!=` or `!==`. A `!` that starts a
 * not follows an operator, a `(` or a space instead; Prettier keeps a space between a keyword and a not (`return !x`).
 * One straight after `]`, on an index, is allowed, so not matched.
 */
const NON_NULL = /(?<=[\p{L}\p{N}_$)'"`])!(?!=)/gu

/** Where `source`'s code, not its comments or strings, switches the type checker off, in the order they come. */
function typeCheckOffs({ file, source }: SourceFile): TypeCheckOff[] {
  const code = codeOf(source)
  const lineOf = (index: number) => code.slice(0, index).split('\n').length
  const found = [
    ...[...code.matchAll(ANY)].map(({ index }) => ({ index, found: 'any' as const })),
    ...[...code.matchAll(NON_NULL)].map(({ index }) => ({ index, found: '!' as const })),
  ]
  return found.sort((a, b) => a.index - b.index).map(({ index, found }) => ({ at: `${file}:${lineOf(index)}`, found }))
}

describe('type check rules', () => {
  test.each([
    ['a parameter typed any', 'function f(value: any) {}'],
    ['a cast to any', 'const loose = value as any'],
    ['an old-style cast to any', 'const loose = <any>value'],
    ['an array of any', 'let values: any[] = []'],
  ])('catches %s', (_, source) => {
    expect(typeCheckOffs({ file: 'example.ts', source })).toEqual([{ at: 'example.ts:1', found: 'any' }])
  })

  test.each([
    ['a ! on a name', 'const finished = ticket.finishedAt!'],
    ['a ! on a call', 'const title = SCREENS.find((screen) => screen.path === path)!.name'],
    ['a ! on .at()', 'const last = bars.at(-1)!.date'],
    ['a ! before a comparison', 'expect(applied! < now).toBe(true)'],
    ['a definite assignment', 'let scenario!: Scenario'],
  ])('catches %s', (_, source) => {
    expect(typeCheckOffs({ file: 'example.ts', source })).toEqual([{ at: 'example.ts:1', found: '!' }])
  })

  test('names the line of each', () => {
    const source = 'const a = 1\nconst b = c!\n\nfunction f(value: any) {}'

    expect(typeCheckOffs({ file: 'lib/example.ts', source })).toEqual([
      { at: 'lib/example.ts:2', found: '!' },
      { at: 'lib/example.ts:4', found: 'any' },
    ])
  })

  test.each([
    ['a ! on an index', 'const count = counts[at]!'],
    ['a not', 'if (!done && !(a || b)) return'],
    ['!= and !==', 'if (a != b || c !== d) return'],
    ['! and any in a comment or a string', "// value! as any\nconst text = 'value! as any'"],
    ['any as a word in a name', 'const many = anything.any'],
  ])('passes %s', (_, source) => {
    expect(typeCheckOffs({ file: 'example.ts', source })).toEqual([])
  })
})
