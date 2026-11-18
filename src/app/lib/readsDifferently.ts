import type { ReadsDifferently } from '../../forecast/milestoneInputs.js'
import { escapeHtml } from '../html.js'
import { formAction, type FormTarget } from './inputSection.js'

// Behind inputsScreen.ts: the chip on a typed value the tracker reads differently, which the Milestone and Pace
// sections each show beside their value, each with its own Chip.

/**
 * A chip: what its forms are ids from, which value's reading it opens, and its Follow: the fields posted to the
 * section's own form (`follow`) switching the value back to the tracker.
 */
export interface Chip {
  id: string
  reading: 'ticketsRemaining' | 'pace'
  follow: FormTarget & { fields: Record<string, string> }
}

/**
 * The chip on a typed value the tracker reads differently: "GitHub reads differently", with a dot while its latest
 * read is unopened. Opened, it shows the `reading` and offers Follow, which posts the form switching the value back to
 * the tracker; the page's script posts that it was opened, clearing the dot. Its forms can't sit inside it, as the chip
 * is inside the form the value is in and forms don't nest: so the section shows `chipForms` of the same chip, outside
 * that form, whenever the tracker reads the value differently; the chip's button posts them by their ids.
 */
export function chip({ id, reading }: Chip, tracker: string, { unseen }: ReadsDifferently, body: string): string {
  const opens = unseen ? ` data-opens="open-${id}-reading"` : ''
  const dot = unseen ? '<span class="dot" title="A read you haven’t opened"></span>' : ''
  return `<details class="reads-differently"${opens} data-reading="${reading}">
                <summary>${dot}${escapeHtml(tracker)} reads differently</summary>
                <div class="reads-differently-panel">
                  ${body}
                  <div class="reads-differently-actions"><button type="submit" form="follow-${id}" class="primary">Follow ${escapeHtml(tracker)}</button></div>
                </div>
              </details>`
}

/**
 * A chip's forms, outside the form its value is in, when the tracker reads the value differently: its Follow; and
 * opening its reading, which the page's script posts. Nothing otherwise, as the section then shows no chip.
 */
export function chipForms({ id, reading, follow }: Chip, readsDifferently: ReadsDifferently | undefined): string {
  if (!readsDifferently) return ''
  const hidden = Object.entries(follow.fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('')
  return `
        <form method="post" action="${formAction(follow)}" id="follow-${id}">
          ${hidden}
        </form>
        <form method="post" action="/inputs/reading-opened" id="open-${id}-reading">
          <input type="hidden" name="reading" value="${reading}">
        </form>`
}
