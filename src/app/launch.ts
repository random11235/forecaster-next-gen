import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { loadSampleDataIfEmpty } from '../sample/loadSampleData.js'
import type { Storage } from '../storage/storage.js'
import { parsePaceForm, renderInputsScreen, type PaceForm } from './inputsScreen.js'
import { renderMilestoneForecastScreen } from './milestoneForecastScreen.js'

/** Localhost only: the Forecaster is a local, single-user tool and is never reachable from the network. */
const HOST = '127.0.0.1'

export interface LaunchOptions {
  /** 0 picks a free port. */
  port: number
  openBrowser: (url: string) => void
  /** Where the app keeps its data. On first launch, when it is empty, the sample data is loaded into it. */
  storage: Storage
  /** Today's ISO calendar date, the day forecasts start from; the system clock unless given. */
  today?: () => string
}

export interface RunningApp {
  url: string
  close: () => Promise<void>
}

/** Starts the local server and opens the browser on the Milestone forecast screen. */
export async function startAppAndOpenBrowser(options: LaunchOptions): Promise<RunningApp> {
  const { storage } = options
  const today = options.today ?? (() => new Date().toISOString().slice(0, 10))
  loadSampleDataIfEmpty(storage)
  const server = createServer((request, response) => {
    serve(request, response, storage, today).catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(`Forecaster error: ${String(error)}`)
    })
  })

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

/** Serves the Milestone forecast screen at `/` and the Inputs screen at `/inputs`; 404 for everything else. */
async function serve(request: IncomingMessage, response: ServerResponse, storage: Storage, today: () => string): Promise<void> {
  const path = new URL(request.url ?? '/', `http://${HOST}`).pathname
  const team = storage.teams()[0]
  if (request.method === 'GET' && path === '/') {
    const view: MilestoneForecastView = team ? milestoneForecastView(storage, team.id, { today: today() }) : { kind: 'noMilestone' }
    return sendHtml(response, 200, renderMilestoneForecastScreen(view))
  }
  // v1 is single-team, with one milestone: the inputs are for those
  const milestone = team && storage.milestones(team.id)[0]
  if (request.method === 'GET' && path === '/inputs') {
    return sendHtml(response, 200, renderInputsScreen(milestone && savedPaceForm(storage, milestone.teamId, milestone.id)))
  }
  if (request.method === 'POST' && path === '/inputs' && milestone) {
    const pace = parsePaceForm(new URLSearchParams(await readBody(request)))
    if (!pace.ok) return sendHtml(response, 400, renderInputsScreen(pace.form))
    storage.savePaceSetting({ teamId: milestone.teamId, milestoneId: milestone.id, mode: 'manual', low: pace.low, high: pace.high })
    response.writeHead(303, { location: '/' })
    response.end()
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Not found')
}

/** The pace form filled with the saved manual range, or empty. */
function savedPaceForm(storage: Storage, teamId: string, milestoneId: string): PaceForm {
  const saved = storage.paceSetting(teamId, milestoneId)
  return saved?.mode === 'manual' ? { low: String(saved.low), high: String(saved.high) } : { low: '', high: '' }
}

/** Form posts are a few bytes; anything over this is refused rather than buffered. */
const MAX_BODY_BYTES = 10_000

async function readBody(request: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > MAX_BODY_BYTES) throw new Error('Request body too large.')
  }
  return body
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  response.end(html)
}
