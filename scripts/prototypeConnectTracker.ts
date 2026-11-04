// PROTOTYPE, throwaway: never merge. Wayfinder ticket "Connecting a tracker and picking the milestone's tickets"
// (https://github.com/random11235/forecaster-next-gen/issues/136).
//
// Three variants of connecting a tracker and choosing the milestone's tickets, from no connection to a milestone
// with inputs proposed from the tracker, switchable via `?variant=A|B|C`; `?scenario=` picks the canned starting state.
// A canned repo (shop-team/shop, or Jira project SHOP) answers the queries, so picking, hand-edited queries, the
// comparable-work query and the flags (cap, no matches, outside the scope, rejected, bad token) all work. All state
// is in memory; reload to reset. Run: `npm run prototype:connect` (builds, writes dist/prototype/connect-tracker.html, opens it).
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { htmlPage }: typeof import('../src/app/html.js') = await import(new URL('../dist/app/html.js', import.meta.url).href)

const out = new URL('../dist/prototype/connect-tracker.html', import.meta.url)

const STYLE = `
  <style>
    .proto-banner { font-size: 12px; color: var(--risk); font-family: var(--mono); }
    .linkish { border: 0; background: none; padding: 0; min-height: 0; color: var(--link); text-decoration: underline; cursor: pointer; font-size: 13px; }
    .dmark { font-size: 12px; color: var(--faint); }
    .muted { color: var(--muted); font-size: 13px; }
    .row { display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: center; }
    .col { display: flex; flex-direction: column; gap: 10px; }
    .qbox { display: flex; align-items: stretch; border: 1px solid var(--border); border-radius: 6px; background: #fff; overflow: hidden; width: 100%; max-width: 640px; }
    .qbox:focus-within { border-color: var(--ink); }
    .qbox .scope { font-family: var(--mono); font-size: 12px; color: var(--faint); background: var(--sidebar); padding: 0 8px; display: flex; align-items: center; white-space: nowrap; border-right: 1px solid var(--hairline); }
    .qbox input { border: 0 !important; flex: 1; font-family: var(--mono); font-size: 13px; min-width: 0; padding: 8px; background: transparent; }
    .qline { font-family: var(--mono); font-size: 12px; color: var(--muted); }
    .flag { font-size: 13px; padding: 6px 10px; border-radius: 4px; max-width: 640px; line-height: 1.45; }
    .flag.bad { background: #FBF1EC; color: var(--risk); border-left: 3px solid var(--risk); }
    .flag.warn { background: #FBF6E8; color: #7A4A12; border-left: 3px solid #C9A66B; }
    .flag.ok { color: var(--good); padding-left: 0; }
    .dseg { display: inline-flex; border: 1px solid var(--hairline); border-radius: 6px; overflow: hidden; align-self: flex-start; }
    .dseg button { border: 0; border-radius: 0; background: transparent; min-height: 28px; padding: 0 12px; font-size: 13px; color: var(--muted); }
    .dseg button + button { border-left: 1px solid var(--hairline); }
    .dseg button.on { background: var(--ink); color: var(--page); }
    .dbig { font-size: 30px; font-variant-numeric: tabular-nums; }
    .dgraph { display: inline-flex; gap: 4px; align-items: flex-end; vertical-align: middle; }
    .dgraph .c { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 18px; }
    .dgraph .bar { width: 14px; background: var(--bar); border-radius: 2px 2px 0 0; }
    .dgraph .bar.cmp { background: var(--bar-light); }
    .dgraph .v { font-size: 10px; color: var(--faint); line-height: 12px; }
    .key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 3px; }
    select.pick { font: inherit; font-size: 14px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
    .conn { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 14px; }
    .conn b { font-family: var(--mono); font-weight: 500; }
    .ok-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); display: inline-block; }
    .chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--border); border-radius: 999px; padding: 2px 4px 2px 10px; font-size: 13px; background: #fff; }
    .chip .x { border: 0; background: none; min-height: 0; padding: 0 6px; font-size: 15px; line-height: 1; color: var(--muted); cursor: pointer; }
    input.find { font-size: 14px; padding: 7px 10px; }
    .found { display: flex; flex-direction: column; }
    .found button { text-align: left; border: 0; background: none; min-height: 30px; font-size: 13px; padding: 0 8px; border-radius: 4px; }
    .found button:hover { background: var(--active); }
    .checks { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
    .checks label { display: flex; gap: 8px; align-items: center; }
    /* B: setup steps */
    .wizard { display: grid; grid-template-columns: 200px 1fr; gap: 28px; border: 1px solid var(--border); border-radius: 10px; padding: 22px; background: #fff; }
    .wizard ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .wizard li { font-size: 14px; padding: 6px 10px; border-radius: 6px; color: var(--faint); }
    .wizard li.done { color: var(--muted); cursor: pointer; }
    .wizard li.done::before { content: '✓ '; color: var(--good); }
    .wizard li.on { background: var(--active); color: var(--ink); font-weight: 600; }
    .wizard h2 { margin: 0; font-size: 20px; }
    .wizard .actions { gap: 10px; align-items: center; margin-top: 6px; }
    .wizard .actions .linkish { margin-right: auto; }
    .wizard li.done:hover { background: var(--active); }
    .qmode { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
    .qmode .qline { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .sumgrid { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 8px 16px; align-items: baseline; border: 1px solid var(--hairline); border-radius: 8px; padding: 12px 16px; font-size: 14px; background: #fff; margin-bottom: 18px; }
    .sumgrid .qline { overflow-wrap: anywhere; }
    .sumgrid .hdr { grid-column: 1 / -1; display: flex; gap: 10px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--hairline); }
    .sumgrid .hdr .end { margin-left: auto; display: flex; gap: 12px; align-items: center; }
    .choice { display: flex; gap: 12px; align-items: center; justify-content: space-between; border: 1px solid var(--hairline); border-radius: 8px; padding: 10px 14px; cursor: pointer; max-width: 640px; }
    .choice:has(input:checked) { border-color: var(--ink); background: var(--page); }
    .choice .nm { font-weight: 600; }
    table.check { border-collapse: collapse; font-size: 14px; }
    table.check th { text-align: left; font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; padding: 0 18px 6px 0; border-bottom: 1px solid var(--ink); }
    table.check td { padding: 10px 18px 10px 0; border-bottom: 1px solid var(--hairline); vertical-align: middle; }
    .summary { display: flex; gap: 10px 16px; flex-wrap: wrap; align-items: center; border: 1px solid var(--hairline); border-radius: 8px; padding: 10px 14px; font-size: 14px; }
    /* C: workbench */
    .cbar { display: flex; gap: 12px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--ink); padding-bottom: 10px; }
    .qrow { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; border-bottom: 1px solid var(--hairline); padding: 16px 0; }
    .qrow h3 { margin: 0 0 6px; font-size: 15px; }
    .res { border-left: 1px solid var(--hairline); padding-left: 16px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .res .n { font-size: 22px; font-variant-numeric: tabular-nums; }
    .menu { position: relative; display: inline-block; }
    .menu > summary { list-style: none; cursor: pointer; font-size: 13px; border: 1px solid var(--border); border-radius: 6px; padding: 5px 10px; }
    .menu > summary::-webkit-details-marker { display: none; }
    .menu .list { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; min-width: 260px; background: #fff; border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12); padding: 6px; display: flex; flex-direction: column; }
    .menu .list button { text-align: left; border: 0; background: none; min-height: 30px; font-size: 13px; padding: 0 8px; border-radius: 4px; }
    .menu .list button:hover { background: var(--active); }
    .menu .list .hd { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; padding: 6px 8px 2px; }
    .gives { background: var(--sidebar); border-radius: 8px; padding: 14px 18px; display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-end; }
    .switcher { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 10; display: flex; gap: 10px; align-items: center;
      background: #111; color: #fff; padding: 8px 12px; border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.3); font-size: 13px; }
    .switcher button { color: #fff; border-color: #444; min-height: 28px; background: transparent; }
    .switcher select { font: inherit; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; padding: 3px 6px; }
    details.state { font-size: 12px; margin-bottom: 70px; }
    details.state pre { background: var(--sidebar); padding: 12px; border-radius: 6px; overflow: auto; font-family: var(--mono); font-size: 11px; }
  </style>`

const MAIN = `${STYLE}
    <p class="proto-banner">PROTOTYPE · canned repo · nothing is saved · reload resets · try the token "bad", repo "shop-team/shopp", or edit a query by hand</p>
    <div id="proto"></div>
    <details class="state"><summary>State (what would be stored)</summary><pre id="state"></pre></details>
    <div class="switcher" id="switcher"></div>`

const SCRIPT = String.raw`
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const wk = (iso) => { const [, m, d] = iso.split('-').map(Number); return d + ' ' + MONTHS[m - 1] }
const WEEKS = ['2026-09-07','2026-09-14','2026-09-21','2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26']
const READ_AT = '4 Nov 09:12'
// The canned repo, as groups of tickets: milestone, labels, open now, finished in each of the last 8 weeks.
const GROUPS = [
  { ms: 'Checkout v2', epic: 41, labels: ['checkout'], open: 31, wk: [3, 4, 5, 3, 4, 2, 0, 1] },
  { ms: 'Checkout v2', epic: 41, labels: ['checkout', 'bug'], open: 7, wk: [1, 1, 2, 1, 1, 1, 0, 0] },
  { ms: 'Search revamp', epic: 57, labels: ['search'], open: 12, wk: [2, 3, 1, 2, 3, 2, 1, 0] },
  { ms: 'Q3 polish', labels: ['checkout'], open: 0, wk: [4, 3, 4, 3, 2, 0, 0, 0] },
  { ms: null, labels: ['ktlo'], open: 22, wk: [1, 2, 1, 2, 1, 3, 4, 3] },
  { ms: null, labels: ['bug'], open: 1180, wk: [6, 5, 7, 6, 5, 6, 4, 5] },
]
const MILESTONES = ['Checkout v2', 'Search revamp', 'Q3 polish', 'Payments v1']
const EPICS = { 41: 'Checkout v2', 57: 'Search revamp', 63: 'Payments v1' } // GitHub: parent issues with sub-issues; Jira: epic issues
// ...and many more epics with nothing in the window, as a big project would have
;['Checkout analytics', 'Checkout A/B tests', 'Guest checkout', 'Saved cards', 'Search filters', 'Search ranking', 'Search suggestions', 'Payments retries', 'Refunds', 'Gift cards',
  'Wishlist', 'Order history', 'Returns portal', 'Delivery slots', 'Address book', 'Promo codes', 'Loyalty points', 'Mobile web nav', 'Accessibility audit', 'Cookie banner',
  'Checkout v1 sunset', 'Basket redesign', 'Search infra upgrade', 'Payments PCI review'].forEach((t, i) => { EPICS[100 + i * 7] = t })
const LABELS = ['checkout', 'search', 'ktlo', 'bug', 'payments']
// milestoneChoices(): ids 'm:<milestone or fix version>', 'e:<epic number>', 'l:<label>', grouped for the picker
const CHOICES = MILESTONES.map((n) => 'm:' + n).concat(Object.keys(EPICS).map((n) => 'e:' + n), LABELS.map((l) => 'l:' + l))
function choiceGroups(tr) {
  const of = (k) => CHOICES.filter((c) => c[0] === k)
  return tr === 'jira' ? [['Fix versions', of('m')], ['Epics', of('e')], ['Labels', of('l')]] : [['Epics (parent issues)', of('e')], ['Labels', of('l')], ['Milestones', of('m')]]
}
function choiceName(tr, id) { const v = id.slice(2); return id[0] === 'e' ? (tr === 'jira' ? PROJECT + '-' : '#') + v + ' ' + EPICS[v] : id[0] === 'l' ? 'label ' + v : v }
const REPO = 'shop-team/shop', SITE = 'shop.atlassian.net', PROJECT = 'SHOP'
const sum = (a) => a.reduce((x, y) => x + y, 0)

// ---- the canned tracker: a query is ORed clauses of ANDed terms ----
function choiceQuery(tr, id) {
  if (!/^[mel]:/.test(id)) id = 'm:' + id
  const v = id.slice(2), j = tr === 'jira'
  if (id[0] === 'e') return j ? 'parent = ' + PROJECT + '-' + v : 'parent-issue:' + REPO + '#' + v
  if (id[0] === 'l') return j ? 'labels = ' + v : 'label:' + v
  return j ? 'fixVersion = "' + v + '"' : 'milestone:"' + v + '"'
}
const unq = (s) => s.replace(/^"|"$/g, '')
function parse(tr, q) {
  q = q.trim()
  if (!q) return { clauses: [[]] }
  if ((q.match(/"/g) || []).length % 2) return tr === 'jira' ? { fail: 'invalid', msg: 'Error in the JQL Query: The quoted string has not been completed.' } : { fail: 'invalid', msg: 'The search query has an unmatched quote.' }
  const clauses = []
  for (const clause of q.split(tr === 'jira' ? /\s+OR\s+/i : /\s+OR\s+/)) {
    const preds = []
    const toks = tr === 'jira' ? clause.split(/\s+AND\s+/i) : (clause.match(/(?:[^\s"]+|"[^"]*")+/g) || [])
    for (const tok of toks) {
      if (tr === 'jira') {
        const m = /^\(?\s*(\w+)\s*(!=|=|in)\s*(.+?)\s*\)?$/i.exec(tok.trim())
        if (!m) return { fail: 'invalid', msg: 'Error in the JQL Query: Expecting operator but got \'' + tok.trim().split(/\s+/)[1] + '\'.' }
        const [, f, op, raw] = m, v = unq(raw), not = op === '!='
        const fl = f.toLowerCase()
        if (fl === 'project') { if (v.toUpperCase() !== PROJECT) return { fail: 'outOfScope', msg: 'project = ' + v }; continue }
        if (fl === 'parent') { const [pk, num] = v.split('-'); if (pk.toUpperCase() !== PROJECT) return { fail: 'outOfScope', msg: 'parent = ' + v }; preds.push((g) => (g.epic === Number(num)) !== not); continue }
        if (fl === 'fixversion') { preds.push((g) => (g.ms === v) !== not); continue }
        if (fl === 'labels') { preds.push((g) => g.labels.includes(v) !== not); continue }
        if (fl === 'issuetype' || fl === 'statuscategory') continue
        return { fail: 'invalid', msg: 'Field \'' + f + '\' does not exist or you do not have permission to view it.' }
      }
      const m = /^(-?)([a-z-]+):(.*)$/.exec(tok)
      if (!m) return { fail: 'invalid', msg: tok + ' is free text, which searches titles. This tool reads only qualifiers, such as label:, milestone: or parent-issue:.', ours: true }
      const [, neg, k, raw] = m, v = unq(raw), not = neg === '-'
      if (!v) return { fail: 'invalid', msg: 'The ' + k + ': qualifier needs a value.' }
      if (['repo', 'org', 'user'].includes(k)) { if (k === 'repo' && v === REPO) continue; return { fail: 'outOfScope', msg: k + ':' + v } }
      if (k === 'milestone') { preds.push((g) => (g.ms === v) !== not); continue }
      if (k === 'parent-issue') { const [rp, num] = v.split('#'); if (rp !== REPO) return { fail: 'outOfScope', msg: k + ':' + v }; preds.push((g) => (g.epic === Number(num)) !== not); continue }
      if (k === 'label') { preds.push((g) => g.labels.includes(v) !== not); continue }
      if (k === 'no' && v === 'milestone') { preds.push((g) => !g.ms); continue }
      if (k === 'is' || k === 'type') continue
      return { fail: 'invalid', msg: 'The search query contains an unknown qualifier: ' + k + ':' }
    }
    clauses.push(preds)
  }
  return { clauses }
}
// read(query): the open tickets and those finished in the window, or a failure
function read(tr, q) {
  const p = parse(tr, q)
  if (p.fail) return { ok: false, ...p }
  const set = GROUPS.map((g, i) => p.clauses.some((preds) => preds.every((f) => f(g))) ? i : -1).filter((i) => i >= 0)
  return measure(set)
}
function measure(set) {
  const open = sum(set.map((i) => GROUPS[i].open)), w = WEEKS.map((_, j) => sum(set.map((i) => GROUPS[i].wk[j])))
  const total = open + sum(w)
  return { ok: true, set, open, wk: w, finished: sum(w), total, incomplete: total > 1000 }
}

// ---- state ----
const SCENARIOS = {
  none: { name: 'No tracker connected', make: () => base({}) },
  badToken: { name: 'Connect fails: the token is refused', make: () => base({ draft: { tracker: 'github', where: REPO, token: 'bad' }, connError: 'unauthorised' }) },
  connected: { name: 'Connected, no milestone picked', make: () => base({ conn: gh(), step: 2 }) },
  picked: { name: 'Milestone picked', make: () => picked(base({ conn: gh(), mq: choiceQuery('github', 'Checkout v2') })) },
  epic: { name: 'Two epics picked', make: () => picked(base({ conn: gh(), mq: choiceQuery('github', 'e:41') + ' OR ' + choiceQuery('github', 'e:57'), cq: choiceQuery('github', 'Q3 polish') })) },
  jiraEpic: { name: 'Jira, epic picked', make: () => picked(base({ conn: { tracker: 'jira', site: SITE, project: PROJECT }, mq: choiceQuery('jira', 'e:41') })) },
  comparable: { name: 'With comparable work', make: () => picked(base({ conn: gh(), mq: choiceQuery('github', 'Checkout v2'), cq: 'milestone:"Q3 polish"' })) },
  cap: { name: 'Comparable work hits the 1,000 cap', make: () => picked(base({ conn: gh(), mq: choiceQuery('github', 'Checkout v2'), cq: 'label:bug' })) },
  nothing: { name: 'Milestone query matches nothing', make: () => picked(base({ conn: gh(), mq: choiceQuery('github', 'Payments v1') })) },
  scope: { name: 'Query reaches outside the repo', make: () => picked(base({ conn: gh(), mq: choiceQuery('github', 'Checkout v2') }), 'milestone:"Checkout v2" repo:shop-team/payments') },
  invalid: { name: 'Query rejected by the tracker', make: () => picked(base({ conn: gh(), mq: choiceQuery('github', 'Checkout v2') }), 'milestone:"Checkout v2') },
  jira: { name: 'Jira, milestone picked', make: () => picked(base({ conn: { tracker: 'jira', site: SITE, project: PROJECT }, mq: choiceQuery('jira', 'Checkout v2') })) },
}
function gh() { return { tracker: 'github', repo: REPO } }
function base(o) {
  return { conn: null, draft: { tracker: 'github', where: '', token: '' }, connError: null, mq: '', cq: '', reads: {}, lastGood: {}, step: 1, setupDone: false,
    inputs: { name: 'Checkout v2', start: '2026-09-01', tickets: 30, ticketsSrc: 'typed', range: [4, 8], paceSrc: 'range' }, ...o }
}
// a query read, then (optionally) the EM's later edit to it
function picked(s, edited) { const st = s; state = st; doRead('mq', true); if (st.cq) doRead('cq'); st.step = 4; st.setupDone = true; if (edited) { st.mq = edited; doRead('mq') } return st }

const VARIANTS = { A: 'A section on Inputs', B: 'Setup steps', C: 'Query workbench' }
const params = new URLSearchParams(location.search)
let variant = VARIANTS[params.get('variant')] ? params.get('variant') : 'A'
let scenario = SCENARIOS[params.get('scenario')] ? params.get('scenario') : 'none'
let state = null
state = SCENARIOS[scenario].make()
let ui = {}
const log = []
const tr = () => state.conn ? state.conn.tracker : state.draft.tracker
const scopeText = () => !state.conn ? '' : state.conn.tracker === 'jira' ? 'project = ' + PROJECT + ' AND' : 'repo:' + REPO
const where = () => state.conn.tracker === 'jira' ? state.conn.site + ' · ' + state.conn.project : state.conn.repo

// ---- actions ----
function act(name, fn) { fn(); log.push(name); render() }
function setDraft(k, v) { state.draft[k] = v; if (k === 'tracker') render() }
function connect() { act('connect', () => {
  const d = state.draft
  if (!d.token) { state.connError = 'noToken'; return }
  if (d.token === 'bad') { state.connError = 'unauthorised'; return }
  const ok = d.tracker === 'jira' ? /shop/i.test(d.where) : d.where.trim() === REPO
  if (!ok) { state.connError = 'notFound'; return }
  state.connError = null
  state.conn = d.tracker === 'jira' ? { tracker: 'jira', site: SITE, project: PROJECT } : gh()
  state.step = 2; ui.changeConn = false
}) }
function disconnect() { act('disconnect', () => {
  const r = state.reads.mq
  if (state.inputs.ticketsSrc === 'github' && r && r.ok) state.inputs.tickets = r.open
  state.inputs.ticketsSrc = 'typed'; if (state.inputs.paceSrc === 'github') state.inputs.paceSrc = 'range'
  state.conn = null; state.mq = ''; state.cq = ''; state.reads = {}; state.lastGood = {}; state.step = 1; state.setupDone = false
}) }
function doRead(which, first) {
  const q = state[which]
  if (which === 'cq' && !q.trim()) { delete state.reads.cq; return }
  const r = read(state.conn.tracker, q)
  state.reads[which] = r
  if (r.ok) state.lastGood[which] = { q, r }
  if (which === 'mq' && r.ok && (first || !state.followSet)) { state.inputs.ticketsSrc = 'github'; state.inputs.paceSrc = 'github'; state.followSet = true }
}
function pick(name) { act('pick ' + name, () => { state.mq = choiceQuery(state.conn.tracker, name); doRead('mq'); ui.editMq = false }) }
function setQuery(which, q) { act('edit ' + (which === 'mq' ? 'milestone' : 'comparable-work') + ' query', () => { state[which] = q; doRead(which) }) }
// a query the picker wrote is its choices joined with OR, so several epics (or an epic and a label) make one milestone
function togglePick(which, id, on) { act((on ? 'add ' : 'remove ') + id + (which === 'mq' ? ' to the milestone' : ' to comparable work'), () => {
  const ids = (picks(which) || []).filter((n) => n !== id).concat(on ? [id] : [])
  state[which] = ids.map((n) => choiceQuery(state.conn.tracker, n)).join(' OR '); doRead(which); ui.editMq = false
}) }
function toggleComparable(id, on) { togglePick('cq', id, on) }
function picks(which) {
  const q = state[which].trim(); if (!q) return []
  const terms = q.split(' OR '), ids = terms.map((t) => CHOICES.find((n) => choiceQuery(state.conn.tracker, n) === t))
  return ids.every(Boolean) ? ids : null
}
function comparablePicked() { return picks('cq') || [] }
const cqIsPicker = () => !!picks('cq')
const grouped = (skip, item) => choiceGroups(tr()).map(([g, ids]) => '<span class="dmark" style="margin-top:6px">' + g + '</span>' + ids.filter((n) => !(skip || []).includes(n)).map(item).join('')).join('')
const kindOf = (id) => id[0] === 'e' ? 'epic' : id[0] === 'l' ? 'label' : tr() === 'jira' ? 'fix version' : 'milestone'
function finder(which) {
  const ids = picks(which) || []
  return '<div class="col" style="gap:6px;max-width:560px">' + (ids.length ? '<div class="row">' + ids.map((id) => '<span class="chip">' + esc(choiceName(tr(), id)) + ' <span class="dmark">' + kindOf(id) + '</span><button class="x" aria-label="Remove" onclick="togglePick(\'' + which + '\', \'' + id + '\', false)">×</button></span>').join('') + '</div>' : '') +
    '<input type="text" class="find" placeholder="Find ' + (tr() === 'jira' ? 'a fix version, epic or label' : 'an epic, label or milestone') + '…" oninput="findChoices(\'' + which + '\', this.value)" aria-label="Find for ' + which + '">' +
    '<div class="found" id="found-' + which + '"></div></div>'
}
// asks the tracker for up to 8 matching names as you type (canned here); nothing is read for a choice until it's picked
function findChoices(which, text, append) {
  const t = text.trim().toLowerCase(), taken = (picks(which) || []).concat(which === 'cq' ? picks('mq') || [] : [])
  const hits = t ? CHOICES.filter((id) => !taken.includes(id) && choiceName(tr(), id).toLowerCase().includes(t)).slice(0, 8) : []
  document.getElementById('found-' + which).innerHTML = !t ? '' : hits.length ? hits.map((id) => '<button onclick="' + (append ? 'addTerm(choiceQuery(tr(), \'' + id + '\'), \'' + which + '\')' : 'togglePick(\'' + which + '\', \'' + id + '\', true)') + '">' + esc(choiceName(tr(), id)) + ' <span class="dmark">' + kindOf(id) + '</span></button>').join('') : '<span class="dmark">No epic, label or ' + (tr() === 'jira' ? 'fix version' : 'milestone') + ' matches “' + esc(text) + '”</span>'
}
function setSrc(k, v) { act(k + ' → ' + v, () => { state.inputs[k] = v }) }
function goStep(n) { act('step ' + n, () => { state.step = n }) }

// ---- derived ----
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';')
const pickedName = () => picks('mq') // the ids picked, or null for a query written by hand
function inUse(which) { const r = state.reads[which]; return r && r.ok ? r : state.lastGood[which] ? state.lastGood[which].r : null }
// what the forecast gets: tickets remaining from the milestone query; pace from the union of both queries' finished tickets
function combined() {
  const m = inUse('mq'); if (!m) return null
  const c = state.cq.trim() ? inUse('cq') : null
  const set = [...new Set(m.set.concat(c ? c.set : []))]
  return { ...measure(set), open: m.open, own: m.finished, incomplete: m.incomplete || !!(c && c.incomplete) }
}
const trackerName = () => tr() === 'jira' ? 'Jira' : 'GitHub'
function flag(which, r = state.reads[which], preview) {
  if (!r) return ''
  const T = trackerName(), what = which === 'mq' ? 'tickets remaining and pace' : 'pace'
  const stale = preview ? '' : state.lastGood[which] ? ' Still using the last query that worked (<span class="qline">' + esc(state.lastGood[which].q) + '</span>) for ' + what + '.' : ' Nothing is read until it’s fixed.'
  if (!r.ok && r.fail === 'outOfScope') return '<div class="flag bad"><b>' + esc(r.msg) + '</b> reaches outside ' + where() + '. This connection reads one ' + (tr() === 'jira' ? 'project' : 'repo') + '; to read another, change the connection.' + stale + '</div>'
  if (!r.ok) return '<div class="flag bad">' + (r.ours ? '' : T + ' says: ') + esc(r.msg) + stale + '</div>'
  if (r.incomplete) return '<div class="flag warn">Matches more than 1,000 tickets, the most ' + T + ' returns, so the counts are incomplete. Narrow the query.</div>'
  if (!r.set.length || r.total === 0) return '<div class="flag warn">Matches no tickets' + (which === 'mq' ? ', so tickets remaining is 0' : '') + '. Check the query.</div>'
  if (preview) return '<div class="flag ok">' + (which === 'mq' ? r.open + ' open · ' : '') + r.finished + ' finished in the last 8 weeks · press Enter to use this query</div>'
  return '<div class="flag ok">' + (which === 'mq' ? r.open + ' open · ' : '') + r.finished + ' finished in the last 8 weeks</div>'
}
function graph(c, two) {
  const max = Math.max(1, ...c.wk)
  return '<span class="dgraph">' + c.wk.map((n, j) => {
    const own = two ? sum((inUse('mq') || { set: [] }).set.map((i) => GROUPS[i].wk[j])) : n
    const h = (x) => Math.round(36 * x / max)
    return '<span class="c" title="w/c ' + wk(WEEKS[j]) + ': ' + n + '"><span class="bar cmp" style="height:' + h(n - own) + 'px;border-radius:2px 2px 0 0"></span><span class="bar" style="height:' + Math.max(h(own), n ? 0 : 2) + 'px;' + (n - own ? 'border-radius:0' : '') + (n ? '' : ';background:var(--risk)') + '"></span><span class="v">' + n + '</span></span>'
  }).join('') + '</span>'
}
function seg(opts, on, fn) { return '<span class="dseg">' + opts.map(([v, l]) => '<button class="' + (v === on ? 'on' : '') + '" onclick="' + fn + '(\'' + v + '\')">' + l + '</button>').join('') + '</span>' }
const qbox = (which, live) => '<div class="qbox"><span class="scope">' + scopeText() + '</span><input value="' + esc(state[which]) + '" placeholder="' + (which === 'cq' ? (tr() === 'jira' ? 'fixVersion = &quot;Q3 polish&quot; OR labels = checkout' : 'milestone:&quot;Q3 polish&quot; OR label:checkout') : '') + '" ' + (live ? 'oninput="liveQuery(\'' + which + '\', this.value)" ' : '') + 'onchange="setQuery(\'' + which + '\', this.value)"' + ' aria-label="' + (which === 'mq' ? 'Milestone query' : 'Comparable-work query') + '"></div>'
let liveTimer = null
function resCard(which, r) {
  if (!r) return '<div class="res"><span class="dmark">' + (which === 'cq' ? 'Optional. With none, the pace is the milestone’s own finished tickets.' : 'Pick from Add, or type a query.') + '</span></div>'
  if (!r.ok) return '<div class="res"><span class="n" style="color:var(--risk)">–</span><span class="dmark">not read</span></div>'
  return '<div class="res"><span><span class="n">' + r.open + '</span> open</span><span>' + r.finished + ' finished in 8 weeks</span>' + graph({ wk: r.wk }, false) + '</div>'
}
// a preview read while typing: shown beside the box, but the query in use changes only on Enter or leaving the box
function liveQuery(which, q) { clearTimeout(liveTimer); liveTimer = setTimeout(() => {
  const r = q.trim() || which === 'mq' ? read(state.conn.tracker, q) : null
  document.getElementById('res-' + which).innerHTML = resCard(which, r)
  document.getElementById('flag-' + which).innerHTML = r ? flag(which, r, true) : ''
}, 450) }

function section(n, name, hint, body) {
  return '<section class="input"><div class="label"><span class="number">' + String(n).padStart(2, '0') + '</span><h2>' + name + '</h2><p>' + hint + '</p></div><div class="body"><div class="col">' + body + '</div></div></section>'
}
function connectForm(compact, aside) {
  const d = state.draft, j = d.tracker === 'jira'
  const err = { noToken: 'Paste a token to connect.', unauthorised: (j ? 'Jira' : 'GitHub') + ' refused the token. Check it hasn’t expired' + (j ? '' : ', and that it has Issues: read') + '.', notFound: (j ? 'Jira can’t find that project' : 'GitHub can’t see ' + esc(d.where || 'that repo')) + ' with this token. Check the name, and that the token covers it.' }[state.connError]
  return '<div class="col">' + seg([['github', 'GitHub'], ['jira', 'Jira']], d.tracker, 'setDraftTracker') +
    '<div class="fields">' + (j
      ? '<label class="wide">Site <input type="text" value="' + esc(d.where) + '" placeholder="' + SITE + '" oninput="setDraft(\'where\', this.value)"></label><label>Project key <input type="text" value="' + (d.where ? PROJECT : '') + '" placeholder="' + PROJECT + '"></label>'
      : '<label class="wide">Repo <input type="text" value="' + esc(d.where) + '" placeholder="owner/repo" oninput="setDraft(\'where\', this.value)"></label>') +
    '<label class="wide">' + (j ? 'API token' : 'Token') + ' <input type="text" value="' + esc(d.token) + '" placeholder="' + (j ? 'from id.atlassian.com, scoped to read Jira work' : 'fine-grained, Issues: read on this repo only') + '" oninput="setDraft(\'token\', this.value)" style="font-family:var(--mono)"></label></div>' +
    (compact ? '' : '<span class="dmark">Read-only: nothing is ever written to ' + (j ? 'Jira' : 'GitHub') + '. The token stays on this computer.</span>') +
    (err ? '<div class="flag bad">' + err + '</div>' : '') +
    '<div class="actions">' + (aside || '') + '<button class="primary" onclick="connect()">Connect</button>' + (ui.changeConn ? ' <button onclick="ui.changeConn=false;render()">Cancel</button>' : '') + '</div></div>'
}
function setDraftTracker(t) { state.draft.tracker = t; state.draft.where = ''; state.connError = null; render() }
function connLine() {
  return '<div class="conn"><span class="ok-dot"></span>' + trackerName() + ' · <b>' + esc(where()) + '</b><span class="dmark">read ' + READ_AT + '</span>' +
    '<button class="linkish" onclick="ui.changeConn=true;state.draft={tracker:state.conn.tracker,where:\'\',token:\'\'};render()">Change</button><button class="linkish" onclick="disconnect()">Disconnect</button></div>'
}
function ticketsBlock() {
  const i = state.inputs, c = combined()
  if (!state.conn || !c) return '<div class="fields"><label>Tickets remaining <input type="number" value="' + i.tickets + '"></label></div>'
  return seg([['github', trackerName()], ['typed', 'Typed']], i.ticketsSrc, 'setTicketsSrc') + (i.ticketsSrc === 'github'
    ? '<div class="row"><span class="dbig">' + c.open + '</span><span class="dmark">tickets remaining · ' + trackerName() + ', read ' + READ_AT + (i.tickets !== c.open ? ' · your typed ' + i.tickets + ' is kept under Typed' : '') + '</span></div>'
    : '<div class="fields"><label>Tickets remaining <input type="number" value="' + i.tickets + '"></label></div>')
}
function setTicketsSrc(v) { setSrc('ticketsSrc', v) }
function setPaceSrc(v) { setSrc('paceSrc', v) }
function paceBlock(extra) {
  const i = state.inputs, c = combined()
  const range = '<div class="pace"><label>Low <input type="number" value="' + i.range[0] + '"></label><span class="to">to</span><label>High <input type="number" value="' + i.range[1] + '"></label><span class="unit">tickets per week</span></div>'
  if (!state.conn || !c) return range
  const cmp = c.finished - c.own
  return seg([['github', trackerName()], ['typed', 'Typed counts'], ['range', 'Range']], i.paceSrc, 'setPaceSrc') + (i.paceSrc === 'github'
    ? '<div class="row">' + graph(c, true) + '<span>last 8 weeks · ' + c.finished + ' finished: ' + c.own + ' from the milestone' + (cmp ? ', <span class="key" style="background:var(--bar-light)"></span>' + cmp + ' comparable' : '') + '</span>' + (c.incomplete ? '<span class="flag warn">incomplete: a query hit the cap</span>' : '') + '</div>' + (extra || '')
    : i.paceSrc === 'range' ? range : '<div class="muted">Typed counts, as on the Inputs screen today.</div>')
}

// ---- A: a Tracker section at the top of the Inputs screen ----
function variantA() {
  const conn = !state.conn || ui.changeConn ? connectForm() : connLine()
  const s1 = section(1, 'Tracker', 'Connect one GitHub repo or Jira project, to fill tickets remaining and pace from it.', conn)
  let ms = '<div class="fields"><label class="wide">Milestone name <input type="text" value="' + esc(state.inputs.name) + '"></label><label>Start date <input type="date" value="' + state.inputs.start + '"></label></div>'
  if (state.conn) {
    const p = pickedName()
    ms += '<div class="col"><span class="muted">Tickets from</span>' + (p && !ui.editMq
      ? finder('mq') + (state.mq ? '<div class="row"><span class="qline">' + esc(scopeText() + ' ' + state.mq) + '</span><button class="linkish" onclick="ui.editMq=true;render()">Edit query</button></div>' : '<button class="linkish" style="align-self:flex-start" onclick="ui.editMq=true;render()">Write the query yourself</button>')
      : qbox('mq') + '<button class="linkish" style="align-self:flex-start" onclick="' + (p ? 'ui.editMq=false;render()' : 'state.mq=\'\';ui.editMq=false;delete state.reads.mq;render()') + '">Back to finding</button>') + flag('mq') + '</div>'
  }
  ms += ticketsBlock()
  const s2 = section(2, 'Milestone', state.conn ? 'Pick the milestone in ' + trackerName() + ', or write your own query.' : 'Name the milestone, the date work on it starts, and how many tickets are left.', ms)
  let cmp = ''
  if (state.conn && combined() && state.inputs.paceSrc === 'github') {
    const names = comparablePicked(), p = pickedName()
    cmp = ui.openCmp || state.cq ? '<details class="col" open style="border-top:1px solid var(--hairline);padding-top:10px"><summary class="muted">Comparable work: finished tickets like this milestone’s, counted in the pace too</summary>' +
      (cqIsPicker() && !ui.editCq ? finder('cq') + '<button class="linkish" onclick="ui.editCq=true;render()" style="align-self:flex-start">Write the query yourself</button>' + (state.cq ? '<span class="qline">' + esc(state.cq) + '</span>' : '')
        : qbox('cq')) + flag('cq') + '</details>'
      : '<button class="linkish" style="align-self:flex-start" onclick="ui.openCmp=true;render()">+ Also count comparable work</button><span class="dmark">With none, the pace is this milestone’s own finished tickets.</span>'
  }
  const s3 = section(3, 'Pace', 'From ' + (state.conn ? trackerName() + ', ' : '') + 'your typed counts, or a range.', paceBlock(cmp))
  return s1 + s2 + s3
}

// ---- B: setup steps, then a summary line on the Inputs screen ----
function variantB() {
  const counts = (r) => r && r.ok ? (r.open !== undefined && r === state.reads.mq ? r.open + ' open · ' : '') + r.finished + ' finished in 8 weeks' : ''
  if (state.setupDone && !ui.reopen) {
    const what = (w) => { const ids = picks(w); return ids ? '<span title="' + esc(state[w]) + '">' + ids.map((id) => esc(choiceName(tr(), id)) + ' <span class="dmark">' + kindOf(id) + '</span>').join(', ') + '</span>' : '<span class="qline">' + esc(state[w]) + '</span>' }
    const bad = (w) => { const r = state.reads[w]; return r && (!r.ok || r.incomplete || !r.total) ? flag(w) : '' }
    const sum1 = '<div class="sumgrid"><div class="hdr"><span class="ok-dot"></span>' + trackerName() + ' · <b style="font-family:var(--mono);font-weight:500">' + esc(where()) + '</b><span class="end"><span class="dmark">read ' + READ_AT + '</span><button class="linkish" onclick="ui.reopen=true;state.step=2;render()">Change</button></span></div>' +
      '<span class="muted">Milestone</span>' + what('mq') + '<span class="dmark">' + counts(state.reads.mq) + '</span>' +
      '<span class="muted">Comparable</span>' + (state.cq ? what('cq') + '<span class="dmark">' + counts(state.reads.cq) + '</span>' : '<span class="dmark">none</span><span></span>') + '</div>' + bad('mq') + bad('cq')
    return sum1 + section(1, 'Milestone', 'Name, start date and tickets remaining.', '<div class="fields"><label class="wide">Milestone name <input type="text" value="' + esc(state.inputs.name) + '"></label><label>Start date <input type="date" value="' + state.inputs.start + '"></label></div>' + ticketsBlock()) +
      section(2, 'Pace', 'From ' + trackerName() + ', your typed counts, or a range.', paceBlock())
  }
  if (ui.skipped) return '<div class="summary"><span class="muted">No tracker connected.</span><button class="linkish" onclick="ui.skipped=false;render()">Connect a tracker</button></div>' + section(1, 'Milestone', 'Name, start date and tickets remaining.', ticketsBlock()) + section(2, 'Pace', 'Your typed counts, or a range.', paceBlock())
  const steps = ['Connect', 'Milestone', 'Comparable work', 'Check']
  const nav = '<ol>' + steps.map((s, i) => '<li class="' + (i + 1 === state.step ? 'on' : i + 1 < state.step ? 'done' : '') + '"' + (i + 1 < state.step ? ' onclick="goStep(' + (i + 1) + ')"' : '') + '>' + (i + 1) + '. ' + s + '</li>').join('') + '</ol>'
  const cancel = ui.reopen ? '<button onclick="ui.reopen=false;render()">Cancel</button>' : ''
  const back = (n) => '<button onclick="goStep(' + n + ')">Back</button>'
  // find-and-add, or the query by hand; either way you can switch to the other
  const chooser = (which) => {
    const byHand = ui['edit' + which] || picks(which) === null, k = '\'edit' + which + '\''
    const toQuery = '<button class="linkish" onclick="ui[' + k + ']=true;render()">' + (state[which] ? 'Edit as a query' : 'Write a query instead') + '</button>'
    const toFind = picks(which) === null
      ? '<button class="linkish" onclick="act(\'clear the query\', () => { state.' + which + '=\'\'; delete state.reads.' + which + '; ui[' + k + ']=false })">Back to finding (clears this query)</button>'
      : '<button class="linkish" onclick="ui[' + k + ']=false;render()">Back to finding</button>'
    return byHand
      ? qbox(which) + '<div class="qmode"><span class="dmark">Press Enter to read it.</span>' + toFind + '</div>' + flag(which)
      : finder(which) + '<div class="qmode">' + (state[which] ? '<span class="qline">' + esc(state[which]) + '</span>' : '') + toQuery + '</div>' + flag(which)
  }
  let body = ''
  if (state.step === 1) body = '<h2>Connect a tracker</h2><p class="muted">The milestone’s tickets and the team’s finished work are read from one GitHub repo or Jira project.</p>' +
    connectForm(false, '<button class="linkish" onclick="ui.skipped=true;render()">Skip: type the inputs instead</button>')
  if (state.step === 2) body = '<h2>Which tickets are the milestone?</h2><p class="muted">Find and add one or more from ' + esc(where()) + ': several epics, say, or a ' + (tr() === 'jira' ? 'fix version' : 'label') + '.</p>' +
    chooser('mq') + '<div class="actions">' + cancel + '<button class="primary"' + (inUse('mq') ? '' : ' disabled') + ' onclick="goStep(3)">Next</button></div>'
  if (state.step === 3) {
    const c = combined()
    body = '<h2>Is there finished work like this milestone’s?</h2><p class="muted">Its finished tickets count in the pace alongside the milestone’s own, which helps when the milestone is new.</p>' +
      chooser('cq') +
      '<div class="row" style="margin-top:6px">' + graph(c, true) + '<span class="muted">Pace: ' + c.own + ' finished from the milestone' + (c.finished - c.own ? ' + ' + (c.finished - c.own) + ' comparable' : '') + '</span></div>' +
      '<div class="actions">' + cancel + back(2) + '<button class="primary" onclick="goStep(4)">' + (state.cq.trim() ? 'Next' : 'Skip') + '</button></div>'
  }
  if (state.step === 4) {
    const c = combined(), i = state.inputs
    body = '<h2>Check what it gives</h2><p class="muted">Each value follows ' + trackerName() + ', updating on each read. Choose Typed or Range to keep yours.</p>' +
      '<table class="check"><tr><th></th><th>Yours now</th><th>From ' + trackerName() + '</th><th>Use</th></tr>' +
      '<tr><td>Tickets remaining</td><td>' + i.tickets + '</td><td>' + c.open + '</td><td>' + seg([['github', trackerName()], ['typed', 'Typed']], i.ticketsSrc, 'setTicketsSrc') + '</td></tr>' +
      '<tr><td>Pace</td><td>' + i.range[0] + '–' + i.range[1] + ' a week</td><td>' + graph(c, true) + '</td><td>' + seg([['github', trackerName()], ['range', 'Range']], i.paceSrc === 'typed' ? 'range' : i.paceSrc, 'setPaceSrc') + '</td></tr></table>' +
      '<div class="actions">' + cancel + back(3) + '<button class="primary" onclick="act(\'finish setup\', () => { state.setupDone = true; ui.reopen = false })">Use these</button></div>'
  }
  return '<div class="wizard">' + nav + '<div class="col">' + body + '</div></div>'
}

// ---- C: the queries front and centre, each with its read beside it ----
function variantC() {
  const top = state.conn && !ui.changeConn
    ? '<div class="cbar">' + connLine() + '<span class="dmark">Queries read as you type</span></div>'
    : '<div class="cbar"><b>Connect a tracker</b></div>' + connectForm(true)
  if (!state.conn || ui.changeConn) return top
  const menu = (which) => '<details class="menu"><summary>Add ▾</summary><div class="list" style="min-width:300px"><input type="text" class="find" placeholder="Find…" oninput="findChoices(\'' + which + '\', this.value, true)" aria-label="Find for ' + which + '"><div class="found" id="found-' + which + '"></div></div></details>'
  const row = (which, title, hint) => '<div class="qrow"><div class="col"><h3>' + title + '</h3><span class="dmark">' + hint + '</span><div class="row" style="flex-wrap:nowrap">' + qbox(which, true) + menu(which) + '</div><div id="flag-' + which + '">' + flag(which) + '</div></div><div id="res-' + which + '">' + resCard(which, state.reads[which]) + '</div></div>'
  const c = combined()
  const gives = c ? '<div class="gives"><div class="col" style="gap:2px"><span class="dmark">Tickets remaining</span><span class="dbig">' + c.open + '</span></div><div class="col" style="gap:4px"><span class="dmark">Pace · last 8 weeks · ' + c.own + ' milestone' + (c.finished - c.own ? ' + ' + (c.finished - c.own) + ' comparable' : '') + '</span>' + graph(c, true) + '</div><span class="muted" style="max-width:260px">These follow ' + trackerName() + ' on the Inputs screen, where either can be switched to Typed.</span></div>' : ''
  return top + row('mq', 'The milestone’s tickets', 'Open ones are tickets remaining; finished ones count in the pace.') + row('cq', 'Comparable work', 'Finished tickets like the milestone’s, also counted in the pace.') + gives
}
function addTerm(t, which) { which = which || 'cq'; const q = state[which].trim(); setQuery(which, q ? (q.split(' OR ').includes(t) ? q : q + ' OR ' + t) : t) }

// ---- switcher and render ----
function go(v, s) {
  variant = v; if (s && s !== scenario) { scenario = s; state = SCENARIOS[s].make(); ui = {}; log.length = 0 }
  const p = new URLSearchParams(location.search); p.set('variant', variant); p.set('scenario', scenario)
  history.replaceState(null, '', '?' + p); render()
}
function cycle(d) { const ks = Object.keys(VARIANTS); go(ks[(ks.indexOf(variant) + d + ks.length) % ks.length]) }
function render() {
  document.getElementById('proto').innerHTML = ({ A: variantA, B: variantB, C: variantC })[variant]()
  const r = (x) => x && (x.ok ? { open: x.open, finished: x.finished, incomplete: x.incomplete } : { fail: x.fail, msg: x.msg })
  document.getElementById('state').textContent = JSON.stringify({ variant, scenario, connection: state.conn, milestoneQuery: state.mq, comparableQuery: state.cq,
    reads: { milestone: r(state.reads.mq), comparable: r(state.reads.cq) }, inputs: state.inputs, actions: log }, null, 1)
  document.getElementById('switcher').innerHTML = '<button onclick="cycle(-1)">←</button><b>' + variant + ' (' + VARIANTS[variant] + ')</b><button onclick="cycle(1)">→</button>' +
    '<select onchange="go(variant,this.value)">' + Object.entries(SCENARIOS).map(([k, s]) => '<option value="' + k + '"' + (k === scenario ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select>' +
    '<button onclick="state=SCENARIOS[scenario].make();ui={};log.length=0;render()">Reset</button>'
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === 'ArrowLeft') cycle(-1); if (e.key === 'ArrowRight') cycle(1)
})
go(variant)
`

const header = {
  context: 'Checkout v2',
  heading: 'Inputs',
  lede: 'Prototype for “Connecting a tracker and picking the milestone’s tickets”. Flip variants with ← → and pick a scenario in the bar below.',
}
mkdirSync(new URL('.', out), { recursive: true })
writeFileSync(out, htmlPage('/inputs', header, MAIN, SCRIPT))
const file = fileURLToPath(out)
console.log(`Prototype written to ${file}`)
if (!process.env.NO_OPEN) spawn('open', [file], { stdio: 'ignore', detached: true }).unref()
