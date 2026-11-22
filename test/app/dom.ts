import { Window, type Document, type Element } from 'happy-dom'

// The screens' HTML parsed into a page, and queried as a screen reader and the EM read it: by role and accessible name,
// and by visible text (#236). A component test renders a view and asks what the page offers, not how the markup is
// written. No script runs: a page's scripts are browserPage.ts's.

/** What `byRole` finds an element by: its accessible name, exactly or matching. */
export interface RoleQuery {
  name?: string | RegExp
}

/** The one window every render parses in, with JavaScript off. */
const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } })

/** `html`, a whole page or a fragment of one, parsed into a document. */
export function render(html: string): Document {
  return new window.DOMParser().parseFromString(html, 'text/html')
}

/** The one element in `scope` with `role` (and `name`, if given), failing with each such role's names if not exactly one. */
export function byRole(scope: Document | Element, role: string, query: RoleQuery = {}): Element {
  const found = allByRole(scope, role, query)
  if (found.length !== 1) {
    const names = allByRole(scope, role).map((element) => JSON.stringify(accessibleName(element)))
    throw new Error(`Expected one ${role} named ${String(query.name ?? '(any)')}, found ${found.length}. The ${role}s: ${names.join(', ') || 'none'}`)
  }
  return found[0]!
}

/** Each element in `scope` with `role` (and `name`, if given), in document order, skipping what is hidden. */
export function allByRole(scope: Document | Element, role: string, { name }: RoleQuery = {}): Element[] {
  return [...scope.querySelectorAll('*')].filter(
    (element) => roleOf(element) === role && !hidden(element) && (name === undefined || matches(accessibleName(element), name)),
  )
}

/** Whether `scope` has an element with `role` (and `name`, if given). */
export function hasRole(scope: Document | Element, role: string, query: RoleQuery = {}): boolean {
  return allByRole(scope, role, query).length > 0
}

/** The visible text of `of`, its styles and scripts left out and whitespace collapsed. */
export function text(of: Document | Element): string {
  const root = 'body' in of ? of.body : of
  const copy = root.cloneNode(true) as Element
  for (const unseen of copy.querySelectorAll('style, script, template')) unseen.remove()
  // a block starts on a line of its own, so its text never runs into its neighbour's
  for (const block of copy.querySelectorAll(BLOCKS)) {
    block.before(' ')
    block.after(' ')
  }
  return collapse(copy.textContent ?? '')
}

const BLOCKS =
  'p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, form, section, header, footer, main, nav, figure, figcaption, fieldset, legend, table, tr, td, th, br, details, summary, dl, dt, dd'

/** The name a screen reader says for `element`. */
export function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/)
    return collapse(ids.map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '').join(' '))
  }
  const label = element.getAttribute('aria-label')
  if (label) return collapse(label)
  const tag = element.localName
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return controlName(element)
  if (tag === 'img') return collapse(element.getAttribute('alt') ?? '')
  if (tag === 'fieldset') return collapse(element.querySelector('legend')?.textContent ?? '')
  if (tag === 'figure') return collapse(element.querySelector('figcaption')?.textContent ?? '')
  return collapse(element.textContent ?? '')
}

function controlName(control: Element): string {
  const type = control.getAttribute('type')
  if (type === 'submit' || type === 'button') return collapse(control.getAttribute('value') ?? '')
  const id = control.getAttribute('id')
  const label = (id ? control.ownerDocument.querySelector(`label[for="${id}"]`) : null) ?? control.closest('label')
  return collapse(label?.textContent ?? control.getAttribute('placeholder') ?? '')
}

/** The role an element has: its own `role`, or the one its tag implies. */
function roleOf(element: Element): string | undefined {
  const explicit = element.getAttribute('role')
  if (explicit) return explicit.split(/\s+/)[0]
  const tag = element.localName
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'input') {
    const type = element.getAttribute('type') ?? 'text'
    return type in INPUT_ROLES ? INPUT_ROLES[type] : 'textbox'
  }
  if (tag === 'a') return element.hasAttribute('href') ? 'link' : undefined
  if ((tag === 'section' || tag === 'form') && !element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby')) return undefined
  return TAG_ROLES[tag]
}

const INPUT_ROLES: Record<string, string | undefined> = {
  submit: 'button',
  button: 'button',
  reset: 'button',
  radio: 'radio',
  checkbox: 'checkbox',
  number: 'spinbutton',
  search: 'searchbox',
  date: undefined,
  hidden: undefined,
}

const TAG_ROLES: Record<string, string> = {
  button: 'button',
  textarea: 'textbox',
  select: 'combobox',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  tr: 'row',
  th: 'columnheader',
  td: 'cell',
  fieldset: 'group',
  figure: 'figure',
  img: 'img',
  nav: 'navigation',
  aside: 'complementary',
  main: 'main',
  section: 'region',
  form: 'form',
  dialog: 'dialog',
  summary: 'button',
}

/** Hidden from the EM and their screen reader: by `hidden`, `aria-hidden`, a hidden input, or a closed `<details>` around it. */
function hidden(element: Element): boolean {
  if (element.localName === 'input' && element.getAttribute('type') === 'hidden') return true
  for (let at: Element | null = element; at; at = at.parentElement) {
    if (at.hasAttribute('hidden') || at.getAttribute('aria-hidden') === 'true') return true
    const details = at.parentElement
    if (details?.localName === 'details' && !details.hasAttribute('open') && at.localName !== 'summary') return true
  }
  return false
}

function matches(name: string, wanted: string | RegExp): boolean {
  return typeof wanted === 'string' ? name === wanted : wanted.test(name)
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The first element in `scope` matching `selector`, failing if there is none. */
export function one(scope: Document | Element, selector: string): Element {
  const found = scope.querySelector(selector)
  if (!found) throw new Error(`Expected an element matching ${selector}, found none`)
  return found
}

/** The nearest element around `element`, or itself, matching `selector`, failing if there is none. */
export function around(element: Element, selector: string): Element {
  const found = element.closest(selector)
  if (!found) throw new Error(`Expected an element matching ${selector} around ${element.localName}, found none`)
  return found
}
