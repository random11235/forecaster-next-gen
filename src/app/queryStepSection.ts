import type { ChoiceList, StepQueryEdit, QueryStep, QueryStepView, QueryEditing } from '../forecast/queryStep.js'
import { kindName } from '../forecast/queryStep.js'
import { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from '../forecast/stepQuery.js'
import { choiceKindOf, type Choice } from '../connectors/connector.js'
import { dayMonth } from '../forecast/calendarDate.js'
import type { ComparableWorkPace, PairedPeriod, PickPace } from '../forecast/comparableWorkPace.js'
import type { SetupStep } from '../forecast/setup.js'
import { escapeHtml } from './html.js'

/** Reads a submitted step's form, by the field names this section gives them; none when it isn't one of its forms as sent. */
type StepFormReader = (body: URLSearchParams) => StepQueryEdit | undefined

/**
 * One of the setup steps that picks or writes one of the team's queries, as the Inputs screen shows it: the Milestone
 * step (`MILESTONE_STEP`) and the Comparable work step (`COMPARABLE_WORK_STEP`). Each has its own section, forms, find
 * box and URLs; they share the picker and its HTML.
 */
export interface StepSection {
  /** The query the step edits. */
  stepQuery: StepQuery
  /** The setup step it is, which its URLs open at (`STEP_FIELD`): the Milestone step, the default, names none. */
  setupStep: Extract<SetupStep, 'milestone' | 'comparableWork'>
  /** Its section's id on the Inputs screen. */
  id: string
  /** Its name and hint, in the section's label column. */
  title: string
  hint: string
  /** The id of the box the query is edited in by hand. */
  inputId: string
  /**
   * Where its forms post: add a choice as a pick, remove a pick, submit the query edited by hand, go back to finding,
   * and, the Comparable work step's only, start afresh.
   */
  paths: { add: string; remove: string; edit: string; back: string; afresh: string }
  /** Each form it posts, by its action's path, and how its fields are read. */
  forms: ReadonlyMap<string, StepFormReader>
  /** The field its find box sends, to `/inputs`, when it is submitted without the page's script. */
  findField: string
  /**
   * Where its script asks for one kind searched in the tracker, as the EM types: `KIND_FIELD` names the kind and
   * `findField` what is typed. It answers with that kind's list alone (`choiceListHtml`).
   */
  searchedChoicesPath: string
  /** What opens it with its query open for editing: `/inputs?edit=query` for the Milestone step. */
  editing: { name: string; value: string }
  /** Where it is served: finding choices to pick; with its query open for editing; and asking to confirm going back clears it. */
  urls: { finding: string; editing: string; confirmingBack: string }
}

/** The field naming the kind searched, at a step's `searchedChoicesPath`. */
export const KIND_FIELD = 'kind'

/** The fields a choice's form sends, adding it as a pick: its kind, name and query; the query alone removes a pick or is edited by hand. */
export const CHOICE_FIELDS = { kind: 'kind', name: 'name', query: 'query' } as const

/** The field Back to finding sends, `yes` once the EM has confirmed it clears the query. */
export const CONFIRMED = { name: 'confirmed', value: 'yes' } as const

/** The field naming the setup step the Inputs screen opens at: `/inputs?step=comparableWork`; Milestone, once connected, without it. */
export const STEP_FIELD = 'step'

/** The URL query opening the Inputs screen at `step`, `step=comparableWork`; none for the Milestone step, its default. */
export function stepParam(step: SetupStep): string {
  return step === 'milestone' ? '' : `${STEP_FIELD}=${step}`
}

/** The Inputs screen opened at `step`, with `params` beside it, at the section `id`. */
export function inputsAt(step: SetupStep, id: string, ...params: string[]): string {
  const query = [stepParam(step), ...params].filter((param) => param !== '').join('&')
  return `/inputs${query === '' ? '' : `?${query}`}#${id}`
}

/** The field naming which step's query is open for editing: `/inputs?edit=query`. */
const EDIT_FIELD = 'edit'

/** What, beside a step's `editing`, opens it asking to confirm going back to finding clears the query: `/inputs?edit=query&confirm=back`. */
export const CONFIRMING_BACK = { name: 'confirm', value: 'back' } as const

/** What a step's section is built from: where its forms post (under `formsAt`), and what opens it for editing (`editingValue`). */
type StepSectionMade = Omit<StepSection, 'paths' | 'forms' | 'editing' | 'urls'> & { formsAt: string; editingValue: string }

function stepSection({ formsAt, editingValue, ...section }: StepSectionMade): StepSection {
  const paths = { add: `${formsAt}/add`, remove: `${formsAt}/remove`, edit: `${formsAt}/edit`, back: `${formsAt}/back`, afresh: `${formsAt}/afresh` }
  const editing = `${EDIT_FIELD}=${editingValue}`
  const forms = new Map<string, StepFormReader>([
    [
      paths.add,
      (body) => {
        const kind = choiceKindOf(body.get(CHOICE_FIELDS.kind) ?? '')
        return kind && { kind: 'addPick', choice: { kind, name: body.get(CHOICE_FIELDS.name) ?? '', query: body.get(CHOICE_FIELDS.query) ?? '' } }
      },
    ],
    [paths.remove, (body) => ({ kind: 'removePick', query: body.get(CHOICE_FIELDS.query) ?? '' })],
    [paths.edit, (body) => ({ kind: 'editQuery', query: body.get(CHOICE_FIELDS.query) ?? '' })],
    [paths.back, (body) => ({ kind: 'backToFinding', confirmed: body.get(CONFIRMED.name) === CONFIRMED.value })],
  ])
  if (section.stepQuery.kind === 'comparableWork') forms.set(paths.afresh, () => ({ kind: 'startAfresh' }))
  return {
    ...section,
    paths,
    forms,
    editing: { name: EDIT_FIELD, value: editingValue },
    urls: {
      finding: inputsAt(section.setupStep, section.id),
      editing: inputsAt(section.setupStep, section.id, editing),
      confirmingBack: inputsAt(section.setupStep, section.id, editing, `${CONFIRMING_BACK.name}=${CONFIRMING_BACK.value}`),
    },
  }
}

/** The Milestone step, picking the milestone's tickets: after the Connect step. */
export const MILESTONE_STEP: StepSection = stepSection({
  stepQuery: MILESTONE_QUERY,
  setupStep: 'milestone',
  id: 'milestone-tickets',
  title: 'Milestone’s tickets',
  hint: 'Which tickets are the milestone? Find and add one or more: several epics, say, or a label.',
  inputId: 'milestone-query',
  formsAt: '/inputs/milestone-query',
  findField: 'find',
  searchedChoicesPath: '/inputs/milestone-choices',
  editingValue: 'query',
})

/** The Comparable work step, picking recent work like the milestone's to measure its pace from: after the Milestone step, and optional. */
export const COMPARABLE_WORK_STEP: StepSection = stepSection({
  stepQuery: COMPARABLE_WORK,
  setupStep: 'comparableWork',
  id: 'comparable-work',
  title: 'Comparable work',
  hint: 'Optional. Recent work like this milestone’s: once added, pace is measured from it instead of the milestone’s own. Pick this milestone too to count its own tickets.',
  inputId: 'comparable-work-query',
  formsAt: '/inputs/comparable-work',
  findField: 'comparableFind',
  searchedChoicesPath: '/inputs/comparable-work-choices',
  editingValue: 'comparable',
})

/** The setup steps that pick or write a query, in the order the Inputs screen shows them. */
export const STEP_SECTIONS: readonly StepSection[] = [MILESTONE_STEP, COMPARABLE_WORK_STEP]

/**
 * A step picking or writing one of the team's queries (`section`), in the local server build once connected; none
 * otherwise. Each pick and each removal posts at once; the find box filters the lists as the EM types (see
 * `queryStepScript`), and without the script it submits to `/inputs` with what was typed. The Comparable work step
 * leads with its pace, and ends with Start afresh once it has a query. Back and Next between the steps are the setup
 * steps' own (`setupStepsHtml`).
 */
export function queryStepSection(view: QueryStepView, section: StepSection): string | undefined {
  if (view.kind === 'noQueryStep') return undefined
  const pace = view.kind === 'comparableWorkStep' ? view.pace : undefined
  return view.editing ? editingSection(view, view.editing, section, pace) : findingSection(view, section, pace)
}

/**
 * The pace the step leads with: the pace in use as the headline, how far it is from the milestone's own beneath, and
 * the two paired per period as bars, those before the milestone started hatched. Nothing until there is a pace.
 */
function paceHtml(pace: ComparableWorkPace | undefined): string {
  if (pace?.said.inUse === undefined) return ''
  const comparing = pace.periods.some((period) => period.comparableWork !== undefined)
  const delta =
    pace.comparison !== undefined
      ? `\n            <p class="delta ${pace.comparison.versus.kind}">${escapeHtml(pace.said.comparison ?? '')}</p>`
      : comparing
        ? ''
        : '\n            <p class="delta">Add comparable work to measure pace from work like this milestone’s.</p>'
  const top = Math.max(1, ...pace.periods.flatMap((period) => [period.milestone ?? 0, period.comparableWork ?? 0]))
  const periods = pace.periods.map((period) => periodHtml(period, top)).join('\n')
  const own = pace.periods.some((period) => period.milestone !== undefined)
  const legend = `${comparing ? '<i class="comparable"></i> comparable work ' : ''}${own ? '<i class="own"></i> the milestone’s own' : ''}${pace.periods.some((period) => period.beforeStart) ? ' <i class="before"></i> before it started' : ''}`
  return `
          <div class="step-pace">
            <p class="headline">${escapeHtml(pace.said.inUse)} <small>${escapeHtml(pace.said.from ?? '')}</small></p>${delta}
            <ol class="pairs" aria-label="Tickets finished each period, oldest first">
${periods}
            </ol>
            <p class="legend">${legend}</p>
          </div>`
}

/** Tallest bar's height, in pixels. */
const PAIR_HEIGHT = 80

/**
 * One period's pair of bars: comparable work's, when it has a query, beside the milestone's own, when its read is
 * complete, hatched before it started.
 */
function periodHtml({ start, milestone, comparableWork, beforeStart }: PairedPeriod, top: number): string {
  const bar = (count: number, kind: string): string => `<i class="${kind}" style="height:${Math.max(2, Math.round((count / top) * PAIR_HEIGHT))}px"></i>`
  const said = `${dayMonth(start)}: ${[
    ...(comparableWork === undefined ? [] : [`comparable work ${comparableWork}`]),
    ...(milestone === undefined ? [] : [`the milestone’s own ${milestone}`]),
  ].join(', ')}${beforeStart ? ', before it started' : ''}`
  return `              <li class="period${beforeStart ? ' before' : ''}" title="${escapeHtml(said)}"><span class="two">${comparableWork === undefined ? '' : bar(comparableWork, 'comparable')}${milestone === undefined ? '' : bar(milestone, beforeStart ? 'before' : 'own')}</span><span class="when">${escapeHtml(dayMonth(start))}</span></li>`
}

/** A pick's chip's own pace: its strip of the periods paired, how many it finished, and with several picks how many only it brings in. */
function pickPaceHtml(pick: PickPace | undefined): string {
  if (!pick) return ''
  const top = Math.max(1, ...pick.strip)
  const strip = pick.strip.map((count) => `<i style="height:${Math.round((count / top) * 12)}px"></i>`).join('')
  const only = pick.onlyHere === undefined ? '' : `, +${pick.onlyHere} only here`
  return ` <span class="strip" role="img" aria-label="Finished each period: ${pick.strip.join(', ')}">${strip}</span> <span class="kind">${pick.finished} finished${only}</span>`
}

/**
 * The query's last read: its line, when it has one, and its flag beneath, or its pace's, saying it isn't used; nothing
 * until it is read.
 */
function readHtml(view: QueryStep, pace: ComparableWorkPace | undefined): string {
  const line = view.read === undefined ? '' : `\n          <p class="read">${escapeHtml(view.read)}</p>`
  const flagged = view.flag ?? pace?.flag
  const flag = flagged === undefined ? '' : `\n          <p class="note warn flag">⚠ ${escapeHtml(flagged)}</p>`
  return line + flag
}

/** The Comparable work step's end, once it has a query: Start afresh, clearing all its picks and query at once. Nothing for the Milestone step. */
function afreshHtml(view: QueryStep, { paths, urls }: StepSection): string {
  if (view.kind !== 'comparableWorkStep' || view.query === '') return ''
  return `
          <div class="actions afresh"><form method="post" action="${paths.afresh}${urls.finding.slice(urls.finding.indexOf('#'))}"><button type="submit" class="linkish">Start afresh</button></form></div>`
}

/**
 * The step with its query open for editing by hand, within the connected repo or project: it is submitted (and read)
 * only on Enter, so a half-typed query changes nothing. Back to finding says first when it will clear it, and then
 * asks the EM to confirm that, in a form of its own, so it works without the script.
 */
function editingSection(view: QueryStep, editing: QueryEditing, section: StepSection, pace: ComparableWorkPace | undefined): string {
  const { paths, urls, id, inputId } = section
  const refusal = editing.refusal === undefined ? '' : `\n          <p class="error" role="alert">${escapeHtml(editing.refusal)}</p>`
  const inUse =
    editing.refusal === undefined || view.query === ''
      ? ''
      : `\n          <p class="note">Still reading <code>${escapeHtml(view.query)}</code></p>`
  const clears = editing.backClears === undefined ? '' : `<p class="note warn">${escapeHtml(editing.backClears)}</p> `
  const back = editing.confirmingBack
    ? `<input type="hidden" name="${CONFIRMED.name}" value="${CONFIRMED.value}"><button type="submit">Clear the query and go back</button> <a href="${escapeHtml(urls.editing)}" class="keep">Keep editing</a>`
    : '<button type="submit" class="linkish">Back to finding</button>'
  return `        <div class="picker editing">${paceHtml(pace)}
          <form method="post" action="${paths.edit}#${id}" class="query">
            <label class="label" for="${inputId}">${escapeHtml(section.stepQuery.name)}, within <b>${escapeHtml(editing.readIn)}</b></label>
            <input type="text" id="${inputId}" name="${CHOICE_FIELDS.query}" value="${escapeHtml(editing.typed)}" autocomplete="off" spellcheck="false">
            <p class="note">Press Enter to read it. ${escapeHtml(view.note)}</p>
          </form>${refusal}${inUse}${readHtml(view, pace)}
          <form method="post" action="${paths.back}#${id}" class="back">
            ${clears}${back}
          </form>${afreshHtml(view, section)}
        </div>`
}

/** The step finding choices to pick: the chips, the find box over the lists, and the query, to edit as a query. */
function findingSection(view: QueryStep, section: StepSection, pace: ComparableWorkPace | undefined): string {
  const { paths, urls, id, findField } = section
  const kinds = view.lists.map((list) => kindName(list.kind))
  const chips = view.picks
    .map(
      (pick) => `            <li class="chip">${escapeHtml(pick.name)} <span class="kind">${escapeHtml(kindName(pick.kind))}</span>${pickPaceHtml(pace?.picks.find((each) => each.query === pick.query))}
              <form method="post" action="${paths.remove}#${id}"><input type="hidden" name="${CHOICE_FIELDS.query}" value="${escapeHtml(pick.query)}"><button type="submit" class="x" aria-label="Remove ${escapeHtml(pick.name)}">×</button></form>
            </li>`,
    )
    .join('\n')
  // a change of the picks the tracker rejected: why, beside the chips still in use
  const refusal = view.refusal === undefined ? '' : `\n          <p class="error" role="alert">${escapeHtml(view.refusal)}</p>`
  const lists = view.lists.map((list) => choiceListHtml(list, section)).join('\n')
  const failure = view.choicesFailure === undefined ? '' : `\n          <p class="error" role="alert">${escapeHtml(view.choicesFailure)}</p>`
  const query = view.query === '' ? '<span class="none">Nothing picked yet.</span>' : `<code>${escapeHtml(view.query)}</code>`
  return `        <div class="picker">${paceHtml(pace)}${failure}${chips === '' ? '' : `\n          <ul class="chips">\n${chips}\n          </ul>`}${refusal}
          <form method="get" action="/inputs#${id}" class="find">${section.setupStep === 'milestone' ? '' : `\n            <input type="hidden" name="${STEP_FIELD}" value="${section.setupStep}">`}
            <input type="search" name="${findField}" value="${escapeHtml(view.find)}" placeholder="Find ${escapeHtml(article(alternatives(kinds)))}…" aria-label="Find a choice to pick" autocomplete="off" spellcheck="false">
          </form>
          <div class="found">
${lists}
            <p class="note none-found" hidden>Nothing matches.</p>
          </div>
          <div class="query">
            <span class="label">${escapeHtml(section.stepQuery.name)} <a href="${escapeHtml(urls.editing)}" class="edit">Edit as a query</a></span> ${query}
            <p class="note">${escapeHtml(view.note)}</p>
          </div>${readHtml(view, pace)}${afreshHtml(view, section)}
        </div>`
}

/**
 * One kind's list of choices to pick, each a form adding it to `section`'s query, the one that is the milestone query
 * marked "this milestone"; a kind searched in the tracker is marked for the script (`data-searched`), which asks for it
 * again as the EM types rather than filtering it.
 */
export function choiceListHtml(list: ChoiceList, { paths, id, stepQuery, setupStep }: StepSection): string {
  const candidates = stepQuery.kind === 'comparableWork'
  const choices = list.choices
    .map(
      (choice) => `              <form method="post" action="${paths.add}#${id}" data-name="${escapeHtml(choice.name.toLowerCase())}"${candidates ? ' class="candidate"' : ''}>
                <input type="hidden" name="${CHOICE_FIELDS.kind}" value="${escapeHtml(choice.kind)}"><input type="hidden" name="${CHOICE_FIELDS.name}" value="${escapeHtml(choice.name)}"><input type="hidden" name="${CHOICE_FIELDS.query}" value="${escapeHtml(choice.query)}">
                <button type="submit">${escapeHtml(choice.name)} <span class="kind">${escapeHtml(kindName(choice.kind))}</span>${choice.query === list.thisMilestone ? ' <span class="this">this milestone</span>' : ''}</button>${candidates ? openLinkHtml(choice, setupStep, id) : ''}
              </form>`,
    )
    .join('\n')
  const failure = list.failure === undefined ? '' : `\n              <p class="error" role="alert">${escapeHtml(list.failure)}</p>`
  return `            <div class="kind-list" data-kind="${escapeHtml(list.kind)}"${list.searchedInTracker ? ' data-searched' : ''}>
              <h3>${escapeHtml(capitalised(kindName(list.kind)))}s</h3>${failure}
${choices}
            </div>`
}

/** The field, at `/inputs`, opening a candidate without the page's script: `/inputs?comparableOpen=<query>` (#205). */
export const OPEN_FIELD = 'comparableOpen'

/** The link opening a choice as a candidate, beside it in the step's lists, to read how it runs. */
function openLinkHtml(choice: Choice, step: SetupStep, id: string): string {
  return `<a class="open" href="${escapeHtml(inputsAt(step, id, `${OPEN_FIELD}=${encodeURIComponent(choice.query)}`))}" aria-label="How ${escapeHtml(choice.name)} runs">pace</a>`
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "a milestone", "an epic, label or milestone". */
function article(text: string): string {
  return `${/^[aeiou]/i.test(text) ? 'an' : 'a'} ${text}`
}

function alternatives(names: string[]): string {
  if (names.length === 0) return 'choice'
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} or ${names.at(-1)!}`
}

/** How long the step's script waits after the last key typed before it searches the tracker, in milliseconds. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * A step's script, for `section`: it filters the lists as the EM types in the find box, ignoring case and matching
 * part of a word, as `queryStepView` does for a find submitted without it. A kind searched in the tracker isn't
 * filtered: once typing pauses, its list is asked for again, searched for what is typed (or, cleared, its first 100 as
 * listed), and an answer to anything but the latest search is dropped. The lists show as the step opens, before
 * anything is typed.
 */
export function queryStepScript({ id, findField, searchedChoicesPath }: StepSection): string {
  return `
(() => {
  const step = document.getElementById('${id}')
  const find = step && step.querySelector('input[name=${findField}]')
  if (!find) return
  const found = step.querySelector('.found')
  const filter = () => {
    const typed = find.value.trim().toLowerCase()
    let any = false
    for (const list of found.querySelectorAll('.kind-list')) {
      let shown = 0
      for (const choice of list.querySelectorAll('form[data-name]')) {
        const matches = list.hasAttribute('data-searched') || choice.dataset.name.includes(typed)
        choice.hidden = !matches
        if (matches) shown += 1
      }
      list.hidden = shown === 0 && !list.querySelector('.error')
      any = any || !list.hidden
    }
    found.querySelector('.none-found').hidden = any || typed === ''
  }
  let timer
  let latest = 0
  const search = () => {
    clearTimeout(timer)
    const typed = find.value.trim()
    timer = setTimeout(() => {
      const asked = ++latest
      for (const list of found.querySelectorAll('.kind-list[data-searched]')) {
        const kind = list.dataset.kind
        const url = '${searchedChoicesPath}?${KIND_FIELD}=' + encodeURIComponent(kind) + '&${findField}=' + encodeURIComponent(typed)
        fetch(url)
          .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
          .then((html) => {
            if (asked !== latest) return
            const answered = document.createElement('template')
            answered.innerHTML = html
            const fresh = answered.content.querySelector('.kind-list')
            const current = [...found.querySelectorAll('.kind-list[data-searched]')].find((each) => each.dataset.kind === kind)
            if (fresh && current) current.replaceWith(fresh)
            filter()
          })
          .catch(() => {})
      }
    }, ${SEARCH_DEBOUNCE_MS})
  }
  find.addEventListener('input', () => {
    filter()
    search()
  })
  find.form.addEventListener('submit', (event) => event.preventDefault())
  filter()
})()
`
}
