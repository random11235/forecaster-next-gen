import { describe, expect, test, vi } from 'vitest'
import { Element, HTMLFormElement, HTMLInputElement } from 'happy-dom'
import { openWebApp } from '../../src/app/webApp.js'
import { openWebStorage } from '../../src/storage/webStorage.js'
import { defaultTeam } from './defaultTeam.js'
import { byRole, text } from './dom.js'
import { change } from './fieldEvents.js'
import { SAVE_IN_PLACE } from './forms.js'
import { webPages, type WebPage } from './webPage.js'

// The web build's page script (`webMain.ts`, #114), run in happy-dom (#237): the screen it shows for the URL, the
// links, forms and back button it answers with the web build's app, and the Inputs screen's saves it answers through
// `fetch`. What each screen says is webApp.test.ts's and Seam B's; these test what the page does with it.

const pages = webPages()

/** What browser storage holds once the web build's app has been sent `posts`, as the EM's page sends them. */
async function storedAfter(...posts: [path: string, fields: Record<string, string>][]): Promise<Map<string, string>> {
  const items = new Map<string, string>()
  const app = openWebApp({ storage: openWebStorage({ getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) }) })
  for (const [path, fields] of posts) await app.show({ method: 'POST', path, form: new URLSearchParams(fields) })
  return items
}

/** A milestone and its pace entered, so the Milestone forecast screen forecasts it. */
const forecasting = (): Promise<Map<string, string>> =>
  storedAfter(['/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }], ['/inputs/pace', { low: '5', high: '10' }])

const title = (page: WebPage): string => page.window.document.title
const shows = (page: WebPage, title: string) => () => page.window.document.title === title
const FORECAST = 'Milestone forecast · Forecaster'
const INPUTS = 'Inputs · Forecaster'

/** The element `selector` finds, which must be there. */
const at = (page: WebPage, selector: string): Element => page.find(selector, Element)

/** The field named `name` of the Inputs screen's form posting to `form`. */
const field = (page: WebPage, form: string, name: string): HTMLInputElement => page.find(`form[action^="${form}"] [name="${name}"]`, HTMLInputElement)

/** Clicks `element` with the left button, and `modifiers` held; whether the page let the browser follow it. */
function click(
  page: WebPage,
  element: Element,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number } = {},
): boolean {
  return element.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }))
}

describe('the web build’s page script', () => {
  test('opens on the Milestone forecast screen, in its empty state', async () => {
    const page = await pages.open()

    expect(title(page)).toBe(FORECAST)
    expect(text(page.window.document)).toContain('No milestone defined yet')
  })

  test('opens on the screen the URL’s fragment names, and on the forecast for a fragment that names none', async () => {
    expect(title(await pages.open({ hash: '#/inputs' }))).toBe(INPUTS)
    expect(title(await pages.open({ hash: '#pace' }))).toBe(FORECAST)
  })

  test('the Inputs screen’s saves are answered by the app through fetch, kept in the browser’s storage, and found again on opening', async () => {
    const page = await pages.open({ hash: '#/inputs' })

    change(field(page, '/inputs/milestone', 'name'), 'Launch')
    change(field(page, '/inputs/milestone', 'startDate'), '2026-11-02')
    change(field(page, '/inputs/milestone', 'ticketsRemaining'), '30')
    await page.until('the milestone saved', () => text(at(page, 'section#milestone')).includes('Saved'))
    change(field(page, '/inputs/pace', 'low'), '5')
    change(field(page, '/inputs/pace', 'high'), '10')
    await page.until('the pace saved', () => text(at(page, 'section#pace')).includes('Saved'))

    expect(title(page)).toBe(INPUTS)
    const reopened = await pages.open({ stored: page.stored() })
    expect(text(reopened.window.document)).toContain('Launch · 30 tickets remaining')
  })

  test('an Inputs form submitted, as Enter in a field submits it, is the Inputs screen’s own to save, in place', async () => {
    const page = await pages.open({ hash: '#/inputs' })
    const typed = { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }
    for (const [name, value] of Object.entries(typed)) field(page, '/inputs/milestone', name).value = value

    page.find('form[action^="/inputs/milestone"]', HTMLFormElement).requestSubmit()
    await page.until('the milestone saved', () => text(at(page, 'section#milestone')).includes('Saved'))

    expect(title(page)).toBe(INPUTS)
    expect(page.window.location.hash).toBe('#/inputs')
  })

  test('a link shows the screen it links to, keeping its path in the URL’s fragment, at the part it names', async () => {
    const page = await pages.open({ stored: await forecasting() })
    const scrolledTo = vi.spyOn(page.window.HTMLElement.prototype, 'scrollIntoView')

    expect(click(page, at(page, 'a[href="/inputs#pace"]'))).toBe(false)
    await page.until('the Inputs screen', shows(page, INPUTS))

    expect(page.window.location.hash).toBe('#/inputs')
    expect(scrolledTo.mock.contexts).toEqual([at(page, '#pace')])
  })

  test('a link to a screen with no part named shows it from the top', async () => {
    const page = await pages.open()
    const scrolled = vi.spyOn(page.window, 'scrollTo')

    click(page, at(page, 'a[href="/inputs"]'))
    await page.until('the Inputs screen', shows(page, INPUTS))

    expect(scrolled).toHaveBeenCalledWith(0, 0)
  })

  test('a link clicked with a key held or another button, or to another site, is left to the browser', async () => {
    const page = await pages.open()
    const link = at(page, 'a[href="/inputs"]')
    const elsewhere = page.window.document.createElement('a')
    elsewhere.setAttribute('href', 'https://elsewhere.test/')
    page.window.document.body.append(elsewhere)

    for (const held of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) expect(click(page, link, held)).toBe(true)
    expect(click(page, elsewhere)).toBe(true)
    expect(click(page, page.window.document.body)).toBe(true)

    // the page shows a screen only once it has taken the click from the browser, which none of these clicks was
    expect(title(page)).toBe(FORECAST)
  })

  test('a form submitted is answered by the app, showing the screen it answers with at the part it names', async () => {
    const page = await pages.open({ hash: '#/?capacity=open', stored: await forecasting() })
    const scrolledTo = vi.spyOn(page.window.HTMLElement.prototype, 'scrollIntoView')
    const capacitySwitch = byRole(page.window.document, 'switch', { name: 'Use capacity in this forecast' })
    expect(capacitySwitch.getAttribute('aria-checked')).toBe('true')

    click(page, capacitySwitch)
    await page.until('capacity switched off', () => byRole(page.window.document, 'switch').getAttribute('aria-checked') === 'false')

    expect(text(page.window.document)).toContain('Off: the forecast uses pace alone.')
    expect(scrolledTo.mock.contexts).toEqual([at(page, '#capacity')])
  })

  test('the back button shows the screen before', async () => {
    const page = await pages.open()
    click(page, at(page, 'a[href="/inputs"]'))
    await page.until('the Inputs screen', shows(page, INPUTS))

    page.window.history.back()
    await page.until('the Milestone forecast screen again', shows(page, FORECAST))

    expect(page.window.location.hash).toBe('')
  })

  test('a fetch past the app’s own paths goes to the browser’s own fetch', async () => {
    const page = await pages.open()

    await page.window.fetch('https://elsewhere.test/fonts.css')
    await page.window.fetch(new URL('https://elsewhere.test/other'))

    expect(page.fetchedElsewhere).toEqual(['https://elsewhere.test/fonts.css', 'https://elsewhere.test/other'])
  })

  test('a fetch of one of the app’s own paths, asking nothing more, is answered by the app with the screen', async () => {
    const page = await pages.open()

    const answer = await page.window.fetch('/inputs')

    expect(answer.status).toBe(200)
    expect(await answer.text()).toContain('<title>Inputs · Forecaster</title>')
    expect(page.fetchedElsewhere).toEqual([])
  })

  test('a save sent through fetch asking to be answered in place is answered with the Inputs screen, and one not asking with the screen it goes to', async () => {
    const page = await pages.open({ hash: '#/inputs', stored: await forecasting() })
    const pace = { method: 'POST', body: 'low=6&high=9' }

    const inPlace = await page.window.fetch('/inputs/pace', { ...pace, headers: { [SAVE_IN_PLACE.header]: SAVE_IN_PLACE.value } })
    const notInPlace = await page.window.fetch('/inputs/pace', pace)

    expect(await inPlace.text()).toContain('<title>Inputs · Forecaster</title>')
    expect(await notInPlace.text()).toContain('<title>Milestone forecast · Forecaster</title>')
  })

  test('a form posting to another site is left to the browser', async () => {
    const page = await pages.open()
    const form = page.window.document.createElement('form')
    form.setAttribute('action', 'https://elsewhere.test/')
    page.window.document.body.append(form)
    const submitted = new page.window.SubmitEvent('submit', { bubbles: true, cancelable: true })

    expect(form.dispatchEvent(submitted)).toBe(true)
  })

  test('with the browser’s storage blocked, it still opens, and saves for as long as the page is open', async () => {
    const page = await pages.open({ hash: '#/inputs', storageBlocked: true })

    change(field(page, '/inputs/milestone', 'name'), 'Launch')
    change(field(page, '/inputs/milestone', 'startDate'), '2026-11-02')
    change(field(page, '/inputs/milestone', 'ticketsRemaining'), '30')
    await page.until('the milestone saved', () => text(at(page, 'section#milestone')).includes('Saved'))
    click(page, at(page, 'a[href="/"]'))
    await page.until('the Milestone forecast screen', shows(page, FORECAST))

    expect(text(page.window.document)).toContain('Launch Fix this on the Inputs screen to see a forecast.')
  })

  test('in a frame that refuses a history entry, a link still shows its screen, the URL left as it was', async () => {
    const page = await pages.open({ historyRefused: true })

    click(page, at(page, 'a[href="/inputs"]'))
    await page.until('the Inputs screen', shows(page, INPUTS))

    expect(page.window.location.hash).toBe('')
  })

  test('on storage it can’t read, a form that fails leaves the URL as it was', async () => {
    // a later build's data, written straight into the store: this build can't write it
    const later = new Map([['forecaster', JSON.stringify({ teams: [{ ...defaultTeam(''), source: 'trello' }] })]])
    const page = await pages.open({ hash: '#/inputs', stored: later })
    expect(text(page.window.document)).toContain('Forecaster error')
    const form = page.window.document.createElement('form')
    form.setAttribute('action', '/how-it-works')
    const send = page.window.document.createElement('button')
    form.append(send)
    page.window.document.body.append(form)

    form.requestSubmit(send)
    await page.until('the post answered', () => page.window.document.body.contains(form) === false)

    expect(page.window.location.hash).toBe('#/inputs')
    expect(text(page.window.document)).toContain('Forecaster error')
  })
})
