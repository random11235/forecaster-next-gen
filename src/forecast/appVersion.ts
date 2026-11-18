/**
 * The app's one version (semver), `version` in `package.json`: the release each merge to main is tagged as
 * (`scripts/release.ts`). Every screen's footer shows it and the server streams it on `/live`. It is importable
 * where a forecast is made, beside the engine's `ENGINE_VERSION`, for the forecast ledger (#27) to store with each
 * forecast. A JSON import, with no file read: Node, the tests and the web build's bundle all load it as it is.
 */
import pkg from '../../package.json' with { type: 'json' }

export const APP_VERSION: string = pkg.version
