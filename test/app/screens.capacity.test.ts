import { describe, expect, test } from 'vitest'
import { one, render } from './dom.js'
import { redirectedTo } from './forms.js'
import { startOnSavedData, page, post, stored, submitPace, submitCounts, choosePace, addCapacity, editCapacity, TEAM } from './screensHarness.js'

// The screens through the local server: see screensHarness.ts. What app/ owns of capacity: the forms' fields read as
// posted, where each goes back to, the section opened at its own URL, and the status of a refusal. How the section
// reads is the Milestone forecast screen's component test's (components/milestoneForecastScreen.test.ts), and what each
// entry does to the forecast Seam B's (test/forecast/capacity*.test.ts, newUsual.test.ts).

/** The Capacity section of the screen `html` draws: whether it is open, and the URL its toggle goes to. */
function capacity(html: string) {
  const section = one(render(html), '#capacity')
  return { open: section.hasAttribute('open'), toggle: section.getAttribute('data-toggle') }
}

describe('Milestone forecast screen: capacity', () => {
  test('the sentence’s fields are read as typed, its percent, dates, onward and note, and it goes back to the forecast', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const added = await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')
    await addCapacity('60', '2026-11-23', '', 'Holiday', true)

    expect(redirectedTo(added)).toBe('/')
    expect(stored().capacityEntries(TEAM)).toEqual([
      { id: 1, percent: 0, from: '2026-11-02', to: '2026-11-06', note: 'Offsite' },
      { id: 2, percent: 60, from: '2026-11-23', to: undefined, note: 'Holiday' },
    ])
  })

  test('refused, the forecast again with a 400, the section open, and nothing kept', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const refused = await addCapacity('50', '2026-09-14', '2026-09-07', 'Half on <leave>')

    expect(refused.status).toBe(400)
    expect(capacity(await refused.text()).open).toBe(true)
    expect(stored().capacityEntries(TEAM)).toEqual([])
  })

  test('posted from the open section, it goes back to the section open, at the URL that opens it, and so does a refusal', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const saved = await post('/capacity/add?capacity=open', [
      ['percent', '0'],
      ['from', '2026-11-02'],
      ['to', '2026-11-06'],
      ['note', 'Offsite'],
    ])
    const refused = await post('/capacity/add?capacity=open', [
      ['percent', 'half'],
      ['from', '2026-09-14'],
      ['to', ''],
    ])

    expect(redirectedTo(saved)).toBe('/?capacity=open')
    expect(refused.status).toBe(400)
    expect(capacity(await refused.text())).toEqual({ open: true, toggle: '/#capacity' })
    expect(capacity(await page('/'))).toEqual({ open: false, toggle: '/?capacity=open#capacity' })
    expect(capacity(await page('/?capacity=open'))).toEqual({ open: true, toggle: '/#capacity' })
  })

  test('an entry’s Edit, a past one’s note alone, Remove and the switch post the id or on they carry', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')
    await addCapacity('0', '2026-09-07', '2026-09-11', 'Offsite')

    const edited = await editCapacity('1', '50', '2026-11-09', '2026-11-13', 'Offsite, half the team')
    await post('/capacity/edit', [
      ['id', '2'],
      ['note', 'Offsite in Lisbon'],
    ])

    expect(redirectedTo(edited)).toBe('/')
    expect(stored().capacityEntries(TEAM)).toEqual([
      { id: 1, percent: 50, from: '2026-11-09', to: '2026-11-13', note: 'Offsite, half the team' },
      { id: 2, percent: 0, from: '2026-09-07', to: '2026-09-11', note: 'Offsite in Lisbon' },
    ])

    const switched = await post('/capacity/switch', [['on', 'false']])
    expect(redirectedTo(switched)).toBe('/')
    expect(stored().capacityOn(TEAM)).toBe(false)
    await post('/capacity/switch', [['on', 'true']])
    expect(stored().capacityOn(TEAM)).toBe(true)

    const removed = await post('/capacity/remove', [['id', '1']])
    expect(redirectedTo(removed)).toBe('/')
    expect(
      stored()
        .capacityEntries(TEAM)
        .map(({ id }) => id),
    ).toEqual([2])
  })

  test('a lasting entry’s Make it the new usual, Keep it and End it today post its id, back to the section open', async () => {
    await startOnSavedData()
    await submitCounts('4, 6, 5, 7')
    await choosePace('counts')
    await addCapacity('80', '2026-09-22', '', 'Two left', true)
    await addCapacity('90', '2026-09-22', '', 'One left', true)

    const accepted = await post('/capacity/new-usual?capacity=open', [['id', '1']])
    await post('/capacity/keep?capacity=open', [['id', '2']])

    expect(redirectedTo(accepted)).toBe('/?capacity=open')
    expect(stored().capacityEntries(TEAM)).toEqual([
      { id: 1, percent: 80, from: '2026-09-22', to: '2026-10-24', note: 'Two left', newUsualOn: '2026-10-24' },
      { id: 2, percent: 90, from: '2026-09-22', to: undefined, note: 'One left', kept: true },
    ])

    // with a pace range, the EM ends it themselves
    await submitPace('4', '8')
    await choosePace('range')
    const ended = await post('/capacity/end-today?capacity=open', [['id', '2']])

    expect(redirectedTo(ended)).toBe('/?capacity=open')
    expect(stored().capacityEntries(TEAM)[1]).toMatchObject({ id: 2, to: '2026-10-23' })
  })

  test.each([
    ['/capacity/edit', 400],
    ['/capacity/new-usual', 400],
    ['/capacity/keep', 400],
    ['/capacity/end-today', 400],
    // removing no entry leaves every one, as removing one already gone does
    ['/capacity/remove', 303],
  ])('%s posted with no id reads it as empty: answered %s, every entry kept', async (path, status) => {
    await startOnSavedData()
    await submitPace('4', '8')
    // lasting, so each action would take it, given its id
    await addCapacity('80', '2026-09-28', '', 'Two left', true)

    const answered = await post(path, [])

    expect(answered.status).toBe(status)
    expect(stored().capacityEntries(TEAM)).toEqual([{ id: 1, percent: 80, from: '2026-09-28', to: undefined, note: 'Two left' }])
  })
})
