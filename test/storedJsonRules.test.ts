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

/** The keywords a regex literal can follow, where a `/` after any other word is division. */
const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'yield', 'await', 'instanceof', 'new', 'throw', 'else', 'do'])

/**
 * `source` with only its code left: the contents of its comments, quoted strings, regex literals and template text
 * blanked out, the code in a template's `${…}` kept, a template nested in it too. A `/` is division after a value: a
 * word but one of `BEFORE_REGEX`, a property name (any word straight after `.` or `?.`, those keywords too), a number,
 * a string, template or regex literal, `)`, `]`, `++` or `--`. After anything else (another punctuator, `}`, one of
 * those keywords not as a property name, or nothing) it starts a regex literal.
 */
function codeOf(source: string): string {
  let code = ''
  let at = 0
  /** Whether the last token is a value, so that a `/` after it is division. */
  let afterValue = false
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
  /** Where the run of characters from `at` that `isPart` takes ends. */
  const runEnd = (isPart: (char: string) => boolean): number => {
    let end = at
    while (end < source.length && isPart(source[end]!)) end++
    return end
  }
  /** Template text from `at`, up to its closing backtick, a value, or a `${` opening code. */
  const templateText = (): void => {
    blankTo(textEnd('`', '${'))
    afterValue = !source.startsWith('${', at)
    if (afterValue) keep()
    else {
      keep(2)
      substitutions.push(0)
    }
  }
  /** Where the regex literal from `at`, past its opening `/`, ends: at its closing `/`, outside a character class. */
  const regexEnd = (): number => {
    let end = at
    let inClass = false
    for (; end < source.length && source[end] !== '\n' && (inClass || source[end] !== '/'); end++) {
      if (source[end] === '\\') end++
      else if (source[end] === '[') inClass = true
      else if (source[end] === ']') inClass = false
    }
    return end
  }
  while (at < source.length) {
    const char = source[at]!
    if (source.startsWith('//', at)) blankTo(textEnd('\n'))
    else if (source.startsWith('/*', at)) {
      const end = source.indexOf('*/', at + 2)
      blankTo(end === -1 ? source.length : end + 2)
    } else if (/\s/.test(char)) keep()
    else if (char === '/' && !afterValue) {
      keep()
      blankTo(regexEnd())
      keep()
      afterValue = true
    } else if (char === "'" || char === '"') {
      keep()
      blankTo(textEnd(char))
      keep()
      afterValue = true
    } else if (char === '`') {
      keep()
      templateText()
    } else if (char === '}' && substitutions.at(-1) === 0) {
      substitutions.pop()
      keep()
      templateText()
    } else if (/[\p{L}_$]/u.test(char)) {
      const isProperty = /(?<!\.\.)\.$/.test(code.trimEnd())
      const word = source.slice(
        at,
        runEnd((each) => /[\p{L}\p{N}_$]/u.test(each)),
      )
      keep(word.length)
      afterValue = isProperty || !BEFORE_REGEX.has(word)
    } else if (/\d/.test(char) || (char === '.' && /\d/.test(source[at + 1] ?? ''))) {
      keep(runEnd((each) => /[\w.]/.test(each)) - at)
      afterValue = true
    } else if (source.startsWith('++', at) || source.startsWith('--', at)) {
      keep(2)
      afterValue = true
    } else {
      if (substitutions.length > 0 && (char === '{' || char === '}')) substitutions[substitutions.length - 1]! += char === '{' ? 1 : -1
      keep()
      afterValue = char === ')' || char === ']'
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
