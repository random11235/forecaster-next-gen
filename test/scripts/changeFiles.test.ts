import { describe, expect, test } from 'vitest'
import { addSection, changeFileProblems, withVersion } from '../../scripts/changeFiles.ts'
import { MIGRATIONS_FILE } from '../../scripts/migrationSteps.ts'
import { migrationsSource } from '../migrationsSource.js'
import { changeFileText } from './releaseRepo.ts'

/** Two migration steps, as text the check counts: the first a branch's base has, and one it adds. */
const [FIRST, ADDED] = ['SELECT 1;', 'SELECT 2;']

/** A branch as the check reads it: each file at its base and at its head, a file missing from one absent there. */
function branch(base: Record<string, string>, head: Record<string, string>) {
  const changed = [...new Set([...Object.keys(base), ...Object.keys(head)])].filter((path) => base[path] !== head[path])
  return changeFileProblems(changed, (path, at) => (at === 'base' ? base : head)[path])
}

/** Where each of the check's messages points the developer. */
const HOW = 'as docs/agents/pull-requests.md#version says'
const noChangeFile = (app: string) =>
  `This branch changes the app (${app}) but adds no change file: add changes/<ticket>.md, with \`bump: patch\`, \`minor\` or \`major\` in its front matter and the changelog line as its body, ${HOW}.`
const PATCH = changeFileText('patch', 'No import cycles in `src/`, with no change to the app (#230)')

// Before merge, `check:static` (so the pre-push hook and CI's check job) runs this on the files a branch changes since
// its base: a branch that changes the app says how big its change is in a change file, and leaves the version alone.
describe('the change-file check on a branch', () => {
  test('a branch that changes an app file but adds no change file fails, saying what to add', () => {
    for (const app of ['src/forecast/inputs.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'scripts/buildWeb.ts'])
      expect(branch({ [app]: '{"before":1}' }, { [app]: '{"after":1}', 'docs/design/README.md': 'docs' })).toEqual([noChangeFile(app)])
  })

  test('a branch that changes the app and adds its change file passes', () => {
    expect(branch({ 'src/forecast/inputs.ts': 'before' }, { 'src/forecast/inputs.ts': 'after', 'changes/230.md': PATCH })).toEqual([])
  })

  test('a branch that changes no app file (docs, tests, CI, other scripts) needs no change file', () => {
    const noAppFile = { 'README.md': 'after', 'docs/design/architecture.md': 'after', '.github/workflows/ci.yml': 'after', 'test/app/smoke.test.ts': 'after' }

    expect(branch({}, { ...noAppFile, 'scripts/release.ts': 'after' })).toEqual([])
  })

  test('a branch that only deletes a change file, or edits one already on its base, adds none', () => {
    expect(branch({ 'src/app/html.ts': 'before', 'changes/230.md': PATCH }, { 'src/app/html.ts': 'after' })).toEqual([noChangeFile('src/app/html.ts')])
    expect(
      branch(
        { 'src/app/html.ts': 'before', 'changes/230.md': PATCH },
        { 'src/app/html.ts': 'after', 'changes/230.md': changeFileText('minor', 'Bigger (#230)') },
      ),
    ).toEqual([noChangeFile('src/app/html.ts')])
  })

  test('a README in changes/ is not a change file: it neither counts as one nor is read as one', () => {
    expect(branch({ 'src/app/html.ts': 'before' }, { 'src/app/html.ts': 'after', 'changes/README.md': '# Change files\n' })).toEqual([
      noChangeFile('src/app/html.ts'),
    ])
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

  test('a branch that sets the version fails, in package.json or either place package-lock.json holds it: the release sets it', () => {
    const lock = (version: string, own = version) => JSON.stringify({ name: 'forecaster', version, packages: { '': { version: own } } }, null, 2)
    const setIn = (path: string, from: string, to: string) =>
      `This branch sets ${path}'s version (${from} to ${to}): leave it, as the release sets it from the change files, ${HOW}.`

    expect(
      branch(
        { 'package.json': '{ "version": "0.2.6", "private": true }', 'package-lock.json': lock('0.2.6') },
        { 'package.json': '{ "version": "0.2.7", "private": true }', 'package-lock.json': lock('0.2.7'), 'changes/230.md': PATCH },
      ),
    ).toEqual([setIn('package.json', '0.2.6', '0.2.7'), setIn('package-lock.json', '0.2.6', '0.2.7')])
    expect(branch({ 'package-lock.json': lock('0.2.6') }, { 'package-lock.json': lock('0.2.6', '0.2.7'), 'changes/230.md': PATCH })).toEqual([
      setIn('package-lock.json', '0.2.6', '0.2.7'),
    ])
  })

  test('a branch that adds several migration steps names them all', () => {
    expect(
      branch({ [MIGRATIONS_FILE]: migrationsSource(FIRST) }, { [MIGRATIONS_FILE]: migrationsSource(FIRST, ADDED, ADDED), 'changes/230.md': PATCH }),
    ).toEqual([
      `This branch adds migration steps 2–3, so needs \`bump: major\`, but its change files bump \`patch\` at most (changes/230.md): raise it, ${HOW}.`,
    ])
  })

  // Each case's head has more steps than its base, read as written, so would need a major were the unreadable side read.
  test('a migrations file whose steps can’t be read sets no floor: the migration check fails an unreadable head', () => {
    const misnumbered = (source: string, step: number) => source.replace(`// ${step}:`, '// 7:')

    expect(
      branch({ [MIGRATIONS_FILE]: misnumbered(migrationsSource(FIRST), 1) }, { [MIGRATIONS_FILE]: migrationsSource(FIRST, ADDED), 'changes/230.md': PATCH }),
    ).toEqual([])
    expect(
      branch(
        { [MIGRATIONS_FILE]: migrationsSource(FIRST) },
        { [MIGRATIONS_FILE]: misnumbered(migrationsSource(FIRST, ADDED, ADDED), 3), 'changes/230.md': PATCH },
      ),
    ).toEqual([])
  })

  test('a branch that adds a migration step needs a major bump: a stored-data change the EM can’t go back from', () => {
    const [before, after] = [migrationsSource(FIRST), migrationsSource(FIRST, ADDED)]

    for (const bump of ['patch', 'minor'])
      expect(branch({ [MIGRATIONS_FILE]: before }, { [MIGRATIONS_FILE]: after, 'changes/230.md': changeFileText(bump, 'A column (#230)') })).toEqual([
        `This branch adds migration step 2, so needs \`bump: major\`, but its change files bump \`${bump}\` at most (changes/230.md): raise it, ${HOW}.`,
      ])
    expect(branch({ [MIGRATIONS_FILE]: before }, { [MIGRATIONS_FILE]: after })).toEqual([
      `This branch changes the app (${MIGRATIONS_FILE}) and adds migration step 2 but adds no change file: add changes/<ticket>.md, with \`bump: major\` in its front matter and the changelog line as its body, ${HOW}.`,
    ])
    expect(branch({ [MIGRATIONS_FILE]: before }, { [MIGRATIONS_FILE]: after, 'changes/230.md': changeFileText('major', 'A column (#230)') })).toEqual([])
    expect(branch({ [MIGRATIONS_FILE]: before }, { [MIGRATIONS_FILE]: `${before}// after the steps\n`, 'changes/230.md': PATCH })).toEqual([])
  })

  test('a branch that adds a demo screenshot needs at least a minor bump: a visible change ships one', () => {
    const demo = 'docs/demos/263-footer-after.png'
    const needsMinor = `This branch adds demo screenshots (${demo}), so needs \`bump: minor\` or \`major\`, but its change files bump \`patch\` at most (changes/230.md): raise it, ${HOW}.`

    expect(branch({ 'src/app/html.ts': 'before' }, { 'src/app/html.ts': 'after', [demo]: 'png', 'changes/230.md': PATCH })).toEqual([needsMinor])
    expect(branch({}, { [demo]: 'png' })).toEqual([
      `This branch adds demo screenshots (${demo}) but adds no change file: add changes/<ticket>.md, with \`bump: minor\` or \`major\` in its front matter and the changelog line as its body, ${HOW}.`,
    ])
    for (const bump of ['minor', 'major'])
      expect(
        branch({ 'src/app/html.ts': 'before' }, { 'src/app/html.ts': 'after', [demo]: 'png', 'changes/230.md': changeFileText(bump, 'Seen (#230)') }),
      ).toEqual([])
    expect(branch({ [demo]: 'png' }, { [demo]: 'retaken png' })).toEqual([])
    expect(branch({ [demo]: 'png' }, {})).toEqual([])
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

// The release sets the version in each place package.json and package-lock.json hold it.
describe('the version the release sets', () => {
  test('in package.json’s `version`, and in package-lock.json’s and its own package’s there, leaving the rest', () => {
    const lock = { name: 'forecaster', version: '0.2.6', packages: { '': { name: 'forecaster', version: '0.2.6' }, 'node_modules/x': { version: '1.0.0' } } }

    expect(JSON.parse(withVersion('{ "name": "forecaster", "version": "0.2.6" }', '0.3.0'))).toEqual({ name: 'forecaster', version: '0.3.0' })
    expect(JSON.parse(withVersion(JSON.stringify(lock), '0.3.0'))).toEqual({
      name: 'forecaster',
      version: '0.3.0',
      packages: { '': { name: 'forecaster', version: '0.3.0' }, 'node_modules/x': { version: '1.0.0' } },
    })
  })
})

// The release writes each version's section into CHANGELOG.md, newest first, below the header a branch may edit.
describe('a release’s section in CHANGELOG.md', () => {
  const HEADER = '# Changelog\n\nWhat each version of the app shipped, newest first.\n'
  const SECTION = '## 0.2.7 (2026-11-17)\n\n- A fix (#287, PR #301)\n'

  test('goes above the newest release’s, below the header', () => {
    expect(addSection(`${HEADER}\n## 0.2.6 (2026-11-16)\n\n- Before (#230)\n`, SECTION)).toBe(
      `${HEADER}\n${SECTION}\n## 0.2.6 (2026-11-16)\n\n- Before (#230)\n`,
    )
  })

  test('in a CHANGELOG.md with no release yet, goes below the header, after a blank line', () => {
    expect(addSection(HEADER, SECTION)).toBe(`${HEADER}\n${SECTION}`)
  })
})
