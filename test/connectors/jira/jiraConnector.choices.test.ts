import { describe, expect, test } from 'vitest'
import { jiraConnector } from '../../../src/connectors/jira.js'
import { mustNotWait } from '../backoff.js'
import { CONNECTION, jiraListing, type Listing, many } from './jiraStandIn.js'
import { jiraSubject } from './jiraSubject.js'

/** The milestone choices from a stand-in Jira listing `listing`. */
async function choicesListing(listing: Listing) {
  const connector = jiraConnector(CONNECTION, 'token', jiraListing(listing).transport, mustNotWait)
  const result = await connector.milestoneChoices()
  if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
  return result.kinds
}

describe('Jira milestone choices', () => {
  describe('in the space SYN', () => {
    test('come as fix versions, then epics, then labels, none past the limit', async () => {
      const result = await jiraSubject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      expect(result.kinds.map(({ kind, pastLimit }) => ({ kind, pastLimit }))).toEqual([
        { kind: 'fixVersion', pastLimit: false },
        { kind: 'epic', pastLimit: false },
        { kind: 'label', pastLimit: false },
      ])
    })

    test('list the epics not done, each read by its children', async () => {
      const result = await jiraSubject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      expect(result.kinds[1]!.choices).toEqual([{ kind: 'epic', name: 'Epic: payment methods', query: 'parent = SYN-106' }])
    })

    test('list the labels, each read by its name', async () => {
      const result = await jiraSubject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      expect(result.kinds[2]!.choices).toEqual(
        expect.arrayContaining([
          { kind: 'label', name: 'comparable', query: 'labels = "comparable"' },
          { kind: 'label', name: 'ktlo', query: 'labels = "ktlo"' },
        ]),
      )
    })
  })

  test('come as fix versions, then epics, then labels', async () => {
    expect(await choicesListing({})).toEqual([
      { kind: 'fixVersion', choices: [], pastLimit: false },
      { kind: 'epic', choices: [], pastLimit: false },
      { kind: 'label', choices: [], pastLimit: false },
    ])
  })

  test('with more than 100 unreleased fix versions, list 100, marked past the limit', async () => {
    const versions = many(102, (n) => ({ id: String(n), name: `V${n}`, released: n === 1, archived: false }))

    const [fixVersions] = await choicesListing({ versions })

    expect(fixVersions!.choices).toHaveLength(100)
    expect(fixVersions!.choices[0]!.name).toBe('V2')
    expect(fixVersions!.pastLimit).toBe(true)
  })

  test('with exactly 100 unreleased fix versions, list them all, not past the limit', async () => {
    const versions = many(101, (n) => ({ id: String(n), name: `V${n}`, released: false, archived: n === 101 }))

    const [fixVersions] = await choicesListing({ versions })

    expect(fixVersions!.choices).toHaveLength(100)
    expect(fixVersions!.pastLimit).toBe(false)
  })

  test('a fix version is read by its name, quoted, any quote or backslash in it escaped', async () => {
    const [fixVersions] = await choicesListing({ versions: [{ id: '1', name: 'Say "hi" \\ bye', released: false, archived: false }] })

    expect(fixVersions!.choices).toEqual([{ kind: 'fixVersion', name: 'Say "hi" \\ bye', query: 'fixVersion = "Say \\"hi\\" \\\\ bye"' }])
  })

  test('an epic is named by its summary and read by its children, its key naming it', async () => {
    const [, epics] = await choicesListing({ epics: [{ key: 'SYN-7', summary: 'Payments' }] })

    expect(epics!.choices).toEqual([{ kind: 'epic', name: 'Payments', query: 'parent = SYN-7' }])
  })

  test('with a page of epics after the first 100, list 100, marked past the limit', async () => {
    const [, epics] = await choicesListing({ epics: many(100, (n) => ({ key: `SYN-${n}`, summary: `E${n}` })), moreEpics: true })

    expect(epics!.choices).toHaveLength(100)
    expect(epics!.pastLimit).toBe(true)
  })

  test('a label is read by its name, quoted', async () => {
    const [, , labels] = await choicesListing({ labels: ['checkout', 'say"hi'] })

    expect(labels!.choices).toEqual([
      { kind: 'label', name: 'checkout', query: 'labels = "checkout"' },
      { kind: 'label', name: 'say"hi', query: 'labels = "say\\"hi"' },
    ])
  })

  test('with a page of labels after the first 100, list 100, marked past the limit', async () => {
    const [, , labels] = await choicesListing({ labels: many(100, (n) => `l${n}`), moreLabels: true })

    expect(labels!.choices).toHaveLength(100)
    expect(labels!.pastLimit).toBe(true)
  })
})
