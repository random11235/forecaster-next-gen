import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { src } from './importScan.js'
import { codeOf, typeScriptFilesUnder } from './sourceCode.js'

// The One-way doors rule in CODING_STANDARDS.md, for persisted JSON: storage reads every stored JSON value through
// one parser, which checks its shape, never `JSON.parse` cast straight to a type.

/** The one file in `src/storage/` that may use the `JSON` global but to write: the parser that checks each value's shape. */
const PARSER = 'lib/storedJson.ts'

/** Each `.ts` file under `src/storage/`, relative to it, with its source. */
function storageFiles(): { file: string; source: string }[] {
  const dir = join(src, 'storage')
  return typeScriptFilesUnder(dir).map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }))
}

/**
 * Whether `source` uses the `JSON` global in any way but `JSON.stringify`, in its code, not its comments or strings: so
 * a parse reached by `JSON?.parse`, `JSON["parse"]`, destructuring it or naming `JSON` again is caught too.
 */
function usesJsonButStringify(source: string): boolean {
  return [...codeOf(source).matchAll(/\bJSON\b(?!\s*\.\s*stringify\b)/g)].length > 0
}

describe('stored JSON rules', () => {
  test(`in src/storage/, only ${PARSER} uses JSON but JSON.stringify; everything else reads stored JSON through it`, () => {
    const bare = storageFiles().filter(({ file, source }) => file !== PARSER && usesJsonButStringify(source))

    expect(bare.map(({ file }) => file)).toEqual([])
  })

  test.each([
    ['a bare JSON.parse', 'const inputs = JSON.parse(text) as MilestoneInputs'],
    ['JSON?.parse', 'const inputs = JSON?.parse(text)'],
    ['JSON["parse"]', 'const inputs = JSON["parse"](text)'],
    ['parse destructured from JSON', 'const { parse } = JSON'],
    ['JSON named again', 'const j = JSON\nconst inputs = j.parse(text)'],
  ])('catches %s', (_, source) => {
    expect(usesJsonButStringify(source)).toBe(true)
  })

  test.each([
    ['JSON.stringify', 'store.setItem(KEY, JSON.stringify(data))'],
    ['JSON.parse in a comment or a string', "// never JSON.parse a stored value\nconst text = 'JSON.parse'"],
  ])('passes %s', (_, source) => {
    expect(usesJsonButStringify(source)).toBe(false)
  })
})
