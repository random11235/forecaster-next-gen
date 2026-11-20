import type { ForecastLog, ForecastLogStamp, Ledger } from '../../ledger/ledger.js'
import { isForecastResult, isSimulationCase } from './forecastLogJson.js'
import { checkStored, isListOf, isNumber, isObject, isRecordOf, isString, type ShapeCheck } from './storedJson.js'
import { held, readKey, storedAt, writeKey, type Kept, type KeyValueStore } from './webStore.js'

/*
 * The forecast ledger in the browser's storage, behind webStorage.ts: each team's logged forecasts, numbered in the
 * order logged, kept under a key of their own apart from the EM's other data.
 */

/**
 * Where the forecast ledger (#27) is kept, as one JSON value apart from the rest: it only grows, so it is kept where
 * filling it can't cost the EM their other data, and a value there this version can't read refuses only the ledger.
 */
const LEDGER_KEY = 'forecaster.ledger'

/**
 * The most of browser storage the ledger takes, in characters: a fifth of the 5 MB or so a browser gives a site, so
 * the EM's other data always has room. A log of the MVP's forecast takes a few thousand, so it keeps a few hundred.
 * Past it, the oldest logs are dropped to keep the newest.
 */
const LEDGER_LIMIT = 1_000_000

/** A log's stamp as the ledger's value keeps it: its team is its key. */
type StoredStamp = Omit<ForecastLogStamp, 'teamId'>

/** The check of each of a log's stamp fields, as stored. */
const STAMP_CHECKS: { [Field in keyof StoredStamp]-?: ShapeCheck<StoredStamp[Field]> } = {
  id: isNumber,
  createdAt: isString,
  milestoneName: isString,
  appVersion: isString,
}

/**
 * A logged forecast as the ledger's value keeps it: its stamp, and its case and result checked only as the team's
 * logs are read, but for the result's case hash, so one this version can't read (a later engine's) still gives its
 * header.
 */
interface StoredLog extends StoredStamp {
  simulationCase: unknown
  result: { caseHash: string }
}

/** A team's forecast ledger: the last ID given, so a log dropped past the limit never has its ID given again, and its logs, oldest first. */
interface StoredTeamLedger {
  lastId: number
  logs: StoredLog[]
}

/** Each team's forecast ledger, by its ID; data from before the ledger has logged none. */
type StoredLedger = Record<string, StoredTeamLedger>

/**
 * The forecast ledger in `store`, read from it again at each call, so the page's tabs each log after what the others
 * logged. When the browser gives no storage or refuses it, the ledger is kept in memory only, until the page closes.
 * Past `LEDGER_LIMIT`, the oldest logs are dropped, the IDs going on past them. A value this version can't read, even
 * one log in it, is kept as it is: a forecast isn't logged, there is no last log, and reading the team's logs throws,
 * naming the key. Each save drops a field it doesn't know, but those in a log's case and result, kept whole.
 */
export function webLedger(store: KeyValueStore | undefined): Ledger {
  /** The ledger as last saved from this page, read only when the browser gives no storage or refuses it. */
  let inMemory: StoredLedger = {}
  const read = (): Kept<StoredLedger> => readKey(store, LEDGER_KEY, isRecordOf(isStoredTeamLedger), { empty: {}, unreadable: inMemory })

  return {
    saveForecastLog({ teamId, milestoneName, appVersion, simulationCase, result }) {
      const kept = read()
      if ('refused' in kept) return
      const ledger = knownFieldsOf(kept.value)
      const { lastId, logs } = ledger[teamId] ?? { lastId: 0, logs: [] }
      const id = lastId + 1
      const log = { id, createdAt: new Date().toISOString(), milestoneName, appVersion, simulationCase, result }
      inMemory = newestWithinLimit({ ...ledger, [teamId]: { lastId: id, logs: [...logs, structuredClone(log)] } })
      writeKey(store, LEDGER_KEY, JSON.stringify(inMemory))
    },

    forecastLogs(teamId) {
      return (held(read())[teamId]?.logs ?? []).map((log) => logOut(teamId, log))
    },

    lastForecastLog(teamId) {
      const kept = read()
      const last = 'refused' in kept ? undefined : kept.value[teamId]?.logs.at(-1)
      return last && { ...stampOf(last), teamId, caseHash: last.result.caseHash }
    },
  }
}

/** The log's stamp fields. */
function stampOf({ id, createdAt, milestoneName, appVersion }: StoredStamp): StoredStamp {
  return { id, createdAt, milestoneName, appVersion }
}

/** `ledger`, each team's ledger and each log with only the fields it knows; a log's case and result are kept whole. */
function knownFieldsOf(ledger: StoredLedger): StoredLedger {
  return Object.fromEntries(
    Object.entries(ledger).map(([teamId, { lastId, logs }]) => [
      teamId,
      { lastId, logs: logs.map((log) => ({ ...stampOf(log), simulationCase: log.simulationCase, result: log.result })) },
    ]),
  )
}

/** `ledger`, its oldest logs, of whichever team, dropped until its JSON fits `LEDGER_LIMIT`. */
function newestWithinLimit(ledger: StoredLedger): StoredLedger {
  const kept = Object.fromEntries(Object.entries(ledger).map(([teamId, { lastId, logs }]) => [teamId, { lastId, logs: [...logs] }]))
  for (;;) {
    const oldest = Object.values(kept)
      .filter(({ logs }) => logs.length > 0)
      .reduce<StoredTeamLedger | undefined>((first, each) => (first && first.logs[0]!.createdAt <= each.logs[0]!.createdAt ? first : each), undefined)
    if (!oldest || JSON.stringify(kept).length <= LEDGER_LIMIT) return kept
    oldest.logs.shift()
  }
}

/** The logged forecast `log` keeps for the team, its case and result checked as read. */
function logOut(teamId: string, log: StoredLog): ForecastLog {
  const where = storedAt(LEDGER_KEY)
  return structuredClone({
    ...stampOf(log),
    teamId,
    simulationCase: checkStored(log.simulationCase, where, isSimulationCase),
    result: checkStored(log.result, where, isForecastResult),
  })
}

/** A logged forecast as the ledger's value keeps it (`StoredLog`): its stamp and its result's case hash checked, its case and result as read. */
const isStoredLog = (value: unknown): value is StoredLog =>
  isObject(value) &&
  Object.entries(STAMP_CHECKS).every(([field, check]) => check(value[field])) &&
  'simulationCase' in value &&
  isObject(value.result) &&
  isString(value.result.caseHash)

const isStoredTeamLedger = (value: unknown): value is StoredTeamLedger => isObject(value) && isNumber(value.lastId) && isListOf(isStoredLog)(value.logs)
