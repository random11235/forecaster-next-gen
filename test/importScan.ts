import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importedPaths, typeScriptFilesUnder } from '../scripts/sourceFiles.ts'

// Reading what the repo's files import, for the tests that check who may import what: dependencyRules.test.ts and
// testSeams.test.ts. Each import is found by `importedPaths` (scripts/sourceFiles.ts).

export const src = fileURLToPath(new URL('../src', import.meta.url))

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
  return typeScriptFilesUnder(dir).flatMap((file) => importsAt(join(dir, file)).map((imported) => ({ file: join(folder, file), imported })))
}

/** Each file under `src/<folder>` with what it imports, as `importsAt` gives it. */
export function importsFrom(folder: string): { file: string; imported: string }[] {
  return typeScriptFilesUnder(join(src, folder)).flatMap((inFolder) => {
    const file = join(folder, inFolder)
    return importsOf(file).map((imported) => ({ file, imported }))
  })
}
