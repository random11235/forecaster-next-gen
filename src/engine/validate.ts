import type { SimulationCase } from './types.js'

const MAX_TRIALS = 1_000_000
const MAX_PERIODS = 10_000
const MAX_SAMPLES = 100_000

/** Rejects cases outside the engine's limits, so a bad input fails loudly instead of forecasting. */
export function assertValidCase({ trials, maxPeriods, scope, throughputSamples }: SimulationCase): void {
  assertWholeNumberIn('trials', trials, 1, MAX_TRIALS)
  assertWholeNumberIn('maxPeriods', maxPeriods, 1, MAX_PERIODS)
  assertSamples('throughputSamples', throughputSamples)
  if (scope.length === 0) throw new RangeError('scope must hold at least one epic')
  for (const epic of scope) {
    assertNonNegative('baseCount', epic.baseCount)
    assertNonNegative('doneCount', epic.doneCount)
    assertSamples('growth', epic.growth)
  }
}

function assertWholeNumberIn(field: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${field} must be a whole number from ${min} to ${max}, got ${value}`)
  }
}

function assertNonNegative(field: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite number of at least 0, got ${value}`)
  }
}

function assertSamples(field: string, samples: readonly number[]): void {
  if (samples.length === 0 || samples.length > MAX_SAMPLES) {
    throw new RangeError(`${field} must hold 1 to ${MAX_SAMPLES} samples, got ${samples.length}`)
  }
  for (const sample of samples) assertNonNegative(field, sample)
}
