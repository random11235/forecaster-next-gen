import type { PaceCheck, SetupCheck, SetupEdit, SetupStep, SetupSteps, SetupSummary, SummaryFlag, SummaryRow, TicketsCheck } from '../forecast/setup.js'
import type { PaceMode } from '../model/milestoneInputs.js'
import { COMPARABLE_WORK, MILESTONE_QUERY } from '../forecast/stepQuery.js'
import { escapeHtml } from './html.js'
import { COMPARABLE_WORK_STEP, inputsAt, MILESTONE_STEP } from './queryStepSection.js'

/** Where setup's own forms post: "Use these", Change (or Connect a tracker, once skipped), Cancel, and Skip on the Connect step. */
export const SETUP_PATHS = {
  useThese: '/inputs/setup/use-these',
  change: '/inputs/setup/change',
  cancel: '/inputs/setup/cancel',
  skip: '/inputs/setup/skip',
  source: '/inputs/setup/source',
} as const

/** Each form setup posts, by its action's path, and the edit it is, read from its fields: only Check's sources send any. */
export const SETUP_FORMS: ReadonlyMap<string, (body: URLSearchParams) => SetupEdit> = new Map<string, (body: URLSearchParams) => SetupEdit>([
  [SETUP_PATHS.useThese, () => ({ kind: 'useThese' })],
  [SETUP_PATHS.change, () => ({ kind: 'change' })],
  [SETUP_PATHS.cancel, () => ({ kind: 'cancel' })],
  [SETUP_PATHS.skip, () => ({ kind: 'skipConnecting' })],
  [SETUP_PATHS.source, (body) => ({ kind: 'chooseSource', value: body.get('value') ?? '', source: body.get('source') ?? '' })],
])

/** Where each setup step is served: the Milestone step, once connected, at the Inputs screen's own URL. */
export const SETUP_STEP_PATHS: Readonly<Record<SetupStep, string>> = {
  connect: inputsAt('connect', 'connect'),
  milestone: MILESTONE_STEP.urls.finding,
  comparableWork: COMPARABLE_WORK_STEP.urls.finding,
  check: inputsAt('check', 'check'),
}

/** Each setup step's name, in the steps' list. */
const STEP_NAMES: Readonly<Record<SetupStep, string>> = { connect: 'Connect', milestone: 'Milestone', comparableWork: 'Comparable work', check: 'Check' }

/** The Check step's name and hint, in its section's label column. */
export const CHECK_STEP = { id: 'check', title: 'Check', hint: 'Check what the tracker gives, then use it.' } as const

/**
 * The setup step shown, as `body` within it: the steps' list above, each done step a link back to it and the current
 * one marked; then the step; then Cancel, once Change reopened the steps, Back, and Next (or Skip) where the step can
 * be left forward yet.
 */
export function setupStepHtml(view: SetupSteps, body: string): string {
  const steps = view.steps
    .map(({ step, mark }) =>
      mark === 'current'
        ? `          <li aria-current="step">${STEP_NAMES[step]}</li>`
        : mark === 'done'
          ? `          <li class="done"><a href="${escapeHtml(SETUP_STEP_PATHS[step])}">${STEP_NAMES[step]}</a></li>`
          : `          <li>${STEP_NAMES[step]}</li>`,
    )
    .join('\n')
  const back = view.back === undefined ? '' : `<a href="${escapeHtml(SETUP_STEP_PATHS[view.back])}" class="button">Back</a>`
  const next = view.next === undefined ? '' : `<a href="${escapeHtml(SETUP_STEP_PATHS[view.next.step])}" class="button primary">${view.next.label === 'skip' ? 'Skip' : 'Next'}</a>`
  const cancel = view.cancel ? `<form method="post" action="${SETUP_PATHS.cancel}">\n            <button type="submit">Cancel</button>\n          </form>` : ''
  const nav = cancel === '' && back === '' && next === '' ? '' : `\n        <div class="actions setup-nav">${cancel}${back}${next}</div>`
  return `        <ol class="setup-steps" aria-label="Setup steps">
${steps}
        </ol>
${body}${nav}`
}

/**
 * The Check step: a row for tickets remaining and one for pace, each with the EM's value now, the tracker's reading
 * from setup's reads, an incomplete read marked, and which source to use; then "Use these", closing setup to its
 * summary. Each choice posts as it changes (`CHECK_SCRIPT`), or with its Choose button without the script.
 */
export function checkStepHtml(check: SetupCheck | undefined): string {
  const table =
    check === undefined
      ? ''
      : `        <p class="muted">A value following ${escapeHtml(check.tracker)} updates on each read; typed or a range, it stays yours. Each is kept while the other is used.</p>
        <table class="check">
          <thead>
            <tr><th scope="col"></th><th scope="col">Yours now</th><th scope="col">From ${escapeHtml(check.tracker)}</th><th scope="col">Use</th></tr>
          </thead>
          <tbody>
${ticketsRowHtml(check.tracker, check.ticketsRemaining)}
${paceRowHtml(check.tracker, check.pace)}
          </tbody>
        </table>
`
  return `${table}        <p class="note">Nothing picked here changes the inputs below or the forecast until you use these.</p>
        <form method="post" action="${SETUP_PATHS.useThese}">
          <button type="submit" class="primary">Use these</button>
        </form>`
}

/** The tracker's partial read, marked on its row. */
const partOf = (tracker: string): string => `${escapeHtml(tracker)} gave only part of what the query matches`

/** Check's tickets remaining row. */
function ticketsRowHtml(tracker: string, { yours, reading, incomplete, source }: TicketsCheck): string {
  const read = reading === undefined ? '—' : `${reading}${incomplete ? ` <span class="note warn">${partOf(tracker)}</span>` : ''}`
  const use = source === undefined ? NOTHING_TO_CHOOSE : sourceFormHtml('ticketsRemaining', 'Where tickets remaining comes from', ['tracker', 'typed'], source, (each) => (each === 'tracker' ? tracker : 'Typed'))
  return `            <tr>
              <th scope="row">Tickets remaining</th>
              <td>${yours ?? '—'}</td>
              <td>${read}</td>
              <td>${use}</td>
            </tr>`
}

/** The names of pace's sources at Check, the tracker's aside. */
const PACE_NAMES: Readonly<Record<Exclude<PaceMode, 'tracker'>, string>> = { range: 'Range', counts: 'Typed counts' }

/** Check's pace row: the EM's range or typed counts, the tracker's counts with its line. */
function paceRowHtml(tracker: string, { yours, period, reading, incomplete, source, choices }: PaceCheck): string {
  const own = yours.source === 'counts' ? (yours.counts.length === 0 ? '—' : yours.counts.join(', ')) : yours.range === undefined ? '—' : `${yours.range.low}–${yours.range.high} a ${period}`
  const read = reading
    ? `${reading.counts.length === 0 ? '—' : reading.counts.join(', ')} <span class="muted">${escapeHtml(reading.line)}</span>`
    : incomplete
      ? `<span class="note warn">None: ${partOf(tracker)}</span>`
      : '—'
  const use = source === undefined ? NOTHING_TO_CHOOSE : sourceFormHtml('pace', 'Pace the forecast uses', choices, source, (each) => (each === 'tracker' ? tracker : PACE_NAMES[each]))
  return `            <tr>
              <th scope="row">Pace</th>
              <td>${own}</td>
              <td>${read}</td>
              <td>${use}</td>
            </tr>`
}

/** With no milestone entered yet, there is no source to choose. */
const NOTHING_TO_CHOOSE = '<span class="muted">Enter the milestone below to choose.</span>'

/** A value's sources at Check, as radios posting the one chosen, with a Choose button for a browser without the script. */
function sourceFormHtml<T extends string>(value: string, ariaLabel: string, sources: readonly T[], chosen: T, name: (source: T) => string): string {
  const radios = sources
    .map((source) => `<label><input type="radio" name="source" value="${source}"${source === chosen ? ' checked' : ''} required> ${escapeHtml(name(source))}</label>`)
    .join('\n                  ')
  return `<form method="post" action="${SETUP_PATHS.source}" class="source">
                <input type="hidden" name="value" value="${value}">
                <fieldset class="levels" aria-label="${ariaLabel}">
                  ${radios}
                </fieldset>
                <button type="submit" class="choose">Choose</button>
              </form>`
}

/**
 * Check's script: a source chosen posts at once, so its Choose button is hidden. It starts with `;`, so the script
 * before it, ending in a call, isn't taken to call it.
 */
export const CHECK_SCRIPT = `
;(() => {
  const check = document.getElementById('check')
  if (!check) return
  check.classList.add('chooses-as-changed')
  check.addEventListener('change', (event) => {
    const form = event.target.form
    if (form && form.classList.contains('source')) form.submit()
  })
})()
`

/**
 * Setup done, above the inputs: the tracker, the repo or project, and when the milestone was read, with Change to open
 * the steps again; the Milestone row, and the Comparable row when there is comparable work, each naming its picks with
 * their kinds or showing the query written by hand; the leaf-and-epics line; and beneath, only problem flags.
 */
export function setupSummaryHtml({ tracker, where, readOn, milestone, comparable, note, flags }: SetupSummary): string {
  const read = readOn === undefined ? '' : `\n        <span class="read">read ${escapeHtml(readOn)}</span>`
  const rows = [rowHtml('Milestone', milestone), ...(comparable ? [rowHtml('Comparable', comparable)] : [])].join('\n')
  return `    <div class="setup-summary" id="setup-summary" aria-label="Tracker">
      <div class="setup-head">
        <span class="ok-dot" aria-hidden="true"></span>
        <span>${escapeHtml(tracker)} · <b>${escapeHtml(where)}</b></span>${read}
        <form method="post" action="${SETUP_PATHS.change}">
          <button type="submit" class="linkish">Change</button>
        </form>
      </div>
      <dl class="setup-rows">
${rows}
      </dl>
      <p class="note">${escapeHtml(note)}</p>${flags.map(flagHtml).join('')}
    </div>
`
}

/** A summary row: its picks, "Checkout v2 (epic), Search revamp (epic)", or the query written by hand. */
function rowHtml(name: string, row: SummaryRow): string {
  const shown =
    'query' in row
      ? `<code>${escapeHtml(row.query)}</code>`
      : row.picks.map((pick) => `${escapeHtml(pick.name)} <span class="kind">(${escapeHtml(pick.kind)})</span>`).join(', ')
  return `        <dt>${name}</dt>
        <dd>${shown}</dd>`
}

/** Each query flagged, named as its step names it. */
const FLAGGED_QUERY: Readonly<Record<SummaryFlag['of'], string>> = { milestone: MILESTONE_QUERY.name, comparable: COMPARABLE_WORK.name }

/** A problem flag beneath the summary: "⚠ Milestone query: This query matches nothing…". */
function flagHtml({ of, flag }: SummaryFlag): string {
  return `\n      <p class="note warn flag">⚠ ${FLAGGED_QUERY[of]}: ${escapeHtml(flag)}</p>`
}

/** Connecting skipped: the inputs typed, as the MVP has them, with a way to connect a tracker after all; above the inputs. */
export function setupSkippedHtml(): string {
  return `    <div class="setup-summary" id="setup-summary" aria-label="Tracker">
      <span class="muted">No tracker connected.</span>
      <form method="post" action="${SETUP_PATHS.change}">
        <button type="submit" class="linkish">Connect a tracker</button>
      </form>
    </div>
`
}
