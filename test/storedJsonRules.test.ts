import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { src } from './importScan.js'
import { codeOf } from './sourceCode.js'

// The One-way doors rule in CODING_STANDARDS.md, for persisted JSON: storage reads every stored JSON value through
// one parser, which checks its shape, never `JSON.parse` cast straight to a type.

/** The one file in `src/storage/` that may use the `JSON` global but to write: the parser that checks each value's shape. */
const PARSER = 'lib/storedJson.ts'

/** Each `.ts` file under `src/storage/`, relative to it, with its source. */
function storageFiles(): { file: string; source: string }[] {
  const dir = join(src, 'storage')
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }))
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
    ['a JSON.parse after a URL on the same line', "const url = 'https://example.com'; const inputs = JSON.parse(text)"],
    ['a JSON.parse inside a template', 'const shown = `${String(JSON.parse(text))}`'],
    ['a JSON.parse in a template nested in a template', 'const shown = `a ${`b ${JSON.parse(text)}`} c`'],
    ['a JSON.parse after a template holding braces', 'const shown = `${{ a: 1 }.a}`; const inputs = JSON.parse(text)'],
    ['a JSON.parse after a regex holding a single quote', "const quote = /'/; JSON.parse(x)"],
    ['a JSON.parse after a regex holding a double quote', 'const quote = /"/; JSON.parse(x)'],
    ['a JSON.parse after a regex holding a backtick', 'const quote = /`/; JSON.parse(x)'],
    ['a JSON.parse after a regex that looks like a block comment', 'const slashes = /\\/*/; JSON.parse(x)'],
    ['a JSON.parse after a regex that looks like a line comment', 'const slashes = /\\/\\//; JSON.parse(x)'],
    ['a JSON.parse after a division', 'const half = a / b; JSON.parse(x)'],
    ['a JSON.parse after a regex returned', "return /'/ }; JSON.parse(x)"],
    ['a JSON.parse after the typeof a regex', "typeof /'/; JSON.parse(x)"],
    ['a JSON.parse after a division of an increment', 'x++ / 2; JSON.parse(x)'],
    ['a JSON.parse after a division of a decrement', 'x-- / 2; JSON.parse(x)'],
    ['a JSON.parse after a division of a string', "'a' / 2; JSON.parse(x)"],
    ['a JSON.parse after a division of a template', '`a` / 2; JSON.parse(x)'],
    ['a JSON.parse after a division of a regex', '/a/ / 2; JSON.parse(x)'],
    ['a JSON.parse after a division of a property named return', 'a.return / 2; JSON.parse(x)'],
    ['a JSON.parse after a division of a property named in', 'a.in / 2; JSON.parse(x)'],
    ['a JSON.parse after a division of an optional property named of', 'a?.of / 2; JSON.parse(x)'],
  ])('catches %s', (_, source) => {
    expect(usesJsonButStringify(source)).toBe(true)
  })

  test.each([
    ['JSON.stringify', 'store.setItem(KEY, JSON.stringify(data))'],
    ['a line comment mentioning JSON.parse', '// never JSON.parse a stored value\nconst kept = 1'],
    ['a block comment mentioning JSON.parse', '/** Not read by `JSON.parse`. */\nconst kept = 1'],
    ['a string mentioning JSON', "throw new Error(`${column} holds JSON of a shape it doesn't know`)"],
    ['quoted strings mentioning JSON.parse', `const a = 'JSON.parse it\\'s not'; const b = "a \\"JSON.parse\\" call"`],
    ['a comment marker inside a string, before a stringify', "const url = 'https://example.com'; const text = JSON.stringify(data)"],
  ])('passes %s', (_, source) => {
    expect(usesJsonButStringify(source)).toBe(false)
  })
})
