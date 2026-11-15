import type { PaceCheck, SetupCheck, SetupEdit, SetupSteps, TicketsCheck } from '../forecast/setup.js'
import { SETUP_STEPS, type SetupStep } from '../forecast/setupSteps.js'
import type { SetupSummary, SummaryFlag, SummaryRow } from '../forecast/setupSummary.js'
import { PACE_MODES, type PaceMode } from '../model/milestoneInputs.js'
import { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from '../forecast/stepQuery.js'
import { escapeHtml } from './html.js'

/**
 * Where setup's own forms post: "Use these", Change (or Connect a tracker, once skipped), Change from a refused
 * token's flag, which opens the Connect step (`changeConnection`), Cancel, Skip on the Connect step, Read again, and a
 * source chosen at Check.
 */
export const SETUP_PATHS = {
  useThese: '/inputs/setup/use-these',
  change: '/inputs/setup/change',
  changeConnection: '/inputs/setup/change-connection',
  cancel: '/inputs/setup/cancel',
  skip: '/inputs/setup/skip',
  readAgain: '/inputs/setup/read-again',
  source: '/inputs/setup/source',
} as const

/**
 * Each form setup posts, by its action's path, and the edit it is, read from its fields; none for a source Check
 * doesn't name, the only form sending any. Read again reads the tracker, so it is routed apart.
 */
export const SETUP_FORMS: ReadonlyMap<string, (body: URLSearchParams) => SetupEdit | undefined> = new Map<string, (body: URLSearchParams) => SetupEdit | undefined>([
  [SETUP_PATHS.useThese, () => ({ kind: 'useThese' })],
  [SETUP_PATHS.change, () => ({ kind: 'change' })],
  [SETUP_PATHS.changeConnection, () => ({ kind: 'change', at: 'connect' })],
  [SETUP_PATHS.cancel, () => ({ kind: 'cancel' })],
  [SETUP_PATHS.skip, () => ({ kind: 'skipConnecting' })],
  [SETUP_PATHS.source, (body) => chosenSourceOf(body.get('value'), body.get('source'))],
])

/** A source chosen at Check, as its form sends it: tickets remaining's, the tracker or typed; or pace's, the tracker, range or counts. */
function chosenSourceOf(value: string | null, source: string | null): SetupEdit | undefined {
  if (value === 'ticketsRemaining' && (source === 'tracker' || source === 'typed')) return { kind: 'chooseSource', value, source }
  const pace = PACE_MODES.find((mode) => mode === source)
  return value === 'pace' && pace ? { kind: 'chooseSource', value, source: pace } : undefined
}

/** The field naming the setup step the Inputs screen opens at: `/inputs?step=comparableWork`; Milestone, once connected, without it. */
export const STEP_FIELD = 'step'

/** Each setup step's section id on the Inputs screen. */
export const SETUP_STEP_IDS: Readonly<Record<SetupStep, string>> = { connect: 'connect', milestone: 'milestone-tickets', comparableWork: 'comparable-work', check: 'check' }

/** The Inputs screen opened at `step`, with `params` beside it, at the section `id`: `step=comparableWork`, but no step for Milestone, the default. */
export function inputsAt(step: SetupStep, id: string, ...params: string[]): string {
  const query = [step === 'milestone' ? '' : `${STEP_FIELD}=${step}`, ...params].filter((param) => param !== '').join('&')
  return `/inputs${query === '' ? '' : `?${query}`}#${id}`
}

/** Where each setup step is served, at its section: the Milestone step, once connected, at the Inputs screen's own URL. */
export const SETUP_STEP_PATHS = Object.fromEntries(SETUP_STEPS.map((step) => [step, inputsAt(step, SETUP_STEP_IDS[step])])) as Readonly<Record<SetupStep, string>>

/** Each setup step's name, in the steps' list. */
const STEP_NAMES: Readonly<Record<SetupStep, string>> = { connect: 'Connect', milestone: 'Milestone', comparableWork: 'Comparable work', check: 'Check' }

/** The Check step's name and hint, in its section's label column. */
export const CHECK_STEP = { id: SETUP_STEP_IDS.check, title: 'Check', hint: 'Check what the tracker gives, then use it.' } as const

/**
 * The setup step shown, as `body` within it: the steps' list above, each done step a link back to it and the current
 * one marked; then the step; then Cancel, or why the steps can't be cancelled once they changed the connection; Back;
 * and Next (or Skip) where the step can be left forward yet.
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
  const cancel =
    view.noCancel === undefined ? `<form method="post" action="${SETUP_PATHS.cancel}">\n            <button type="submit">Cancel</button>\n          </form>` : ''
  const noCancel = view.noCancel === undefined ? '' : `\n        <p class="note">${escapeHtml(view.noCancel)}</p>`
  const nav = `${noCancel}\n        <div class="actions setup-nav">${cancel}${back}${next}</div>`
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
  const use = sourceFormHtml('ticketsRemaining', 'Where tickets remaining comes from', ['tracker', 'typed'], source, (each) => (each === 'tracker' ? tracker : 'Typed'))
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
function paceRowHtml(tracker: string, { yours, period, reading, incomplete, noStartDate, source, choices }: PaceCheck): string {
  const own = yours.source === 'counts' ? countsHtml(yours.counts) : yours.range === undefined ? '—' : `${yours.range.low}–${yours.range.high} a ${period}`
  const read = reading
    ? `${countsHtml(reading.counts)} <span class="muted">${escapeHtml(reading.line)}</span>`
    : incomplete
      ? `<span class="note warn">None: ${partOf(tracker)}</span>`
      : noStartDate
        ? `<span class="note">None yet: pace counts ${escapeHtml(tracker)}’s ${period}s from the milestone’s start date, entered below.</span>`
        : '—'
  const use = sourceFormHtml('pace', 'Pace the forecast uses', choices, source, (each) => (each === 'tracker' ? tracker : PACE_NAMES[each]))
  return `            <tr>
              <th scope="row">Pace</th>
              <td>${own}</td>
              <td>${read}</td>
              <td>${use}</td>
            </tr>`
}

/** Pace's counts, a period each: "4, 6, 5", or "—" for none. */
const countsHtml = (counts: readonly number[]): string => (counts.length === 0 ? '—' : counts.join(', '))

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
 * Setup done, above the inputs: the tracker, the repo or project, and when the milestone was read, with Read again,
 * and Change to open the steps again; the Milestone row, and the Comparable row when there is comparable work, each
 * naming its picks with their kinds or showing the query written by hand; once beneath them, a note where a row's
 * counts wait for Check; the leaf-and-epics line; and beneath, only problem flags.
 */
export function setupSummaryHtml({ tracker, where, readOn, milestone, comparable, countsWait, note, flags }: SetupSummary): string {
  const read = readOn === undefined ? '' : `\n        <span class="read">read ${escapeHtml(readOn)}</span>`
  const rows = [rowHtml('Milestone', milestone), ...(comparable ? [rowHtml('Comparable', comparable)] : [])].join('\n')
  return summaryBoxHtml(`      <div class="setup-head">
        <span class="ok-dot" aria-hidden="true"></span>
        <span>${escapeHtml(tracker)} · <b>${escapeHtml(where)}</b></span>${read}
        <form method="post" action="${SETUP_PATHS.readAgain}">
          <button type="submit" class="linkish">Read again</button>
        </form>
        ${changeHtml(SETUP_PATHS.change, 'Change')}
      </div>
      <dl class="setup-rows">
${rows}
      </dl>${countsWait === undefined ? '' : `\n      <p class="note muted">${escapeHtml(countsWait)}</p>`}
      <p class="note">${escapeHtml(note)}</p>${flags.map(flagHtml).join('')}`)
}

/** The box setup's summary sits in above the inputs, around `body`. */
function summaryBoxHtml(body: string): string {
  return `    <div class="setup-summary" id="setup-summary" aria-label="Tracker">
${body}
    </div>
`
}

/** A form opening setup's steps again, posting to `path`, with its button's `label`. */
function changeHtml(path: string, label: string): string {
  return `<form method="post" action="${path}">
          <button type="submit" class="linkish">${label}</button>
        </form>`
}

/** A summary row: its picks, each with its count where it has one, "Checkout v2 (epic) · 32, Search revamp (epic) · 7", or the query written by hand. */
function rowHtml(name: string, row: SummaryRow): string {
  const shown =
    'query' in row
      ? `<code>${escapeHtml(row.query)}</code>`
      : row.picks.map((pick) => `${escapeHtml(pick.name)} <span class="kind">(${escapeHtml(pick.kind)})</span>${pick.count === undefined ? '' : ` · ${pick.count}`}`).join(', ')
  return `        <dt>${name}</dt>
        <dd>${shown}</dd>`
}

/** Each query flagged, named as its step names it. */
const FLAGGED_QUERY: Readonly<Record<StepQuery['kind'], string>> = { milestoneQuery: MILESTONE_QUERY.name, comparableWork: COMPARABLE_WORK.name }

/**
 * A problem flag beneath the summary: "⚠ Milestone query: This query matches nothing…", or, of a read failing as a
 * whole, its reason alone; a refused token's with Change, opening the Connect step.
 */
function flagHtml({ of, flag, change }: SummaryFlag): string {
  const text = `⚠ ${of === undefined ? '' : `${FLAGGED_QUERY[of]}: `}${escapeHtml(flag)}`
  if (change === undefined) return `\n      <p class="note warn flag">${text}</p>`
  return `\n      <div class="note warn flag">${text}
        ${changeHtml(SETUP_PATHS.changeConnection, 'Change')}
      </div>`
}

/** Connecting skipped: the inputs typed, as the MVP has them, with a way to connect a tracker after all; above the inputs. */
export function setupSkippedHtml(): string {
  return summaryBoxHtml(`      <span class="muted">No tracker connected.</span>
      ${changeHtml(SETUP_PATHS.change, 'Connect a tracker')}`)
}
