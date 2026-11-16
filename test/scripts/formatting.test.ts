import { describe, expect, test } from 'vitest'
import { unformatted } from '../../scripts/formatting.ts'

describe('the formatting check', () => {
  test('content formatted as .prettierrc.json says passes; other content is named', async () => {
    const files = [
      { path: 'src/app/formatted.ts', content: 'export const x = { a: 1 }\n' },
      { path: 'src/app/unformatted.ts', content: 'export const x = {a:1};\n' },
    ]
    expect(await unformatted(files)).toEqual(['src/app/unformatted.ts'])
  })

  test('the content given is what is checked, whatever is on disk at that path', async () => {
    const onDisk = 'scripts/formatting.ts'
    expect(await unformatted([{ path: onDisk, content: 'export const x = {a:1};\n' }])).toEqual([onDisk])
  })

  test('paths .prettierignore lists, and file types Prettier has no parser for, pass at any content', async () => {
    const messy = 'x  =  {a:1};;\n'
    const files = ['docs/research/notes.md', 'test/connectors/jira/recordings/a.json', 'docs/demos/1-inputs.png', 'Makefile'].map((path) => ({
      path,
      content: messy,
    }))
    expect(await unformatted(files)).toEqual([])
  })
})
