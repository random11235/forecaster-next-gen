import { dirname } from 'node:path'
import { describe, expect, test } from 'vitest'
import { importedPaths, importsBeside } from './importScan.js'

// The Test layers rule in CODING_STANDARDS.md: each test folder imports from src/ only the entry points of the seam
// docs/design/architecture-test-seams.md assigns it, and what that seam's tests read through. TEST_SEAMS is the one list.

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
  // Seam C: the interface, each connector's entry point (the canned one, GitHub's, Jira's), connectors/remote.js that the
  // network connectors share, and the connection a connector is built from (model/connection.js).
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
}

type Exception = { file: string; imported: string; why: string }

/** Imports outside their folder's seam that stay, each a test reading through a second seam on purpose; each says why. */
const ALLOWED_BEYOND_SEAM: Exception[] = [
  {
    file: 'test/forecast/milestoneForecastView.test.ts',
    imported: 'engine/index.js',
    why: 'the pace trend case expects the dates Seam A gives for the typed counts, an independent check of what Seam B shows',
  },
  ...['forecast/inputs.js', 'forecast/milestoneForecastView.js', 'forecast/settings.js'].flatMap((imported) =>
    ['test/storage/migrations.beforeTheMvp.test.ts', 'test/storage/migrations.v6to9.test.ts'].map((file) => ({
      file,
      imported,
      why: "a migrated file is checked by what the forecast reads back from it, through Seam B's views",
    })),
  ),
  {
    file: 'test/app/candidatesScript.test.ts',
    imported: 'forecast/candidates.js',
    why: 'the candidates script runs by how few the typing narrows to and how long it pauses, so its test names them rather than repeat them',
  },
]

/** Imports outside their folder's seam, kept until each is fixed; each says why it is still here. */
const TEMPORARY_EXCEPTIONS: Exception[] = [
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
]

describe('test seams', () => {
  test("each test folder imports from src/ only its seam's entry points and the helpers that seam reads through", () => {
    const allowedIn = (file: string, imported: string) => {
      const parts = file.split('/')
      const allowed = TEST_SEAMS[parts.length > 2 ? parts[1]! : ''] ?? []
      return allowed.some((entry) => (entry.endsWith('/') ? dirname(imported) === entry.slice(0, -1) : imported === entry))
    }
    const excepted = (file: string, imported: string) =>
      [...ALLOWED_BEYOND_SEAM, ...TEMPORARY_EXCEPTIONS].some((ex) => ex.file === file && ex.imported === imported)
    const outside = importsBeside('test').filter(({ file, imported }) => !imported.startsWith('../') && !allowedIn(file, imported) && !excepted(file, imported))

    expect(outside).toEqual([])
  })

  test('each exception is still needed', () => {
    const imports = importsBeside('test')
    const fixed = [...ALLOWED_BEYOND_SEAM, ...TEMPORARY_EXCEPTIONS].filter(
      (ex) => !imports.some(({ file, imported }) => file === ex.file && imported === ex.imported),
    )

    expect(fixed).toEqual([])
  })
})

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
})
