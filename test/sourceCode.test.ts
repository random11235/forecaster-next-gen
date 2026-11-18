import { describe, expect, test } from 'vitest'
import { codeOf, templateTextsOf } from './sourceCode.js'

// Reading a file's code apart from its comments, strings, regex literals and template text: each case ends in a
// `kept()` call, or holds it where it isn't code, so the case passes when `kept` is in the code `codeOf` gives just when
// it should be.

describe('the code of a source file', () => {
  test('blanks out what is not code, keeping every character where it was', () => {
    expect(codeOf("a = 'b' // c\nd")).toBe("a = ' '     \nd")
  })

  test.each([
    ['after a URL in a string', "const url = 'https://example.com'; kept()"],
    ['inside a template', '`${String(kept())}`'],
    ['in a template nested in a template', '`a ${`b ${kept()}`} c`'],
    ['after a template holding braces', '`${{ a: 1 }.a}`; kept()'],
    ['after a regex holding a single quote', "const quote = /'/; kept()"],
    ['after a regex holding a double quote', 'const quote = /"/; kept()'],
    ['after a regex holding a backtick', 'const quote = /`/; kept()'],
    ['after a regex that looks like a block comment', 'const slashes = /\\/*/; kept()'],
    ['after a regex that looks like a line comment', 'const slashes = /\\/\\//; kept()'],
    ['after a division', 'const half = a / b; kept()'],
    ['after a regex returned', "return /'/ }; kept()"],
    ['after the typeof a regex', "typeof /'/; kept()"],
    ['after a division of an increment', 'x++ / 2; kept()'],
    ['after a division of a decrement', 'x-- / 2; kept()'],
    ['after a division of a string', "'a' / 2; kept()"],
    ['after a division of a template', '`a` / 2; kept()'],
    ['after a division of a regex', '/a/ / 2; kept()'],
    ['after a division of a property named return', 'a.return / 2; kept()'],
    ['after a division of a property named in', 'a.in / 2; kept()'],
    ['after a division of an optional property named of', 'a?.of / 2; kept()'],
  ])('keeps code %s', (_, source) => {
    expect(codeOf(source)).toContain('kept()')
  })

  test.each([
    ['a line comment', '// kept()\nconst other = 1'],
    ['a block comment', '/** Not `kept()`. */\nconst other = 1'],
    ['template text', '`${column} is kept()`'],
    ['quoted strings with escaped quotes', `const a = 'kept() it\\'s not'; const b = "a \\"kept()\\" call"`],
    ['a regex', 'const call = /kept\\(\\)/'],
  ])('blanks out %s', (_, source) => {
    expect(codeOf(source)).not.toContain('kept')
  })

  test.each([
    ['a template', 'run(`CREATE TABLE a (b TEXT)`)', ['CREATE TABLE a (b TEXT)']],
    ['a template with a substitution, marked where it was', 'const shown = `a ${b} c ${d}`', ['a ${…} c ${…}']],
    ['a template nested in one, each in the order it starts', '`a ${`b`} c` + `d`', ['a ${…} c', 'b', 'd']],
    ['no template in a comment, string or regex', "// `a`\nconst b = '`c`'; const d = /`e`/", []],
  ])('reads the text of %s', (_, source, expected) => {
    expect(templateTextsOf(source)).toEqual(expected)
  })
})
