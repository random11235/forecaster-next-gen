/**
 * The app's one version (semver), `version` in `package.json`, shown in every screen's footer and streamed on `/live`.
 * Read from `package.json` beside `src/` and `dist/`, so only Node can load this module: the web build's bundle gets
 * `VERSION` as a string instead (`scripts/buildWeb.ts`).
 */
import { readFileSync } from 'node:fs'

function readVersion(): string {
  const { version }: { version?: unknown } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  if (typeof version !== 'string') throw new Error('package.json has no version.')
  return version
}

export const VERSION = readVersion()
