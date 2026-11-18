import type { Storage } from '../storage/storage.js'
import { escapeHtml } from './html.js'
import { appContext, route, type AppContext, type Request } from './routes.js'

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

/** A request that threw, answered as the server answers it (`launch.ts`): a 500 giving the error. */
function failed(path: string, error: unknown): Page {
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Error · Forecaster</title></head>
<body><p>${escapeHtml(`Forecaster error: ${String(error)}`)}</p></body>
</html>
`
  return { path, status: 500, html }
}

/**
 * The app with no server, for the web build (#114): its page asks it for each screen in place of a request. Storage
 * that throws (holding data this version can't read) fails each screen it throws on, as the server fails a request,
 * from the first open on.
 */
export function openWebApp(options: WebAppOptions): WebApp {
  let context: AppContext | Error
  try {
    context = appContext(options.storage, options.today)
  } catch (error) {
    context = error as Error
  }
  return {
    show(request) {
      try {
        if (context instanceof Error) throw context
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
      } catch (error) {
        return failed(request.path, error)
      }
    },
  }
}
