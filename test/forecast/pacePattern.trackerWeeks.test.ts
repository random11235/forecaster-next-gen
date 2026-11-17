import { describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import { submitConnection } from '../../src/forecast/connection.js'
import { submitInputs } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { submitStepQuery } from '../../src/forecast/queryStep.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { submitSkip, type Skipping } from '../../src/forecast/skippedPeriods.js'
import type { TrackerReads } from '../../src/forecast/trackerReads.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import type { Storage } from '../../src/storage/storage.js'
import { TEAM, TODAY, openStorage, submit, useTempFile } from './pacePatternScenario.js'

// The pattern read from the tracker's weeks (#213), not only from typed counts.

useTempFile()

describe('from the tracker’s weeks (#213)', () => {
  const checkout: Choice = { kind: 'milestone', name: 'Launch', query: 'milestone:"Launch"' }
  const READ_AT = '2026-11-11T09:00:00Z'
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
  async function followingGitHub(counts: readonly number[]): Promise<{ storage: Storage; using: Skipping; tracker: TrackerReads }> {
    const opened = openStorage()
    opened.saveTeam({ id: TEAM, name: 'Acme', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
    opened.saveSetupState(TEAM, { open: false, closed: 'done' })
    const tickets = counts.flatMap((count, week) =>
      Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: tuesday(GITHUB_WEEKS[week]!) })),
    )
    const fixture: CannedFixture = {
      milestoneChoices: [{ kind: 'milestone', choices: [checkout], pastLimit: false }],
      reads: { [checkout.query]: { tickets: [{ id: 'open' }, ...tickets], incomplete: false } },
    }
    const using: Skipping = {
      connections: opened,
      milestoneInputs: opened,
      queries: opened,
      setup: opened,
      secrets: openMemorySecrets(),
      connector: () => cannedConnector(fixture),
    }
    const tracker: TrackerReads = { ...using, timeZone: 'UTC' }
    await submitConnection(using, TEAM, { kind: 'connect', tracker: 'github', repo: 'acme/launch', site: '', projectKey: '', email: '', token: 'token' })
    submit(opened, { kind: 'setMilestone', name: 'Launch', startDate: '2026-08-03', ticketsRemaining: '60' })
    await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
    submitInputs(opened, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setPaceMode', paceMode: 'tracker' }, { tracker })
    return { storage: opened, using, tracker }
  }

  function trackerForecast(storage: Storage, tracker: TrackerReads) {
    const view = milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker })
    if (view.kind !== 'forecast') throw new Error(`no forecast: ${view.kind}`)
    return view
  }

  test('holiday weeks skipped, the weeks either side read Steady', async () => {
    // two quiet holiday weeks, 12 and 19 Oct, among weeks of 4 to 6
    const { storage, using, tracker } = await followingGitHub([5, 4, 6, 5, 5, 4, 0, 0, 5, 6])
    expect(trackerForecast(storage, tracker).pacePattern?.pattern).not.toBe('steady')

    await submitSkip(
      using,
      TEAM,
      { kind: 'skip', periods: ['2026-10-12', '2026-10-19'] },
      { settings: DEFAULT_SETTINGS, today: TODAY, readAt: READ_AT, timeZone: 'UTC' },
    )

    expect(trackerForecast(storage, tracker).pacePattern).toMatchObject({ pattern: 'steady', line: 'Steady · 4 to 6 a week' })
  })

  test('a short repo, with 5 weeks of finished tickets, is too early to read', async () => {
    const { storage, tracker } = await followingGitHub([0, 0, 0, 0, 0, 5, 4, 6, 5, 5])

    expect(trackerForecast(storage, tracker).pacePattern).toEqual({ pattern: undefined, line: 'No pattern yet · 5 weeks is too few to tell' })
  })
})
