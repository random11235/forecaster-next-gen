import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { demoConnector } from '../connectors/canned.js'
import { githubConnector } from '../connectors/github.js'
import { jiraConnector } from '../connectors/jira.js'
import type { Connecting, ConnectorFactory } from '../forecast/connection.js'
import { openKeychainSecrets } from '../secrets/keychainSecrets.js'
import { openMemorySecrets } from '../secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../storage/sqliteStorage.js'
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
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]]
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
let storage: SqliteStorage
try {
  storage = openSqliteStorage(dataFile)
} catch (error) {
  console.error(`Forecaster could not open its data file ${dataFile}: ${String(error)}`)
  process.exit(1)
}

/** The real connectors, reaching their trackers with `fetch`. */
const trackerConnector: ConnectorFactory = (connection, token) =>
  connection.tracker === 'github' ? githubConnector(connection, token, fetch) : jiraConnector(connection, token, fetch)

/**
 * Demo mode, for demo screenshots and the launch smoke test: any connection connects to the canned connector and its
 * synthetic fixture, so no tracker is needed (but for the cues `demoConnector` refuses on), and the token typed is held
 * in memory only, never put in the keychain.
 * Otherwise a connection is checked with its tracker and its token kept in the OS keychain.
 */
const demo = Boolean(process.env.FORECASTER_DEMO)
const connecting: Connecting = demo
  ? { connections: storage, queries: storage, setup: storage, secrets: openMemorySecrets(), connector: demoConnector }
  : { connections: storage, queries: storage, setup: storage, secrets: openKeychainSecrets(), connector: trackerConnector }
if (demo) console.log('Demo mode: tickets come from the canned connector and its synthetic fixture.')

try {
  const app = await startAppAndOpenBrowser({ port, openBrowser: browserOpener, storage, connecting })
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
