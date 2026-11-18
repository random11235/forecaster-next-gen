import type { ReadsDifferently } from '../../forecast/milestoneInputs.js'
import { escapeHtml } from '../html.js'

// Behind inputsScreen.ts: what the Inputs screen shows of a tracker's read beside a value it reads, the mark of a read
// that was part of what its query matched, and the chip on a typed value the tracker reads differently.

/** A value's mark when the read it is from was part of what its query matched; nothing when whole. */
export function incompleteMark(incomplete: boolean): string {
  return incomplete ? ' <span class="incomplete">incomplete</span>' : ''
}

/**
 * A chip: what its forms are ids from, which value's reading it opens, and its Follow: the fields posted to `path`
 * switching the value back to the tracker, and the section (`anchor`) the answer opens at.
 */
export interface Chip {
  id: string
  reading: 'ticketsRemaining' | 'pace'
  follow: { path: string; anchor: string; fields: Record<string, string> }
}

export const TICKETS_CHIP: Chip = {
  id: 'tickets',
  reading: 'ticketsRemaining',
  follow: { path: '/inputs/tickets-source', anchor: 'milestone', fields: { ticketsSource: 'tracker' } },
}
export const PACE_CHIP: Chip = { id: 'pace', reading: 'pace', follow: { path: '/inputs/pace-mode', anchor: 'pace', fields: { paceMode: 'tracker' } } }

/**
 * The chip on a typed value the tracker reads differently: "GitHub reads differently", with a dot while its latest
 * read is unopened. Opened, it shows the `reading` and offers Follow, which posts the form switching the value back to
 * the tracker; the page's script posts that it was opened, clearing the dot. Its forms sit outside the form the value
 * is in, as forms don't nest: the section shows `chipForms` of the same chip, whenever the tracker reads it differently.
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

/** A chip's forms, when the tracker reads its value differently: its Follow; and opening its reading, which the page's script posts. */
export function chipForms({ id, reading, follow }: Chip, readsDifferently: ReadsDifferently | undefined): string {
  if (!readsDifferently) return ''
  const hidden = Object.entries(follow.fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('')
  return `
        <form method="post" action="${follow.path}#${follow.anchor}" id="follow-${id}">
          ${hidden}
        </form>
        <form method="post" action="/inputs/reading-opened#${follow.anchor}" id="open-${id}-reading">
          <input type="hidden" name="reading" value="${reading}">
        </form>`
}
