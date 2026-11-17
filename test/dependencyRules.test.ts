import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { importsBeside, importsFrom, importsOf, src } from './importScan.js'

// The dependency rules in docs/design/architecture-dependency-rules.md that keep connectors/ and secrets/ at the edge,
// and that keep package.json's one importer the module the web build gives its version alone.

/** Every file under `src/` that `entry` loads when it runs, itself included; `import type` loads nothing. */
function loadedBy(entry: string): Set<string> {
  const loaded = new Set<string>()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop()!
    if (loaded.has(file)) continue
    loaded.add(file)
    for (const imported of importsOf(file, true)) {
      const source = imported.replace(/\.js$/, '.ts')
      if (statSync(join(src, source), { throwIfNoEntry: false })?.isFile()) pending.push(source)
    }
  }
  return loaded
}

describe('dependency rules', () => {
  test('only forecast/appVersion.ts imports package.json, whose version alone the web build gives the page it shares', () => {
    const importers = importsFrom('').filter(({ imported }) => imported === '../package.json')

    expect(importers.map(({ file }) => file)).toEqual(['forecast/appVersion.ts'])
  })

  test('forecast/ reaches connectors only through the interface, never a concrete connector or its entry point', () => {
    const concrete = importsFrom('forecast').filter(({ imported }) => imported.startsWith('connectors/') && imported !== 'connectors/connector.js')

    expect(concrete).toEqual([])
  })

  test("connectors/ import only the interface's types, what the network connectors share, their own folder, and model/; an entry point's own folder is its connector's", () => {
    const shared = ['connectors/connector.js', 'connectors/remote.js']
    // A file's own folder is the one it sits in; an entry point's, at the root of connectors/, its connector's folder.
    const ownFolder = (file: string, imported: string) => dirname(imported) === (dirname(file) === 'connectors' ? file.replace(/\.ts$/, '') : dirname(file))
    const outside = importsFrom('connectors').filter(
      ({ file, imported }) => !imported.startsWith('model/') && !shared.includes(imported) && !ownFolder(file, imported),
    )

    expect(outside).toEqual([])
  })

  test('outside connectors/, in src/, test/ and scripts/, code reaches a concrete connector only through its entry point at the root of connectors/', () => {
    const outside = [...importsFrom('').filter(({ file }) => !file.startsWith('connectors/')), ...importsBeside('test'), ...importsBeside('scripts')]
    const inside = outside.filter(({ imported }) => /^connectors\/[^/]+\//.test(imported))

    expect(inside).toEqual([])
  })

  test('secrets/ imports nothing from the rest of the app', () => {
    const outside = importsFrom('secrets').filter(({ imported }) => !imported.startsWith('secrets/'))

    expect(outside).toEqual([])
  })

  test('only app/ builds a Secrets; forecast/ takes the interface; nothing else imports secrets/', () => {
    const others = ['engine', 'model', 'storage', 'connectors'].flatMap(importsFrom)
    const forecast = importsFrom('forecast')

    expect(others.filter(({ imported }) => imported.startsWith('secrets/'))).toEqual([])
    expect(forecast.filter(({ imported }) => imported.startsWith('secrets/') && imported !== 'secrets/secrets.js')).toEqual([])
  })

  test("the browser build's page script loads nothing from secrets/", () => {
    const loaded = loadedBy('app/webMain.ts')

    expect(loaded).toContain('app/webApp.ts')
    expect([...loaded].filter((file) => file.startsWith('secrets/'))).toEqual([])
  })
})
