import { isIsoDate, wholePeriodsUntil } from './dates.js'
import type { SimulationCase, ThroughputRange } from './types.js'

const MAX_TRIALS = 1_000_000
const MAX_PERIODS = 10_000
const MAX_SAMPLES = 100_000
/** Tickets per period; far above any real team, and far below the 2^32 steps the PRNG can draw uniformly. */
const MAX_THROUGHPUT = 100_000

/** Rejects cases outside the engine's limits, so a bad input fails loudly instead of forecasting. */
export function assertValidCase(simulationCase: SimulationCase): void {
  const { trials, maxPeriods, question, scope, throughputSamples } = simulationCase
  assertWholeNumberIn('trials', trials, 1, MAX_TRIALS)
  assertWholeNumberIn('maxPeriods', maxPeriods, 1, MAX_PERIODS)
  if (Array.isArray(throughputSamples)) {
    assertSamples('throughputSamples', throughputSamples)
    assertWholeNumbers('throughputSamples', throughputSamples)
  } else {
    assertRange('throughputSamples', throughputSamples)
  }
  if (question.kind === 'howMany') {
    assertByDate(simulationCase, question.byDate)
  } else if (question.kind !== 'when') {
    throw new RangeError(`question must be 'when' or 'howMany', got ${(question as { kind: unknown }).kind}`)
  }
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

/** A manual range counts whole tickets per period, from `low` up to `high`. */
function assertRange(field: string, { low, high }: ThroughputRange): void {
  assertWholeNumbers(field, [low, high])
  assertNonNegative(field, low)
  if (high > MAX_THROUGHPUT) throw new RangeError(`${field} range must not exceed ${MAX_THROUGHPUT}, got ${high}`)
  if (high < low) throw new RangeError(`${field} range must have low ≤ high, got ${low} to ${high}`)
}

/** `byDate` must fall within the horizon, so a 'howMany' trial runs from 0 to `maxPeriods` periods. */
function assertByDate({ startDate, periodDays, maxPeriods }: SimulationCase, byDate: string): void {
  if (!isIsoDate(byDate)) throw new RangeError(`byDate must be an ISO date (YYYY-MM-DD), got ${byDate}`)
  const periods = wholePeriodsUntil(startDate, periodDays, byDate)
  if (periods < 0 || periods > maxPeriods) {
    throw new RangeError(`byDate must be from ${startDate} to ${maxPeriods} periods after it, got ${byDate}`)
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
