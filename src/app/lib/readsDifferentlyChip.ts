import type { ReadsDifferently } from '../../forecast/milestoneInputs.js'
import { escapeHtml } from '../html.js'

/** A chip: what its forms are ids from, and which value's reading it opens. */
export interface Chip {
  id: string
  reading: 'ticketsRemaining' | 'pace'
}

export const TICKETS_CHIP: Chip = { id: 'tickets', reading: 'ticketsRemaining' }
export const PACE_CHIP: Chip = { id: 'pace', reading: 'pace' }

/**
 * The chip on a typed value the tracker reads differently: "GitHub reads differently", with a dot while its latest
 * read is unopened. Opened, it shows the `reading` and offers Follow, which posts the form switching the value back to
 * the tracker; the page's script posts that it was opened, clearing the dot. Its forms sit outside the form the value
 * is in (`chipForms`), as forms don't nest.
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

/** A chip's forms: Follow, posting `fields` to `action`; and opening its reading, which the page's script posts. */
export function chipForms({ id, reading }: Chip, action: string, fields: Record<string, string>): string {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('')
  return `
        <form method="post" action="${action}" id="follow-${id}">
          ${hidden}
        </form>
        <form method="post" action="/inputs/reading-opened#${action.split('#')[1]}" id="open-${id}-reading">
          <input type="hidden" name="reading" value="${reading}">
        </form>`
}
