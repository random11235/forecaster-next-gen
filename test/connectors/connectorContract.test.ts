import { describe, expect, test } from 'vitest'
import type { Connector, Failure } from '../../src/connectors/connector.js'
import type { ContractSubject } from './connectorContract.js'
import { FROM_THE_START } from './scenarios.js'
import { githubSubject } from './github/githubSubject.js'
import { jiraSubject } from './jira/jiraSubject.js'

// Seam C: what every connector does, whatever its tracker, on raw responses recorded from the synthetic trackers.
// Later specs add their cases here. Tracker-only quirks are tested beside this, in each tracker's folder.

const subjects: [string, ContractSubject][] = [
  ['GitHub', githubSubject],
  ['Jira', jiraSubject],
]

describe.each(subjects)('%s connector', (_, subject) => {
  const { queries, batches } = subject

  describe('milestone choices', () => {
    test('come one list per kind, each choice of its list\'s kind', async () => {
      const result = await subject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      const kinds = result.kinds.map(({ kind }) => kind)
      expect(new Set(kinds).size).toBe(kinds.length)
      for (const { kind, choices } of result.kinds) for (const choice of choices) expect(choice.kind).toBe(kind)
    })

    test('list the open milestones, each with the query that reads its tickets, all of them, not past the limit', async () => {
      const result = await subject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      const milestones = result.kinds.find(({ choices }) => choices.some((choice) => choice.name === 'Search revamp'))
      expect(milestones?.choices.map((choice) => choice.name)).toEqual(expect.arrayContaining(['Checkout v2', 'Search revamp']))
      expect(milestones?.choices.find((choice) => choice.name === 'Search revamp')?.query).toBe(queries.searchRevamp)
      expect(milestones?.pastLimit).toBe(false)
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

      expect(result).toEqual({ ok: false, failure: 'invalidQuery', message: subject.invalidMessage })
    })

    test.each(subject.outOfScope)('naming %s fails as outOfScope', async (_, query) => {
      expect(await subject.synthetic().read(query, batches.cut)).toEqual({ ok: false, failure: 'outOfScope' })
    })
  })

  describe('a full read', () => {
    test("reads every page of the query's leaf tickets, and nothing else: no parents, no pull requests", async () => {
      const result = await subject.synthetic().read(queries.checkout, FROM_THE_START)

      if (!result.ok) throw new Error(`read failed: ${result.failure}`)
      expect(result.tickets.map((ticket) => ticket.id).sort()).toEqual(subject.roles.checkout.map(subject.idOf).sort())
      expect(result.incomplete).toBe(false)
    })

    test("adds the connection's repo or project: a query matching tickets anywhere reads only the connection's", async () => {
      const result = await subject.synthetic().read(queries.open, batches.cut)

      if (!result.ok) throw new Error(`read failed: ${result.failure}`)
      expect(result.tickets.length).toBeGreaterThan(0)
      expect(subject.ids).toEqual(expect.arrayContaining(result.tickets.map((ticket) => ticket.id)))
    })

    test('a reopened ticket finished again is finished at its last finish', async () => {
      const result = await subject.synthetic().read(queries.checkout, batches.cut)

      if (!result.ok) throw new Error(`read failed: ${result.failure}`)
      const finishedAt = result.tickets.find((ticket) => ticket.id === subject.idOf('reopened-finished'))?.finishedAt
      expect(Date.parse(finishedAt!)).toBeGreaterThanOrEqual(Date.parse(batches.laterStart) - 1000)
      expect(Date.parse(finishedAt!)).toBeLessThanOrEqual(Date.parse(batches.laterEnd) + 1000)
    })

    test('a reopened ticket still open is open', async () => {
      const result = await subject.synthetic().read(queries.checkout, batches.cut)

      if (!result.ok) throw new Error(`read failed: ${result.failure}`)
      expect(result.tickets).toContainEqual({ id: subject.idOf('reopened-open') })
    })

    test('never returns a parent, though its leaves are read', async () => {
      const result = await subject.synthetic().read(queries.checkout, FROM_THE_START)

      if (!result.ok) throw new Error(`read failed: ${result.failure}`)
      const ids = result.tickets.map((ticket) => ticket.id)
      for (const role of subject.roles.parents) expect(ids).not.toContain(subject.idOf(role))
      expect(ids).toContain(subject.idOf('epic-leaf'))
    })

    test('leaves out tickets finished before finishedSince, and keeps those finished since and those open', async () => {
      const result = await subject.synthetic().read(queries.checkout, batches.cut)

      if (!result.ok) throw new Error(`read failed: ${result.failure}`)
      const ids = result.tickets.map((ticket) => ticket.id)
      // The seed finished leaves 001 to 020 before the cut, 021 to 060 after it, and left 061 to 105 open.
      for (const role of ['leaf-001', 'leaf-020']) expect(ids).not.toContain(subject.idOf(role))
      for (const role of ['leaf-021', 'leaf-060', 'leaf-061', 'leaf-105']) expect(ids).toContain(subject.idOf(role))
    })

    test.runIf(queries.nestedEpic)('of a picked nested epic returns every leaf beneath it, through its sub-epics, and no epic', async () => {
      const result = await subject.synthetic().read(queries.nestedEpic!, FROM_THE_START)

      if (!result.ok) throw new Error(`read failed: ${result.failure}`)
      expect(result.tickets.map((ticket) => ticket.id).sort()).toEqual(subject.roles.nestedEpic!.leaves.map(subject.idOf).sort())
      expect(result.incomplete).toBe(false)
    })

    test.runIf(queries.nestedEpic)("finds a picked epic's sub-epics as it reads, so one added after the pick is read", async () => {
      // The epic's choice, as kept with the milestone, names only the epic: its sub-epics are found by each read.
      const choices = await subject.synthetic().milestoneChoices()
      if (!choices.ok) throw new Error(`milestone choices failed: ${choices.failure}`)
      const epics = choices.kinds.find(({ kind }) => kind === 'epic')
      expect(epics?.choices.map((choice) => choice.query)).toContain(queries.nestedEpic)

      const result = await subject.synthetic().read(queries.nestedEpic!, FROM_THE_START)

      if (!result.ok) throw new Error(`read failed: ${result.failure}`)
      expect(result.tickets.map((ticket) => ticket.id)).toEqual(expect.arrayContaining(subject.roles.nestedEpic!.underSubEpic.map(subject.idOf)))
    })

    test.runIf(subject.capped)('reading as far as a search cap allows, the read is incomplete', async () => {
      const result = await subject.capped!().read(queries.checkout, FROM_THE_START)

      expect(result).toMatchObject({ ok: true, incomplete: true })
    })
  })

  describe('a rate-limited tracker', () => {
    test('is retried with backoff, so a read rate limited, then answered, succeeds', async () => {
      const { connector, waits } = subject.rateLimited(1)

      expect(await connector.read(queries.searchRevamp, batches.cut)).toEqual(await subject.synthetic().read(queries.searchRevamp, batches.cut))
      expect(waits.length).toBeGreaterThan(0)
    })

    test("waits as long as the tracker's retry-after asks", async () => {
      const { connector, waits } = subject.rateLimited(1, '5')

      expect((await connector.milestoneChoices()).ok).toBe(true)
      expect(waits.length).toBeGreaterThan(0)
      expect(new Set(waits)).toEqual(new Set([5000]))
    })

    test('still rate limited after backoff, a read is unavailable', async () => {
      const { connector, waits } = subject.rateLimited(Infinity)

      expect(await connector.read(queries.searchRevamp, batches.cut)).toEqual({ ok: false, failure: 'unavailable' })
      expect(waits).toEqual([1000, 2000, 4000])
    })
  })

  const failing: [string, () => Connector, Failure][] = [
    ['with a refused token', () => subject.refusedToken(), { failure: 'unauthorised' }],
    ['on a repo or project that does not exist', () => subject.unknown(), { failure: 'notFound' }],
    ['with no network', () => subject.unreachable(), { failure: 'unavailable' }],
  ]

  describe('a request with no recording', () => {
    // A missing recording must fail the test that needs it, never pass as a failure the case expects.
    test('fails milestone choices loudly, naming the request', async () => {
      await expect(subject.unrecorded().milestoneChoices()).rejects.toThrow(/^No recording for /)
    })

    test('fails a read loudly, naming the request', async () => {
      await expect(subject.unrecorded().read(queries.searchRevamp, batches.cut)).rejects.toThrow(/^No recording for /)
    })
  })

  describe.each(failing)('%s', (_, connector, failure) => {
    test(`milestone choices fail as ${failure.failure}`, async () => {
      expect(await connector().milestoneChoices()).toEqual({ ok: false, ...failure })
    })

    test(`a read fails as ${failure.failure}`, async () => {
      expect(await connector().read(queries.searchRevamp, batches.cut)).toEqual({ ok: false, ...failure })
    })
  })
})
