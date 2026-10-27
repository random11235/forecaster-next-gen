import { afterEach, describe, expect, test } from 'vitest'
import { editInputs, inputsView, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { loadSampleDataIfEmpty } from '../../src/sample/loadSampleData.js'
import { SAMPLE_DATA } from '../../src/sample/sampleData.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { countingFactReads } from '../storage/countingFactReads.js'

const TEAM = SAMPLE_DATA.team.id
const TODAY = '2026-10-24'

let storage: Storage | undefined

afterEach(() => {
  storage?.close()
  storage = undefined
})

/** The sample team, its tickets and its milestone, with no pace entered yet. */
function sampleData(): Storage {
  storage = openSqliteStorage(':memory:')
  loadSampleDataIfEmpty(storage)
  return storage
}

/** The sample team and its tickets, with no milestone defined yet. */
function noMilestone(): Storage {
  storage = openSqliteStorage(':memory:')
  storage.saveTeam(SAMPLE_DATA.team)
  storage.addFacts(TEAM, SAMPLE_DATA.facts)
  return storage
}

function setPace(storage: Storage, low: string, high: string) {
  return editInputs(storage, TEAM, { kind: 'setPace', low, high }, DEFAULT_SETTINGS)
}

function forecastKind(storage: Storage): string {
  const view = milestoneForecastView(storage, TEAM, { today: TODAY, settings: DEFAULT_SETTINGS })
  if (view.kind !== 'milestone') throw new Error('expected a milestone')
  return view.forecast.kind
}

describe('the Inputs view', () => {
  test("reads the team's facts from storage once", () => {
    const counting = countingFactReads(sampleData())

    inputsView(counting.storage, TEAM, DEFAULT_SETTINGS)

    expect(counting.reads()).toBe(1)
  })

  test('has no pace before the EM enters one', () => {
    expect(inputsView(sampleData(), TEAM, DEFAULT_SETTINGS).pace).toBeUndefined()
  })
})

describe('setting pace', () => {
  test('saves the manual range: the Inputs view shows it and the milestone forecasts from it', () => {
    const storage = sampleData()

    expect(setPace(storage, ' 3 ', '6')).toEqual({ ok: true })

    expect(inputsView(storage, TEAM, DEFAULT_SETTINGS).pace).toEqual({ low: 3, high: 6 })
    expect(forecastKind(storage)).toBe('forecast')
  })

  test.each([
    { low: '6', high: '3', error: 'The low end must not be above the high end.' },
    { low: 'two', high: '6', error: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '1.5', high: '6', error: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '-1', high: '6', error: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '', high: '6', error: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '1', high: '1000000', error: 'Enter at most 1000 tickets per week.' },
  ])('refuses $low to $high, saying why and saving nothing', ({ low, high, error }) => {
    const storage = sampleData()

    expect(setPace(storage, low, high)).toEqual({ ok: false, error })

    expect(inputsView(storage, TEAM, DEFAULT_SETTINGS).pace).toBeUndefined()
    expect(forecastKind(storage)).toBe('needsPace')
  })

  test('is refused before the milestone is defined', () => {
    expect(setPace(noMilestone(), '3', '6')).toEqual({ ok: false, error: 'Define the milestone first.' })
  })
})

describe('an edit', () => {
  test.each<{ why: string; edit: InputsEdit; reads: number }>([
    { why: 'pace, which needs none', edit: { kind: 'setPace', low: '3', high: '6' }, reads: 0 },
    { why: 'an epic change', edit: { kind: 'moveEpic', epicId: 'PAY-2', direction: 'up' }, reads: 1 },
    {
      why: 'workflow settings',
      reads: 1,
      edit: {
        kind: 'editWorkflow',
        categories: { 'To Do': 'notStarted', 'In Progress': 'started', Done: 'done', Cancelled: 'cancelled' },
        startedStatus: 'In Progress',
        commitLabel: '',
        blockedRule: { statuses: [], labels: ['blocked'] },
      },
    },
  ])("that is saved reads the team's facts from storage $reads time(s): $why", ({ edit, reads }) => {
    const counting = countingFactReads(sampleData())

    expect(editInputs(counting.storage, TEAM, edit, DEFAULT_SETTINGS)).toEqual({ ok: true })

    expect(counting.reads()).toBe(reads)
  })
})
