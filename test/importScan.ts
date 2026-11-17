import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Reading what the repo's files import, for the tests that check who may import what: dependencyRules.test.ts and
// testSeams.test.ts.

export const src = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

/**
 * The relative paths `source` imports, as written: by `import`/`export … from`, a side-effect `import '…'` or a dynamic
 * `import('…')`; `import type`, `export type` and `typeof import('…')` too, unless `runtimeOnly`.
 */
export function importedPaths(source: string, runtimeOnly = false): string[] {
  return [...source.matchAll(/(typeof\s+)?\b(?:import|export)(\s+type\b)?(?:[^'"]*from\s+|\s*\(\s*|\s+)'(\.[^']+)'/g)]
    .filter(([, typeOf, typeOnly]) => !(runtimeOnly && (typeOf || typeOnly)))
    .map((match) => match[3]!)
}

/**
 * What the file at `path` imports, each its relative import resolved to a path relative to `src/`: `connectors/jira.js`
 * for one in `src/`, `../test/...` or `../package.json` for one outside it; `import type` too, unless `runtimeOnly`.
 */
export function importsAt(path: string, runtimeOnly = false): string[] {
  return importedPaths(readFileSync(path, 'utf8'), runtimeOnly).map((imported) => relative(src, resolve(dirname(path), imported)))
}

/** What `file` (a path under `src/`) imports, as `importsAt` gives it; `import type` too, unless `runtimeOnly`. */
export function importsOf(file: string, runtimeOnly = false): string[] {
  return importsAt(join(src, file), runtimeOnly)
}

/** Each file under the repo's `folder` (beside `src/`) with what it imports, as `importsAt` gives it. */
export function importsBeside(folder: string): { file: string; imported: string }[] {
  const dir = join(src, '..', folder)
  return sourceFiles(dir).flatMap((path) => importsAt(path).map((imported) => ({ file: join(folder, relative(dir, path)), imported })))
}

/** Each file under `src/<folder>` with what it imports, as `importsAt` gives it. */
export function importsFrom(folder: string): { file: string; imported: string }[] {
  return sourceFiles(join(src, folder)).flatMap((path) => {
    const file = relative(src, path)
    return importsOf(file).map((imported) => ({ file, imported }))
  })
}
