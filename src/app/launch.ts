import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Team } from '../model/team.js'
import type { Storage } from '../storage/storage.js'
import { route, type AppContext, type Reply } from './routes.js'

/** Localhost only: the Forecaster is a local, single-user tool and is never reachable from the network. */
const HOST = '127.0.0.1'

export interface LaunchOptions {
  /** 0 picks a free port. */
  port: number
  openBrowser: (url: string) => void
  /** Where the app keeps its data. On first launch, when it is empty, the default team is added to it. */
  storage: Storage
  /** Today's ISO calendar date, the start date's default; the system clock's local date unless given. */
  today?: () => string
}

export interface RunningApp {
  url: string
  close: () => Promise<void>
}

/** Starts the local server and opens the browser on the Milestone forecast screen. */
export async function startAppAndOpenBrowser(options: LaunchOptions): Promise<RunningApp> {
  const context: AppContext = {
    storage: options.storage,
    today: options.today ?? (() => localCalendarDate(new Date())),
  }
  addDefaultTeamIfEmpty(context.storage)
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

/**
 * The one team everything is stored under, added on first launch and installed at `installedAt`. The MVP has no team
 * screen, so the EM never sees it: its facts are the ones the EM types in, read from no board or repository.
 */
export function defaultTeam(installedAt: string): Team {
  return { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt }
}

/** On first launch (nothing stored yet), adds the default team, installed now. Otherwise does nothing. */
function addDefaultTeamIfEmpty(storage: Storage): void {
  if (!storage.isEmpty()) return
  storage.saveTeam(defaultTeam(new Date().toISOString()))
}

/** `at` as the EM's calendar date, `YYYY-MM-DD`, in the machine's time zone: not UTC's, which can be a day off. */
function localCalendarDate(at: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}

/** Hands the request to the routes and writes their reply. */
async function serve(request: IncomingMessage, response: ServerResponse, context: AppContext): Promise<void> {
  const method = request.method ?? 'GET'
  const path = new URL(request.url ?? '/', `http://${HOST}`).pathname
  const form = method === 'POST' ? new URLSearchParams(await readBody(request)) : undefined
  send(response, route({ method, path, ...(form && { form }) }, context))
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
      response.end(reply.html)
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
