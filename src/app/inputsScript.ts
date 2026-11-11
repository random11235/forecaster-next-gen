/**
 * The Inputs screen's script: it saves each input as the EM changes it, so the screen needs no save buttons (#100).
 *
 * When a field of a form changes (a radio on click; a text or number field on leaving it, or on Enter), it posts that
 * form to the route its button posts to, asking to save in place. A save answers with the Inputs screen, whose
 * sections replace these, as a save can change what other sections say (a cadence makes pace per sprint); a "Saved"
 * note shows beside the section saved. A refusal answers with the screen to show again, and only the refused section
 * is replaced, showing why and keeping what was typed. Focus and scroll position stay where they were.
 *
 * A section marked `submits` (the Connect step, whose submit asks the tracker) is left alone: its form posts only when
 * its button is pressed, and a save elsewhere doesn't replace it, so what is typed in it stays.
 *
 * Without it the screen works as before: the buttons are in the markup, and this hides them.
 */
/** The header the script sends with each save, asking for the Inputs screen back rather than a redirect. */
export const SAVE_IN_PLACE = { header: 'forecaster-save', value: 'in-place' } as const

export const INPUTS_SCRIPT = `
(() => {
  document.documentElement.classList.add('saves-as-changed')
  const main = document.querySelector('main')
  const lastSaved = new WeakMap()
  let saving = Promise.resolve()

  const bodyOf = (form) => new URLSearchParams(new FormData(form)).toString()
  const sectionOf = (element) => element.closest('section.input:not(.submits)')

  /** Where the focus is, as something to find again in a section that replaces this one. */
  function focusNow() {
    const active = document.activeElement
    if (!active || !active.name || !active.form) return undefined
    return {
      action: active.form.getAttribute('action'),
      name: active.name,
      value: active.type === 'radio' ? active.value : undefined,
      typed: active.type === 'radio' ? undefined : active.value,
      selection: typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : undefined,
    }
  }

  function refocus(focus, replaced) {
    if (!focus) return
    const form = [...document.forms].find((form) => form.getAttribute('action') === focus.action)
    const field = form && [...form.elements].find((field) => field.name === focus.name && (focus.value === undefined || field.value === focus.value))
    if (!field || !replaced.some((section) => section.contains(field))) return
    if (focus.typed !== undefined) field.value = focus.typed
    field.focus({ preventScroll: true })
    if (focus.selection) {
      try { field.setSelectionRange(focus.selection[0], focus.selection[1]) } catch {}
    }
  }

  /** Swaps in \`ids\`' sections from the reply, keeping the focus and scroll position. */
  function swap(reply, ids) {
    const focus = focusNow()
    const scroll = window.scrollY
    const replaced = []
    for (const id of ids) {
      const now = document.getElementById(id)
      const next = reply.getElementById(id)
      if (!now || !next) continue
      const adopted = document.importNode(next, true)
      now.replaceWith(adopted)
      replaced.push(adopted)
    }
    const header = reply.querySelector('main > header')
    if (header) main.querySelector(':scope > header').replaceWith(document.importNode(header, true))
    for (const form of document.forms) lastSaved.set(form, bodyOf(form))
    refocus(focus, replaced)
    window.scrollTo(window.scrollX, scroll)
    return replaced
  }

  function note(section, text, className) {
    const label = section && section.querySelector('.label')
    if (!label) return
    const shown = document.createElement('p')
    shown.className = className
    shown.setAttribute('role', 'status')
    shown.textContent = text
    label.append(shown)
  }

  async function save(form) {
    const body = bodyOf(form)
    if (lastSaved.get(form) === body) return
    lastSaved.set(form, body)
    const id = sectionOf(form).id
    try {
      const response = await fetch(form.getAttribute('action').split('#')[0], {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', '${SAVE_IN_PLACE.header}': '${SAVE_IN_PLACE.value}' },
        body,
      })
      const reply = new DOMParser().parseFromString(await response.text(), 'text/html')
      if (response.ok) {
        swap(reply, [...reply.querySelectorAll('section.input:not(.submits)')].map((section) => section.id))
        note(document.getElementById(id), 'Saved', 'saved')
      } else {
        swap(reply, [id])
        lastSaved.delete(form)
      }
    } catch {
      lastSaved.delete(form)
      note(document.getElementById(id), 'Not saved: the Forecaster is not answering. Is it still running?', 'error')
    }
  }

  /** Saves run one after another, so each reply is swapped in the order its change was made. */
  const queue = (form) => (saving = saving.then(() => save(form)))

  for (const form of document.forms) lastSaved.set(form, bodyOf(form))
  main.addEventListener('change', (event) => {
    const form = event.target.form
    if (form && sectionOf(form)) queue(form)
  })
  main.addEventListener('submit', (event) => {
    if (!sectionOf(event.target)) return
    event.preventDefault()
    queue(event.target)
  })
})()
`
