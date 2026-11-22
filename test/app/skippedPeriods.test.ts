import { afterEach, describe, expect, test } from 'vitest'
import type { RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Ticket } from '../../src/connectors/connector.js'
import { appOnTracker, inputsSection, page, type AppOnTracker } from './appOnTracker.js'
import { post } from './forms.js'

// Skipping GitHub's weeks on the Inputs screen and the forecast (#213), through the local server as the EM's browser
// sees it, on the canned connector.

const CHECKOUT = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const

// Mondays of GitHub's weeks with finished tickets, for a milestone started on Monday 31 Aug: the read reaches 8 whole
// weeks, from 14 Sep, and further back once weeks are skipped; the current week, of 9 Nov, is left out.
const WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']
const COUNTS = [4, 6, 3, 5, 6, 4, 7, 5, 6, 8]

// each on the Tuesday of its week
const tuesday = (monday: string): string => new Date(Date.parse(`${monday}T10:00:00Z`) + 86_400_000).toISOString()

const finished: Ticket[] = COUNTS.flatMap((count, week) =>
  Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: tuesday(WEEKS[week]!) })),
)

const FIXTURE: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
  reads: { [CHECKOUT.query]: { tickets: [{ id: 'm1' }, { id: 'm2' }, ...finished], incomplete: false } },
}

let app: AppOnTracker | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/** The app, its milestone entered and following GitHub, its tickets picked. */
async function following(): Promise<RunningApp> {
  app = await appOnTracker(FIXTURE)
  const { running } = app
  await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-08-31', ticketsRemaining: '30' })
  await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(running, '/inputs/milestone-query/add', CHECKOUT)
  await post(running, '/inputs/setup/use-these', {})
  await post(running, '/inputs/pace-mode', { paceMode: 'tracker' })
  return running
}

const periods = (starts: string[]): URLSearchParams => new URLSearchParams(starts.map((start) => ['period', start]))

/** The Pace section of the Inputs screen. */
async function paceSection(running: RunningApp): Promise<string> {
  return inputsSection(await page(running, '/inputs'), 'pace')
}

describe('skipping GitHub’s weeks', () => {
  test('each week’s block offers to skip it', async () => {
    const running = await following()

    const section = await paceSection(running)

    expect(section.match(/formaction="\/inputs\/pace-skip#pace-tracker"/g)).toHaveLength(8)
    expect(section).toMatch(
      /<button type="submit" formaction="\/inputs\/pace-skip#pace-tracker" formnovalidate name="period" value="2026-10-12"[^>]*>skip<\/button>/,
    )
    expect(section).toContain('Skip a week that says nothing about the pace ahead (a holiday, say), and the one before counts instead.')
  })

  test('a skipped week is a gap in the bars and struck through in the blocks, which stay open, the window reaching back', async () => {
    const running = await following()

    const skipped = await post(running, '/inputs/pace-skip', periods(['2026-10-12']))

    expect(skipped.status).toBe(303)
    expect(skipped.headers.get('location')).toBe('/inputs#pace-tracker')
    const section = await paceSection(running)
    expect(section.match(/class="bar[ "]/g)).toHaveLength(9)
    expect(section.match(/class="bar gap"/g)).toHaveLength(1)
    expect(section).toContain('aria-label="Finished tickets per week, oldest first: 6, 3, 5, 6, 4, skipped, 5, 6, 8"')
    expect(section).toContain('1 skipped (12 Oct), reaching back to w/c 7 Sep')
    expect(section).toMatch(/<details class="week-blocks" open>/)
    expect(section).toMatch(
      /<span class="block skipped"><s>7<\/s> 12 Oct <button type="submit" formaction="\/inputs\/pace-count-again#pace-tracker" formnovalidate name="period" value="2026-10-12"[^>]*>count<\/button><\/span>/,
    )
    expect([...section.matchAll(/<input type="number" name="week" [^>]*value="(\d+)"/g)].map((block) => block[1])).toEqual([
      '6',
      '3',
      '5',
      '6',
      '4',
      '5',
      '6',
      '8',
    ])
  })

  test('count them again brings the skipped weeks back', async () => {
    const running = await following()
    await post(running, '/inputs/pace-skip', periods(['2026-10-12', '2026-10-19']))
    const before = await paceSection(running)
    expect(before).toMatch(
      /2 skipped \(12 Oct, 19 Oct\), reaching back to w\/c 31 Aug[^]*<input type="hidden" name="period" value="2026-10-12"><input type="hidden" name="period" value="2026-10-19"><button type="submit" class="linkish">count them again<\/button>/,
    )

    const counted = await post(running, '/inputs/pace-count-again', periods(['2026-10-12', '2026-10-19']))

    expect(counted.headers.get('location')).toBe('/inputs#pace-tracker')
    const section = await paceSection(running)
    expect(section).not.toContain('class="bar gap"')
    expect(section).not.toContain('skipped (')
    expect(section).toContain('oldest first: 3, 5, 6, 4, 7, 5, 6, 8"')
  })

  test('a skip with no week is refused, saying why beside GitHub’s pace', async () => {
    const running = await following()

    const response = await post(running, '/inputs/pace-skip', periods([]))

    expect(response.status).toBe(400)
    const html = await response.text()
    const section = html.slice(html.indexOf('id="pace-tracker"'))
    expect(section).toMatch(/^id="pace-tracker">\s*<h3>GitHub<\/h3>\s*<p class="error" role="alert">Choose a week to skip.<\/p>/)
  })

  test('the forecast’s pace says how many weeks are skipped', async () => {
    const running = await following()
    await post(running, '/inputs/pace-skip', periods(['2026-10-12', '2026-10-19']))

    expect(await page(running, '/')).toContain('GitHub’s last 8 weeks, 2 skipped')
  })

  test('every week skipped, there is no forecast, and the offer to count a week again or use typed counts or the range', async () => {
    const running = await following()

    await post(running, '/inputs/pace-skip', periods(WEEKS))

    const section = await paceSection(running)
    expect(section).toContain('Every week is skipped, so GitHub gives no pace. Count a week again, or use typed counts or the range.')
    expect(section.match(/class="bar gap"/g)).toHaveLength(10)
    expect(section.match(/formaction="\/inputs\/pace-count-again#pace-tracker"/g)).toHaveLength(10)
    expect(await page(running, '/')).toContain('Every week is skipped, so GitHub gives no pace. Count a week again, or use typed counts or the range.')
  })
})
