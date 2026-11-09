import { describe, expect, test } from 'vitest'
import { defaultTeam } from '../../src/app/routes.js'
import { openWebApp } from '../../src/app/webApp.js'
import { openWebStorage } from '../../src/storage/webStorage.js'

// The web build's screens, as its page asks for them (#114): no server, so the app answers each request itself and
// follows a redirect to the screen it names.

const TODAY = '2026-10-30'

/** A web app on empty browser storage, as a viewer opening the shared page for the first time sees it. */
function firstOpen() {
  const storage = openWebStorage(undefined)
  return { storage, app: openWebApp({ storage, today: () => TODAY }) }
}

const post = (path: string, fields: Record<string, string>) => ({ method: 'POST', path, form: new URLSearchParams(fields) })

describe('web app', () => {
  test('on first open, shows the empty state with no sample data, under the default team', () => {
    const { storage, app } = firstOpen()

    const page = app.show({ method: 'GET', path: '/' })

    expect(page).toMatchObject({ path: '/', status: 200 })
    expect(page.html).toContain('No milestone defined yet')
    expect(page.html).not.toContain('Checkout v2')
    expect(storage.teams()).toEqual([defaultTeam(storage.teams()[0]!.installedAt)])
  })

  test('opened again on the same storage, adds no other team', () => {
    const { storage } = firstOpen()

    openWebApp({ storage, today: () => TODAY })

    expect(storage.teams()).toHaveLength(1)
  })

  test('the EM can enter a milestone and its pace and is shown it forecast', () => {
    const { app } = firstOpen()

    app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    const page = app.show(post('/inputs/pace', { low: '5', high: '10' }))

    expect(page.path).toBe('/')
    expect(page.html).toContain('Launch · 30 tickets remaining')
    expect(page.html).toMatch(/Starting 2 Nov 2026: 85% confident of finishing by/)
  })

  test('a save in place answers with the Inputs screen', () => {
    const { app } = firstOpen()

    const page = app.show({ ...post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }), saveInPlace: true })

    expect(page).toMatchObject({ path: '/inputs', status: 200 })
    expect(page.html).toContain('value="Launch"')
  })

  test('a refused form shows the Inputs screen again, refused', () => {
    const { app } = firstOpen()

    const page = app.show(post('/inputs/pace', { low: '10', high: '5' }))

    expect(page).toMatchObject({ path: '/inputs', status: 400 })
  })

  test('typed capacity comes back to the forecast; refused, the forecast is shown again, saying why', () => {
    const { app } = firstOpen()
    app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    app.show(post('/inputs/pace', { low: '5', high: '10' }))

    expect(app.show(post('/capacity/add', { percent: '0', from: '2026-11-02', to: '2026-11-06', note: 'Offsite' }))).toMatchObject({ path: '/', status: 200 })
    expect(app.show({ method: 'GET', path: '/' }).html).toContain('<span class="capacity">0%</span>')
    const refused = app.show(post('/capacity/add', { percent: 'half', from: '2026-11-09', to: '' }))

    expect(refused).toMatchObject({ path: '/', status: 400 })
    expect(refused.html).toContain('Capacity is a whole percentage, 0 or more.')
    expect(refused.html).toContain('Offsite')
  })

  test('capacity in use is compared with usual capacity, and switched off, the forecast says its entries are kept', () => {
    const { app } = firstOpen()
    app.show(post('/inputs/milestone', { name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '30' }))
    app.show(post('/inputs/pace', { low: '5', high: '10' }))
    app.show(post('/capacity/add', { percent: '0', from: '2026-11-02', to: '2026-11-06', note: 'Offsite' }))

    expect(app.show({ method: 'GET', path: '/' }).html).toContain('<th>With capacity</th><th>At usual capacity</th>')
    const off = app.show(post('/capacity/switch', { on: 'false' }))

    expect(off).toMatchObject({ path: '/', status: 200 })
    expect(off.html).toContain('Capacity is switched off for this forecast; its entries are kept.')
    expect(off.html).toContain('Offsite')
  })

  test('shows not found for anything but the screens', () => {
    const { app } = firstOpen()

    const page = app.show({ method: 'GET', path: '/nope' })

    expect(page).toMatchObject({ path: '/nope', status: 404 })
    expect(page.html).toContain('Not found')
  })
})
