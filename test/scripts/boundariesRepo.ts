import { afterEach, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// What the lint:boundaries tests share: running `npm run lint:boundaries`'s script (scripts/lintBoundaries.ts) as the
// npm script does, over the real repo or over a stand-in repo of a test's own, whose modules a case writes, checked with
// the repo's .dependency-cruiser.cjs.

/** The real repo. */
export const root = fileURLToPath(new URL('../..', import.meta.url))
const script = join(root, 'scripts/lintBoundaries.ts')

/** What a run of the script gave: its exit code and everything it printed. */
export interface Linted {
  code: number | null
  output: string
}

/** Runs the script in `cwd` over `paths`. */
export function lint(cwd: string, ...paths: string[]): Linted {
  const run = spawnSync(process.execPath, [script, ...paths], { cwd, encoding: 'utf8' })
  return { code: run.status, output: run.stdout + run.stderr }
}

/** A stand-in repo, fresh for each test: writing its files, and linting it. */
export interface StandInRepo {
  /** Writes each file, by its path in the stand-in repo. */
  write(files: Record<string, string>): void
  /** Runs the script in the stand-in repo over `paths`. */
  lint(...paths: string[]): Linted
}

/** Gives each test of the calling file a stand-in repo of its own, with a tsconfig.json, removed after it. */
export function standInRepo(): StandInRepo {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-boundaries-'))
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', allowImportingTsExtensions: true } }))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    write(files) {
      for (const [path, source] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true })
        writeFileSync(join(dir, path), source)
      }
    },
    lint: (...paths) => lint(dir, ...paths),
  }
}
