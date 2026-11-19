// Reading a source file's code apart from its comments, strings and regex literals, and the text of its templates, for
// the scan tests that check what code says: storedJsonRules.test.ts, stringValueRules.test.ts and
// typeCheckRules.test.ts.

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
  return lexed(source).code
}

/**
 * The text of each template in `source`'s code, as written, each `${…}` in it marked `${…}`, in the order they start: a
 * template nested in a `${…}` is one of its own. Templates in comments, strings and regex literals don't count.
 */
export function templateTextsOf(source: string): string[] {
  return lexed(source).templateTexts
}

/** A template being read: where its text goes in `templateTexts`, and its text so far. */
interface OpenTemplate {
  slot: number
  text: string
}

/** `source`'s code, as `codeOf` gives it, and its templates' text, as `templateTextsOf` gives it. */
function lexed(source: string): { code: string; templateTexts: string[] } {
  let code = ''
  const templateTexts: string[] = []
  let at = 0
  /** Whether the last token is a value, so that a `/` after it is division. */
  let afterValue = false
  /** For each template whose `${…}` is open, the template and the braces opened in its `${…}` and not yet closed. */
  const substitutions: { template: OpenTemplate; braces: number }[] = []
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
  /** `template`'s text from `at`, up to its closing backtick, a value, or a `${` opening code. */
  const templateText = (template: OpenTemplate): void => {
    const end = textEnd('`', '${')
    template.text += source.slice(at, end)
    blankTo(end)
    afterValue = !source.startsWith('${', at)
    if (afterValue) {
      templateTexts[template.slot] = template.text
      keep()
    } else {
      template.text += '${…}'
      keep(2)
      substitutions.push({ template, braces: 0 })
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
    const substitution = substitutions.at(-1)
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
      templateText({ slot: templateTexts.push('') - 1, text: '' })
    } else if (char === '}' && substitution?.braces === 0) {
      substitutions.pop()
      keep()
      templateText(substitution.template)
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
      if (substitution && (char === '{' || char === '}')) substitution.braces += char === '{' ? 1 : -1
      keep()
      afterValue = char === ')' || char === ']'
    }
  }
  return { code, templateTexts }
}
