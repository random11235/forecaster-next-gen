import type { DatabaseSync } from 'node:sqlite'
import type { ForecastLog, ForecastLogStamp, Ledger } from '../../ledger/ledger.js'
import { isForecastResult, isSimulationCase } from './forecastLogJson.js'
import type { Row } from './sqliteDatabase.js'
import { isString, parseStored } from './storedJson.js'

/*
 * The forecast ledger in the SQLite file, behind sqliteStorage.ts: each team's logged forecasts, numbered in the order
 * logged, the case and result each as JSON. A row is only ever added, never changed.
 */

/** Each of a log's stamp fields and the column it is kept in: the one list of them, read back by `stampIn`. */
const STAMP_COLUMNS: { [Field in keyof ForecastLogStamp]-?: string } = {
  teamId: 'team_id',
  id: 'id',
  createdAt: 'created_at',
  milestoneName: 'milestone_name',
  appVersion: 'app_version',
}

/** The stamp's columns, each read back under its field's name. */
const STAMP_SELECT = Object.entries(STAMP_COLUMNS)
  .map(([field, column]) => `${column} AS ${field}`)
  .join(', ')

/** The team's forecast ledger, kept in the SQLite file `db`. */
export function forecastLogTable(db: DatabaseSync): Ledger {
  // each stamp field bound by its name; the ID, the team's next
  const insert = db.prepare(`
    INSERT INTO forecast_logs (${Object.values(STAMP_COLUMNS).join(', ')}, simulation_case, result)
    VALUES (${Object.keys(STAMP_COLUMNS)
      .map((field) => (field === 'id' ? '(SELECT COALESCE(MAX(id), 0) + 1 FROM forecast_logs WHERE team_id = $teamId)' : `$${field}`))
      .join(', ')}, $simulationCase, $result)`)
  const selectAll = db.prepare(`SELECT ${STAMP_SELECT}, simulation_case, result FROM forecast_logs WHERE team_id = ? ORDER BY id`)
  // the case's hash read out of the result's JSON, the case and the rest of the result left unparsed; none when the
  // result isn't JSON or its hash isn't text
  const selectLast = db.prepare(`
    SELECT ${STAMP_SELECT},
      CASE
        WHEN NOT json_valid(result) THEN NULL
        WHEN json_type(result, '$.caseHash') = 'text' THEN json_extract(result, '$.caseHash')
      END AS caseHash
    FROM forecast_logs WHERE team_id = ? ORDER BY id DESC LIMIT 1`)

  return {
    saveForecastLog({ teamId, milestoneName, appVersion, simulationCase, result }) {
      const createdAt = new Date().toISOString()
      insert.run({ teamId, createdAt, milestoneName, appVersion, simulationCase: JSON.stringify(simulationCase), result: JSON.stringify(result) })
    },

    forecastLogs(teamId) {
      return selectAll.all(teamId).map(logIn)
    },

    lastForecastLog(teamId) {
      const row = selectLast.get(teamId)
      // a last log whose result gives no case hash has no header this version can read: the forecast is logged again
      return row && isString(row.caseHash) ? { ...stampIn(row), caseHash: row.caseHash } : undefined
    },
  }
}

/** The log's stamp, as a row reads back its `STAMP_COLUMNS` by field name. */
function stampIn(row: Row): ForecastLogStamp {
  return {
    teamId: String(row.teamId),
    id: Number(row.id),
    createdAt: String(row.createdAt),
    milestoneName: String(row.milestoneName),
    appVersion: String(row.appVersion),
  }
}

/** The logged forecast a row keeps, its case and result checked as read. */
function logIn(row: Row): ForecastLog {
  return {
    ...stampIn(row),
    simulationCase: parseStored(String(row.simulation_case), 'forecast_logs.simulation_case', isSimulationCase),
    result: parseStored(String(row.result), 'forecast_logs.result', isForecastResult),
  }
}
