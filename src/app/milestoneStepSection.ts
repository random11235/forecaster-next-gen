import type { ChoiceList, MilestoneQueryEdit, MilestoneStepView } from '../forecast/milestoneStep.js'
import { kindName } from '../forecast/milestoneStep.js'
import { escapeHtml } from './html.js'

/** Where the Milestone step is on the Inputs screen: its section's id. */
export const MILESTONE_STEP_ID = 'milestone-tickets'

/** Where the Milestone step's forms post: add a choice as a pick, and remove a pick. */
export const MILESTONE_STEP_PATHS = { add: '/inputs/milestone-query/add', remove: '/inputs/milestone-query/remove' } as const

/** The field the step's find box sends, to `/inputs`, when it is submitted without the page's script. */
export const FIND_FIELD = 'find'

/**
 * Where the step's script asks for one kind searched in the tracker, as the EM types: `KIND_FIELD` names the kind and
 * `FIND_FIELD` what is typed. It answers with that kind's list alone (`choiceListHtml`).
 */
export const SEARCHED_CHOICES_PATH = '/inputs/milestone-choices'

/** The field naming the kind searched, at `SEARCHED_CHOICES_PATH`. */
export const KIND_FIELD = 'kind'

/** Reads a submitted Milestone step form, by the field names this section gives them. */
type MilestoneStepFormReader = (body: URLSearchParams) => MilestoneQueryEdit

/** Each form the Milestone step posts, by its action's path, and how its fields are read. */
export const MILESTONE_STEP_FORMS: ReadonlyMap<string, MilestoneStepFormReader> = new Map<string, MilestoneStepFormReader>([
  [
    MILESTONE_STEP_PATHS.add,
    (body) => ({ kind: 'addPick', choice: { kind: body.get('kind') ?? '', name: body.get('name') ?? '', query: body.get('query') ?? '' } }),
  ],
  [MILESTONE_STEP_PATHS.remove, (body) => ({ kind: 'removePick', query: body.get('query') ?? '' })],
])

/** What the section says in its label column. */
export const MILESTONE_STEP_HINT = 'Which tickets are the milestone? Find and add one or more: several epics, say, or a label.'

/**
 * The Milestone step, after the Connect step in the local server build once connected; none otherwise. Each pick and
 * each removal posts at once; the find box filters the lists as the EM types (see `MILESTONE_STEP_SCRIPT`), and without
 * the script it submits to `/inputs` with what was typed.
 */
export function milestoneStepSection(view: MilestoneStepView): string | undefined {
  if (view.kind === 'noMilestoneStep') return undefined
  const anchor = `#${MILESTONE_STEP_ID}`
  const kinds = view.lists.map((list) => kindName(list.kind))
  const chips = view.picks
    .map(
      (pick) => `            <li class="chip">${escapeHtml(pick.name)} <span class="kind">${escapeHtml(kindName(pick.kind))}</span>
              <form method="post" action="${MILESTONE_STEP_PATHS.remove}${anchor}"><input type="hidden" name="query" value="${escapeHtml(pick.query)}"><button type="submit" class="x" aria-label="Remove ${escapeHtml(pick.name)}">×</button></form>
            </li>`,
    )
    .join('\n')
  const lists = view.lists.map(choiceListHtml).join('\n')
  const failure = view.choicesFailure === undefined ? '' : `\n          <p class="error" role="alert">${escapeHtml(view.choicesFailure)}</p>`
  const query = view.query === '' ? '<span class="none">Nothing picked yet.</span>' : `<code>${escapeHtml(view.query)}</code>`
  const read = view.read === undefined ? '' : `\n          <p class="read">${escapeHtml(view.read)}</p>`
  return `        <div class="picker">${failure}${chips === '' ? '' : `\n          <ul class="chips">\n${chips}\n          </ul>`}
          <form method="get" action="/inputs${anchor}" class="find">
            <input type="search" name="${FIND_FIELD}" value="${escapeHtml(view.find)}" placeholder="Find ${escapeHtml(article(alternatives(kinds)))}…" aria-label="Find a choice to pick" autocomplete="off" spellcheck="false">
          </form>
          <div class="found${view.find.trim() === '' ? '' : ' finding'}">
${lists}
            <p class="note none-found" hidden>Nothing matches.</p>
          </div>
          <div class="query">
            <span class="label">Milestone query</span> ${query}
            <p class="note">${escapeHtml(view.note)}</p>
          </div>${read}
        </div>`
}

/**
 * One kind's list of choices to pick, each a form adding it; a kind searched in the tracker is marked for the script
 * (`data-searched`), which asks for it again as the EM types rather than filtering it.
 */
export function choiceListHtml(list: ChoiceList): string {
  const anchor = `#${MILESTONE_STEP_ID}`
  const choices = list.choices
    .map(
      (choice) => `              <form method="post" action="${MILESTONE_STEP_PATHS.add}${anchor}" data-name="${escapeHtml(choice.name.toLowerCase())}">
                <input type="hidden" name="kind" value="${escapeHtml(choice.kind)}"><input type="hidden" name="name" value="${escapeHtml(choice.name)}"><input type="hidden" name="query" value="${escapeHtml(choice.query)}">
                <button type="submit">${escapeHtml(choice.name)} <span class="kind">${escapeHtml(kindName(choice.kind))}</span></button>
              </form>`,
    )
    .join('\n')
  const failure = list.failure === undefined ? '' : `\n              <p class="error" role="alert">${escapeHtml(list.failure)}</p>`
  return `            <div class="kind-list" data-kind="${escapeHtml(list.kind)}"${list.searched ? ' data-searched' : ''}>
              <h3>${escapeHtml(capitalised(kindName(list.kind)))}s</h3>${failure}
${choices}
            </div>`
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
 * The Milestone step's script: it filters the lists as the EM types in the find box, ignoring case and matching part of
 * a word, as `milestoneStepView` does for a find submitted without it. A kind searched in the tracker isn't filtered:
 * once typing pauses, its list is asked for again, searched for what is typed, and an answer to anything but the
 * latest search is dropped. The lists show only once something is typed.
 */
export const MILESTONE_STEP_SCRIPT = `
(() => {
  const step = document.getElementById('${MILESTONE_STEP_ID}')
  const find = step && step.querySelector('input[name=${FIND_FIELD}]')
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
    found.classList.toggle('finding', typed !== '')
    found.querySelector('.none-found').hidden = any || typed === ''
  }
  let timer
  let latest = 0
  const search = () => {
    clearTimeout(timer)
    const typed = find.value.trim()
    if (typed === '') return
    timer = setTimeout(() => {
      const asked = ++latest
      for (const list of found.querySelectorAll('.kind-list[data-searched]')) {
        const kind = list.dataset.kind
        const url = '${SEARCHED_CHOICES_PATH}?${KIND_FIELD}=' + encodeURIComponent(kind) + '&${FIND_FIELD}=' + encodeURIComponent(typed)
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
