import { describe, expect, test } from 'vitest'
import { APP_VERSION } from '../../src/forecast/index.js'
import { openWebApp } from '../../src/app/webApp.js'
import { openWebStorage } from '../../src/storage/webStorage.js'
import { defaultTeam } from './appOnTracker.js'

// The web build's screens, as its page asks for them (#114): no server, so the app answers each request itself and
// follows a redirect to the screen it names.

const TODAY = '2026-10-30'

/** A web app on empty browser storage, as a viewer opening the shared page for the first time sees it. */
function firstOpen() {
  const storage = openWebStorage(undefined)
  return { storage, app: openWebApp({ storage, clock: { now: () => `${TODAY}T09:00:00Z`, timeZone: 'UTC' } }) }
}

const post = (path: string, fields: Record<string, string>) => ({ method: 'POST', path, form: new URLSearchParams(fields) })

describe('web app', () => {
  test('on first open, shows the empty state with no sample data, under the default team', async () => {
    const { storage, app } = firstOpen()

    const page = await app.show({ method: 'GET', path: '/' })

    expect(page).toMatchObject({ path: '/', status: 200 })
    expect(page.html).toContain('No milestone defined yet')
    expect(page.html).not.toContain('Checkout v2')
    expect(storage.teams()).toEqual([{ ...defaultTeam(''), installedAt: expect.any(String) }])
  })

  test('opened again on the same storage, adds no other team', () => {
    const { storage } = firstOpen()

    openWebApp({ storage, clock: { now: () => `${TODAY}T09:00:00Z`, timeZone: 'UTC' } })

    expect(storage.teams()).toHaveLength(1)
  })

  test('the EM can enter a milestone and its pace and is shown it forecast', async () => {
    const { app } = firstOpen()

    await app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    const page = await app.show(post('/inputs/pace', { low: '5', high: '10' }))

    expect(page.path).toBe('/')
    expect(page.html).toContain('Launch · 30 tickets remaining')
    expect(page.html).toMatch(/Starting 2 Nov 2026: 85% confident of finishing by/)
  })

  test('a save in place answers with the Inputs screen', async () => {
    const { app } = firstOpen()

    const page = await app.show({ ...post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }), saveInPlace: true })

    expect(page).toMatchObject({ path: '/inputs', status: 200 })
    expect(page.html).toContain('value="Launch"')
  })

  test('on browser storage holding data it cannot read, fails each screen as the server does, naming the key, and keeps the data', async () => {
    // a later build's data, written straight into the store: this build can't write it
    const later = JSON.stringify({ teams: [{ ...defaultTeam(''), source: 'trello' }] })
    const items = new Map([['forecaster', later]])
    const storage = openWebStorage({ getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) })
    const app = openWebApp({ storage, clock: { now: () => `${TODAY}T09:00:00Z`, timeZone: 'UTC' } })

    const shown = await app.show({ method: 'GET', path: '/' })
    // a failed post names no screen, so the URL stays as it was
    const posted = await app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))

    expect(shown).toMatchObject({ path: '/', status: 500 })
    expect(posted).toStrictEqual({ status: 500, html: shown.html })
    expect(shown.html).toContain('Forecaster error: Error: browser storage&#39;s &#34;forecaster&#34; holds JSON of a shape')
    expect(items.get('forecaster')).toBe(later)
  })

  test('a refused form shows the Inputs screen again, refused', async () => {
    const { app } = firstOpen()

    const page = await app.show(post('/inputs/pace', { low: '10', high: '5' }))

    expect(page).toMatchObject({ path: '/inputs', status: 400 })
  })

  test('typed capacity comes back to the forecast; refused, the forecast is shown again, saying why', async () => {
    const { app } = firstOpen()
    await app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    await app.show(post('/inputs/pace', { low: '5', high: '10' }))

    expect(await app.show(post('/capacity/add', { percent: '0', from: '2026-11-02', to: '2026-11-06', note: 'Offsite' }))).toMatchObject({
      path: '/',
      status: 200,
    })
    expect((await app.show({ method: 'GET', path: '/' })).html).toContain('<span class="capacity">0%</span>')
    const refused = await app.show(post('/capacity/add', { percent: 'half', from: '2026-11-09', to: '' }))

    expect(refused).toMatchObject({ path: '/', status: 400 })
    expect(refused.html).toContain('Capacity is a whole percentage, 0 or more.')
    expect(refused.html).toContain('Offsite')
  })

  test('capacity in use is compared with usual capacity, and switched off, the forecast says its entries are kept', async () => {
    const { app } = firstOpen()
    await app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    await app.show(post('/inputs/pace', { low: '5', high: '10' }))
    await app.show(post('/capacity/add', { percent: '0', from: '2026-11-02', to: '2026-11-06', note: 'Offsite' }))

    expect((await app.show({ method: 'GET', path: '/' })).html).toContain('<th>With capacity</th><th>At usual capacity</th>')
    const off = await app.show(post('/capacity/switch', { on: 'false' }))

    expect(off).toMatchObject({ path: '/', status: 200 })
    expect(off.html).toContain('Capacity is switched off for this forecast; its entries are kept.')
    expect(off.html).toContain('Offsite')
  })

  test('the Capacity section, opened, gives each entry’s effect and stays open across saves', async () => {
    const { app } = firstOpen()
    await app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    await app.show(post('/inputs/pace', { low: '5', high: '10' }))
    await app.show(post('/capacity/add', { percent: '0', from: '2026-11-02', to: '2026-11-06', note: 'Offsite' }))
    expect((await app.show({ method: 'GET', path: '/' })).html).not.toContain('85% date +')

    const opened = await app.show({ method: 'GET', path: '/?capacity=open' })
    expect(opened.html).toContain('data-toggle="/#capacity" open>')
    expect(opened.html).toContain('85% date +1 wk')

    const saved = await app.show(post('/capacity/add?capacity=open', { percent: '0', from: '2026-11-30', to: '', note: 'Holiday' }))
    expect(saved).toMatchObject({ path: '/?capacity=open', status: 200 })
    expect(saved.html).toContain('data-toggle="/#capacity" open>')
    expect(saved.html).toMatch(/Holiday<\/span> <span class="effect[^"]*">(no change to the 85% date|85% date \+\d wk)</)
  })

  test('an edited capacity entry comes back to the forecast, changed', async () => {
    const { app } = firstOpen()
    await app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    await app.show(post('/inputs/pace', { low: '5', high: '10' }))
    await app.show(post('/capacity/add', { percent: '0', from: '2026-11-02', to: '2026-11-06', note: 'Offsite' }))

    const page = await app.show(post('/capacity/edit', { id: '1', percent: '50', from: '2026-11-02', to: '2026-11-06', note: 'Half offsite' }))

    expect(page).toMatchObject({ path: '/', status: 200 })
    expect(page.html).toContain('Half offsite')
    expect(page.html).toContain('<details class="edit">')
  })

  test('a lasting change proposed as the new usual, once made so, is listed under Past', async () => {
    const { app } = firstOpen()
    await app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    // the weeks from 28 Sep to 19 Oct, the last whole one before 30 Oct's
    await app.show(post('/inputs/pace-counts', { counts: '4, 6, 5, 7' }))
    await app.show(post('/inputs/pace-mode', { paceMode: 'counts' }))
    const added = await app.show(post('/capacity/add?capacity=open', { percent: '80', from: '2026-09-28', to: '', onward: 'on', note: 'Two left' }))
    expect(added.html).toContain('action="/capacity/new-usual?capacity=open#capacity"')

    const page = await app.show(post('/capacity/new-usual?capacity=open', { id: '1' }))

    expect(page).toMatchObject({ path: '/?capacity=open', status: 200 })
    expect(page.html).toContain('28 Sep 2026 to 30 Oct 2026 · new usual from 30 Oct 2026')
    expect(page.html).not.toContain('/capacity/new-usual')
  })

  test('typed counts get their pace pattern; its button applies the action, and a refused one shows the forecast again, saying why', async () => {
    const { app } = firstOpen()
    await app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    await app.show(post('/inputs/pace-counts', { counts: '4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8' }))

    const page = await app.show(post('/inputs/pace-mode', { paceMode: 'counts' }))

    expect(page.html).toContain('<summary>Stepped up · about 4 a week, then 8 since 28 Sep</summary>')
    expect((await app.show(post('/pace-action/apply', { action: 'startFrom', date: '2026-09-28' }))).html).toContain(
      'Counting pace from 28 Sep, after it stepped up.',
    )
    const refused = await app.show(post('/pace-action/apply', { action: 'startFrom', date: 'soon' }))
    expect(refused).toMatchObject({ path: '/', status: 400 })
    expect(refused.html).toContain('That action is no longer offered.')
  })

  test('shows not found for anything but the screens', async () => {
    const { app } = firstOpen()

    const page = await app.show({ method: 'GET', path: '/nope' })

    expect(page).toMatchObject({ path: '/nope', status: 404 })
    expect(page.html).toContain('Not found')
  })

  test.each(['/', '/inputs', '/how-it-works'])('%s shows the version in its footer, with no live reload: there is no server', async (path) => {
    const { app } = firstOpen()

    const page = await app.show({ method: 'GET', path })

    expect(page.html).toContain(`<footer class="version">Forecaster ${APP_VERSION}</footer>`)
    expect(page.html).not.toContain('EventSource')
  })
})
