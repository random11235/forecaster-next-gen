import { describe, expect, test } from 'vitest'
import { changeFileProblems } from '../../scripts/changeFiles.ts'

/** A branch as the check reads it: each file at its base and at its head, a file missing from one absent there. */
function branch(base: Record<string, string>, head: Record<string, string>) {
  const changed = [...new Set([...Object.keys(base), ...Object.keys(head)])].filter((path) => base[path] !== head[path])
  return changeFileProblems(changed, (path, at) => (at === 'base' ? base : head)[path])
}

const PATCH = '---\nbump: patch\n---\n\nNo import cycles in `src/`, with no change to the app (#230)\n'

// Before merge, `check:static` (so the pre-push hook and CI's check job) runs this on the files a branch changes since
// its base: a branch that changes the app says how big its change is in a change file, and leaves the version alone.
describe('the change-file check on a branch', () => {
  test('a branch that changes an app file but adds no change file fails, saying what to add', () => {
    for (const app of ['src/forecast/inputs.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'scripts/buildWeb.ts'])
      expect(branch({ [app]: '{"before":1}' }, { [app]: '{"after":1}', 'docs/design/README.md': 'docs' })).toEqual([
        `This branch changes the app (${app}) but adds no change file: add changes/<ticket>.md, with \`bump: patch\`, \`minor\` or \`major\` in its front matter and the changelog line as its body, as docs/agents/pull-requests.md#version says.`,
      ])
  })

  test('a branch that changes the app and adds its change file passes', () => {
    expect(branch({ 'src/forecast/inputs.ts': 'before' }, { 'src/forecast/inputs.ts': 'after', 'changes/230.md': PATCH })).toEqual([])
  })

  test('a branch that changes no app file (docs, tests, CI, other scripts) needs no change file', () => {
    const docsOnly = { 'README.md': 'after', 'docs/design/architecture.md': 'after', '.github/workflows/ci.yml': 'after', 'test/app/smoke.test.ts': 'after' }

    expect(branch({}, { ...docsOnly, 'scripts/releaseTag.ts': 'after' })).toEqual([])
  })

  test('a branch that only deletes a change file adds none', () => {
    expect(branch({ 'src/app/html.ts': 'before', 'changes/230.md': PATCH }, { 'src/app/html.ts': 'after' })).toHaveLength(1)
  })

  test('a change file whose bump is missing or not patch, minor or major fails, naming it', () => {
    for (const text of [
      'No front matter at all (#230)\n',
      'A line first (#230)\n---\nbump: patch\n---\n',
      '---\n---\nNo bump (#230)\n',
      '---\nbump: big\n---\nToo big (#230)\n',
      '---\nbump: Minor\n---\nCase (#230)\n',
    ])
      expect(branch({ 'src/app/html.ts': 'before' }, { 'src/app/html.ts': 'after', 'changes/230.md': text })).toEqual([
        `changes/230.md has no valid bump: start it with front matter setting \`bump: patch\`, \`minor\` or \`major\`, ${HOW}.`,
      ])
  })

  test('a change file whose body is not one changelog line fails, naming it', () => {
    for (const text of ['---\nbump: minor\n---\n', '---\nbump: minor\n---\n\nOne line (#230)\nand another\n'])
      expect(branch({}, { 'changes/230.md': text })).toEqual([`changes/230.md's body isn't one line: write the changelog line as its body, ${HOW}.`])
  })

  test('each change file the branch adds is checked, whatever the front matter also holds', () => {
    const minor = '---\nbump: minor\ntitle: ignored\n---\n\nA visible change (#231)\n'

    expect(branch({}, { 'changes/230.md': PATCH, 'changes/231.md': minor, 'changes/232.md': '---\nbump: tiny\n---\nOops (#232)\n' })).toEqual([
      `changes/232.md has no valid bump: start it with front matter setting \`bump: patch\`, \`minor\` or \`major\`, ${HOW}.`,
    ])
  })

  test('a branch that sets the version fails: the release sets it', () => {
    const lock = (version: string) => JSON.stringify({ name: 'forecaster', version, packages: { '': { version } } }, null, 2)

    expect(
      branch(
        { 'package.json': '{ "version": "0.2.6", "private": true }', 'package-lock.json': lock('0.2.6') },
        { 'package.json': '{ "version": "0.2.7", "private": true }', 'package-lock.json': lock('0.2.7'), 'changes/230.md': PATCH },
      ),
    ).toEqual([
      `This branch sets package.json's version (0.2.6 to 0.2.7): leave it, as the release sets it from the change files, ${HOW}.`,
      `This branch sets package-lock.json's version (0.2.6 to 0.2.7): leave it, as the release sets it from the change files, ${HOW}.`,
    ])
  })

  test('a branch that changes a dependency but not the version passes', () => {
    expect(
      branch(
        { 'package.json': '{ "version": "0.2.6", "dependencies": {} }' },
        { 'package.json': '{ "version": "0.2.6", "dependencies": { "x": "1" } }', 'changes/230.md': PATCH },
      ),
    ).toEqual([])
  })

  test('a branch that edits the CHANGELOG.md entries fails: the release writes them; its header is the branch’s to edit', () => {
    const changelog = (header: string, entries: string) => `# Changelog\n\n${header}\n\n## 0.2.6 (2026-11-17)\n\n${entries}`
    const released = '- No import cycles in `src/` (#230, PR #286)\n'

    expect(
      branch({ 'CHANGELOG.md': changelog('What shipped.', released) }, { 'CHANGELOG.md': changelog('What shipped.', `- A new line (#288)\n${released}`) }),
    ).toEqual([`This branch edits the entries in CHANGELOG.md: leave them, as the release writes each from its change file, ${HOW}.`])
    expect(branch({ 'CHANGELOG.md': changelog('What shipped.', released) }, { 'CHANGELOG.md': changelog('What each version shipped.', released) })).toEqual([])
  })
})

const HOW = 'as docs/agents/pull-requests.md#version says'
