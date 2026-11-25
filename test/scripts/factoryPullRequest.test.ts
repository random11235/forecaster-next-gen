import { describe, expect, test } from 'vitest'
import { pullRequestBody } from '../../scripts/factoryPullRequest.ts'

describe("the factory's PR body", () => {
  const RUN = 'https://github.com/o/r/actions/runs/7'

  test('is the body the agent ended its reply with, then the line closing the ticket and the run that built it', () => {
    const reply = 'Done.\n<pr-body>\n## Summary\n\nThe screen.\n\n## Merge Danger\n\nLow.\n</pr-body>\n'

    expect(pullRequestBody(reply, 42, RUN)).toBe(`## Summary\n\nThe screen.\n\n## Merge Danger\n\nLow.\n\nCloses #42.\n\nBuilt by the factory in run ${RUN}.\n`)
  })

  test("falls back to a body in /pr's sections, saying the agent wrote none, when its reply holds no body or an empty one", () => {
    for (const reply of ['Done.', '<pr-body>\n \n</pr-body>', '<pr-body>never closed']) {
      expect(pullRequestBody(reply, 42, RUN)).toBe(
        '## Summary\n\nThe factory built #42, but its agent wrote no PR body: read the commits.\n\n' +
          `## Evidence\n\n\`npm run check\` passed on the branch in run ${RUN}.\n\n` +
          '## Merge Danger\n\nUnknown: with no body to say what changed, review the whole diff.\n\n' +
          `Closes #42.\n\nBuilt by the factory in run ${RUN}.\n`,
      )
    }
  })

  test("cuts a body too long for GitHub's 65,536 characters, saying so, and keeps the closing line", () => {
    const body = pullRequestBody(`<pr-body>${'x'.repeat(70_000)}</pr-body>`, 42, RUN)

    expect(body.length).toBeLessThanOrEqual(65_536)
    expect(body).toContain("x\n\n(The agent's body was cut here: it was 70000 characters, more than a PR body holds.)\n\nCloses #42.")
  })

  test('is the last block the reply holds, when it names the tag earlier', () => {
    const reply = 'I will end with a <pr-body> block.\n<pr-body>\nA draft.\n</pr-body>\nBetter:\n<pr-body>\n## Summary\n\nThe screen.\n</pr-body>'

    expect(pullRequestBody(reply, 42, RUN)).toBe(`## Summary\n\nThe screen.\n\nCloses #42.\n\nBuilt by the factory in run ${RUN}.\n`)
  })
})
