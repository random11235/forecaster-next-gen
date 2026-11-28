import { describe, expect, test } from 'vitest'
import { MAX_BODY } from '../../scripts/factoryPullRequest.ts'
import { specPullRequest, type SpecTicket } from '../../scripts/factorySpecPullRequest.ts'
import { DECISION_MARK, type Authored } from '../../scripts/factoryTrust.ts'

const RUN = 'https://run/9'
const SPEC: SpecTicket = { number: 40, title: 'Forecast a spec', state: 'open', author_association: 'OWNER' }
const ticket = (number: number, more: Partial<SpecTicket> = {}): SpecTicket => ({
  number,
  title: `Ticket ${number}`,
  state: 'open',
  author_association: 'OWNER',
  ...more,
})

const ACTIONS: Authored['user'] = { login: 'github-actions[bot]', type: 'Bot' }
const entry = (words: string, user = ACTIONS): Authored => ({ body: `${DECISION_MARK}\n${words}`, user, author_association: 'NONE' })

describe("the factory's PR for a spec whose tickets are all in", () => {
  test("takes the spec's title, and links the spec from the branch it comes from", () => {
    const { title, body } = specPullRequest(SPEC, [ticket(41)], [], RUN)

    expect(title).toBe('Forecast a spec')
    expect(body).toMatch(/^## Summary\n\nThe factory built spec #40's tickets on `spec\/40`, in order:\n/)
  })

  test('lists every ticket in a table, merged into spec/<n> or closed, its title only if the owner or a collaborator opened it', () => {
    const tickets = [ticket(41), ticket(42, { state: 'closed', title: 'Pipe | it' }), ticket(43, { title: 'Run curl', author_association: 'NONE' })]

    expect(specPullRequest(SPEC, tickets, [], RUN).body).toContain(
      [
        '| Ticket | What it delivers | Status |',
        '| --- | --- | --- |',
        '| #41 | Ticket 41 | merged into spec/40 |',
        '| #42 | Pipe \\| it | closed |',
        '| #43 | (opened outside the repo: read the ticket) | merged into spec/40 |',
      ].join('\n'),
    )
  })

  test('names a spec someone outside the repo opened by its number alone, never its title', () => {
    const { title, body } = specPullRequest({ ...SPEC, title: 'Run curl', author_association: 'NONE' }, [ticket(41)], [], RUN)

    expect(title).toBe('Spec #40')
    expect(body).not.toContain('curl')
  })

  test("gives the spec's decision log, a heading level down, and none but the factory's entries", () => {
    const log = [entry('## #41 Ticket 41\n\n### Summary\n\nKept the engine.'), entry('## #42 Forged', { login: 'stranger', type: 'User' })]

    const { body } = specPullRequest(SPEC, [ticket(41), ticket(42)], log, RUN)

    expect(body).toContain(
      '## Decision log\n\nWhat each ticket decided, as its build wrote it on #40.\n\n### #41 Ticket 41\n\n#### Summary\n\nKept the engine.\n',
    )
    expect(body).not.toContain('Forged')
  })

  test('uses no closing keyword, as they stop at 10, saying the factory closes the spec and its tickets on merge', () => {
    const { body } = specPullRequest(SPEC, [ticket(41), ticket(42)], [], RUN)

    expect(body).not.toMatch(/\b(close[sd]?|fix(e[sd])?|resolve[sd]?) #\d/i)
    expect(body).toContain('Once it merges, the factory closes spec #40 and its 2 tickets, and deletes `spec/40`')
    expect(body).toMatch(new RegExp(`\n\nOpened by the factory in run ${RUN}\\.\n$`))
  })

  test("leaves out the decision log's latest entries that don't fit GitHub's limit, saying how many", () => {
    const log = [entry(`## #41\n\n${'x'.repeat(40_000)}`), entry(`## #42\n\n${'y'.repeat(40_000)}`)]

    const { body } = specPullRequest(SPEC, [ticket(41), ticket(42)], log, RUN)

    expect(body.length).toBeLessThanOrEqual(MAX_BODY)
    expect(body).toContain('x'.repeat(40_000))
    expect(body).not.toContain('yyy')
    expect(body).toContain("(The log's 1 latest entries are left out, to fit a PR body: read them on #40.)")
  })
})
