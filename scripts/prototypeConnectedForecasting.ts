// PROTOTYPE, throwaway: never merge. Map "Connected forecasting"
// (https://github.com/random11235/forecaster-next-gen/issues/124): the whole app with every decision on the map combined.
//
// The layouts are decided, so the bar switches screens and scenarios, not layout variants. Combined here:
// - #136 B setup steps on Inputs (Connect → Milestone → Comparable work → Check), then a summary with Change; the
//   find-and-add picker, with #148 (epics include their sub-epics, each kind listed once and filtered as you type).
// - #129 D quiet sources: tickets GitHub | Typed, pace GitHub | Typed counts | Range; following updates on each read,
//   typing switches to Typed; "reads differently" chip; skipped weeks, the window reaching back to keep up to 8.
// - #139 C capacity under Pace beside the forecast, switchable, each entry's own effect, the quiet headline, the
//   with/at-usual table and one week-by-week chart; #131 rules (weekdays, linear, past counts NOT adjusted, new usual).
// - #138 A the pace pattern as one folded line under the Pace bars, with #150 naming and wording.
// URL params: `?screen=forecast|inputs|how`, `?tracker=`, `?history=`, `?capacity=` (see the bar).
// Synthetic tracker data and a stand-in simulation (not the engine). All state is in memory; reload to reset.
// Run: `npm run prototype:connected-forecasting`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { htmlPage }: typeof import('../src/app/html.js') = await import(new URL('../dist/app/html.js', import.meta.url).href)

const out = new URL('../dist/prototype/connected-forecasting.html', import.meta.url)

const STYLE = `
  <style>
    .proto-banner { font-size: 12px; color: var(--risk); font-family: var(--mono); margin: 0 0 14px; }
    .linkish { border: 0; background: none; padding: 0; min-height: 0; color: var(--link); text-decoration: underline; cursor: pointer; font-size: 13px; }
    .dmark, .faint { font-size: 12px; color: var(--faint); }
    .muted { color: var(--muted); font-size: 13px; }
    .row { display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: center; }
    .col { display: flex; flex-direction: column; gap: 10px; }
    .good { color: var(--good); } .later { color: var(--risk); } .sooner { color: var(--good); }
    /* forecast */
    .bighead { font-size: clamp(20px, 2.5vw, 30px); font-weight: 600; letter-spacing: -.01em; line-height: 1.2; margin: 0; }
    .bighead .good { white-space: nowrap; }
    .fc { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 28px; }
    @media (max-width: 900px) { .fc { grid-template-columns: 1fr; } }
    table.pc { border-collapse: collapse; font-size: 14px; }
    table.pc th { text-align: left; font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; padding: 0 20px 6px 0; font-weight: 600; }
    table.pc td { padding: 6px 20px 6px 0; border-top: 1px solid var(--hairline); font-variant-numeric: tabular-nums; }
    .side { border-left: 1px solid var(--hairline); padding-left: 20px; display: flex; flex-direction: column; gap: 12px; }
    .side h3 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .pacebox { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--hairline); border-radius: 6px; padding: 10px 12px; background: #fff; }
    .phead { display: flex; gap: 10px; justify-content: space-between; font-size: 12px; color: var(--muted); }
    details.read { font-size: 13px; border-top: 1px solid var(--hairline); padding-top: 8px; }
    details.read summary { cursor: pointer; list-style: none; }
    details.read summary::-webkit-details-marker { display: none; }
    details.read summary::before { content: '▸ '; color: var(--muted); font-size: 11px; }
    details.read[open] summary::before { content: '▾ '; }
    details.read p { margin: 6px 0; line-height: 1.45; color: var(--text-2); }
    .both { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; font-size: 13px; margin: 6px 0; }
    .applied { font-size: 13px; background: #EEF4F2; border-left: 3px solid var(--good); padding: 6px 10px; border-radius: 4px; display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: baseline; }
    p.warning { margin: 0; font-size: 14px; line-height: 1.5; color: var(--risk); }
    .nofc { border: 1px solid var(--hairline); border-radius: 8px; padding: 14px 16px; background: #fff; display: flex; flex-direction: column; gap: 10px; }
    /* week-by-week chart */
    .cg { display: flex; flex-direction: column; }
    .cgf, .cgd { display: flex; gap: 2px; }
    .cgf { position: relative; height: 150px; border-bottom: 1px solid var(--ink); }
    .cc { flex: 1; position: relative; display: flex; flex-direction: column; justify-content: flex-end; min-width: 0; }
    .cc .fin { background: var(--bar); border-radius: 2px 2px 0 0; }
    .cc.adj { background: repeating-linear-gradient(135deg, transparent 0 4px, rgba(181,72,42,.14) 4px 7px); }
    .cpct { position: absolute; top: 2px; left: 0; right: 0; text-align: center; font-size: 10px; font-family: var(--mono); font-weight: 600; color: var(--risk); }
    .cgd { margin-top: 3px; } .cgd span { flex: 1; font-size: 10px; color: var(--faint); white-space: nowrap; min-width: 0; }
    .mrow { position: relative; height: 24px; }
    .mtag { position: absolute; white-space: nowrap; font-size: 12px; font-family: var(--mono); padding: 1px 6px; border-radius: 3px; bottom: 2px; background: var(--ink); color: var(--page); }
    .mline { position: absolute; top: -2px; bottom: 0; width: 0; border-left: 2px solid var(--ink); pointer-events: none; }
    .key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 3px; }
    /* capacity */
    details.cap > summary { cursor: pointer; font-size: 13px; }
    details.cap .ctitle { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .sentence { font-size: 14px; line-height: 2.2; }
    .sentence input { padding: 2px 6px !important; font-size: 13px !important; min-height: 0 !important; }
    .sentence input[type=number] { width: 64px; } .sentence input[type=text] { width: 140px; }
    .sline { font-size: 14px; display: flex; gap: 8px; align-items: baseline; justify-content: space-between; border-bottom: 1px solid var(--hairline); padding: 4px 0; }
    .eff { font-size: 12px; white-space: nowrap; }
    .tag { font-size: 11px; border: 1px solid var(--hairline); border-radius: 3px; padding: 0 4px; color: var(--muted); }
    .pop { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; background: var(--page); }
    details.past summary { cursor: pointer; font-size: 13px; color: var(--muted); }
    .flag { font-size: 13px; padding: 6px 10px; border-radius: 4px; max-width: 640px; line-height: 1.45; margin: 0; }
    .flag.bad { background: #FBF1EC; color: var(--risk); border-left: 3px solid var(--risk); }
    .flag.warn { background: #FBF6E8; color: #7A4A12; border-left: 3px solid #C9A66B; }
    .flag.ok { color: var(--good); padding-left: 0; }
    .flag.prop { background: #EEF4F2; color: var(--ink); border-left: 3px solid var(--good); display: flex; gap: 10px 14px; flex-wrap: wrap; align-items: center; }
    /* sources (#129 D) */
    .dseg { display: inline-flex; border: 1px solid var(--hairline); border-radius: 6px; overflow: hidden; align-self: flex-start; }
    .dseg button { border: 0; border-radius: 0; background: transparent; min-height: 28px; padding: 0 12px; font-size: 13px; color: var(--muted); }
    .dseg button + button { border-left: 1px solid var(--hairline); }
    .dseg button.on { background: var(--ink); color: var(--page); }
    .dgraph { display: inline-flex; gap: 4px; align-items: flex-end; vertical-align: middle; }
    .dgraph .c { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 26px; }
    .dgraph .bar { width: 16px; background: var(--bar); border-radius: 2px 2px 0 0; }
    .dgraph .bar.cmp { background: var(--bar-light); }
    .dgraph .bar.zero { background: var(--risk); height: 2px; }
    .dgraph .v { font-size: 10px; color: var(--faint); line-height: 12px; font-family: var(--mono); }
    .dgraph .c.skipped .bar { background: transparent; border: 1px dashed var(--muted); border-bottom: 0; }
    .dgraph .c.skipped .v { text-decoration: line-through; }
    .dgraph .d { font-size: 9px; color: var(--faint); white-space: nowrap; height: 11px; }
    .was { font-size: 12px; color: var(--faint); }
    details.dchip { position: relative; display: inline-block; }
    details.dchip > summary { list-style: none; cursor: pointer; font-size: 12px; border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; color: var(--muted); background: #fff; }
    details.dchip > summary::-webkit-details-marker { display: none; }
    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--link); margin-right: 4px; vertical-align: 1px; }
    .dpanel { position: absolute; z-index: 5; top: calc(100% + 6px); left: 0; width: 300px; background: #fff; border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12); padding: 10px 12px; font-size: 13px; display: flex; flex-direction: column; gap: 8px; }
    .cells { display: flex; gap: 6px; flex-wrap: wrap; }
    .cell { display: flex; flex-direction: column; gap: 2px; align-items: center; border: 1px solid var(--hairline); border-radius: 6px; padding: 6px; width: 74px; font-size: 11px; color: var(--faint); background: #fff; }
    .cell input { width: 56px; text-align: center; padding: 3px !important; min-height: 0 !important; font-variant-numeric: tabular-nums; }
    .cell.quiet input { color: var(--risk); }
    .cell.skipped { background: var(--sidebar); }
    .cell.skipped input { text-decoration: line-through; color: var(--faint); }
    .cell button { font-size: 11px; }
    .numrow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .numrow input[type=number] { width: 90px; font-size: 20px; padding: 4px 8px; font-variant-numeric: tabular-nums; }
    /* tracker setup (#136 B) */
    .qbox { display: flex; align-items: stretch; border: 1px solid var(--border); border-radius: 6px; background: #fff; overflow: hidden; width: 100%; max-width: 640px; }
    .qbox:focus-within { border-color: var(--ink); }
    .qbox .scope { font-family: var(--mono); font-size: 12px; color: var(--faint); background: var(--sidebar); padding: 0 8px; display: flex; align-items: center; white-space: nowrap; border-right: 1px solid var(--hairline); }
    .qbox input { border: 0 !important; flex: 1; font-family: var(--mono); font-size: 13px; min-width: 0; padding: 8px; background: transparent; }
    .qline { font-family: var(--mono); font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
    .chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--border); border-radius: 999px; padding: 2px 4px 2px 10px; font-size: 13px; background: #fff; }
    .chip .x { border: 0; background: none; min-height: 0; padding: 0 6px; font-size: 15px; line-height: 1; color: var(--muted); cursor: pointer; }
    input.find { font-size: 14px; padding: 7px 10px; }
    .found { display: flex; flex-direction: column; max-height: 220px; overflow: auto; border: 1px solid var(--hairline); border-radius: 6px; padding: 4px; }
    .found button { text-align: left; border: 0; background: none; min-height: 28px; font-size: 13px; padding: 0 8px; border-radius: 4px; }
    .found button:hover { background: var(--active); }
    .found .hd { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; padding: 6px 8px 2px; }
    .wizard { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 28px; border: 1px solid var(--border); border-radius: 10px; padding: 22px; background: #fff; margin-bottom: 18px; }
    @media (max-width: 760px) { .wizard { grid-template-columns: 1fr; } }
    .wizard ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .wizard li { font-size: 14px; padding: 6px 10px; border-radius: 6px; color: var(--faint); }
    .wizard li.done { color: var(--muted); cursor: pointer; } .wizard li.done::before { content: '✓ '; color: var(--good); }
    .wizard li.on { background: var(--active); color: var(--ink); font-weight: 600; }
    .wizard h2 { margin: 0; font-size: 20px; }
    .actions { display: flex; gap: 10px; align-items: center; margin-top: 6px; }
    .actions .linkish { margin-right: auto; }
    .qmode { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
    .qmode .qline { flex: 1; min-width: 0; }
    .sumgrid { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 8px 16px; align-items: baseline; border: 1px solid var(--hairline); border-radius: 8px; padding: 12px 16px; font-size: 14px; background: #fff; margin-bottom: 8px; }
    .sumgrid .hdr { grid-column: 1 / -1; display: flex; gap: 10px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--hairline); }
    .sumgrid .hdr .end { margin-left: auto; display: flex; gap: 12px; align-items: center; }
    .sumgrid .foot { grid-column: 1 / -1; }
    .summary { display: flex; gap: 10px 16px; flex-wrap: wrap; align-items: center; border: 1px solid var(--hairline); border-radius: 8px; padding: 10px 14px; font-size: 14px; margin-bottom: 18px; }
    .ok-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); display: inline-block; }
    table.check { border-collapse: collapse; font-size: 14px; }
    table.check th { text-align: left; font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; padding: 0 18px 6px 0; border-bottom: 1px solid var(--ink); }
    table.check td { padding: 10px 18px 10px 0; border-bottom: 1px solid var(--hairline); vertical-align: middle; }
    .flags { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
    /* bar and state */
    .switcher { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 10; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; max-width: calc(100vw - 32px);
      background: #111; color: #fff; padding: 8px 12px; border-radius: 22px; box-shadow: 0 6px 20px rgba(0,0,0,.3); font-size: 13px; }
    .switcher button { color: #fff; border-color: #444; min-height: 28px; background: transparent; }
    .switcher select { font: inherit; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; padding: 3px 6px; max-width: 220px; }
    details.state { font-size: 12px; margin: 30px 0 110px; }
    details.state pre { background: var(--sidebar); padding: 12px; border-radius: 6px; overflow: auto; font-family: var(--mono); font-size: 11px; }
  </style>`

const MAIN = `${STYLE}
    <p class="proto-banner">PROTOTYPE · the whole app with every decision on #124 combined · synthetic tracker data · stand-in simulation · nothing saved</p>
    <div id="proto"></div>
    <details class="state"><summary>State</summary><pre id="state"></pre></details>
    <div class="switcher" id="switcher"></div>`

const SCRIPT = String.raw`
// ---------- dates ----------
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const toD = (iso) => new Date(iso + 'T00:00:00Z')
const add = (iso, n) => { const d = toD(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dm = (iso) => { const d = toD(iso); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] }
const wc = (iso) => 'w/c ' + dm(iso)
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's')
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const sum = (a) => a.reduce((x, y) => x + y, 0)
const avg = (a) => sum(a) / Math.max(1, a.length)
const sdv = (a) => { const m = avg(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)) }

const TODAY = '2026-11-04', START = '2026-11-02'
const WEEKS = Array.from({ length: 14 }, (_, j) => add('2026-07-27', 7 * j)) // whole weeks the tracker is read over, w/c 27 Jul .. 26 Oct
const READS = ['28 Oct 09:05', '4 Nov 09:12', '5 Nov 09:03']
const OPEN_DELTA = [-4, 0, -3] // Checkout v2's open tickets at each read, against the 4 Nov read
const AMB = { low: [1, 1.5], medium: [1, 2], high: [1.5, 3] }

// ---------- team history: the milestone's finished tickets each week (the bar's History) ----------
const HISTORY = {
  steady: { name: 'Steady', wk: [6,5,4,6,5,7,5,4,6,5,7,5,6,5] },
  steppedUp: { name: 'Stepped up on 5 Oct', wk: [4,3,5,4,4,3,4,5,3,4,8,9,7,8] },
  steppedDown: { name: 'Stepped down on 5 Oct', wk: [8,9,7,8,9,8,9,7,8,9,4,3,4,4] },
  speeding: { name: 'Speeding up', wk: [2,2,1,3,2,2,2,3,3,4,5,5,6,7] },
  slowing: { name: 'Slowing down', wk: [8,9,8,7,8,8,8,7,7,6,5,5,4,3] },
  lumpy: { name: 'Lumpy', wk: [3,0,8,1,0,9,0,9,1,0,8,2,0,10] },
  spells: { name: 'Good and bad spells', wk: [5,5,4,5,6,5,3,2,3,8,9,8,2,3] },
  odd: { name: 'One odd week (5 Oct)', wk: [5,6,5,4,6,5,5,4,6,5,23,5,6,4] },
  holidays: { name: 'Three quiet weeks (holidays)', wk: [5,6,5,6,5,6,5,0,6,0,7,6,0,6] },
  short: { name: 'Repo only 7 weeks old', wk: [5,4,6,5,6,4,5,5,4,6,5,6,4,5], first: 7 },
  fresh: { name: 'First finished ticket on 5 Oct', wk: [0,0,0,0,0,0,0,0,0,0,3,5,4,6] },
  nothing: { name: 'Nothing finished in 8 weeks', wk: [3,2,1,0,0,0,0,0,0,0,0,0,0,0] },
}

// ---------- the canned tracker (#136, #148): groups of leaf tickets ----------
const REPO = 'shop-team/shop', SITE = 'shop.atlassian.net', PROJECT = 'SHOP'
const GROUPS = [
  { ms: 'Checkout v2', epic: 41, labels: ['checkout'], open: 31, wk: 'H' },
  { ms: 'Checkout v2', epic: 44, labels: ['checkout', 'bug'], open: 7, wk: Array(14).fill(0) }, // under sub-epic #44, itself under #41
  { ms: 'Search revamp', epic: 57, labels: ['search'], open: 12, wk: [1,2,2,1,2,3,2,3,1,2,3,2,1,0] },
  { ms: 'Q3 polish', labels: ['checkout'], open: 0, wk: [3,4,4,3,4,3,4,3,4,3,2,0,0,0] },
  { ms: null, labels: ['ktlo'], open: 22, wk: [2,1,2,1,1,2,1,2,1,3,4,3,2,1] },
  { ms: null, labels: ['bug'], open: 1180, wk: [6,5,7,6,5,6,5,6,7,6,5,6,4,5] },
]
const EPICS = { 41: 'Checkout v2', 44: 'Checkout v2 · payment step', 57: 'Search revamp', 63: 'Payments v1' }
const EPIC_PARENT = { 44: 41 }
;['Checkout analytics', 'Guest checkout', 'Saved cards', 'Search filters', 'Search ranking', 'Payments retries', 'Refunds', 'Gift cards',
  'Wishlist', 'Order history', 'Returns portal', 'Delivery slots', 'Promo codes', 'Loyalty points', 'Accessibility audit', 'Basket redesign'].forEach((t, i) => { EPICS[100 + i * 7] = t })
const MILESTONES = ['Checkout v2', 'Search revamp', 'Q3 polish', 'Payments v1']
const LABELS = ['checkout', 'search', 'ktlo', 'bug', 'payments']
const CHOICES = MILESTONES.map((n) => 'm:' + n).concat(Object.keys(EPICS).map((n) => 'e:' + n), LABELS.map((l) => 'l:' + l))

// ---------- capacity (#131, #139) ----------
const CAPACITY = {
  none: { name: 'No capacity typed', entries: [] },
  holidays: { name: 'Leave and holidays ahead', entries: [
    { from: '2026-10-12', to: '2026-10-16', pct: 50, note: 'Incident' },
    { from: '2026-11-16', to: '2026-11-20', pct: 60, note: 'Two away at a conference' },
    { from: '2026-12-21', to: '2027-01-01', pct: 20, note: 'Holidays' } ] },
  shrinking: { name: 'Team shrank on 5 Oct (lasting)', entries: [{ from: '2026-10-05', to: null, pct: 80, note: 'One of five moved to Payments' }] },
  caughtUp: { name: 'Team shrank in August (all weeks after)', entries: [
    { from: '2026-08-24', to: null, pct: 80, note: 'One of five moved to Payments' },
    { from: '2026-12-21', to: '2027-01-01', pct: 20, note: 'Holidays' } ] },
  grew: { name: 'Team tripling from 16 Nov', entries: [{ from: '2026-11-16', to: null, pct: 300, note: 'Merged with the Payments team' }] },
}

const TRACKERS = {
  github: 'GitHub, set up (milestone)',
  epics: 'GitHub, epic + comparable work',
  rejected: 'GitHub, edited query rejected',
  jira: 'Jira, set up (fix version)',
  fresh: 'GitHub, not set up yet',
  none: 'No tracker (typed inputs)',
}
const SCREENS = { forecast: 'Milestone forecast', inputs: 'Inputs', how: 'How it works' }

const params = new URLSearchParams(location.search)
const pick = (o, k, d) => o[params.get(k)] ? params.get(k) : d
let screen = pick(SCREENS, 'screen', 'forecast'), tracker = pick(TRACKERS, 'tracker', 'github')
let history = pick(HISTORY, 'history', 'steady'), capacity = pick(CAPACITY, 'capacity', 'holidays')
let H, FIRST, state, ui
const log = []

// ---------- tracker reads ----------
const wkOf = (g, j) => j < FIRST ? null : g.wk === 'H' ? H.wk[j] : g.wk[j]
function choiceQuery(tr, id) {
  const v = id.slice(2), j = tr === 'jira'
  if (id[0] === 'e') return j ? 'parent = ' + PROJECT + '-' + v : 'parent-issue:' + REPO + '#' + v
  if (id[0] === 'l') return j ? 'labels = ' + v : 'label:' + v
  return j ? 'fixVersion = "' + v + '"' : 'milestone:"' + v + '"'
}
const unq = (s) => s.replace(/^"|"$/g, '')
const under = (g, n) => g.epic === n || EPIC_PARENT[g.epic] === n // an epic stands for every leaf ticket beneath it, at any depth
function parse(tr, q) {
  q = q.trim()
  if (!q) return { clauses: [[]] }
  if ((q.match(/"/g) || []).length % 2) return tr === 'jira' ? { fail: 'invalid', msg: 'Error in the JQL Query: The quoted string has not been completed.' } : { fail: 'invalid', msg: 'The search query has an unmatched quote.' }
  const clauses = []
  for (const clause of q.split(/\s+OR\s+/i)) {
    const preds = []
    const toks = tr === 'jira' ? clause.split(/\s+AND\s+/i) : (clause.match(/(?:[^\s"]+|"[^"]*")+/g) || [])
    for (const tok of toks) {
      if (tr === 'jira') {
        const m = /^\(?\s*(\w+)\s*(!=|=)\s*(.+?)\s*\)?$/i.exec(tok.trim())
        if (!m) return { fail: 'invalid', msg: 'Error in the JQL Query: Expecting operator but got \'' + (tok.trim().split(/\s+/)[1] || '') + '\'.' }
        const [, f, op, raw] = m, v = unq(raw), not = op === '!=', fl = f.toLowerCase()
        if (fl === 'project') { if (v.toUpperCase() !== PROJECT) return { fail: 'outOfScope', msg: 'project = ' + v }; continue }
        if (fl === 'parent') { const [pk, num] = v.split('-'); if (pk.toUpperCase() !== PROJECT) return { fail: 'outOfScope', msg: 'parent = ' + v }; preds.push((g) => under(g, Number(num)) !== not); continue }
        if (fl === 'fixversion') { preds.push((g) => (g.ms === v) !== not); continue }
        if (fl === 'labels') { preds.push((g) => g.labels.includes(v) !== not); continue }
        return { fail: 'invalid', msg: 'Field \'' + f + '\' does not exist or you do not have permission to view it.' }
      }
      const m = /^(-?)([a-z-]+):(.*)$/.exec(tok)
      if (!m) return { fail: 'invalid', msg: tok + ' is free text, which searches titles. This tool reads only qualifiers, such as label:, milestone: or parent-issue:.', ours: true }
      const [, neg, k, raw] = m, v = unq(raw), not = neg === '-'
      if (!v) return { fail: 'invalid', msg: 'The ' + k + ': qualifier needs a value.', ours: true }
      if (['repo', 'org', 'user'].includes(k)) { if (k === 'repo' && v === REPO) continue; return { fail: 'outOfScope', msg: k + ':' + v } }
      if (k === 'milestone') { preds.push((g) => (g.ms === v) !== not); continue }
      if (k === 'parent-issue') { const [rp, num] = v.split('#'); if (rp !== REPO) return { fail: 'outOfScope', msg: k + ':' + v }; preds.push((g) => under(g, Number(num)) !== not); continue }
      if (k === 'label') { preds.push((g) => g.labels.includes(v) !== not); continue }
      if (k === 'is' || k === 'type') continue
      return { fail: 'invalid', msg: 'The search query contains an unknown qualifier: ' + k + ':' }
    }
    clauses.push(preds)
  }
  return { clauses }
}
// read(query, finishedSince): the open leaf tickets now, and those finished in each whole week (null before the repo's history)
function read(tr, q) {
  const p = parse(tr, q)
  if (p.fail) return { ok: false, ...p }
  return measure(GROUPS.map((g, i) => p.clauses.some((preds) => preds.every((f) => f(g))) ? i : -1).filter((i) => i >= 0))
}
function measure(set) {
  const open = sum(set.map((i) => Math.max(0, GROUPS[i].open + (i === 0 ? OPEN_DELTA[state.readNo] : 0))))
  const wk = WEEKS.map((_, j) => j < FIRST ? null : sum(set.map((i) => wkOf(GROUPS[i], j))))
  const finished = sum(wk.slice(-8).map((n) => n || 0)), total = open + sum(wk.map((n) => n || 0))
  return { ok: true, set, open, wk, finished, total, incomplete: total > 1000 }
}
function doRead(which) {
  const q = state[which]
  if (which === 'cq' && !q.trim()) { delete state.reads.cq; return }
  const r = read(state.conn.tracker, q)
  state.reads[which] = r
  if (r.ok) state.lastGood[which] = { q, r }
}
function inUse(which) { const r = state.reads[which]; return r && r.ok ? r : state.lastGood[which] ? state.lastGood[which].r : null }
// what the forecast gets: tickets remaining from the milestone query; pace from both queries' finished tickets, stacked
function combined() {
  if (!state.conn) return null
  const m = inUse('mq'); if (!m) return null
  const c = state.cq.trim() ? inUse('cq') : null
  const set = [...new Set(m.set.concat(c ? c.set : []))], all = measure(set)
  return { ...all, open: m.open, own: m.wk, ownFinished: m.finished, incomplete: m.incomplete || !!(c && c.incomplete) }
}
const tr = () => state.conn ? state.conn.tracker : state.draft.tracker
const T = () => tr() === 'jira' ? 'Jira' : 'GitHub'
const where = () => state.conn.tracker === 'jira' ? state.conn.site + ' · ' + state.conn.project : state.conn.repo
const scopeText = () => state.conn.tracker === 'jira' ? 'project = ' + PROJECT + ' AND' : 'repo:' + REPO
const readAt = () => READS[state.readNo]

// ---------- load a scenario ----------
function load() {
  H = HISTORY[history]; FIRST = H.first || 0
  const old = [5, 7, 4, 6, 8, 5, 6, 7]
  const typedWeeks = WEEKS.slice(-8)
  state = {
    name: 'Checkout v2', start: START, cadence: 7, amb: 'medium',
    conn: null, draft: { tracker: 'github', where: '', token: '' }, connError: null, mq: '', cq: '', reads: {}, lastGood: {},
    step: 1, setupDone: false, skippedSetup: false, readNo: 1,
    tickets: { src: 'typed', typed: 30, seen: 1 },
    pace: { src: 'range', range: [4, 8], typed: typedWeeks.map((wk, i) => ({ wk, n: old[i] })), skipped: [], from: null, applied: null, seen: 1 },
    cap: { on: true, entries: CAPACITY[capacity].entries.map((e, i) => ({ id: i + 1, ...e })) },
  }
  ui = { capOpen: false }
  const gh = { tracker: 'github', repo: REPO }
  const setUp = (conn, mq, cq) => { state.conn = conn; state.mq = mq; state.cq = cq || ''; doRead('mq'); if (state.cq) doRead('cq'); state.step = 4; state.setupDone = true; state.tickets.src = 'github'; state.pace.src = 'github' }
  if (tracker === 'github') setUp(gh, choiceQuery('github', 'm:Checkout v2'))
  if (tracker === 'epics') setUp(gh, choiceQuery('github', 'e:41'), choiceQuery('github', 'm:Q3 polish'))
  if (tracker === 'jira') setUp({ tracker: 'jira', site: SITE, project: PROJECT }, choiceQuery('jira', 'm:Checkout v2'))
  if (tracker === 'rejected') { setUp(gh, choiceQuery('github', 'm:Checkout v2')); state.mq = 'milestone:"Checkout v2'; doRead('mq') }
  if (tracker === 'none') {
    state.skippedSetup = true; state.pace.src = 'typed'
    state.pace.typed = WEEKS.map((wk, j) => ({ wk, n: H.wk[j] })).filter((_, j) => j >= FIRST).slice(-8)
  }
  log.length = 0; nextId = 100
}
let nextId = 100
function act(name, fn) { fn(); log.push(name); render() }

// ---------- pace: the counts the bars show, and the window ----------
const ghOk = () => !!combined()
function cells() {
  if (state.pace.src === 'github' && ghOk()) {
    const c = combined()
    return WEEKS.map((wk, j) => ({ wk, n: c.wk[j], own: c.own[j] })).filter((x) => x.n !== null)
  }
  return state.pace.typed.map((x) => ({ wk: x.wk, n: x.n, own: x.n }))
}
// Leading quiet weeks before the first finished ticket are left out (tracker counts only); skipped weeks are left out
// and the window reaches back to keep up to 8; a start date set from a pattern trims the start.
function windowOf() {
  const all = cells(), gh = state.pace.src === 'github' && ghOk()
  const firstFin = all.findIndex((x) => x.n > 0)
  const lead = gh && firstFin > 0 ? all[firstFin].wk : null
  const avail = lead ? all.slice(firstFin) : all
  const usable = avail.filter((x) => !state.pace.skipped.includes(x.wk) && (!state.pace.from || x.wk >= state.pace.from))
  const win = usable.slice(-8)
  const reach = win.length ? avail.filter((x) => x.wk >= win[0].wk) : avail.filter((x) => !state.pace.from || x.wk >= state.pace.from)
  return { win, reach, lead, gh, skippedIn: reach.filter((x) => state.pace.skipped.includes(x.wk)).length, short: gh && FIRST > 0 && !lead && usable.length < 8 }
}
const nums = (W) => W.win.map((x) => x.n)

// ---------- pace pattern (#138 A, #150) ----------
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
function changePoint(ns) {
  let best = null
  for (let k = 2; k <= ns.length - 2; k++) {
    const a = ns.slice(0, k), b = ns.slice(k), se = Math.sqrt((sdv(a) ** 2 + 0.5) / a.length + (sdv(b) ** 2 + 0.5) / b.length), t = Math.abs(avg(b) - avg(a)) / se
    if (!best || t > best.t) best = { k, t, before: avg(a), after: avg(b) }
  }
  return best
}
const lo = (a) => Math.min(...a), hi = (a) => Math.max(...a)
function reading(W) {
  if (state.pace.src === 'range') return null
  if (state.cadence < 7) return { kind: 'quiet', line: 'Patterns are read from weeks or sprints.' }
  const ns = nums(W), cells = W.win
  if (!ns.length) return null
  if (ns.every((n) => n === 0)) return { kind: 'quiet', line: 'Nothing finished in these ' + plural(ns.length, 'week') + ': no pattern to read.' }
  if (ns.length < 6) return { kind: 'quiet', line: 'No pattern yet · ' + plural(ns.length, 'week') + ' is too few to tell' }
  const med = [...ns].sort((a, b) => a - b)[ns.length >> 1], iMax = ns.indexOf(hi(ns)), rest = ns.filter((_, i) => i !== iMax)
  if ((ns[iMax] - med) / Math.max(1, Math.sqrt(med)) > 4 && sdv(rest) ** 2 / Math.max(1e-9, avg(rest)) < 2) {
    const c = cells[iMax]
    return { kind: 'odd', name: 'One odd week', short: wc(c.wk) + ' finished ' + c.n,
      detail: wc(c.wk) + ' finished ' + c.n + ', against ' + lo(rest) + ' to ' + hi(rest) + ' in the other weeks.',
      ask: 'If that week wasn’t like the others, leave it out of the pace.', act: { skip: c.wk }, label: 'Leave out ' + wc(c.wk) }
  }
  const cp = changePoint(ns)
  if (cp && cp.t > 3.5 && Math.abs(cp.after - cp.before) >= Math.max(2, cp.before * .4) && cp.k >= 2 && ns.length - cp.k >= 2) {
    const at = cells[cp.k].wk, up = cp.after > cp.before, word = up ? 'Stepped up' : 'Stepped down'
    return { kind: up ? 'steppedUp' : 'steppedDown', name: 'May have ' + word.toLowerCase(), early: true, short: 'too early to be sure',
      detail: word + ': about ' + Math.round(cp.before) + ' a week, then ' + Math.round(cp.after) + ' since ' + dm(at) + '.',
      ask: 'If that’s lasting, count pace from ' + dm(at) + '.', act: { from: at, word: word.toLowerCase() }, label: 'Start from ' + dm(at) }
  }
  if (mkP(ns) < 0.05) {
    const up = ns[ns.length - 1] > ns[0], h = ns.length >> 1
    return { kind: up ? 'speeding' : 'slowing', name: up ? 'May be speeding up' : 'May be slowing down', short: 'too early to be sure',
      detail: 'From about ' + Math.round(avg(ns.slice(0, h))) + ' a week in the first ' + plural(h, 'week') + ' to about ' + Math.round(avg(ns.slice(h))) + ' in the last ' + (ns.length - h) + '.',
      ask: 'The forecast draws from all ' + plural(ns.length, 'week') + ', so if the trend goes on, the dates will move ' + (up ? 'sooner' : 'later') + ' as new weeks are read.' }
  }
  if (lag1(ns) > 0.3) return { kind: 'spells', name: 'May have good and bad spells', short: 'too early to be sure',
    detail: 'Busy weeks come together and so do quiet ones: ' + lo(ns) + ' to ' + hi(ns) + ' a week, in runs.',
    ask: 'The range covers both kinds of spell. It narrows as more weeks are read.' }
  if (sdv(ns) ** 2 / Math.max(1e-9, avg(ns)) > 2) return { kind: 'lumpy', name: 'May be lumpy', short: 'too early to be sure',
    detail: 'Work finishes in batches, ' + lo(ns) + ' to ' + hi(ns) + ' a week, so the range is wide because the pace really varies.',
    ask: 'To narrow it, split work smaller, finish before starting, and close tickets as soon as they’re done.' }
  return { kind: 'steady', name: 'Steady', short: lo(ns) + ' to ' + hi(ns) + ' a week', detail: 'No sign the pace is changing. The forecast takes these weeks as they are.' }
}
function applyPattern() {
  const W = windowOf(), R = reading(W)
  act('apply: ' + R.label, () => {
    if (R.act.from) { state.pace.from = R.act.from; state.pace.applied = { kind: 'from', wk: R.act.from, word: R.act.word } }
    else { state.pace.skipped.push(R.act.skip); state.pace.applied = { kind: 'odd', wk: R.act.skip } }
  })
}
function undoPattern() {
  act('undo pattern action', () => {
    const a = state.pace.applied
    if (a.kind === 'from') state.pace.from = null; else state.pace.skipped = state.pace.skipped.filter((w) => w !== a.wk)
    state.pace.applied = null
  })
}

// ---------- capacity ----------
const isPast = (e) => !!e.newUsual || (e.to !== null && e.to < TODAY)
const active = () => state.cap.entries.filter((e) => !isPast(e))
const capOnDay = (iso, list) => list.filter((e) => e.from <= iso && (e.to === null || iso <= e.to)).reduce((p, e) => p * e.pct / 100, 1)
const capOfWeek = (wk, list) => [0, 1, 2, 3, 4].reduce((s, i) => s + capOnDay(add(wk, i), list), 0) / 5 // averaged over working days
const span = (e) => e.to === null ? 'from ' + dm(e.from) + ' onward' : e.from === e.to ? dm(e.from) : dm(e.from) + '–' + dm(e.to)
function checkEntry(from, to, pct, onward) {
  if (!from) return 'Pick the date it starts.'
  if (!onward && to < from) return 'The end date is before the start.'
  if (!Number.isInteger(pct) || pct < 0) return 'Capacity is a whole percentage, 0 or more.'
  if (pct > 1000) return 'Capacity above 1000% can’t be forecast. For a team that much bigger, use a pace range or comparable work from the bigger team.'
  return null
}

// ---------- stand-in simulation: bootstrap, growth from ambiguity, each week's pace scaled by capacity (linear) ----------
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const HORIZON = 104, TRIALS = 2000
const ticketsNow = () => state.tickets.src === 'github' && ghOk() ? combined().open : state.tickets.typed
function simulate(list) {
  const W = windowOf(), ns = nums(W), range = state.pace.src === 'range', g = AMB[state.amb], r = mulberry(124)
  if (!range && (ns.length < 4 || !ns.some((n) => n > 0))) return null
  const caps = Array.from({ length: HORIZON }, (_, k) => capOfWeek(add(START, 7 * k), list)) // past counts are not adjusted
  const fin = new Array(TRIALS), tk = ticketsNow()
  for (let t = 0; t < TRIALS; t++) {
    let left = Math.ceil(tk * (g[0] + r() * (g[1] - g[0]))), k = 0
    for (; k < HORIZON; k++) {
      const pace = range ? state.pace.range[0] + Math.floor(r() * (state.pace.range[1] - state.pace.range[0] + 1)) : ns[Math.floor(r() * ns.length)]
      left -= pace * caps[k]; if (left <= 1e-9) break
    }
    fin[t] = k
  }
  fin.sort((a, b) => a - b)
  const q = (p) => fin[Math.min(TRIALS - 1, Math.ceil(p * TRIALS) - 1)]
  return { fin, q50: q(.5), q85: q(.85), q95: q(.95) }
}
const endOf = (k) => k >= HORIZON ? 'beyond 2 years' : dm(add(START, 7 * k + 6))
const shift = (a, b) => { const d = b - a; return d === 0 ? 'same week' : d > 0 ? '<span class="later">' + plural(d, 'week') + ' later</span>' : '<span class="sooner">' + plural(-d, 'week') + ' sooner</span>' }
function forecasts() {
  const on = state.cap.on && active().length > 0
  const U = simulate([]), C = on ? simulate(active()) : U
  return { U, C, on }
}

// ---------- shared pieces ----------
function seg(opts, on, fn) { return '<span class="dseg">' + opts.map(([v, l]) => '<button class="' + (v === on ? 'on' : '') + '" onclick="' + fn + '(\'' + v + '\')">' + l + '</button>').join('') + '</span>' }
// The pace bars: the window's weeks, the milestone's own dark and comparable work light on top, quiet weeks a red stub,
// skipped weeks dashed and struck.
function bars(W) {
  const shown = W.reach.length ? W.reach : W.win, mx = Math.max(1, ...shown.map((x) => x.n))
  return '<span class="dgraph">' + shown.map((x, i) => {
    const sk = state.pace.skipped.includes(x.wk), h = (v) => Math.round(40 * v / mx), cmp = x.n - x.own
    return '<span class="c' + (sk ? ' skipped' : '') + '" title="' + wc(x.wk) + ': ' + x.n + ' finished' + (cmp ? ' (' + x.own + ' milestone, ' + cmp + ' comparable)' : '') + (sk ? ' · skipped' : '') + '">' +
      '<span class="v">' + x.n + '</span>' + (x.n === 0 ? '<span class="bar zero"></span>' :
      (cmp ? '<span class="bar cmp" style="height:' + h(cmp) + 'px;border-radius:2px 2px 0 0"></span>' : '') + '<span class="bar" style="height:' + h(x.own) + 'px;' + (cmp ? 'border-radius:0' : '') + '"></span>') +
      '<span class="d">' + (i === 0 || x.wk.slice(5, 7) !== shown[i - 1].wk.slice(5, 7) ? dm(x.wk) : toD(x.wk).getUTCDate()) + '</span></span>'
  }).join('') + '</span>'
}
function paceLine(W) {
  const p = state.pace
  if (p.src === 'range') return 'A range, ' + p.range[0] + '–' + p.range[1] + ' a week'
  const n = W.win.length, ns = nums(W), stats = ns.length ? ' · ' + lo(ns) + ' to ' + hi(ns) + ' a week' : ''
  if (!W.gh) return 'Your typed counts, ' + plural(n, 'week') + stats
  if (W.lead) return 'From the first finished ticket, ' + dm(W.lead) + ' · ' + plural(n, 'week') + stats
  if (W.short) return plural(n, 'week') + ' · ' + T() + ' has nothing before ' + wc(WEEKS[FIRST]) + stats
  return T() + '’s last ' + plural(n, 'week') + (W.skippedIn ? ', ' + W.skippedIn + ' skipped' : '') + stats
}
// The pattern, one folded line under the bars; opened: the shape, what to do, and when there's an action both 85% dates.
function patternBlock(W, F) {
  const a = state.pace.applied
  let h = ''
  if (a) h += '<div class="applied"><span>' + (a.kind === 'from' ? 'Counting pace from ' + dm(a.wk) + ', after it ' + a.word + '.' : 'Leaving out ' + wc(a.wk) + ', the odd week.') + '</span><button class="linkish" onclick="undoPattern()">Undo</button></div>'
  if (a && W.win.length < 6) return h
  const R = reading(W)
  if (!R) return h
  if (R.kind === 'quiet') return h + '<p class="faint" style="margin:0">' + R.line + '</p>'
  let both = ''
  if (R.act && F && F.C) {
    const keep = F.C.q85, saved = JSON.stringify(state.pace)
    if (R.act.from) state.pace.from = R.act.from; else state.pace.skipped = state.pace.skipped.concat([R.act.skip])
    const alt = simulate(state.cap.on ? active() : []); state.pace = JSON.parse(saved)
    both = '<div class="both"><span>As read now</span><b>' + endOf(keep) + '</b><span>' + R.label + '</span><b>' + (alt ? endOf(alt.q85) : 'no forecast') + '</b></div>'
  }
  return h + '<details class="read"' + (ui.readOpen ? ' open' : '') + ' ontoggle="ui.readOpen=this.open"><summary><b>' + R.name + '</b>' + (R.early ? ': ' : R.kind === 'speeding' || R.kind === 'slowing' || R.kind === 'spells' || R.kind === 'lumpy' ? ': ' : ' · ') + R.short + '</summary>' +
    '<p>' + R.detail + '</p>' + (R.ask ? '<p class="faint">' + R.ask + '</p>' : '') + both + (R.act ? '<div class="row"><button onclick="applyPattern()">' + R.label + '</button></div>' : '') + '</details>'
}
function warnings(W) {
  const out = []
  if (state.pace.src !== 'range') {
    const n = W.win.length
    if (n > 0 && n < 4) out.push('Pace: ' + plural(n, 'week') + ' counted. The forecast needs at least 4. ' + (state.pace.from ? 'Undo the start date, or switch pace to the range.' : 'Add another count, or switch pace to the range.'))
    else if (n >= 4 && n < 8) out.push('Pace: ' + plural(n, 'week') + ' counted. The forecast needs 8 to be reliable.')
  }
  const c = combined()
  if (c && c.incomplete) out.push('A query matches more than 1,000 tickets, the most ' + T() + ' returns, so the counts are incomplete.')
  return out.map((m) => '<p class="warning">⚠ ' + m + '</p>').join('')
}

// ---------- the Milestone forecast screen ----------
function forecastScreen() {
  const W = windowOf(), F = forecasts(), A = F.C
  if (!A) return noForecast(W)
  const quiet = !active().length ? '' : !state.cap.on ? '<p class="faint" style="margin:0">Capacity is switched off for this forecast; its entries are kept.</p>'
    : '<p class="faint" style="margin:0">Includes capacity, which ' + (F.C.q85 === F.U.q85 ? 'doesn’t move the 85% date.' : 'moves the 85% date ' + shift(F.U.q85, F.C.q85) + '.') + '</p>'
  const cmp = F.on
  const rows = [['50%', 'q50'], ['85%', 'q85'], ['95%', 'q95']].map(([p, k]) => '<tr><td>' + p + ' confident by</td><td><b>' + endOf(F.C[k]) + '</b></td>' + (cmp ? '<td>' + endOf(F.U[k]) + '</td><td>' + shift(F.U[k], F.C[k]) + '</td>' : '') + '</tr>').join('')
  return '<div class="col" style="gap:20px"><div class="col" style="gap:6px"><p class="bighead">Starting ' + dm(state.start) + ' 2026: 85% confident of finishing by <span class="good">' + endOf(A.q85) + '</span></p>' + quiet + '</div>' + warnings(W) +
    '<div class="fc"><div class="col" style="gap:18px">' +
    '<section class="brief"><div class="heading"><h2>When it could finish</h2></div><table class="pc">' + (cmp ? '<thead><tr><th></th><th>With capacity</th><th>At usual capacity</th><th></th></tr></thead>' : '') + '<tbody>' + rows + '</tbody></table>' +
    '<p class="faint">' + ticketsNow() + ' tickets remaining · ' + ({ low: 'Low', medium: 'Medium', high: 'High' })[state.amb] + ' ambiguity: the work may grow ' + AMB[state.amb].join('–') + '× · <a href="#" onclick="go(\'inputs\');return false">Edit</a></p></section>' +
    '<section class="brief"><div class="heading"><h2>Week by week</h2></div>' + weeksChart(A, F.on) + '</section></div>' +
    '<aside class="side"><h3>Pace</h3>' + paceAside(W, F) + capPanel(F) + '</aside></div></div>'
}
function paceAside(W, F) {
  const src = state.pace.src, head = src === 'range' ? 'A range' : W.gh ? 'Finished each week · ' + T() : 'Typed counts, finished each week'
  const body = src === 'range' ? '<p class="muted" style="margin:0">' + state.pace.range[0] + '–' + state.pace.range[1] + ' tickets a week, from a slow week to a good one.</p>'
    : bars(W) + '<p class="faint" style="margin:0">' + paceLine(W) + '</p>' + patternBlock(W, F)
  return '<div class="pacebox"><div class="phead"><span>' + head + '</span><a href="#" onclick="go(\'inputs\');return false">Change</a></div>' + body + '</div>'
}
function noForecast(W) {
  const p = state.pace, n = W.win.length
  const allSkipped = W.gh && n === 0 && p.skipped.length
  const why = allSkipped ? 'Every week the pace could come from is skipped.' : n && nums(W).every((x) => x === 0) ? 'Nothing finished in these ' + plural(n, 'week') + ', so there’s no pace to forecast from.' : 'Pace: ' + plural(n, 'week') + ' counted, and the forecast needs at least 4.'
  const last = [...p.skipped].sort().pop()
  return '<div class="col" style="gap:20px"><p class="bighead">No forecast yet</p>' +
    '<div class="nofc"><p style="margin:0">' + why + '</p><div class="row">' +
    (last ? '<button onclick="act(\'count again ' + last + '\', () => { state.pace.skipped = state.pace.skipped.filter((w) => w !== \'' + last + '\') })">Count ' + wc(last) + ' again</button>' : '') +
    (p.applied && p.applied.kind === 'from' ? '<button onclick="undoPattern()">Undo the start date</button>' : '') +
    '<button onclick="setPaceSrc(\'typed\')">Use typed counts</button><button onclick="setPaceSrc(\'range\')">Use a range</button></div></div>' +
    '<div class="fc"><div></div><aside class="side"><h3>Pace</h3>' + paceAside(W, null) + '</aside></div></div>'
}
// One chart on one week axis: how many simulations finish each week, 50% and 85% marked, capacity weeks shaded with their %.
function weeksChart(A, on) {
  const hiK = Math.min(HORIZON - 1, A.q95 + 1), n = hiK + 1
  const cw = new Array(n).fill(0); for (const f of A.fin) if (f <= hiK) cw[f]++
  const fm = Math.max(1, ...cw), at = (k) => ((k + 0.5) / n * 100).toFixed(2) + '%'
  const cols = cw.map((c, k) => { const d = add(START, 7 * k), cap = on ? capOfWeek(d, active()) : 1, adj = Math.abs(cap - 1) > 1e-9
    return '<div class="cc' + (adj ? ' adj' : '') + '" title="w/c ' + dm(d) + ': ' + c + ' of ' + TRIALS + ' simulations finish' + (adj ? ' · ' + Math.round(cap * 100) + '% capacity' : '') + '">' + (adj ? '<span class="cpct">' + Math.round(cap * 100) + '%</span>' : '') + '<span class="fin" style="height:' + (c / fm * 100).toFixed(1) + '%"></span></div>' }).join('')
  const dates = cw.map((_, k) => '<span>' + (k % 3 ? '' : dm(add(START, 7 * k))) + '</span>').join('')
  return '<div class="cg"><div class="mrow">' + [['50%', A.q50, '-100%'], ['85%', A.q85, '0']].map(([p, k, x]) => '<span class="mtag" style="left:' + at(k) + ';transform:translateX(' + x + ')">' + p + ' · ' + endOf(k) + '</span>').join('') + '</div>' +
    '<div class="cgf">' + cols + [A.q50, A.q85].map((k) => '<div class="mline" style="left:' + at(k) + '"></div>').join('') + '</div><div class="cgd">' + dates + '</div></div>' +
    '<p class="faint"><span class="key" style="background:var(--bar)"></span>simulations finishing that week' + (on ? ' · <span class="key" style="background:repeating-linear-gradient(135deg, transparent 0 3px, rgba(181,72,42,.5) 3px 5px)"></span>weeks capacity changes, at the % shown' : '') + '</p>'
}
// Capacity, folded under Pace and switchable
function capPanel(F) {
  const list = active(), on = state.cap.on
  const effect = {}
  if (on && ui.capOpen && F.C) for (const e of list) { const r = simulate(list.filter((x) => x !== e)); effect[e.id] = r ? F.C.q85 - r.q85 : 0 }
  const effText = (e) => !(e.id in effect) ? '' : effect[e.id] === 0 ? '<span class="eff faint">no change to the 85% date</span>' : '<span class="eff ' + (effect[e.id] > 0 ? 'later' : 'sooner') + '">85% date ' + (effect[e.id] > 0 ? '+' : '−') + Math.abs(effect[e.id]) + ' wk</span>'
  const line = (e, past) => ui.edit === e.id ? editForm(e) :
    '<div class="sline"><span><b>' + e.pct + '%</b> ' + span(e) + (e.newUsual ? ' · new usual from ' + dm(e.newUsual) : '') + (e.note ? ' <span class="faint">' + esc(e.note) + '</span>' : '') + (past ? '' : ' ' + effText(e)) + '</span>' +
    '<span class="row" style="gap:10px;flex-wrap:nowrap"><button class="linkish" onclick="ui.edit=' + e.id + ';render()">Edit</button>' + (past ? '' : '<button class="linkish" onclick="removeEntry(' + e.id + ')">Remove</button>') + '</span></div>'
  const past = state.cap.entries.filter(isPast)
  const summary = !list.length ? 'none, every week usual' : (on ? '' : 'off · ') + plural(list.length, 'entry').replace('entrys', 'entries') + (on && F.C && F.C.q85 !== F.U.q85 ? ' · 85% date ' + shift(F.U.q85, F.C.q85) : '')
  const body = '<label class="row" style="gap:6px;font-size:13px"><input type="checkbox"' + (on ? ' checked' : '') + ' onchange="act(\'use capacity \' + this.checked, () => { state.cap.on = this.checked })"> Use capacity in this forecast</label>' +
    (on ? '' : '<p class="faint" style="margin:0">Off: the forecast uses pace alone. Entries are kept, and still count for the next milestone.</p>') +
    '<p class="faint" style="margin:0"><b>100%</b> = the team’s usual week, as in the pace.</p>' +
    (list.map((e) => line(e, false)).join('') || '<p class="muted" style="margin:0">Every week is at 100%.</p>') + capFlags() +
    '<div class="sentence">The team is at <input type="number" id="cpct" min="0" step="1" value="50">% from <input type="date" id="cfrom" value="2026-12-21"> to <input type="date" id="cto" value="2027-01-01"> <label style="font-size:13px"><input type="checkbox" id="conward" onchange="document.getElementById(\'cto\').disabled=this.checked"> or onward</label>, for <input type="text" id="cnote" placeholder="leave, an incident…">. <button onclick="readAdd()">Add</button></div>' +
    '<p class="faint" style="margin:0">Capacity scales pace in proportion: a 60% week draws 60% of a usual week’s pace. Weekends don’t count; overlapping entries multiply. Past counts and comparable work aren’t adjusted.</p>' +
    (past.length ? '<details class="past"><summary>Past (' + past.length + ') · kept, not used by the forecast</summary>' + past.map((e) => line(e, true)).join('') + '</details>' : '')
  return '<details class="cap"' + (ui.capOpen ? ' open' : '') + ' ontoggle="if(ui.capOpen!==this.open){ui.capOpen=this.open;render()}"><summary><span class="ctitle">Capacity</span> <span class="faint">' + summary + '</span></summary><div class="col" style="gap:10px;margin-top:10px">' + body + '</div></details>'
}
function editForm(e) {
  const past = isPast(e)
  return '<div class="pop col" style="gap:8px">' + (past ? '<span class="faint">' + e.pct + '% ' + span(e) + ' · past, so only the note can change</span>' :
    '<div class="sentence">At <input type="number" id="epct" min="0" step="1" value="' + e.pct + '">% from <input type="date" id="efrom" value="' + e.from + '"> to <input type="date" id="eto" value="' + (e.to || '') + '"' + (e.to === null ? ' disabled' : '') + '> <label style="font-size:13px"><input type="checkbox" id="eonward"' + (e.to === null ? ' checked' : '') + ' onchange="document.getElementById(\'eto\').disabled=this.checked"> or onward</label></div>') +
    '<label class="faint" style="display:flex;flex-direction:column;gap:2px">Note <input type="text" id="enote" value="' + esc(e.note) + '"></label>' +
    '<div class="row"><button class="primary" onclick="saveEdit(' + e.id + ')">Save</button><button class="linkish" onclick="ui.edit=null;render()">Cancel</button></div></div>'
}
function capFlags() {
  const W = windowOf(), counts = state.pace.src !== 'range'
  let h = ui.msg ? '<p class="flag bad">' + esc(ui.msg) + '</p>' : ''
  for (const e of active()) if (e.pct > 150) h += '<p class="flag warn">' + span(e) + ' at ' + e.pct + '%: the pace comes from a team about ' + Math.round(10000 / e.pct) + '% this size, so it’s a weak guide. A pace range, or comparable work from the bigger team, may be better.</p>'
  for (const e of active().filter((x) => x.to === null)) {
    const after = W.win.filter((x) => x.wk >= e.from).length
    if (counts && W.win.length && after === W.win.length && !ui['kept' + e.id]) h += '<div class="flag prop"><span>Every week the pace comes from is after ' + dm(e.from) + ', so it already shows the team at ' + e.pct + '%. Make it the <b>new usual</b>? The change then ends, so it isn’t counted twice.</span><button onclick="act(\'new usual ' + e.id + '\', () => { state.cap.entries.find((x) => x.id === ' + e.id + ').newUsual = TODAY })">Make it the new usual</button><button class="linkish" onclick="ui.kept' + e.id + '=true;render()">Keep it</button></div>'
    else if (counts && after < W.win.length && e.from <= TODAY) h += '<p class="muted" style="margin:0">' + e.pct + '% ' + span(e) + ': ' + after + ' of the ' + plural(W.win.length, 'week') + ' the pace comes from are after the change. Past counts aren’t adjusted. When all of them are, you’ll be asked whether it’s the new usual.</p>'
    else if (!counts) h += '<p class="muted" style="margin:0">' + e.pct + '% ' + span(e) + ': with a pace range, end this yourself once the range reflects it. <button class="linkish" onclick="act(\'end ' + e.id + '\', () => { state.cap.entries.find((x) => x.id === ' + e.id + ').to = add(TODAY, -1) })">End it today</button></p>'
  }
  return h
}
function readAdd() {
  const v = (n) => document.getElementById('c' + n), onward = v('onward').checked, from = v('from').value, pct = Number(v('pct').value)
  const to = onward ? null : (v('to').value || from), bad = checkEntry(from, to, pct, onward)
  if (bad) { ui.msg = bad; return render() }
  ui.msg = null
  act('add ' + pct + '% ' + from + (onward ? ' onward' : '..' + to), () => { state.cap.entries.push({ id: nextId++, from, to, pct, note: v('note').value }); state.cap.entries.sort((a, b) => a.from.localeCompare(b.from)) })
}
function saveEdit(id) {
  const e = state.cap.entries.find((x) => x.id === id), v = (n) => document.getElementById('e' + n)
  if (isPast(e)) return act('edit note ' + id, () => { e.note = v('note').value; ui.edit = null })
  const onward = v('onward').checked, next = { from: v('from').value, to: onward ? null : (v('to').value || v('from').value), pct: Number(v('pct').value), note: v('note').value }
  const bad = checkEntry(next.from, next.to, next.pct, onward); if (bad) { ui.msg = bad; return render() }
  ui.msg = null; act('edit ' + id, () => { Object.assign(e, next); ui.edit = null })
}
function removeEntry(id) { act('remove ' + id, () => { state.cap.entries = state.cap.entries.filter((e) => e.id !== id) }) }

// ---------- the Inputs screen ----------
function section(n, name, hint, body) {
  return '<section class="input"><div class="label"><span class="number">' + String(n).padStart(2, '0') + '</span><h2>' + name + '</h2><p>' + hint + '</p></div><div class="body"><div class="col">' + body + '</div></div></section>'
}
function inputsScreen() {
  let top = ''
  if (!state.conn && state.skippedSetup) top = '<div class="summary"><span class="muted">No tracker connected: the inputs are typed.</span><button class="linkish" onclick="act(\'connect a tracker\', () => { state.skippedSetup = false; state.step = 1 })">Connect a tracker</button></div>'
  else if (!state.setupDone || ui.reopen) top = wizard()
  else top = trackerSummary()
  const W = windowOf()
  return top +
    section(1, 'Milestone', 'Name, start date and tickets remaining.', '<div class="fields"><label class="wide">Milestone name <input type="text" value="' + esc(state.name) + '" onchange="act(\'name\', () => { state.name = this.value })"></label><label>Start date <input type="date" value="' + state.start + '" onchange="act(\'start date\', () => { state.start = this.value })"></label></div>' + ticketsBlock()) +
    section(2, 'Cadence', 'How long a period is, in days. Pace patterns are read at 7 days or more.', '<div class="fields"><label>Days per period <input type="number" min="1" value="' + state.cadence + '" onchange="act(\'cadence\', () => { state.cadence = Number(this.value) })"></label></div>' + (state.cadence < 7 ? '<p class="faint">Patterns are read from weeks or sprints.</p>' : '') + (state.cadence !== 7 ? '<p class="faint">(Prototype: the tracker is still read in weeks.)</p>' : '')) +
    section(3, 'Pace', 'How many tickets the team finishes a week: from ' + (state.conn ? T() + ', ' : '') + 'your typed counts, or a range. Capacity is set beside the forecast, under Pace.', paceBlock(W)) +
    section(4, 'Ambiguity', 'How well the milestone’s work is understood. The less it is, the more the work may grow.', '<fieldset class="levels">' + ['low', 'medium', 'high'].map((l) => '<label><input type="radio" name="amb"' + (state.amb === l ? ' checked' : '') + ' onchange="act(\'ambiguity ' + l + '\', () => { state.amb = \'' + l + '\' })"> ' + l[0].toUpperCase() + l.slice(1) + ' <span class="range">' + AMB[l].join('–') + '×</span></label>').join('') + '</fieldset>') +
    section(5, 'Growth', 'How much the work may grow at each level of ambiguity.', '<p class="muted">As in the app today: Low 1–1.5×, Medium 1–2×, High 1.5–3×.</p>')
}
function setTicketsSrc(v) { act('tickets → ' + v, () => { state.tickets.src = v; if (v === 'github') state.tickets.seen = state.readNo }) }
function setPaceSrc(v) { act('pace → ' + v, () => { state.pace.src = v; if (v === 'github') state.pace.seen = state.readNo; if (state.pace.applied) { state.pace.applied = null; state.pace.from = null } }) }
// a chip when the typed value differs from the tracker's read; a dot when there's a read since you last looked
function chip(which, theirs, yours) {
  const seen = state[which].seen, dot = seen < state.readNo
  return '<details class="dchip"' + (ui['chip' + which] ? ' open' : '') + ' ontoggle="ui[\'chip' + which + '\']=this.open;if(this.open&&state.' + which + '.seen<state.readNo){state.' + which + '.seen=state.readNo;render()}"><summary>' + (dot ? '<span class="dot"></span>' : '') + T() + ' reads differently</summary>' +
    '<div class="dpanel"><span>' + T() + ' reads <b>' + theirs + '</b> (read ' + readAt() + '). Yours: <b>' + yours + '</b>.</span><button onclick="ui[\'chip' + which + '\']=false;' + (which === 'tickets' ? 'setTicketsSrc' : 'setPaceSrc') + '(\'github\')">Follow ' + T() + '</button></div></details>'
}
function ticketsBlock() {
  const t = state.tickets, c = combined()
  const val = t.src === 'github' && c ? c.open : t.typed
  let h = (c ? seg([['github', T()], ['typed', 'Typed']], t.src, 'setTicketsSrc') : '') +
    '<div class="numrow"><label class="muted" style="display:flex;flex-direction:column;gap:4px">Tickets remaining <input type="number" min="0" value="' + val + '" onchange="act(\'type tickets\', () => { state.tickets.typed = Number(this.value); state.tickets.src = \'typed\' })"></label>'
  if (c && t.src === 'github') {
    const prev = state.readNo > 0 ? measureAt(state.readNo - 1) : null
    h += '<span class="faint">follows ' + T() + ', read ' + readAt() + (prev !== null && prev !== c.open ? '<br><span class="was">was ' + prev + ' on ' + READS[state.readNo - 1] + '</span>' : '') + '</span>'
  }
  if (c && t.src === 'typed' && t.typed !== c.open) h += chip('tickets', c.open, t.typed)
  return h + '</div>' + (c ? '<p class="faint" style="margin:0">Open leaf tickets the milestone query matches now.</p>' : '')
}
function measureAt(n) { const keep = state.readNo; state.readNo = n; const m = state.reads.mq && state.reads.mq.ok ? measure(state.reads.mq.set).open : null; state.readNo = keep; return m }
function paceBlock(W) {
  const p = state.pace, c = combined()
  const opts = (c ? [['github', T()]] : []).concat([['typed', 'Typed counts'], ['range', 'Range']])
  let h = seg(opts, p.src === 'github' && !c ? 'typed' : p.src, 'setPaceSrc')
  if (p.src === 'range') return h + '<div class="pace"><label>Low <input type="number" value="' + p.range[0] + '" onchange="act(\'range low\', () => { state.pace.range[0] = Number(this.value) })"></label><span class="to">to</span><label>High <input type="number" value="' + p.range[1] + '" onchange="act(\'range high\', () => { state.pace.range[1] = Number(this.value) })"></label><span class="unit">tickets per week</span></div><p class="faint">No counts, so no pace pattern.</p>'
  const gh = W.gh, cmpOn = gh && state.cq.trim()
  h += '<div class="row">' + bars(W) + '<span class="col" style="gap:4px"><span class="muted">' + paceLine(W) + '</span>' +
    (cmpOn ? '<span class="faint"><span class="key" style="background:var(--bar)"></span>the milestone · <span class="key" style="background:var(--bar-light)"></span>comparable work</span>' : '') +
    (gh ? '<span class="faint">Finished: closed, cancelled included, at their last close. Quiet weeks count as 0.</span>' : '') +
    '<button class="linkish" style="align-self:flex-start" onclick="ui.weeks=!ui.weeks;render()">' + (ui.weeks ? 'Hide weeks' : 'Show weeks') + '</button></span></div>'
  if (p.src === 'typed' && c) { const theirs = nums(withSrc('github')), mine = nums(W); if (JSON.stringify(theirs) !== JSON.stringify(mine)) h += chip('pace', theirs.join(', '), mine.join(', ')) }
  if (ui.weeks) h += weekCells(W)
  return h
}
function withSrc(src) { const keep = state.pace.src; state.pace.src = src; const W = windowOf(); state.pace.src = keep; return W }
// Editable week blocks. Typing in a tracker week copies the weeks into typed counts and switches pace to Typed counts.
function weekCells(W) {
  const gh = W.gh, shown = W.reach.length ? W.reach : W.win
  const cells = shown.map((x) => {
    const sk = state.pace.skipped.includes(x.wk)
    return '<div class="cell' + (sk ? ' skipped' : x.n === 0 ? ' quiet' : '') + '"><span>' + wc(x.wk) + '</span><input type="number" min="0" value="' + x.n + '" onchange="typeWeek(\'' + x.wk + '\', this.value)">' +
      (gh ? (sk ? '<button class="linkish" onclick="act(\'count again ' + x.wk + '\', () => { state.pace.skipped = state.pace.skipped.filter((w) => w !== \'' + x.wk + '\') })">count again</button>' : '<button class="linkish" onclick="act(\'skip ' + x.wk + '\', () => { state.pace.skipped.push(\'' + x.wk + '\') })">Skip</button>') : '') + '</div>'
  }).join('')
  return '<div class="cells">' + cells + '</div>' + (gh ? '<p class="faint" style="margin:0">Skip a week the team was away (a holiday); the window reaches back to keep up to 8. Typing a count switches pace to Typed counts.</p>' :
    '<div class="row"><button class="linkish" onclick="act(\'add earlier week\', () => { const f = state.pace.typed[0]; state.pace.typed.unshift({ wk: add(f ? f.wk : WEEKS[13], -7), n: 0 }) })">Add an earlier week</button><button class="linkish" onclick="act(\'remove oldest week\', () => { state.pace.typed.shift() })">Remove the oldest</button></div>')
}
function typeWeek(wk, v) {
  act('type ' + wk + ' = ' + v, () => {
    if (state.pace.src === 'github') { state.pace.typed = windowOf().reach.filter((x) => !state.pace.skipped.includes(x.wk)).map((x) => ({ wk: x.wk, n: x.n })); state.pace.src = 'typed' }
    const t = state.pace.typed.find((x) => x.wk === wk); if (t) t.n = Number(v)
  })
}

// ---------- tracker setup steps (#136 B) and summary ----------
const kindOf = (id) => id[0] === 'e' ? 'epic' : id[0] === 'l' ? 'label' : tr() === 'jira' ? 'fix version' : 'milestone'
function choiceName(id) { const v = id.slice(2); return id[0] === 'e' ? (tr() === 'jira' ? PROJECT + '-' : '#') + v + ' ' + EPICS[v] : id[0] === 'l' ? 'label ' + v : v }
function choiceGroups() {
  const of = (k) => CHOICES.filter((c) => c[0] === k).slice(0, 100)
  return tr() === 'jira' ? [['Fix versions', of('m')], ['Epics', of('e')], ['Labels', of('l')]] : [['Epics (parent issues)', of('e')], ['Labels', of('l')], ['Milestones', of('m')]]
}
function picks(which) {
  const q = state[which].trim(); if (!q) return []
  const ids = q.split(' OR ').map((t) => CHOICES.find((n) => choiceQuery(state.conn.tracker, n) === t))
  return ids.every(Boolean) ? ids : null
}
function togglePick(which, id, on) {
  act((on ? 'add ' : 'remove ') + id + (which === 'mq' ? ' to the milestone' : ' to comparable work'), () => {
    const ids = (picks(which) || []).filter((n) => n !== id).concat(on ? [id] : [])
    state[which] = ids.map((n) => choiceQuery(state.conn.tracker, n)).join(' OR '); doRead(which)
  })
}
function setQuery(which, q) { act('edit ' + which, () => { state[which] = q; doRead(which) }) }
function finder(which) {
  const ids = picks(which) || []
  return '<div class="col" style="gap:6px;max-width:560px">' + (ids.length ? '<div class="row">' + ids.map((id) => '<span class="chip">' + esc(choiceName(id)) + ' <span class="dmark">' + kindOf(id) + '</span><button class="x" aria-label="Remove" onclick="togglePick(\'' + which + '\', \'' + id + '\', false)">×</button></span>').join('') + '</div>' : '') +
    '<input type="text" class="find" placeholder="Find ' + (tr() === 'jira' ? 'a fix version, epic or label' : 'an epic, label or milestone') + '…" oninput="findChoices(\'' + which + '\', this.value)">' +
    '<div class="found" id="found-' + which + '" data-which="' + which + '"></div></div>'
}
// each kind is listed once (up to 100), and filtered by what's typed, ignoring case
function findChoices(which, text) {
  const t = text.trim().toLowerCase(), taken = (picks(which) || []).concat(which === 'cq' ? picks('mq') || [] : [])
  const groups = choiceGroups().map(([g, ids]) => [g, ids.filter((id) => !taken.includes(id) && choiceName(id).toLowerCase().includes(t))]).filter(([, ids]) => ids.length)
  document.getElementById('found-' + which).innerHTML = groups.length ? groups.map(([g, ids]) => '<span class="hd">' + g + '</span>' + ids.map((id) => '<button onclick="togglePick(\'' + which + '\', \'' + id + '\', true)">' + esc(choiceName(id)) + ' <span class="dmark">' + kindOf(id) + '</span></button>').join('')).join('')
    : '<span class="dmark" style="padding:6px 8px">Nothing matches “' + esc(text) + '”</span>'
}
function flag(which, r = state.reads[which]) {
  if (!r) return ''
  const stale = state.lastGood[which] ? ' Still using the last query that worked (<span class="qline">' + esc(state.lastGood[which].q) + '</span>).' : ' Nothing is read until it’s fixed.'
  if (!r.ok && r.fail === 'outOfScope') return '<p class="flag bad"><b>' + esc(r.msg) + '</b> reaches outside ' + esc(where()) + '. This connection reads one ' + (tr() === 'jira' ? 'project' : 'repo') + '.' + stale + '</p>'
  if (!r.ok) return '<p class="flag bad">' + (r.ours ? '' : T() + ' says: ') + esc(r.msg) + stale + '</p>'
  if (r.incomplete) return '<p class="flag warn">Matches more than 1,000 tickets, the most ' + T() + ' returns, so the counts are incomplete. Narrow the query.</p>'
  if (!r.total) return '<p class="flag warn">Matches no tickets' + (which === 'mq' ? ', so tickets remaining is 0' : '') + '. Check the query.</p>'
  return '<p class="flag ok">' + (which === 'mq' ? r.open + ' open · ' : '') + r.finished + ' finished in the last 8 weeks</p>'
}
const qbox = (which) => '<div class="qbox"><span class="scope">' + scopeText() + '</span><input value="' + esc(state[which]) + '" onchange="setQuery(\'' + which + '\', this.value)" aria-label="' + (which === 'mq' ? 'Milestone query' : 'Comparable-work query') + '"></div>'
function chooser(which) {
  const byHand = ui['edit' + which] || picks(which) === null, k = '\'edit' + which + '\''
  const toQuery = '<button class="linkish" onclick="ui[' + k + ']=true;render()">' + (state[which] ? 'Edit as a query' : 'Write a query instead') + '</button>'
  const toFind = picks(which) === null
    ? '<button class="linkish" onclick="act(\'clear the query\', () => { state.' + which + '=\'\'; delete state.reads.' + which + '; ui[' + k + ']=false })">Back to finding (clears this query)</button>'
    : '<button class="linkish" onclick="ui[' + k + ']=false;render()">Back to finding</button>'
  const leaf = tr() === 'jira' ? '' : '<span class="dmark">Each read adds <span class="qline">is:issue no:sub-issue</span>, so only leaf tickets count.</span>'
  return (byHand ? qbox(which) + '<div class="qmode"><span class="dmark">Press Enter to read it.</span>' + toFind + '</div>'
    : finder(which) + '<div class="qmode">' + (state[which] ? '<span class="qline">' + esc(state[which]) + '</span>' : '') + toQuery + '</div>') + leaf + flag(which)
}
function connectForm() {
  const d = state.draft, j = d.tracker === 'jira'
  const err = { noToken: 'Paste a token to connect.', unauthorised: (j ? 'Jira' : 'GitHub') + ' refused the token. Check it hasn’t expired' + (j ? '' : ', and that it has Issues: read') + '.', notFound: (j ? 'Jira can’t find that project' : 'GitHub can’t see ' + esc(d.where || 'that repo')) + ' with this token. Check the name, and that the token covers it.' }[state.connError]
  return '<div class="col">' + seg([['github', 'GitHub'], ['jira', 'Jira']], d.tracker, 'setDraftTracker') +
    '<div class="fields">' + (j ? '<label class="wide">Site <input type="text" value="' + esc(d.where) + '" placeholder="' + SITE + '" oninput="state.draft.where=this.value"></label><label>Project key <input type="text" placeholder="' + PROJECT + '"></label>'
      : '<label class="wide">Repo <input type="text" value="' + esc(d.where) + '" placeholder="owner/repo, try ' + REPO + '" oninput="state.draft.where=this.value"></label>') +
    '<label class="wide">' + (j ? 'API token' : 'Token') + ' <input type="text" value="' + esc(d.token) + '" placeholder="' + (j ? 'scoped to read Jira work' : 'fine-grained, Issues: read · type bad to see it refused') + '" oninput="state.draft.token=this.value" style="font-family:var(--mono)"></label></div>' +
    '<span class="dmark">Read-only: nothing is ever written to ' + (j ? 'Jira' : 'GitHub') + '. The token stays on this computer.</span>' + (err ? '<p class="flag bad">' + err + '</p>' : '') +
    '<div class="actions"><button class="linkish" onclick="act(\'skip setup\', () => { state.skippedSetup = true; state.pace.src = \'typed\' })">Skip: type the inputs instead</button><button class="primary" onclick="connect()">Connect</button></div></div>'
}
function setDraftTracker(t) { state.draft.tracker = t; state.draft.where = ''; state.connError = null; render() }
function connect() {
  act('connect', () => {
    const d = state.draft
    if (!d.token) { state.connError = 'noToken'; return }
    if (d.token === 'bad') { state.connError = 'unauthorised'; return }
    if (!(d.tracker === 'jira' ? /shop/i.test(d.where) : d.where.trim() === REPO)) { state.connError = 'notFound'; return }
    state.connError = null; state.conn = d.tracker === 'jira' ? { tracker: 'jira', site: SITE, project: PROJECT } : { tracker: 'github', repo: REPO }; state.step = 2
  })
}
function wizard() {
  const steps = ['Connect', 'Milestone', 'Comparable work', 'Check']
  const nav = '<ol>' + steps.map((s, i) => '<li class="' + (i + 1 === state.step ? 'on' : i + 1 < state.step ? 'done' : '') + '"' + (i + 1 < state.step && (i > 0 || !ui.reopen) ? ' onclick="act(\'step ' + (i + 1) + '\', () => { state.step = ' + (i + 1) + ' })"' : '') + '>' + (i + 1) + '. ' + s + '</li>').join('') + '</ol>'
  const cancel = ui.reopen ? '<button class="linkish" onclick="ui.reopen=false;render()">Cancel</button>' : ''
  const back = (n) => '<button onclick="act(\'step ' + n + '\', () => { state.step = ' + n + ' })">Back</button>'
  let body = ''
  if (state.step === 1) body = '<h2>Connect a tracker</h2><p class="muted">The milestone’s tickets and the team’s finished work are read from one GitHub repo or Jira project.</p>' + connectForm()
  if (state.step === 2) body = '<h2>Which tickets are the milestone?</h2><p class="muted">Find and add one or more from ' + esc(where()) + ': several epics, say, or a ' + (tr() === 'jira' ? 'fix version' : 'label') + '. An epic includes every ticket beneath it, sub-epics too.</p>' +
    chooser('mq') + '<div class="actions">' + cancel + '<span style="margin-left:auto"></span><button class="primary"' + (inUse('mq') ? '' : ' disabled') + ' onclick="act(\'step 3\', () => { state.step = 3 })">Next</button></div>'
  if (state.step === 3) {
    const c = combined(), W = withSrc('github')
    body = '<h2>Is there finished work like this milestone’s?</h2><p class="muted">Its finished tickets count in the pace alongside the milestone’s own, which helps when the milestone is new.</p>' + chooser('cq') +
      (c ? '<div class="row" style="margin-top:6px">' + bars(W) + '<span class="muted">Pace: ' + sum(nums(W)) + ' finished in ' + plural(W.win.length, 'week') + (state.cq.trim() ? ', the milestone’s own dark, comparable light' : '') + '</span></div>' : '') +
      '<div class="actions">' + cancel + '<span style="margin-left:auto"></span>' + back(2) + '<button class="primary" onclick="act(\'step 4\', () => { state.step = 4 })">' + (state.cq.trim() ? 'Next' : 'Skip') + '</button></div>'
  }
  if (state.step === 4) {
    const c = combined(), t = state.tickets, p = state.pace, W = withSrc('github'), mine = withSrc('typed')
    body = '<h2>Check what it gives</h2><p class="muted">Each value set to ' + T() + ' follows it, updating on each read. Choose Typed or Range to keep yours.</p>' +
      '<table class="check"><tr><th></th><th>Yours now</th><th>From ' + T() + '</th><th>Use</th></tr>' +
      '<tr><td>Tickets remaining</td><td>' + t.typed + '</td><td>' + c.open + '</td><td>' + seg([['github', T()], ['typed', 'Typed']], t.src, 'setTicketsSrc') + '</td></tr>' +
      '<tr><td>Pace</td><td>' + (p.src === 'range' ? p.range.join('–') + ' a week' : nums(mine).join(', ')) + '</td><td>' + bars(W) + '</td><td>' + seg([['github', T()], ['typed', 'Typed counts'], ['range', 'Range']], p.src, 'setPaceSrc') + '</td></tr></table>' +
      '<div class="actions">' + cancel + '<span style="margin-left:auto"></span>' + back(3) + '<button class="primary" onclick="act(\'use these\', () => { state.setupDone = true; ui.reopen = false })">Use these</button></div>'
  }
  return '<div class="wizard">' + nav + '<div class="col">' + body + '</div></div>'
}
function trackerSummary() {
  const counts = (w) => { const r = inUse(w); return r ? (w === 'mq' ? r.open + ' open · ' : '') + r.finished + ' finished in 8 weeks' : '' }
  const what = (w) => { const ids = picks(w); return ids ? '<span title="' + esc(state[w]) + '">' + ids.map((id) => esc(choiceName(id)) + ' <span class="dmark">' + kindOf(id) + '</span>').join(', ') + '</span>' : '<span class="qline">' + esc(state[w]) + '</span>' }
  const bad = (w) => { const r = state.reads[w]; return r && (!r.ok || r.incomplete || !r.total) ? flag(w) : '' }
  return '<div class="sumgrid"><div class="hdr"><span class="ok-dot"></span>' + T() + ' · <b style="font-family:var(--mono);font-weight:500">' + esc(where()) + '</b><span class="end"><span class="dmark">read ' + readAt() + '</span><button class="linkish" onclick="ui.reopen=true;state.step=2;render()">Change</button></span></div>' +
    '<span class="muted">Milestone</span>' + what('mq') + '<span class="dmark">' + counts('mq') + '</span>' +
    '<span class="muted">Comparable</span>' + (state.cq ? what('cq') + '<span class="dmark">' + counts('cq') + '</span>' : '<span class="dmark">none</span><span></span>') +
    '<span class="dmark foot">Leaf tickets only. Epics include their sub-epics.</span></div>' +
    '<div class="flags">' + bad('mq') + bad('cq') + '</div>'
}

// ---------- How it works (only what this spec adds) ----------
function howScreen() {
  const s = (h, ps) => '<section class="brief"><div class="heading"><h2>' + h + '</h2></div>' + ps.map((p) => '<p>' + p + '</p>').join('') + '</section>'
  return '<p class="muted">Prototype: only what the connected-forecasting spec adds. The rest of How it works is as in the app today.</p>' +
    s('Where the inputs come from', ['With a tracker connected, the milestone is a query in the tracker’s own syntax, built by picking epics, labels and milestones (fix versions in Jira), or written by hand. Membership is whatever it matches now.',
      'Only leaf tickets count, and an epic includes every ticket beneath it, sub-epics too. A ticket is finished when it’s closed (GitHub) or in a Done status (Jira), cancelled included, counted at its last finish.',
      'Pace is the finished tickets of the last 8 whole weeks, the milestone’s own and any comparable work’s; a quiet week counts as 0. A week you skip is left out and the window reaches back to keep 8. Quiet weeks before the first finished ticket are left out.',
      'Each value can follow the tracker, updating on each read, or be typed; typing switches it to typed.']) +
    s('Capacity', ['Capacity is a percentage of the team’s usual week, for a range of dates or from a date onward. It is averaged over working days, Monday to Friday.',
      'It scales each simulated week’s pace in proportion: a 60% week draws 60% of a usual week. That is an assumption: a smaller team isn’t always slower in proportion. Past counts and comparable work aren’t adjusted.',
      'When every week the pace comes from is after a lasting change, the counts already show it, so the tool asks whether it’s the new usual.']) +
    s('Pace patterns', ['From 6 weeks of counts, the forecast names the shape of the pace: Steady, Lumpy, Speeding up, Slowing down, Stepped up, Stepped down, Good and bad spells, or One odd week. Eight weeks is too few to be sure, so all but Steady and One odd week are worded as early.',
      'A pattern never suggests a cause. Where there’s something to do, such as counting pace from a step, it’s offered with the 85% date both ways, and you decide.'])
}

// ---------- page ----------
const HEAD = {
  forecast: () => ({ ctx: state.name + ' · ' + ticketsNow() + ' tickets remaining', h1: 'Milestone forecast', lede: '' }),
  inputs: () => ({ ctx: state.name, h1: 'Inputs', lede: 'What the forecast is made from. Change any of it and the forecast updates.' }),
  how: () => ({ ctx: '', h1: 'How it works', lede: 'How the forecast is worked out, and what it assumes.' }),
}
function go(s) { screen = s; ui.reopen = false; render(); window.scrollTo(0, 0) }
function cycle(d) { const ks = Object.keys(SCREENS); go(ks[(ks.indexOf(screen) + d + ks.length) % ks.length]) }
function setScenario(k, v) { if (k === 'tracker') tracker = v; if (k === 'history') history = v; if (k === 'capacity') capacity = v; load(); render() }
function newRead() { if (state.readNo < READS.length - 1) act('new read ' + READS[state.readNo + 1], () => { state.readNo++; if (state.conn) { doRead('mq'); if (state.cq) doRead('cq') } }) }
function render() {
  const h = HEAD[screen]()
  const hd = document.querySelector('main header')
  hd.innerHTML = (h.ctx ? '<p class="context">' + esc(h.ctx) + '</p>' : '') + '<h1>' + h.h1 + '</h1>' + (h.lede ? '<p class="lede">' + h.lede + '</p>' : '')
  document.title = SCREENS[screen] + ' · Forecaster'
  document.querySelectorAll('nav a[data-screen]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.screen === screen))
  document.getElementById('proto').innerHTML = screen === 'forecast' ? forecastScreen() : screen === 'inputs' ? inputsScreen() : howScreen()
  document.querySelectorAll('.found').forEach((el) => findChoices(el.dataset.which, ''))
  const q = new URLSearchParams({ screen, tracker, history, capacity }); history_replace(q)
  const W = windowOf(), F = forecasts(), R = reading(W)
  document.getElementById('state').textContent = JSON.stringify({ screen, tracker, history, capacity, read: readAt(),
    derived: { ticketsRemaining: ticketsNow(), window: W.win.map((x) => x.wk.slice(5) + ':' + x.n), lead: W.lead, pattern: R && (R.name || R.line),
      withCapacity: F.C && { q50: endOf(F.C.q50), q85: endOf(F.C.q85), q95: endOf(F.C.q95) }, atUsual: F.U && { q85: endOf(F.U.q85) } },
    state: { ...state, reads: Object.fromEntries(Object.entries(state.reads).map(([k, r]) => [k, r.ok ? { open: r.open, finished: r.finished } : r])), lastGood: Object.keys(state.lastGood) }, log }, null, 2)
  bar()
}
function history_replace(q) { try { window.history.replaceState(null, '', '?' + q) } catch (e) {} }
function bar() {
  const sel = (k, opts, v) => '<select onchange="' + (k === 'screen' ? 'go(this.value)' : 'setScenario(\'' + k + '\', this.value)') + '" aria-label="' + k + '">' + Object.entries(opts).map(([key, o]) => '<option value="' + key + '"' + (key === v ? ' selected' : '') + '>' + (o.name || o) + '</option>').join('') + '</select>'
  document.getElementById('switcher').innerHTML = '<button onclick="cycle(-1)" aria-label="Previous screen">←</button>' + sel('screen', SCREENS, screen) + '<button onclick="cycle(1)" aria-label="Next screen">→</button>' +
    sel('tracker', TRACKERS, tracker) + sel('history', HISTORY, history) + sel('capacity', CAPACITY, capacity) +
    '<button onclick="newRead()"' + (state.readNo >= READS.length - 1 ? ' disabled' : '') + '>New read</button><button onclick="load();render()">Reset</button>'
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === 'ArrowLeft') cycle(-1); if (e.key === 'ArrowRight') cycle(1)
})
document.querySelectorAll('nav a[data-screen]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.screen) }))
load()
render()
`

const header = { context: 'Checkout v2', heading: 'Milestone forecast', lede: '' }
mkdirSync(new URL('.', out), { recursive: true })
// The screens switch in the page: point the sidebar links at them.
const page = htmlPage('/', header, MAIN, SCRIPT)
  .replace('<a href="/" aria-current="page">', '<a href="?screen=forecast" data-screen="forecast" aria-current="page">')
  .replace('<a href="/inputs">', '<a href="?screen=inputs" data-screen="inputs">')
  .replace('<a href="/how-it-works">', '<a href="?screen=how" data-screen="how">')
writeFileSync(out, page)
const file = fileURLToPath(out)
console.log(`Prototype written to ${file}`)
if (!process.env.NO_OPEN) spawn('open', [file], { stdio: 'ignore', detached: true }).unref()
