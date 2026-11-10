import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { demoConnector } from '../connectors/canned/demo.js'
import type { Connector } from '../connectors/connector.js'
import { openSqliteStorage } from '../storage/sqliteStorage.js'
import type { Storage } from '../storage/storage.js'
import { startAppAndOpenBrowser } from './launch.js'

const DEFAULT_PORT = 5180

/** The one local SQLite file, in `data/` at the repo root (beside `dist/`). */
const DEFAULT_DATA_FILE = fileURLToPath(new URL('../../data/forecaster.db', import.meta.url))

/** Reads PORT from the environment. Unset or empty gives the default; 0 picks a free port. */
function portFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT
  const port = Number(value)
  if (!/^\d+$/.test(value) || port > 65535) {
    throw new Error(`PORT must be a whole number from 0 to 65535, not "${value}".`)
  }
  return port
}

/** Opens the URL in the default browser. If that fails the URL is still printed, so the EM can open it by hand. */
function openBrowser(url: string): void {
  // On Windows, `cmd /c start "" <url>` is mangled by Node's argument quoting; rundll32 takes the URL as one plain argument.
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}

/** Set by the smoke test, so running it doesn't open a browser. */
const browserOpener = process.env.FORECASTER_NO_BROWSER ? () => {} : openBrowser

let port: number
try {
  port = portFromEnv(process.env.PORT)
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}

const dataFile = process.env.FORECASTER_DATA_FILE || DEFAULT_DATA_FILE
let storage: Storage
try {
  storage = openSqliteStorage(dataFile)
} catch (error) {
  console.error(`Forecaster could not open its data file ${dataFile}: ${String(error)}`)
  process.exit(1)
}

/**
 * Demo mode, for demo screenshots and the launch smoke test: tickets come from the canned connector's synthetic
 * fixture, so no tracker or token is needed. Otherwise there is no connector until the EM connects a tracker.
 */
let connector: Connector | undefined
if (process.env.FORECASTER_DEMO) {
  connector = demoConnector()
  console.log('Demo mode: tickets come from the canned connector and its synthetic fixture.')
}

try {
  const app = await startAppAndOpenBrowser({ port, openBrowser: browserOpener, storage, ...(connector && { connector }) })
  console.log(`Forecaster running at ${app.url} (Ctrl+C to stop)`)
  const stop = (): void =>
    void app.close().then(() => {
      storage.close()
      process.exit(0)
    })
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code
  console.error(
    code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Start on another port with PORT=<port> npm start.`
      : `Forecaster failed to start: ${String(error)}`,
  )
  process.exit(1)
}
