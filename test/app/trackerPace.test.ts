import { afterEach, describe, expect, test } from 'vitest'
import type { RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Ticket } from '../../src/connectors/connector.js'
import { appOnTracker, inputsSection, page, type AppOnTracker } from './appOnTracker.js'
import { post } from './forms.js'

// Pace following the tracker on the Inputs screen and the forecast (#212), through the local server as the EM's
// browser sees it, on the canned connector.

const CHECKOUT = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const

// The Tuesdays of the 8 weeks the read reaches whole, from 14 Sep, the milestone started on Monday 31 Aug; the current
// week, of 9 Nov, is left out.
const TUESDAYS = ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']
const COUNTS = [4, 5, 6, 0, 7, 5, 6, 8]

const finished: Ticket[] = COUNTS.flatMap((count, week) =>
  Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: `${TUESDAYS[week]}T10:00:00Z` })),
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

/** The app, its milestone entered with typed counts kept; connected to GitHub with its tickets picked, unless `connect` is false. */
async function start({ connect = true, fixture = FIXTURE } = {}): Promise<RunningApp> {
  app = await appOnTracker(fixture)
  const { running } = app
  await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-08-31', ticketsRemaining: '30' })
  await post(running, '/inputs/pace-counts', { counts: '1 2 3 4' })
  if (connect) {
    await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
    await post(running, '/inputs/milestone-query/add', CHECKOUT)
    await post(running, '/inputs/setup/use-these', {})
  }
  return running
}

/** The Pace section of the Inputs screen. */
async function paceSection(running: RunningApp): Promise<string> {
  return inputsSection(await page(running, '/inputs'), 'pace')
}

describe('pace following GitHub', () => {
  test('from an incomplete read, pace is marked incomplete, not unread', async () => {
    const running = await start({ fixture: { ...FIXTURE, reads: { [CHECKOUT.query]: { tickets: finished, incomplete: true } } } })

    await post(running, '/inputs/pace-mode', { paceMode: 'tracker' })

    const section = await paceSection(running)
    expect(section).toMatch(/weeks finished · GitHub, read in part <span class="incomplete">incomplete<\/span>/)
    expect(section).not.toContain('not read yet')
    expect(section).toContain('GitHub gave only part of the finished tickets its queries match')
  })

  test('connected, pace offers GitHub beside typed counts and the range', async () => {
    const running = await start()

    const section = await paceSection(running)

    expect(section).toMatch(/<input type="radio" name="paceMode" value="tracker"[^>]*> GitHub/)
    expect(section).toMatch(/<input type="radio" name="paceMode" value="counts"[^>]*> Typed counts/)
    expect(section).toMatch(/<input type="radio" name="paceMode" value="range" checked[^>]*> Range/)
  })

  test('following, its counts show as bars, a quiet week as a stub, with its weeks and the read', async () => {
    const running = await start()

    await post(running, '/inputs/pace-mode', { paceMode: 'tracker' })

    const section = await paceSection(running)
    expect(section).toMatch(/value="tracker" checked/)
    expect(section.match(/class="bar[ "]/g)).toHaveLength(8)
    expect(section.match(/class="bar zero"/g)).toHaveLength(1)
    expect(section).toContain('aria-label="Finished tickets per week, oldest first: 4, 5, 6, 0, 7, 5, 6, 8"')
    expect(section).toContain('last 8 weeks')
    expect(section).toMatch(/read 12 Nov \d\d:00/)
  })

  test('its weeks sit behind Show weeks, as blocks to type into that switch pace to typed counts', async () => {
    const running = await start()
    await post(running, '/inputs/pace-mode', { paceMode: 'tracker' })

    const section = await paceSection(running)
    expect(section).toMatch(/<details[^>]*>\s*<summary>Show weeks<\/summary>/)
    const blocks = [...section.matchAll(/<input type="number" name="week" [^>]*value="(\d+)"/g)].map((block) => block[1])
    expect(blocks).toEqual(COUNTS.map(String))

    const typed = new URLSearchParams(COUNTS.map((count, week) => ['week', String(week === 7 ? 9 : count)]))
    await post(running, '/inputs/pace-weeks', typed)

    const after = await paceSection(running)
    expect(after).toMatch(/value="counts" checked/)
    expect(after).toContain('value="4, 5, 6, 0, 7, 5, 6, 9"')
  })

  test('the forecast says its pace is GitHub’s weeks', async () => {
    const running = await start()
    await post(running, '/inputs/pace-mode', { paceMode: 'tracker' })

    expect(await page(running, '/')).toContain('GitHub’s last 8 weeks')
  })

  test('with no connection, pace offers only typed counts and the range', async () => {
    const running = await start({ connect: false })

    const section = await paceSection(running)

    expect(section).not.toContain('value="tracker"')
    expect(section).not.toContain('Show weeks')
  })
})
