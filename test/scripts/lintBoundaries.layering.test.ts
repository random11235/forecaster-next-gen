import { expect, test } from 'vitest'
import { standInRepo } from './boundariesRepo.ts'

// The layering rules between src/'s modules (docs/design/architecture-dependency-rules.md), each shown to bite on an
// import breaking it in a stand-in repo, and to let through what it allows. The module-boundary rules are in
// lintBoundaries.test.ts.
const repo = standInRepo()

/** A module file exporting one value, for an import to reach. */
const exporting = (name: string) => `export const ${name} = 1\n`

/** Lints the stand-in repo's src/ after writing `files`. */
function lintWith(files: Record<string, string>) {
  repo.write(files)
  return repo.lint('src')
}

/** Expects `files` to break `rule`, naming it, and fail. */
function expectBreaks(rule: string, files: Record<string, string>): void {
  const { code, output } = lintWith(files)

  expect(output).toContain(rule)
  expect(code).not.toBe(0)
}

/** Expects `files` to break no rule. */
function expectPasses(files: Record<string, string>): void {
  const { code, output } = lintWith(files)

  expect(output).toContain('no dependency violations found')
  expect(code).toBe(0)
}

test('engine/ importing from the rest of src/ fails', () => {
  expectBreaks('engine-imports-nothing', {
    'src/model/team.ts': exporting('team'),
    'src/engine/simulate.ts': "import { team } from '../model/team.ts'\nexport const run = team\n",
  })
})

test('a side-effect import and a dynamic import() count as imports', () => {
  const engine = (imports: string) => ({ 'src/model/team.ts': exporting('team'), 'src/engine/simulate.ts': `${imports}\nexport const run = 1\n` })

  expectBreaks('engine-imports-nothing', engine("import '../model/team.ts'"))
  expectBreaks('engine-imports-nothing', engine("export const later = () => import('../model/team.ts')"))
})

test('app/ importing engine/ fails', () => {
  expectBreaks('app-not-engine', {
    'src/engine/simulate.ts': exporting('run'),
    'src/app/main.ts': "import { run } from '../engine/simulate.ts'\nexport const start = run\n",
  })
})

/** The engine as it stands: its interface at its root, its code and types behind it in lib/. */
const engineTypes = {
  'src/engine/lib/types.ts': 'export type Range = number\n',
  'src/engine/lib/simulate.ts': exporting('run'),
  'src/engine/index.ts': "export { run } from './lib/simulate.ts'\nexport type { Range } from './lib/types.ts'\n",
}

test("model/ importing the engine's types passes", () => {
  expectPasses({ ...engineTypes, 'src/model/team.ts': "import type { Range } from '../engine/index.ts'\nexport type Team = Range\n" })
})

test("model/ importing the engine's code fails", () => {
  expectBreaks('engine-types-only', {
    ...engineTypes,
    'src/model/team.ts': "import { run } from '../engine/index.ts'\nexport const team = run\n",
  })
})

test('model/ importing a module but engine/ fails, even as types', () => {
  expectBreaks('model-imports-only-engine', {
    'src/connectors/connector.ts': 'export type Ticket = string\n',
    'src/model/team.ts': "import type { Ticket } from '../connectors/connector.ts'\nexport type Team = Ticket\n",
  })
})

test("ledger/ importing the engine's types passes, and its code or anything else fails", () => {
  const ledger = (imports: string) => ({
    ...engineTypes,
    'src/model/team.ts': exporting('team'),
    'src/ledger/ledger.ts': `${imports}\nexport const ledger = 1\n`,
  })

  expectPasses(ledger("import type { Range } from '../engine/index.ts'"))
  expectBreaks('engine-types-only', ledger("import { run } from '../engine/index.ts'"))
  expectBreaks('ledger-only-engine-types', ledger("import { team } from '../model/team.ts'"))
})

test('storage/ reaching the engine through its types passes, and through its code fails', () => {
  const storage = (imports: string) => ({ ...engineTypes, 'src/storage/storage.ts': `${imports}\nexport const store = 1\n` })

  expectPasses(storage("import type { Range } from '../engine/index.ts'"))
  expectBreaks('engine-types-only', storage("import { run } from '../engine/index.ts'"))
})

/** A connector's file importing what connectors/ may import: the interface, what the network ones share, and model/. */
const connectors = {
  'src/model/ticket.ts': exporting('ticket'),
  'src/connectors/connector.ts': 'export type Connector = string\n',
  'src/connectors/remote.ts': exporting('fetchJson'),
  'src/connectors/github.ts': "import { read } from './github/read.ts'\nexport const github = read\n",
  'src/connectors/github/read.ts':
    "import type { Connector } from '../connector.ts'\nimport { fetchJson } from '../remote.ts'\nimport { ticket } from '../../model/ticket.ts'\n" +
    'export const read = fetchJson + ticket\nexport type Read = Connector\n',
  'src/connectors/jira.ts': exporting('jira'),
  'src/connectors/jira/query.ts': exporting('query'),
}

test('connectors/ importing the interface, what the network connectors share, their own folder and model/ passes', () => {
  expectPasses(connectors)
})

test('a connector importing another connector, its entry point or its folder, or a module but model/, fails', () => {
  const reading = (imports: string) => ({
    ...connectors,
    'src/forecast/inputs.ts': exporting('inputs'),
    'src/connectors/github/page.ts': `${imports}\nexport const page = 1\n`,
  })

  expectBreaks('connectors-only-interface-own-folder-and-model', reading("import { jira } from '../jira.ts'"))
  expectBreaks('connectors-only-interface-own-folder-and-model', reading("import { query } from '../jira/query.ts'"))
  expectBreaks('connectors-only-interface-own-folder-and-model', reading("import { github } from '../github.ts'"))
  expectBreaks('connectors-only-interface-own-folder-and-model', reading("import { inputs } from '../../forecast/inputs.ts'"))
})

test('forecast/ importing the connector interface passes, and a concrete connector fails', () => {
  const forecast = (imports: string) => ({ ...connectors, 'src/forecast/inputs.ts': `${imports}\nexport const inputs = 1\n` })

  expectPasses(forecast("import type { Connector } from '../connectors/connector.ts'"))
  expectBreaks('forecast-only-connector-interface', forecast("import { github } from '../connectors/github.ts'"))
})

const secrets = {
  'src/secrets/secrets.ts': 'export interface Secrets {\n  token: string\n}\n',
  'src/secrets/memorySecrets.ts': "import type { Secrets } from './secrets.ts'\nexport const memorySecrets = (): Secrets => ({ token: '' })\n",
  'src/forecast/connection.ts': "import type { Secrets } from '../secrets/secrets.ts'\nexport type Connection = Secrets\n",
  'src/app/main.ts': "import { memorySecrets } from '../secrets/memorySecrets.ts'\nexport const start = memorySecrets\n",
  'src/model/team.ts': exporting('team'),
}

test('app/ building a Secrets and forecast/ taking the interface passes', () => {
  expectPasses(secrets)
})

test('secrets/ importing from the rest of src/ fails', () => {
  expectBreaks('secrets-imports-nothing', {
    ...secrets,
    'src/secrets/keychainSecrets.ts': "import { team } from '../model/team.ts'\nexport const keychain = team\n",
  })
})

test('forecast/ importing a concrete Secrets fails', () => {
  expectBreaks('forecast-only-secrets-interface', {
    ...secrets,
    'src/forecast/connection.ts': "import { memorySecrets } from '../secrets/memorySecrets.ts'\nexport const connection = memorySecrets\n",
  })
})

test('a module but app/ and forecast/ importing secrets/ fails, even its interface', () => {
  expectBreaks('secrets-only-from-app-and-forecast', {
    ...secrets,
    'src/storage/storage.ts': "import type { Secrets } from '../secrets/secrets.ts'\nexport type Stored = Secrets\n",
  })
})

test("the browser page script reaching secrets/'s interface as a type passes, and loading a Secrets, even through another file, fails", () => {
  const page = (imports: string) => ({
    ...secrets,
    'src/app/webMain.ts': "import { webApp } from './webApp.ts'\nexport const page = webApp\n",
    'src/app/webApp.ts': `${imports}\nexport const webApp = 1\n`,
  })

  expectPasses(page("import type { Secrets } from '../secrets/secrets.ts'\nexport type Web = Secrets"))
  expectBreaks('web-page-loads-no-secrets', page("import { memorySecrets } from '../secrets/memorySecrets.ts'\nexport const made = memorySecrets"))
})

test('forecast/lib/appVersion.ts importing package.json passes, and any other file of src/ fails', () => {
  const importing = (file: string) => ({
    'package.json': '{ "version": "1.0.0" }\n',
    [file]: `import pkg from '${'../'.repeat(file.split('/').length - 1)}package.json' with { type: 'json' }\nexport const version = pkg.version\n`,
  })

  expectPasses(importing('src/forecast/lib/appVersion.ts'))
  expectBreaks('package-json-only-from-app-version', importing('src/forecast/settings.ts'))
})

/** The factory (factory/) and the app (src/, and the app's scripts), each with a file for an import to reach. */
const factoryAndApp = {
  'src/model/team.ts': exporting('team'),
  'scripts/release.ts': exporting('release'),
  'factory/factoryTrust.ts': exporting('trusted'),
  'node_modules/@ai-hero/sandcastle/package.json': '{ "name": "@ai-hero/sandcastle", "type": "module", "main": "index.js" }\n',
  'node_modules/@ai-hero/sandcastle/index.js': 'export const run = 1\n',
}

/** Lints the stand-in repo's app and factory after writing `files` beside them. */
function lintFactoryWith(files: Record<string, string>) {
  repo.write({ ...factoryAndApp, ...files })
  return repo.lint('src', 'scripts', 'factory')
}

test('the factory importing Sandcastle and Node passes', () => {
  const { code, output } = lintFactoryWith({
    'factory/factorySandcastle.ts': "import { run } from '@ai-hero/sandcastle'\nimport { join } from 'node:path'\nexport const sandbox = [run, join]\n",
  })

  expect(output).toContain('no dependency violations found')
  expect(code).toBe(0)
})

test('the factory importing the app fails, from src/ or from its scripts', () => {
  for (const imports of ["import { team } from '../src/model/team.ts'", "import { release } from '../scripts/release.ts'"]) {
    const { code, output } = lintFactoryWith({ 'factory/factoryBuild.ts': `${imports}\nexport const build = 1\n` })

    expect(output).toContain('factory-imports-no-app')
    expect(code).not.toBe(0)
  }
})

test('the app importing the factory fails, from src/ or from its scripts', () => {
  const importing = { 'src/model/ticket.ts': '../../factory/factoryTrust.ts', 'scripts/changeFiles.ts': '../factory/factoryTrust.ts' }
  for (const [file, from] of Object.entries(importing)) {
    const { code, output } = lintFactoryWith({ [file]: `import { trusted } from '${from}'\nexport const uses = trusted\n` })

    expect(output).toContain('app-imports-no-factory')
    expect(code).not.toBe(0)
  }
})
