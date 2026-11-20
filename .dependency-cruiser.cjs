// @ts-check
// Module entry points and the layering between modules, enforced by dependency-cruiser: `npm run lint:boundaries` (scripts/lintBoundaries.ts), which CI
// runs beside the typecheck. src/README.md sets out the layout; docs/design/architecture-dependency-rules.md the rules.
//
// Each folder under `src/` is a module. Its ENTRY POINTS are the files at its root; its implementation lives in its
// SUBFOLDERS (`lib/`, a connector's own folder) and is private to it. Code outside a module (`test/`, `scripts/`,
// another module) imports only its entry points. A module's own files import each other freely. Several small entry
// points beat one barrel `index.ts`. Adapted from the `setup-ts-deep-modules` skill's config.

/** Where modules live: one immediate child folder per module. */
const R = 'src'

/** A module's internals: anything inside one of its subfolders. Its root files are its entry points, not matched. */
const MODULE_INTERNALS = `^${R}/[^/]+/[^/]+/`

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'entrypoint-boundary-from-app',
      comment: "Code outside src/'s modules (test/, scripts/) imports a module's entry points (its root files), never a file in its subfolders.",
      severity: 'error',
      from: { pathNot: `^${R}/` },
      to: { path: MODULE_INTERNALS },
    },
    {
      name: 'entrypoint-boundary-across-packages',
      comment: "A module's own files import each other freely, but reach another module only through its entry points.",
      severity: 'error',
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: { path: MODULE_INTERNALS, pathNot: `^${R}/$1/` },
    },
    // The two rules about a module's own `tests/` folder can't fire while tests live in test/, but a module that adds
    // one gets them.
    {
      name: 'tests-through-entrypoints',
      comment: "A module's tests/ import entry points and their own tests/ fixtures, never any module's internals.",
      severity: 'error',
      from: { path: `^${R}/([^/]+)/tests/` },
      to: { path: MODULE_INTERNALS, pathNot: `^${R}/$1/tests/` },
    },
    {
      name: 'tests-folder-is-private',
      comment: "A module's tests/ folder is reachable only from tests.",
      severity: 'error',
      from: { pathNot: `^${R}/[^/]+/tests/` },
      to: { path: `^${R}/[^/]+/tests/` },
    },
    // The layering rules between modules: docs/design/architecture-dependency-rules.md gives each one's reason.
    {
      name: 'engine-imports-nothing',
      comment: 'engine/ imports nothing from the rest of src/.',
      severity: 'error',
      from: { path: `^${R}/engine/` },
      to: { path: `^${R}/`, pathNot: `^${R}/engine/` },
    },
    {
      name: 'app-not-engine',
      comment: 'app/ reaches forecasts through forecast/, never engine/ directly.',
      severity: 'error',
      from: { path: `^${R}/app/` },
      to: { path: `^${R}/engine/` },
    },
    {
      name: 'model-imports-only-engine',
      comment: 'model/ imports nothing from the rest of src/ but engine/, never connectors/.',
      severity: 'error',
      from: { path: `^${R}/model/` },
      to: { path: `^${R}/`, pathNot: `^${R}/(model|engine)/` },
    },
    {
      name: 'engine-types-only',
      comment: "model/, ledger/ and storage/ reach engine/ only for its types, with `import type`: storage/ to check a logged forecast's case and result.",
      severity: 'error',
      from: { path: `^${R}/(model|ledger|storage)/` },
      to: { path: `^${R}/engine/`, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'ledger-only-engine-types',
      comment: "ledger/ imports nothing from the rest of src/ but the engine's types.",
      severity: 'error',
      from: { path: `^${R}/ledger/` },
      to: { path: `^${R}/`, pathNot: [`^${R}/ledger/`, `^${R}/engine/`] },
    },
    {
      name: 'connectors-only-interface-own-folder-and-model',
      comment:
        "connectors/ import only the interface (connector.ts), what the network connectors share (remote.ts), their own connector's folder, and model/. An entry point's own folder is its connector's; it imports no other entry point.",
      severity: 'error',
      // $1 is the connector: `github` for connectors/github.ts and every file in connectors/github/.
      from: { path: `^${R}/connectors/([^/]+?)(?:\\.ts$|/)` },
      to: { path: `^${R}/`, pathNot: [`^${R}/model/`, `^${R}/connectors/(connector|remote)\\.ts$`, `^${R}/connectors/$1/`] },
    },
    {
      name: 'forecast-only-connector-interface',
      comment:
        'forecast/ reaches connectors only through the interface (connector.ts), never a concrete connector or its entry point: app/ builds one and passes it in.',
      severity: 'error',
      from: { path: `^${R}/forecast/` },
      to: { path: `^${R}/connectors/`, pathNot: `^${R}/connectors/connector\\.ts$` },
    },
    {
      name: 'secrets-imports-nothing',
      comment: 'secrets/ imports nothing from the rest of src/.',
      severity: 'error',
      from: { path: `^${R}/secrets/` },
      to: { path: `^${R}/`, pathNot: `^${R}/secrets/` },
    },
    {
      name: 'secrets-only-from-app-and-forecast',
      comment: 'Only app/ builds a Secrets and forecast/ takes the interface; nothing else imports secrets/.',
      severity: 'error',
      from: { path: `^${R}/`, pathNot: `^${R}/(app|forecast|secrets)/` },
      to: { path: `^${R}/secrets/` },
    },
    {
      name: 'forecast-only-secrets-interface',
      comment: 'forecast/ imports only the Secrets interface (secrets/secrets.ts), never a concrete Secrets.',
      severity: 'error',
      from: { path: `^${R}/forecast/` },
      to: { path: `^${R}/secrets/`, pathNot: `^${R}/secrets/secrets\\.ts$` },
    },
    {
      name: 'web-page-loads-no-secrets',
      comment:
        "The browser build's page script (app/webMain.ts) reaches nothing in secrets/ but the interface, secrets/secrets.ts, which holds only types (verbatimModuleSyntax makes an import of it an `import type`), so the page loads nothing from secrets/.",
      severity: 'error',
      from: { path: `^${R}/app/webMain\\.ts$` },
      to: { path: `^${R}/secrets/`, pathNot: `^${R}/secrets/secrets\\.ts$`, reachable: true },
    },
    {
      name: 'package-json-only-from-app-version',
      comment: 'Only forecast/appVersion.ts imports package.json: the web build gives the page it shares a package.json of the version alone.',
      severity: 'error',
      from: { path: `^${R}/`, pathNot: `^${R}/forecast/appVersion\\.ts$` },
      to: { path: '^package\\.json$' },
    },
    {
      name: 'no-circular',
      comment: 'No dependency cycles.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // dependency-cruiser reads only TypeScript below 7, and with its default parser on TypeScript 7 cruises nothing
    // and passes; swc parses the sources instead.
    parser: 'swc',
    // `import type` counts as a dependency too.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.json'] },
  },
}
