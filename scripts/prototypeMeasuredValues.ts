// PROTOTYPE, throwaway: never merge. Wayfinder ticket "How the milestone screen marks measured values and proposals"
// (https://github.com/random11235/forecaster-next-gen/issues/129).
//
// Three variants of the Inputs screen's Milestone and Pace sections (plus a strip of the Milestone forecast screen),
// switchable via `?variant=A|B|C`, showing values proposed from a connected tracker: measured, edited by hand, and a
// new read that differs from what the EM accepted. `?scenario=` picks the canned starting state. All state is in
// memory; reload to reset. Run: `npm run prototype:measured` (builds, writes dist/prototype/measured-values.html, opens it).
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { htmlPage }: typeof import('../src/app/html.js') = await import(new URL('../dist/app/html.js', import.meta.url).href)

const out = new URL('../dist/prototype/measured-values.html', import.meta.url)

const STYLE = `
  <style>
    .proto-banner { font-size: 12px; color: var(--risk); font-family: var(--mono); }
    .strip { border: 1px dashed var(--border); border-radius: 8px; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
    .strip .where { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--faint); }
    .strip .head { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
    .tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
      padding: 1px 6px; border-radius: 4px; vertical-align: middle; white-space: nowrap; }
    .tag.measured { background: #DDE8EA; color: #1F5F6B; }
    .tag.hand { background: #F1E4D0; color: #7A4A12; }
    .tag.typed { background: var(--active); color: var(--text-2); }
    .tag.new { background: #F6DDD4; color: var(--risk); }
    .prov { font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
    .linkish { border: 0; background: none; padding: 0; min-height: 0; color: var(--link); text-decoration: underline; cursor: pointer; font-size: 12px; }
    .proposal { border-left: 3px solid var(--risk); background: #FBF1EC; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
    .proposal .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .proposal button.primary { min-height: 32px; padding: 0 14px; font-size: 13px; }
    .cells { display: flex; gap: 4px; flex-wrap: wrap; }
    .cell { min-width: 56px; padding: 6px 4px 4px; border: 1px solid var(--hairline); border-radius: 4px; text-align: center; display: flex; flex-direction: column; gap: 2px; }
    .cell .n { font-family: var(--mono); font-size: 18px; font-weight: 600; }
    .cell .w { font-size: 10px; color: var(--faint); white-space: nowrap; }
    .cell.quiet { background: repeating-linear-gradient(135deg, transparent 0 5px, var(--hairline) 5px 6px); }
    .cell.quiet .n { color: var(--faint); }
    .cell input.n { width: 48px; border: 0; background: transparent; text-align: center; color: var(--ink); padding: 0; -moz-appearance: textfield; }
    .cell input.n::-webkit-inner-spin-button { -webkit-appearance: none; }
    label.cell { cursor: text; }
    label.cell:focus-within { border-color: var(--ink); }
    .cell.handcell { border-color: #C9A66B; }
    .quietnote { font-size: 12px; color: var(--muted); line-height: 1.45; max-width: 620px; }
    table.review { border-collapse: collapse; width: 100%; font-size: 13px; }
    table.review th { text-align: left; font-size: 11px; font-weight: 600; color: var(--faint); text-transform: uppercase; letter-spacing: 0.06em; padding: 0 12px 8px 0; border-bottom: 1px solid var(--ink); }
    table.review td { padding: 10px 12px 10px 0; border-bottom: 1px solid var(--hairline); vertical-align: top; }
    table.review td.num { font-family: var(--mono); }
    table.review tr.differs td { background: #FBF1EC; }
    .minibars { display: inline-flex; gap: 2px; align-items: flex-end; height: 28px; vertical-align: middle; margin-right: 6px; }
    .minibars span { width: 7px; background: var(--bar); border-radius: 1px 1px 0 0; }
    .minibars span.zero { height: 2px !important; background: var(--risk); }
    .banner { display: flex; justify-content: space-between; gap: 12px; align-items: center; background: #FBF1EC; border: 1px solid #EBC9BB; border-radius: 6px; padding: 8px 12px; font-size: 13px; }
    table.ledger { border-collapse: collapse; font-size: 13px; }
    table.ledger th { text-align: left; font-size: 11px; font-weight: 600; color: var(--faint); padding: 0 16px 6px 0; border-bottom: 1px solid var(--ink); white-space: nowrap; }
    table.ledger td { padding: 6px 16px 6px 0; border-bottom: 1px solid var(--hairline); white-space: nowrap; }
    table.ledger td.gh { font-family: var(--mono); color: #1F5F6B; }
    table.ledger td.uses input { width: 56px; font-size: 15px; text-align: center; }
    table.ledger tr.quiet td.gh { background: repeating-linear-gradient(135deg, transparent 0 5px, var(--hairline) 5px 6px); }
    table.ledger tr.out td { color: var(--faint); text-decoration: line-through; }
    table.ledger tr.out td.uses input { opacity: .4; }
    table.ledger tfoot td { font-weight: 600; border-bottom: 0; }
    .copy { min-height: 26px; padding: 0 8px; font-size: 12px; }
    details.dchip { display: inline-block; position: relative; vertical-align: middle; }
    details.dchip > summary, span.dchip { list-style: none; cursor: pointer; font-size: 12px; color: var(--muted); border: 1px solid var(--hairline); border-radius: 999px; padding: 1px 8px; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
    span.dchip.same { cursor: default; color: #1F5F6B; border-color: transparent; }
    details.dchip > summary::-webkit-details-marker { display: none; }
    details.dchip[open] > summary { border-color: var(--ink); color: var(--ink); }
    .dpanel { position: absolute; z-index: 5; top: calc(100% + 6px); right: 0; width: min(560px, 80vw); background: var(--page); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: var(--ink); white-space: normal; }
    .dpanel .row { display: flex; gap: 8px; }
    .dpanel button.primary { min-height: 32px; padding: 0 14px; font-size: 13px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--risk); display: inline-block; }
    .dmark { font-size: 12px; color: var(--faint); }
    details.dother { border-top: 1px solid var(--hairline); padding-top: 8px; display: flex; flex-direction: column; gap: 10px; }
    details.dother > summary { cursor: pointer; font-size: 13px; color: var(--muted); }
    details.dother[open] { display: flex; flex-direction: column; gap: 12px; }
    details.dother .row { display: flex; gap: 8px; margin-top: 10px; }
    .dgraph { display: inline-flex; gap: 4px; align-items: flex-end; vertical-align: middle; }
    .dgraph .col { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 18px; }
    .dgraph .bar { width: 14px; background: var(--bar); border-radius: 2px 2px 0 0; }
    .dgraph .bar.zero { background: var(--risk); }
    .dgraph .v { font-size: 10px; color: var(--faint); line-height: 12px; }
    .dline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-size: 14px; }
    .dbig { font-size: 30px; font-variant-numeric: tabular-nums; }
    .dquiet { font-size: 12px; color: var(--risk); }
    .dfollow { border-top: 1px solid var(--hairline); padding-top: 8px; display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
    details.dother.inline { border: 0; padding: 0; flex-basis: 100%; }
    .dseg { display: inline-flex; border: 1px solid var(--hairline); border-radius: 6px; overflow: hidden; align-self: flex-start; }
    .dseg button { border: 0; border-radius: 0; background: transparent; min-height: 28px; padding: 0 12px; font-size: 13px; color: var(--muted); }
    .dseg button + button { border-left: 1px solid var(--hairline); }
    .dseg button.on { background: var(--ink); color: var(--page); }
    details.dread { flex-basis: 100%; font-size: 13px; }
    details.dread > summary { cursor: pointer; color: var(--ink); }
    details.dread.stopped > summary b, details.dread.changing > summary b { color: var(--risk); }
    details.dread p { margin: 6px 0 0; max-width: 62ch; color: var(--muted); line-height: 1.5; }
    details.dread .row { display: flex; gap: 8px; margin-top: 8px; }
    .switcher { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 10; display: flex; gap: 10px; align-items: center;
      background: #111; color: #fff; padding: 8px 12px; border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.3); font-size: 13px; }
    .switcher button { color: #fff; border-color: #444; min-height: 28px; }
    .switcher select { font: inherit; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; padding: 3px 6px; }
    details.state { font-size: 12px; margin-bottom: 70px; }
    details.state pre { background: var(--sidebar); padding: 12px; border-radius: 6px; overflow: auto; font-family: var(--mono); font-size: 11px; }
  </style>`

const MAIN = `${STYLE}
    <p class="proto-banner">PROTOTYPE · canned data · nothing is saved · reload resets</p>
    <div id="proto"></div>
    <details class="state" open><summary>State (what would be stored)</summary><pre id="state"></pre></details>
    <div class="switcher" id="switcher"></div>`

const SCRIPT = String.raw`
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const wk = (iso) => { const [, m, d] = iso.split('-').map(Number); return 'w/c ' + d + ' ' + MONTHS[m - 1] }
const WEEKS = ['2026-08-31','2026-09-07','2026-09-14','2026-09-21','2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26']
const zip = (weeks, ns) => weeks.map((week, i) => ({ week, n: ns[i] }))
// Two reads of GitHub: last week's, and today's. Comparable work ended in w/c 5 Oct; the team has been on KTLO since.
const READS = {
  previous: { at: '28 Oct 09:05', tickets: 34, cells: zip(WEEKS.slice(0, 8), [5, 6, 8, 5, 7, 6, 0, 0]) },
  current: { at: '4 Nov 09:12', tickets: 38, cells: zip(WEEKS.slice(1), [6, 8, 5, 7, 6, 0, 0, 0]) },
}
const key = (cells) => cells ? JSON.stringify(cells.map(({ week, n }) => [week, n])) : null
const measuredCells = (cells) => cells.map(({ week, n }) => ({ week, n, measured: n }))

const SCENARIOS = {
  first: { name: 'First read after connecting', make: () => ({
    mode: 'range', range: { low: 4, high: 8 },
    tickets: { value: 30, origin: 'typed', seen: null },
    counts: { cells: null, origin: 'typed', seen: null } }) },
  inStep: { name: 'Accepted, in step with GitHub', make: () => ({
    mode: 'counts', range: { low: 4, high: 8 },
    tickets: { value: 38, origin: 'measured', at: READS.current.at, seen: 38 },
    counts: { cells: measuredCells(READS.current.cells), origin: 'measured', at: READS.current.at, seen: key(READS.current.cells) } }) },
  newRead: { name: 'New read differs from accepted', make: () => ({
    mode: 'counts', range: { low: 4, high: 8 },
    tickets: { value: 34, origin: 'measured', at: READS.previous.at, seen: 34 },
    counts: { cells: measuredCells(READS.previous.cells), origin: 'measured', at: READS.previous.at, seen: key(READS.previous.cells) } }) },
  follow: { name: 'Following GitHub, a new read arrives', make: () => ({
    mode: 'counts', range: { low: 4, high: 8 }, follow: { tickets: true, counts: true },
    tickets: { value: 34, origin: 'measured', at: READS.previous.at, seen: 34, own: { value: 30 } },
    counts: { cells: measuredCells(READS.previous.cells), origin: 'measured', at: READS.previous.at, seen: key(READS.previous.cells) } }) },
  handNew: { name: 'Edited by hand, then a new read', make: () => ({
    mode: 'counts', range: { low: 4, high: 8 },
    tickets: { value: 40, origin: 'hand', seen: 34 },
    counts: { cells: measuredCells(READS.previous.cells).slice(0, 6), origin: 'hand', seen: key(READS.previous.cells) } }) },
  handInStep: { name: 'Edited by hand, no new read', make: () => ({
    mode: 'counts', range: { low: 4, high: 8 },
    tickets: { value: 40, origin: 'hand', seen: 38 },
    counts: { cells: measuredCells(READS.current.cells).slice(0, 5), origin: 'hand', seen: key(READS.current.cells) } }) },
}
const VARIANTS = { A: 'Marked in place', B: 'Review panel', C: 'Side-by-side ledger', D: 'Quiet, on demand' }

const params = new URLSearchParams(location.search)
let variant = VARIANTS[params.get('variant')] ? params.get('variant') : 'A'
let scenario = SCENARIOS[params.get('scenario')] ? params.get('scenario') : 'newRead'
const tracker = READS.current
let state = SCENARIOS[scenario].make()
let editing = {}
const log = []

// ---- derived status of a value against the tracker's current read ----
function trackerVal(field) { return field === 'tickets' ? tracker.tickets : key(tracker.cells) }
function acceptedVal(field) { return field === 'tickets' ? state.tickets.value : key(state.counts.cells) }
function status(field) {
  const v = state[field], tv = trackerVal(field), fresh = v.seen !== tv
  if (v.origin === 'typed' || acceptedVal(field) === null) return fresh ? 'proposed' : 'typed'
  if (v.origin === 'measured') return acceptedVal(field) === tv ? 'measured' : fresh ? 'newRead' : 'kept'
  return fresh ? 'handNewRead' : 'hand'
}
const pending = () => ['tickets', 'counts'].filter((f) => ['proposed', 'newRead', 'handNewRead'].includes(status(f)))

// ---- actions ----
function act(name, fn) { fn(); log.push(name); render() }
// the EM's own value (typed, or edited by hand) before GitHub's was used: kept, never overwritten
function ownOf(field) {
  const v = state[field]
  if (v.origin === 'measured' || acceptedVal(field) === null) return v.own
  return field === 'tickets' ? { value: v.value } : { cells: v.cells }
}
function accept(field) { const own = ownOf(field); act('accept ' + field, () => {
  if (field === 'tickets') state.tickets = { value: tracker.tickets, origin: 'measured', at: tracker.at, seen: tracker.tickets }
  else { state.counts = { cells: measuredCells(tracker.cells), origin: 'measured', at: tracker.at, seen: key(tracker.cells) } }
  state[field].own = own
}) }
function switchBack(field) { act('switch back to own ' + field, () => {
  const own = state[field].own
  state[field] = field === 'tickets' ? { value: own.value, origin: 'hand', seen: tracker.tickets } : { cells: own.cells, origin: 'hand', seen: key(tracker.cells) }
}) }
function setRange(low, high) { act('edit range', () => { state.range = { low, high } }) }
// a line offering the EM's own value back, while the forecast uses GitHub's
function ownLine(field) {
  const own = state[field].origin === 'measured' && state[field].own
  if (!own) return ''
  const text = field === 'tickets' ? own.value : nums(own.cells)
  return '<span>Yours was ' + esc(text) + '</span><button class="linkish" onclick="switchBack(\'' + field + '\')">Switch back</button>'
}
// the range, kept whichever pace the forecast uses
// says which pace the forecast uses; accepting GitHub's counts never changes it
function countsInUse() {
  if (!state.counts.cells) return ''
  return state.mode === 'counts' ? '' : '<p class="quietnote">Kept, not in use: the forecast uses your range. <button class="linkish" onclick="setMode(\'counts\')">Use typed counts instead</button></p>'
}
function rangeBlock() {
  return '<h3>Range' + (state.mode === 'range' ? '' : ' · kept, not in use') + '</h3><div class="pace"><label>Low <input type="number" id="r-lo" value="' + state.range.low + '" onchange="setRange(Number(this.value),Number(document.getElementById(\'r-hi\').value))"></label><span class="to">to</span><label>High <input type="number" id="r-hi" value="' + state.range.high + '" onchange="setRange(Number(document.getElementById(\'r-lo\').value),Number(this.value))"></label><span class="unit">tickets per week ' + tag('hand', '✎ By hand') + '</span></div>'
}
function keep(field) { act('keep mine: ' + field, () => { state[field].seen = trackerVal(field); editing['show-' + field] = false }) }
function show(field) { act('show GitHub\'s ' + field, () => { editing['show-' + field] = true }) }
function editTickets(n) { act('edit tickets by hand', () => {
  if ((state.follow || {}).tickets && n !== tracker.tickets) state.follow.tickets = false
  state.tickets = n === tracker.tickets ? { value: n, origin: 'measured', at: tracker.at, seen: n } : { value: n, origin: 'hand', seen: tracker.tickets }
  editing.tickets = false }) }
function editCountsList(text) { act('edit counts by hand (list)', () => {
  const ns = text.split(/[ ,]+/).filter(Boolean).map(Number)
  state.counts = { cells: ns.map((n) => ({ week: null, n, measured: null })), origin: 'hand', seen: key(tracker.cells) }
  editing.counts = false }) }
function editCell(week, n) { act('edit ' + wk(week) + ' by hand', () => {
  const cells = (state.counts.cells || []).map((c) => c.week === week ? { ...c, n } : c)
  if (!cells.some((c) => c.week === week)) { cells.push({ week, n, measured: null }); cells.sort((a, b) => a.week < b.week ? -1 : 1) }
  const allMeasured = cells.every((c) => c.n === c.measured) && key(cells) === key(tracker.cells)
  state.counts = { cells, origin: allMeasured ? 'measured' : 'hand', at: tracker.at, seen: key(tracker.cells) } }) }
function leaveOut(week, out) { act((out ? 'leave out ' : 'put back ') + wk(week), () => {
  const t = tracker.cells.find((c) => c.week === week)
  let cells = (state.counts.cells || []).filter((c) => c.week !== week)
  if (!out && t) { cells.push({ week, n: t.n, measured: t.n }); cells.sort((a, b) => a.week < b.week ? -1 : 1) }
  state.counts = { ...state.counts, cells, origin: key(cells) === key(tracker.cells) ? 'measured' : 'hand', seen: key(tracker.cells) } }) }
function setMode(mode) { act('pace mode ' + mode, () => { state.mode = mode }) }

// ---- shared bits ----
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';')
const nums = (cells) => cells ? cells.map((c) => c.n).join(', ') : '–'
const span = (cells) => cells && cells.length && cells[0].week ? wk(cells[0].week) + ' – ' + wk(cells[cells.length - 1].week) : 'no weeks attached'
function quietRun(cells) { let k = 0; for (let i = cells.length - 1; i >= 0 && cells[i].n === 0; i--) k++; return k }
function quietNote(cells) {
  const q = cells.filter((c) => c.n === 0).length
  if (!q) return ''
  const run = quietRun(cells)
  const tail = run ? ' The last ' + run + ' are in a row (' + wk(cells[cells.length - run].week) + ' on): no milestone or comparable work finished since, so the team was likely on other work.' : ''
  return '<p class="quietnote">' + q + ' of ' + cells.length + ' weeks are quiet: they count as 0 and slow the pace.' + tail + ' If those weeks don’t say how fast the milestone will go, edit the counts by hand.</p>'
}
function tag(kind, text) { return '<span class="tag ' + kind + '">' + text + '</span>' }
function provTag(field) {
  const s = status(field), v = state[field]
  if (s === 'measured') return tag('measured', '● Measured · GitHub ' + v.at)
  if (s === 'newRead' || s === 'kept') return tag('measured', '● Measured · GitHub ' + v.at)
  if (s === 'hand' || s === 'handNewRead') return tag('hand', '✎ By hand')
  return tag('hand', '✎ By hand')
}
function cellsHtml(cells, measuredFlags) {
  return '<div class="cells">' + cells.map((c) =>
    '<div class="cell' + (c.n === 0 ? ' quiet' : '') + (measuredFlags && c.measured !== null && c.n !== c.measured || measuredFlags && c.measured === null ? ' handcell' : '') + '"><span class="n">' + c.n + '</span><span class="w">' + (c.week ? wk(c.week).replace('w/c ', '') : '—') + (c.n === 0 ? ' · quiet' : '') + '</span></div>').join('') + '</div>'
}
function minibars(cells) {
  if (!cells) return '–'
  const top = Math.max(1, ...cells.map((c) => c.n))
  return '<span class="minibars">' + cells.map((c) => '<span class="' + (c.n === 0 ? 'zero' : '') + '" style="height:' + Math.round(c.n / top * 28) + 'px"></span>').join('') + '</span>'
}
// a stand-in, not the real forecast: just so changes visibly move a date
function standIn() {
  const ns = state.mode === 'counts' && state.counts.cells ? state.counts.cells.map((c) => c.n) : [state.range.low, state.range.high]
  const mean = ns.reduce((a, b) => a + b, 0) / Math.max(1, ns.length)
  if (!mean) return 'no date'
  const d = new Date(2026, 10, 4 + Math.ceil(state.tickets.value * 1.5 / mean) * 7)
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
}
function paceWords() {
  return state.mode === 'counts' && state.counts.cells ? 'typed counts ' + nums(state.counts.cells) + ' a week' : 'range ' + state.range.low + '–' + state.range.high + ' a week'
}
function section(n, name, hint, body) {
  return '<section class="input"><div class="label"><span class="number">0' + n + '</span><h2>' + name + '</h2><p>' + hint + '</p></div><div class="body">' + body + '</div></section>'
}
function modeRadios() {
  return '<fieldset class="levels">' + ['range', 'counts'].map((m) => '<label><input type="radio" name="mode" value="' + m + '"' + (state.mode === m ? ' checked' : '') + ' onchange="setMode(\'' + m + '\')"> ' + (m === 'range' ? 'Range' : 'Typed counts') + '</label>').join('') + '</fieldset>'
}
function ticketsEditor() {
  return '<div class="pace"><label>Tickets remaining <input type="number" id="t-in" value="' + state.tickets.value + '"></label><button onclick="editTickets(Number(document.getElementById(\'t-in\').value))">Save</button><button onclick="editing.tickets=false;render()">Cancel</button></div>'
}
function countsEditor() {
  return '<div class="fields"><label class="wide">Tickets done each week, oldest first <input type="text" id="c-in" value="' + esc(nums(state.counts.cells || tracker.cells)) + '"></label></div><div class="row" style="display:flex;gap:8px"><button onclick="editCountsList(document.getElementById(\'c-in\').value)">Save counts</button><button onclick="editing.counts=false;render()">Cancel</button></div>'
}

// ---- Variant A: each value marked where it sits; a new read appears under the value it would change ----
function proposalA(field) {
  const s = status(field)
  const reopened = editing['show-' + field] && acceptedVal(field) !== trackerVal(field)
  if (!reopened && !['proposed', 'newRead', 'handNewRead'].includes(s)) return ''
  const mine = field === 'tickets' ? state.tickets.value : nums(state.counts.cells)
  const theirs = field === 'tickets' ? tracker.tickets : nums(tracker.cells)
  const head = reopened ? 'GitHub reads' : s === 'proposed' ? 'GitHub proposes' : 'GitHub now reads'
  const was = s === 'newRead' ? ' (you accepted ' + mine + ' from the read on ' + state[field].at + ')' : s === 'handNewRead' ? ' (you edited it to ' + mine + ' by hand)' : ''
  const body = field === 'tickets'
    ? '<div><b>' + head + ' ' + theirs + '</b> tickets remaining, read ' + tracker.at + was + '.</div>'
    : '<div><b>' + head + ' these 8 weeks</b>, ' + span(tracker.cells) + ', read ' + tracker.at + was + ':</div>' + cellsHtml(tracker.cells) + quietNote(tracker.cells)
  const keepLabel = reopened ? 'Hide' : s === 'proposed' ? (field === 'tickets' ? 'Keep ' + mine : 'Not now') : 'Keep ' + (field === 'tickets' ? mine : 'mine')
  return '<div class="proposal">' + body + '<div class="row"><button class="primary" onclick="accept(\'' + field + '\')">' + (field === 'tickets' ? 'Use ' + theirs : 'Take these counts') + '</button><button onclick="keep(\'' + field + '\')">' + keepLabel + '</button></div></div>'
}
function revertA(field) {
  const s = status(field)
  if (!['hand', 'kept', 'typed'].includes(s) || editing['show-' + field] || acceptedVal(field) === trackerVal(field)) return ''
  return '<span>GitHub reads ' + (field === 'tickets' ? tracker.tickets : nums(tracker.cells)) + '</span><button class="linkish" onclick="show(\'' + field + '\')">Show</button>' +
    (s === 'hand' ? '<button class="linkish" onclick="accept(\'' + field + '\')">Revert to measured</button>' : '')
}
function variantA() {
  const t = state.tickets
  const tickets = editing.tickets ? ticketsEditor()
    : '<div class="pace"><span style="font-family:var(--mono);font-size:32px;font-weight:600">' + t.value + '</span><span class="unit">tickets remaining</span></div>' +
      '<div class="prov">' + provTag('tickets') + revertA('tickets') + ownLine('tickets') + '<button class="linkish" onclick="editing.tickets=true;render()">Edit by hand</button></div>' + proposalA('tickets')
  const c = state.counts
  const counts = editing.counts ? countsEditor()
    : (c.cells ? cellsHtml(c.cells, c.origin === 'hand') + '<div class="prov">' + provTag('counts') + '<span>' + c.cells.length + ' weeks, ' + span(c.cells) + '</span>' + revertA('counts') + ownLine('counts') + '<button class="linkish" onclick="editing.counts=true;render()">Edit by hand</button></div>' + (c.origin === 'measured' && status('counts') !== 'newRead' ? quietNote(c.cells) : '')
      : '<p class="note">No typed counts yet.</p><div class="prov">' + revertA('counts') + '</div>') + proposalA('counts')
  const strip = '<div class="strip"><span class="where">On the Milestone forecast</span><span class="context">Checkout v2 · ' + t.value + ' tickets remaining ' + provTag('tickets') + '</span><span class="head">Starting 4 Nov 2026: 85% confident of finishing by ' + standIn() + '</span><span class="note">Pace: ' + paceWords() + ' ' + (state.mode === 'counts' ? provTag('counts') : '') + '</span>' +
    (pending().length ? '<span class="note">' + tag('new', 'New from GitHub') + ' ' + pending().length + ' value' + (pending().length > 1 ? 's differ' : ' differs') + ' from what the forecast uses. <a href="#pace">Review on Inputs</a></span>' : '') + '</div>'
  return strip + section(1, 'Milestone', 'Tickets remaining, measured from the milestone query.', tickets) +
    '<div id="pace">' + section(2, 'Pace', 'Typed counts measured from comparable work: the 8 most recent whole weeks, quiet ones as 0.', modeRadios() + rangeBlock() + '<h3>Typed counts</h3>' + countsInUse() + counts) + '</div>'
}

// ---- Variant B: one review panel lists every value GitHub reads differently; the fields stay plain ----
function variantB() {
  const rows = ['tickets', 'counts'].map((f) => {
    const s = status(f), differs = ['proposed', 'newRead', 'handNewRead'].includes(s)
    const uses = f === 'tickets' ? '<span class="num">' + state.tickets.value + '</span>' : (state.mode === 'range' ? '<span class="quietnote">Range ' + state.range.low + '–' + state.range.high + ' in use. Typed counts kept:</span><br>' : '') + minibars(state.counts.cells) + nums(state.counts.cells)
    const gh = f === 'tickets' ? '<span class="num">' + tracker.tickets + '</span>' : minibars(tracker.cells) + nums(tracker.cells) + (tracker.cells.some((c) => c.n === 0) ? '<br><span class="quietnote">' + tracker.cells.filter((c) => c.n === 0).length + ' quiet weeks (0), the last ' + quietRun(tracker.cells) + ' in a row</span>' : '')
    const action = differs ? '<button class="primary" style="min-height:30px;padding:0 12px;font-size:12px" onclick="accept(\'' + f + '\')">Use GitHub’s</button> <button class="copy" onclick="keep(\'' + f + '\')">Keep mine</button>'
      : s === 'measured' ? '<span class="quietnote">Same</span>' : '<button class="linkish" onclick="accept(\'' + f + '\')">Use GitHub’s</button>'
    return '<tr class="' + (differs ? 'differs' : '') + '"><td>' + (f === 'tickets' ? 'Tickets remaining' : 'Typed counts<br><span class="quietnote">' + span(tracker.cells) + '</span>') + '</td><td>' + uses + '<br>' + provTag(f) + (ownLine(f) ? '<div class="prov">' + ownLine(f) + '</div>' : '') + '</td><td>' + gh + '</td><td>' + action + '</td></tr>'
  }).join('')
  const n = pending().length
  const panel = '<section class="brief"><div class="heading"><h2>From GitHub · read ' + tracker.at + '</h2>' + (n ? '<button class="copy" onclick="act(\'accept all\',()=>{});accept(\'tickets\');accept(\'counts\')">Use all GitHub’s values</button>' : '<span class="quietnote">Everything matches</span>') + '</div>' +
    '<table class="review"><thead><tr><th>Value</th><th>Forecast uses</th><th>GitHub reads</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></section>'
  const banner = n ? '<div class="banner"><span>GitHub reads ' + n + ' value' + (n > 1 ? 's' : '') + ' differently from what this forecast uses.</span><a href="#review">Review</a></div>' : ''
  const strip = '<div class="strip"><span class="where">On the Milestone forecast</span>' + banner + '<span class="context">Checkout v2 · ' + state.tickets.value + ' tickets remaining</span><span class="head">Starting 4 Nov 2026: 85% confident of finishing by ' + standIn() + '</span><span class="note">Pace: ' + paceWords() + '</span></div>'
  const word = (f) => { const s = status(f); return s === 'measured' || s === 'newRead' || s === 'kept' ? 'measured' : 'by hand' }
  const tickets = '<div class="fields"><label>Tickets remaining · ' + word('tickets') + ' <input type="number" value="' + state.tickets.value + '" onchange="editTickets(Number(this.value))"></label></div>'
  const counts = '<div class="fields"><label class="wide">Typed counts · ' + word('counts') + ' <input type="text" value="' + esc(state.counts.cells ? nums(state.counts.cells) : '') + '" placeholder="6, 4, 9" onchange="editCountsList(this.value)"></label></div>'
  return strip + '<div id="review">' + panel + '</div>' + section(1, 'Milestone', 'Type over any value to edit it by hand.', tickets) + section(2, 'Pace', 'A range, or typed counts oldest first. Both are kept.', modeRadios() + rangeBlock() + '<h3>Typed counts</h3>' + countsInUse() + counts)
}

// ---- Variant C: GitHub's column beside the forecast's, week by week; each cell carries its own origin ----
function variantC() {
  const t = state.tickets, ts = status('tickets')
  const tRow = '<table class="ledger"><thead><tr><th></th><th>GitHub reads · ' + tracker.at + '</th><th>Forecast uses</th><th></th></tr></thead><tbody><tr><td>Tickets remaining</td><td class="gh">' + tracker.tickets + '</td><td class="uses"><input type="number" value="' + t.value + '" onchange="editTickets(Number(this.value))"></td><td>' +
    (t.value === tracker.tickets ? tag('measured', '● same') : '<button class="copy" onclick="accept(\'tickets\')">← use ' + tracker.tickets + '</button> ' + (ts.startsWith('hand') ? tag('hand', '✎ by hand') : ts === 'typed' || ts === 'proposed' ? tag('hand', '✎ by hand') : tag('measured', 'from ' + t.at)) + (['proposed', 'newRead', 'handNewRead'].includes(ts) ? ' ' + tag('new', 'new read') : '')) + '</td></tr></tbody></table>' + (ownLine('tickets') ? '<div class="prov">' + ownLine('tickets') + '</div>' : '')
  const accepted = state.counts.cells || []
  const weeks = [...new Set([...tracker.cells.map((c) => c.week), ...accepted.map((c) => c.week).filter(Boolean)])].sort()
  const rows = weeks.map((w) => {
    const g = tracker.cells.find((c) => c.week === w), a = accepted.find((c) => c.week === w)
    const out = g && !a && accepted.length > 0 && w < accepted[accepted.length - 1].week
    let mark = ''
    if (!g) mark = '<span class="quietnote">older than GitHub’s 8 weeks</span> <button class="copy" onclick="leaveOut(\'' + w + '\',true)">drop</button>'
    else if (!a) mark = state.counts.cells === null ? tag('new', 'proposed') : '<button class="copy" onclick="leaveOut(\'' + w + '\',false)">' + (accepted.length && w > accepted[accepted.length - 1].week ? '← add new week' : 'put back') + '</button>'
    else if (a.n !== g.n) mark = '<button class="copy" onclick="editCell(\'' + w + '\',' + g.n + ')">← use ' + g.n + '</button> ' + tag(a.measured === a.n ? 'measured' : 'hand', a.measured === a.n ? 'older read' : '✎ by hand')
    else mark = tag('measured', '●') + (g.n === 0 ? ' <span class="quietnote">quiet: nothing comparable finished</span>' : '') + ' <button class="linkish" onclick="leaveOut(\'' + w + '\',true)">leave out</button>'
    return '<tr class="' + (g && g.n === 0 ? 'quiet ' : '') + (out ? 'out' : '') + '"><td>' + wk(w) + '</td><td class="gh">' + (g ? g.n : '') + '</td><td class="uses">' + (a ? '<input type="number" value="' + a.n + '" onchange="editCell(\'' + w + '\',Number(this.value))">' : '–') + '</td><td>' + mark + '</td></tr>'
  }).join('')
  const unweeked = accepted.filter((c) => !c.week)
  const mean = (cs) => cs.length ? (cs.reduce((s, c) => s + c.n, 0) / cs.length).toFixed(1) : '–'
  const cTable = (unweeked.length ? '<p class="quietnote">The forecast uses counts typed as a list (' + nums(unweeked) + '), with no weeks attached. <button class="copy" onclick="accept(\'counts\')">Replace with GitHub’s weeks</button></p>' : '') +
    '<table class="ledger"><thead><tr><th>Week</th><th>GitHub reads</th><th>Forecast uses</th><th></th></tr></thead><tbody>' + (unweeked.length ? '' : rows) + '</tbody><tfoot><tr><td>Average</td><td class="gh">' + mean(tracker.cells) + '</td><td>' + mean(accepted) + '</td><td>' +
    (key(accepted) !== key(tracker.cells) ? '<button class="copy" onclick="accept(\'counts\')">← use all of GitHub’s</button>' : '') + '</td></tr></tfoot></table>' + (ownLine('counts') ? '<div class="prov">' + ownLine('counts') + '</div>' : '') + quietNote(tracker.cells)
  const diffs = pending().length
  const strip = '<div class="strip"><span class="where">On the Milestone forecast</span><span class="context">Checkout v2 · ' + t.value + ' tickets remaining</span><span class="head">Starting 4 Nov 2026: 85% confident of finishing by ' + standIn() + '</span><span class="note">Pace: ' + paceWords() + '</span><span class="note">Inputs: ' +
    (ts === 'measured' ? 'tickets from GitHub' : ts.startsWith('hand') ? 'tickets by hand' : 'tickets ' + (ts === 'typed' || ts === 'proposed' ? 'by hand' : 'from an older read')) + ' · ' +
    (state.counts.cells ? (state.counts.cells.filter((c) => c.measured === c.n).length + ' of ' + state.counts.cells.length + ' weeks from GitHub') : 'no counts') + (diffs ? ' · <a href="#ledger">' + diffs + ' differ from today’s read</a>' : '') + '</span></div>'
  return strip + section(1, 'Milestone', 'GitHub’s reading beside the value the forecast uses.', tRow) + '<div id="ledger">' + section(2, 'Pace', 'Week by week: what GitHub counts, and what the forecast uses. Type over a week to edit it, or leave it out.', modeRadios() + rangeBlock() + '<h3>Typed counts</h3>' + countsInUse() + cTable) + '</div>'
}


// ---- what the weeks show: the pace-stability patterns (docs/research/pace-stability), read from these counts ----
// Rules follow research/pace-stability/classify.mjs; actions follow research/pace-pattern-actions.md.
// A run of quiet weeks at the end comes first: it is a step to 0 (a "team change"), the most specific reading.
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
const sdv = (a) => { const m = avg(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)) }
function mkP(a) {
  const n = a.length; let S = 0
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(a[j] - a[i])
  const ties = new Map(); for (const x of a) ties.set(x, (ties.get(x) || 0) + 1)
  let tt = 0; for (const t of ties.values()) tt += t * (t - 1) * (2 * t + 5)
  const v = (n * (n - 1) * (2 * n + 5) - tt) / 18; if (v <= 0) return 1
  const z = S === 0 ? 0 : (S - Math.sign(S)) / Math.sqrt(v), t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2)
  return 2 * (1 - 0.5 * (1 + y))
}
function lag1v(a) { const m = avg(a); let num = 0, den = 0; for (let i = 0; i < a.length; i++) { den += (a[i] - m) ** 2; if (i) num += (a[i] - m) * (a[i - 1] - m) } return den ? num / den : 0 }
function dateFor(ns) {
  const m = avg(ns); if (!m) return 'no date'
  const d = new Date(2026, 10, 4 + Math.ceil(state.tickets.value * 1.5 / m) * 7)
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
}
function paceRead(cells) {
  if (!cells) return null
  if (cells.length < 6) return { kind: 'none', name: 'No pattern yet', short: cells.length + ' weeks is too few to tell', body: '' }
  const ns = cells.map((c) => c.n), run = quietRun(cells), before = ns.slice(0, ns.length - run)
  if (run >= 2 && avg(before) > 0) {
    const lo = Math.min(...before), hi = Math.max(...before), from = cells[cells.length - run].week
    return { kind: 'stopped', name: 'Stopped ' + run + ' weeks ago', short: 'the ' + before.length + ' weeks before: ' + lo + '–' + hi + ' a week',
      body: 'Nothing finished since ' + wk(from) + '. Before that the team finished ' + lo + '–' + hi + ' a week. Pace stepped to 0, as when a team moves onto other work.' +
        '<br>With all 8 weeks the forecast says <b>' + dateFor(ns) + '</b>. From the ' + before.length + ' weeks before, <b>' + dateFor(before) + '</b>.' +
        '<br>If the team is coming back to this milestone, the weeks before are the better guide. If it stays on other work, no date holds until it returns.',
      action: { label: 'Use the ' + before.length + ' weeks before as typed counts', run: 'useBefore(' + before.length + ')' } }
  }
  const med = [...ns].sort((a, b) => a - b)[ns.length >> 1], iMax = ns.indexOf(Math.max(...ns)), rest = ns.filter((_, i) => i !== iMax)
  if ((ns[iMax] - med) / Math.max(1, Math.sqrt(med)) > 4 && sdv(rest) ** 2 / Math.max(1e-9, avg(rest)) < 2)
    return { kind: 'odd', name: 'One odd week', short: wk(cells[iMax].week) + ' finished ' + ns[iMax],
      body: wk(cells[iMax].week) + ' finished ' + ns[iMax] + ', far more than usual. Check it isn’t a bulk close or a clean-up before leaving it out.' }
  if (mkP(ns) < 0.05 || lag1v(ns) > 0.3)
    return { kind: 'changing', name: 'Pace changing', short: 'treat the range with care',
      body: 'Recent weeks differ from earlier ones, so the range may be too narrow. If you know why (people joining or leaving, different work), a shorter window may suit.' }
  const zeros = ns.filter((n) => n === 0).length
  if (sdv(ns) ** 2 / Math.max(1e-9, avg(ns)) > 2)
    return { kind: 'lumpy', name: 'Lumpy', short: zeros ? zeros + ' quiet week' + (zeros > 1 ? 's' : '') + ' among busy ones' : 'weeks vary a lot',
      body: 'Work lands in batches. Quiet weeks are real pace, so keep them; the range is wide and honest. Smaller items, or closing tickets when done, would tighten it.' }
  return { kind: 'none', name: 'No pattern yet', short: cells.length + ' weeks is too few to tell', body: '' }
}
function useBefore(k) { act('use the ' + k + ' weeks before the quiet run', () => {
  state.follow = { ...(state.follow || {}), counts: false }
  state.counts = { cells: state.counts.cells.slice(0, k).map((c) => ({ ...c })), origin: 'hand', seen: key(tracker.cells) }
  state.mode = 'counts'
}) }
function readHtml(cells, id, withAction) {
  const r = paceRead(cells)
  if (!r) return ''
  if (r.kind === 'none') return '<span class="dmark">' + r.name + ' · ' + r.short + '</span>'
  return '<details class="dread ' + r.kind + '"' + (editing['read-' + id] ? ' open' : '') + ' ontoggle="editing[\'read-' + id + '\']=this.open"><summary><b>' + r.name + '</b> · ' + r.short + '</summary>' +
    '<p>' + r.body + '</p>' + (withAction && r.action ? '<div class="row"><button onclick="' + r.action.run + '">' + r.action.label + '</button></div>' : '') + '</details>'
}

// ---- Variant D: quiet by default. Only what the forecast uses is on screen; GitHub's reading waits behind a small
// chip, with a dot only when a read is new since the EM last looked. The pace not in use folds to one line.
// "Follow GitHub" is the habitual default made once: each read updates the value, and the pace folds to one line.
function lookAt(field, open) {
  editing['open-' + field] = open
  if (open && state[field].seen !== trackerVal(field)) { state[field].seen = trackerVal(field); log.push('looked at GitHub\'s ' + field) }
  render()
}
function setFollow(field, on) { const own = ownOf(field); act((on ? 'follow GitHub: ' : 'stop following GitHub: ') + field, () => {
  state.follow = { ...(state.follow || {}), [field]: on }
  editing['open-' + field] = false; editing['change-' + field] = false
  if (on) {
    if (field === 'tickets') state.tickets = { value: tracker.tickets, origin: 'measured', at: tracker.at, seen: tracker.tickets }
    else { state.counts = { cells: measuredCells(tracker.cells), origin: 'measured', at: tracker.at, seen: key(tracker.cells) }; state.mode = 'counts' }
    state[field].own = own
  }
}) }
// while following, a new read updates the value with no question asked; the value it replaced shows faintly
function followReads() {
  for (const f of ['tickets', 'counts']) {
    if (!(state.follow || {})[f] || acceptedVal(f) === trackerVal(f)) continue
    const was = f === 'tickets' ? { text: String(state.tickets.value), at: state.tickets.at } : { text: nums(state.counts.cells), at: state.counts.at }
    const own = state[f].own
    state[f] = f === 'tickets' ? { value: tracker.tickets, origin: 'measured', at: tracker.at, seen: tracker.tickets } : { cells: measuredCells(tracker.cells), origin: 'measured', at: tracker.at, seen: key(tracker.cells) }
    state[f].own = own; state[f].was = was
    log.push('new read followed: ' + f)
  }
}
const following = (f) => !!(state.follow || {})[f]
function wasLine(f) { const w = state[f].was; return w ? '<span class="dmark">was ' + esc(w.text) + ' on ' + w.at + '</span>' : '' }
function graph(cells, big) {
  if (!cells) return ''
  const h = big ? 44 : 28
  const top = Math.max(1, ...cells.map((c) => c.n))
  return '<span class="dgraph" style="height:' + (h + 16) + 'px">' + cells.map((c) =>
    '<span class="col" title="' + wk(c.week || '') + ': ' + c.n + '"><span class="bar' + (c.n === 0 ? ' zero' : '') + '" style="height:' + (c.n ? Math.round(c.n / top * h) : 2) + 'px"></span><span class="v">' + c.n + '</span></span>').join('') + '</span>'
}
function quietWords(cells) {
  const q = cells ? cells.filter((c) => c.n === 0).length : 0
  if (!q) return ''
  const run = quietRun(cells)
  return '<span class="dquiet">' + q + ' quiet week' + (q > 1 ? 's' : '') + ' (0)' + (run > 1 ? ', last ' + run + ' in a row' : '') + '</span>'
}
function chip(field) {
  if (following(field)) return ''
  if (acceptedVal(field) === trackerVal(field) && state[field].origin === 'hand') return ''
  if (acceptedVal(field) === trackerVal(field)) return '<span class="dchip same" title="Same as GitHub, read ' + tracker.at + '">● GitHub</span>'
  const fresh = state[field].seen !== trackerVal(field)
  const body = field === 'tickets'
    ? '<div>GitHub reads <b>' + tracker.tickets + '</b> tickets remaining, read ' + tracker.at + '.</div>'
    : '<div>GitHub reads these 8 weeks, ' + span(tracker.cells) + ', read ' + tracker.at + ':</div><div>' + graph(tracker.cells, true) + '</div>' + readHtml(tracker.cells, 'chip', false)
  const own = ownLine(field) ? '<div class="prov">' + ownLine(field) + '</div>' : ''
  return '<details class="dchip"' + (editing['open-' + field] ? ' open' : '') + ' ontoggle="if (this.open !== !!editing[\'open-' + field + '\']) lookAt(\'' + field + '\', this.open)">' +
    '<summary>' + (fresh ? '<span class="dot"></span>' : '') + 'GitHub ' + (field === 'tickets' ? tracker.tickets : 'reads differently') + '</summary>' +
    '<div class="dpanel">' + body + own + '<div class="row"><button class="primary" onclick="setFollow(\'' + field + '\', true)">Follow GitHub</button><button onclick="lookAt(\'' + field + '\', false)">Close</button></div>' +
    '</div></details>'
}
// D has no fixed copy of GitHub's values: each value follows GitHub or follows what the EM typed; pace may also be the range
function settleD() {
  for (const f of ['tickets', 'counts']) {
    if (f === 'counts' && state.mode !== 'counts') continue
    if (state[f].origin === 'measured' && !following(f)) state.follow = { ...(state.follow || {}), [f]: true }
  }
}
function paceSource() { return following('counts') ? 'github' : state.mode === 'range' ? 'range' : 'typed' }
function setPaceSource(src) {
  if (src === paceSource()) return
  if (src === 'github') return setFollow('counts', true)
  if (src === 'typed') { if (!state.counts.cells) { editing.counts = true; state.follow = { ...(state.follow || {}), counts: false }; return act('pace from typed counts', () => { state.mode = 'counts' }) } return followTyped() }
  act('pace from the range', () => { state.follow = { ...(state.follow || {}), counts: false }; state.mode = 'range' })
}
function ticketsTyped(n) { act('tickets typed', () => {
  const own = state.tickets.origin === 'measured' && state.tickets.own
  state.follow = { ...(state.follow || {}), tickets: false }
  state.tickets = { value: n !== undefined ? n : own ? own.value : state.tickets.value, origin: 'hand', seen: tracker.tickets }
}) }
function seg(options, current, fn) {
  return '<div class="dseg">' + options.map(([v, label]) => '<button class="' + (v === current ? 'on' : '') + '" onclick="' + fn + '(\'' + v + '\')">' + label + '</button>').join('') + '</div>'
}
function variantD() {
  settleD(); followReads()
  const t = state.tickets, c = state.counts
  const tSrc = following('tickets') ? 'github' : 'typed'
  const tickets = seg([['github', 'GitHub'], ['typed', 'Typed']], tSrc, 'setTicketsSource') +
    (tSrc === 'github'
      ? '<div class="dline"><span class="dbig">' + t.value + '</span><span class="dmark">tickets remaining · GitHub, read ' + tracker.at + '</span>' + wasLine('tickets') + '</div>'
      : '<div class="pace"><label>Tickets remaining <input type="number" value="' + t.value + '" onchange="ticketsTyped(Number(this.value))"></label><span class="unit">' + chip('tickets') + '</span></div>')
  const rangeInline = '<div class="pace"><label>Low <input type="number" id="r-lo" value="' + state.range.low + '" onchange="setRange(Number(this.value),Number(document.getElementById(\'r-hi\').value))"></label><span class="to">to</span><label>High <input type="number" id="r-hi" value="' + state.range.high + '" onchange="setRange(Number(document.getElementById(\'r-lo\').value),Number(this.value))"></label><span class="unit">tickets per week</span></div>'
  const src = paceSource()
  let pace = seg([['github', 'GitHub'], ['typed', 'Typed counts'], ['range', 'Range']], src, 'setPaceSource')
  if (src === 'github') {
    pace += '<div class="dline">' + graph(c.cells, false) + '<span>last 8 weeks</span><span class="dmark">read ' + tracker.at + '</span>' + wasLine('counts') + readHtml(c.cells, 'gh', true) +
      '<details class="dother inline"' + (editing['change-counts'] ? ' open' : '') + ' ontoggle="editing[\'change-counts\']=this.open"><summary>Show weeks</summary>' +
      '<div class="dmark">' + span(c.cells) + ' · type into a week to change it; the pace then follows your typed counts</div>' + editableCells(c.cells) + '</details></div>'
  } else if (src === 'typed') {
    pace += editing.counts || !c.cells ? countsEditor()
      : editableCells(c.cells) + readHtml(c.cells, 'typed', false) + '<div class="prov">' + c.cells.length + ' weeks' + (c.cells[0].week ? ', ' + span(c.cells) : '') + ' ' + chip('counts') + '</div>'
  } else {
    pace += rangeInline
  }
  const n = pending().filter((f) => !following(f) && (f === 'tickets' || src === 'typed')).length
  const words = src === 'github' ? 'GitHub\'s last 8 weeks' : paceWords()
  const strip = '<div class="strip"><span class="where">On the Milestone forecast</span><span class="context">Checkout v2 · ' + t.value + ' tickets remaining</span><span class="head">Starting 4 Nov 2026: 85% confident of finishing by ' + standIn() + '</span><span class="note">Pace: ' + words + '</span>' +
    '<span class="note">GitHub read ' + tracker.at + (n ? ' · <a href="#d-inputs"><span class="dot"></span>' + n + ' new reading' + (n > 1 ? 's' : '') + '</a>' : '') + '</span></div>'
  return strip + '<div id="d-inputs">' + section(1, 'Milestone', 'Tickets remaining, from GitHub or typed.', tickets) + section(2, 'Pace', 'From GitHub, your typed counts, or a range. The others are kept.', pace) + '</div>'
}
function setTicketsSource(src) { if (src === (following('tickets') ? 'github' : 'typed')) return; src === 'github' ? setFollow('tickets', true) : ticketsTyped() }
function editAt(i, n) { act('edit week ' + (i + 1) + ' by hand', () => {
  if ((state.follow || {}).counts) state.follow.counts = false
  const own = ownOf('counts')
  const cells = state.counts.cells.map((c, j) => j === i ? { ...c, n } : c)
  state.counts = { cells, origin: 'hand', seen: key(tracker.cells) }; state.mode = 'counts'
  editing.weeks = false; editing['change-counts'] = false
}) }
function editableCells(cells) {
  return '<div class="cells">' + cells.map((c, i) =>
    '<label class="cell' + (c.n === 0 ? ' quiet' : '') + (c.measured === null || c.measured !== undefined && c.n !== c.measured ? ' handcell' : '') + '"><input class="n" type="number" min="0" value="' + c.n + '" onchange="editAt(' + i + ', Number(this.value))"><span class="w">' + (c.week ? wk(c.week).replace('w/c ', '') : '—') + (c.n === 0 ? ' · quiet' : '') + '</span></label>').join('') + '</div>'
}
function followTyped() { act('follow typed counts', () => {
  state.follow = { ...(state.follow || {}), counts: false }
  const own = state.counts.origin === 'measured' && state.counts.own
  state.counts = { cells: own ? own.cells : state.counts.cells.map((c) => ({ ...c, measured: null })), origin: 'hand', seen: key(tracker.cells) }
  state.mode = 'counts'; editing['change-counts'] = false; editing.weeks = false
}) }
const followTypedBtn = () => '<button onclick="followTyped()">Follow typed counts' + (state.counts.origin === 'measured' && state.counts.own ? ' (' + esc(nums(state.counts.own.cells)) + ')' : '') + '</button>'
function quietNoteIfUsed() {
  const cs = state.counts.cells
  if (!cs || !cs[0].week || !cs.some((x) => x.n === 0)) return ''
  return '<details class="dother" style="border:0;padding:0"><summary>' + quietWords(cs) + '</summary>' + quietNote(cs) + '</details>'
}

// ---- switcher and render ----
function go(v, s) {
  variant = v; if (s && s !== scenario) { scenario = s; state = SCENARIOS[s].make(); editing = {}; log.length = 0 }
  const p = new URLSearchParams(location.search); p.set('variant', variant); p.set('scenario', scenario)
  history.replaceState(null, '', '?' + p); render()
}
function cycle(d) { const ks = Object.keys(VARIANTS); go(ks[(ks.indexOf(variant) + d + ks.length) % ks.length]) }
function render() {
  document.getElementById('proto').innerHTML = ({ A: variantA, B: variantB, C: variantC, D: variantD })[variant]()
  document.getElementById('state').textContent = JSON.stringify({ variant, scenario, status: { tickets: status('tickets'), counts: status('counts') }, tracker: { at: tracker.at, tickets: tracker.tickets, counts: nums(tracker.cells) }, stored: { ...state, counts: { ...state.counts, cells: state.counts.cells && state.counts.cells.map((c) => (c.week || 'no week') + ': ' + c.n + (c.measured === null ? ' (hand)' : c.measured !== c.n ? ' (hand, measured ' + c.measured + ')' : '')) } }, actions: log }, null, 1)
  document.getElementById('switcher').innerHTML = '<button onclick="cycle(-1)">←</button><b>' + variant + ' (' + VARIANTS[variant] + ')</b><button onclick="cycle(1)">→</button>' +
    '<select onchange="go(variant,this.value)">' + Object.entries(SCENARIOS).map(([k, s]) => '<option value="' + k + '"' + (k === scenario ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select>' +
    '<button onclick="state=SCENARIOS[scenario].make();editing={};log.length=0;render()">Reset</button>'
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === 'ArrowLeft') cycle(-1); if (e.key === 'ArrowRight') cycle(1)
})
go(variant)
`

const header = {
  context: 'Checkout v2 · GitHub shop-team/shop · milestone:"Checkout v2"',
  heading: 'Inputs',
  lede: 'Prototype for “How the milestone screen marks measured values and proposals”. Flip variants with ← → and pick a scenario in the bar below.',
}
mkdirSync(new URL('.', out), { recursive: true })
writeFileSync(out, htmlPage('/inputs', header, MAIN, SCRIPT))
const file = fileURLToPath(out)
console.log(`Prototype written to ${file}`)
if (!process.env.NO_OPEN) spawn('open', [file], { stdio: 'ignore', detached: true }).unref()
