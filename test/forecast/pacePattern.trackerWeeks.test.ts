import { describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { pick, skip, type ForecastingForTest } from './forecastingForTest.js'
import { NOW, forecast, submit, teamOn } from './pacePatternScenario.js'

// The pattern read from the tracker's weeks (#213), not only from typed counts.

describe('from the tracker’s weeks (#213)', () => {
  const checkout: Choice = { kind: 'milestone', name: 'Launch', query: 'milestone:"Launch"' }
  // GitHub's weeks, Mondays from 31 Aug to 2 Nov; the week of 9 Nov is the current one
  const GITHUB_WEEKS = [
    '2026-08-31',
    '2026-09-07',
    '2026-09-14',
    '2026-09-21',
    '2026-09-28',
    '2026-10-05',
    '2026-10-12',
    '2026-10-19',
    '2026-10-26',
    '2026-11-02',
  ]
  const tuesday = (monday: string): string => new Date(Date.parse(`${monday}T10:00:00Z`) + 86_400_000).toISOString()

  /** A milestone started long before, following GitHub, which finished `counts[i]` tickets in the week of `GITHUB_WEEKS[i]`. */
  async function followingGitHub(counts: readonly number[]): Promise<ForecastingForTest> {
    const tickets = counts.flatMap((count, week) =>
      Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: tuesday(GITHUB_WEEKS[week] ?? '') })),
    )
    const team = await teamOn({
      milestoneChoices: [{ kind: 'milestone', choices: [checkout], pastLimit: false }],
      reads: { [checkout.query]: { tickets: [{ id: 'open' }, ...tickets], incomplete: false } },
    })
    await submit(team, { kind: 'setMilestone', name: 'Launch', startDate: '2026-08-03', ticketsRemaining: '60' })
    await pick(team, NOW, checkout)
    await submit(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    return team
  }

  test('holiday weeks skipped, the weeks either side read Steady', async () => {
    // two quiet holiday weeks, 12 and 19 Oct, among weeks of 4 to 6
    const team = await followingGitHub([5, 4, 6, 5, 5, 4, 0, 0, 5, 6])
    expect((await forecast(team)).pacePattern?.pattern).not.toBe('steady')

    await skip(team, ['2026-10-12', '2026-10-19'], NOW)

    expect((await forecast(team)).pacePattern).toMatchObject({ pattern: 'steady', line: 'Steady · 4 to 6 a week' })
  })

  test('a short repo, with 5 weeks of finished tickets, is too early to read', async () => {
    const team = await followingGitHub([0, 0, 0, 0, 0, 5, 4, 6, 5, 5])

    expect((await forecast(team)).pacePattern).toEqual({ pattern: undefined, line: 'No pattern yet · 5 weeks is too few to tell' })
  })
})
