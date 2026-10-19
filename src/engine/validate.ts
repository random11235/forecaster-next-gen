import type { SimulationCase } from './types.js'

const MAX_TRIALS = 1_000_000
const MAX_PERIODS = 10_000
const MAX_SAMPLES = 100_000

/** Rejects cases outside the engine's limits, so a bad input fails loudly instead of forecasting. */
export function assertValidCase({ trials, maxPeriods, question, scope, throughputSamples }: SimulationCase): void {
  assertWholeNumberIn('trials', trials, 1, MAX_TRIALS)
  assertWholeNumberIn('maxPeriods', maxPeriods, 1, MAX_PERIODS)
  assertSamples('throughputSamples', throughputSamples)
  assertWholeNumbers('throughputSamples', throughputSamples)
  if (question.kind !== 'when') throw new RangeError(`question must be 'when', got ${question.kind}`)
  if (scope.length !== 1) throw new RangeError(`scope must hold exactly one epic, got ${scope.length}`)
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

/** Throughput counts done tickets, so a fractional sample is bad input, and whole numbers keep remaining work free of float error. */
function assertWholeNumbers(field: string, samples: readonly number[]): void {
  for (const sample of samples) {
    if (!Number.isInteger(sample)) throw new RangeError(`${field} must hold whole numbers, got ${sample}`)
  }
}

function assertSamples(field: string, samples: readonly number[]): void {
  if (samples.length === 0 || samples.length > MAX_SAMPLES) {
    throw new RangeError(`${field} must hold 1 to ${MAX_SAMPLES} samples, got ${samples.length}`)
  }
  for (const sample of samples) assertNonNegative(field, sample)
}
