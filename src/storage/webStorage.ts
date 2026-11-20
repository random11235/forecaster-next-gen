import { AMBIGUITIES, type AmbiguityRanges, type GrowthRange } from '../model/ambiguity.js'
import type { ForecastLog, ForecastLogHeader, Ledger, LoggedForecast } from '../ledger/ledger.js'
import type { CapacityEntry } from '../model/capacity.js'
import { PACE_MODES, TICKETS_SOURCES, type MilestoneInputs } from '../model/milestoneInputs.js'
import { TEAM_SOURCES, type Team } from '../model/team.js'
import { isForecastResult, isSimulationCase } from './lib/forecastLogJson.js'
import { isPaceCounts, isStoredPaceWindow, isStoredSeenReads } from './lib/milestoneInputsJson.js'
import { isListOf, isNumber, isObject, isOneOf, isRecordOf, isString, optional, parseStored } from './lib/storedJson.js'
import type { Storage } from './storage.js'

/** The part of the browser's `localStorage` this uses: strings by key. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Where the data is kept in the browser's storage: everything but the forecast ledger, as one JSON value. */
const KEY = 'forecaster'

/**
 * Where the forecast ledger (#27) is kept, as one JSON value apart from the rest: it only grows, so it is kept where
 * filling it can't cost the EM their other data, and a log in it this version can't read refuses only the ledger.
 */
const LEDGER_KEY = 'forecaster.ledger'

/**
 * The most of browser storage the ledger takes, in characters: a fifth of the 5 MB or so a browser gives a site, so
 * the EM's other data always has room. A log of the MVP's forecast takes a few thousand, so it keeps a few hundred.
 */
const LEDGER_LIMIT = 1_000_000

/** Everything stored, by team ID. Fields are only ever added, so data from an earlier build still reads. */
interface Stored {
  teams: Team[]
  /**
   * Each team's milestone inputs, missing the fields added since the build that stored them: the pace window (#161),
   * or sources, skips and reads seen (#210).
   */
  milestoneInputs: Record<
    string,
    Omit<MilestoneInputs, 'paceWindow' | 'ticketsSource' | 'seenReads'> & {
      paceWindow?: Partial<MilestoneInputs['paceWindow']>
      ticketsSource?: MilestoneInputs['ticketsSource']
      seenReads?: Partial<MilestoneInputs['seenReads']>
    }
  >
  ambiguityRanges: Record<string, AmbiguityRanges>
  /** Each team's capacity entries; an entry running onward has no `to`. */
  capacityEntries: Record<string, CapacityEntry[]>
  /** The teams whose capacity is switched off; a team not here has it on. */
  capacityOff: string[]
}

/**
 * A logged forecast as the ledger's value keeps it, in its team's list, oldest first: its case's hash kept from its
 * result, and its case and result checked only as the team's logs are read, so one this version can't read (a later
 * engine's) still gives its header. Any field it doesn't know is kept.
 */
interface StoredLog extends Omit<ForecastLogHeader, 'teamId'> {
  simulationCase: unknown
  result: unknown
}

/** Each team's forecast ledger, by its ID; data from before the ledger has logged none. */
type StoredLedger = Record<string, StoredLog[]>

/**
 * The web build's Storage: the EM's own data, in their browser (#114). Each save writes it all back to `store`.
 * When the browser gives no storage, or refuses it (a private window, blocked site data), this starts empty and keeps
 * what is saved only until the page closes. When it holds data this version can't read (text that isn't JSON, or JSON
 * of a shape it doesn't know, left by a later build, say), every read and save throws, naming the key, as the SQLite
 * file refuses a column it can't read, so what is there is kept. Data it can read keeps no field it doesn't know: the
 * next save drops it. The forecast ledger is kept apart (`ledger`), so neither refuses or crowds out the other.
 */
export function openWebStorage(store: KeyValueStore | undefined): Storage {
  const kept = read(store)
  /** What is stored, or the refusal of data this version can't read. */
  const stored = (): Stored => {
    if ('refused' in kept) throw kept.refused
    return kept.stored
  }
  const write = (): void => {
    try {
      store?.setItem(KEY, JSON.stringify(stored()))
    } catch {
      // kept in memory only, until the page closes
    }
  }

  return {
    ...ledger(store),

    isEmpty() {
      return stored().teams.length === 0
    },

    saveTeam(team) {
      const { teams } = stored()
      const index = teams.findIndex((each) => each.id === team.id)
      if (index === -1) teams.push(team)
      else teams[index] = { ...team, installedAt: teams[index]!.installedAt }
      write()
    },

    teams() {
      return structuredClone(stored().teams)
    },

    saveMilestoneInputs(inputs) {
      stored().milestoneInputs[inputs.teamId] = structuredClone(inputs)
      write()
    },

    milestoneInputs(teamId) {
      const inputs = stored().milestoneInputs[teamId]
      return inputs && structuredClone(withDefaults(inputs))
    },

    saveAmbiguityRanges(ranges) {
      stored().ambiguityRanges[ranges.teamId] = structuredClone(ranges)
      write()
    },

    ambiguityRanges(teamId) {
      const ranges = stored().ambiguityRanges[teamId]
      return ranges && structuredClone(ranges)
    },

    saveCapacityEntries(teamId, entries) {
      stored().capacityEntries[teamId] = structuredClone([...entries])
      write()
    },

    capacityEntries(teamId) {
      // JSON drops an undefined `to`, so an onward entry reads back without one
      return (stored().capacityEntries[teamId] ?? []).map((entry) => ({ ...entry, to: entry.to ?? undefined }))
    },

    saveCapacityOn(teamId, on) {
      const data = stored()
      data.capacityOff = [...data.capacityOff.filter((id) => id !== teamId), ...(on ? [] : [teamId])]
      write()
    },

    capacityOn(teamId) {
      return !stored().capacityOff.includes(teamId)
    },

    close() {},
  }
}

/**
 * The forecast ledger in `store`, under a key of its own. Past `LEDGER_LIMIT`, or when the browser refuses it, a log is
 * kept in memory only, until the page closes. A value this version can't read refuses the ledger, keeping it as it is,
 * as the rest is refused; a log whose case or result it can't read refuses only reading the team's logs.
 */
function ledger(store: KeyValueStore | undefined): Ledger {
  const kept = readLedger(store)
  /** The ledger, or the refusal of one this version can't read. */
  const stored = (): StoredLedger => {
    if ('refused' in kept) throw kept.refused
    return kept.ledger
  }
  const logs = (teamId: string): StoredLog[] => stored()[teamId] ?? []

  return {
    saveForecastLog({ teamId, milestoneName, appVersion, simulationCase, result }: LoggedForecast) {
      const ledger = stored()
      const team = (ledger[teamId] ??= [])
      const id = (team.at(-1)?.id ?? 0) + 1
      const createdAt = new Date().toISOString()
      team.push({
        id,
        createdAt,
        milestoneName,
        appVersion,
        caseHash: result.caseHash,
        simulationCase: structuredClone(simulationCase),
        result: structuredClone(result),
      })
      const json = JSON.stringify(ledger)
      if (json.length > LEDGER_LIMIT) return
      try {
        store?.setItem(LEDGER_KEY, json)
      } catch {
        // kept in memory only, until the page closes
      }
    },

    forecastLogs(teamId) {
      return logs(teamId).map((log) => logOut(teamId, log))
    },

    lastForecastLog(teamId) {
      const last = logs(teamId).at(-1)
      return last && { id: last.id, teamId, createdAt: last.createdAt, milestoneName: last.milestoneName, caseHash: last.caseHash, appVersion: last.appVersion }
    },
  }
}

/** The logged forecast `log` keeps for the team, its case and result checked as read. */
function logOut(teamId: string, { id, createdAt, milestoneName, appVersion, simulationCase, result }: StoredLog): ForecastLog {
  if (!isSimulationCase(simulationCase) || !isForecastResult(result)) {
    throw new Error(`browser storage's "${LEDGER_KEY}" holds a logged forecast of a shape this version of the Forecaster can't read.`)
  }
  return structuredClone({ id, teamId, createdAt, milestoneName, appVersion, simulationCase, result })
}

/**
 * The milestone inputs, with what an earlier build didn't store at its default: no action and no skips, tickets typed,
 * nothing seen. JSON drops an undefined `readAt`, so it is read back as undefined.
 */
function withDefaults({ paceWindow, ticketsSource, seenReads, ...inputs }: Stored['milestoneInputs'][string]): MilestoneInputs {
  return {
    ...inputs,
    ticketsSource: ticketsSource ?? 'typed',
    paceWindow: { action: paceWindow?.action, skippedPeriods: paceWindow?.skippedPeriods ?? [] },
    seenReads: { ticketsRemaining: seenReads?.ticketsRemaining, pace: seenReads?.pace },
  }
}

/** What `store` holds: empty when it holds nothing or the browser refuses it, and the refusal when it can't be read. */
function read(store: KeyValueStore | undefined): { stored: Stored } | { refused: unknown } {
  const empty: Stored = { teams: [], milestoneInputs: {}, ambiguityRanges: {}, capacityEntries: {}, capacityOff: [] }
  let json: string | null | undefined
  try {
    json = store?.getItem(KEY)
  } catch {
    return { stored: empty }
  }
  if (json === null || json === undefined) return { stored: empty }
  try {
    return { stored: { ...empty, ...parseStored(json, `browser storage's "${KEY}"`, isStored) } }
  } catch (refused) {
    return { refused }
  }
}

const isTeam = (value: unknown): value is Team =>
  isObject(value) && ['id', 'name', 'sourceRef', 'installedAt'].every((field) => isString(value[field])) && isOneOf(TEAM_SOURCES)(value.source)

/** A low–high range, as each one stored is: an ambiguity level's growth, or a pace's, the same shape. */
const isRange = (value: unknown): value is GrowthRange => isObject(value) && isNumber(value.low) && isNumber(value.high)

/** A team's milestone inputs, as an earlier build may have stored them (`Stored`). */
const isStoredMilestoneInputs = (value: unknown): value is Stored['milestoneInputs'][string] =>
  isObject(value) &&
  isString(value.teamId) &&
  isString(value.name) &&
  optional(isString)(value.startDate) &&
  optional(isNumber)(value.ticketsRemaining) &&
  optional(isOneOf(TICKETS_SOURCES))(value.ticketsSource) &&
  isOneOf(AMBIGUITIES)(value.ambiguity) &&
  isNumber(value.cadenceDays) &&
  isOneOf(PACE_MODES)(value.paceMode) &&
  optional(isRange)(value.paceRange) &&
  isPaceCounts(value.paceCounts) &&
  optional(isNumber)(value.paceCadenceDays) &&
  optional(isStoredPaceWindow)(value.paceWindow) &&
  optional(isStoredSeenReads)(value.seenReads)

const isAmbiguityRanges = (value: unknown): value is AmbiguityRanges =>
  isObject(value) && isString(value.teamId) && AMBIGUITIES.every((level) => isRange(value[level]))

/** A capacity entry as stored: JSON drops an undefined `to`. */
const isCapacityEntry = (value: unknown): value is CapacityEntry =>
  isObject(value) &&
  isNumber(value.id) &&
  isString(value.from) &&
  optional(isString)(value.to) &&
  isNumber(value.percent) &&
  isString(value.note) &&
  optional(isString)(value.newUsualOn) &&
  optional(isOneOf([true] as const))(value.kept)

/**
 * Everything stored, as reading it needs: an object whose parts, each missing in data from an earlier build, are the
 * teams, each team's records by its ID, and the IDs of the teams with capacity off.
 */
function isStored(value: unknown): value is Partial<Stored> {
  if (!isObject(value)) return false
  const { teams, milestoneInputs, ambiguityRanges, capacityEntries, capacityOff } = value
  return (
    optional(isListOf(isTeam))(teams) &&
    optional(isRecordOf(isStoredMilestoneInputs))(milestoneInputs) &&
    optional(isRecordOf(isAmbiguityRanges))(ambiguityRanges) &&
    optional(isRecordOf(isListOf(isCapacityEntry)))(capacityEntries) &&
    optional(isListOf(isString))(capacityOff)
  )
}

/** The forecast ledger `store` holds: none logged when it holds nothing or the browser refuses it, and the refusal when it can't be read. */
function readLedger(store: KeyValueStore | undefined): { ledger: StoredLedger } | { refused: unknown } {
  let json: string | null | undefined
  try {
    json = store?.getItem(LEDGER_KEY)
  } catch {
    return { ledger: {} }
  }
  if (json === null || json === undefined) return { ledger: {} }
  try {
    return { ledger: parseStored(json, `browser storage's "${LEDGER_KEY}"`, isRecordOf(isListOf(isStoredLog))) }
  } catch (refused) {
    return { refused }
  }
}

/** A logged forecast as the ledger's value keeps it (`StoredLog`): its header checked, its case and result as read. */
const isStoredLog = (value: unknown): value is StoredLog =>
  isObject(value) &&
  isNumber(value.id) &&
  ['createdAt', 'milestoneName', 'appVersion', 'caseHash'].every((field) => isString(value[field])) &&
  'simulationCase' in value &&
  'result' in value
