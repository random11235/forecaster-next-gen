import { readdirSync } from 'node:fs'

// Reading the repo's source files for the scan tests: listing them, for importScan.ts, storedJsonRules.test.ts and
// stringValueRules.test.ts, and reading a file's code apart from its comments, strings and regex literals, for the two
// rules tests.

/** Each `.ts` file under `dir`, at any depth, as a path relative to `dir`, sorted. */
export function typeScriptFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .sort()
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
export function codeOf(source: string): string {
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
