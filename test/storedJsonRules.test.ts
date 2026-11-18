import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { src } from './importScan.js'

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
 * `source` with only its code left: the contents of its comments, quoted strings and template text blanked out, the
 * code in a template's `${…}` kept, a template nested in it too. Regex literals are read as code.
 */
function codeOf(source: string): string {
  let code = ''
  let at = 0
  /** For each template whose `${…}` is open, the braces opened in it and not yet closed. */
  const substitutions: number[] = []
  const keep = (length = 1): void => {
    code += source.slice(at, at + length)
    at += length
  }
  const blankTo = (end: number): void => {
    for (; at < Math.min(end, source.length); at++) code += source[at] === '\n' ? '\n' : ' '
  }
  /** Where the text from `at` ends: at the first of `ends` not escaped, or the end of `source`. */
  const textEnd = (...ends: string[]): number => {
    let end = at
    while (end < source.length && !ends.some((each) => source.startsWith(each, end))) end += source[end] === '\\' ? 2 : 1
    return end
  }
  /** Template text from `at`, up to its closing backtick or a `${` opening code. */
  const templateText = (): void => {
    blankTo(textEnd('`', '${'))
    if (source.startsWith('${', at)) {
      keep(2)
      substitutions.push(0)
    } else keep()
  }
  while (at < source.length) {
    const char = source[at]
    if (source.startsWith('//', at)) blankTo(textEnd('\n'))
    else if (source.startsWith('/*', at)) {
      const end = source.indexOf('*/', at + 2)
      blankTo(end === -1 ? source.length : end + 2)
    } else if (char === "'" || char === '"') {
      keep()
      blankTo(textEnd(char))
      keep()
    } else if (char === '`') {
      keep()
      templateText()
    } else if (char === '}' && substitutions.at(-1) === 0) {
      substitutions.pop()
      keep()
      templateText()
    } else {
      if (substitutions.length > 0 && (char === '{' || char === '}')) substitutions[substitutions.length - 1]! += char === '{' ? 1 : -1
      keep()
    }
  }
  return code
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
