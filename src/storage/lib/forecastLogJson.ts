import type { ForecastResult, NumberRange, ScopeEntry, SimulationCase } from '../../engine/types.js'
import { isListOf, isNumber, isObject, isRecordOf, isString, optional } from './storedJson.js'

/*
 * A logged forecast's case and result, kept as JSON, checked as both storages read them back: the SQLite file keeps
 * each in a column of its own (forecastLogTable.ts), and browser storage within the log (webLedger.ts). A case of a
 * shape this version doesn't know (a later engine's) is refused, never re-run as something it isn't. Each check is
 * of `SimulationCase` and `ForecastResult` as stored: changing either type changes a stored shape
 * (docs/design/engine.md#engine-contract).
 */

const isNumberOrNull = (value: unknown): value is number | null => value === null || isNumber(value)

const isRange = (value: unknown): value is NumberRange => isObject(value) && isNumber(value.low) && isNumber(value.high)

/** Samples or a range, as the case's growth, pace and epic sizes each are. */
const isSamplesOrRange = (value: unknown): value is number[] | NumberRange => isListOf(isNumber)(value) || isRange(value)

const isQuestion = (value: unknown): value is SimulationCase['question'] =>
  isObject(value) && (value.kind === 'when' || (value.kind === 'howMany' && isString(value.byDate)))

const isScopeEntry = (value: unknown): value is ScopeEntry =>
  isObject(value) &&
  isString(value.epicId) &&
  isNumber(value.rank) &&
  isNumberOrNull(value.baseCount) &&
  isNumber(value.currentCount) &&
  isNumber(value.doneCount) &&
  isSamplesOrRange(value.growth)

/** The case the engine ran, as stored: JSON drops an undefined `capacity`. */
export const isSimulationCase = (value: unknown): value is SimulationCase =>
  isObject(value) &&
  isString(value.engineVersion) &&
  isNumber(value.seed) &&
  isNumber(value.trials) &&
  isNumber(value.maxPeriods) &&
  isQuestion(value.question) &&
  isString(value.startDate) &&
  isNumber(value.periodDays) &&
  isListOf(isScopeEntry)(value.scope) &&
  isSamplesOrRange(value.throughputSamples) &&
  isSamplesOrRange(value.epicSizeSamples) &&
  optional(isListOf(isNumber))(value.capacity) &&
  isListOf(isNumber)(value.percentiles)

const isDiagnostics = (value: unknown): value is ForecastResult['diagnostics'] =>
  isObject(value) &&
  optional(isNumber)(value.paceVariation) &&
  isNumber(value.trialsHittingHorizon) &&
  isObject(value.span) &&
  isNumberOrNull(value.span.periods) &&
  isNumber(value.span.tickets)

const isEpicQuantiles = (value: unknown): value is ForecastResult['perEpic'][number] =>
  isObject(value) && isString(value.epicId) && isListOf(isNumberOrNull)(value.quantiles)

/** What the engine gave for the case, as stored: JSON drops an undefined `paceVariation`, and keys records by text. */
export const isForecastResult = (value: unknown): value is ForecastResult =>
  isObject(value) &&
  isString(value.caseHash) &&
  isListOf(isNumberOrNull)(value.quantiles) &&
  isListOf(isNumber)(value.finishCounts) &&
  isNumber(value.finishedFraction) &&
  isRecordOf((date): date is string | null => date === null || isString(date))(value.percentileDates) &&
  isRecordOf(isNumber)(value.percentileCounts) &&
  isListOf(isEpicQuantiles)(value.perEpic) &&
  isDiagnostics(value.diagnostics)
