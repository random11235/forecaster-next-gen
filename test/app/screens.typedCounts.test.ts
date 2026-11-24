import { describe, expect, test } from 'vitest'
import { redirectedTo, SAVE_IN_PLACE } from './forms.js'
import { startOnSavedData, page, post, stored, submitCounts, choosePace, saveInPlace, TEAM } from './screensHarness.js'

// The Inputs screen's typed counts through the local server (see screensHarness.ts): each form read as the browser
// posts it into what is stored. What the screen shows of them, and what it refuses, are
// test/forecast/milestoneForecastView.pace.test.ts's, test/forecast/milestoneForecastView.forms.test.ts's and
// test/app/components/inputsScreen.test.ts's.

const paceCounts = (): number[] | undefined => stored().milestoneInputs(TEAM)?.paceCounts

describe('Inputs screen: typed counts', () => {
  test('saved as typed; a count added goes last, and removing the last takes it off', async () => {
    await startOnSavedData()

    const saved = await submitCounts('6 4,9')
    expect(redirectedTo(saved)).toBe('/inputs')
    expect(paceCounts()).toEqual([6, 4, 9])

    expect((await post('/inputs/pace-counts/add', [['count', '7']])).status).toBe(303)
    expect(paceCounts()).toEqual([6, 4, 9, 7])

    expect((await post('/inputs/pace-counts/remove-last', [])).status).toBe(303)
    expect(paceCounts()).toEqual([6, 4, 9])
  })

  test('choosing typed counts is saved', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9')

    expect((await choosePace('counts')).status).toBe(303)

    expect(stored().milestoneInputs(TEAM)?.paceMode).toBe('counts')
  })
})

describe('Inputs screen: saving as inputs change', () => {
  test('a form saved in place answers with the Inputs screen, not a redirect to the forecast', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9')

    const response = await saveInPlace('/inputs/pace-mode', [['paceMode', 'counts']])

    expect(response.status).toBe(200)
    expect(await response.text()).toMatch(/<input type="radio" name="paceMode" value="counts" checked/)
    expect(stored().milestoneInputs(TEAM)?.paceMode).toBe('counts')
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
  test('has no workflow form to post to', async () => {
    await startOnSavedData()

    expect((await post('/inputs/workflow', [['startedStatus', 'In Progress']])).status).toBe(404)
  })
})
