import type { Storage } from '../storage/storage.js'
import { escapeHtml } from './html.js'
import { appContext, route, type AppContext, type Request } from './routes.js'

/**
 * A screen to show: its status, the whole page, and the path it is at, after any redirect; a failed post has none, so
 * the URL stays as it was.
 */
export interface Page {
  path?: string
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

/** A page with no screen of the app's: `title` and the paragraph `body`, already escaped. */
const plainPage = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} · Forecaster</title></head>
<body><p>${body}</p></body>
</html>
`

const NOT_FOUND = plainPage('Not found', 'Not found. <a href="/">Back to the Milestone forecast</a>')

/** A request that threw, answered as the server answers it (`launch.ts`): a 500 giving the error. */
function failed(request: Request, error: unknown): Page {
  const html = plainPage('Error', escapeHtml(`Forecaster error: ${String(error)}`))
  return { ...(request.method === 'GET' && { path: request.path }), status: 500, html }
}

/**
 * The app with no server, for the web build (#114): its page asks it for each screen in place of a request. Storage
 * that throws (holding data this version can't read) fails each screen it throws on, as the server fails a request,
 * from the first open on.
 */
export function openWebApp(options: WebAppOptions): WebApp {
  let opened: { context: AppContext } | { error: unknown }
  try {
    opened = { context: appContext(options.storage, options.today) }
  } catch (error) {
    opened = { error }
  }
  return {
    show(request) {
      if ('error' in opened) return failed(request, opened.error)
      try {
        const reply = route(request, opened.context)
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
        return failed(request, error)
      }
    },
  }
}
