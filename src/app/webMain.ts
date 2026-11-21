/**
 * The web build's page script (#114): the whole app in one page, with no server. It answers what the server would
 * itself: a link or form shows the screen the app answers with, and the Inputs screen's saves (`fetch`, see
 * `inputsScript.ts`) are answered here too. The screen's path is kept in the URL's fragment, so a reload or the back
 * button finds it again. The EM's data stays in their browser's storage.
 */
import { openWebStorage } from '../storage/webStorage.js'
import { SAVE_IN_PLACE } from './inputsScript.js'
import type { Request } from './appContext.js'
import { openWebApp, type Page } from './webApp.js'

const app = openWebApp({ storage: openWebStorage(browserStorage()) })
/** The path of the screen on show. */
let shownPath = ''

/** The browser's storage, if it gives any: reading `localStorage` throws where site data is blocked. */
function browserStorage(): globalThis.Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const pathOf = (href: string): string => href.split('#')[0]!
const fragmentOf = (href: string): string | undefined => href.split('#')[1]

function pathInUrl(): string {
  const path = location.hash.slice(1)
  return path.startsWith('/') ? path : '/'
}

/** Puts the page in place of this one, running its scripts, and scrolls to `fragment` if it has it. */
function render(page: Page, fragment: string | undefined): void {
  const next = new DOMParser().parseFromString(page.html, 'text/html')
  document.head.replaceWith(document.importNode(next.head, true))
  document.body.replaceWith(document.importNode(next.body, true))
  // a script brought in from a parsed page doesn't run; one made here does
  for (const parsed of document.body.querySelectorAll('script')) {
    const script = document.createElement('script')
    script.textContent = parsed.textContent
    parsed.replaceWith(script)
  }
  // a page with no path (a failed post) leaves the URL as it was
  if (page.path !== undefined && page.path !== pathInUrl()) {
    try {
      history.pushState(null, '', `#${page.path}`)
    } catch {
      // a sandboxed frame may refuse; the screen still shows, only a reload won't find it
    }
  }
  shownPath = page.path ?? shownPath
  const target = fragment && document.getElementById(fragment)
  if (target) target.scrollIntoView()
  else window.scrollTo(0, 0)
}

const show = async (request: Request, fragment?: string): Promise<void> => render(await app.show(request), fragment)

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const href = (event.target as Element).closest('a[href]')?.getAttribute('href')
  if (!href?.startsWith('/')) return
  event.preventDefault()
  void show({ method: 'GET', path: pathOf(href) }, fragmentOf(href))
})

// the Inputs screen's script saves its own forms, and has already taken their submits
document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement
  const action = form.getAttribute('action')
  if (event.defaultPrevented || !action?.startsWith('/')) return
  event.preventDefault()
  const fields = [...new FormData(form, event.submitter)].map(([name, value]): [string, string] => [name, String(value)])
  void show({ method: 'POST', path: pathOf(action), form: new URLSearchParams(fields) }, fragmentOf(action))
})

window.addEventListener('popstate', () => {
  if (pathInUrl() !== shownPath) void show({ method: 'GET', path: pathInUrl() })
})

const browserFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  if (typeof input !== 'string' || !input.startsWith('/')) return browserFetch(input, init)
  const headers = new Headers(init?.headers)
  const page = await app.show({
    method: init?.method ?? 'GET',
    path: pathOf(input),
    form: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    saveInPlace: headers.get(SAVE_IN_PLACE.header) === SAVE_IN_PLACE.value,
  })
  return new Response(page.html, { status: page.status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

void show({ method: 'GET', path: pathInUrl() })
