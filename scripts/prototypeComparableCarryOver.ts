// PROTOTYPE, throwaway: never merge. Spec #158 story 13
// (https://github.com/random11235/forecaster-next-gen/issues/158): "I want comparable work to belong to the milestone
// and not carry over to the next one, so that each milestone's pace is chosen for it."
//
// Question: when the EM moves on from one milestone to the next, what happens to comparable work, and how does the
// EM see it? Four variants, switchable via `?variant=A|B|C|D` (or ← → keys, or the bar at the bottom):
//   A  Kept until changed: no new-milestone moment; comparable work stays until the EM edits or removes it.
//   B  Cleared on rename: saving the milestone under a new name clears comparable work, with an Undo.
//   C  Start a new milestone: an explicit action that says what resets (picks, comparable work) and what stays.
//   D  Carried over, flagged: kept, but marked "picked for <old milestone>" until the EM keeps or clears it.
// The scene: the Shop team has finished "Checkout v2" and moves on to "Loyalty launch". All state is in memory;
// reload to reset. Run: `npm run prototype:comparable` (builds, writes dist/prototype/comparable-carry-over.html, opens it).
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { htmlPage }: typeof import('../src/app/html.js') = await import(new URL('../dist/app/html.js', import.meta.url).href)

const out = new URL('../dist/prototype/comparable-carry-over.html', import.meta.url)

const STYLE = `
  <style>
    .proto-banner { font-size: 12px; color: var(--risk); font-family: var(--mono); margin: 0 0 12px; }
    .chips { list-style: none; padding: 0; margin: 6px 0; display: flex; gap: 6px; flex-wrap: wrap; }
    .chips .chip { border: 1px solid var(--border); border-radius: 999px; padding: 2px 4px 2px 10px; min-height: 0; font-size: 13px; background: #fff; display: inline-flex; gap: 6px; align-items: center; }
    .chip .kind { color: var(--faint); font-size: 11px; }
    .chip button { border: 0; background: none; min-height: 0; padding: 0 4px; cursor: pointer; }
    .pickable { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
    .pickable button { font-size: 13px; min-height: 0; padding: 3px 8px; }
    .linkish { border: 0; background: none; padding: 0; min-height: 0; color: var(--link); text-decoration: underline; cursor: pointer; font-size: 13px; }
    .owner { display: inline-block; font-size: 12px; border-radius: 4px; padding: 1px 6px; background: #f3efe4; color: var(--muted); }
    .stale { border-left: 3px solid var(--risk); background: #fbf4ea; padding: 8px 10px; margin: 8px 0; font-size: 14px; }
    .toast { border: 1px solid var(--border); background: #fff; padding: 8px 10px; margin: 8px 0; font-size: 14px; display: flex; gap: 12px; align-items: center; }
    .resets { margin: 6px 0 10px; font-size: 14px; }
    .resets td { padding: 2px 12px 2px 0; vertical-align: top; }
    .muted { color: var(--muted); font-size: 13px; }
    .state { font-family: var(--mono); font-size: 12px; white-space: pre-wrap; background: #f6f4ee; border: 1px dashed var(--border); padding: 10px; margin: 24px 0 80px; }
    .switcher { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #1c1b18; color: #fff; border-radius: 999px; padding: 6px 10px; display: flex; gap: 10px; align-items: center; box-shadow: 0 4px 16px rgba(0,0,0,.25); font: 13px var(--mono); z-index: 10; max-width: calc(100vw - 32px); }
    .switcher button { background: none; border: 0; color: #fff; font-size: 16px; cursor: pointer; min-height: 0; padding: 2px 8px; }
  </style>`

const SCRIPT = `
const VARIANTS = {
  A: 'Kept until changed',
  B: 'Cleared on rename',
  C: 'Start a new milestone',
  D: 'Carried over, flagged',
}
const KEYS = Object.keys(VARIANTS)
const params = new URLSearchParams(location.search)
let variant = KEYS.includes(params.get('variant')) ? params.get('variant') : 'A'

// The tracker's choices, canned. Counts are finished tickets in the last 8 weeks.
const CHOICES = [
  { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"', finished: 31, open: 0 },
  { kind: 'milestone', name: 'Loyalty launch', query: 'milestone:"Loyalty launch"', finished: 2, open: 46 },
  { kind: 'epic', name: 'Payments rework', query: 'parent-issue:shop/shop#40', finished: 14, open: 0 },
  { kind: 'epic', name: 'Points ledger', query: 'parent-issue:shop/shop#88', finished: 0, open: 12 },
  { kind: 'label', name: 'payments', query: 'label:"payments"', finished: 22, open: 3 },
  { kind: 'label', name: 'rewards', query: 'label:"rewards"', finished: 9, open: 5 },
]

function fresh() {
  return {
    milestone: { name: 'Checkout v2', startDate: '2026-08-03' },
    milestonePicks: [CHOICES[0]],
    comparable: { picks: [CHOICES[2], CHOICES[4]], pickedFor: 'Checkout v2' },
    notice: undefined,      // B: what renaming just cleared, for Undo
    starting: false,        // C: the start-a-new-milestone form is open
  }
}
let state = fresh()

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const joined = (picks) => picks.map((p) => p.query).join(' OR ')
const sum = (picks, key) => picks.reduce((n, p) => n + p[key], 0)

function chips(picks, which) {
  if (picks.length === 0) return '<p class="muted">Nothing picked yet.</p>'
  return '<ul class="chips">' + picks.map((p, i) =>
    '<li class="chip">' + esc(p.name) + ' <span class="kind">' + p.kind + '</span><button data-act="remove" data-which="' + which + '" data-i="' + i + '" aria-label="Remove">×</button></li>').join('') + '</ul>'
}
function pickable(picks, which) {
  const left = CHOICES.filter((c) => !picks.includes(c))
  return '<div class="pickable">' + left.map((c) =>
    '<button data-act="pick" data-which="' + which + '" data-q="' + esc(c.query) + '">+ ' + esc(c.name) + ' <span class="kind">' + c.kind + '</span></button>').join('') + '</div>'
}

function milestoneSection() {
  const m = state.milestone
  const start = variant === 'C'
    ? (state.starting ? startForm() : '<p><button data-act="start-open">Start a new milestone…</button> <span class="muted">when this one is done</span></p>')
    : ''
  return '<section class="input" id="milestone"><div class="label"><span class="number">01</span><h2>Milestone</h2><p>What you\u2019re forecasting.</p></div><div class="body">' +
    '<form data-form="milestone"><label class="label">Name <input name="name" value="' + esc(m.name) + '"></label> ' +
    '<label class="label">Start date <input name="startDate" type="date" value="' + m.startDate + '"></label>' +
    '<div class="actions"><button type="submit" class="primary">Save milestone</button></div></form>' + start + '</section>'
}

function startForm() {
  const c = state.comparable.picks
  return '<form data-form="start" class="stale"><b>Start a new milestone</b>' +
    '<div class="row"><label class="label">Name <input name="name" placeholder="Loyalty launch" required></label> ' +
    '<label class="label">Start date <input name="startDate" type="date" value="2026-11-16"></label></div>' +
    '<table class="resets"><tr><td>Milestone’s tickets</td><td>pick again <span class="muted">(was ' + esc(state.milestonePicks.map((p) => p.name).join(', ') || 'nothing') + ')</span></td></tr>' +
    '<tr><td>Comparable work</td><td>cleared <span class="muted">(was ' + esc(c.map((p) => p.name).join(', ') || 'nothing') + ')</span></td></tr>' +
    '<tr><td>Connection, cadence, capacity</td><td>kept</td></tr></table>' +
    '<button type="submit" class="primary">Start Loyalty launch</button> <button type="button" data-act="start-cancel" class="linkish">Cancel</button></form>'
}

function milestoneTicketsSection() {
  const p = state.milestonePicks
  const read = p.length ? '<p class="read">' + sum(p, 'open') + ' open · ' + sum(p, 'finished') + ' finished in the last 8 weeks</p>' : ''
  return '<section class="input" id="milestone-tickets"><div class="label"><span class="number">02</span><h2>Milestone’s tickets</h2><p>What picks them out in the tracker.</p></div><div class="body">' +
    chips(p, 'milestone') + pickable(p, 'milestone') +
    '<p><span class="label">Milestone query</span> ' + (p.length ? '<code>' + esc(joined(p)) + '</code>' : '<span class="muted">Nothing picked yet.</span>') + '</p>' + read + '</div></section>'
}

function comparableSection() {
  const c = state.comparable
  const own = sum(state.milestonePicks, 'finished')
  const comparableOnly = sum(c.picks, 'finished')
  const stale = variant === 'D' && c.picks.length && c.pickedFor !== state.milestone.name
  const owner = variant === 'D' && c.picks.length ? ' <span class="owner">picked for ' + esc(c.pickedFor) + '</span>' : ''
  const flag = stale
    ? '<div class="stale">⚠ Picked for <b>' + esc(c.pickedFor) + '</b>. Is it still like <b>' + esc(state.milestone.name) + '</b>’s work? ' +
      '<button data-act="keep" class="linkish">Keep for ' + esc(state.milestone.name) + '</button> · <button data-act="clear" class="linkish">Clear it</button>' +
      '<div class="muted">Pace uses it until you choose.</div></div>'
    : ''
  const notice = variant === 'B' && state.notice
    ? '<div class="toast">Comparable work cleared for ' + esc(state.milestone.name) + ' (was ' + esc(state.notice.picks.map((p) => p.name).join(', ')) + '). <button data-act="undo" class="linkish">Undo</button></div>'
    : ''
  const read = '<p class="read">' + (own + comparableOnly) + ' finished in the last 8 weeks: ' + own + ' the milestone’s own' +
    (c.picks.length ? ', ' + comparableOnly + ' comparable' : '') + '</p>'
  const button = c.picks.length ? 'Next' : 'Skip'
  return '<section class="input" id="comparable-work"><div class="label"><span class="number">03</span><h2>Comparable work</h2>' + owner + '<p>Optional. Work like this milestone’s, to measure its pace from. The milestone’s own finished tickets always count.</p></div><div class="body">' +
    notice + flag + chips(c.picks, 'comparable') + pickable(c.picks, 'comparable') +
    '<p><span class="label">Comparable-work query</span> ' + (c.picks.length ? '<code>' + esc(joined(c.picks)) + '</code>' : '<span class="muted">None: pace comes from the milestone’s own tickets.</span>') + '</p>' +
    read + '<div class="actions"><button class="primary">' + button + '</button></div></div></section>'
}

function render() {
  const main = document.getElementById('proto')
  main.innerHTML = '<p class="proto-banner">PROTOTYPE · variant ' + variant + ': ' + VARIANTS[variant] + ' · try moving on from “Checkout v2” to “Loyalty launch” · reload to reset</p>' +
    milestoneSection() + milestoneTicketsSection() + comparableSection() +
    '<pre class="state">state = ' + esc(JSON.stringify({
      milestone: state.milestone,
      milestoneQuery: joined(state.milestonePicks),
      comparableWorkQuery: joined(state.comparable.picks),
      comparablePickedFor: state.comparable.pickedFor,
      notice: state.notice && 'cleared ' + joined(state.notice.picks),
    }, null, 2)) + '</pre>'
  document.querySelector('.switcher-label').textContent = variant + ' (' + VARIANTS[variant] + ')'
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]')
  if (!t) return
  e.preventDefault()
  const act = t.dataset.act
  const list = t.dataset.which === 'milestone' ? state.milestonePicks : state.comparable.picks
  if (act === 'pick') { list.push(CHOICES.find((c) => c.query === t.dataset.q)); if (t.dataset.which === 'comparable') state.comparable.pickedFor = state.milestone.name }
  if (act === 'remove') list.splice(Number(t.dataset.i), 1)
  if (act === 'undo') { state.comparable = state.notice; state.notice = undefined }
  if (act === 'keep') state.comparable.pickedFor = state.milestone.name
  if (act === 'clear') state.comparable = { picks: [], pickedFor: state.milestone.name }
  if (act === 'start-open') state.starting = true
  if (act === 'start-cancel') state.starting = false
  if (act === 'prev' || act === 'next') { const i = KEYS.indexOf(variant); variant = KEYS[(i + (act === 'next' ? 1 : KEYS.length - 1)) % KEYS.length]; switchTo(variant) }
  render()
})

document.addEventListener('submit', (e) => {
  e.preventDefault()
  const f = new FormData(e.target)
  const name = String(f.get('name')).trim() || 'Loyalty launch'
  const startDate = String(f.get('startDate'))
  if (e.target.dataset.form === 'milestone') {
    const renamed = name !== state.milestone.name
    if (variant === 'B' && renamed && state.comparable.picks.length) {
      state.notice = state.comparable
      state.comparable = { picks: [], pickedFor: name }
    }
    state.milestone = { name, startDate }
  }
  if (e.target.dataset.form === 'start') {
    state.milestone = { name, startDate }
    state.milestonePicks = []
    state.comparable = { picks: [], pickedFor: name }
    state.starting = false
  }
  render()
})

function switchTo(v) {
  const url = new URL(location.href); url.searchParams.set('variant', v); history.replaceState(null, '', url)
  state = fresh()
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]')) return
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const i = KEYS.indexOf(variant); variant = KEYS[(i + (e.key === 'ArrowRight' ? 1 : KEYS.length - 1)) % KEYS.length]; switchTo(variant); render()
  }
})
render()
`

const SWITCHER = `
  <div class="switcher" role="navigation" aria-label="Prototype variants">
    <button data-act="prev" aria-label="Previous variant">←</button>
    <span class="switcher-label"></span>
    <button data-act="next" aria-label="Next variant">→</button>
  </div>`

const page = htmlPage('/inputs', { context: 'Shop team · GitHub shop/shop', heading: 'Inputs' }, '<div id="proto"></div>' + SWITCHER, SCRIPT)
  .replace('</head>', `${STYLE}\n</head>`)

mkdirSync(new URL('.', out), { recursive: true })
writeFileSync(out, page)
const path = fileURLToPath(out)
console.log(`Wrote ${path}\nVariants: ?variant=A|B|C|D`)
if (!process.argv.includes('--no-open')) spawn('open', [path], { stdio: 'ignore', detached: true }).unref()
