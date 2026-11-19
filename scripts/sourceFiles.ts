import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// Listing and reading the repo's `.ts` files, and what each imports: for the scan tests (test/importScan.ts,
// arrangeRules.test.ts, storedJsonRules.test.ts, stringValueRules.test.ts and typeCheckRules.test.ts) and the CI
// summary's shallowest modules (reportShallowModules.ts, moduleDepth.ts). It sits in scripts/ so node can run it there.

/** A source file: its path, relative to the folder its reader was given as the base, and its text. */
export interface SourceFile {
  file: string
  source: string
}

/** Each `.ts` file under `dir`, at any depth, as a path relative to `dir`, sorted. */
export function typeScriptFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .sort()
}

/** Each `.ts` file under `dir`, as `typeScriptFilesUnder` lists it, with its source; its path relative to `base`. */
export function typeScriptSourcesUnder(dir: string, base = dir): SourceFile[] {
  return typeScriptFilesUnder(dir).map((file) => ({ file: relative(base, join(dir, file)), source: readFileSync(join(dir, file), 'utf8') }))
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
