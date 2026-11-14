import type { SetupEdit, SetupStep, SetupSteps, SetupSummary, SummaryFlag, SummaryRow } from '../forecast/setup.js'
import { COMPARABLE_WORK, MILESTONE_QUERY } from '../forecast/stepQuery.js'
import { escapeHtml } from './html.js'
import { COMPARABLE_WORK_STEP, inputsAt, MILESTONE_STEP } from './queryStepSection.js'

/** Where setup's own forms post: "Use these", Change (or Connect a tracker, once skipped), Cancel, and Skip on the Connect step. */
export const SETUP_PATHS = { useThese: '/inputs/setup/use-these', change: '/inputs/setup/change', cancel: '/inputs/setup/cancel', skip: '/inputs/setup/skip' } as const

/** Each form setup posts, by its action's path, and the edit it is: they send no fields of their own. */
export const SETUP_FORMS: ReadonlyMap<string, SetupEdit> = new Map<string, SetupEdit>([
  [SETUP_PATHS.useThese, { kind: 'useThese' }],
  [SETUP_PATHS.change, { kind: 'change' }],
  [SETUP_PATHS.cancel, { kind: 'cancel' }],
  [SETUP_PATHS.skip, { kind: 'skipConnecting' }],
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

/** The Check step: for now, "Use these", closing setup to its summary. */
export function checkStepHtml(): string {
  return `        <p class="note">Nothing picked here changes the inputs below or the forecast until you use these.</p>
        <form method="post" action="${SETUP_PATHS.useThese}">
          <button type="submit" class="primary">Use these</button>
        </form>`
}

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
