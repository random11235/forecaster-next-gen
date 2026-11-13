// PROTOTYPE, throwaway: never merge. Spec #158 story 13
// (https://github.com/random11235/forecaster-next-gen/issues/158): "I want comparable work to belong to the milestone
// and not carry over to the next one, so that each milestone's pace is chosen for it."
//
// Question: when the EM moves on from one milestone to the next, what happens to comparable work, and how does the
// EM see it? Four variants, switchable via `?variant=A|B|C|D` (or ← → keys, or the bar at the bottom):
//   A  Kept until changed: no new-milestone moment; comparable work stays until the EM edits or removes it.
//   B  Cleared on rename: saving the milestone under a new name clears comparable work, with an Undo.
//   C  Start a new milestone: an explicit action that says what resets (comparable work) and what stays.
//   D  Carried over, flagged: kept, but marked "picked for <old milestone>" until the EM keeps or clears it.
// Comparable work's step shows the most data to choose by: each candidate's 8 weeks, median, finished, what it
// adds that isn't already counted; the picks' pace stacked on the milestone's own.
// The scene: the Shop team has finished "Checkout v2" and moves on to "Loyalty launch". All state is in memory;
// reload to reset. Run: `npm run prototype:comparable` (builds, writes dist/prototype/comparable-carry-over.html, opens it).
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { htmlPage }: typeof import('../src/app/html.js') = await import(new URL('../dist/app/html.js', import.meta.url).href)

const out = new URL('../dist/prototype/comparable-carry-over.html', import.meta.url)

const STYLE = `
  <style>
    #proto { display: flex; flex-direction: column; gap: 40px; }
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
    .strip { display: inline-flex; align-items: flex-end; gap: 1px; vertical-align: middle; }
    .strip .bar { display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
    .strip i, .col i { display: block; }
    .o { background: var(--ink); }
    .x { background: #c9a227; }
    .pace .weeks { display: flex; gap: 10px; align-items: flex-end; }
    .pace .wk { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; color: var(--muted); }
    .pace .wk b { color: var(--ink); font-size: 12px; }
    .pace .col { width: 28px; height: 90px; display: flex; flex-direction: column; justify-content: flex-end; }
    .legend { font-size: 12px; color: var(--muted); margin: 6px 0; }
    .legend i { display: inline-block; width: 10px; height: 10px; vertical-align: middle; margin: 0 3px 0 8px; }
    .paces td, .cands td, .cands th { padding: 4px 14px 4px 0; font-size: 13px; text-align: left; }
    .cands th { font-weight: 500; color: var(--muted); font-size: 12px; border-bottom: 1px solid var(--hairline); }
    .cands .num { font-variant-numeric: tabular-nums; }
    .cands button { font-size: 13px; min-height: 0; padding: 3px 8px; }
    .more summary { cursor: pointer; font-size: 14px; margin-bottom: 6px; }
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

// The tracker's choices, canned, as their finished tickets: an id each, and the week it finished in (0 = 8 weeks ago,
// 7 = this past week). Some tickets match several choices (the payments label tags some Payments rework tickets), so
// comparable work counts a ticket once however many of its picks match it.
const WEEKS = 8
function made(prefix, weekly, from = 1) {
  const tickets = []
  let n = from
  weekly.forEach((count, week) => { for (let i = 0; i < count; i++) tickets.push({ id: prefix + '-' + n++, week }) })
  return tickets
}
const REWORK = made('PAY', [2, 2, 1, 2, 2, 1, 2, 2])
const CHOICES = [
  { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"', open: 0,
    tickets: [...made('CO', [3, 4, 5, 4, 3, 4, 4, 0]), ...REWORK.slice(0, 4)] },
  { kind: 'milestone', name: 'Loyalty launch', query: 'milestone:"Loyalty launch"', open: 46, tickets: made('LOY', [0, 0, 0, 0, 0, 0, 1, 1]) },
  { kind: 'milestone', name: 'Search revamp', query: 'milestone:"Search revamp"', open: 0, tickets: made('SRCH', [6, 5, 7, 6, 6, 5, 3, 0]) },
  { kind: 'epic', name: 'Payments rework', query: 'parent-issue:shop/shop#40', open: 0, tickets: REWORK },
  { kind: 'epic', name: 'Points ledger', query: 'parent-issue:shop/shop#88', open: 12, tickets: [] },
  { kind: 'label', name: 'payments', query: 'label:"payments"', open: 3, tickets: [...made('PAY', [2, 2, 1, 2, 2, 2, 2, 1], 100), ...REWORK.slice(0, 8)] },
  { kind: 'label', name: 'rewards', query: 'label:"rewards"', open: 5, tickets: made('RWD', [1, 0, 1, 2, 1, 1, 2, 1]) },
  { kind: 'label', name: 'bug', query: 'label:"bug"', open: 21, tickets: made('BUG', [5, 7, 6, 4, 8, 6, 5, 7]) },
]
CHOICES.forEach((c) => { c.finished = c.tickets.length })

// The week each period starts, Monday, oldest first.
const WEEK_STARTS = Array.from({ length: WEEKS }, (_, i) => new Date(Date.UTC(2026, 8, 21 + 7 * i)))
const weekLabel = (i) => WEEK_STARTS[i].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** The tickets of several picks, each counted once. */
function union(picks) {
  const byId = new Map()
  picks.forEach((p) => p.tickets.forEach((t) => byId.set(t.id, t)))
  return [...byId.values()]
}
const perWeek = (tickets) => Array.from({ length: WEEKS }, (_, w) => tickets.filter((t) => t.week === w).length)
function median(xs) { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
function paceSaid(weekly) {
  const lo = Math.min(...weekly), hi = Math.max(...weekly)
  return 'median ' + median(weekly) + ' a week (' + (lo === hi ? lo : lo + '–' + hi) + ')'
}
function lastFinished(tickets) {
  if (tickets.length === 0) return 'none finished'
  const ago = WEEKS - 1 - Math.max(...tickets.map((t) => t.week))
  return ago === 0 ? 'last finished this week' : 'last finished ' + ago + (ago === 1 ? ' week ago' : ' weeks ago')
}
/** A small 8-week bar strip: own in ink below, extra above it in the accent. */
function strip(own, extra, height = 18, width = 4) {
  const top = Math.max(1, ...own.map((n, i) => n + (extra ? extra[i] : 0)))
  return '<span class="strip" style="height:' + height + 'px">' + own.map((n, i) => {
    const e = extra ? extra[i] : 0
    return '<span class="bar" style="width:' + width + 'px" title="' + weekLabel(i) + ': ' + n + (extra ? ' own + ' + e + ' comparable' : '') + '">' +
      '<i class="x" style="height:' + (e / top) * height + 'px"></i><i class="o" style="height:' + (n / top) * height + 'px"></i></span>'
  }).join('') + '</span>'
}

function fresh() {
  return {
    milestone: { name: 'Checkout v2', startDate: '2026-08-03' },
    milestonePicks: [CHOICES[0]],
    comparable: { picks: [CHOICES[3], CHOICES[5]], pickedFor: 'Checkout v2' },
    notice: undefined,      // B: what renaming just cleared, for Undo
    starting: false,        // C: the start-a-new-milestone form is open
  }
}
let state = fresh()

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const joined = (picks) => picks.map((p) => p.query).join(' OR ')
const sum = (picks, key) => key === 'finished' ? union(picks).length : picks.reduce((n, p) => n + p[key], 0)

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
    '<div class="actions"><button type="submit" class="primary">Save milestone</button></div></form>' + queryLine() + start + '</div></section>'
}

function startForm() {
  const c = state.comparable.picks
  return '<form data-form="start" class="stale"><b>Start a new milestone</b>' +
    '<div class="row"><label class="label">Name <input name="name" placeholder="Loyalty launch" required></label> ' +
    '<label class="label">Start date <input name="startDate" type="date" value="2026-11-16"></label></div>' +
    '<table class="resets">' +
    '<tr><td>Comparable work</td><td>cleared <span class="muted">(was ' + esc(c.map((p) => p.name).join(', ') || 'nothing') + ')</span></td></tr>' +
    '<tr><td>Milestone query</td><td>follows the tracker’s milestone of the new name</td></tr><tr><td>Connection, cadence, capacity</td><td>kept</td></tr></table>' +
    '<button type="submit" class="primary">Start Loyalty launch</button> <button type="button" data-act="start-cancel" class="linkish">Cancel</button></form>'
}

function queryLine() {
  const p = state.milestonePicks
  return '<p><span class="label">Milestone query</span> <code>' + esc(joined(p)) + '</code></p>' +
    '<p class="read">' + sum(p, 'open') + ' open · ' + sum(p, 'finished') + ' finished in the last 8 weeks</p>'
}

// Moving on: a milestone query that is the tracker's milestone of the old name follows the new name.
function followName(oldName, newName) {
  const p = state.milestonePicks
  if (p.length === 1 && p[0].query === 'milestone:"' + oldName + '"') {
    state.milestonePicks = [CHOICES.find((c) => c.query === 'milestone:"' + newName + '"') ??
      { kind: 'milestone', name: newName, query: 'milestone:"' + newName + '"', finished: 0, open: 0, tickets: [] }]
  }
}

function milestoneTicketsSection() {
  const p = state.milestonePicks
  const read = p.length ? '<p class="read">' + sum(p, 'open') + ' open · ' + sum(p, 'finished') + ' finished in the last 8 weeks</p>' : ''
  return '<section class="input" id="milestone-tickets"><div class="label"><span class="number">02</span><h2>Milestone’s tickets</h2><p>What picks them out in the tracker.</p></div><div class="body">' +
    chips(p, 'milestone') + pickable(p, 'milestone') +
    '<p><span class="label">Milestone query</span> ' + (p.length ? '<code>' + esc(joined(p)) + '</code>' : '<span class="muted">Nothing picked yet.</span>') + '</p>' + read + '</div></section>'
}

/** Every candidate for comparable work, with what it would add: the most data to choose by. */
function candidates(picks, ownTickets) {
  const counted = new Set(union([...picks, ...state.milestonePicks]).map((t) => t.id))
  const left = CHOICES.filter((c) => !picks.includes(c) && !state.milestonePicks.includes(c))
  const rows = left.map((c) => {
    const weekly = perWeek(c.tickets)
    const adds = c.tickets.filter((t) => !counted.has(t.id)).length
    const overlap = c.tickets.length - adds
    return '<tr><td><button data-act="pick" data-which="comparable" data-q="' + esc(c.query) + '">+ ' + esc(c.name) + '</button> <span class="kind">' + c.kind + '</span></td>' +
      '<td>' + strip(weekly) + '</td><td class="num">' + (c.tickets.length ? median(weekly) : '–') + '</td><td class="num">' + c.tickets.length + '</td>' +
      '<td class="num">' + (adds ? '+' + adds : '0') + (overlap ? ' <span class="muted">(' + overlap + ' already counted)</span>' : '') + '</td>' +
      '<td class="muted">' + lastFinished(c.tickets) + (c.open ? ' · ' + c.open + ' open' : '') + '</td></tr>'
  })
  return '<table class="cands"><thead><tr><th>Candidate</th><th>8 weeks</th><th>Median a week</th><th>Finished</th><th>Adds</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table>'
}

function paceBlock(ownTickets, comparableOnly) {
  const own = perWeek(ownTickets), extra = perWeek(comparableOnly)
  const both = own.map((n, i) => n + extra[i])
  const bars = own.map((n, i) => {
    const top = Math.max(1, ...both)
    return '<div class="wk"><div class="col" title="' + n + ' own + ' + extra[i] + ' comparable">' +
      '<i class="x" style="height:' + (extra[i] / top) * 90 + 'px"></i><i class="o" style="height:' + (n / top) * 90 + 'px"></i></div>' +
      '<b>' + both[i] + '</b><span>' + weekLabel(i) + '</span></div>'
  }).join('')
  return '<div class="pace"><div class="weeks">' + bars + '</div>' +
    '<p class="legend"><i class="o"></i> the milestone’s own <i class="x"></i> comparable work only</p>' +
    '<table class="paces"><tr><td>Pace with comparable work</td><td><b>' + paceSaid(both) + '</b></td></tr>' +
    '<tr><td>The milestone’s own alone</td><td>' + paceSaid(own) + '</td></tr></table></div>'
}

function comparableSection() {
  const c = state.comparable
  const ownTickets = union(state.milestonePicks)
  const ownIds = new Set(ownTickets.map((t) => t.id))
  const comparableOnly = union(c.picks).filter((t) => !ownIds.has(t.id))
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
  const pickChips = c.picks.length === 0 ? '<p class="muted">Nothing picked yet.</p>' : '<ul class="chips">' + c.picks.map((p, i) => {
    const others = new Set(union([...state.milestonePicks, ...c.picks.filter((q) => q !== p)]).map((t) => t.id))
    const adds = p.tickets.filter((t) => !others.has(t.id)).length
    return '<li class="chip">' + esc(p.name) + ' <span class="kind">' + p.kind + '</span> ' + strip(perWeek(p.tickets), undefined, 12, 3) +
      ' <span class="kind">' + p.tickets.length + ' finished, +' + adds + ' only here</span><button data-act="remove" data-which="comparable" data-i="' + i + '" aria-label="Remove">×</button></li>'
  }).join('') + '</ul>'
  const read = '<p class="read">' + (ownTickets.length + comparableOnly.length) + ' finished in the last 8 weeks: ' + ownTickets.length + ' the milestone’s own' +
    (c.picks.length ? ', ' + comparableOnly.length + ' comparable' : '') + '</p>'
  const button = c.picks.length ? 'Next' : 'Skip'
  return '<section class="input" id="comparable-work"><div class="label"><span class="number">02</span><h2>Comparable work</h2>' + owner + '<p>Optional. Work like this milestone’s, to measure its pace from. The milestone’s own finished tickets always count.</p></div><div class="body">' +
    notice + flag + pickChips +
    '<p><span class="label">Comparable-work query</span> ' + (c.picks.length ? '<code>' + esc(joined(c.picks)) + '</code>' : '<span class="muted">None: pace comes from the milestone’s own tickets.</span>') + '</p>' +
    read + paceBlock(ownTickets, comparableOnly) +
    '<details class="more" open><summary>Add comparable work</summary>' + candidates(c.picks, ownTickets) + '</details>' +
    '<div class="actions"><button class="primary">' + button + '</button></div></div></section>'
}

function render() {
  const main = document.getElementById('proto')
  main.innerHTML = '<p class="proto-banner">PROTOTYPE · variant ' + variant + ': ' + VARIANTS[variant] + ' · try moving on from “Checkout v2” to “Loyalty launch” · reload to reset</p>' +
    milestoneSection() + comparableSection() +
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
    followName(state.milestone.name, name)
    state.milestone = { name, startDate }
  }
  if (e.target.dataset.form === 'start') {
    followName(state.milestone.name, name)
    state.milestone = { name, startDate }
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
