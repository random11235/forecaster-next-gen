import { Window, type Document, type Element } from 'happy-dom'
import { afterAll } from 'vitest'

// The screens' HTML parsed into a page, and queried as a screen reader and the EM read it: by role and accessible name,
// and by visible text (#236). A component test renders a view and asks what the page offers, not how the markup is
// written. No script runs: a page's scripts are browserPage.ts's. The roles and names are the part of ARIA the
// screens use, not all of it: a role a screen doesn't use is not in `Role`. Importing it registers an `afterAll` in the
// importing test file, closing the one window the file's renders parse in.

/** The one window every render parses in, with JavaScript off; closed once the test file is done. */
const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } })
afterAll(() => window.happyDOM.close())

/** `html`, a whole page or a fragment of one, parsed into a document. */
export function render(html: string): Document {
  return new window.DOMParser().parseFromString(html, 'text/html')
}

/** An input's role by its type; none for a type with no role of its own. */
const INPUT_ROLES = {
  submit: 'button',
  button: 'button',
  reset: 'button',
  radio: 'radio',
  checkbox: 'checkbox',
  number: 'spinbutton',
  search: 'searchbox',
  date: undefined,
  password: undefined,
  hidden: undefined,
} as const

/** The role a tag implies; a `section` or `form` only once named. */
const TAG_ROLES = {
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
} as const

/** The roles the screens give in a `role` attribute, beyond those their tags imply. */
const GIVEN_ROLES = ['alert', 'switch'] as const

/** A role a query can ask for: one a tag implies, or one the screens give. */
export type Role =
  (typeof TAG_ROLES)[keyof typeof TAG_ROLES] | NonNullable<(typeof INPUT_ROLES)[keyof typeof INPUT_ROLES]> | (typeof GIVEN_ROLES)[number] | 'heading' | 'link'

/** The one element in `scope` with `role` (and `name`, if given), failing with each such role's names if not exactly one. */
export function byRole(scope: Document | Element, role: Role, query: { name?: string | RegExp } = {}): Element {
  const found = allByRole(scope, role, query)
  if (found.length !== 1) {
    const names = allByRole(scope, role).map((element) => JSON.stringify(accessibleName(element)))
    throw new Error(`Expected one ${role} named ${String(query.name ?? '(any)')}, found ${found.length}. The ${role}s: ${names.join(', ') || 'none'}`)
  }
  return found[0]!
}

/** Each element in `scope` with `role` (and `name`, if given), in document order, skipping what is hidden. */
export function allByRole(scope: Document | Element, role: Role, { name }: { name?: string | RegExp } = {}): Element[] {
  return [...scope.querySelectorAll('*')].filter(
    (element) => roleOf(element) === role && !hidden(element) && (name === undefined || matches(accessibleName(element), name)),
  )
}

/** Whether `scope` has an element with `role` (and `name`, if given). */
export function hasRole(scope: Document | Element, role: Role, query: { name?: string | RegExp } = {}): boolean {
  return allByRole(scope, role, query).length > 0
}

/** Each radio in `group`, by its name, and whether it is checked. */
export function radios(group: Element): [string, boolean][] {
  return allByRole(group, 'radio').map((radio) => [accessibleName(radio), radio.hasAttribute('checked')])
}

/** Where the form `element` is in posts to. */
export function postsTo(element: Element): string | null {
  return around(element, 'form').getAttribute('action')
}

/**
 * The text of `of` the EM sees, whitespace collapsed: its styles and scripts left out, what is `hidden` too, and all
 * but the summary of a closed `<details>`. Text hidden from a screen reader alone (`aria-hidden`) is still seen, so kept.
 * (screensHarness.ts's `text` is a served page's, its tags stripped.)
 */
export function text(of: Document | Element): string {
  const root = 'body' in of ? of.body : of
  const copy = root.cloneNode(true) as Element
  for (const unseen of copy.querySelectorAll(UNSEEN)) unseen.remove()
  for (const closed of copy.querySelectorAll('details:not([open])')) {
    for (const folded of [...closed.childNodes]) if ((folded as Element).localName !== 'summary') closed.removeChild(folded)
  }
  // a block starts on a line of its own, so its text never runs into its neighbour's
  for (const block of copy.querySelectorAll(BLOCKS)) {
    block.before(' ')
    block.after(' ')
  }
  return collapse(copy.textContent ?? '')
}

/** What neither the EM nor their screen reader is given: styles, scripts, templates and what is `hidden`. */
const UNSEEN = 'style, script, template, [hidden]'

const BLOCKS =
  'p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, form, section, header, footer, main, nav, figure, figcaption, fieldset, legend, table, tr, td, th, br, details, summary, dl, dt, dd'

/** The name a screen reader says for `element`. */
export function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/)
    return collapse(ids.map((id) => spokenText(element.ownerDocument.getElementById(id))).join(' '))
  }
  const label = element.getAttribute('aria-label')
  if (label) return collapse(label)
  const tag = element.localName
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return controlName(element)
  if (tag === 'img') return collapse(element.getAttribute('alt') ?? '')
  if (tag === 'fieldset') return spokenText(element.querySelector('legend'))
  if (tag === 'figure') return spokenText(element.querySelector('figcaption'))
  return spokenText(element)
}

function controlName(control: Element): string {
  const type = control.getAttribute('type')
  if (type === 'submit' || type === 'button') return collapse(control.getAttribute('value') ?? '')
  const id = control.getAttribute('id')
  const label = (id ? control.ownerDocument.querySelector(`label[for="${id}"]`) : null) ?? control.closest('label')
  return label ? spokenText(label) : collapse(control.getAttribute('placeholder') ?? '')
}

/** The text a screen reader says of `element`'s content: what is hidden from it left out. */
function spokenText(element: Element | null): string {
  if (!element) return ''
  const copy = element.cloneNode(true) as Element
  for (const unsaid of copy.querySelectorAll(`${UNSEEN}, [aria-hidden="true"]`)) unsaid.remove()
  return collapse(copy.textContent ?? '')
}

/** The role an element has: its own `role`, or the one its tag implies. */
function roleOf(element: Element): string | undefined {
  const explicit = element.getAttribute('role')
  if (explicit) return explicit.split(/\s+/)[0]
  const tag = element.localName
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'input') {
    const type = element.getAttribute('type') ?? 'text'
    return type in INPUT_ROLES ? INPUT_ROLES[type as keyof typeof INPUT_ROLES] : 'textbox'
  }
  if (tag === 'a') return element.hasAttribute('href') ? 'link' : undefined
  if ((tag === 'section' || tag === 'form') && !element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby')) return undefined
  return tag in TAG_ROLES ? TAG_ROLES[tag as keyof typeof TAG_ROLES] : undefined
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

// By selector, where a role and text say too little: a visual state (the headline's emphasis, a bar's height, a shaded
// week), a block with no role of its own, or what the page carries for its scripts (a `data-` attribute, a hidden field).

/** The first element in `scope` matching `selector`, failing if there is none, or, given a `kind`, if it isn't one. */
export function one(scope: Document | Element, selector: string): Element
export function one<T extends Element>(scope: Document | Element, selector: string, kind: abstract new (...args: never[]) => T): T
export function one(scope: Document | Element, selector: string, kind?: abstract new (...args: never[]) => Element): Element {
  const found = scope.querySelector(selector)
  if (!found) throw new Error(`Expected an element matching ${selector}, found none`)
  if (kind && !(found instanceof kind)) throw new Error(`Expected a ${kind.name} matching ${selector}, found another`)
  return found
}

/** Each element in `scope` matching `selector`, in document order: none, to check a page leaves it out. */
export function all(scope: Document | Element, selector: string): Element[] {
  return [...scope.querySelectorAll(selector)]
}

/** The nearest element around `element`, or itself, matching `selector`, failing if there is none. */
export function around(element: Element, selector: string): Element {
  const found = element.closest(selector)
  if (!found) throw new Error(`Expected an element matching ${selector} around ${element.localName}, found none`)
  return found
}

/** The fields `form` carries hidden, each as its name and value, in order: what it posts that the EM doesn't type. */
export function hiddenFields(form: Element): [string | null, string | null][] {
  return all(form, 'input[type="hidden"]').map((field) => [field.getAttribute('name'), field.getAttribute('value')])
}

/**
 * The Milestone forecast screen's Capacity section, in the page `html` either build serves, as the app tests read it:
 * whether it is open, the URL its toggle goes to, and whether it says why a form was refused.
 */
export function capacitySection(html: string) {
  const section = one(render(html), '#capacity')
  return { open: section.hasAttribute('open'), toggle: section.getAttribute('data-toggle'), refused: hasRole(section, 'alert') }
}
