import { describe, expect, test } from 'vitest'
import { importedPaths, resolveImport } from '../../scripts/sourceFiles.ts'

describe('reading imports', () => {
  test('sees an import from, a side-effect import and a dynamic import; a type-only one only when asked for types', () => {
    const source = [
      "import { a } from './a.js'",
      "import type { B } from './b.js'",
      "export { c } from './c.js'",
      "import './d.js'",
      "const e = await import('./e.js')",
      "type F = typeof import('./f.js')",
      "import { g } from 'vitest'",
      "export type { H } from './h.js'",
    ].join('\n')

    expect(importedPaths(source)).toEqual(['./a.js', './b.js', './c.js', './d.js', './e.js', './f.js', './h.js'])
    expect(importedPaths(source, true)).toEqual(['./a.js', './c.js', './d.js', './e.js'])
  })

  test('resolves an import against the folder of the file that makes it', () => {
    expect(resolveImport('connectors/jira.ts', './jira/jiraConnector.js')).toBe('connectors/jira/jiraConnector.js')
    expect(resolveImport('connectors/jira/jiraConnector.ts', '../remote.js')).toBe('connectors/remote.js')
    expect(resolveImport('forecast/appVersion.ts', '../../package.json')).toBe('../package.json')
    expect(resolveImport('/repo/test/forecast/a.test.ts', '../../src/engine/index.js')).toBe('/repo/src/engine/index.js')
  })
})
