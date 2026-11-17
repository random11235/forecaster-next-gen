import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

// The dependency rules in docs/design/architecture-dependency-rules.md that keep connectors/ and secrets/ at the edge,
// and that keep package.json's one importer the module the web build gives its version alone.

const src = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

/** What `file` (a path under `src/`) imports from `src/`, as paths relative to `src/`; `import type` too, unless `runtimeOnly`. */
function importsOf(file: string, runtimeOnly = false): string[] {
  const path = join(src, file)
  return [...readFileSync(path, 'utf8').matchAll(/(import|export)(\s+type\b)?[^'"]*from\s+'(\.[^']+)'/g)]
    .filter((match) => !(runtimeOnly && match[1] === 'import' && match[2]))
    .map((match) => relative(src, resolve(dirname(path), match[3]!)))
}

/** Each file under `src/<folder>` with what it imports from `src/`, as paths relative to `src/`. */
function importsFrom(folder: string): { file: string; imported: string }[] {
  return sourceFiles(join(src, folder)).flatMap((path) => {
    const file = relative(src, path)
    return importsOf(file).map((imported) => ({ file, imported }))
  })
}

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

  test("connectors/ import only the interface's types, what the network connectors share, their own folder, and model/; an entry point, its connector's folder", () => {
    const shared = ['connectors/connector.js', 'connectors/remote.js']
    const ownFolder = (file: string, imported: string) => dirname(imported) === dirname(file) || dirname(imported) === file.replace(/\.ts$/, '')
    const outside = importsFrom('connectors').filter(
      ({ file, imported }) => !imported.startsWith('model/') && !shared.includes(imported) && !ownFolder(file, imported),
    )

    expect(outside).toEqual([])
  })

  test('outside connectors/, code reaches a concrete connector only through its entry point at the root of connectors/', () => {
    const inside = importsFrom('').filter(({ file, imported }) => !file.startsWith('connectors/') && /^connectors\/[^/]+\//.test(imported))

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
