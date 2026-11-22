import { PropertySymbol, type BrowserWindow, type Request, type Response } from 'happy-dom'

// The adapter between browserPage.ts's answers and happy-dom (21.x), the one place it reaches past happy-dom's public
// interface, so an upgrade that moves either breaks this file alone. No public hook does either: the fetch
// interceptor's `beforeAsyncRequest` answers with a response or lets the request go on to the network, but can't fail
// it (one thrown there leaves its async task open, so the page never settles), and a response made with `new Response`
// has no URL, which happy-dom sets the page's location from once a form it submitted is answered.
// browserPage.test.ts pins both.

/** `response`, as answered from `url`: the page a form opens is at the URL its answer came from, after any redirect. */
export function answeredFrom(response: Response, url: string): Response {
  // read-only by its type, a plain field in happy-dom
  return Object.assign(response, { url })
}

/**
 * Fails `request`, sent from `window`, as happy-dom fails one it can't send: its `fetch` rejects with a TypeError, and
 * a form it submitted stays on the page, each with its async task ended, so the page still settles. The interceptor
 * then returns no response, and happy-dom throws the reason aborted with.
 */
export function failRequest(window: BrowserWindow, request: Request, why: unknown): void {
  request.signal[PropertySymbol.abort](new window.TypeError(`Failed to fetch: ${String(why)}`))
}
