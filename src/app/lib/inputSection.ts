import type { InputsForm } from '../../forecast/inputs.js'
import type { InputNote, MilestoneInput } from '../../forecast/milestoneAssessment.js'
import { escapeHtml } from '../html.js'

// Behind inputsScreen.ts: a section of the Inputs screen, and the parts its sections share: the label each input goes
// by, its notes and errors, and radio buttons.

/** Each input of the milestone by its label on this screen, which notes about it are named by everywhere. */
export const INPUT_LABELS: Record<MilestoneInput, string> = {
  name: 'Name',
  startDate: 'Start date',
  ticketsRemaining: 'Tickets remaining',
  pace: 'Pace',
  typedCounts: 'Typed counts',
}

/** A section of the Inputs screen, given its number on the screen. */
export type Section = (number: number) => string

/**
 * A numbered section: its name and hint in the label column, `body` beside them. One that `postsOnSubmit` posts only when
 * its button is pressed; the others save each input as it changes (see `inputsScript.ts`).
 */
export function inputSection(label: string, name: string, hint: string, body: string, { postsOnSubmit = false, id = label.toLowerCase() } = {}): Section {
  return (number) => `    <section class="input${postsOnSubmit ? ' submits' : ''}" id="${id}" aria-label="${label}">
      <div class="label">
        <span class="number">${String(number).padStart(2, '0')}</span>
        <h2>${name}</h2>
        <p>${hint}</p>
      </div>
      <div class="body">
${body}
      </div>
    </section>`
}

/** The notes about one input, shown beside it. */
export function notesFor(input: MilestoneInput, notes: readonly InputNote[]): string {
  return notes
    .filter((note) => note.input === input)
    .map((note) => `\n            <p class="warning">⚠ ${escapeHtml(note.message)}</p>`)
    .join('')
}

/** Why the form was refused, when the refusal was the form's; nothing when it wasn't. */
export type FormError = (form: InputsForm) => string | undefined

/** A refusal's error, said where the form is; nothing without one. */
export function errorLine(error: string | undefined): string {
  return error ? `\n          <p class="error" role="alert">${escapeHtml(error)}</p>` : ''
}

/**
 * One of `options` to choose, as radio buttons named `name` with the chosen one checked; `label` is each one's HTML.
 * They post the form they are in, or the one whose id is `form`.
 */
export function radios<T extends string>(
  name: string,
  ariaLabel: string,
  options: readonly T[],
  chosen: T,
  label: (option: T) => string,
  { form }: { form?: string } = {},
): string {
  const owner = form === undefined ? '' : ` form="${form}"`
  const buttons = options.map(
    (option) =>
      `            <label><input type="radio" name="${name}" value="${option}"${option === chosen ? ' checked' : ''}${owner} required> ${label(option)}</label>`,
  )
  return `          <fieldset class="levels" aria-label="${ariaLabel}">
${buttons.join('\n')}
          </fieldset>`
}
