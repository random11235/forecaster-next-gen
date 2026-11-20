// @ts-check
// Module entry points, enforced by dependency-cruiser: `npm run lint:boundaries` (scripts/lintBoundaries.ts), which CI
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
