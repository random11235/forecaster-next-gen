import { isIsoDate, wholePeriodsUntil } from './dates.js'
import type { GrowthRange, NumberRange, SimulationCase } from './types.js'

const MAX_TRIALS = 1_000_000
const MAX_PERIODS = 10_000
const MAX_SAMPLES = 100_000
/** Each epic keeps a finish period per trial, so epics × trials sizes memory; real milestones hold a few dozen. */
const MAX_EPICS = 100
/** Tickets in a whole-number range (per period, or per epic); far above any real team or epic, and far below the 2^32 steps the PRNG can draw uniformly. */
const MAX_RANGE_HIGH = 100_000

/** Rejects cases outside the engine's limits, so a bad input fails loudly instead of forecasting. */
export function assertValidCase(simulationCase: SimulationCase): void {
  const { trials, maxPeriods, question, scope, throughputSamples, epicSizeSamples } = simulationCase
  assertWholeNumberIn('trials', trials, 1, MAX_TRIALS)
  assertWholeNumberIn('maxPeriods', maxPeriods, 1, MAX_PERIODS)
  if (Array.isArray(throughputSamples)) {
    assertSamples('throughputSamples', throughputSamples)
    assertWholeNumbers('throughputSamples', throughputSamples)
  } else {
    assertRange('throughputSamples', throughputSamples)
  }
  if (Array.isArray(epicSizeSamples)) {
    assertSamples('epicSizeSamples', epicSizeSamples)
    assertWholeNumbers('epicSizeSamples', epicSizeSamples)
  } else {
    assertRange('epicSizeSamples', epicSizeSamples)
  }
  if (question.kind === 'howMany') {
    assertByDate(simulationCase, question.byDate)
  } else if (question.kind !== 'when') {
    throw new RangeError(`question must be 'when' or 'howMany', got ${(question as { kind: unknown }).kind}`)
  }
  if (scope.length === 0 || scope.length > MAX_EPICS) {
    throw new RangeError(`scope must hold 1 to ${MAX_EPICS} epics, got ${scope.length}`)
  }
  const epicIds = new Set<string>()
  for (const epic of scope) {
    if (epicIds.has(epic.epicId)) throw new RangeError(`scope must not repeat an epicId, got ${epic.epicId} twice`)
    epicIds.add(epic.epicId)
    if (!Number.isFinite(epic.rank)) throw new RangeError(`rank must be a finite number, got ${epic.rank}`)
    if (epic.baseCount !== null) assertNonNegative('baseCount', epic.baseCount)
    assertNonNegative('currentCount', epic.currentCount)
    assertNonNegative('doneCount', epic.doneCount)
    if (Array.isArray(epic.growth)) {
      assertSamples('growth', epic.growth)
    } else {
      assertGrowthRange(epic.growth)
    }
  }
}

function assertWholeNumberIn(field: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${field} must be a whole number from ${min} to ${max}, got ${value}`)
  }
}

/** A manual pace or epic-size range counts whole tickets, from `low` up to `high`. */
function assertRange(field: string, { low, high }: NumberRange): void {
  assertWholeNumbers(field, [low, high])
  assertNonNegative(field, low)
  if (high > MAX_RANGE_HIGH) throw new RangeError(`${field} range must not exceed ${MAX_RANGE_HIGH}, got ${high}`)
  if (high < low) throw new RangeError(`${field} range must have low ≤ high, got ${low} to ${high}`)
}

function assertGrowthRange({ low, high }: GrowthRange): void {
  assertNonNegative('growth', low)
  assertNonNegative('growth', high)
  if (high < low) throw new RangeError(`growth range must have low ≤ high, got ${low} to ${high}`)
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
