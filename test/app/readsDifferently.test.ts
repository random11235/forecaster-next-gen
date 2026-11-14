import { afterEach, describe, expect, test } from 'vitest'
import type { RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import { appOnTracker, inputsSection, post, type AppOnTracker } from './appOnTracker.js'

// The "GitHub reads differently" chip on the Inputs screen (#215), through the local server as the EM's browser sees
// it, on the canned connector: its dot, the reading it opens, and Follow.

const CHECKOUT = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const
const RELEASE = { kind: 'milestone', name: 'Checkout v2', query: 'fixVersion = "Checkout v2"' } as const

const OPEN = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
// 2, 3 and 4 finished in the weeks of 19 Oct, 26 Oct and 2 Nov
const FINISHED = [
  ...['a', 'b'].map((id) => ({ id, finishedAt: '2026-10-20T10:00:00Z' })),
  ...['c', 'd', 'e'].map((id) => ({ id, finishedAt: '2026-10-27T10:00:00Z' })),
  ...['f', 'g', 'h', 'i'].map((id) => ({ id, finishedAt: '2026-11-03T10:00:00Z' })),
]

const FIXTURE: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT, RELEASE], pastLimit: false }],
  reads: { [CHECKOUT.query]: { tickets: [...OPEN, ...FINISHED], incomplete: false }, [RELEASE.query]: { tickets: OPEN, incomplete: false } },
}

let app: AppOnTracker | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/** The app, its milestone entered with `ticketsRemaining` typed, connected to `tracker` with its tickets picked. */
async function start({ ticketsRemaining = '30', tracker = 'github' } = {}): Promise<RunningApp> {
  app = await appOnTracker(FIXTURE)
  const { running } = app
  await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-10-05', ticketsRemaining })
  if (tracker === 'github') {
    await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
    await post(running, '/inputs/milestone-query/add', CHECKOUT)
  } else {
    await post(running, '/inputs/connect', { tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test', token: 'token' })
    await post(running, '/inputs/milestone-query/add', RELEASE)
  }
  return running
}


/** The section of the Inputs screen with `id`. */
async function section(running: RunningApp, id: string): Promise<string> {
  return inputsSection(running, id)
}

/** The chip in `html`: its summary, from the `<details>` to its end. */
function chip(html: string): string | undefined {
  const start = html.indexOf('<details class="reads-differently"')
  return start === -1 ? undefined : html.slice(start, html.indexOf('</details>', start))
}

describe('tickets remaining', () => {
  test('typed and different, it carries the chip with its dot, which opens GitHub’s reading and offers Follow GitHub', async () => {
    const running = await start()

    const shown = chip(await section(running, 'milestone'))

    expect(shown).toMatch(/<summary><span class="dot"[^>]*><\/span>GitHub reads differently<\/summary>/)
    expect(shown).toMatch(/GitHub reads <b>3<\/b> tickets remaining, read 12 Nov \d\d:00/)
    expect(shown).toMatch(/<button type="submit" form="follow-tickets"[^>]*>Follow GitHub<\/button>/)
  })

  test('opening the reading clears the dot', async () => {
    const running = await start()

    const opened = await post(running, '/inputs/reading-opened', { reading: 'ticketsRemaining' })

    expect(opened.headers.get('location')).toBe('/inputs')
    expect(chip(await section(running, 'milestone'))).toMatch(/<summary>GitHub reads differently<\/summary>/)
  })

  test('Follow switches it back to GitHub, with no chip', async () => {
    const running = await start()
    const shown = await section(running, 'milestone')
    expect(shown).toMatch(/<form method="post" action="\/inputs\/tickets-source#milestone" id="follow-tickets">\s*<input type="hidden" name="ticketsSource" value="tracker">/)

    await post(running, '/inputs/tickets-source', { ticketsSource: 'tracker' })

    const following = await section(running, 'milestone')
    expect(following).toMatch(/<span class="reading-value">3<\/span>/)
    expect(chip(following)).toBeUndefined()
  })

  test('typed the same as GitHub’s, it carries no chip', async () => {
    const running = await start({ ticketsRemaining: '3' })

    expect(chip(await section(running, 'milestone'))).toBeUndefined()
  })

  test('on Jira, the chip says Jira', async () => {
    const running = await start({ tracker: 'jira' })

    const shown = chip(await section(running, 'milestone'))

    expect(shown).toContain('Jira reads differently')
    expect(shown).toContain('Follow Jira')
  })
})

describe('pace', () => {
  test('a range other than GitHub’s carries the chip, which shows GitHub’s weeks and follows GitHub', async () => {
    const running = await start()
    await post(running, '/inputs/pace', { low: '1', high: '9' })

    const shown = chip(await section(running, 'pace'))

    expect(shown).toMatch(/<summary><span class="dot"[^>]*><\/span>GitHub reads differently<\/summary>/)
    expect(shown).toContain('class="pace-bars"')
    expect(shown).toMatch(/<button type="submit" form="follow-pace"[^>]*>Follow GitHub<\/button>/)

    await post(running, '/inputs/reading-opened', { reading: 'pace' })
    expect(chip(await section(running, 'pace'))).toMatch(/<summary>GitHub reads differently<\/summary>/)

    await post(running, '/inputs/pace-mode', { paceMode: 'tracker' })
    expect(chip(await section(running, 'pace'))).toBeUndefined()
  })
})
