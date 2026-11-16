import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Connecting } from '../forecast/connection.js'
import type { Storage } from '../storage/storage.js'
import { SAVE_IN_PLACE } from './inputsScript.js'
import { VERSION } from './version.js'
import { appContext, route, routeSetup, type AppContext, type Reply, type Request } from './routes.js'

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
  /** Today's ISO calendar date, the start date's default; the system clock's local date unless given. */
  today?: () => string
  /** The UTC instant now, which reads are made at; the system clock unless given. */
  now?: () => string
}

export interface RunningApp {
  url: string
  close: () => Promise<void>
}

/** Starts the local server and opens the browser on the Milestone forecast screen. */
export async function startAppAndOpenBrowser(options: LaunchOptions): Promise<RunningApp> {
  const context = appContext(options.storage, options.today, options.connecting, options.now)
  const server = createServer((request, response) => {
    serve(request, response, context).catch((error: unknown) => {
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
async function serve(request: IncomingMessage, response: ServerResponse, context: AppContext): Promise<void> {
  const method = request.method ?? 'GET'
  const { pathname, search } = new URL(request.url ?? '/', `http://${HOST}`)
  if (method === 'GET' && pathname === LIVE_PATH) return streamVersion(response)
  const path = pathname + search
  const form = method === 'POST' ? new URLSearchParams(await readBody(request)) : undefined
  const saveInPlace = request.headers[SAVE_IN_PLACE.header] === SAVE_IN_PLACE.value
  const routed: Request = { method, path, ...(form && { form }), ...(saveInPlace && { saveInPlace }) }
  send(response, await (routeSetup(routed, context) ?? route(routed, context)))
}

/** Where an open page listens for the version the app is running, to reload when it changes. */
const LIVE_PATH = '/live'

/**
 * Carried by every page the server sends (the web build has no server, so its pages don't): it reloads the page when
 * `/live` streams a version other than the one the page was served with. A dropped stream reconnects by itself, so a
 * restart on the same version changes nothing.
 */
const RELOAD_ON_NEW_VERSION = `new EventSource('${LIVE_PATH}').onmessage = (event) => { if (event.data !== ${JSON.stringify(VERSION)}) location.reload() }`

/**
 * Sends the version as a server-sent event and keeps the stream open: when the app stops, the stream drops, the page's
 * `EventSource` reconnects after `retry` milliseconds and reads the version the app restarted on. `close` ends it.
 */
function streamVersion(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  response.write(`retry: 500\ndata: ${VERSION}\n\n`)
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
