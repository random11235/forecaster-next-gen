import { describe, expect, test } from 'vitest'
import type { Connector, Failure } from '../../src/connectors/connector.js'
import type { ContractSubject } from './connectorContract.js'
import { githubSubject } from './github/githubSubject.js'

// Seam C: what every connector does, whatever its tracker, on raw responses recorded from the synthetic trackers.
// Later specs add their cases here. Tracker-only quirks are tested beside this, in each tracker's folder.

const subjects: [string, ContractSubject][] = [['GitHub', githubSubject]]

describe.each(subjects)('%s connector', (_, subject) => {
  const { queries, batches } = subject

  describe('milestone choices', () => {
    test('are the open milestones, each with the query that reads its tickets', async () => {
      const result = await subject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      expect(result.choices.map((choice) => choice.name)).toEqual(expect.arrayContaining(['Checkout v2', 'Search revamp']))
      expect(result.choices.find((choice) => choice.name === 'Search revamp')?.query).toBe(queries.searchRevamp)
    })
  })

  describe('a read', () => {
    test("returns the tickets its query matches, finished ones with when they finished", async () => {
      const result = await subject.synthetic().read(queries.searchRevamp, batches.cut)

      if (!result.ok) throw new Error(`read failed: ${result.failure}`)
      const byId = new Map(result.tickets.map((ticket) => [ticket.id, ticket]))
      expect([...byId.keys()].sort()).toEqual(['search-1', 'search-2', 'search-3', 'search-4', 'search-5'].map(subject.idOf).sort())
      for (const role of ['search-1', 'search-2']) {
        const finishedAt = byId.get(subject.idOf(role))?.finishedAt
        expect(Date.parse(finishedAt!)).toBeGreaterThanOrEqual(Date.parse(batches.laterStart) - 1000)
        expect(Date.parse(finishedAt!)).toBeLessThanOrEqual(Date.parse(batches.laterEnd) + 1000)
      }
      for (const role of ['search-3', 'search-4', 'search-5']) expect(byId.get(subject.idOf(role))).toEqual({ id: subject.idOf(role) })
      expect(result.incomplete).toBe(false)
    })

    test('matching nothing returns an empty list, not a failure', async () => {
      expect(await subject.synthetic().read(queries.nothing, batches.cut)).toEqual({ ok: true, tickets: [], incomplete: false })
    })

    test("the tracker refuses fails as invalidQuery, with the tracker's own message", async () => {
      const result = await subject.synthetic().read(queries.invalid, batches.cut)

      expect(result).toEqual({ ok: false, failure: 'invalidQuery', message: expect.stringMatching(/\S/) })
    })

    test('reaching outside the connection fails as outOfScope', async () => {
      expect(await subject.synthetic().read(queries.outOfScope, batches.cut)).toEqual({ ok: false, failure: 'outOfScope' })
    })
  })

  const failing: [string, () => Connector, Failure][] = [
    ['with a refused token', () => subject.refusedToken(), { failure: 'unauthorised' }],
    ['on a repo or project that does not exist', () => subject.unknown(), { failure: 'notFound' }],
    ['with no network', () => subject.unreachable(), { failure: 'unavailable' }],
  ]

  describe.each(failing)('%s', (_, connector, failure) => {
    test(`milestone choices fail as ${failure.failure}`, async () => {
      expect(await connector().milestoneChoices()).toEqual({ ok: false, ...failure })
    })

    test(`a read fails as ${failure.failure}`, async () => {
      expect(await connector().read(queries.searchRevamp, batches.cut)).toEqual({ ok: false, ...failure })
    })
  })
})
