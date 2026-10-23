import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { loadSampleDataIfEmpty } from '../sample/loadSampleData.js'
import type { Storage } from '../storage/storage.js'
import { renderMilestoneForecastScreen } from './milestoneForecastScreen.js'

/** Localhost only: the Forecaster is a local, single-user tool and is never reachable from the network. */
const HOST = '127.0.0.1'

export interface LaunchOptions {
  /** 0 picks a free port. */
  port: number
  openBrowser: (url: string) => void
  /** Where the app keeps its data. On first launch, when it is empty, the sample data is loaded into it. */
  storage: Storage
}

export interface RunningApp {
  url: string
  close: () => Promise<void>
}

/** Starts the local server and opens the browser on the Milestone forecast screen. */
export async function startAppAndOpenBrowser(options: LaunchOptions): Promise<RunningApp> {
  const { storage } = options
  loadSampleDataIfEmpty(storage)
  const server = createServer((request, response) => serveMilestoneForecastScreen(request, response, storage))

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
function serveMilestoneForecastScreen(request: IncomingMessage, response: ServerResponse, storage: Storage): void {
  if (request.method !== 'GET' || new URL(request.url ?? '/', `http://${HOST}`).pathname !== '/') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(renderMilestoneForecastScreen(currentView(storage)))
}

/** v1 is single-team: the view is for the one stored team. */
function currentView(storage: Storage): MilestoneForecastView {
  const team = storage.teams()[0]
  return team ? milestoneForecastView(storage, team.id) : { kind: 'noMilestone' }
}
