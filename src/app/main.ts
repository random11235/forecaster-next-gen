import { spawn } from 'node:child_process'
import { startApp } from './launch.js'

const DEFAULT_PORT = 5180

/** Opens the URL in the default browser. If that fails the URL is still printed, so the EM can open it by hand. */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}

const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT

try {
  const app = await startApp({ port, openBrowser })
  console.log(`Forecaster running at ${app.url} (Ctrl+C to stop)`)
  const stop = (): void => void app.close().then(() => process.exit(0))
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
