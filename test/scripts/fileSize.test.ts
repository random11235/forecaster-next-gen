import { describe, expect, test } from 'vitest'
import { MAX_TOKENS, oversized, splitGuidance, tokensOf } from '../../scripts/fileSize.ts'

const bytes = (tokens: number): number => tokens * 4

describe('the file size check', () => {
  test('a token is four bytes, rounded up', () => {
    expect(tokensOf(20_000)).toBe(5_000)
    expect(tokensOf(20_001)).toBe(5_001)
  })

  test('a code or docs file over the limit is refused; one at the limit passes', () => {
    const refused = oversized([
      { path: 'src/app/html.ts', bytes: bytes(MAX_TOKENS) + 4 },
      { path: 'docs/design/architecture.md', bytes: bytes(MAX_TOKENS) },
    ])
    expect(refused).toEqual([{ path: 'src/app/html.ts', tokens: MAX_TOKENS + 1 }])
  })

  test('files the limit does not cover pass at any size', () => {
    const huge = bytes(MAX_TOKENS * 10)
    const paths = [
      'package-lock.json',
      'src/connectors/canned/demoFixture.json',
      'docs/demos/1-inputs.png',
      'docs/research/forecasting-approaches.md',
      'docs/design/redesign-1b/B1-Forecast.dc.html',
      '.claude/skills/tdd/SKILL.md',
    ]
    expect(oversized(paths.map((path) => ({ path, bytes: huge })))).toEqual([])
  })

  test('the guidance names each file and how to split its kind', () => {
    const guidance = splitGuidance([
      { path: 'src/app/html.ts', tokens: 9_771 },
      { path: 'test/app/screens.test.ts', tokens: 14_969 },
      { path: 'docs/design/architecture.md', tokens: 8_516 },
    ])
    expect(guidance).toContain('src/app/html.ts: ~9771 tokens')
    expect(guidance).toMatch(/src\/[\s\S]*lib\//)
    expect(guidance).toMatch(/test\/[\s\S]*seam/i)
    expect(guidance).toMatch(/\.md[\s\S]*heading/i)
  })
})
