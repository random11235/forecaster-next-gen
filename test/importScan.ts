import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importedPaths, resolveImport, typeScriptFilesUnder } from '../scripts/sourceFiles.ts'

// Reading what the repo's files import, for testSeams.test.ts, which checks each test folder imports only its seam's
// entry points. Each import is found and resolved by scripts/sourceFiles.ts.

export const src = fileURLToPath(new URL('../src', import.meta.url))

/**
 * What the file at `path` imports, `import type` too, each its relative import resolved to a path relative to `src/`:
 * `connectors/jira.js` for one in `src/`, `../test/...` or `../package.json` for one outside it.
 */
function importsAt(path: string): string[] {
  return importedPaths(readFileSync(path, 'utf8')).map((imported) => relative(src, resolveImport(path, imported)))
}

/** Each file under the repo's `folder` (beside `src/`) with what it imports, as `importsAt` gives it. */
export function importsBeside(folder: string): { file: string; imported: string }[] {
  const dir = join(src, '..', folder)
  return typeScriptFilesUnder(dir).flatMap((file) => importsAt(join(dir, file)).map((imported) => ({ file: join(folder, file), imported })))
}
