import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { APP_VERSION } from '../../src/forecast/appVersion.js'
import { ENGINE_VERSION } from '../../src/engine/index.js'

/** The app's one version, as `package.json` sets it: the release a merge to main is tagged as. */
const VERSION: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

// Where a forecast is made, the release that made it is known beside the engine's version, for the ledger (#27) to
// record which release produced a number. The web build's bundle gets the same version (test/app/webBuild.test.ts).
test('a forecast knows the release that made it, beside the engine version', () => {
  expect({ app: APP_VERSION, engine: ENGINE_VERSION }).toEqual({ app: VERSION, engine: '2' })
})
