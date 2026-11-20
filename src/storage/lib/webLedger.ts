import type { ForecastLog, ForecastLogHeader, Ledger } from '../../ledger/ledger.js'
import { isForecastResult, isSimulationCase } from './forecastLogJson.js'
import { checkStored, isListOf, isNumber, isObject, isRecordOf, isString, type ShapeCheck } from './storedJson.js'
import { held, readKey, writeKey, type KeyValueStore } from './webStore.js'

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

/** A log's place and what made it, as the ledger's value keeps them: its team is its key, its case's hash in its result. */
type StoredHeader = Omit<ForecastLogHeader, 'teamId' | 'caseHash'>

/** The check of each of a log's header fields, as stored: the one list of them, so a new field is one edit here. */
const HEADER: { [Field in keyof StoredHeader]-?: ShapeCheck<StoredHeader[Field]> } = {
  id: isNumber,
  createdAt: isString,
  milestoneName: isString,
  appVersion: isString,
}

/**
 * A logged forecast as the ledger's value keeps it: its header, and its case and result checked only as the team's
 * logs are read, but for the result's case hash, so one this version can't read (a later engine's) still gives its
 * header.
 */
interface StoredLog extends StoredHeader {
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
 * The forecast ledger in `store`. When the browser gives no storage or refuses it, a log is kept in memory only, until
 * the page closes. Past `LEDGER_LIMIT`, the oldest logs are dropped, the IDs going on past them. A value this version
 * can't read is kept as it is: a forecast isn't logged, there is no last log, and reading the team's logs throws, naming
 * the key; a log whose case or result it can't read refuses only reading the team's logs. Each save drops a field it
 * doesn't know.
 */
export function webLedger(store: KeyValueStore | undefined): Ledger {
  const kept = readKey<StoredLedger>(store, LEDGER_KEY, {}, isRecordOf(isStoredTeamLedger))

  return {
    saveForecastLog({ teamId, milestoneName, appVersion, simulationCase, result }) {
      if ('refused' in kept) return
      const ledger = kept.value
      const teamLogs = (ledger[teamId] ??= { lastId: 0, logs: [] })
      teamLogs.lastId += 1
      teamLogs.logs.push({
        id: teamLogs.lastId,
        createdAt: new Date().toISOString(),
        milestoneName,
        appVersion,
        simulationCase: structuredClone(simulationCase),
        result: structuredClone(result),
      })
      writeKey(store, LEDGER_KEY, withinLimit(ledger))
    },

    forecastLogs(teamId) {
      return (held(kept)[teamId]?.logs ?? []).map((log) => logOut(teamId, log))
    },

    lastForecastLog(teamId) {
      const last = 'refused' in kept ? undefined : kept.value[teamId]?.logs.at(-1)
      return last && { ...headerOf(last), teamId, caseHash: last.result.caseHash }
    },
  }
}

/** The log's header fields, those `HEADER` lists. */
function headerOf(log: StoredLog): StoredHeader {
  return Object.fromEntries(Object.keys(HEADER).map((field) => [field, log[field as keyof StoredHeader]])) as StoredHeader
}

/** The ledger as JSON: each log's fields only those it knows, and its oldest logs dropped, from `ledger` too, until it fits `LEDGER_LIMIT`. */
function withinLimit(ledger: StoredLedger): string {
  for (const [teamId, { lastId, logs }] of Object.entries(ledger)) {
    ledger[teamId] = { lastId, logs: logs.map((log) => ({ ...headerOf(log), simulationCase: log.simulationCase, result: log.result })) }
  }
  for (;;) {
    const json = JSON.stringify(ledger)
    const oldest = Object.values(ledger)
      .filter(({ logs }) => logs.length > 0)
      .reduce<StoredTeamLedger | undefined>((first, each) => (first && first.logs[0]!.createdAt <= each.logs[0]!.createdAt ? first : each), undefined)
    if (json.length <= LEDGER_LIMIT || !oldest) return json
    oldest.logs.shift()
  }
}

/** The logged forecast `log` keeps for the team, its case and result checked as read. */
function logOut(teamId: string, log: StoredLog): ForecastLog {
  const where = `browser storage's "${LEDGER_KEY}"`
  return structuredClone({
    ...headerOf(log),
    teamId,
    simulationCase: checkStored(log.simulationCase, where, isSimulationCase),
    result: checkStored(log.result, where, isForecastResult),
  })
}

/** A logged forecast as the ledger's value keeps it (`StoredLog`): its header and its result's case hash checked, its case and result as read. */
const isStoredLog = (value: unknown): value is StoredLog =>
  isObject(value) &&
  Object.entries(HEADER).every(([field, check]) => check(value[field])) &&
  'simulationCase' in value &&
  isObject(value.result) &&
  isString(value.result.caseHash)

const isStoredTeamLedger = (value: unknown): value is StoredTeamLedger => isObject(value) && isNumber(value.lastId) && isListOf(isStoredLog)(value.logs)
