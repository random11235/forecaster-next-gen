import { ENGINE_VERSION, simulateCase, type ForecastResult } from '../engine/index.js'
import type { ForecastLog, Ledger, LoggedForecast } from '../ledger/ledger.js'
import { APP_VERSION } from './appVersion.js'

/** A logged forecast re-run from its case alone, or why it isn't: this engine may not give what another gave. */
export type Rerun = { kind: 'rerun'; result: ForecastResult } | { kind: 'otherEngine'; loggedWith: string; running: string }

/** Seam B: re-runs the logged forecast's case, as this engine runs it, if this engine's version logged it. */
export function rerunForecast(log: ForecastLog): Rerun {
  const loggedWith = log.simulationCase.engineVersion
  if (loggedWith !== ENGINE_VERSION) return { kind: 'otherEngine', loggedWith, running: ENGINE_VERSION }
  return { kind: 'rerun', result: simulateCase(log.simulationCase) }
}

/**
 * Logs the forecast the team is shown in its ledger, made by this release, unless it is the one last logged: the same
 * case run by the same release gives the same result, so showing it again adds nothing to explain or check.
 */
export function logForecast(ledger: Ledger, forecast: Omit<LoggedForecast, 'appVersion'>): void {
  const last = ledger.lastForecastLog(forecast.teamId)
  if (last?.caseHash === forecast.result.caseHash && last.appVersion === APP_VERSION && last.milestoneName === forecast.milestoneName) return
  ledger.saveForecastLog({ ...forecast, appVersion: APP_VERSION })
}
