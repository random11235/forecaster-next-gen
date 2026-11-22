import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { APP_VERSION, openForecasting, type Clock, type Connecting, type Forecasting } from '../forecast/index.js'
import type { Storage } from '../storage/storage.js'
import { SAVE_IN_PLACE } from './inputsScript.js'
import { systemClock, type Reply, type Request } from './appContext.js'
import { route } from './routes.js'

/** Localhost only: the Forecaster is a local, single-user tool and is never reachable from the network. */
const HOST = '127.0.0.1'

export interface LaunchOptions {
  /** 0 picks a free port. */
  port: number
  openBrowser: (url: string) => void
  /** Where the app keeps its data. On first launch, when it is empty, the default team is added to it. */
  storage: Storage
  /** What the Inputs screen's Connect step connects a tracker with: the keychain and the real connectors, or demo mode's. */
  connecting?: Connecting
  /** The UTC instant now, which reads are made at, and the EM's time zone, which today is the date in; the system clock unless given. */
  clock?: Clock
}

/** The port the app starts on when PORT doesn't name one. */
const DEFAULT_PORT = 5180

/** The port PORT names (`main.ts` reads it from the environment): unset or empty gives the default; 0 picks a free port. */
export function portFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT
  const port = Number(value)
  if (!/^\d+$/.test(value) || port > 65535) {
    throw new Error(`PORT must be a whole number from 0 to 65535, not "${value}".`)
  }
  return port
}

export interface RunningApp {
  url: string
  close: () => Promise<void>
}

/** Starts the local server and opens the browser on the Milestone forecast screen. */
export async function startAppAndOpenBrowser(options: LaunchOptions): Promise<RunningApp> {
  const { storage, connecting, clock = systemClock() } = options
  const forecasting = openForecasting({ storage, clock, ...(connecting && { connecting }) })
  const server = createServer((request, response) => {
    serve(request, response, forecasting).catch((error: unknown) => {
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

/** Hands the request to the routes and writes their reply. */
async function serve(request: IncomingMessage, response: ServerResponse, forecasting: Forecasting): Promise<void> {
  const method = request.method ?? 'GET'
  const refusal = refuseOtherSites(request, method)
  if (refusal) return refuse(response, refusal)
  const { pathname, search } = new URL(request.url ?? '/', `http://${HOST}`)
  if (method === 'GET' && pathname === LIVE_PATH) return streamVersion(response)
  const path = pathname + search
  const form = method === 'POST' ? new URLSearchParams(await readBody(request)) : undefined
  const saveInPlace = request.headers[SAVE_IN_PLACE.header] === SAVE_IN_PLACE.value
  const routed: Request = { method, path, ...(form && { form }), ...(saveInPlace && { saveInPlace }) }
  send(response, await route(routed, forecasting))
}

/**
 * Why a request is refused before any route runs, if it is. Localhost is reachable from any page the EM's browser
 * opens: a page on a domain re-pointed at 127.0.0.1 (DNS rebinding) sends its own domain as `Host`. The port is the
 * one the server actually bound, so a `PORT=0` launch is checked against the port it got. A form on any site can POST
 * here, so a POST must come from the server's own pages: browsers send `Origin` on every POST, the app's own
 * save-in-place `fetch` among them, so a POST without one is refused too. GETs aren't Origin-checked, so links,
 * bookmarks, typed URLs and `/live` keep working.
 */
function refuseOtherSites(request: IncomingMessage, method: string): string | undefined {
  const port = request.socket.localPort
  const ownHosts = [`${HOST}:${port}`, `localhost:${port}`]
  const ownOrigins = ownHosts.map((host) => `http://${host}`)
  if (!ownHosts.includes(request.headers.host ?? '')) return 'Refused: this request is not addressed to the Forecaster.'
  if (method === 'POST' && !ownOrigins.includes(request.headers.origin ?? '')) return 'Refused: this form was not sent from the Forecaster.'
  return undefined
}

function refuse(response: ServerResponse, reason: string): void {
  response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(reason)
}

/** Where an open page listens for the version the app is running, to reload when it changes. */
const LIVE_PATH = '/live'

/**
 * Carried by every page the server sends (the web build has no server, so its pages don't): it reloads the page when
 * `/live` streams a version other than the one the page was served with. A dropped stream reconnects by itself, so a
 * restart on the same version changes nothing.
 */
const RELOAD_ON_NEW_VERSION = `new EventSource('${LIVE_PATH}').onmessage = (event) => { if (event.data !== ${JSON.stringify(APP_VERSION)}) location.reload() }`

/**
 * Sends the version as a server-sent event and keeps the stream open: when the app stops, the stream drops, the page's
 * `EventSource` reconnects after `retry` milliseconds and reads the version the app restarted on. `close` ends it.
 */
function streamVersion(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  response.write(`retry: 500\ndata: ${APP_VERSION}\n\n`)
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

function send(response: ServerResponse, reply: Reply): void {
  switch (reply.kind) {
    case 'html':
      response.writeHead(reply.status, { 'content-type': 'text/html; charset=utf-8' })
      response.end(reply.html.replace('</body>', () => `  <script>${RELOAD_ON_NEW_VERSION}</script>\n</body>`))
      return
    case 'redirect':
      response.writeHead(303, { location: reply.location })
      response.end()
      return
    case 'notFound':
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
  }
}
