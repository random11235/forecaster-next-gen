// Runs the pace-pattern classifier from classify.mjs on real issue history from a local snapshot made by export.py.
// Usage: node real-history.mjs <snapshot-file.json> [--tz Europe/London]
// Prints only aggregates: completions per period and the classifier's call on each growing prefix of whole periods.
// It reads the snapshot and writes nothing. Never commit the snapshot or per-issue output.
//
// Counting follows "When a ticket counts as finished" (#133): a ticket is finished when closed for any reason;
// leaf tickets only (no sub-issues); counted once, at its last close; quiet periods count as 0.
// Periods run from the period holding the repo's first issue to the export time; the last one is partial and is
// reported but left out of the classifier runs, as the product leaves out the current period.
import { readFileSync } from 'node:fs'
import * as lib from './lib.mjs'

// ---------- the classifier, taken verbatim from classify.mjs so the rules can't drift ----------
const src = readFileSync(new URL('./classify.mjs', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('const median ='), src.indexOf('const LABELS'))
if (!body.includes('function classify(')) throw new Error('classify.mjs layout changed; update real-history.mjs')
const { sum, mean, sd, mannKendallP, lag1 } = lib
const classify = new Function('sum', 'mean', 'sd', 'mannKendallP', 'lag1', `${body}; return classify`)(sum, mean, sd, mannKendallP, lag1)

// ---------- synthetic baseline: how the call moves on growing prefixes of a known team type ----------
// node real-history.mjs --synthetic   (seeded; reads no snapshot)
if (process.argv.includes('--synthetic')) {
  lib.seedRandom(20261108)
  const N = 20, R = 400
  const lowSteady = (m) => ({ make: (n) => ({ history: Array.from({ length: n }, () => lib.poisson(m)) }) })
  // a steady team that works weekdays only, counted daily with weekends kept (zeros on days 6 and 7)
  const weekdayTeam = { make: (n) => ({ history: Array.from({ length: n }, (_, i) => (i % 7 < 5 ? lib.poisson(2) : 0)) }) }
  const types = { ...lib.teamTypes, 'steady-mean-2': lowSteady(2), 'steady-mean-1': lowSteady(1), 'steady-weekdays-mean-2-weekends-kept': weekdayTeam }
  const res = {}
  for (const [key, t] of Object.entries(types)) {
    const at = { 6: {}, 8: {}, 10: {}, 20: {} }
    let flips = 0, sameAsFinalFrom8 = 0
    for (let r = 0; r < R; r++) {
      const h = t.make(N).history
      const calls = []
      for (let k = 6; k <= N; k++) calls.push(classify(h.slice(0, k)))
      for (const k of [6, 8, 10, 20]) at[k][calls[k - 6]] = (at[k][calls[k - 6]] ?? 0) + 1
      for (let i = 1; i < calls.length; i++) if (calls[i] !== calls[i - 1]) flips++
      if (calls.slice(2).every((c) => c === calls.at(-1))) sameAsFinalFrom8++
    }
    const pct = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((100 * v) / R)]))
    res[key] = { callAt: Object.fromEntries(Object.entries(at).map(([k, o]) => [k, pct(o)])),
      meanFlips6to20: Math.round((100 * flips) / R) / 100, pctUnchangedFrom8to20: Math.round((100 * sameAsFinalFrom8) / R) }
  }
  console.log(JSON.stringify(res, null, 1))
  process.exit(0)
}

// ---------- args ----------
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--tz')
const tz = args.includes('--tz') ? args[args.indexOf('--tz') + 1] : Intl.DateTimeFormat().resolvedOptions().timeZone
if (!file) { console.error('usage: node real-history.mjs <snapshot-file.json> [--tz Area/City]'); process.exit(1) }
const snap = JSON.parse(readFileSync(file, 'utf8'))

// ---------- local calendar days ----------
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
const dayNo = (iso) => Date.parse(fmt.format(new Date(iso)) + 'T00:00:00Z') / 864e5 // local calendar day as an integer
const weekday = (d) => (new Date(d * 864e5).getUTCDay() + 6) % 7 // 0 = Monday … 6 = Sunday
const dayLabel = (d) => new Date(d * 864e5).toISOString().slice(0, 10)

// ---------- finished leaf tickets, at their last close ----------
const finishes = []
for (const i of snap.issues) {
  if (i.state !== 'CLOSED' || (i.subIssues ?? []).length) continue
  const closes = (i.timeline ?? []).filter((e) => e.__typename === 'ClosedEvent').map((e) => e.createdAt)
  finishes.push(dayNo(closes.length ? closes.sort().at(-1) : i.closedAt))
}
const firstDay = Math.min(...snap.issues.map((i) => dayNo(i.createdAt)))
const endDay = dayNo(snap.exportedAt)

function periods(kind) {
  const counts = new Map()
  let start = firstDay
  if (kind === 'weekly') start -= weekday(firstDay)
  const keyOf = kind === 'weekly' ? (d) => d - weekday(d) : (d) => d
  const keys = []
  for (let d = start; d <= endDay; d += kind === 'weekly' ? 7 : 1) {
    if (kind === 'weekdays' && weekday(d) >= 5) continue
    keys.push(d); counts.set(d, 0)
  }
  let dropped = 0
  for (const f of finishes) { const k = keyOf(f); counts.has(k) ? counts.set(k, counts.get(k) + 1) : dropped++ }
  const all = keys.map((k) => ({ start: dayLabel(k), n: counts.get(k) }))
  const partial = all.pop() // the export day's period is not whole
  // weekly: the first week may also start before the first issue; report it
  const firstPartial = kind === 'weekly' && weekday(firstDay) !== 0
  return { whole: all.map((p) => p.n), starts: all.map((p) => p.start), partial: partial.n, firstPartial, dropped }
}

const r2 = (x) => Math.round(x * 100) / 100
function signals(a) {
  const m = mean(a)
  return { mean: r2(m), dispersion: r2(a.length > 1 ? sd(a) ** 2 / Math.max(1e-9, m) : 0), mkP: r2(mannKendallP(a)), lag1: r2(lag1(a)) }
}

const out = { repo: snap.repo, exportedAt: snap.exportedAt, tz, leafFinished: finishes.length, cadences: {} }
for (const kind of ['weekly', 'daily', 'weekdays']) {
  const p = periods(kind)
  const prefixes = []
  for (let k = 1; k <= p.whole.length; k++) {
    const a = p.whole.slice(0, k)
    prefixes.push({ periods: k, call: classify(a), ...(k >= 6 ? signals(a) : {}) })
  }
  // the product proposes from the 8 most recent whole periods: classify those too
  const last8 = p.whole.slice(-8)
  out.cadences[kind] = {
    firstPeriod: p.starts[0], wholePeriods: p.whole.length, counts: p.whole, partialPeriodCount: p.partial,
    firstWeekStartsBeforeRepo: p.firstPartial, finishesOutsidePeriods: p.dropped,
    prefixes, last8: { counts: last8, call: classify(last8) },
  }
}
console.log(JSON.stringify(out, null, 1))
