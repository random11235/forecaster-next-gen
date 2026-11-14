import type { AmbiguityRanges } from '../model/ambiguity.js'
import type { CapacityEntry } from '../model/capacity.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import type { Team } from '../model/team.js'
import type { Storage } from './storage.js'

/** The part of the browser's `localStorage` this uses: strings by key. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Where the data is kept in the browser's storage: everything, as one JSON value. */
const KEY = 'forecaster'

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
 * The web build's Storage: the EM's own data, in their browser (#114). Each save writes it all back to `store`.
 * When the browser gives no storage, refuses it (a private window, blocked site data) or holds data it can't read,
 * this starts empty and keeps what is saved only until the page closes.
 */
export function openWebStorage(store: KeyValueStore | undefined): Storage {
  const data = read(store)
  const write = (): void => {
    try {
      store?.setItem(KEY, JSON.stringify(data))
    } catch {
      // kept in memory only, until the page closes
    }
  }

  return {
    isEmpty() {
      return data.teams.length === 0
    },

    saveTeam(team) {
      const index = data.teams.findIndex((stored) => stored.id === team.id)
      if (index === -1) data.teams.push(team)
      else data.teams[index] = { ...team, installedAt: data.teams[index]!.installedAt }
      write()
    },

    teams() {
      return structuredClone(data.teams)
    },

    saveMilestoneInputs(inputs) {
      data.milestoneInputs[inputs.teamId] = structuredClone(inputs)
      write()
    },

    milestoneInputs(teamId) {
      const inputs = data.milestoneInputs[teamId]
      return inputs && structuredClone(withDefaults(inputs))
    },

    saveAmbiguityRanges(ranges) {
      data.ambiguityRanges[ranges.teamId] = structuredClone(ranges)
      write()
    },

    ambiguityRanges(teamId) {
      const ranges = data.ambiguityRanges[teamId]
      return ranges && structuredClone(ranges)
    },

    saveCapacityEntries(teamId, entries) {
      data.capacityEntries[teamId] = structuredClone([...entries])
      write()
    },

    capacityEntries(teamId) {
      // JSON drops an undefined `to`, so an onward entry reads back without one
      return (data.capacityEntries[teamId] ?? []).map((entry) => ({ ...entry, to: entry.to ?? undefined }))
    },

    saveCapacityOn(teamId, on) {
      data.capacityOff = [...data.capacityOff.filter((id) => id !== teamId), ...(on ? [] : [teamId])]
      write()
    },

    capacityOn(teamId) {
      return !data.capacityOff.includes(teamId)
    },

    close() {},
  }
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

function read(store: KeyValueStore | undefined): Stored {
  const empty: Stored = { teams: [], milestoneInputs: {}, ambiguityRanges: {}, capacityEntries: {}, capacityOff: [] }
  try {
    const json = store?.getItem(KEY)
    return json ? { ...empty, ...(JSON.parse(json) as Partial<Stored>) } : empty
  } catch {
    return empty
  }
}
