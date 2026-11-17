import { describe, expect, test } from 'vitest'
import { SAVE_IN_PLACE } from '../../src/app/inputsScript.js'
import { startOnSavedData, page, text, post, submitPace, submitCounts, choosePace, saveInPlace } from './screensHarness.js'

// The screens through the local server: see screensHarness.ts.

describe('Inputs screen: typed counts', () => {
  test('offers pace as a range or as typed counts, the range chosen for an untouched milestone, and says typed counts need 4 for a forecast and 8 to be reliable', async () => {
    await startOnSavedData()

    const html = await page('/inputs')

    expect(html).toMatch(/<input type="radio" name="paceMode" value="range" checked/)
    expect(html).toMatch(/<input type="radio" name="paceMode" value="counts"(?! checked)/)
    expect(html).toMatch(/<input type="text" name="counts" value=""/)
    expect(text(html)).toContain('Typed counts need at least 4 for a forecast, and 8 to be reliable.')
  })

  test('saving typed counts keeps them on the Inputs screen, oldest first', async () => {
    await startOnSavedData()

    const response = await submitCounts('6 4,9')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4, 9"/)
  })

  test('adding a count puts it last, and removing the last takes it off again', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9')

    expect((await post('/inputs/pace-counts/add', [['count', '7']])).status).toBe(303)
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4, 9, 7"/)

    expect((await post('/inputs/pace-counts/remove-last', [])).status).toBe(303)
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4, 9"/)
  })

  test('refuses typed counts that are not whole numbers, saying why, keeping what was typed and changing nothing', async () => {
    await startOnSavedData()
    await submitCounts('6, 4')

    const response = await submitCounts('6, -1')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Enter typed counts as whole numbers of tickets, 0 or more.')
    expect(html).toMatch(/name="counts" value="6, -1"/)
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4"/)
  })

  test('refuses a count to add that is not a whole number, saying why and keeping what was typed', async () => {
    await startOnSavedData()
    await submitCounts('6, 4')

    const response = await post('/inputs/pace-counts/add', [['count', '2.5']])

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Enter typed counts as whole numbers of tickets, 0 or more.')
    expect(html).toMatch(/name="count" [^>]*value="2.5"/)
    expect(await page('/inputs')).toMatch(/name="counts" value="6, 4"/)
  })

  test('choosing typed counts goes to the forecast, keeps the range, and shows typed counts chosen', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    await submitCounts('6, 4, 9')

    const response = await choosePace('counts')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    const html = await page('/inputs')
    expect(html).toMatch(/<input type="radio" name="paceMode" value="counts" checked/)
    expect(html).toMatch(/name="low"[^>]*value="4"/)
  })

  test('with 3 typed counts in use, notes beside the typed counts that the forecast needs at least 4', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9')

    await choosePace('counts')

    expect(await page('/inputs')).toMatch(
      /name="counts"[^>]*>[\s\S]*?<p class="warning">⚠ Typed counts: 3 weeks entered. The forecast needs at least 4. Add another count, or switch pace to the range.<\/p>/,
    )
  })

  test('with 4 typed counts in use, notes beside the typed counts that 8 are needed for reliable results', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9, 7')

    await choosePace('counts')

    expect(await page('/inputs')).toMatch(/name="counts"[^>]*>[\s\S]*?<p class="warning">⚠ 4 of 8 needed for reliable results<\/p>/)
  })
})

describe('Inputs screen: saving as inputs change', () => {
  test('choosing typed counts saves it and answers with the Inputs screen showing it chosen, not the forecast', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9')

    const response = await saveInPlace('/inputs/pace-mode', [['paceMode', 'counts']])

    expect(response.status).toBe(200)
    expect(await response.text()).toMatch(/<input type="radio" name="paceMode" value="counts" checked/)
    expect(await page('/inputs')).toMatch(/<input type="radio" name="paceMode" value="counts" checked/)
  })

  test('the Inputs screen carries its own script, which saves in place; the forecast carries none', async () => {
    await startOnSavedData()
    // besides the live reload every page the server sends carries (launch.test.ts)
    const ownScripts = async (path: string) =>
      [...(await page(path)).matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, , body]) => !body?.includes('EventSource'))

    const scripts = await ownScripts('/inputs')

    expect(scripts).toHaveLength(1)
    expect(scripts[0]![1]).toBe('')
    expect(scripts[0]![2]).toContain(`'${SAVE_IN_PLACE.header}': '${SAVE_IN_PLACE.value}'`)
    expect(await ownScripts('/')).toEqual([])
  })
})

describe('Inputs screen: workflow', () => {
  test('offers no workflow settings', async () => {
    await startOnSavedData()

    const html = await page('/inputs')

    expect(html).not.toMatch(/\/inputs\/workflow|name="status:|name="startedStatus"|name="commitLabel"|name="blocked/)
    expect(text(html)).not.toMatch(/Workflow|Board status|Commit label/)
    expect((await post('/inputs/workflow', [['startedStatus', 'In Progress']])).status).toBe(404)
  })
})
