/**
 * The app's one version (semver), `version` in `package.json`: the release each merge to main is tagged as
 * (`scripts/releaseTag.ts`). Every screen's footer shows it and the server streams it on `/live`; a forecast is made
 * here, beside the engine's `ENGINE_VERSION`, so the forecast ledger (#27) records which release made each one.
 * Read from `package.json` beside `src/` and `dist/`, so only Node can load this module: the web build's bundle gets
 * `APP_VERSION` as a string instead (`scripts/buildWeb.ts`).
 */
import { readFileSync } from 'node:fs'

function readVersion(): string {
  const { version }: { version?: unknown } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  if (typeof version !== 'string') throw new Error('package.json has no version.')
  return version
}

export const APP_VERSION = readVersion()
