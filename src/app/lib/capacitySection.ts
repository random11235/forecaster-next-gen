import { MAX_CAPACITY_PERCENT, type CapacityEntryView, type CapacityForm, type CapacityView, type EntryEffect } from '../../forecast/capacity.js'
import type { PeriodName } from '../../forecast/cadence.js'
import { counted } from '../../forecast/counted.js'
import type { CapacityEntry } from '../../model/capacity.js'
import { escapeHtml, formatDate } from '../html.js'

// The Milestone forecast screen's Capacity section, under the pace: its entries, the sentence to add one, and the forms
// it posts, which keep it open.

/** The query that shows the Milestone forecast with its Capacity section open, where each entry gives its effect. */
export const CAPACITY_OPEN = { name: 'capacity', value: 'open' } as const
/** The query a capacity form carries, so the screen it goes to shows the section open again. */
const KEEP_OPEN = `?${CAPACITY_OPEN.name}=${CAPACITY_OPEN.value}`
export const CAPACITY_OPEN_PATH = `/${KEEP_OPEN}`

/** A capacity sentence's fields, as the add and edit forms name them. */
export function capacitySentence(body: URLSearchParams): CapacityForm {
  return {
    percent: body.get('percent') ?? '',
    from: body.get('from') ?? '',
    to: body.get('to') ?? '',
    onward: body.get('onward') !== null,
    note: body.get('note') ?? '',
  }
}

/**
 * The team's capacity, folded under the pace: its entries, earliest first, each with any warning, its effect when the
 * section is open, and a way to edit or remove it; a sentence to type another; and the folded Past. Open when the EM
 * opened it, or when a form just submitted from it was refused, so why shows beside it. Its forms keep it open;
 * toggling it goes to the screen with it so.
 */
export function renderCapacity({ on, open, summary, entries, past, form, refusal, editing }: CapacityView, period: PeriodName): string {
  const listed =
    entries.length === 0
      ? `\n          <p class="note">Every ${period} is at 100%.</p>`
      : `\n          <ul class="capacity-entries">${entries.map((entry) => renderEntry(entry, editing, period)).join('')}\n          </ul>`
  const error = refusal ? `\n            <p class="error" role="alert">${escapeHtml(refusal)}</p>` : ''
  return `
        <details class="capacity" id="capacity" data-toggle="${open ? '/' : CAPACITY_OPEN_PATH}#capacity"${open ? ' open' : ''}>
          <summary><span class="title">Capacity</span> <span class="summary">${summary}</span></summary>${renderSwitch(on)}
          <p class="note"><strong>100%</strong> = the team’s usual ${period}, as in the pace.</p>${listed}
          <form method="post" action="/capacity/add${KEEP_OPEN}#capacity" class="sentence">${error}
            The team is at ${sentenceFields(form)}.
            <button type="submit">Add</button>
          </form>
          <p class="note">Capacity scales pace in proportion: a 60% ${period} draws 60% of a usual ${period}’s pace. Weekends don’t count; overlapping entries multiply. Past counts aren’t adjusted.</p>${renderPast(past, editing)}
        </details>`
}

/** A capacity sentence's fields after "The team is at" (or "At"), filled with `form`. */
function sentenceFields(form: CapacityForm): string {
  return `<input type="number" name="percent" min="0" max="${MAX_CAPACITY_PERCENT}" step="1" value="${escapeHtml(form.percent)}" aria-label="Capacity, in % of usual" required>%
            from <input type="date" name="from" value="${escapeHtml(form.from)}" aria-label="From" required>
            to <input type="date" name="to" value="${escapeHtml(form.to)}" aria-label="To">
            <label><input type="checkbox" name="onward"${form.onward ? ' checked' : ''}> or onward</label>,
            for <input type="text" name="note" value="${escapeHtml(form.note)}" placeholder="leave, an incident…" aria-label="Why">`
}

/** The switch: off, the forecast uses pace alone, and the entries are kept for the next milestone. */
function renderSwitch(on: boolean): string {
  const off = on ? '' : '\n          <p class="note">Off: the forecast uses pace alone. Entries are kept, and still count for the next milestone.</p>'
  return `
          <form method="post" action="/capacity/switch${KEEP_OPEN}#capacity"><input type="hidden" name="on" value="${!on}"><button type="submit" class="switch" role="switch" aria-checked="${on}">Use capacity in this forecast</button></form>${off}`
}

/**
 * An entry as one line: "0% 7 Sep 2026 to 11 Sep 2026 Offsite", "0% on 14 Sep 2026", "60% from 5 Oct 2026 onward", or
 * "80% 22 Sep 2026 to 24 Oct 2026 · new usual from 24 Oct 2026".
 */
function entryLine({ from, to, percent, note, newUsualOn }: CapacityEntry, effect?: EntryEffect): string {
  const dates = to === undefined ? `from ${formatDate(from)} onward` : to === from ? `on ${formatDate(from)}` : `${formatDate(from)} to ${formatDate(to)}`
  const span = newUsualOn === undefined ? dates : `${dates} · new usual from ${formatDate(newUsualOn)}`
  const why = note === '' ? '' : ` <span class="why">${escapeHtml(note)}</span>`
  const moved = effect === undefined ? '' : ` <span class="effect${effectClass(effect.shift)}">${effect.words}</span>`
  return `<span><strong>${percent}%</strong> ${span}${why}${moved}</span>`
}

/** An effect coloured by which way it moves the 85% date: later is a risk; no change, or past the horizon, is plain. */
function effectClass(shift: number | null): string {
  return shift === null || shift === 0 ? '' : shift > 0 ? ' later' : ' sooner'
}

/**
 * An entry the forecast uses: its line and effect, its Edit holding the sentence as saved (or as typed, refused), and
 * Remove; then any warning, and for a lasting one, how far the pace has caught up with it.
 */
function renderEntry(entry: CapacityEntryView, editing: CapacityView['editing'], period: PeriodName): string {
  const refused = editing?.id === entry.id ? editing : undefined
  const form = refused?.form ?? { percent: String(entry.percent), from: entry.from, to: entry.to ?? '', onward: entry.to === undefined, note: entry.note }
  const warned = entry.warning === undefined ? '' : `\n              <p class="warning">⚠ ${escapeHtml(entry.warning)}</p>`
  return `
            <li>
              ${entryLine(entry, entry.effect)}
              ${editFold(entry.id, refused?.refusal, `At ${sentenceFields(form)}.`)}
              <form method="post" action="/capacity/remove${KEEP_OPEN}#capacity"><input type="hidden" name="id" value="${entry.id}"><button type="submit" class="link">Remove</button></form>${warned}${renderNewUsual(entry, period)}
            </li>`
}

/**
 * A lasting entry against the pace: how many of the periods the pace comes from are after it; once all are, the
 * proposal to make it the new usual, or keep it; with a pace range, End it today.
 */
function renderNewUsual({ id, from, percent, newUsual }: CapacityEntryView, period: PeriodName): string {
  if (newUsual === undefined) return ''
  const button = (path: string, label: string, kind = ''): string =>
    `<form method="post" action="${path}${KEEP_OPEN}#capacity"><input type="hidden" name="id" value="${id}"><button type="submit"${kind}>${label}</button></form>`
  switch (newUsual.kind) {
    case 'counting':
      return `
              <p class="note">${newUsual.after} of the ${counted(newUsual.of, period)} the pace comes from are after the change. Past counts aren’t adjusted. When all of them are, you’ll be asked whether it’s the new usual.</p>`
    case 'proposed':
      return `
              <div class="proposal">
                <p>Every ${period} the pace comes from starts on or after ${formatDate(from)}, so it already shows the team at ${percent}%. Make it the <strong>new usual</strong>? The change then ends, so it isn’t counted twice.</p>
                ${button('/capacity/new-usual', 'Make it the new usual')}
                ${button('/capacity/keep', 'Keep it', ' class="link"')}
              </div>`
    case 'endToday':
      return `
              <p class="note">With a pace range, end this yourself once the range reflects it. ${button('/capacity/end-today', 'End it today', ' class="link"')}</p>`
  }
}

/** Entries that have ended, folded: kept, not used by the forecast, each with only its note to edit and no Remove. */
function renderPast(past: readonly CapacityEntry[], editing: CapacityView['editing']): string {
  if (past.length === 0) return ''
  const open = past.some(({ id }) => id === editing?.id)
  const lines = past.map((entry) => {
    const refused = editing?.id === entry.id ? editing : undefined
    const note = refused?.form.note ?? entry.note
    return `
              <li>
                ${entryLine(entry)}
                ${editFold(
                  entry.id,
                  refused?.refusal,
                  `Past, so only the note can change.
            <label>Note <input type="text" name="note" value="${escapeHtml(note)}" aria-label="Why"></label>`,
                )}
              </li>`
  })
  return `
          <details class="capacity-past"${open ? ' open' : ''}>
            <summary>Past (${past.length}) · kept, not used by the forecast</summary>
            <ul class="capacity-entries">${lines.join('')}
            </ul>
          </details>`
}

/** An entry's Edit, folded: `fields` to change, with Save, and Cancel back to the forecast, the section open. Open, saying why, when refused. */
function editFold(id: number, refusal: string | undefined, fields: string): string {
  const error = refusal === undefined ? '' : `\n            <p class="error" role="alert">${escapeHtml(refusal)}</p>`
  return `<details class="edit"${refusal === undefined ? '' : ' open'}>
            <summary class="link">Edit</summary>
            <form method="post" action="/capacity/edit${KEEP_OPEN}#capacity" class="sentence">${error}
            <input type="hidden" name="id" value="${id}">
            ${fields}
            <span class="actions"><button type="submit">Save</button> <a href="${CAPACITY_OPEN_PATH}#capacity">Cancel</a></span>
            </form>
          </details>`
}
