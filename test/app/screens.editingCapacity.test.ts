import { describe, expect, test } from 'vitest'
import { startOnPreMvpData, page, text, post, submitPace, submitCounts, choosePace, addCapacity, editCapacity } from './screensHarness.js'

// The screens through the local server: see screensHarness.ts.

describe('Milestone forecast screen: editing capacity, and Past', () => {
  test('each entry has an Edit, holding its sentence as saved with Save and Cancel', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    const html = await page('/')

    const edit = html.match(/<details class="edit">[\s\S]*?<\/details>/)?.[0] ?? ''
    expect(text(edit).trim()).toMatch(/^Edit At % from to or onward , for \. Save Cancel$/)
    expect(edit).toContain('<form method="post" action="/capacity/edit?capacity=open#capacity"')
    expect(edit).toContain('<input type="hidden" name="id" value="1">')
    expect(edit).toContain('value="0"')
    expect(edit).toContain('value="2026-11-06"')
    expect(edit).toContain('value="Offsite"')
    expect(edit).toContain('<a href="/?capacity=open#capacity">Cancel</a>')
  })

  test('an edit saved comes back to the forecast, the entry changed', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    const response = await editCapacity('1', '50', '2026-11-09', '2026-11-13', 'Offsite, half the team')

    expect(response.headers.get('location')).toBe('/')
    expect(text(await page('/'))).toContain('50% 9 Nov 2026 to 13 Nov 2026 Offsite, half the team')
  })

  test('an edit refused shows the forecast again with that entry’s edit open, as typed, saying why', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    const response = await editCapacity('1', '50', '2026-11-13', '2026-11-09', 'Moved')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('<details class="capacity" id="capacity" data-toggle="/#capacity" open>')
    const edit = html.match(/<details class="edit" open>[\s\S]*?<\/details>/)?.[0] ?? ''
    expect(text(edit)).toContain('The end date is before the start.')
    expect(edit).toContain('value="2026-11-13"')
    expect(edit).toContain('value="Moved"')
    expect(text(html)).toContain('0% 2 Nov 2026 to 6 Nov 2026 Offsite')
  })

  test('an entry that has ended is folded under Past, kept, with only its note to edit and no Remove', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-09-07', '2026-09-11', 'Offsite')

    const html = await page('/')

    const past = html.match(/<details class="capacity-past">[\s\S]*<\/details>\s*<\/li>\s*<\/ul>\s*<\/details>/)?.[0] ?? ''
    expect(text(past).trim()).toMatch(
      /^Past \(1\) · kept, not used by the forecast 0% 7 Sep 2026 to 11 Sep 2026 Offsite Edit Past, so only the note can change\. Note Save Cancel$/,
    )
    expect(past).not.toContain('/capacity/remove')
    expect(text(html)).toContain('Capacity none, every week usual')
    expect(text(html)).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026')
  })

  test('a past entry’s note saved changes the note alone', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-09-07', '2026-09-11', 'Offsite')

    await post('/capacity/edit', [
      ['id', '1'],
      ['note', 'Offsite in Lisbon'],
    ])

    expect(text(await page('/'))).toContain('0% 7 Sep 2026 to 11 Sep 2026 Offsite in Lisbon')
  })
})

describe('Milestone forecast screen: new usual', () => {
  /** Four typed counts, the weeks from 22 Sep to 13 Oct, and a lasting change from `from`. */
  async function lastingChangeOnTypedCounts(from: string): Promise<void> {
    await startOnPreMvpData()
    await submitCounts('4, 6, 5, 7')
    await choosePace('counts')
    await addCapacity('80', from, '', 'Two left', true)
  }

  test('while only some of the weeks the pace comes from are after a lasting change, the entry says how many', async () => {
    await lastingChangeOnTypedCounts('2026-10-01')

    const html = await page('/?capacity=open')

    expect(text(html)).toContain(
      'Remove 2 of the 4 weeks the pace comes from are after the change. Past counts aren’t adjusted. When all of them are, you’ll be asked whether it’s the new usual.',
    )
    expect(html).not.toContain('/capacity/new-usual')
  })

  test('once all of them are, it proposes the new usual, with Make it the new usual and Keep it', async () => {
    await lastingChangeOnTypedCounts('2026-09-22')

    const html = await page('/')

    expect(text(html)).toContain(
      'Every week the pace comes from starts on or after 22 Sep 2026, so it already shows the team at 80%. Make it the new usual ? The change then ends, so it isn’t counted twice. Make it the new usual Keep it',
    )
    expect(html).toContain('<form method="post" action="/capacity/new-usual?capacity=open#capacity"><input type="hidden" name="id" value="1">')
    expect(html).toContain('<form method="post" action="/capacity/keep?capacity=open#capacity"><input type="hidden" name="id" value="1">')
  })

  test('made the new usual, the change ends today and is listed under Past', async () => {
    await lastingChangeOnTypedCounts('2026-09-22')

    const response = await post('/capacity/new-usual?capacity=open', [['id', '1']])

    expect(response.headers.get('location')).toBe('/?capacity=open')
    const html = await page('/?capacity=open')
    expect(text(html)).toContain('80% 22 Sep 2026 to 24 Oct 2026 · new usual from 24 Oct 2026 Two left')
    expect(text(html)).toContain('Capacity none, every week usual')
  })

  test('kept, it is no longer proposed', async () => {
    await lastingChangeOnTypedCounts('2026-09-22')

    await post('/capacity/keep?capacity=open', [['id', '1']])

    const html = await page('/?capacity=open')
    expect(text(html)).toContain('80% from 22 Sep 2026 onward Two left')
    expect(text(html)).not.toContain('new usual')
  })

  test('with a pace range, a lasting change offers End it today, which ends it yesterday', async () => {
    await startOnPreMvpData()
    await submitPace('4', '8')
    await addCapacity('80', '2026-09-22', '', 'Two left', true)

    const html = await page('/?capacity=open')

    expect(text(html)).toContain('Remove With a pace range, end this yourself once the range reflects it. End it today')
    expect(html).toContain('<form method="post" action="/capacity/end-today?capacity=open#capacity"><input type="hidden" name="id" value="1">')
    await post('/capacity/end-today?capacity=open', [['id', '1']])
    expect(text(await page('/'))).toContain('80% 22 Sep 2026 to 23 Oct 2026 Two left')
  })
})
