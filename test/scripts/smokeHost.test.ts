import { describe, expect, test } from 'vitest'
import { hostWrite, reachedHost, type Seen, type Watched } from '../../scripts/smokeHost.ts'

const HOME = '/w/repo/.git/refs/heads'
const atHome = { kind: 'directory', real: HOME } as const
const config: Seen = { dir: atHome, file: { kind: 'file', content: '[core]\n' } }
const nothing: Seen = { dir: atHome, file: { kind: 'missing' } }
/** What the smoke test saw before the run, where the target's directory is, or would be, at HOME. */
const was = (seen: Seen): Watched => ({ ...seen, home: HOME })

describe('a write the smoke test tried on the host', () => {
  test("didn't reach the host when the file is as it was, so restore has nothing to do", () => {
    expect(hostWrite(was(config), config)).toEqual({ do: 'nothing' })
    expect(hostWrite(was(nothing), nothing)).toEqual({ do: 'nothing' })
    expect(reachedHost(hostWrite(was(config), config))).toBe(false)
  })

  test('reached the host when the file is new or other than it was, and restore puts back what was there', () => {
    const appended = hostWrite(was(config), { dir: atHome, file: { kind: 'file', content: '[core]\n# x\n' } })
    expect(appended).toEqual({ do: 'remove', put: '[core]\n' })
    expect(reachedHost(appended)).toBe(true)
    expect(hostWrite(was(nothing), { dir: atHome, file: { kind: 'file', content: '# x\n' } })).toEqual({ do: 'remove' })
  })

  test('reached the host when the agent left a symlink, which restore removes rather than writes through', () => {
    const link: Seen = { dir: atHome, file: { kind: 'symlink', target: '/etc/passwd' } }
    expect(hostWrite(was(nothing), link)).toEqual({ do: 'remove' })
    expect(hostWrite(was(config), link)).toEqual({ do: 'remove', put: '[core]\n' })
    expect(hostWrite(was(link), { dir: atHome, file: { kind: 'symlink', target: '/etc/shadow' } })).toEqual({ do: 'remove' })
  })

  test('reached the host when the agent left something other than a file at the path, which restore removes', () => {
    expect(hostWrite(was(nothing), { dir: atHome, file: { kind: 'other' } })).toEqual({ do: 'remove' })
  })

  test('reached the host when its directory moved, which restore leaves as it is and warns of, whatever the file', () => {
    const elsewhere = { kind: 'directory', real: '/w/elsewhere' } as const
    expect(hostWrite(was(nothing), { dir: elsewhere, file: { kind: 'missing' } })).toEqual({
      do: 'leave',
      warn: 'moved during the run, to /w/elsewhere: left as it is',
    })
    expect(hostWrite(was(config), { dir: elsewhere, file: config.file })).toMatchObject({ do: 'leave' })
  })

  test('reached the host when its directory was removed, which restore leaves as it is and warns of', () => {
    expect(hostWrite(was(config), { dir: { kind: 'missing' }, file: { kind: 'missing' } })).toEqual({
      do: 'leave',
      warn: 'was removed during the run: left as it is',
    })
  })

  test('reached the host when its directory was swapped for a file, which restore leaves as it is and warns of', () => {
    expect(hostWrite(was(config), { dir: { kind: 'other' }, file: { kind: 'missing' } })).toEqual({
      do: 'leave',
      warn: 'became something other than a directory during the run: left as it is',
    })
  })

  test("reached the host when its directory can't be read after the run, which restore leaves as it is and warns of", () => {
    const loop: Seen = { dir: { kind: 'unreadable', code: 'ELOOP' }, file: { kind: 'missing' } }
    expect(hostWrite(was(config), loop)).toEqual({ do: 'leave', warn: "couldn't be read after the run (ELOOP): left as it is" })
    expect(hostWrite(was(loop), loop)).toEqual({ do: 'nothing' })
  })

  test("didn't reach the host when its directory was something other than a directory before the run, and still is", () => {
    const blocked: Seen = { dir: { kind: 'other' }, file: { kind: 'missing' } }
    expect(hostWrite(was(blocked), blocked)).toEqual({ do: 'nothing' })
  })

  describe('whose directory was something other than a directory before the run, and is one at its place now', () => {
    const blocked: Watched = was({ dir: { kind: 'other' }, file: { kind: 'missing' } })
    const warn = 'was something other than a directory before the run, and is now one, which restore leaves in place'

    test('reached the host, and restore leaves the directory, warning of it truthfully', () => {
      expect(hostWrite(blocked, nothing)).toEqual({ do: 'leave', warn })
    })

    test('reached the host, and restore removes the file the agent wrote in it', () => {
      expect(hostWrite(blocked, { dir: atHome, file: { kind: 'file', content: '# x\n' } })).toEqual({ do: 'remove', warn })
    })
  })

  test('reached the host when its directory was something other than a directory before the run, and is one elsewhere now, which restore leaves', () => {
    const blocked: Watched = was({ dir: { kind: 'other' }, file: { kind: 'missing' } })
    expect(hostWrite(blocked, { dir: { kind: 'directory', real: '/w/elsewhere' }, file: { kind: 'file', content: '# x\n' } })).toEqual({
      do: 'leave',
      warn: 'was something other than a directory before the run, and now resolves to a directory at /w/elsewhere: left as it is',
    })
  })

  test("reached the host when its directory couldn't be read before the run and is one now, which restore leaves, file and all", () => {
    const unread: Watched = was({ dir: { kind: 'unreadable', code: 'EACCES' }, file: { kind: 'missing' } })
    expect(hostWrite(unread, { dir: atHome, file: { kind: 'file', content: '# x\n' } })).toEqual({
      do: 'leave',
      warn: "couldn't be read before the run (EACCES), and is now a directory: left as it is",
    })
  })

  describe('whose directory was missing before the run', () => {
    const none: Seen = { dir: { kind: 'missing' }, file: { kind: 'missing' } }

    test("didn't reach the host when the directory is still missing", () => {
      expect(hostWrite(was(none), none)).toEqual({ do: 'nothing' })
    })

    test('reached the host when the agent made the directory, even empty, which restore leaves in place and warns of', () => {
      expect(hostWrite(was(none), nothing)).toEqual({ do: 'leave', warn: 'was made during the run, and restore leaves it in place' })
    })

    test('reached the host when the agent made the directory and wrote the file, of which restore removes only the file', () => {
      expect(hostWrite(was(none), { dir: atHome, file: { kind: 'file', content: '# x\n' } })).toEqual({
        do: 'remove',
        warn: 'was made during the run, and restore leaves it in place',
      })
    })

    test('reached the host when the agent made a file where the directory would be, which restore leaves and warns of', () => {
      expect(hostWrite(was(none), { dir: { kind: 'other' }, file: { kind: 'missing' } })).toEqual({
        do: 'leave',
        warn: 'became something other than a directory during the run: left as it is',
      })
    })
  })
})
