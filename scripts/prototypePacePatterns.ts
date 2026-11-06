// PROTOTYPE, throwaway: never merge. Wayfinder ticket "How a pace-pattern suggestion and its actions appear"
// (https://github.com/random11235/forecaster-next-gen/issues/138), building on "What actions fit each pace pattern"
// (https://github.com/random11235/forecaster-next-gen/issues/128) and the pace reading in variant D of
// prototype/measured-values (#129).
//
// Three variants of showing that pace fits a pattern, and the forecast action proposed for it, on the Milestone forecast
// screen, switchable via `?variant=A|B|C`; `?scenario=` picks the GitHub weeks. Readings follow
// docs/research/pace-stability/classify.mjs; a stand-in simulation (not the engine) forecasts from the weeks in use.
// All state is in memory; reload to reset. Run: `npm run prototype:pace-patterns`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { htmlPage }: typeof import('../src/app/html.js') = await import(new URL('../dist/app/html.js', import.meta.url).href)

const out = new URL('../dist/prototype/pace-patterns.html', import.meta.url)

const STYLE = `
  <style>
    .proto-banner { font-size: 12px; color: var(--risk); font-family: var(--mono); }
    .linkish { border: 0; background: none; padding: 0; min-height: 0; color: var(--link); text-decoration: underline; cursor: pointer; font-size: 13px; }
    .muted { color: var(--muted); font-size: 13px; }
    .faint { color: var(--faint); font-size: 12px; }
    .row { display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: center; }
    .col { display: flex; flex-direction: column; gap: 8px; }
    .fc { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 28px; }
    @media (max-width: 860px) { .fc { grid-template-columns: 1fr; } }
    .bighead { font-size: clamp(20px, 2.5vw, 30px); font-weight: 600; letter-spacing: -.01em; line-height: 1.2; margin: 0; }
    .good { color: var(--good); } .bighead .good { white-space: nowrap; } .later { color: var(--risk); } .sooner { color: var(--good); }
    table.pc { border-collapse: collapse; font-size: 14px; }
    table.pc th { text-align: left; font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; padding: 0 20px 6px 0; font-weight: 600; }
    table.pc td { padding: 6px 20px 6px 0; border-top: 1px solid var(--hairline); font-variant-numeric: tabular-nums; }
    .side { border-left: 1px solid var(--hairline); padding-left: 20px; display: flex; flex-direction: column; gap: 12px; }
    .side h3 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .pace { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--hairline); border-radius: 6px; padding: 10px 12px; background: #fff; }
    .phead { display: flex; gap: 10px; justify-content: space-between; font-size: 12px; color: var(--muted); }
    /* week strip */
    .wks { display: flex; gap: 2px; align-items: flex-end; position: relative; }
    .wk { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; border-radius: 3px; padding: 2px 0; position: relative; }
    .wk .n { font-family: var(--mono); font-size: 11px; color: var(--ink); height: 14px; }
    .wk .w { height: 60px; width: 70%; display: flex; flex-direction: column; justify-content: flex-end; }
    .wk .b { background: var(--bar); border-radius: 2px 2px 0 0; min-height: 1px; }
    .wk .d { font-size: 9px; color: var(--faint); white-space: nowrap; height: 11px; }
    .wk.older .b { background: var(--hairline); } .wk.older .n { color: var(--faint); }
    .wk.out .b { background: transparent; border: 1px dashed var(--muted); border-bottom: 0; } .wk.out .n { color: var(--faint); text-decoration: line-through; }
    .wk.zero .w { background: repeating-linear-gradient(135deg, transparent 0 4px, var(--hairline) 4px 5px); }
    .wk.hl { background: rgba(181,72,42,.10); } .wk.hl .n { color: var(--risk); font-weight: 600; }
    .wk.click { cursor: pointer; } .wk.click:hover { background: var(--active); }
    .wks.big .wk .w { height: 120px; } .wks.big .wk .n { font-size: 12px; } .wks.big .wk .d { font-size: 10px; }
    .divider { position: absolute; top: 0; bottom: 12px; border-left: 2px solid var(--risk); pointer-events: none; }
    .divider span { position: absolute; top: -18px; left: 4px; font-size: 11px; color: var(--risk); white-space: nowrap; }
    .avgline { position: absolute; border-top: 2px dashed var(--muted); pointer-events: none; }
    .avgline span { position: absolute; right: 0; top: -15px; font-size: 10px; font-family: var(--mono); color: var(--muted); white-space: nowrap; }
    .callout { position: absolute; font-size: 11px; color: var(--risk); white-space: nowrap; transform: translateX(-50%); pointer-events: none; }
    /* A: the reading under the pace */
    details.read { font-size: 13px; border-top: 1px solid var(--hairline); padding-top: 8px; }
    details.read summary { cursor: pointer; list-style: none; }
    details.read summary::before { content: '▸ '; color: var(--muted); font-size: 11px; }
    details.read[open] summary::before { content: '▾ '; }
    details.read p { margin: 6px 0; line-height: 1.45; color: var(--text-2); }
    .both { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; font-size: 13px; margin: 6px 0; }
    .both .on { font-weight: 600; }
    .applied { font-size: 13px; background: #EEF4F2; border-left: 3px solid var(--good); padding: 6px 10px; border-radius: 4px; display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: baseline; }
    /* B */
    .legend { display: flex; gap: 14px; flex-wrap: wrap; }
    .hint { font-size: 13px; line-height: 1.45; color: var(--text-2); margin: 0; max-width: 680px; }
    .hint b { color: var(--ink); }
    /* C: the suggestion card */
    .card { border: 1px solid var(--ink); border-radius: 8px; padding: 14px 16px; background: #fff; display: flex; flex-direction: column; gap: 10px; }
    .card .q { font-size: 16px; font-weight: 600; margin: 0; }
    .card .ev { font-size: 13px; color: var(--text-2); margin: 0; line-height: 1.45; }
    .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
    .choice { text-align: left; border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; background: var(--page); cursor: pointer; display: flex; flex-direction: column; gap: 2px; min-height: 0; font: inherit; color: var(--ink); }
    .choice:hover { border-color: var(--ink); }
    .choice.on { border: 2px solid var(--good); background: #EEF4F2; }
    .choice .t { font-size: 13px; color: var(--muted); } .choice .dt { font-size: 18px; font-weight: 600; } .choice .s { font-size: 12px; color: var(--faint); }
    details.more summary { cursor: pointer; font-size: 13px; color: var(--muted); }
    details.more p, details.more li { font-size: 13px; color: var(--text-2); line-height: 1.45; }
    .switcher { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 10; display: flex; gap: 10px; align-items: center;
      background: #111; color: #fff; padding: 8px 12px; border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.3); font-size: 13px; }
    .switcher button { color: #fff; border-color: #444; min-height: 28px; background: transparent; }
    .switcher select { font: inherit; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; padding: 3px 6px; }
    details.state { font-size: 12px; margin-bottom: 70px; }
    details.state pre { background: var(--sidebar); padding: 12px; border-radius: 6px; overflow: auto; font-family: var(--mono); font-size: 11px; }
  </style>`

const MAIN = `${STYLE}
    <p class="proto-banner">PROTOTYPE · stand-in simulation, not the engine · synthetic GitHub weeks · nothing is saved · reload resets · today is 4 Nov 2026</p>
    <div id="proto"></div>
    <details class="state"><summary>State (what would be stored)</summary><pre id="state"></pre></details>
    <div class="switcher" id="switcher"></div>`

const SCRIPT = String.raw`
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const toD = (iso) => new Date(iso + 'T00:00:00Z')
const add = (iso, n) => { const d = toD(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dm = (iso) => { const d = toD(iso); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] }
const wc = (iso) => 'w/c ' + dm(iso)
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's')
const START = '2026-11-02', TICKETS = 40, GROWTH = [1, 1.25], WINDOW = 8, MIN_AFTER = 4

// ---- scenarios: 12 weeks GitHub has, oldest first, ending w/c 26 Oct (the last whole week) ----
const SCENARIOS = {
  steady:   { name: 'Steady (no pattern)', n: [6, 5, 7, 6, 5, 7, 4, 6, 8, 5, 6, 7] },
  short:    { name: 'Only 5 weeks of history', n: [6, 4, 7, 5, 6] },
  quietEnd: { name: 'Quiet weeks at the end', n: [5, 6, 7, 5, 6, 5, 7, 6, 5, 6, 0, 0] },
  odd:      { name: 'One odd week (a bulk close)', n: [5, 6, 4, 6, 5, 6, 4, 31, 6, 5, 7, 5],
              cause: { at: 7, text: '24 of the 31 were closed within 12 minutes on 1 Oct, 19 of them as not planned' } },
  changed:  { name: 'Pace changed 4 weeks ago', n: [3, 4, 3, 4, 3, 4, 3, 4, 8, 9, 7, 8] },
  recent:   { name: 'Pace changed 2 weeks ago', n: [4, 3, 4, 4, 3, 4, 3, 4, 4, 3, 9, 8] },
  speeding: { name: 'Speeding up', n: [2, 2, 3, 3, 4, 5, 6, 7, 7, 8, 8, 9] },
  lumpy:    { name: 'Lumpy (batches)', n: [9, 0, 2, 11, 0, 12, 1, 0, 9, 2, 11, 0] },
}
const VARIANTS = { A: 'A line under the pace', B: 'Drawn on the weeks', C: 'A question above the forecast' }
const params = new URLSearchParams(location.search)
let variant = VARIANTS[params.get('variant')] ? params.get('variant') : 'A'
let scenario = SCENARIOS[params.get('scenario')] ? params.get('scenario') : 'changed'
let S, weeks, state, ui
const log = []
function load() {
  S = SCENARIOS[scenario]
  const last = '2026-10-26'
  weeks = S.n.map((n, i) => ({ i, n, start: add(last, -7 * (S.n.length - 1 - i)) }))
  state = { out: [], from: null, dismissed: null } // what the EM decided; null/[] = follow GitHub as read
  ui = {}
  log.length = 0
}

// The weeks in use: from a chosen start, or the latest 8 not left out (the window reaches back past skipped weeks).
function inUse(st) {
  const keep = weeks.filter((w) => !st.out.includes(w.i))
  if (st.from !== null) return keep.filter((w) => w.i >= st.from)
  return keep.slice(-WINDOW)
}
const defaultWeeks = () => weeks.slice(-WINDOW)

// ---- readings (classify.mjs rules), on GitHub's 8 weeks as read, before anything the EM did ----
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
const sdv = (a) => { const m = avg(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)) }
function mkP(a) {
  const n = a.length; let s = 0
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(a[j] - a[i])
  const ties = new Map(); for (const x of a) ties.set(x, (ties.get(x) || 0) + 1)
  let tt = 0; for (const t of ties.values()) tt += t * (t - 1) * (2 * t + 5)
  const v = (n * (n - 1) * (2 * n + 5) - tt) / 18; if (v <= 0) return 1
  const z = s === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(v), t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2)
  return 2 * (1 - 0.5 * (1 + y))
}
function lag1(a) { const m = avg(a); let num = 0, den = 0; for (let i = 0; i < a.length; i++) { den += (a[i] - m) ** 2; if (i) num += (a[i] - m) * (a[i - 1] - m) } return den ? num / den : 0 }
// Where the pace most likely changed: the split of all GitHub's weeks with the biggest difference in averages.
function changePoint() {
  const ns = weeks.map((w) => w.n); let best = null
  for (let k = 2; k <= ns.length - 2; k++) {
    const a = ns.slice(0, k), b = ns.slice(k), se = Math.sqrt((sdv(a) ** 2 + 0.5) / a.length + (sdv(b) ** 2 + 0.5) / b.length), t = Math.abs(avg(b) - avg(a)) / se
    if (!best || t > best.t) best = { k, t, before: avg(a), after: avg(b) }
  }
  return best
}
function reading() {
  const cells = defaultWeeks(), ns = cells.map((c) => c.n)
  if (cells.length < 6) return { kind: 'none', name: 'No pattern yet', short: plural(cells.length, 'week') + ' is too few to tell' }
  let run = 0; for (let i = ns.length - 1; i >= 0 && ns[i] === 0; i--) run++
  const before = ns.slice(0, ns.length - run)
  if (run >= 2 && avg(before) > 0) {
    const quiet = cells.slice(-run)
    return { kind: 'quietEnd', name: run + ' quiet weeks at the end', short: 'nothing finished since ' + wc(quiet[0].start),
      detail: 'Nothing has finished since ' + wc(quiet[0].start) + ', after ' + Math.min(...before) + ' to ' + Math.max(...before) + ' a week before: a break, a freeze, or a real drop in pace.',
      ask: 'If those weeks were time off or a freeze, skip them; if this is the pace now, count them as 0.',
      alt: { out: quiet.map((c) => c.i), from: null }, altName: 'Skip the ' + run + ' quiet weeks', keepName: 'Count them as 0', weeksHi: quiet.map((c) => c.i) }
  }
  const med = [...ns].sort((a, b) => a - b)[ns.length >> 1], iMax = ns.indexOf(Math.max(...ns)), rest = ns.filter((_, i) => i !== iMax)
  if ((ns[iMax] - med) / Math.max(1, Math.sqrt(med)) > 4 && sdv(rest) ** 2 / Math.max(1e-9, avg(rest)) < 2) {
    const c = cells[iMax], cause = S.cause && S.cause.at === c.i ? S.cause.text : null
    return { kind: 'odd', name: 'One odd week', short: wc(c.start) + ' finished ' + c.n,
      detail: wc(c.start) + ' finished ' + c.n + ', far above the ' + Math.min(...rest) + ' to ' + Math.max(...rest) + ' of the other weeks' + (cause ? ': GitHub shows ' + cause + ', which looks like a clean-up rather than work done.' : ', and GitHub shows nothing unusual about how they closed.'),
      ask: 'Leave it out only if you know why it was different; otherwise keep it.',
      alt: { out: [c.i], from: null }, altName: 'Leave out ' + wc(c.start), keepName: 'Keep it', weeksHi: [c.i], cause }
  }
  if (mkP(ns) < 0.05 || lag1(ns) > 0.3) {
    const cp = changePoint(), at = weeks[cp.k], after = weeks.length - cp.k, up = cp.after > cp.before
    const base = { kind: 'changing', name: 'Pace changing', short: (up ? 'higher' : 'lower') + ' since about ' + wc(at.start),
      detail: 'Since about ' + wc(at.start) + ' the team finishes about ' + Math.round(cp.after) + ' a week, against ' + Math.round(cp.before) + ' before, and eight weeks can’t tell whether that will last.',
      ask: 'If you know why it changed, such as people joining or leaving, start the pace at the change.', changeAt: cp.k, weeksHi: weeks.slice(cp.k).map((w) => w.i) }
    if (after < MIN_AFTER) return { ...base, wait: MIN_AFTER - after, short: base.short + ', ' + plural(after, 'week') + ' so far',
      ask: 'Wait ' + plural(MIN_AFTER - after, 'week') + ' more: ' + plural(after, 'week') + ' since the change is too few to start the pace there, so the range stays wide until then.' }
    return { ...base, alt: { out: [], from: cp.k }, altName: 'Start at ' + wc(at.start) + ' (' + plural(after, 'week') + ')', keepName: 'Keep all 8 weeks' }
  }
  const zeros = ns.filter((n) => n === 0).length
  if (sdv(ns) ** 2 / Math.max(1e-9, avg(ns)) > 2)
    return { kind: 'lumpy', name: 'Lumpy', short: zeros ? plural(zeros, 'quiet week') + ' among busy ones' : 'weeks vary a lot',
      detail: 'Work finishes in batches, ' + Math.min(...ns) + ' to ' + Math.max(...ns) + ' a week, so the range is wide because the team’s pace really varies.',
      team: 'To narrow the range, split work smaller, finish items before starting new ones, and close tickets as soon as they’re done.', weeksHi: cells.filter((c) => c.n === 0).map((c) => c.i) }
  return { kind: 'none', name: 'No pattern yet', short: '8 weeks shows nothing the forecast should change' }
}

// ---- stand-in simulation: bootstrap from the weeks in use, same seed every time ----
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function forecast(st) {
  const ns = inUse(st).map((w) => w.n), r = mulberry(138), T = 2000, fin = []
  if (!ns.some((n) => n > 0)) return { q50: null, q85: null }
  for (let t = 0; t < T; t++) {
    let left = Math.ceil(TICKETS * (GROWTH[0] + r() * (GROWTH[1] - GROWTH[0]))), k = 0
    for (; k < 156 && left > 0; k++) left -= ns[Math.floor(r() * ns.length)]
    fin.push(k - 1)
  }
  fin.sort((a, b) => a - b)
  const q = (p) => fin[Math.ceil(p * T) - 1]
  return { q50: q(.5), q85: q(.85), used: ns.length }
}
const endOf = (k) => k === null ? 'no date' : dm(add(START, 7 * k + 6))
const shift = (a, b) => { const d = b - a; return d === 0 ? 'same week' : d > 0 ? '<span class="later">' + plural(d, 'week') + ' later</span>' : '<span class="sooner">' + plural(-d, 'week') + ' sooner</span>' }
const NONE = { out: [], from: null }
const isDefault = () => !state.out.length && state.from === null
const isAlt = (R) => R.alt && JSON.stringify(state.out) === JSON.stringify(R.alt.out) && state.from === R.alt.from

// ---- actions ----
function apply(st, why) { state.out = [...st.out]; state.from = st.from; state.dismissed = null; log.push(why); render() }
function useAlt() { const R = reading(); apply(R.alt, 'apply: ' + R.altName) }
function useDefault(why) { apply(NONE, why || 'back to GitHub’s 8 weeks') }
function dismiss() { state.dismissed = reading().kind; log.push('keep as is: ' + reading().kind); render() }
function toggleWeek(i) { const out = state.out.includes(i) ? state.out.filter((x) => x !== i) : [...state.out, i].sort((a, b) => a - b); apply({ out, from: state.from }, (state.out.includes(i) ? 'put back ' : 'leave out ') + wc(weeks[i].start)) }
function startAt(i) { apply({ out: state.out, from: state.from === i ? null : i }, state.from === i ? 'no start date' : 'start at ' + wc(weeks[i].start)) }

// ---- shared pieces ----
// The weeks GitHub has: in use (bars), older than the window (pale), left out (dashed); the reading's weeks tinted.
function strip(R, big, clickable) {
  const used = inUse(state).map((w) => w.i), mx = Math.max(...weeks.map((w) => w.n), 1)
  const cols = weeks.map((w) => {
    const cls = ['wk', used.includes(w.i) ? '' : state.out.includes(w.i) ? 'out' : 'older', w.n === 0 ? 'zero' : '', R && R.weeksHi && R.weeksHi.includes(w.i) && R.kind !== 'changing' ? 'hl' : '', clickable ? 'click' : ''].join(' ')
    const tip = wc(w.start) + ': ' + w.n + ' finished · ' + (used.includes(w.i) ? 'in use' : state.out.includes(w.i) ? 'left out' : 'not in the window') + (clickable ? ' · click to ' + (state.out.includes(w.i) ? 'put back' : 'leave out') : '')
    return '<div class="' + cls + '" title="' + tip + '"' + (clickable ? ' onclick="toggleWeek(' + w.i + ')"' : '') + '><span class="n">' + w.n + '</span><div class="w"><div class="b" style="height:' + (w.n / mx * 100) + '%"></div></div><span class="d">' + (w.i % 2 === weeks.length % 2 ? '' : dm(w.start)) + '</span></div>'
  }).join('')
  return '<div class="wks' + (big ? ' big' : '') + '">' + cols + (big && R ? overlay(R, mx) : '') + '</div>'
}
// B only: the pattern drawn over the big strip
function overlay(R, mx) {
  const n = weeks.length, x = (i) => (i / n * 100) + '%'
  if (R.kind === 'changing') {
    const cp = changePoint(), y = (v) => 'calc(' + (12) + 'px + ' + (120 * (1 - v / mx)) + 'px + 14px)'
    return '<div class="divider" style="left:calc(' + x(R.changeAt) + ' - 1px)"><span>changed about here?</span></div>' +
      '<div class="avgline" style="left:0;width:' + x(R.changeAt) + ';top:' + y(cp.before) + '"><span>≈' + Math.round(cp.before) + '</span></div>' +
      '<div class="avgline" style="left:' + x(R.changeAt) + ';right:0;top:' + y(cp.after) + '"><span>≈' + Math.round(cp.after) + '</span></div>'
  }
  if (R.kind === 'odd') return '<span class="callout" style="left:' + x(R.weeksHi[0] + .5) + ';top:-16px">' + (R.cause ? 'bulk close?' : 'odd week') + '</span>'
  if (R.kind === 'quietEnd') return '<span class="callout" style="left:' + x(n - R.weeksHi.length / 2) + ';top:-16px">nothing finished</span>'
  return ''
}
function dates(st, label) { const f = forecast(st); return { f, html: '<span>' + label + '</span><span><b>' + endOf(f.q85) + '</b></span>' } }
function head(F, note) {
  return '<p class="bighead">Starting 2 Nov 2026: 85% confident of finishing by <span class="good">' + endOf(F.q85) + '</span></p>' + (note || '')
}
function table(F, cmp) {
  const rows = [['50%', 'q50'], ['85%', 'q85']].map(([p, k]) => '<tr><td>' + p + ' confident by</td><td><b>' + endOf(F[k]) + '</b></td>' + (cmp ? '<td>' + endOf(cmp[k]) + '</td>' : '') + '</tr>').join('')
  return '<section class="brief"><div class="heading"><h2>When it could finish</h2></div><table class="pc">' + (cmp ? '<thead><tr><th></th><th>As set</th><th>GitHub’s 8 weeks</th></tr></thead>' : '') + '<tbody>' + rows + '</tbody></table></section>'
}
function paceLine() {
  const u = inUse(state), ns = u.map((w) => w.n)
  return '<p class="faint" style="margin:0">' + (isDefault() ? 'From GitHub: the ' + plural(u.length, 'week') : 'As you set it: ' + plural(u.length, 'week')) + ' ' + dm(u[0].start) + '–' + dm(add(u[u.length - 1].start, 6)) + ', ' + Math.min(...ns) + ' to ' + Math.max(...ns) + ' a week' + (state.out.length ? ', ' + plural(state.out.length, 'week') + ' left out' : '') + '.</p>'
}

// ---- Variant A: the reading is one line under the pace, as in measured-values D; open it for the forecast both ways
// and one button. 'No pattern yet' shows, faint, so the EM knows it looked.
function variantA() {
  const R = reading(), F = forecast(state)
  let read
  if (R.kind === 'none') read = '<p class="faint" style="margin:0">No pattern yet · ' + R.short + '</p>'
  else if (!isDefault()) read = '<div class="applied"><span>' + (isAlt(R) ? R.altName : 'Weeks changed by hand') + '. GitHub’s 8 weeks would say ' + endOf(forecast(NONE).q85) + '.</span><button class="linkish" onclick="useDefault()">Undo</button></div>'
  else {
    const keep = dates(NONE, R.keepName || 'As GitHub reads it'), alt = R.alt ? dates(R.alt, R.altName) : null
    read = '<details class="read"' + (ui.open ? ' open' : '') + ' ontoggle="ui.open=this.open"><summary><b>' + R.name + '</b> · ' + R.short + '</summary>' +
      '<p>' + R.detail + '</p>' + (R.team ? '<p class="faint">' + R.team + '</p>' : '') +
      (alt ? '<div class="both">' + keep.html + alt.html + '</div><p class="faint" style="margin:0">' + R.ask + '</p><div class="row"><button onclick="useAlt()">' + R.altName + '</button></div>' : R.ask ? '<p class="faint">' + R.ask + '</p>' : '') +
      '</details>'
  }
  return '<div class="col" style="gap:22px">' + head(F) + '<div class="fc"><div class="col" style="gap:18px">' + table(F) + '</div>' +
    '<aside class="side"><h3>Pace</h3><div class="pace"><div class="phead"><span>Finished each week · GitHub</span><a href="#" onclick="return false">Change</a></div>' + strip(R, false, false) + paceLine() + read + '</div></aside></div></div>'
}

// ---- Variant B: the week-by-week pace is the main picture, and the pattern is drawn on it (the odd week labelled,
// the change point and the averages either side). The EM acts on the weeks themselves: click one to leave it out, or
// start at the change. Nothing when there's no pattern.
function variantB() {
  const R = reading(), F = forecast(state), D = forecast(NONE)
  const note = isDefault() ? '' : '<p class="faint">You changed the weeks. GitHub’s 8 weeks would say ' + endOf(D.q85) + ' (' + shift(F.q85, D.q85) + '). <button class="linkish" onclick="useDefault()">Back to GitHub’s 8 weeks</button></p>'
  let hint = ''
  if (R.kind !== 'none') {
    const act = R.kind === 'changing' && !R.wait ? ' <button onclick="startAt(' + R.changeAt + ')">' + (state.from === R.changeAt ? 'Don’t start at the change' : 'Start at the change') + '</button>'
      : R.kind === 'odd' ? ' <button onclick="toggleWeek(' + R.weeksHi[0] + ')">' + (state.out.includes(R.weeksHi[0]) ? 'Put it back' : 'Leave it out') + '</button>'
      : R.kind === 'quietEnd' ? ' <button onclick="' + (isAlt(R) ? 'useDefault()' : 'useAlt()') + '">' + (isAlt(R) ? 'Count them as 0' : 'Skip them') + '</button>' : ''
    hint = '<p class="hint"><b>' + R.name + '.</b> ' + R.detail + ' ' + (R.ask || '') + (R.team ? ' ' + R.team : '') + act + '</p>'
  }
  return '<div class="col" style="gap:18px">' + head(F, note) +
    '<section class="brief"><div class="heading"><h2>Pace, week by week</h2><span class="faint">GitHub · click a week to leave it out or put it back</span></div>' +
    '<div style="padding-top:20px">' + strip(R, true, true) + '</div>' + paceLine() +
    '<div class="legend faint"><span>▮ in use</span><span style="color:var(--hairline)">▮</span><span>older than the 8 weeks</span><span>┆ left out</span></div>' + hint + '</section>' +
    table(F, isDefault() ? null : D) + '</div>'
}

// ---- Variant C: when there's a pattern, a question sits under the headline with the two forecasts as choices; the
// EM picks one, or keeps it as is and the question folds to a line. Why, and what the team could do, are folded below.
function variantC() {
  const R = reading(), F = forecast(state)
  let card = ''
  if (R.kind !== 'none' && state.dismissed === R.kind) card = '<p class="faint">Kept as GitHub reads it, despite ' + R.name.toLowerCase() + '. <button class="linkish" onclick="state.dismissed=null;render()">Look again</button></p>'
  else if (R.kind !== 'none') {
    const q = R.kind === 'changing' ? 'Has the team’s pace changed?' : R.kind === 'odd' ? 'Should ' + wc(weeks[R.weeksHi[0]].start) + ' count?' : R.kind === 'quietEnd' ? 'Were the last ' + plural(R.weeksHi.length, 'week') + ' off?' : 'The weeks are lumpy'
    const ch = (st, t, sub, on, click) => { const f = forecast(st); return '<button class="choice' + (on ? ' on' : '') + '" onclick="' + click + '"><span class="t">' + t + '</span><span class="dt">' + endOf(f.q85) + '</span><span class="s">' + sub + '</span></button>' }
    const choices = R.alt ? '<div class="choices">' + ch(NONE, R.keepName, '85% date · ' + plural(defaultWeeks().length, 'week') + ' as GitHub reads them', isDefault(), 'useDefault(\'keep: ' + R.kind + '\')') +
      ch(R.alt, R.altName, '85% date · ' + plural(inUse(R.alt).length, 'week') + (R.kind === 'quietEnd' ? ', reaching back' : ''), isAlt(R), 'useAlt()') + '</div>' : ''
    card = '<div class="card"><p class="q">' + q + '</p><p class="ev">' + R.detail + '</p>' + (R.wait ? '<p class="ev">' + R.ask + '</p>' : '') + choices +
      '<details class="more"><summary>How the tool reads this</summary><p>From GitHub’s 8 most recent whole weeks. ' + ({ changing: 'Later weeks run consistently higher or lower than earlier ones, more than chance would give. From 8 weeks this is a hint, not a finding.', odd: 'One week is far above the rest, which are steady.', quietEnd: 'The last weeks finished nothing, after weeks that did.', lumpy: 'The weeks vary far more than steady work would.' })[R.kind] + '</p>' +
      (R.team ? '<p>' + R.team + '</p>' : '') + '</details>' +
      (R.alt && isDefault() ? '<div class="row"><button class="linkish" onclick="dismiss()">Not now</button></div>' : '') + '</div>'
  }
  return '<div class="col" style="gap:22px">' + head(F) + '<div class="fc"><div class="col" style="gap:18px">' + card + table(F) + '</div>' +
    '<aside class="side"><h3>Pace</h3><div class="pace"><div class="phead"><span>Finished each week · GitHub</span><a href="#" onclick="return false">Change</a></div>' + strip(R, false, false) + paceLine() + '</div></aside></div></div>'
}

// ---- switcher and render ----
function go(v, s) {
  variant = v; if (s && s !== scenario) { scenario = s; load() }
  const p = new URLSearchParams(location.search); p.set('variant', variant); p.set('scenario', scenario)
  history.replaceState(null, '', '?' + p); render()
}
function cycle(d) { const ks = Object.keys(VARIANTS); go(ks[(ks.indexOf(variant) + d + ks.length) % ks.length]) }
function render() {
  const R = reading()
  document.getElementById('proto').innerHTML = ({ A: variantA, B: variantB, C: variantC })[variant]()
  document.getElementById('state').textContent = JSON.stringify({ variant, scenario,
    pace: { source: 'GitHub', weeks: weeks.map((w) => w.start + ' ' + w.n), leftOut: state.out.map((i) => weeks[i].start), startAt: state.from === null ? null : weeks[state.from].start, dismissedReading: state.dismissed },
    reading: { kind: R.kind, name: R.name, short: R.short, proposes: R.altName || null },
    forecast85: { asSet: endOf(forecast(state).q85), githubAsRead: endOf(forecast(NONE).q85) }, actions: log }, null, 1)
  document.getElementById('switcher').innerHTML = '<button onclick="cycle(-1)">←</button><b>' + variant + ' (' + VARIANTS[variant] + ')</b><button onclick="cycle(1)">→</button>' +
    '<select onchange="go(variant,this.value)">' + Object.entries(SCENARIOS).map(([k, s]) => '<option value="' + k + '"' + (k === scenario ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select>' +
    '<button onclick="load();render()">Reset</button>'
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === 'ArrowLeft') cycle(-1); if (e.key === 'ArrowRight') cycle(1)
})
load()
go(variant)
`

const header = {
  context: 'Checkout v2',
  heading: 'Milestone forecast',
  lede: 'Prototype for “How a pace-pattern suggestion and its actions appear”. Flip variants with ← → and pick a scenario in the bar below.',
}
mkdirSync(new URL('.', out), { recursive: true })
writeFileSync(out, htmlPage('/', header, MAIN, SCRIPT))
const file = fileURLToPath(out)
console.log(`Prototype written to ${file}`)
if (!process.env.NO_OPEN) spawn('open', [file], { stdio: 'ignore', detached: true }).unref()
