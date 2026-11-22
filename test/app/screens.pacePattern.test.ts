import { describe, expect, test } from 'vitest'
import { startOnSavedData, post, stored, submitCounts, choosePace, TEAM } from './screensHarness.js'

// The screens through the local server: see screensHarness.ts. What app/ owns of the pace pattern: its action's
// fields read as posted, Undo, and the status of a refusal. How the pattern reads is the Milestone forecast screen's
// component test's (components/milestoneForecastScreen.test.ts), and what an action does Seam B's
// (test/forecast/pacePattern.*.test.ts).

describe('Milestone forecast screen: pace pattern', () => {
  const action = () => stored().milestoneInputs(TEAM)?.paceWindow.action

  test('the action posts its kind and date, back to the forecast, and Undo clears it', async () => {
    await startOnSavedData()
    await submitCounts('4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8')
    await choosePace('counts')

    const applied = await post('/pace-action/apply', [
      ['action', 'startFrom'],
      ['date', '2026-09-22'],
    ])

    expect(applied.status).toBe(303)
    expect(applied.headers.get('location')).toBe('/')
    expect(action()).toEqual({ kind: 'startFrom', date: '2026-09-22' })

    const undone = await post('/pace-action/undo', [])

    expect(undone.headers.get('location')).toBe('/')
    expect(action()).toBeUndefined()
  })

  test('leaving out the odd week posts the period it leaves out', async () => {
    await startOnSavedData()
    await submitCounts('5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4')
    await choosePace('counts')

    await post('/pace-action/apply', [
      ['action', 'leaveOut'],
      ['period', '2026-09-28'],
    ])

    expect(action()).toEqual({ kind: 'leaveOut', period: '2026-09-28' })
  })

  test('an action not offered is refused with a 400, the forecast again saying why', async () => {
    await startOnSavedData()
    await submitCounts('4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8')
    await choosePace('counts')

    const refused = await post('/pace-action/apply', [
      ['action', 'skipAll'],
      ['date', '2026-09-22'],
    ])

    expect(refused.status).toBe(400)
    expect(await refused.text()).toContain('That action is no longer offered.')
    expect(action()).toBeUndefined()
  })

  test('an action posted with no fields reads them as empty, and is refused with a 400', async () => {
    await startOnSavedData()
    await submitCounts('4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8')
    await choosePace('counts')

    const refused = await post('/pace-action/apply', [])

    expect(refused.status).toBe(400)
    expect(await refused.text()).toContain('That action is no longer offered.')
    expect(action()).toBeUndefined()
  })
})
