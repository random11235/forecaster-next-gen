import type { ForecastResult, SimulationCase } from '../engine/index.js'
import type { Ledger } from '../ledger/ledger.js'
import { APP_VERSION } from './appVersion.js'

/** Logs the forecast the team is shown in its ledger, made by this release. */
export function logForecast(ledger: Ledger, teamId: string, milestoneName: string, simulationCase: SimulationCase, result: ForecastResult): void {
  ledger.saveForecastLog({ teamId, milestoneName, caseHash: result.caseHash, simulationCase, result, appVersion: APP_VERSION })
}
