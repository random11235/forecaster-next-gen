import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { renderMilestoneForecastScreen } from './milestoneForecastScreen.js'

/** Localhost only: the Forecaster is a local, single-user tool and is never reachable from the network. */
const HOST = '127.0.0.1'

export interface LaunchOptions {
  /** 0 picks a free port. */
  port: number
  openBrowser: (url: string) => void
}

export interface RunningApp {
  url: string
  close: () => Promise<void>
}

/** Starts the local server and opens the browser on the Milestone forecast screen. */
export async function startAppAndOpenBrowser(options: LaunchOptions): Promise<RunningApp> {
  const server = createServer(serveMilestoneForecastScreen)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const { port } = server.address() as AddressInfo
  const url = `http://${HOST}:${port}/`
  options.openBrowser(url)

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}

/** Serves the Milestone forecast screen at `/` and 404 for everything else. */
function serveMilestoneForecastScreen(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'GET' || new URL(request.url ?? '/', `http://${HOST}`).pathname !== '/') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(renderMilestoneForecastScreen())
}
