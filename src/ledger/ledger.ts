import type { ForecastResult, SimulationCase } from '../engine/types.js'

// Layer 5: the forecast ledger (#27). Every forecast the team is shown is logged, so any number the EM has shared can be
// explained and reproduced from its case alone, and checked against what happened once the milestone finishes (#28).
// It depends only on the engine's types (docs/design/architecture-dependency-rules.md); storage keeps it.

/** A forecast as it is logged: everything that made it and what it gave, but where and when the ledger keeps it. */
export interface LoggedForecast {
  teamId: string
  /** The milestone's name when it was forecast: the MVP has one milestone per team, with no ID of its own. */
  milestoneName: string
  /** The whole case the engine ran, so re-running it alone reproduces `result`. */
  simulationCase: SimulationCase
  /** What the engine gave for the case, its hash (`caseHash`) among it. */
  result: ForecastResult
  /** The release that made it, package.json's version; the engine's is the case's `engineVersion`. */
  appVersion: string
}

/** A forecast in the team's ledger. */
export interface ForecastLog extends LoggedForecast {
  /** Its place in the team's ledger, from 1 for the first logged. */
  id: number
  /** The UTC instant it was logged at, ISO 8601, as the ledger stamped it. */
  createdAt: string
}

/**
 * The team's forecasts, logged one after another and never changed once logged (docs/design/architecture-security.md):
 * calibration means nothing if old forecasts can be edited.
 */
export interface Ledger {
  /** Logs the forecast after the team's others, stamped with the instant it is logged at. */
  saveForecastLog(forecast: LoggedForecast): void
  /** The team's logged forecasts, oldest first. */
  forecastLogs(teamId: string): ForecastLog[]
  /** The team's last logged forecast, if it has one. */
  lastForecastLog(teamId: string): ForecastLog | undefined
}
