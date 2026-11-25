import { describe, expect, test } from 'vitest'
import { hostWrite, type Seen } from '../../scripts/smokeHost.ts'

const HOME = '/w/repo/.git/refs/heads'
const atHome = { kind: 'directory', real: HOME } as const
const config: Seen = { dir: atHome, file: { kind: 'file', content: '[core]\n' } }
const nothing: Seen = { dir: atHome, file: { kind: 'missing' } }

describe('a write the smoke test tried on the host', () => {
  test("didn't change the host when the file is as it was, so restore has nothing to do", () => {
    expect(hostWrite(HOME, config, config)).toEqual({ changed: false, restore: { do: 'nothing' } })
    expect(hostWrite(HOME, nothing, nothing)).toEqual({ changed: false, restore: { do: 'nothing' } })
  })

  test('changed the host when the file is new or other than it was, and restore puts back what was there', () => {
    expect(hostWrite(HOME, config, { dir: atHome, file: { kind: 'file', content: '[core]\n# x\n' } })).toEqual({
      changed: true,
      restore: { do: 'remove', put: '[core]\n' },
    })
    expect(hostWrite(HOME, nothing, { dir: atHome, file: { kind: 'file', content: '# x\n' } })).toEqual({
      changed: true,
      restore: { do: 'remove' },
    })
  })

  test('changed the host when the agent left a symlink, which restore removes rather than writes through', () => {
    const link: Seen = { dir: atHome, file: { kind: 'symlink', target: '/etc/passwd' } }
    expect(hostWrite(HOME, nothing, link)).toEqual({ changed: true, restore: { do: 'remove' } })
    expect(hostWrite(HOME, config, link)).toEqual({ changed: true, restore: { do: 'remove', put: '[core]\n' } })
    expect(hostWrite(HOME, link, { dir: atHome, file: { kind: 'symlink', target: '/etc/shadow' } })).toMatchObject({ changed: true })
  })

  test('changed the host when the agent left something other than a file at the path, which restore removes', () => {
    expect(hostWrite(HOME, nothing, { dir: atHome, file: { kind: 'other' } })).toEqual({ changed: true, restore: { do: 'remove' } })
  })

  test('changed the host when its directory moved, which restore leaves as it is and warns of, whatever the file', () => {
    const elsewhere = { kind: 'directory', real: '/w/elsewhere' } as const
    expect(hostWrite(HOME, nothing, { dir: elsewhere, file: { kind: 'missing' } })).toEqual({
      changed: true,
      restore: { do: 'leave', why: 'moved, to /w/elsewhere' },
    })
    expect(hostWrite(HOME, config, { dir: elsewhere, file: config.file })).toMatchObject({ changed: true, restore: { do: 'leave' } })
  })

  test('changed the host when its directory was removed, which restore leaves as it is and warns of', () => {
    expect(hostWrite(HOME, config, { dir: { kind: 'missing' }, file: { kind: 'missing' } })).toEqual({
      changed: true,
      restore: { do: 'leave', why: 'was removed' },
    })
  })

  test('changed the host when its directory was swapped for a file, which restore leaves as it is and warns of', () => {
    expect(hostWrite(HOME, config, { dir: { kind: 'other' }, file: { kind: 'missing' } })).toEqual({
      changed: true,
      restore: { do: 'leave', why: 'is now something other than a directory' },
    })
  })

  describe('whose directory was missing before the run', () => {
    const none: Seen = { dir: { kind: 'missing' }, file: { kind: 'missing' } }

    test("didn't change the host when the directory is still missing", () => {
      expect(hostWrite(HOME, none, none)).toEqual({ changed: false, restore: { do: 'nothing' } })
    })

    test('changed the host when the agent made the directory and wrote the file, which restore removes', () => {
      expect(hostWrite(HOME, none, { dir: atHome, file: { kind: 'file', content: '# x\n' } })).toEqual({
        changed: true,
        restore: { do: 'remove' },
      })
    })

    test('changed the host when the agent made a file where the directory would be, which restore leaves and warns of', () => {
      expect(hostWrite(HOME, none, { dir: { kind: 'other' }, file: { kind: 'missing' } })).toEqual({
        changed: true,
        restore: { do: 'leave', why: 'is now something other than a directory' },
      })
    })
  })
})
