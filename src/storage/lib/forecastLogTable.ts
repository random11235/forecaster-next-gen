import type { DatabaseSync } from 'node:sqlite'
import type { ForecastLog, Ledger } from '../../ledger/ledger.js'
import { isForecastResult, isSimulationCase } from './forecastLogJson.js'
import type { Row } from './sqliteDatabase.js'
import { checkStored, isString, parseStored } from './storedJson.js'

/*
 * The forecast ledger in the SQLite file, behind sqliteStorage.ts: each team's logged forecasts, numbered in the order
 * logged, the case and result each as JSON. A row is only ever added, never changed.
 */

/** A log's header columns, but its case's hash, which its result keeps: the one list of them, read by `headerIn`. */
const HEADER_COLUMNS = 'team_id, id, created_at, milestone_name, app_version'

/** The team's forecast ledger, kept in the SQLite file `db`. */
export function forecastLogTable(db: DatabaseSync): Ledger {
  const insert = db.prepare(`
    INSERT INTO forecast_logs (${HEADER_COLUMNS}, simulation_case, result)
    VALUES (?, (SELECT COALESCE(MAX(id), 0) + 1 FROM forecast_logs WHERE team_id = ?), ?, ?, ?, ?, ?)`)
  const selectAll = db.prepare(`SELECT ${HEADER_COLUMNS}, simulation_case, result FROM forecast_logs WHERE team_id = ? ORDER BY id`)
  // the case's hash read out of the result's JSON, not parsing the case or result
  const selectLast = db.prepare(
    `SELECT ${HEADER_COLUMNS}, json_extract(result, '$.caseHash') AS case_hash FROM forecast_logs WHERE team_id = ? ORDER BY id DESC LIMIT 1`,
  )

  return {
    saveForecastLog({ teamId, milestoneName, appVersion, simulationCase, result }) {
      const createdAt = new Date().toISOString()
      insert.run(teamId, teamId, createdAt, milestoneName, appVersion, JSON.stringify(simulationCase), JSON.stringify(result))
    },

    forecastLogs(teamId) {
      return selectAll.all(teamId).map(logIn)
    },

    lastForecastLog(teamId) {
      const row = selectLast.get(teamId)
      return row && { ...headerIn(row), caseHash: checkStored(row.case_hash, 'forecast_logs.result', isString) }
    },
  }
}

/** The log's place and what made it, as a row's `HEADER_COLUMNS` keep them. */
function headerIn(row: Row): Omit<ForecastLog, 'simulationCase' | 'result'> {
  return {
    id: Number(row.id),
    teamId: String(row.team_id),
    createdAt: String(row.created_at),
    milestoneName: String(row.milestone_name),
    appVersion: String(row.app_version),
  }
}

/** The logged forecast a row keeps, its case and result checked as read. */
function logIn(row: Row): ForecastLog {
  return {
    ...headerIn(row),
    simulationCase: parseStored(String(row.simulation_case), 'forecast_logs.simulation_case', isSimulationCase),
    result: parseStored(String(row.result), 'forecast_logs.result', isForecastResult),
  }
}
