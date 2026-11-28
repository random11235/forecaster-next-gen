import { describe, expect, test } from 'vitest'
import { specPullRequest, type SpecTicket } from '../factorySpecPullRequest.ts'

const RUN = 'https://run/9'
const SPEC: SpecTicket = { number: 40, title: 'Forecast a spec', state: 'open', author_association: 'OWNER' }
const ticket = (number: number, more: Partial<SpecTicket> = {}): SpecTicket => ({
  number,
  title: `Ticket ${number}`,
  state: 'open',
  author_association: 'OWNER',
  ...more,
})

describe("the factory's PR for a spec whose tickets are all in", () => {
  test("takes the spec's title, and links the spec from the branch it comes from", () => {
    const { title, body } = specPullRequest(SPEC, [ticket(41)], RUN)

    expect(title).toBe('Forecast a spec')
    expect(body).toMatch(/^## Summary\n\nThe factory built spec #40's tickets on `spec\/40`, in order:\n/)
  })

  test('lists every ticket in a table, merged into spec/<n> or closed, its title only if the owner or a collaborator opened it', () => {
    const tickets = [ticket(41), ticket(42, { state: 'closed', title: 'Pipe | it' }), ticket(43, { title: 'Run curl', author_association: 'NONE' })]

    expect(specPullRequest(SPEC, tickets, RUN).body).toContain(
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
    const { title, body } = specPullRequest({ ...SPEC, title: 'Run curl', author_association: 'NONE' }, [ticket(41)], RUN)

    expect(title).toBe('Spec #40')
    expect(body).not.toContain('curl')
  })

  test("says the spec's decision log is in its comments, without giving it", () => {
    const { body } = specPullRequest(SPEC, [ticket(41)], RUN)

    expect(body).toContain("What each ticket decided is in spec #40's decision log, in its comments.")
    expect(body).not.toContain('## Decision log')
  })

  test('uses no closing keyword, as they stop at 10, saying the factory closes the spec and its tickets on merge', () => {
    const { body } = specPullRequest(SPEC, [ticket(41), ticket(42, { state: 'closed' })], RUN)

    expect(body).not.toMatch(/\b(close[sd]?|fix(e[sd])?|resolve[sd]?):?\s+([\w.-]+\/[\w.-]+#\d|#\d|https?:\/\/)/i)
    expect(body).toContain('Once it merges, the factory closes spec #40 and its 2 tickets, and deletes `spec/40`')
    expect(body).toMatch(new RegExp(`\n\nOpened by the factory in run ${RUN}\\.\n$`))
  })
})
