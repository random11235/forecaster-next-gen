import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

// The dependency rules in docs/design/architecture-dependency-rules.md that keep connectors/ and secrets/ at the edge,
// and that keep package.json's one importer the module the web build gives its version alone; and the Test layers rule
// in CODING_STANDARDS.md, that each test folder imports only its seam's entry points (docs/design/architecture-test-seams.md).

const src = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

/**
 * What the file at `path` imports, each its relative import resolved to a path relative to `src/`: `connectors/jira.js`
 * for one in `src/`, `../test/...` or `../package.json` for one outside it; `import type` too, unless `runtimeOnly`.
 */
function importsAt(path: string, runtimeOnly = false): string[] {
  return [...readFileSync(path, 'utf8').matchAll(/(import|export)(\s+type\b)?[^'"]*from\s+'(\.[^']+)'/g)]
    .filter((match) => !(runtimeOnly && match[1] === 'import' && match[2]))
    .map((match) => relative(src, resolve(dirname(path), match[3]!)))
}

/** What `file` (a path under `src/`) imports, as `importsAt` gives it; `import type` too, unless `runtimeOnly`. */
function importsOf(file: string, runtimeOnly = false): string[] {
  return importsAt(join(src, file), runtimeOnly)
}

/** Each file under the repo's `folder` (beside `src/`) with what it imports, as `importsAt` gives it. */
function importsBeside(folder: string): { file: string; imported: string }[] {
  const dir = join(src, '..', folder)
  return sourceFiles(dir).flatMap((path) => importsAt(path).map((imported) => ({ file: join(folder, relative(dir, path)), imported })))
}

/** Each file under `src/<folder>` with what it imports, as `importsAt` gives it. */
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

/** Seam B's entry points (`forecast/`), what goes in through them, and the helpers its tests read through. */
const SEAM_B = [
  'forecast/milestoneForecastView.js',
  'forecast/inputs.js',
  'forecast/skippedPeriods.js',
  'forecast/connection.js',
  'forecast/setup.js',
  'forecast/setupReads.js',
  'forecast/queryStep.js',
  'forecast/candidates.js',
  'forecast/milestoneRenamed.js',
  'forecast/howItWorksView.js',
  // What goes in: settings, the query a step edits, the tracker's reads, and the stored facts through storage.
  'forecast/settings.js',
  'forecast/stepQuery.js',
  'forecast/trackerReads.js',
  'storage/storage.js',
  'storage/sqliteStorage.js',
  'model/',
  // Read through: the canned connector, its interface's types, and openMemorySecrets.
  'connectors/canned.js',
  'connectors/connector.js',
  'secrets/memorySecrets.js',
]

/**
 * Each test folder (`test/<folder>/`, `''` for test/'s own files) and the files under `src/` its files may import, as
 * `importsAt` gives them; one ending in `/` allows that folder's root files. A folder not here may import nothing from `src/`.
 */
const TEST_SEAMS: Record<string, readonly string[]> = {
  // Seam A, and the PRNG checked against its reference vectors, which Seam A can't show.
  engine: ['engine/index.js', 'engine/random.js'],
  forecast: SEAM_B,
  // trackerScenario.ts and tempDatabase.ts, which forecast/ and app/ tests share, arrange through Seam B.
  '': SEAM_B,
  // Seam C: the interface, each connector's entry point, and the backoff's wait the network connectors share.
  connectors: ['connectors/connector.js', 'connectors/canned.js', 'connectors/github.js', 'connectors/jira.js', 'connectors/remote.js', 'model/connection.js'],
  // The Storage contract and the migration tests, through each storage's opening.
  storage: ['storage/storage.js', 'storage/sqliteStorage.js', 'storage/webStorage.js', 'model/'],
  secrets: ['secrets/secrets.js', 'secrets/memorySecrets.js', 'secrets/keychainSecrets.js'],
  // The app as it launches, local server or web build, with what it is built on, and the version its footer shows.
  app: [
    'app/launch.js',
    'app/webApp.js',
    'forecast/appVersion.js',
    'forecast/connection.js',
    'storage/storage.js',
    'storage/sqliteStorage.js',
    'storage/webStorage.js',
    'model/',
    'connectors/canned.js',
    'connectors/connector.js',
    'secrets/secrets.js',
    'secrets/memorySecrets.js',
  ],
  // The release tag, named by the app's version.
  scripts: ['forecast/appVersion.js'],
}

/** Imports outside their folder's seam, kept until each is fixed; each says why it is still here. */
const TEMPORARY_EXCEPTIONS: { file: string; imported: string; why: string }[] = [
  {
    file: 'test/forecast/milestoneForecastView.test.ts',
    imported: 'engine/index.js',
    why: 'the pace trend case expects the dates Seam A gives for the typed counts, run directly, rather than known-good dates',
  },
  {
    file: 'test/forecast/paceVersusOwn.test.ts',
    imported: 'forecast/paceVersusOwn.js',
    why: "tests the comparison with the milestone's own pace below Seam B, rather than through the candidates and Comparable work views that show it",
  },
  ...['forecast/setupSteps.js', 'forecast/setupSummary.js'].map((imported) => ({
    file: 'test/forecast/setup.test.ts',
    imported,
    why: 'names SetupStep and COUNTS_WAIT from below Seam B; the file is over the size limit, so the fix waits for its split',
  })),
  ...['forecast/inputs.js', 'forecast/milestoneForecastView.js', 'forecast/settings.js'].flatMap((imported) =>
    ['test/storage/migrations.beforeTheMvp.test.ts', 'test/storage/migrations.v6to9.test.ts'].map((file) => ({
      file,
      imported,
      why: "a migration test reads back through Seam B's views rather than through storage",
    })),
  ),
]

describe('test seams', () => {
  test("each test folder imports from src/ only its seam's entry points and the helpers that seam reads through", () => {
    const allowedIn = (file: string, imported: string) => {
      const parts = file.split('/')
      const allowed = TEST_SEAMS[parts.length > 2 ? parts[1]! : ''] ?? []
      return allowed.some((entry) => (entry.endsWith('/') ? dirname(imported) === entry.slice(0, -1) : imported === entry))
    }
    const excepted = (file: string, imported: string) => TEMPORARY_EXCEPTIONS.some((ex) => ex.file === file && ex.imported === imported)
    const outside = importsBeside('test').filter(({ file, imported }) => !imported.startsWith('../') && !allowedIn(file, imported) && !excepted(file, imported))

    expect(outside).toEqual([])
  })

  test('each temporary exception is still needed', () => {
    const imports = importsBeside('test')
    const fixed = TEMPORARY_EXCEPTIONS.filter((ex) => !imports.some(({ file, imported }) => file === ex.file && imported === ex.imported))

    expect(fixed).toEqual([])
  })
})
