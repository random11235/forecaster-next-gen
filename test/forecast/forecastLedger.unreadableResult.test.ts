import { describe, expect, test } from 'vitest'
import { writeStraight } from '../storage/sqliteStraight.js'
import { TEAM, newTeam, mediumGrowth, enter, openStorage, storageFile, view } from './forecastViewScenario.js'

// Seam B: the forecast ledger (#27) in the SQLite file, its last log's result one this version can't read, as a damaged
// file would leave it, written straight into the file: storage never writes one.

describe('a forecast logged in SQLite storage whose result this version cannot read', () => {
  test.each([
    ["text that isn't JSON", 'not json'],
    ['JSON with no case hash', '[]'],
    ['a case hash that is a list', '{"caseHash":["0123456789abcdef"]}'],
  ])('holding %s, does not stop the forecast being shown, which is logged again after it, once', (_, result) => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })
    view(storage)
    writeStraight(storageFile(), 'UPDATE forecast_logs SET result = ? WHERE team_id = ? AND id = 1', result, TEAM)
    expect(openStorage().lastForecastLog(TEAM)).toBeUndefined()

    expect(view(openStorage())).toMatchObject({ kind: 'forecast' })
    expect(view(openStorage())).toMatchObject({ kind: 'forecast' })

    expect(openStorage().lastForecastLog(TEAM)?.id).toBe(2)
    expect(() => openStorage().forecastLogs(TEAM)).toThrow('forecast_logs.result')
  })
})
