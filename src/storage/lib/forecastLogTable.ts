import type { DatabaseSync } from 'node:sqlite'
import type { ForecastLog, Ledger } from '../../ledger/ledger.js'
import { isForecastResult, isSimulationCase } from './forecastLogJson.js'
import type { Row } from './sqliteDatabase.js'
import { parseStored } from './storedJson.js'

/*
 * The forecast ledger in the SQLite file, behind sqliteStorage.ts: each team's logged forecasts, numbered in the order
 * logged, the case and result each as JSON. A row is only ever added, never changed.
 */

/** The team's forecast ledger, kept in the SQLite file `db`. */
export function forecastLogTable(db: DatabaseSync): Ledger {
  const insert = db.prepare(`
    INSERT INTO forecast_logs (team_id, id, created_at, milestone_name, case_hash, app_version, simulation_case, result)
    VALUES (?, (SELECT COALESCE(MAX(id), 0) + 1 FROM forecast_logs WHERE team_id = ?), ?, ?, ?, ?, ?, ?)`)
  const selectAll = db.prepare('SELECT * FROM forecast_logs WHERE team_id = ? ORDER BY id')
  const selectLast = db.prepare('SELECT * FROM forecast_logs WHERE team_id = ? ORDER BY id DESC LIMIT 1')

  return {
    saveForecastLog({ teamId, milestoneName, caseHash, appVersion, simulationCase, result }) {
      const createdAt = new Date().toISOString()
      insert.run(teamId, teamId, createdAt, milestoneName, caseHash, appVersion, JSON.stringify(simulationCase), JSON.stringify(result))
    },

    forecastLogs(teamId) {
      return selectAll.all(teamId).map(logIn)
    },

    lastForecastLog(teamId) {
      const row = selectLast.get(teamId)
      return row && logIn(row)
    },
  }
}

/** The logged forecast a row keeps, its case and result checked as read. */
function logIn(row: Row): ForecastLog {
  return {
    id: Number(row.id),
    teamId: String(row.team_id),
    createdAt: String(row.created_at),
    milestoneName: String(row.milestone_name),
    caseHash: String(row.case_hash),
    appVersion: String(row.app_version),
    simulationCase: parseStored(String(row.simulation_case), 'forecast_logs.simulation_case', isSimulationCase),
    result: parseStored(String(row.result), 'forecast_logs.result', isForecastResult),
  }
}
