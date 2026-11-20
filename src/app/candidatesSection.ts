import type { Choice } from '../connectors/connector.js'
import {
  FEW_CANDIDATES,
  type Candidate,
  type CandidateGroupKind,
  type CandidateOpening,
  type Candidates,
  type PaceVersus,
  type PeriodName,
} from '../forecast/index.js'
import { dayMonth } from './html.js'
import { escapeHtml } from './html.js'
import { CHOICE_FIELDS, type StepSection } from './queryStepSection.js'

/**
 * Candidates for comparable work (#205), as the Comparable work step shows them: below its picker, those read in this
 * opening of the step, grouped. A candidate is read when the EM opens it (its link beside it in the lists) or narrows
 * the lists to a few by typing; the page's script asks for them at `CANDIDATES_PATH`, in the step's opening.
 */

/** Where the step's script asks for the candidates opened: the opening (`OPENING_FIELD`) and each choice's `CHOICE_FIELDS`. */
export const CANDIDATES_PATH = '/inputs/comparable-work-candidates'

/** The field naming the opening the script asks in. */
export const OPENING_FIELD = 'opening'

/** The openings kept, the latest last; past this, the oldest is dropped, and asking in it starts one afresh. */
const OPENINGS_KEPT = 32

const openings = new Map<string, CandidateOpening>()

/** A new opening of the candidates, kept under the id it gives, for the page's script to ask in. */
export function keepOpening(opening: CandidateOpening): string {
  const id = crypto.randomUUID()
  kept(id, opening)
  return id
}

/** The opening kept under `id`; one made afresh, kept under it, when it was dropped or never made. */
export async function openingKept(id: string, open: () => Promise<CandidateOpening>): Promise<CandidateOpening> {
  return openings.get(id) ?? kept(id, await open())
}

/** Keeps `opening` under `id`, dropping the oldest past `OPENINGS_KEPT`. */
function kept(id: string, opening: CandidateOpening): CandidateOpening {
  openings.set(id, opening)
  const oldest = openings.keys().next()
  if (openings.size > OPENINGS_KEPT && !oldest.done) openings.delete(oldest.value)
  return opening
}

const GROUP_TITLES: Record<CandidateGroupKind, string> = {
  slower: 'Slower than the milestone',
  aboutTheSame: 'About the same',
  faster: 'Faster than the milestone',
  byMedian: 'By median',
  nothingFinished: 'Nothing finished',
  readFailed: 'Couldn’t be read',
}

/** The candidates read in the step's `opening`, grouped, each with a form adding it to comparable work. */
export function candidatesHtml(candidates: Candidates, opening: string, section: StepSection): string {
  const { period } = candidates
  const note =
    candidates.groups.length === 0
      ? `Open a candidate (its <b>pace</b> link), or type to narrow the list to ${FEW_CANDIDATES} or fewer, to see how it runs against the milestone’s own.`
      : candidates.milestoneOwn === undefined
        ? `The milestone has too few ${period}s of its own to compare, so candidates are listed by median.`
        : `Against the milestone’s own so far: ${number(candidates.milestoneOwn)} a ${period}.`
  const groups = candidates.groups
    .map(
      ({ group, candidates: members }) => `              <div class="group ${group}">
                <h4>${GROUP_TITLES[group]}${group === 'byMedian' ? ` a ${period}` : ''}</h4>
                <ul>
${members.map((candidate) => candidateHtml(candidate, candidates, section)).join('\n')}
                </ul>
              </div>`,
    )
    .join('\n')
  return `
          <div class="candidates" data-opening="${escapeHtml(opening)}" data-path="${CANDIDATES_PATH}" data-few="${FEW_CANDIDATES}" data-pause-ms="${NARROWED_DEBOUNCE_MS}">
            <h3>Candidates</h3>
            <p class="note">${note}</p>${groups === '' ? '' : `\n            <div class="groups">\n${groups}\n            </div>`}
          </div>`
}

function candidateHtml(candidate: Candidate, { period, kindNames }: Candidates, { paths, id }: StepSection): string {
  const { choice } = candidate
  const add = `<form method="post" action="${paths.add}#${id}"><input type="hidden" name="${CHOICE_FIELDS.kind}" value="${escapeHtml(choice.kind)}"><input type="hidden" name="${CHOICE_FIELDS.name}" value="${escapeHtml(choice.name)}"><input type="hidden" name="${CHOICE_FIELDS.query}" value="${escapeHtml(choice.query)}"><button type="submit">${escapeHtml(choice.name)} <span class="kind">${escapeHtml(kindNames[choice.kind])}</span></button></form>`
  const own = candidate.thisMilestone ? ' <span class="this">this milestone: counts its own too</span>' : ''
  const data = (fields: Record<string, string>): string =>
    Object.entries(fields)
      .map(([field, value]) => ` data-${field}="${escapeHtml(value)}"`)
      .join('')
  const shown = data({ kind: choice.kind, name: choice.name, query: choice.query })
  if (!('read' in candidate)) {
    return `                  <li${shown}>${add}${own}<p class="error">${escapeHtml(candidate.failure)}</p></li>`
  }
  const { read } = candidate
  const facts = [
    `${read.finished} finished`,
    ...(read.adds === undefined ? [] : [`adds ${read.adds}`]),
    read.lastFinished === undefined ? `none finished in the last ${read.weeks} weeks` : `last finished ${dayMonth(read.lastFinished)}`,
    `${read.open} open`,
  ]
  const pace = read.finished === 0 ? '' : ` <span class="pace">${number(read.median)} a ${period}${versusHtml(read.versus, period)}</span>`
  return `                  <li${shown}>${add} ${stripHtml(read.strip.counts, read.strip.starts, period)}${pace}${own}
                    <p class="facts">${facts.join(' · ')}</p></li>`
}

function versusHtml(versus: PaceVersus, period: PeriodName): string {
  if (versus.kind === 'tooFewToCompare') return ''
  if (versus.kind === 'aboutTheSame') return ' <span class="same">about the same</span>'
  return ` <span class="${versus.kind}">${versus.kind === 'slower' ? '↓' : '↑'} ${number(versus.by)} a ${period} ${versus.kind}</span>`
}

/** A candidate's finished tickets a period, as a strip of small bars, oldest first. */
function stripHtml(counts: readonly number[], starts: readonly string[], period: PeriodName): string {
  const top = Math.max(1, ...counts)
  const bars = counts
    .map((count, at) => `<i title="${period} of ${dayMonth(starts[at]!)}: ${count}" style="height:${Math.round((count / top) * 100)}%"></i>`)
    .join('')
  return `<span class="strip" aria-label="Finished a ${period}: ${counts.join(', ')}">${bars}</span>`
}

/** A median or difference a period, to one decimal place at most. */
function number(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/** The kinds of choices, read back from what the step's script sends; none unless each is a choice. */
export function choicesAsked(params: URLSearchParams, kindOf: (text: string) => Choice['kind'] | undefined): Choice[] | undefined {
  const kinds = params.getAll(CHOICE_FIELDS.kind)
  const names = params.getAll(CHOICE_FIELDS.name)
  const queries = params.getAll(CHOICE_FIELDS.query)
  if (names.length !== kinds.length || queries.length !== kinds.length) return undefined
  const choices = kinds.map((kind, at) => ({ kind: kindOf(kind), name: names[at]!, query: queries[at]! }))
  return choices.every((choice): choice is Choice => choice.kind !== undefined) ? choices : undefined
}

/** How long the EM's typing pauses, after the last key, before the candidates it narrowed the list to are read. */
const NARROWED_DEBOUNCE_MS = 450

/**
 * The step's candidates script: a candidate's link opens it in place, and typing that narrows the lists to
 * `FEW_CANDIDATES` or fewer opens those once it pauses for `NARROWED_DEBOUNCE_MS`, both read from the candidates
 * block; each opened is asked for once, in the page's opening, and the candidates shown are replaced by the answer.
 */
export function candidatesScript({ id, findField }: StepSection): string {
  return `
(() => {
  const step = document.getElementById('${id}')
  let block = step && step.querySelector('.candidates')
  if (!block) return
  const opened = new Map()
  for (const shown of block.querySelectorAll('li[data-query]')) opened.set(shown.dataset.query, { kind: shown.dataset.kind, name: shown.dataset.name, query: shown.dataset.query })
  let latest = 0
  const choiceOf = (form) => ({
    kind: form.querySelector('input[name=${CHOICE_FIELDS.kind}]').value,
    name: form.querySelector('input[name=${CHOICE_FIELDS.name}]').value,
    query: form.querySelector('input[name=${CHOICE_FIELDS.query}]').value,
  })
  const open = (choices) => {
    const fresh = choices.filter((choice) => !opened.has(choice.query))
    if (fresh.length === 0) return
    for (const choice of fresh) opened.set(choice.query, choice)
    const params = new URLSearchParams({ ${OPENING_FIELD}: block.dataset.opening })
    for (const choice of opened.values()) for (const field of ['kind', 'name', 'query']) params.append(field, choice[field])
    const asked = ++latest
    fetch(block.dataset.path + '?' + params)
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then((html) => {
        if (asked !== latest) return
        const answered = document.createElement('template')
        answered.innerHTML = html
        const fresh = answered.content.querySelector('.candidates')
        if (fresh) {
          block.replaceWith(fresh)
          block = fresh
        }
      })
      .catch(() => {})
  }
  step.addEventListener('click', (event) => {
    const link = event.target.closest('a.open')
    if (!link) return
    event.preventDefault()
    open([choiceOf(link.closest('form'))])
  })
  const find = step.querySelector('input[name=${findField}]')
  const found = step.querySelector('.found')
  if (!find || !found) return
  let timer
  const narrowed = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (find.value.trim() === '') return
      const shown = [...found.querySelectorAll('.kind-list:not([hidden]) form[data-name]:not([hidden])')]
      if (shown.length > 0 && shown.length <= Number(block.dataset.few)) open(shown.map(choiceOf))
    }, Number(block.dataset.pauseMs))
  }
  find.addEventListener('input', narrowed)
  new MutationObserver(narrowed).observe(found, { childList: true })
})()
`
}
