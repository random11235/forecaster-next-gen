import { CHOICES_LIMIT, type Choice, type ChoiceKind, type ChoicesOfKind, type Connector, type Failure, type Ticket } from '../connector.js'

/** What a canned read answers: tickets in the shape a connector returns them, or a failure on cue. */
export type CannedRead = { tickets: Ticket[]; incomplete: boolean } | Failure

/** A canned connector's fixture, in the connector's own shape, so it can be kept as JSON. */
export interface CannedFixture {
  /** One list per kind, as a connector returns them. */
  milestoneChoices: ChoicesOfKind[] | Failure
  /**
   * Every choice of each kind a search finds among, by kind, or a failure on cue; a kind it doesn't hold is searched
   * among its listed choices.
   */
  searched?: Partial<Record<ChoiceKind, Choice[] | Failure>>
  /** Keyed by query. */
  reads: Record<string, CannedRead>
}

/** Whether each word of `text` starts a word of `name`, ignoring case: as a tracker's search of names matches. */
function wordsMatch(name: string, text: string): boolean {
  const words = name.toLowerCase().split(/\W+/)
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((typed) => typed !== '')
    .every((typed) => words.some((word) => word.startsWith(typed)))
}

/**
 * A connector that answers from a fixture, with no tracker, token or network: what Seam B tests and demo mode use.
 * A search finds the choices whose names have a word starting with each word searched for, ignoring case.
 * A query the fixture doesn't hold matches nothing. A read leaves out tickets finished before `finishedSince`, as a
 * real connector does.
 */
export function cannedConnector(fixture: CannedFixture): Connector {
  return {
    milestoneChoices: async () => {
      const canned = fixture.milestoneChoices
      return Array.isArray(canned) ? { ok: true, kinds: canned } : { ok: false, ...canned }
    },
    searchChoices: async (kind, text) => {
      const listed = Array.isArray(fixture.milestoneChoices) ? (fixture.milestoneChoices.find((each) => each.kind === kind)?.choices ?? []) : []
      const among = fixture.searched?.[kind] ?? listed
      if (!Array.isArray(among)) return { ok: false, ...among }
      return { ok: true, choices: among.filter((choice) => wordsMatch(choice.name, text)).slice(0, CHOICES_LIMIT) }
    },
    read: async (query, finishedSince) => {
      const canned = Object.hasOwn(fixture.reads, query) ? fixture.reads[query]! : { tickets: [], incomplete: false }
      if (!('tickets' in canned)) return { ok: false, ...canned }
      const since = Date.parse(finishedSince)
      const tickets = canned.tickets.filter((ticket) => ticket.finishedAt === undefined || Date.parse(ticket.finishedAt) >= since)
      return { ok: true, tickets, incomplete: canned.incomplete }
    },
  }
}
