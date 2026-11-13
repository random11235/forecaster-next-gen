// PROTOTYPE, throwaway: never merge. Spec #158 (https://github.com/random11235/forecaster-next-gen/issues/158),
// revised on PR #208: once comparable work is added, pace comes from it ALONE, shown beside the milestone's own pace,
// so the gap shows whichever way it goes (comparable work can now lower pace as well as raise it).
//
// Question: what should the Comparable work step look like when it compares comparable work's pace with the
// milestone's own? Three variants, switchable via `?variant=A|B|C` (or ← → keys, or the bar at the bottom):
//   A  Side by side: two 8-week bar charts on one scale, comparable work | the milestone's own so far, the one in use
//      marked, a sentence saying which is faster; candidates in a table with a "vs the milestone's own" column.
//   B  One scale: no weekly bars; every pace (in use, the milestone's own, each pick, each candidate) is a range with
//      its median on one shared axis, with a line at the milestone's own median: left is slower, right is faster.
//   C  Difference first: the pace in use and how far it is from the milestone's own as the headline; weekly bars
//      paired per week; candidates grouped into slower than the milestone / about the same / faster.
// Two scenes (buttons in the banner): "Checkout v2", six weeks in after a quick start, where the picked Payments rework
// is SLOWER than the milestone's own; and "Loyalty launch", just started, too few weeks of its own to compare.
// The milestone's own pace counts only weeks since its start date. All state is in memory; reload to reset.
// Run: `npm run prototype:side-by-side` (builds, writes dist/prototype/comparable-side-by-side.html, opens it).
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { htmlPage }: typeof import('../src/app/html.js') = await import(new URL('../dist/app/html.js', import.meta.url).href)

const out = new URL('../dist/prototype/comparable-side-by-side.html', import.meta.url)

const STYLE = `
  <style>
    #proto { display: flex; flex-direction: column; gap: 32px; }
    .proto-banner { font-size: 12px; color: var(--risk); font-family: var(--mono); margin: 0 0 4px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .proto-banner button { font: 12px var(--mono); min-height: 0; padding: 2px 8px; }
    .proto-banner button[aria-pressed="true"] { background: var(--ink); color: #fff; }
    .chips { list-style: none; padding: 0; margin: 6px 0; display: flex; gap: 6px; flex-wrap: wrap; }
    .chips .chip { border: 1px solid var(--border); border-radius: 999px; padding: 2px 4px 2px 10px; font-size: 13px; background: #fff; display: inline-flex; gap: 6px; align-items: center; }
    .kind { color: var(--faint); font-size: 11px; }
    .chip button, .rm { border: 0; background: none; min-height: 0; padding: 0 4px; cursor: pointer; }
    .muted { color: var(--muted); font-size: 13px; }
    .flag { border-left: 3px solid var(--risk); background: #fbf4ea; padding: 8px 10px; margin: 8px 0; font-size: 14px; }
    .state { font-family: var(--mono); font-size: 12px; white-space: pre-wrap; background: #f6f4ee; border: 1px dashed var(--border); padding: 10px; margin: 24px 0 80px; }
    .strip { display: inline-flex; align-items: flex-end; gap: 1px; vertical-align: middle; }
    .strip i { display: block; background: var(--ink); }
    .c { background: #c9a227 !important; }
    .o { background: var(--ink); }
    .pre { background: repeating-linear-gradient(45deg, #e6e1d4 0 3px, transparent 3px 6px) !important; }
    .inuse { display: inline-block; font-size: 11px; border-radius: 4px; padding: 1px 6px; background: #1c1b18; color: #fff; margin-left: 6px; vertical-align: middle; }
    .faster { color: #2f6b3a; } .slower { color: #9a3b1f; }
    table.t td, table.t th { padding: 4px 12px 4px 0; font-size: 13px; text-align: left; vertical-align: middle; }
    table.t th { font-weight: 500; color: var(--muted); font-size: 12px; border-bottom: 1px solid var(--hairline); }
    .num { font-variant-numeric: tabular-nums; }
    .add { font-size: 13px; min-height: 0; padding: 3px 8px; }
    details summary { cursor: pointer; font-size: 14px; margin: 10px 0 6px; }
    /* A */
    .sbs { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 10px 0; }
    .panel { border: 1px solid var(--border); padding: 10px 12px; background: #fff; }
    .panel.use { border-color: var(--ink); border-width: 2px; }
    .panel h3 { font-size: 14px; margin: 0 0 8px; }
    .bars { display: flex; gap: 6px; align-items: flex-end; height: 90px; }
    .bars .wk { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; font-size: 10px; color: var(--muted); }
    .bars .wk i { display: block; width: 100%; max-width: 22px; }
    .bars .wk b { font-size: 11px; color: var(--ink); font-weight: 500; }
    .pace-line { font-size: 13px; margin: 8px 0 0; }
    .verdict { font-size: 15px; margin: 4px 0 10px; }
    /* B */
    .scale { margin: 10px 0; }
    .scale .row { display: grid; grid-template-columns: minmax(150px, 220px) 1fr 90px; gap: 10px; align-items: center; min-height: 28px; font-size: 13px; }
    .scale .row.head { color: var(--muted); font-size: 11px; min-height: 18px; }
    .scale .row.sep { border-top: 1px solid var(--hairline); margin-top: 6px; padding-top: 4px; color: var(--muted); font-size: 12px; min-height: 20px; }
    .track { position: relative; height: 18px; }
    .track .rng { position: absolute; top: 7px; height: 4px; background: #d9d3c4; border-radius: 2px; }
    .track .med { position: absolute; top: 2px; width: 12px; height: 12px; border-radius: 50%; margin-left: -6px; background: var(--ink); }
    .track .med.c { background: #c9a227; }
    .track .ref { position: absolute; top: -6px; bottom: -6px; border-left: 1px dashed #9a3b1f; }
    .track .tick { position: absolute; top: 0; font-size: 10px; color: var(--faint); transform: translateX(-50%); }
    .row.use { font-weight: 600; }
    /* C */
    .headline { font-size: 28px; font-weight: 600; margin: 4px 0 0; }
    .headline small { font-size: 15px; font-weight: 400; color: var(--muted); }
    .delta { font-size: 16px; margin: 2px 0 12px; }
    .pairs { display: flex; gap: 12px; align-items: flex-end; height: 100px; margin: 8px 0 2px; }
    .pairs .wk { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; font-size: 10px; color: var(--muted); }
    .pairs .two { display: flex; gap: 2px; align-items: flex-end; height: 100%; }
    .pairs .two i { display: block; width: 11px; }
    .groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .groups h4 { font-size: 13px; margin: 0 0 6px; }
    .groups ul { list-style: none; margin: 0; padding: 0; }
    .groups li { font-size: 13px; padding: 3px 0; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .legend { font-size: 12px; color: var(--muted); margin: 4px 0; }
    .legend i { display: inline-block; width: 10px; height: 10px; vertical-align: middle; margin: 0 3px 0 8px; }
    .switcher { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #1c1b18; color: #fff; border-radius: 999px; padding: 6px 10px; display: flex; gap: 10px; align-items: center; box-shadow: 0 4px 16px rgba(0,0,0,.25); font: 13px var(--mono); z-index: 10; max-width: calc(100vw - 32px); }
    .switcher button { background: none; border: 0; color: #fff; font-size: 16px; cursor: pointer; min-height: 0; padding: 2px 8px; }
  </style>`

const SCRIPT = `
const VARIANTS = { A: 'Side by side', B: 'One scale', C: 'Difference first' }
const KEYS = Object.keys(VARIANTS)
const params = new URLSearchParams(location.search)
let variant = KEYS.includes(params.get('variant')) ? params.get('variant') : 'A'

// Finished tickets: an id each and the week it finished in (0 = 8 weeks ago, 7 = this past week).
const WEEKS = 8
function made(prefix, weekly, from = 1) {
  const tickets = []; let n = from
  weekly.forEach((count, week) => { for (let i = 0; i < count; i++) tickets.push({ id: prefix + '-' + n++, week }) })
  return tickets
}
const WEEK_STARTS = Array.from({ length: WEEKS }, (_, i) => new Date(Date.UTC(2026, 8, 21 + 7 * i)))
const weekLabel = (i) => WEEK_STARTS[i].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// Each scene: the milestone, the week it started in, and its own finished tickets.
const SCENES = {
  checkout: { name: 'Checkout v2', start: 2, open: 14, query: 'milestone:"Checkout v2"', tickets: made('CO', [0, 0, 7, 6, 4, 3, 3, 2]),
    about: 'six weeks in, after a quick start', picks: ['parent-issue:shop/shop#40'] },
  loyalty: { name: 'Loyalty launch', start: 6, open: 46, query: 'milestone:"Loyalty launch"', tickets: made('LOY', [0, 0, 0, 0, 0, 0, 1, 1]),
    about: 'just started', picks: ['milestone:"Checkout v2"'] },
}
const REWORK = made('PAY', [2, 2, 1, 2, 2, 1, 2, 2])
const CHOICES = [
  ...Object.values(SCENES).map((s) => ({ kind: 'milestone', name: s.name, query: s.query, open: s.open, tickets: s.tickets })),
  { kind: 'milestone', name: 'Search revamp', query: 'milestone:"Search revamp"', open: 0, tickets: made('SRCH', [6, 5, 7, 6, 6, 5, 3, 0]) },
  { kind: 'epic', name: 'Payments rework', query: 'parent-issue:shop/shop#40', open: 0, tickets: REWORK },
  { kind: 'epic', name: 'Points ledger', query: 'parent-issue:shop/shop#88', open: 12, tickets: [] },
  { kind: 'label', name: 'payments', query: 'label:"payments"', open: 3, tickets: [...made('PAY', [1, 1, 1, 1, 1, 1, 1, 1], 100), ...REWORK] },
  { kind: 'label', name: 'rewards', query: 'label:"rewards"', open: 5, tickets: made('RWD', [1, 0, 1, 2, 1, 1, 2, 1]) },
  { kind: 'label', name: 'bug', query: 'label:"bug"', open: 21, tickets: made('BUG', [5, 7, 6, 4, 8, 6, 5, 7]) },
]
const byQuery = (q) => CHOICES.find((c) => c.query === q)

function fresh(scene = 'checkout') { return { scene, picks: SCENES[scene].picks.map(byQuery) } }
let state = fresh()

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const fmt = (n) => (Math.round(n * 10) / 10).toString()
function union(picks) { const m = new Map(); picks.forEach((p) => p.tickets.forEach((t) => m.set(t.id, t))); return [...m.values()] }
const perWeek = (tickets) => Array.from({ length: WEEKS }, (_, w) => tickets.filter((t) => t.week === w).length)
function stats(weekly) {
  if (weekly.length === 0) return undefined
  const s = [...weekly].sort((a, b) => a - b), m = s.length >> 1
  return { median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, lo: s[0], hi: s[s.length - 1], weeks: weekly.length }
}
const said = (st) => st ? fmt(st.median) + ' a week (' + (st.lo === st.hi ? st.lo : st.lo + '–' + st.hi) + ')' : '–'

// Everything the step knows, worked out once per render.
function facts() {
  const sc = SCENES[state.scene]
  const ownAll = perWeek(sc.tickets)
  const ownSince = ownAll.slice(sc.start)
  const own = stats(ownSince)
  const ownComparable = own && own.weeks >= 3
  const compTickets = union(state.picks)
  const compWeekly = perWeek(compTickets)
  const comp = compTickets.length ? stats(compWeekly) : undefined
  const flagged = state.picks.length > 0 && compTickets.length === 0
  const use = comp ? 'comparable' : 'own'
  return { sc, ownAll, ownSince, own, ownComparable, compTickets, compWeekly, comp, flagged, use,
    inUse: comp ?? own }
}
// How a pace compares with the milestone's own: both directions.
function versus(st, f) {
  if (!st) return { dir: 'none', short: '–', long: '' }
  if (!f.ownComparable) return { dir: 'none', short: '–', long: 'The milestone has ' + f.own.weeks + ' week' + (f.own.weeks === 1 ? '' : 's') + ' of its own so far: too few to compare.' }
  const d = st.median - f.own.median
  if (Math.abs(d) < 0.5) return { dir: 'same', short: '≈ same', long: 'About the same as the milestone’s own so far (' + fmt(f.own.median) + ' a week).' }
  const dir = d > 0 ? 'faster' : 'slower'
  return { dir, short: (d > 0 ? '+' : '−') + fmt(Math.abs(d)) + ' ' + dir,
    long: fmt(Math.abs(d)) + ' a week ' + dir + ' than the milestone’s own so far (' + fmt(f.own.median) + ' a week).' }
}
const vs = (st, f) => { const v = versus(st, f); return '<span class="' + v.dir + '">' + v.short + '</span>' }
function lastFinished(tickets) {
  if (!tickets.length) return 'none finished'
  const ago = WEEKS - 1 - Math.max(...tickets.map((t) => t.week))
  return ago === 0 ? 'last finished this week' : 'last finished ' + ago + (ago === 1 ? ' week' : ' weeks') + ' ago'
}
function strip(weekly, cls = '', h = 16) {
  const top = Math.max(1, ...weekly)
  return '<span class="strip" style="height:' + h + 'px">' + weekly.map((n, i) => '<i class="' + cls + '" title="' + weekLabel(i) + ': ' + n + '" style="width:3px;height:' + (n / top) * h + 'px"></i>').join('') + '</span>'
}
function candidatesLeft(f) { return CHOICES.filter((c) => !state.picks.includes(c)) }
const isOwn = (c, f) => c.query === f.sc.query
const ownTag = (c, f) => isOwn(c, f) ? ' <span class="kind">this milestone: counts its own too</span>' : ''
function addsCount(c) { const have = new Set(union(state.picks).map((t) => t.id)); return c.tickets.filter((t) => !have.has(t.id)).length }

// Shared parts: the step's head, chips, query and read line, flag, button.
function head(f) {
  return '<div class="label"><span class="number">03</span><h2>Comparable work</h2><p>Optional. Recent work like this milestone’s: once added, pace is measured from it instead of the milestone’s own. Pick this milestone too to count its own tickets.</p></div>'
}
function chips(f) {
  if (!state.picks.length) return '<p class="muted">Nothing picked yet.</p>'
  const ids = (ps) => new Set(union(ps).map((t) => t.id))
  return '<ul class="chips">' + state.picks.map((p, i) => {
    const others = ids(state.picks.filter((q) => q !== p))
    const only = p.tickets.filter((t) => !others.has(t.id)).length
    return '<li class="chip">' + esc(p.name) + ' <span class="kind">' + p.kind + '</span> ' + strip(perWeek(p.tickets), 'c', 12) +
      ' <span class="kind">' + p.tickets.length + ' finished' + (state.picks.length > 1 ? ', +' + only + ' only here' : '') + '</span><button data-act="remove" data-i="' + i + '" aria-label="Remove">×</button></li>'
  }).join('') + '</ul>'
}
function queryAndRead(f) {
  return '<p><span class="label">Comparable-work query</span> ' + (state.picks.length ? '<code>' + esc(state.picks.map((p) => p.query).join(' OR ')) + '</code>' : '<span class="muted">None: pace comes from the milestone’s own tickets.</span>') + '</p>' +
    (state.picks.length ? '<p class="read">' + f.compTickets.length + ' finished in the last 8 weeks</p>' : '') +
    (f.flagged ? '<div class="flag">This query matches nothing finished in the last 8 weeks, so pace comes from the milestone’s own tickets. Check it picks out work like the milestone’s.</div>' : '')
}
const button = () => '<div class="actions"><button class="primary">' + (state.picks.length ? 'Next' : 'Skip') + '</button></div>'
const addBtn = (c) => '<button class="add" data-act="pick" data-q="' + esc(c.query) + '">+ ' + esc(c.name) + '</button> <span class="kind">' + c.kind + '</span>'

// A: two bar charts on one scale.
function panel(title, weekly, preStart, st, inUse, cls, top) {
  const bars = weekly.map((n, i) => {
    const pre = i < preStart
    return '<div class="wk" title="' + weekLabel(i) + ': ' + (pre ? 'before the milestone started' : n) + '"><b>' + (pre ? '' : n) + '</b>' +
      '<i class="' + (pre ? 'pre' : cls) + '" style="height:' + (pre ? 6 : (n / top) * 70) + 'px"></i><span>' + weekLabel(i) + '</span></div>'
  }).join('')
  return '<div class="panel' + (inUse ? ' use' : '') + '"><h3>' + title + (inUse ? '<span class="inuse">pace in use</span>' : '') + '</h3>' +
    '<div class="bars">' + bars + '</div><p class="pace-line">' + (st ? 'Median <b>' + said(st) + '</b>' + (preStart ? ' <span class="muted">over ' + st.weeks + ' weeks since it started</span>' : '') : '<span class="muted">Nothing picked.</span>') + '</p></div>'
}
function variantA(f) {
  const top = Math.max(1, ...f.compWeekly, ...f.ownAll)
  const compPanel = state.picks.length ? panel('Comparable work', f.compWeekly, 0, f.comp, f.use === 'comparable', 'c', top) : ''
  const ownPanel = panel('The milestone’s own so far', f.ownAll, f.sc.start, f.own, f.use === 'own', 'o', top)
  const verdict = f.comp ? '<p class="verdict">Comparable work: ' + versus(f.comp, f).long.replace(/^./, (c) => c.toLowerCase()) + '</p>' : ''
  const rows = candidatesLeft(f).map((c) => {
    const st = c.tickets.length ? stats(perWeek(c.tickets)) : undefined
    return '<tr><td>' + addBtn(c) + ownTag(c, f) + '</td><td>' + strip(perWeek(c.tickets), 'c') + '</td><td class="num">' + (st ? fmt(st.median) : '–') + '</td><td class="num">' + vs(st, f) +
      '</td><td class="num">' + c.tickets.length + '</td><td class="num">' + (state.picks.length ? '+' + addsCount(c) : '') + '</td><td class="muted">' + lastFinished(c.tickets) + (c.open ? ' · ' + c.open + ' open' : '') + '</td></tr>'
  }).join('')
  return chips(f) + queryAndRead(f) + '<div class="sbs">' + compPanel + ownPanel + '</div>' + verdict +
    '<details open><summary>Add comparable work</summary><table class="t"><thead><tr><th>Candidate</th><th>8 weeks</th><th>Median a week</th><th>vs the milestone’s own</th><th>Finished</th><th>' + (state.picks.length ? 'Adds' : '') + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></details>'
}

// B: one shared axis for every pace.
function variantB(f) {
  const all = [f.comp, f.own, ...CHOICES.map((c) => c.tickets.length ? stats(perWeek(c.tickets)) : undefined)].filter(Boolean)
  const max = Math.max(8, ...all.map((s) => s.hi))
  const pct = (v) => (v / max) * 100 + '%'
  const ref = f.ownComparable ? '<span class="ref" style="left:' + pct(f.own.median) + '" title="the milestone’s own median"></span>' : ''
  const track = (st, cls = '') => '<div class="track">' + ref + (st ? '<span class="rng" style="left:' + pct(st.lo) + ';width:calc(' + pct(st.hi) + ' - ' + pct(st.lo) + ')"></span><span class="med ' + cls + '" style="left:' + pct(st.median) + '"></span>' : '') + '</div>'
  const ticks = '<div class="track">' + [0, 2, 4, 6, 8, 10].filter((v) => v <= max).map((v) => '<span class="tick" style="left:' + pct(v) + '">' + v + '</span>').join('') + '</div>'
  const row = (label, st, cls, right, extra = '') => '<div class="row' + extra + '"><div>' + label + '</div>' + track(st, cls) + '<div class="num">' + right + '</div></div>'
  const rows = [
    '<div class="row head"><div>finished a week · <span class="slower">← slower</span> than the milestone · <span class="faster">faster →</span></div>' + ticks + '<div>median</div></div>',
    state.picks.length ? row('Comparable work' + (f.use === 'comparable' ? '<span class="inuse">pace in use</span>' : ''), f.comp, 'c', f.comp ? fmt(f.comp.median) + ' ' + vs(f.comp, f) : '–', f.use === 'comparable' ? ' use' : '') : '',
    row('The milestone’s own so far' + (f.use === 'own' ? '<span class="inuse">pace in use</span>' : '') + '<br><span class="muted">' + f.own.weeks + ' weeks since it started' + (f.ownComparable ? '' : ': too few to compare') + '</span>', f.own, '', fmt(f.own.median), f.use === 'own' ? ' use' : ''),
    state.picks.length ? '<div class="row sep"><div>Picked</div><div></div><div></div></div>' : '',
    ...state.picks.map((p, i) => { const st = p.tickets.length ? stats(perWeek(p.tickets)) : undefined
      return row(esc(p.name) + ' <span class="kind">' + p.kind + '</span> <button class="rm" data-act="remove" data-i="' + i + '" aria-label="Remove">×</button>', st, 'c', st ? fmt(st.median) + ' ' + vs(st, f) : 'none finished') }),
    '<div class="row sep"><div>Candidates</div><div></div><div></div></div>',
    ...candidatesLeft(f).map((c) => { const st = c.tickets.length ? stats(perWeek(c.tickets)) : undefined
      return row(addBtn(c) + ownTag(c, f), st, 'c', st ? fmt(st.median) + ' ' + vs(st, f) : '<span class="muted">none finished</span>') }),
  ]
  return chips(f) + queryAndRead(f) + '<div class="scale">' + rows.join('') + '</div>' +
    '<p class="muted">Each line runs from the slowest week to the fastest in the last 8; the dot is the median. The dashed line is the milestone’s own median.</p>'
}

// C: the difference as the headline.
function variantC(f) {
  const v = versus(f.inUse, f)
  const arrow = v.dir === 'faster' ? '↑ ' : v.dir === 'slower' ? '↓ ' : ''
  const headline = '<p class="headline">' + fmt(f.inUse.median) + ' a week <small>pace, from ' + (f.use === 'comparable' ? 'comparable work' : 'the milestone’s own tickets') + ' · range ' + f.inUse.lo + '–' + f.inUse.hi + '</small></p>' +
    (f.use === 'comparable' ? '<p class="delta ' + v.dir + '">' + arrow + v.long + '</p>' : '<p class="delta muted">Add comparable work to measure pace from work like this milestone’s.</p>')
  const top = Math.max(1, ...f.compWeekly, ...f.ownAll)
  const pairs = '<div class="pairs">' + f.ownAll.map((n, i) => {
    const pre = i < f.sc.start
    return '<div class="wk"><div class="two">' + (state.picks.length ? '<i class="c" title="comparable ' + f.compWeekly[i] + '" style="height:' + (f.compWeekly[i] / top) * 80 + 'px"></i>' : '') +
      '<i class="' + (pre ? 'pre' : 'o') + '" title="' + (pre ? 'before the milestone started' : 'own ' + n) + '" style="height:' + (pre ? 6 : (n / top) * 80) + 'px"></i></div><span>' + weekLabel(i) + '</span></div>'
  }).join('') + '</div><p class="legend">' + (state.picks.length ? '<i class="c"></i> comparable work' : '') + '<i class="o"></i> the milestone’s own <i class="pre"></i> before it started</p>'
  const groups = { slower: [], same: [], faster: [], none: [] }
  candidatesLeft(f).forEach((c) => { const st = c.tickets.length ? stats(perWeek(c.tickets)) : undefined; groups[versus(st, f).dir].push({ c, st }) })
  Object.values(groups).forEach((g) => g.sort((a, b) => (a.st?.median ?? -1) - (b.st?.median ?? -1)))
  const li = ({ c, st }) => '<li>' + addBtn(c) + ' ' + strip(perWeek(c.tickets), 'c', 12) + ' <span class="num">' + (st ? fmt(st.median) + ' a week ' + vs(st, f) : '<span class="muted">none finished</span>') + '</span>' + ownTag(c, f) + '</li>'
  const col = (title, g) => g.length ? '<div><h4>' + title + '</h4><ul>' + g.map(li).join('') + '</ul></div>' : ''
  const cands = f.ownComparable
    ? '<div class="groups">' + col('<span class="slower">Slower than the milestone</span>', groups.slower) + col('About the same', groups.same) + col('<span class="faster">Faster than the milestone</span>', groups.faster) + col('Nothing finished', groups.none) + '</div>'
    : '<p class="muted">The milestone has too few weeks of its own to compare; candidates by pace:</p><div class="groups">' + col('By median a week', [...groups.none].filter((x) => x.st)) + col('Nothing finished', groups.none.filter((x) => !x.st)) + '</div>'
  return headline + pairs + chips(f) + queryAndRead(f) + '<details open><summary>Add comparable work</summary>' + cands + '</details>'
}

function render() {
  const f = facts()
  const sceneBtns = Object.entries(SCENES).map(([k, s]) => '<button data-act="scene" data-scene="' + k + '" aria-pressed="' + (state.scene === k) + '">' + esc(s.name) + ': ' + s.about + '</button>').join('')
  const body = variant === 'A' ? variantA(f) : variant === 'B' ? variantB(f) : variantC(f)
  document.getElementById('proto').innerHTML =
    '<div class="proto-banner">PROTOTYPE · variant ' + variant + ': ' + VARIANTS[variant] + ' · scene: ' + sceneBtns + ' · reload to reset</div>' +
    '<section class="input" id="milestone-tickets"><div class="label"><span class="number">02</span><h2>Milestone’s tickets</h2></div><div class="body">' +
    '<p><span class="label">Milestone query</span> <code>' + esc(f.sc.query) + '</code></p><p class="read">' + f.sc.open + ' open · ' + f.sc.tickets.length + ' finished since it started ' + weekLabel(f.sc.start) + '</p></div></section>' +
    '<section class="input" id="comparable-work">' + head(f) + '<div class="body">' + body + button() + '</div></section>' +
    '<pre class="state">state = ' + esc(JSON.stringify({
      scene: f.sc.name, milestoneQuery: f.sc.query,
      comparableWorkQuery: state.picks.map((p) => p.query).join(' OR '),
      paceInUse: f.use === 'comparable' ? 'comparable work alone' : 'the milestone’s own',
      pace: f.inUse && said(f.inUse), comparableWork: said(f.comp), milestoneOwnSoFar: said(f.own) + ' over ' + f.own.weeks + ' weeks',
      versus: versus(f.comp, f).long || '–', flagged: f.flagged,
    }, null, 2)) + '</pre>'
  document.querySelector('.switcher-label').textContent = variant + ' (' + VARIANTS[variant] + ')'
}

function cycle(step) { const i = KEYS.indexOf(variant); variant = KEYS[(i + step + KEYS.length) % KEYS.length]
  const url = new URL(location.href); url.searchParams.set('variant', variant); history.replaceState(null, '', url) }
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return
  e.preventDefault()
  const act = t.dataset.act
  if (act === 'pick') state.picks.push(byQuery(t.dataset.q))
  if (act === 'remove') state.picks.splice(Number(t.dataset.i), 1)
  if (act === 'scene') state = fresh(t.dataset.scene)
  if (act === 'prev') cycle(-1)
  if (act === 'next') cycle(1)
  render()
})
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]')) return
  if (e.key === 'ArrowLeft') { cycle(-1); render() }
  if (e.key === 'ArrowRight') { cycle(1); render() }
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
console.log(`Wrote ${path}\nVariants: ?variant=A|B|C`)
if (!process.argv.includes('--no-open')) spawn('open', [path], { stdio: 'ignore', detached: true }).unref()
