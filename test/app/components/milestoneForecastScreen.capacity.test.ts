import { describe, expect, test } from 'vitest'
import type { Element } from 'happy-dom'
import { add, tenTicketsAtFive } from '../../forecast/capacityScenario.js'
import { outcomeOf, submitInputs } from '../../forecast/forecastingForTest.js'
import { DEFAULT_SETTINGS } from '../../../src/forecast/index.js'
import { newTeam } from '../../forecast/forecastViewScenario.js'
import { accessibleName, all, allByRole, around, byRole, hasRole, hiddenFields, one, postsTo, text } from '../dom.js'
import { drawn, forecast, dateSaid, headline, entered } from './milestoneForecastScreenHarness.js'

// The Milestone forecast screen (#236), rendered from the views Seam B gives (test/forecast/forecastingForTest.ts),
// started no server: capacity in use, the Capacity section, and a lasting change against the pace. Shared arrangement
// is milestoneForecastScreenHarness.ts's. What each view holds is Seam B's
// (test/forecast/milestoneForecastView*.test.ts, capacity*.test.ts, newUsual.test.ts, pacePattern.*.test.ts).

describe('the Milestone forecast screen: capacity in use', () => {
  test('capacity in use: each date with and at usual capacity, how far it moves, the shaded week, and its entry', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '50', '2026-09-07', '2026-09-13')
    const view = forecast(await team.milestoneForecastView({ capacityOpen: true }))
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe(
      `Launch · 10 tickets remaining Starting 7 Sep 2026: ${view.headlinePercent}% confident of finishing by ${headline(view)} ${view.capacityLine}`,
    )
    expect(allByRole(byRole(page, 'table'), 'row').map((row) => text(row))).toEqual([
      'With capacity At usual capacity',
      ...(view.comparison ?? []).map(
        ({ percent, withCapacity, atUsual, shift }) => `${percent}% confident by ${dateSaid(withCapacity)} ${dateSaid(atUsual)} ${shift.words}`,
      ),
    ])
    expect(text(byRole(page, 'figure')).match(/Shaded weeks: capacity changes, at the % shown\./)).not.toBeNull()
    expect(text(one(page, '.bar.changed .capacity'))).toBe('50%')
    expect(text(one(page, '.bar.changed .tip'))).toMatch(/ of simulations are completed within\. At 50% capacity\.$/)
    // a usual week is left plain
    expect(
      all(page, '.bar:not(.changed) .tip')
        .map((tip) => text(tip))
        .filter((tip) => tip.includes('capacity')),
    ).toEqual([])
    expect(all(page, '.bar:not(.changed) .capacity')).toEqual([])
    const capacity = one(page, '#capacity')
    expect(capacity.hasAttribute('open')).toBe(true)
    expect(byRole(capacity, 'switch', { name: 'Use capacity in this forecast' }).getAttribute('aria-checked')).toBe('true')
    expect(postsTo(byRole(capacity, 'button', { name: 'Remove' }))).toMatch(/^\/capacity\/remove/)
  })

  test('a capacity refused there: the screen again, capacity open, why beside the sentence typed', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    const { view } = outcomeOf(await add(team, '5000', '2026-09-07', '', { note: 'Half on "<leave>"' }), 'refusedOnForecast')
    const { refusal } = forecast(view).capacity
    const capacity = one(drawn(view), '#capacity')

    expect(capacity.hasAttribute('open')).toBe(true)
    expect(refusal).toBeDefined()
    expect(text(byRole(capacity, 'alert'))).toBe(refusal)
    expect(byRole(capacity, 'spinbutton', { name: 'Capacity, in % of usual' }).getAttribute('value')).toBe('5000')
    expect(byRole(capacity, 'textbox', { name: 'Why' }).getAttribute('value')).toBe('Half on "<leave>"')
  })
})

describe('the Capacity section', () => {
  /** The Capacity section of `page`, opened as the EM opens it, so what it folds is seen. */
  function opened(page: ReturnType<typeof drawn>): Element {
    const capacity = one(page, '#capacity')
    capacity.setAttribute('open', '')
    return capacity
  }

  /** The section with capacity typed as these sentences, open or folded. */
  async function capacityOf(sentences: [string, string, string, { onward?: boolean; note?: string }?][], { open = true } = {}) {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    for (const [percent, from, to, more] of sentences) await add(team, percent, from, to, more)
    const view = forecast(await team.milestoneForecastView({ capacityOpen: open }))
    return { team, view, capacity: one(drawn(view), '#capacity') }
  }

  test('folded, none typed: every week at 100%, the sentence to add one, and toggling opens it', async () => {
    const page = drawn(forecast(await (await entered('100', ['4', '8'])).milestoneForecastView()))
    const capacity = opened(page)

    expect(capacity.getAttribute('data-toggle')).toBe('/?capacity=open#capacity')
    expect(text(capacity)).toContain('100% = the team’s usual week, as in the pace. Every week is at 100%.')
    expect(text(capacity)).toContain(
      'Capacity scales pace in proportion: a 60% week draws 60% of a usual week’s pace. Weekends don’t count; overlapping entries multiply. Past counts aren’t adjusted.',
    )
    expect(postsTo(byRole(capacity, 'button', { name: 'Add' }))).toBe('/capacity/add?capacity=open#capacity')
  })

  test('each entry as one line, earliest first: a day, a span, onward, its note, its effect, and any warning', async () => {
    const { view, capacity } = await capacityOf([
      ['300', '2026-10-05', '', { onward: true }],
      ['0', '2026-09-14', '2026-09-14', { note: 'Holiday' }],
      ['50', '2026-09-21', '2026-09-25', { note: 'Offsite' }],
    ])
    const [day, span, onward] = view.capacity.entries
    if (onward?.warning === undefined) throw new Error('Expected 300% onward to be warned of')

    expect(capacity.getAttribute('data-toggle')).toBe('/#capacity')
    expect(allByRole(one(capacity, 'ul.capacity-entries'), 'listitem').map((entry) => text(entry))).toEqual([
      `0% on 14 Sep 2026 Holiday ${day?.effect?.words} Edit Remove`,
      `50% 21 Sep 2026 to 25 Sep 2026 Offsite ${span?.effect?.words} Edit Remove`,
      `300% from 5 Oct 2026 onward ${onward.effect?.words} Edit Remove ⚠ ${onward.warning}`,
    ])
  })

  test('folded, each entry’s line has no effect, as the forecast works effects out only for the open section', async () => {
    const { view, capacity } = await capacityOf([['0', '2026-09-14', '2026-09-14', { note: 'Holiday' }]], { open: false })
    capacity.setAttribute('open', '')

    expect(view.capacity.entries[0]?.effect).toBeUndefined()
    expect(text(byRole(capacity, 'listitem'))).toBe('0% on 14 Sep 2026 Holiday Edit Remove')
  })

  test('an entry’s Edit: the sentence as saved, posting its id, with Cancel back to the section open', async () => {
    const { view, capacity } = await capacityOf([['50', '2026-09-21', '2026-09-25', { note: 'Offsite' }]])
    const id = String(view.capacity.entries[0]?.id)
    const fold = around(byRole(capacity, 'button', { name: 'Edit' }), 'details')
    expect(fold.hasAttribute('open')).toBe(false)
    fold.setAttribute('open', '')
    const edit = around(byRole(fold, 'button', { name: 'Save' }), 'form')

    expect(edit.getAttribute('action')).toBe('/capacity/edit?capacity=open#capacity')
    expect(hiddenFields(edit)).toEqual([['id', id]])
    expect(
      all(edit, 'input:not([type="hidden"])').map((field) => [
        field.getAttribute('name'),
        field.getAttribute('type') === 'checkbox' ? field.hasAttribute('checked') : field.getAttribute('value'),
      ]),
    ).toEqual([
      ['percent', '50'],
      ['from', '2026-09-21'],
      ['to', '2026-09-25'],
      ['onward', false],
      ['note', 'Offsite'],
    ])
    expect(byRole(fold, 'link', { name: 'Cancel' }).getAttribute('href')).toBe('/?capacity=open#capacity')
    expect(hiddenFields(around(byRole(capacity, 'button', { name: 'Remove' }), 'form'))).toEqual([['id', id]])
  })

  test('an edit refused: its Edit open, why beside the sentence as typed', async () => {
    const { team, view } = await capacityOf([['50', '2026-09-21', '2026-09-25']])
    const id = String(view.capacity.entries[0]?.id)
    const { view: refused } = outcomeOf(
      await submitInputs(team, { kind: 'editCapacity', id, percent: '5000', from: '2026-09-21', to: '', onward: true, note: 'Typed' }, { capacityOpen: true }),
      'refusedOnForecast',
    )
    const fold = one(drawn(refused), '#capacity details.edit')

    expect(fold.hasAttribute('open')).toBe(true)
    expect(text(byRole(fold, 'alert'))).toBe(forecast(refused).capacity.editing?.refusal)
    expect(byRole(fold, 'spinbutton').getAttribute('value')).toBe('5000')
    expect(byRole(fold, 'checkbox', { name: 'or onward' }).hasAttribute('checked')).toBe(true)
    expect(byRole(fold, 'textbox', { name: 'Why' }).getAttribute('value')).toBe('Typed')
  })

  test('switched off: the switch unchecked, posting to switch it on, and the forecast said to use pace alone', async () => {
    const { team } = await capacityOf([['50', '2026-09-21', '2026-09-25']])
    await submitInputs(team, { kind: 'switchCapacity', on: false }, { capacityOpen: true })
    const capacity = one(drawn(forecast(await team.milestoneForecastView({ capacityOpen: true }))), '#capacity')
    const toggle = byRole(capacity, 'switch', { name: 'Use capacity in this forecast' })

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(postsTo(toggle)).toBe('/capacity/switch?capacity=open#capacity')
    expect(hiddenFields(around(toggle, 'form'))).toEqual([['on', 'true']])
    expect(text(capacity)).toContain('Off: the forecast uses pace alone. Entries are kept, and still count for the next milestone.')
  })
})

describe('the Capacity section against the pace', () => {
  /** 20 tickets from 2 Nov at four typed counts (or a pace range), lasting at 80% from `from`, on 11 Nov 2026. */
  async function lasting(from: string, { range = false } = {}) {
    const team = await newTeam(DEFAULT_SETTINGS, '2026-11-11')
    await submitInputs(team, { kind: 'setMilestone', name: 'Launch', startDate: '2026-11-02', ticketsRemaining: '20' })
    if (range) await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '5' })
    else {
      await submitInputs(team, { kind: 'setPaceCounts', counts: '4, 5, 4, 5' })
      await submitInputs(team, { kind: 'setPaceMode', paceMode: 'counts' })
    }
    await add(team, '80', from, '', { onward: true, note: 'Two left' })
    const view = forecast(await team.milestoneForecastView({ capacityOpen: true }))
    return { team, view, id: String(view.capacity.entries[0]?.id), entry: byRole(one(drawn(view), '#capacity'), 'listitem') }
  }

  test('while counting: how many of the weeks the pace comes from are after the change', async () => {
    const { entry } = await lasting('2026-10-19')

    expect(text(entry)).toContain(
      '3 of the 4 weeks the pace comes from are after the change. Past counts aren’t adjusted. When all of them are, you’ll be asked whether it’s the new usual.',
    )
  })

  test('proposed: whether to make it the new usual, or keep it, each posting its id', async () => {
    const { id, entry } = await lasting('2026-10-12')

    expect(text(one(entry, '.proposal'))).toBe(
      'Every week the pace comes from starts on or after 12 Oct 2026, so it already shows the team at 80%. Make it the new usual? The change then ends, so it isn’t counted twice. Make it the new usual Keep it',
    )
    for (const [button, path] of [
      ['Make it the new usual', '/capacity/new-usual?capacity=open#capacity'],
      ['Keep it', '/capacity/keep?capacity=open#capacity'],
    ] as const) {
      expect(postsTo(byRole(entry, 'button', { name: button }))).toBe(path)
      expect(hiddenFields(around(byRole(entry, 'button', { name: button }), 'form'))).toEqual([['id', id]])
    }
  })

  test('with a pace range: End it today, for the EM to end it once the range reflects it', async () => {
    const { id, entry } = await lasting('2026-10-12', { range: true })

    expect(text(entry)).toContain('With a pace range, end this yourself once the range reflects it. End it today')
    expect(postsTo(byRole(entry, 'button', { name: 'End it today' }))).toBe('/capacity/end-today?capacity=open#capacity')
    expect(hiddenFields(around(byRole(entry, 'button', { name: 'End it today' }), 'form'))).toEqual([['id', id]])
  })

  test('accepted: folded under Past, said as the new usual from today, only its note to edit, and no Remove', async () => {
    const { team, id } = await lasting('2026-10-12')
    await submitInputs(team, { kind: 'acceptNewUsual', id }, { capacityOpen: true })
    const capacity = one(drawn(forecast(await team.milestoneForecastView({ capacityOpen: true }))), '#capacity')
    const past = around(byRole(capacity, 'button', { name: /^Past/ }), 'details')

    expect(text(one(past, 'summary'))).toBe('Past (1) · kept, not used by the forecast')
    expect(past.hasAttribute('open')).toBe(false)
    past.setAttribute('open', '')
    expect(text(byRole(past, 'listitem'))).toBe('80% 12 Oct 2026 to 11 Nov 2026 · new usual from 11 Nov 2026 Two left Edit')
    const fold = one(past, 'details.edit')
    fold.setAttribute('open', '')
    expect(text(fold)).toContain('Past, so only the note can change.')
    expect(allByRole(fold, 'textbox').map((field) => [accessibleName(field), field.getAttribute('value')])).toEqual([['Why', 'Two left']])
    expect(hasRole(fold, 'spinbutton')).toBe(false)
    expect(hasRole(past, 'button', { name: 'Remove' })).toBe(false)
  })
})
