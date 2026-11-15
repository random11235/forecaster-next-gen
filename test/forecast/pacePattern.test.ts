import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice } from '../../src/connectors/connector.js'
import { submitConnection } from '../../src/forecast/connection.js'
import { submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { submitStepQuery } from '../../src/forecast/queryStep.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { submitSkip, type Skipping } from '../../src/forecast/skippedPeriods.js'
import type { TrackerReads } from '../../src/forecast/trackerReads.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

// Pace patterns (#161): the tool reads the shape of the counts the Pace bars show and names it, with the team's
// numbers and never a cause, and where there's a forecast action it offers it with the 85% date both ways.

const TEAM = 'ACME'
/** A Wednesday, in the second week from the start date. */
const TODAY = '2026-11-11'
/**
 * A Monday. Typed counts are dated back from the current period (from 9 Nov), the last being the most recent whole
 * one: the week of 2 Nov. Ten counts are the weeks from 31 Aug to 2 Nov.
 */
const START = '2026-11-02'

let dir: string
let storage: Storage | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-pace-pattern-'))
})

afterEach(() => {
  storage?.close()
  storage = undefined
  rmSync(dir, { recursive: true, force: true })
})

function openStorage(): Storage {
  storage?.close()
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  return storage
}

function submit(storage: Storage, edit: InputsEdit) {
  return submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit)
}

/** 60 tickets from 2 Nov, its pace the typed counts, oldest first. */
function withTypedCounts(counts: readonly number[], cadenceDays = 7): Storage {
  const storage = openStorage()
  storage.saveTeam({ id: TEAM, name: 'Acme', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  submit(storage, { kind: 'setMilestone', name: 'Launch', startDate: START, ticketsRemaining: '60' })
  if (cadenceDays !== 7) submit(storage, { kind: 'setCadence', cadenceDays: String(cadenceDays) })
  submit(storage, { kind: 'setPaceCounts', counts: counts.join(', ') })
  submit(storage, { kind: 'setPaceMode', paceMode: 'counts' })
  return storage
}

function forecast(storage: Storage) {
  const view = milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY)
  if (view.kind !== 'forecast') throw new Error(`no forecast: ${view.kind}`)
  return view
}

describe('the pattern named from typed counts', () => {
  test('counts that vary a little and keep level are Steady, with their spread', () => {
    const pattern = forecast(withTypedCounts([5, 4, 6, 5, 5, 4, 6, 5, 5, 4])).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'steady',
      line: 'Steady · 4 to 6 a week',
      meaning: 'No sign the pace is changing. The forecast takes these weeks as they are.',
    })
    expect(pattern?.action).toBeUndefined()
  })

  test('a lasting rise is Stepped up, from the week it stepped, offering to count pace from there', () => {
    // 14 weeks from 3 Aug: about 4 a week, then 8 from the week of 12 Oct.
    const pattern = forecast(withTypedCounts([4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8])).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'steppedUp',
      line: 'Stepped up · about 4 a week, then 8 since 12 Oct',
      meaning: 'About 4 a week, then 8 since 12 Oct.',
      advice: "If that's lasting, count pace from 12 Oct.",
      action: { kind: 'startFrom', date: '2026-10-12', button: 'Start from 12 Oct' },
    })
  })

  test('a lasting fall is Stepped down, from the week it stepped', () => {
    // 14 weeks from 3 Aug: about 8 a week, then 4 from the week of 21 Sep.
    const pattern = forecast(withTypedCounts([8, 9, 7, 8, 9, 8, 9, 4, 3, 4, 4, 3, 5, 4])).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'steppedDown',
      line: 'Stepped down · about 8 a week, then 4 since 21 Sep',
      action: { kind: 'startFrom', date: '2026-09-21', button: 'Start from 21 Sep' },
    })
  })

  test('a steady climb is Speeding up, with advice not to extend it and no action', () => {
    const pattern = forecast(withTypedCounts([2, 2, 1, 3, 2, 2, 2, 3, 3, 4, 5, 5, 6, 7])).pacePattern

    expect(pattern).toEqual({
      pattern: 'speedingUp',
      line: 'Speeding up · from about 2 to about 5 a week',
      meaning: 'From about 2 a week in the first 7 weeks to about 5 in the last 7.',
      advice: "Don't extend the trend: the forecast draws from all 14 weeks, so if it goes on, the dates will move sooner as new weeks are read.",
    })
  })

  test('a steady decline is Slowing down', () => {
    const pattern = forecast(withTypedCounts([8, 9, 8, 7, 8, 8, 8, 7, 7, 6, 5, 5, 4, 3])).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'slowingDown',
      line: 'Slowing down · from about 8 to about 5 a week',
      advice: "Don't extend the trend: the forecast draws from all 14 weeks, so if it goes on, the dates will move later as new weeks are read.",
    })
  })

  test('busy weeks and quiet weeks in runs are Good and bad spells, warning the range may be too narrow', () => {
    const pattern = forecast(withTypedCounts([5, 5, 4, 5, 6, 5, 3, 2, 3, 8, 9, 8, 2, 3])).pacePattern

    expect(pattern).toEqual({
      pattern: 'goodAndBadSpells',
      line: 'Good and bad spells · 2 to 9 a week',
      meaning: 'Busy weeks come together and so do quiet ones: 2 to 9 a week, in runs.',
      advice: 'The range may be too narrow, since quiet weeks come in runs. Hold the dates loosely.',
    })
  })

  test('counts that vary far more than their level are Lumpy, advising to keep every week', () => {
    const pattern = forecast(withTypedCounts([3, 0, 8, 1, 0, 9, 0, 9, 1, 0, 8, 2, 0, 10])).pacePattern

    expect(pattern).toEqual({
      pattern: 'lumpy',
      line: 'Lumpy · 0 to 10 a week',
      meaning: 'Work finishes in batches, 0 to 10 a week, so the range is wide because the pace really varies.',
      advice:
        "Keep every week, zeros included, and accept the wide range. To narrow it, split work smaller, finish before starting, and close tickets as soon as they're done.",
    })
  })

  test('one week far above the rest is One odd week, named, offering to leave it out', () => {
    // 14 weeks from 3 Aug: the week of 12 Oct finished 23.
    const pattern = forecast(withTypedCounts([5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4])).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'oneOddPeriod',
      line: 'One odd week · 12 Oct finished 23',
      meaning: 'The week of 12 Oct finished 23, against 4 to 6 in the other weeks.',
      advice: "If that week wasn't like the others, leave it out of the pace.",
      action: { kind: 'leaveOut', period: '2026-10-12', button: 'Leave out 12 Oct' },
    })
  })
})

/** The 85% date of the milestone forecast from these typed counts, in a fresh file. */
function dateAt85(counts: readonly number[]): string | null | undefined {
  return forecast(withTypedCounts(counts)).dates.find(({ percent }) => percent === 85)?.date
}

describe("an action's 85% date, with and without it", () => {
  test('counting pace from the step gives the date the counts since the step give', () => {
    const applied = dateAt85([8, 9, 7, 8])
    const now = dateAt85([4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8])
    const action = forecast(withTypedCounts([4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8])).pacePattern?.action

    expect(action?.dates).toEqual({ percent: 85, now, applied })
    expect(applied! < now!).toBe(true)
  })

  test('leaving out the odd week gives the date the other weeks give', () => {
    const applied = dateAt85([5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 5, 6, 4])
    const counts = [5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4]
    const now = dateAt85(counts)
    const action = forecast(withTypedCounts(counts)).pacePattern?.action

    expect(action?.dates).toEqual({ percent: 85, now, applied })
    expect(applied! > now!).toBe(true)
  })
})

describe('from 6 to 9 periods', () => {
  // Eight weeks from 14 Sep.
  test('a changing pattern is worded as early', () => {
    expect(forecast(withTypedCounts([2, 2, 3, 3, 4, 5, 6, 7])).pacePattern).toMatchObject({
      pattern: 'speedingUp',
      line: 'May be speeding up: too early to be sure.',
    })
  })

  test('an early step still offers its action', () => {
    expect(forecast(withTypedCounts([4, 3, 4, 5, 8, 9, 7, 8])).pacePattern).toMatchObject({
      pattern: 'steppedUp',
      line: 'May have stepped up: too early to be sure.',
      meaning: 'About 4 a week, then 8 since 12 Oct.',
      action: { kind: 'startFrom', date: '2026-10-12' },
    })
  })

  test('Steady and One odd week are not worded as early', () => {
    expect(forecast(withTypedCounts([5, 4, 6, 5, 5, 4, 6, 5])).pacePattern?.line).toBe('Steady · 4 to 6 a week')
    expect(forecast(withTypedCounts([5, 6, 5, 4, 23, 5, 6, 4])).pacePattern?.line).toBe('One odd week · 12 Oct finished 23')
  })
})

describe('when no pattern is named', () => {
  test('fewer than 6 periods say only that it is too early', () => {
    expect(forecast(withTypedCounts([5, 4, 6, 5, 5])).pacePattern).toEqual({
      pattern: undefined,
      line: 'No pattern yet · 5 weeks is too few to tell',
    })
  })

  test('a window with nothing finished is never Steady', () => {
    expect(forecast(withTypedCounts([0, 0, 0, 0, 0, 0, 0, 0])).pacePattern).toEqual({
      pattern: undefined,
      line: 'Nothing finished in these 8 weeks: no pattern to read.',
    })
  })

  test('quiet periods before the first finished ticket are not read', () => {
    expect(forecast(withTypedCounts([0, 0, 0, 5, 4, 6, 5, 5])).pacePattern).toEqual({
      pattern: undefined,
      line: 'No pattern yet · 5 weeks is too few to tell',
    })
  })

  test('a cadence under 7 days is too short to read', () => {
    expect(forecast(withTypedCounts([1, 0, 1, 1, 0, 1, 1, 0, 1, 1], 1)).pacePattern).toEqual({
      pattern: undefined,
      line: 'Patterns are read from weeks or sprints.',
    })
  })

  test('a pace range has no counts to read', () => {
    const storage = withTypedCounts([5, 4, 6, 5, 5, 4, 6, 5, 5, 4])
    submit(storage, { kind: 'setPaceRange', low: '4', high: '6' })
    submit(storage, { kind: 'setPaceMode', paceMode: 'range' })

    expect(forecast(storage).pacePattern).toBeUndefined()
  })
})

const STEPPED_UP = [4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8]
const ODD_WEEK = [5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4]

describe('an applied action', () => {
  test('counting pace from the step forecasts from the counts since, saying so', () => {
    const storage = withTypedCounts(STEPPED_UP)
    const offered = forecast(storage).pacePattern?.action

    expect(submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })).toEqual({ saved: true, next: 'forecast' })

    const view = forecast(storage)
    expect(view.pace).toEqual({ source: 'counts', counts: [8, 9, 7, 8] })
    expect(view.paceTrend?.counts).toEqual([8, 9, 7, 8])
    expect(view.dates.find(({ percent }) => percent === 85)?.date).toBe(offered?.dates.applied)
    expect(view.pacePattern).toEqual({
      pattern: undefined,
      line: 'No pattern yet · 4 weeks is too few to tell',
      applied: 'Counting pace from 12 Oct, after it stepped up.',
    })
  })

  test('undo brings every count back, and the pattern and its action with them', () => {
    const storage = withTypedCounts(STEPPED_UP)
    submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })

    expect(submit(storage, { kind: 'undoPaceAction' })).toEqual({ saved: true, next: 'forecast' })

    const view = forecast(storage)
    expect(view.pace).toEqual({ source: 'counts', counts: STEPPED_UP })
    expect(view.pacePattern).toMatchObject({ pattern: 'steppedUp', action: { kind: 'startFrom', date: '2026-10-12' } })
    expect(view.pacePattern?.applied).toBeUndefined()
  })

  test('leaving out the odd week reads the other weeks again, naming the week left out, with no action offered', () => {
    const storage = withTypedCounts(ODD_WEEK)

    submit(storage, { kind: 'applyPaceAction', action: 'leaveOut', period: '2026-10-12' })

    const view = forecast(storage)
    expect(view.pace).toEqual({ source: 'counts', counts: [5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 5, 6, 4] })
    expect(view.pacePattern).toEqual({
      pattern: 'steady',
      line: 'Steady · 4 to 6 a week',
      meaning: 'No sign the pace is changing. The forecast takes these weeks as they are.',
      applied: 'Leaving out the week of 12 Oct, the odd week.',
    })
  })

  test('an applied action belongs to the milestone, so it outlasts reopening the file', () => {
    submit(withTypedCounts(STEPPED_UP), { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })

    expect(forecast(openStorage()).pacePattern?.applied).toBe('Counting pace from 12 Oct, after it stepped up.')
  })

  test('an action that is not one is refused, saying why, and nothing changes', () => {
    const storage = withTypedCounts(STEPPED_UP)

    const submitted = submit(storage, { kind: 'applyPaceAction', action: 'skipAll', date: '2026-10-12' })

    expect(submitted).toMatchObject({ saved: false, screen: 'forecast', view: { paceActionRefusal: 'That action is no longer offered.' } })
    expect(forecast(storage).pace).toEqual({ source: 'counts', counts: STEPPED_UP })
  })

  test('refused with no pattern to show it on, the forecast still says why', () => {
    const storage = withTypedCounts(STEPPED_UP)
    submit(storage, { kind: 'setPaceRange', low: '4', high: '6' })
    submit(storage, { kind: 'setPaceMode', paceMode: 'range' })

    const submitted = submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: 'soon' })

    expect(submitted).toMatchObject({ saved: false, screen: 'forecast', view: { pacePattern: undefined, paceActionRefusal: 'That action is no longer offered.' } })
  })

  test('is still offered when it would leave fewer counts than the forecast needs', () => {
    // Eight weeks from 14 Sep: about 4 a week, then 9 from 19 Oct, three weeks ago.
    const pattern = forecast(withTypedCounts([4, 3, 4, 5, 4, 9, 8, 9])).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'steppedUp',
      meaning: 'About 4 a week, then 9 since 19 Oct.',
      advice: "If that's lasting, count pace from 19 Oct.",
      action: { kind: 'startFrom', date: '2026-10-19', button: 'Start from 19 Oct' },
    })
  })

  test('applied, leaving fewer counts than the forecast needs, gets the too-few-counts problem, with the action said and undo', () => {
    const storage = withTypedCounts([4, 3, 4, 5, 4, 9, 8, 9])

    expect(submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-19' })).toEqual({ saved: true, next: 'forecast' })

    expect(milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY)).toEqual({
      kind: 'problems',
      name: 'Launch',
      problems: [
        {
          input: 'typedCounts',
          message: 'Counting pace from 19 Oct leaves 3 weeks. The forecast needs at least 4. Add another count, or switch pace to the range.',
        },
      ],
      paceApplied: 'Counting pace from 19 Oct, after it stepped up.',
    })
    submit(storage, { kind: 'undoPaceAction' })
    expect(forecast(storage).pace).toEqual({ source: 'counts', counts: [4, 3, 4, 5, 4, 9, 8, 9] })
  })

  test('leaving fewer counts than are reliable warns of the window, not of the counts typed', () => {
    const storage = withTypedCounts(STEPPED_UP)

    submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })

    expect(forecast(storage).warnings).toContainEqual({
      input: 'typedCounts',
      message: 'Counting pace from 12 Oct leaves 4 weeks. The forecast needs 8 to be reliable.',
    })
  })
})

describe('from the tracker’s weeks (#213)', () => {
  const checkout: Choice = { kind: 'milestone', name: 'Launch', query: 'milestone:"Launch"' }
  const READ_AT = '2026-11-11T09:00:00Z'
  // GitHub's weeks, Mondays from 31 Aug to 2 Nov; the week of 9 Nov is the current one
  const GITHUB_WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']
  const tuesday = (monday: string): string => new Date(Date.parse(`${monday}T10:00:00Z`) + 86_400_000).toISOString()

  /** A milestone started long before, following GitHub, which finished `counts[i]` tickets in the week of `GITHUB_WEEKS[i]`. */
  async function followingGitHub(counts: readonly number[]): Promise<{ storage: Storage; using: Skipping; tracker: TrackerReads }> {
    const opened = openSqliteStorage(join(dir, 'forecaster.db'))
    storage = opened
    opened.saveTeam({ id: TEAM, name: 'Acme', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
    opened.saveSetupState(TEAM, { open: false, closed: 'done' })
    const tickets = counts.flatMap((count, week) => Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: tuesday(GITHUB_WEEKS[week]!) })))
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

    await submitSkip(using, TEAM, { kind: 'skip', periods: ['2026-10-12', '2026-10-19'] }, { settings: DEFAULT_SETTINGS, today: TODAY, readAt: READ_AT, timeZone: 'UTC' })

    expect(trackerForecast(storage, tracker).pacePattern).toMatchObject({ pattern: 'steady', line: 'Steady · 4 to 6 a week' })
  })

  test('a short repo, with 5 weeks of finished tickets, is too early to read', async () => {
    const { storage, tracker } = await followingGitHub([0, 0, 0, 0, 0, 5, 4, 6, 5, 5])

    expect(trackerForecast(storage, tracker).pacePattern).toEqual({ pattern: undefined, line: 'No pattern yet · 5 weeks is too few to tell' })
  })
})

