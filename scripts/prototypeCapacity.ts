// PROTOTYPE, throwaway: never merge. Wayfinder ticket "Entering capacity and seeing its effect on the forecast"
// (https://github.com/random11235/forecaster-next-gen/issues/139), building on the capacity decision in
// https://github.com/random11235/forecaster-next-gen/issues/131#issuecomment-6630298315.
//
// Three variants of entering capacity and seeing what it does to the forecast's dates, switchable via `?variant=A|B|C`;
// `?scenario=` picks the canned starting state. A stand-in simulation (not the engine) runs every change twice, with
// capacity and at usual capacity, on the same random draws, so the difference is capacity alone. All state is in
// memory; reload to reset. Run: `npm run prototype:capacity` (builds, writes dist/prototype/capacity.html, opens it).
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { htmlPage }: typeof import('../src/app/html.js') = await import(new URL('../dist/app/html.js', import.meta.url).href)

const out = new URL('../dist/prototype/capacity.html', import.meta.url)

const STYLE = `
  <style>
    .proto-banner { font-size: 12px; color: var(--risk); font-family: var(--mono); }
    .linkish { border: 0; background: none; padding: 0; min-height: 0; color: var(--link); text-decoration: underline; cursor: pointer; font-size: 13px; }
    .muted { color: var(--muted); font-size: 13px; }
    .faint { color: var(--faint); font-size: 12px; }
    .row { display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: center; }
    .col { display: flex; flex-direction: column; gap: 8px; }
    .flag { font-size: 13px; padding: 6px 10px; border-radius: 4px; line-height: 1.45; }
    .flag.bad { background: #FBF1EC; color: var(--risk); border-left: 3px solid var(--risk); }
    .flag.warn { background: #FBF6E8; color: #7A4A12; border-left: 3px solid #C9A66B; }
    .flag.prop { background: #EEF4F2; color: var(--ink); border-left: 3px solid var(--good); display: flex; gap: 10px 14px; flex-wrap: wrap; align-items: center; }
    .usual { font-size: 13px; color: var(--muted); }
    .usual b { color: var(--ink); font-weight: 600; }
    .assume { font-size: 12px; color: var(--faint); }
    table.ent { border-collapse: collapse; font-size: 14px; width: 100%; }
    table.ent th { text-align: left; font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; padding: 0 12px 6px 0; border-bottom: 1px solid var(--ink); font-weight: 600; }
    table.ent td { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--hairline); vertical-align: middle; }
    table.ent td.pct { font-family: var(--mono); }
    table.ent td.x { text-align: right; }
    .tag { font-size: 11px; border: 1px solid var(--border); border-radius: 999px; padding: 1px 7px; color: var(--muted); white-space: nowrap; }
    .add { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
    .add label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
    .add input[type=number] { width: 80px; }
    .add input[type=text] { width: 180px; }
    .add .onward { flex-direction: row; align-items: center; gap: 6px; font-size: 13px; padding-bottom: 10px; }
    details.past summary { cursor: pointer; font-size: 13px; color: var(--muted); }
    .strip { border: 1px solid var(--hairline); border-radius: 8px; padding: 12px 16px; background: #fff; display: flex; flex-direction: column; gap: 4px; }
    .strip .where { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; }
    .strip .head { font-size: 18px; }
    .strip .note { font-size: 13px; color: var(--muted); }
    .later { color: var(--risk); } .sooner { color: var(--good); }
    .modes { display: inline-flex; border: 1px solid var(--hairline); border-radius: 6px; overflow: hidden; }
    .modes button { border: 0; border-radius: 0; background: transparent; min-height: 26px; padding: 0 10px; font-size: 12px; color: var(--muted); }
    .modes button.on { background: var(--ink); color: var(--page); }
    /* B: timeline */
    .tl { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(34px, 1fr); gap: 3px; overflow-x: auto; padding-bottom: 4px; }
    .tl .wk { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; border-radius: 4px; padding: 4px 0; }
    .tl .wk:hover, .tl .wk.sel { background: var(--active); }
    .tl .pctv { font-family: var(--mono); font-size: 10px; color: var(--faint); height: 12px; }
    .tl .pctv.low { color: var(--risk); }
    .tl .well { height: 80px; width: 22px; display: flex; flex-direction: column; justify-content: flex-end; border-bottom: 1px solid var(--ink); position: relative; }
    .tl .well .fill { background: var(--bar); border-radius: 2px 2px 0 0; }
    .tl .well .line100 { position: absolute; left: -2px; right: -2px; border-top: 1px dashed var(--border); }
    .tl .d { font-size: 10px; color: var(--faint); white-space: nowrap; }
    .tl .mk { height: 30px; display: flex; flex-direction: column; align-items: center; gap: 1px; font-size: 10px; font-family: var(--mono); }
    .tl .mk .with { background: var(--ink); color: var(--page); border-radius: 3px; padding: 0 3px; }
    .tl .mk .without { border: 1px dashed var(--muted); color: var(--muted); border-radius: 3px; padding: 0 3px; }
    .pop { border: 1px solid var(--ink); border-radius: 8px; padding: 12px 14px; background: #fff; display: flex; flex-direction: column; gap: 10px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--border); border-radius: 999px; padding: 2px 4px 2px 10px; font-size: 13px; background: #fff; }
    .chip .x { border: 0; background: none; min-height: 0; padding: 0 6px; font-size: 15px; line-height: 1; color: var(--muted); cursor: pointer; }
    /* C: forecast-first */
    .fc { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 28px; }
    @media (max-width: 860px) { .fc { grid-template-columns: 1fr; } }
    .bighead { font-size: 24px; line-height: 1.3; margin: 0; }
    table.pc { border-collapse: collapse; font-size: 14px; }
    table.pc th { text-align: left; font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; padding: 0 20px 6px 0; font-weight: 600; }
    table.pc td { padding: 6px 20px 6px 0; border-top: 1px solid var(--hairline); font-variant-numeric: tabular-nums; }
    .hist { display: flex; gap: 2px; align-items: flex-end; height: 120px; border-bottom: 1px solid var(--ink); }
    .hist .b { flex: 1; display: flex; gap: 1px; align-items: flex-end; height: 100%; }
    .hist .b span { flex: 1; border-radius: 1px 1px 0 0; }
    .hist .b .w { background: var(--bar); }
    .hist .b .u { background: transparent; border: 1px dashed var(--muted); border-bottom: 0; }
    .hist { position: relative; height: 150px; }
    .histwrap { display: flex; flex-direction: column; }
    .mrow { position: relative; height: 24px; }
    .mtag { position: absolute; transform: translateX(-50%); white-space: nowrap; font-size: 12px; font-family: var(--mono); padding: 1px 6px; border-radius: 3px; }
    .mrow.top .mtag { bottom: 2px; background: var(--ink); color: var(--page); }
    .mrow.bot .mtag { top: 4px; border: 1px dashed var(--muted); color: var(--muted); background: var(--page); }
    .mline { position: absolute; top: -2px; bottom: 0; width: 0; pointer-events: none; }
    .mline.with { border-left: 2px solid var(--ink); }
    .mline.usual { border-left: 2px dashed var(--muted); top: 0; bottom: -6px; }
    .hist .b.one { position: relative; }
    .hist .b.one .w { flex: 1; }
    .hist .b .w.adj { background: repeating-linear-gradient(135deg, var(--bar) 0 4px, #B5482A 4px 7px); }
    .hist .b .tick { position: absolute; left: -1px; right: -1px; border-top: 2px dashed var(--ink); pointer-events: none; }
    .hist .b.capd { background: repeating-linear-gradient(135deg, transparent 0 4px, rgba(181,72,42,.32) 4px 7px); }
    .key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 3px; }
    .side { border-left: 1px solid var(--hairline); padding-left: 20px; display: flex; flex-direction: column; gap: 12px; }
    .pace { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--hairline); border-radius: 6px; padding: 10px 12px; background: #fff; }
    .phead { display: flex; gap: 10px; justify-content: space-between; font-size: 12px; color: var(--muted); }
    .phead a { font-size: 12px; }
    .pcs { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; }
    .pcol { display: flex; flex-direction: column; align-items: center; gap: 1px; border-radius: 3px; padding: 2px 0; }
    .pcol.lst { background: repeating-linear-gradient(135deg, transparent 0 4px, rgba(181,72,42,.32) 4px 7px); }
    .pcol .n { font-family: var(--mono); font-size: 11px; color: var(--ink); }
    .pcol .pw { height: 44px; width: 14px; display: flex; flex-direction: column; justify-content: flex-end; }
    .pcol .pb { background: var(--bar); border-radius: 2px 2px 0 0; }
    .pcol .d { font-size: 9px; color: var(--faint); white-space: nowrap; }
    .sh { font-family: var(--mono); font-size: 10px; color: var(--page); background: var(--risk); border-radius: 3px; padding: 0 3px; min-height: 14px; }
    .pcol .sh:empty { background: none; }
    details.cap { border-top: 1px solid var(--hairline); padding-top: 12px; }
    details.cap summary { cursor: pointer; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; list-style: none; }
    details.cap summary::before { content: '▸'; color: var(--muted); font-size: 11px; }
    details.cap[open] summary::before { content: '▾'; }
    details.cap .ctitle { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .pweeks { display: flex; gap: 14px; align-items: flex-end; }
    .pgrp { flex: 8; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pgrp + .pgrp { border-left: 1px solid var(--border); padding-left: 10px; }
    .glab { font-size: 11px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pcols { display: flex; gap: 2px; }
    .pwk { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; border-radius: 3px; }
    .pwk .top { height: 15px; font-size: 10px; font-family: var(--mono); color: var(--muted); }
    .pwk .top b { color: var(--risk); }
    .pwk .well { height: 80px; width: 100%; position: relative; display: flex; flex-direction: column; justify-content: flex-end; border-bottom: 1px solid var(--ink); }
    .pwk .bar { border-radius: 2px 2px 0 0; margin: 0 1px; }
    .pwk.typed .bar { background: var(--bar); }
    .pwk.typed.lst .well { background: repeating-linear-gradient(135deg, transparent 0 4px, rgba(181,72,42,.18) 4px 7px); }
    .pwk.ahead .bar { background: var(--bar-light); }
    .pwk.ahead.adj .bar { background: repeating-linear-gradient(135deg, var(--bar-light) 0 4px, #B5482A 4px 7px); }
    .pwk .utick { position: absolute; left: 0; right: 0; border-top: 2px dashed var(--ink); }
    .pwk.p85 .well { box-shadow: inset 0 -2px 0 var(--ink); }
    .pwk.p85 .well::after { content: ''; position: absolute; top: -4px; bottom: 0; right: -2px; border-right: 3px solid var(--ink); }
    .pwk .d { font-size: 9px; color: var(--faint); white-space: nowrap; height: 12px; }
    .eff { font-size: 12px; white-space: nowrap; }
    .side h3 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .sentence { font-size: 14px; line-height: 2.2; }
    .sentence input { padding: 2px 6px !important; font-size: 13px !important; }
    .sentence input[type=number] { width: 64px; }
    .sentence input[type=text] { width: 150px; }
    .sline { font-size: 14px; display: flex; gap: 8px; align-items: baseline; justify-content: space-between; border-bottom: 1px solid var(--hairline); padding: 4px 0; }
    .switcher { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 10; display: flex; gap: 10px; align-items: center;
      background: #111; color: #fff; padding: 8px 12px; border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.3); font-size: 13px; }
    .switcher button { color: #fff; border-color: #444; min-height: 28px; background: transparent; }
    .switcher select { font: inherit; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; padding: 3px 6px; }
    details.state { font-size: 12px; margin-bottom: 70px; }
    details.state pre { background: var(--sidebar); padding: 12px; border-radius: 6px; overflow: auto; font-family: var(--mono); font-size: 11px; }
  </style>`

const MAIN = `${STYLE}
    <p class="proto-banner">PROTOTYPE · stand-in simulation, not the engine · nothing is saved · reload resets · today is 4 Nov 2026</p>
    <div id="proto"></div>
    <details class="state"><summary>State (what would be stored)</summary><pre id="state"></pre></details>
    <div class="switcher" id="switcher"></div>`

const SCRIPT = String.raw`
// ---- dates (ISO strings, UTC) ----
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const toD = (iso) => new Date(iso + 'T00:00:00Z')
const toIso = (d) => d.toISOString().slice(0, 10)
const add = (iso, n) => { const d = toD(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d) }
const dm = (iso) => { const d = toD(iso); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] }
const dmy = (iso) => dm(iso) + ' ' + toD(iso).getUTCFullYear()
const weeksBetween = (a, b) => Math.round((toD(b) - toD(a)) / 6048e5)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const TODAY = '2026-11-04'
const START = '2026-11-02'              // the milestone's start date, a Monday; cadence 7 days
const COUNT_WEEKS = Array.from({ length: 8 }, (_, i) => add(START, -56 + 7 * i)) // 7 Sep .. 26 Oct
const COUNTS = [5, 7, 4, 6, 8, 5, 6, 7]
const TICKETS = 40, GROWTH = [1, 2]     // ambiguity medium

// ---- scenarios ----
const SCENARIOS = {
  holidays: { name: 'Leave and holidays ahead', make: () => ({ mode: 'counts', range: [4, 8], entries: [
    { id: 1, from: '2026-10-12', to: '2026-10-16', pct: 50, note: 'Incident' },
    { id: 2, from: '2026-11-16', to: '2026-11-20', pct: 60, note: 'Two away at a conference' },
    { id: 3, from: '2026-12-21', to: '2027-01-01', pct: 20, note: 'Holidays' },
  ] }) },
  shrinking: { name: 'Team shrank in October (not caught up)', make: () => ({ mode: 'counts', range: [4, 8], entries: [
    { id: 1, from: '2026-10-05', to: null, pct: 80, note: 'One of five moved to Payments' },
  ] }) },
  caughtUp: { name: 'Team shrank in September (caught up)', make: () => ({ mode: 'counts', range: [4, 8], entries: [
    { id: 1, from: '2026-09-07', to: null, pct: 80, note: 'One of five moved to Payments' },
    { id: 2, from: '2026-12-21', to: '2027-01-01', pct: 20, note: 'Holidays' },
  ] }) },
  grew: { name: 'Team tripled', make: () => ({ mode: 'counts', range: [4, 8], entries: [
    { id: 1, from: '2026-11-16', to: null, pct: 300, note: 'Merged with the Payments team' },
  ] }) },
  range: { name: 'Pace from a range, lasting change', make: () => ({ mode: 'range', range: [4, 8], entries: [
    { id: 1, from: '2026-10-05', to: null, pct: 80, note: 'One of five moved to Payments' },
  ] }) },
  empty: { name: 'No capacity typed', make: () => ({ mode: 'counts', range: [4, 8], entries: [] }) },
}
const VARIANTS = { A: 'A section on Inputs', B: 'Week-by-week strip', C: 'Beside the forecast' }
const params = new URLSearchParams(location.search)
let variant = VARIANTS[params.get('variant')] ? params.get('variant') : 'A'
let scenario = SCENARIOS[params.get('scenario')] ? params.get('scenario') : 'holidays'
let state = SCENARIOS[scenario].make()
let ui = { sel: null, edit: Number(params.get('edit')) || null }
let nextId = 100
const log = []

// ---- capacity ----
// Overlapping entries multiply: a 50% week in a team already at 80% is 40% of usual. (An open question for the EM.)
const capOnDay = (iso) => state.entries.filter((e) => !e.newUsual && e.from <= iso && (e.to === null || iso <= e.to)).reduce((p, e) => p * e.pct / 100, 1)
const workDays = (weekStart) => [0, 1, 2, 3, 4].map((i) => add(weekStart, i))
const capOfWeek = (weekStart) => workDays(weekStart).reduce((s, d) => s + capOnDay(d), 0) / 5
// The same, counting only some entries: lasting changes (still running), or short ones (with an end date)
const capWhere = (weekStart, keep) => workDays(weekStart).reduce((s, d) => s + state.entries.filter((e) => !e.newUsual && keep(e) && e.from <= d && (e.to === null || d <= e.to)).reduce((p, e) => p * e.pct / 100, 1), 0) / 5
const lastingIn = (weekStart) => capWhere(weekStart, (e) => e.to === null)
const shortIn = (weekStart) => capWhere(weekStart, (e) => e.to !== null)
const isPast = (e) => e.newUsual || (e.to !== null && e.to < TODAY)
const lasting = () => state.entries.filter((e) => e.to === null && !e.newUsual)
// The new-usual proposal: with typed counts, once every counted week starts on or after the change
const caughtUp = (e) => state.mode === 'counts' && COUNT_WEEKS.every((w) => w >= e.from)
const weeksAfter = (e) => COUNT_WEEKS.filter((w) => w >= e.from).length

// ---- stand-in simulation: same seed for both runs, so the difference is capacity alone ----
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const HORIZON = 78, TRIALS = 3000
function simulate(withCap) {
  const r = mulberry(139)
  const caps = Array.from({ length: HORIZON }, (_, k) => withCap ? capOfWeek(add(START, 7 * k)) : 1)
  // A counted week that falls after a lasting change already shows it: take the change back out of that count before
  // applying the coming week's capacity, so the change isn't counted twice. Short entries in the past aren't undone.
  const base = COUNTS.map((_, i) => { const c = withCap ? lastingIn(COUNT_WEEKS[i]) : 1; return c > 0 ? c : 1 })
  const finish = new Array(TRIALS)
  for (let t = 0; t < TRIALS; t++) {
    let left = Math.ceil(TICKETS * (GROWTH[0] + r() * (GROWTH[1] - GROWTH[0])))
    const w = COUNTS.map(() => -Math.log(1 - r())); const tot = w.reduce((a, b) => a + b, 0)
    let k = 0
    for (; k < HORIZON; k++) {
      let pace
      if (state.mode === 'counts') { let u = r() * tot, i = 0; while (i < w.length - 1 && (u -= w[i]) > 0) i++; pace = COUNTS[i] / base[i] }
      else pace = state.range[0] + Math.floor(r() * (state.range[1] - state.range[0] + 1))
      left -= pace * caps[k]
      if (left <= 1e-9) break
    }
    finish[t] = k
  }
  finish.sort((a, b) => a - b)
  const q = (p) => finish[Math.min(TRIALS - 1, Math.ceil(p * TRIALS) - 1)]
  return { finish, q50: q(.5), q85: q(.85), q95: q(.95) }
}
const endOf = (k) => add(START, 7 * k + 6)
const shift = (a, b) => { const d = b - a; return d === 0 ? 'no change' : d > 0 ? '<span class="later">' + d + ' week' + (d > 1 ? 's' : '') + ' later</span>' : '<span class="sooner">' + -d + ' week' + (d < -1 ? 's' : '') + ' sooner</span>' }
let W, U // with capacity, at usual capacity

// ---- actions ----
function checkEntry(from, to, pct, onward) {
  if (!from) return 'Pick the date it starts.'
  if (!onward && to < from) return 'The end date is before the start.'
  if (!Number.isInteger(pct) || pct < 0) return 'Capacity is a whole percentage, 0 or more.'
  if (pct > 1000) return 'Capacity above 1000% can’t be forecast. For a team that much bigger, use a pace range or comparable work from the bigger team.'
  return null
}
function addEntry(from, to, pct, note, onward) {
  pct = Number(pct); if (!onward && !to) to = from
  const bad = checkEntry(from, to, pct, onward); if (bad) return flash(bad)
  state.entries.push({ id: nextId++, from, to: onward ? null : to, pct, note: note || '' })
  state.entries.sort((a, b) => a.from.localeCompare(b.from)); log.push('add ' + pct + '% ' + from + (onward ? ' onward' : '..' + to)); ui.msg = null; render()
}
// Editing keeps what it was before, dated, so a later period review can see how capacity was revised.
function startEdit(id) { ui.edit = id; ui.msg = null; render() }
function saveEdit(id) {
  const e = state.entries.find((x) => x.id === id), v = (n) => document.getElementById('e' + n)
  const past = isPast(e)
  const next = past ? { from: e.from, to: e.to, pct: e.pct, note: v('note').value }
    : { from: v('from').value, to: v('onward').checked ? null : (v('to').value || v('from').value), pct: Number(v('pct').value), note: v('note').value }
  if (!past) { const bad = checkEntry(next.from, next.to ?? next.from, next.pct, next.to === null); if (bad) return flash(bad) }
  const was = { from: e.from, to: e.to, pct: e.pct, note: e.note }
  if (JSON.stringify(was) === JSON.stringify(next)) { ui.edit = null; return render() }
  e.revisions = [...(e.revisions || []), { ...was, changedOn: TODAY }]
  Object.assign(e, next); state.entries.sort((a, b) => a.from.localeCompare(b.from))
  log.push('edit ' + id); ui.edit = null; ui.msg = null; render()
}
function removeEntry(id) { state.entries = state.entries.filter((e) => e.id !== id); log.push('remove ' + id); render() }
function endEntry(id) { const e = state.entries.find((x) => x.id === id); e.to = add(TODAY, -1); log.push('end ' + id + ' by hand'); render() }
function acceptNewUsual(id) { const e = state.entries.find((x) => x.id === id); e.newUsual = TODAY; log.push('new usual ' + id); render() }
function keepLasting(id) { ui['kept' + id] = true; log.push('keep ' + id); render() }
function setMode(m) { state.mode = m; log.push('pace ' + m); render() }
function flash(m) { ui.msg = m; render() }
function readAdd(prefix) {
  const v = (n) => document.getElementById(prefix + n)
  addEntry(v('from').value, v('to') ? v('to').value : '', v('pct').value, v('note').value, v('onward') ? v('onward').checked : false)
}

// ---- shared pieces ----
const usualLine = () => state.mode === 'counts'
  ? '<p class="usual"><b>100%</b> = a usual week, as in your typed counts (8 weeks, ' + dm(COUNT_WEEKS[0]) + ' to ' + dm(add(COUNT_WEEKS[7], 6)) + ').</p>'
  : '<p class="usual"><b>100%</b> = a usual week, as you had in mind for the pace range ' + state.range[0] + '–' + state.range[1] + '.</p>'
const assumeLine = () => '<p class="assume">Capacity scales pace in proportion: a 60% week draws 60% of a usual week’s pace. Weekends don’t count; overlapping entries multiply. A counted week after a lasting change is taken as already showing it.</p>'
function paceSummary() {
  const edit = '<a href="#" onclick="return false" title="Pace is typed on Inputs">Edit on Inputs</a>'
  return '<p class="muted" style="margin:0">' + (state.mode === 'counts'
    ? 'Typed counts of 8 weeks, ' + dm(COUNT_WEEKS[0]) + '–' + dm(add(COUNT_WEEKS[7], 6)) + ': ' + Math.min(...COUNTS) + ' to ' + Math.max(...COUNTS) + ' a week, ' + (COUNTS.reduce((a, b) => a + b, 0) / COUNTS.length).toFixed(1) + ' on average.'
    : 'A range, ' + state.range[0] + '–' + state.range[1] + ' tickets a week.') + ' ' + edit + '</p>'
}
// The weeks the pace comes from, then the weeks ahead to the 85% date: a usual week, scaled by that week's capacity.
// The weeks capacity changes are highlighted, with the usual week as a dashed tick, so the impacted weeks show directly.
function paceWeeks(A, on) {
  const counts = state.mode === 'counts'
  const base = counts ? COUNTS.map((c, i) => { const l = on ? lastingIn(COUNT_WEEKS[i]) : 1; return c / (l > 0 ? l : 1) }) : []
  const usual = counts ? base.reduce((a, b) => a + b, 0) / base.length : (state.range[0] + state.range[1]) / 2
  const ahead = Array.from({ length: A.q85 + 1 }, (_, k) => { const wk = add(START, 7 * k), c = on ? capOfWeek(wk) : 1; return { wk, c, v: usual * c } })
  const mx = Math.max(usual, ...(counts ? COUNTS : []), ...ahead.map((a) => a.v)) * 1.05
  const h = (v) => (v / mx * 100).toFixed(1) + '%'
  const past = counts ? COUNTS.map((c, i) => { const wk = COUNT_WEEKS[i], ls = lastingIn(wk), sh = shortIn(wk)
    return '<div class="pwk typed' + (on && Math.abs(ls - 1) > 1e-9 ? ' lst' : '') + '" title="Week of ' + dm(wk) + ': ' + c + ' finished (typed)' + (Math.abs(sh - 1) > 1e-9 ? '; ' + Math.round(sh * 100) + '% that week, count kept as typed' : '') + '">' +
      '<span class="top">' + (Math.abs(sh - 1) > 1e-9 ? '<span class="sh">' + Math.round(sh * 100) + '%</span>' : c) + '</span><div class="well"><div class="bar" style="height:' + h(c) + '"></div></div><span class="d">' + (i % 2 ? '' : dm(wk)) + '</span></div>' }).join('') : ''
  const fut = ahead.map((a, k) => { const adj = Math.abs(a.c - 1) > 1e-9
    return '<div class="pwk ahead' + (adj ? ' adj' : '') + (k === A.q85 ? ' p85' : '') + '" title="Week of ' + dm(a.wk) + ': ' + (adj ? Math.round(a.c * 100) + '% capacity, about ' + a.v.toFixed(1) + ' instead of ' + usual.toFixed(1) : 'a usual week, about ' + usual.toFixed(1)) + '">' +
      '<span class="top">' + (adj ? '<b>' + Math.round(a.c * 100) + '%</b>' : '') + '</span><div class="well"><div class="bar" style="height:' + h(a.v) + '"></div>' + (adj ? '<div class="utick" style="bottom:' + h(usual) + '"></div>' : '') + '</div>' +
      '<span class="d">' + (k === A.q85 ? '<b>85%</b>' : k % 2 ? '' : dm(a.wk)) + '</span></div>' }).join('')
  return '<div class="pweeks">' + (counts ? '<div class="pgrp"><span class="glab">Typed</span><div class="pcols">' + past + '</div></div>' : '') +
    '<div class="pgrp" style="flex:' + ahead.length + '"><span class="glab">Ahead, from ' + dm(START) + ' to the 85% date</span><div class="pcols">' + fut + '</div></div></div>' +
    '<p class="faint"><span class="key" style="background:var(--bar)"></span>typed counts · <span class="key" style="background:var(--bar-light)"></span>a usual week ahead (' + usual.toFixed(1) + (!counts ? ', mid-range' : on && COUNT_WEEKS.some((w) => Math.abs(lastingIn(w) - 1) > 1e-9) ? ', the typed average with the lasting change taken out' : ', the typed average') + ')' +
    (on ? ' · <span class="key" style="background:repeating-linear-gradient(135deg, var(--bar-light) 0 3px, #B5482A 3px 5px)"></span>weeks capacity changes, the usual week dashed' + (counts && COUNT_WEEKS.some((w) => Math.abs(lastingIn(w) - 1) > 1e-9) ? ' · shaded typed weeks already show a lasting change' : '') : ' · capacity off') + '</p>'
}
function paceStrip() {
  const edit = ' <a href="#" onclick="return false" title="Pace is typed on Inputs">Edit on Inputs</a>'
  if (state.mode === 'range') return '<div class="pace"><div class="phead"><span>A range</span>' + edit + '</div><p class="muted" style="margin:0">' + state.range[0] + '–' + state.range[1] + ' tickets a week, from a slow week to a good one. No counted weeks, so a lasting change is yours to end.</p></div>'
  const mx = Math.max(...COUNTS)
  const cols = COUNTS.map((c, i) => {
    const wk = COUNT_WEEKS[i], ls = lastingIn(wk), sh = shortIn(wk)
    return '<div class="pcol' + (ls < 1 - 1e-9 || ls > 1 + 1e-9 ? ' lst' : '') + '" title="Week of ' + dm(wk) + ': ' + c + ' finished' + (Math.abs(ls - 1) > 1e-9 ? ', already at ' + Math.round(ls * 100) + '% (lasting change)' : '') + (sh < 1 - 1e-9 ? ', ' + Math.round(sh * 100) + '% that week (short entry, not undone)' : '') + '">' +
      '<span class="sh">' + (Math.abs(sh - 1) > 1e-9 ? Math.round(sh * 100) + '%' : '') + '</span><span class="n">' + c + '</span>' +
      '<div class="pw"><div class="pb" style="height:' + c / mx * 100 + '%"></div></div><span class="d">' + dm(wk) + '</span></div>'
  }).join('')
  const notes = lasting().map((e) => weeksAfter(e) ? '<span class="faint"><span class="key" style="background:repeating-linear-gradient(135deg, transparent 0 3px, rgba(181,72,42,.45) 3px 5px)"></span>' + e.pct + '% ' + span(e) + ': already in ' + weeksAfter(e) + ' of 8 counts</span>' : '').join('')
  const shorts = COUNT_WEEKS.some((w) => shortIn(w) < 1 - 1e-9) ? '<span class="faint"><span class="sh" style="position:static">50%</span> a short entry that week: the count stays as typed</span>' : ''
  return '<div class="pace"><div class="phead"><span>Typed counts, finished each week</span>' + edit + '</div><div class="pcs">' + cols + '</div>' + notes + shorts + '</div>'
}
const pctWords = (e) => e.pct + '%'
const span = (e) => e.to === null ? 'from ' + dm(e.from) + ' onward' : e.from === e.to ? dm(e.from) : dm(e.from) + '–' + dm(e.to)
const modeSwitch = () => '<span class="modes"><button class="' + (state.mode === 'counts' ? 'on' : '') + '" onclick="setMode(\'counts\')">Pace: typed counts</button><button class="' + (state.mode === 'range' ? 'on' : '') + '" onclick="setMode(\'range\')">Pace: range ' + state.range.join('–') + '</button></span>'
function flags() {
  let h = ui.msg ? '<p class="flag bad">' + esc(ui.msg) + '</p>' : ''
  for (const e of state.entries.filter((x) => !isPast(x))) {
    if (e.pct > 150) h += '<p class="flag warn">' + span(e) + ' at ' + e.pct + '%: the pace comes from a team about ' + Math.round(10000 / e.pct) + '% this size, so it’s a weak guide. A pace range, or comparable work from the bigger team, may be better. New people also take time to reach full pace.</p>'
  }
  for (const e of lasting()) {
    if (caughtUp(e) && !ui['kept' + e.id]) h += '<div class="flag prop"><span>All 8 counted weeks are after ' + dm(e.from) + ', so they already show the team at ' + e.pct + '%. Make it the <b>new usual</b>? The change then ends, so it isn’t counted twice.</span><button onclick="acceptNewUsual(' + e.id + ')">Make it the new usual</button><button class="linkish" onclick="keepLasting(' + e.id + ')">Keep it</button></div>'
    else if (state.mode === 'counts' && !caughtUp(e)) h += '<p class="muted">' + e.pct + '% ' + span(e) + ': ' + weeksAfter(e) + ' of the 8 counted weeks are after the change and already show it, so the forecast doesn’t apply it to them again. When all 8 are, you’ll be asked whether it’s the new usual.</p>'
    else if (state.mode === 'range') h += '<p class="muted">' + e.pct + '% ' + span(e) + ': with a pace range, end this yourself once the range reflects it. <button class="linkish" onclick="endEntry(' + e.id + ')">End it today</button></p>'
  }
  return h
}
function pastBlock(row) {
  const past = state.entries.filter(isPast)
  if (!past.length) return ''
  return '<details class="past"><summary>Past (' + past.length + ') · kept, not used by the forecast</summary>' + row(past) + '</details>'
}

// ---- Variant A: a numbered Capacity section on Inputs, a table of entries, and the forecast strip below ----
function variantA() {
  const now = state.entries.filter((e) => !isPast(e))
  const table = (list, past) => list.length ? '<table class="ent"><thead><tr><th>When</th><th>Capacity</th><th>Note</th><th></th></tr></thead><tbody>' + list.map((e) =>
    '<tr><td>' + span(e) + (e.to === null && !e.newUsual ? ' <span class="tag">lasting</span>' : '') + (e.newUsual ? ' <span class="tag">new usual from ' + dm(e.newUsual) + '</span>' : '') + '</td><td class="pct">' + pctWords(e) + '</td><td>' + esc(e.note) + '</td><td class="x">' + (past ? '' : '<button class="linkish" onclick="removeEntry(' + e.id + ')">Remove</button>') + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">Every week is at 100%.</p>'
  const form = '<div class="add"><label>From <input type="date" id="afrom" value="2026-12-21"></label><label>To <input type="date" id="ato" value="2027-01-01"></label>' +
    '<label class="onward"><input type="checkbox" id="aonward" onchange="document.getElementById(\'ato\').disabled=this.checked"> Onward (lasting)</label>' +
    '<label>Capacity <span class="row" style="gap:4px"><input type="number" id="apct" min="0" max="1000" step="1" value="50">%</span></label><label>Note <input type="text" id="anote" placeholder="Leave, incident…"></label>' +
    '<button onclick="readAdd(\'a\')">Add</button></div>'
  const section = '<section class="input" id="capacity" aria-label="Capacity"><div class="label"><span class="number">04</span><h2>Capacity</h2><p>Weeks when the team has more or less than usual: leave, holidays, incidents, a change in size. The team’s, so it carries over to the next milestone.</p></div><div class="body">' +
    usualLine() + table(now) + flags() + form + assumeLine() + pastBlock((l) => table(l, true)) + '</div></section>'
  const strip = '<div class="strip"><span class="where">On the Milestone forecast</span><span class="head">Starting ' + dmy(START) + ': 85% confident of finishing by <b>' + dm(endOf(W.q85)) + '</b></span>' +
    '<span class="note">' + (W.q85 === U.q85 ? 'Capacity doesn’t move the 85% date.' : 'Capacity moves it ' + shift(U.q85, W.q85) + ' than at usual capacity (' + dm(endOf(U.q85)) + ').') + ' <a href="#capacity">Capacity</a></span></div>'
  return '<div class="row" style="justify-content:space-between">' + modeSwitch() + '</div>' + section + strip
}

// ---- Variant B: the coming weeks as a strip; click a week to set it; 50% and 85% marked with and without capacity ----
function variantB() {
  const N = Math.max(20, Math.min(HORIZON, Math.max(W.q85, U.q85) + 3))
  const cols = Array.from({ length: N }, (_, k) => {
    const ws = add(START, 7 * k), c = capOfWeek(ws), h = Math.min(c, 2) / 2 * 80
    const mk = (r, cls) => (r.q50 === k ? '<span class="' + cls + '">50</span>' : '') + (r.q85 === k ? '<span class="' + cls + '">85</span>' : '')
    return '<div class="wk' + (ui.sel === ws ? ' sel' : '') + '" onclick="ui.sel=\'' + ws + '\';render()" title="Week of ' + dm(ws) + '">' +
      '<span class="pctv' + (c < 1 ? ' low' : '') + '">' + (Math.abs(c - 1) > 1e-9 ? Math.round(c * 100) : '') + '</span>' +
      '<div class="well"><div class="line100" style="bottom:40px"></div><div class="fill" style="height:' + h + 'px"></div></div>' +
      '<span class="d">' + dm(ws) + '</span><div class="mk">' + mk(W, 'with') + mk(U, 'without') + '</div></div>'
  }).join('')
  const pop = ui.sel ? '<div class="pop"><b>Week of ' + dm(ui.sel) + ' · now ' + Math.round(capOfWeek(ui.sel) * 100) + '%</b>' +
    '<div class="add"><label>Capacity <span class="row" style="gap:4px"><input type="number" id="bpct" min="0" max="1000" step="1" value="50">%</span></label>' +
    '<label>Note <input type="text" id="bnote" placeholder="Leave, incident…"></label>' +
    '<input type="hidden" id="bfrom" value="' + ui.sel + '"><input type="hidden" id="bto" value="' + add(ui.sel, 4) + '">' +
    '<label class="onward"><input type="checkbox" id="bonward"> From this week onward (lasting)</label>' +
    '<button onclick="readAdd(\'b\');ui.sel=null">Set</button><button class="linkish" onclick="ui.sel=null;render()">Cancel</button></div>' +
    '<span class="faint">For a single day (a public holiday), use the list below: the strip sets whole weeks.</span></div>' : ''
  const chips = state.entries.filter((e) => !isPast(e)).map((e) => '<span class="chip">' + e.pct + '% ' + span(e) + (e.note ? ' · ' + esc(e.note) : '') + '<button class="x" onclick="removeEntry(' + e.id + ')" aria-label="Remove">×</button></span>').join('')
  return '<div class="row" style="justify-content:space-between">' + modeSwitch() + '</div>' +
    '<div class="strip"><span class="where">On the Milestone forecast</span><span class="head">Starting ' + dmy(START) + ': 85% confident of finishing by <b>' + dm(endOf(W.q85)) + '</b></span>' +
    '<span class="note">At usual capacity: ' + dm(endOf(U.q85)) + ' (' + shift(U.q85, W.q85) + ' with capacity)</span></div>' +
    '<section class="col"><h3 style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">Capacity, week by week</h3>' + usualLine() +
    '<div class="tl">' + cols + '</div>' +
    '<p class="faint"><span class="key" style="background:var(--ink)"></span>50 and 85: when the forecast is that confident, with capacity · <span class="key" style="border:1px dashed var(--muted)"></span>at usual capacity · click a week to change it</p>' +
    pop + flags() + '<div class="chips">' + chips + '</div>' + assumeLine() + pastBlock((l) => '<div class="chips">' + l.map((e) => '<span class="chip" style="padding-right:10px">' + e.pct + '% ' + span(e) + (e.newUsual ? ' · new usual' : '') + '</span>').join('') + '</div>') + '</section>'
}

// ---- Variant C: on the Milestone forecast; the dates side by side, the finish graph both ways, capacity typed as a sentence in a side panel ----
function variantC() {
  // Pace first; capacity is an extra the EM can fold away or switch off. Folded or off, the screen is the pace forecast
  // alone; open and on, the forecast shows what capacity changes beside it.
  const active = state.entries.filter((e) => !isPast(e))
  const on = state.useCapacity !== false
  const A = on ? W : U, cmp = on && ui.capOpen && active.length > 0
  const rows = [['50%', 'q50'], ['85%', 'q85'], ['95%', 'q95']].map(([p, k]) => '<tr><td>' + p + ' confident by</td><td><b>' + dm(endOf(A[k])) + '</b></td>' + (cmp ? '<td>' + dm(endOf(U[k])) + '</td><td>' + shift(U[k], W[k]) + '</td>' : '') + '</tr>').join('')
  // The finish graph is the forecast's own, one series, whether capacity is open or not
  const lo = A.finish[0], hi = A.q95 + 1
  const cw = new Array(hi - lo + 1).fill(0); for (const f of A.finish) if (f <= hi) cw[f - lo]++
  const mx = Math.max(...cw), n = hi - lo + 1, at = (k) => ((k - lo + 0.5) / n * 100).toFixed(2) + '%'
  const hist = '<div class="histwrap"><div class="mrow top">' + [['50%', A.q50], ['85%', A.q85]].map(([p, k]) => '<span class="mtag with" style="left:' + at(k) + '">' + p + ' · ' + dm(endOf(k)) + '</span>').join('') + '</div>' +
    '<div class="hist">' + cw.map((v, i) => '<div class="b one" title="Week of ' + dm(add(START, 7 * (lo + i))) + ': ' + v + ' of ' + TRIALS + ' simulations finish"><span class="w" style="height:' + v / mx * 100 + '%"></span></div>').join('') +
    [A.q50, A.q85].map((k) => '<div class="mline with" style="left:' + at(k) + '"></div>').join('') + '</div></div>' +
    '<div class="row" style="justify-content:space-between"><span class="faint">' + dm(add(START, 7 * lo)) + '</span><span class="faint">' + dm(add(START, 7 * hi)) + '</span></div>'
  // Each entry's own effect: the forecast again without it
  const effect = {}
  if (on && ui.capOpen) for (const e of active) { const keep = state.entries; state.entries = keep.filter((x) => x !== e); const r = simulate(true); state.entries = keep; effect[e.id] = W.q85 - r.q85 }
  const effText = (e) => !(e.id in effect) ? '' : effect[e.id] === 0 ? '<span class="eff">no change to the 85% date</span>' : '<span class="eff ' + (effect[e.id] > 0 ? 'later' : 'sooner') + '">85% date ' + (effect[e.id] > 0 ? '+' : '−') + Math.abs(effect[e.id]) + ' wk</span>'
  const editForm = (e) => {
    const past = isPast(e)
    return '<div class="pop" style="gap:8px">' + (past ? '<span class="faint">' + e.pct + '% ' + span(e) + ' · past, so only the note can change</span>' :
      '<div class="sentence">At <input type="number" id="epct" min="0" max="1000" step="1" value="' + e.pct + '">% from <input type="date" id="efrom" value="' + e.from + '"> to <input type="date" id="eto" value="' + (e.to || '') + '"' + (e.to === null ? ' disabled' : '') + '> <label style="font-size:13px"><input type="checkbox" id="eonward"' + (e.to === null ? ' checked' : '') + ' onchange="document.getElementById(\'eto\').disabled=this.checked"> or onward</label></div>') +
      '<label class="faint" style="display:flex;flex-direction:column;gap:2px">Note <input type="text" id="enote" value="' + esc(e.note) + '"></label>' +
      '<div class="row"><button class="primary" onclick="saveEdit(' + e.id + ')">Save</button><button class="linkish" onclick="ui.edit=null;render()">Cancel</button></div>' +
      (e.revisions ? '<span class="faint">Changed ' + e.revisions.length + '× · earlier versions kept for the period review</span>' : '') + '</div>'
  }
  const lineC = (e, past) => ui.edit === e.id ? editForm(e) :
    '<div class="sline"><span><b>' + e.pct + '%</b> ' + span(e) + (e.newUsual ? ' · new usual from ' + dm(e.newUsual) : '') + (e.note ? ' <span class="faint">' + esc(e.note) + '</span>' : '') + (past ? '' : ' ' + effText(e)) + (e.revisions ? ' <span class="tag" title="' + esc(e.revisions.map((r) => r.changedOn + ': was ' + r.pct + '% ' + r.from + '..' + (r.to || 'onward') + ' ' + r.note).join('\n')) + '">edited</span>' : '') + '</span>' +
    '<span class="row" style="gap:10px;flex-wrap:nowrap"><button class="linkish" onclick="startEdit(' + e.id + ')">Edit</button>' + (past ? '' : '<button class="linkish" onclick="removeEntry(' + e.id + ')">Remove</button>') + '</span></div>'
  const lines = state.entries.filter((e) => !isPast(e)).map((e) => lineC(e, false)).join('') || '<p class="muted">Every week is at 100%.</p>'
  const sentence = '<div class="sentence">The team is at <input type="number" id="cpct" min="0" max="1000" step="1" value="50">% from <input type="date" id="cfrom" value="2026-12-21"> to <input type="date" id="cto" value="2027-01-01"> <label style="font-size:13px"><input type="checkbox" id="conward" onchange="document.getElementById(\'cto\').disabled=this.checked"> or onward</label>, for <input type="text" id="cnote" placeholder="leave, an incident…">. <button onclick="readAdd(\'c\')">Add</button></div>'
  // One quiet line under the headline, only when capacity has something to say
  const quiet = !active.length ? '' : !on ? '<p class="faint">Capacity is switched off for this forecast; its ' + active.length + ' entr' + (active.length > 1 ? 'ies are' : 'y is') + ' kept.</p>'
    : W.q85 === U.q85 ? '<p class="faint">Includes capacity, which doesn’t move the 85% date.</p>'
    : '<p class="faint">Includes capacity, which moves the 85% date ' + shift(U.q85, W.q85) + '.' + (ui.capOpen ? '' : ' <button class="linkish" onclick="ui.capOpen=true;render()">Show</button>') + '</p>'
  const summary = (!active.length ? 'none, every week usual' : (on ? '' : 'off · ') + active.length + ' entr' + (active.length > 1 ? 'ies' : 'y') + (on && W.q85 !== U.q85 ? ' · 85% date ' + shift(U.q85, W.q85) : ''))
  const capBody = '<label class="row" style="gap:6px;font-size:13px"><input type="checkbox"' + (on ? ' checked' : '') + ' onchange="state.useCapacity=this.checked;log.push(\'use capacity \' + this.checked);render()"> Use capacity in this forecast</label>' +
    (on ? '' : '<p class="faint" style="margin:0">Off: the forecast uses pace alone. Entries are kept, and still count for other milestones.</p>') +
    usualLine() + lines + flags() + sentence + assumeLine() + pastBlock((l) => l.map((e) => lineC(e, true)).join(''))
  return '<div class="row" style="justify-content:space-between">' + modeSwitch() + '<span class="faint">Shown as the Milestone forecast screen</span></div>' +
    '<div class="fc"><div class="col" style="gap:18px"><p class="bighead">Starting ' + dmy(START) + ': 85% confident of finishing by <span style="color:var(--good)">' + dm(endOf(A.q85)) + '</span></p>' + quiet +
    '<section class="brief"><div class="heading"><h2>When it could finish</h2></div><table class="pc">' + (cmp ? '<thead><tr><th></th><th>With capacity</th><th>At usual capacity</th><th></th></tr></thead>' : '') + '<tbody>' + rows + '</tbody></table></section>' +
    '<section class="brief"><div class="heading"><h2>Pace, week by week</h2></div>' + paceWeeks(A, on) + '</section>' +
    '<section class="brief"><div class="heading"><h2>When the simulations finish</h2></div>' + hist + '</section></div>' +
    '<aside class="side"><h3>Pace</h3>' + paceSummary() +
    '<details class="cap"' + (ui.capOpen ? ' open' : '') + ' ontoggle="if(ui.capOpen!==this.open){ui.capOpen=this.open;render()}"><summary><span class="ctitle">Capacity</span> <span class="faint">' + summary + '</span></summary><div class="col" style="gap:10px;margin-top:10px">' + capBody + '</div></details></aside></div>'

}

// ---- switcher and render ----
function go(v, s) {
  variant = v; if (s && s !== scenario) { scenario = s; state = SCENARIOS[s].make(); ui = { sel: null }; log.length = 0 }
  const p = new URLSearchParams(location.search); p.set('variant', variant); p.set('scenario', scenario)
  history.replaceState(null, '', '?' + p); render()
}
function cycle(d) { const ks = Object.keys(VARIANTS); go(ks[(ks.indexOf(variant) + d + ks.length) % ks.length]) }
function render() {
  W = simulate(true); U = simulate(false)
  document.getElementById('proto').innerHTML = ({ A: variantA, B: variantB, C: variantC })[variant]()
  document.getElementById('state').textContent = JSON.stringify({ variant, scenario, team: { capacity: state.entries }, milestone: { start: START, ticketsRemaining: TICKETS, pace: state.mode === 'counts' ? { typedCounts: COUNTS } : { range: state.range } },
    forecast: { withCapacity: { p50: endOf(W.q50), p85: endOf(W.q85) }, atUsual: { p50: endOf(U.q50), p85: endOf(U.q85) } },
    next20WeeksCapacity: Array.from({ length: 20 }, (_, k) => Math.round(capOfWeek(add(START, 7 * k)) * 100)), actions: log }, null, 1)
  document.getElementById('switcher').innerHTML = '<button onclick="cycle(-1)">←</button><b>' + variant + ' (' + VARIANTS[variant] + ')</b><button onclick="cycle(1)">→</button>' +
    '<select onchange="go(variant,this.value)">' + Object.entries(SCENARIOS).map(([k, s]) => '<option value="' + k + '"' + (k === scenario ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select>' +
    '<button onclick="state=SCENARIOS[scenario].make();ui={sel:null};log.length=0;render()">Reset</button>'
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === 'ArrowLeft') cycle(-1); if (e.key === 'ArrowRight') cycle(1)
})
ui.capOpen = params.get('cap') === 'open'
go(variant)
`

const header = {
  context: 'Checkout v2',
  heading: 'Inputs',
  lede: 'Prototype for “Entering capacity and seeing its effect on the forecast”. Flip variants with ← → and pick a scenario in the bar below.',
}
mkdirSync(new URL('.', out), { recursive: true })
writeFileSync(out, htmlPage('/inputs', header, MAIN, SCRIPT))
const file = fileURLToPath(out)
console.log(`Prototype written to ${file}`)
if (!process.env.NO_OPEN) spawn('open', [file], { stdio: 'ignore', detached: true }).unref()
