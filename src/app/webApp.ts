import type { Storage } from '../storage/storage.js'
import { appContext, route, type Request } from './routes.js'

/** A screen to show: the path it is at, after any redirect, its status and the whole page. */
export interface Page {
  path: string
  status: number
  html: string
}

export interface WebApp {
  /** Answers `request` as the server would, following a redirect to the screen it names. */
  show(request: Request): Page
}

export interface WebAppOptions {
  /** On first open, when it is empty, the default team is added to it. */
  storage: Storage
  /** Today's ISO calendar date; the browser's local date unless given. */
  today?: () => string
}

const NOT_FOUND = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Not found · Forecaster</title></head>
<body><p>Not found. <a href="/">Back to the Milestone forecast</a></p></body>
</html>
`

/** The app with no server, for the web build (#114): its page asks it for each screen in place of a request. */
export function openWebApp(options: WebAppOptions): WebApp {
  const context = appContext(options.storage, options.today)
  return {
    show(request) {
      const reply = route(request, context)
      switch (reply.kind) {
        case 'html':
          // a post answered with a page names the screen it shows
          return { path: reply.path ?? request.path, status: reply.status, html: reply.html }
        case 'redirect':
          return this.show({ method: 'GET', path: reply.location })
        case 'notFound':
          return { path: request.path, status: 404, html: NOT_FOUND }
      }
    },
  }
}
