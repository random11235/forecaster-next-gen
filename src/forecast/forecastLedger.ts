import type { ForecastResult, SimulationCase } from '../engine/index.js'
import type { Ledger } from '../ledger/ledger.js'
import { APP_VERSION } from './appVersion.js'

/**
 * Logs the forecast the team is shown in its ledger, made by this release, unless it is the one last logged: the same
 * case run by the same release gives the same result, so showing it again adds nothing to explain or check.
 */
export function logForecast(ledger: Ledger, teamId: string, milestoneName: string, simulationCase: SimulationCase, result: ForecastResult): void {
  const last = ledger.lastForecastLog(teamId)
  if (last?.caseHash === result.caseHash && last.appVersion === APP_VERSION && last.milestoneName === milestoneName) return
  ledger.saveForecastLog({ teamId, milestoneName, caseHash: result.caseHash, simulationCase, result, appVersion: APP_VERSION })
}
