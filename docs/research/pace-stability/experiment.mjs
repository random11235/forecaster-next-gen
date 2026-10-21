// Synthetic comparison of pace-stability signals. Seeded, deterministic.
// Usage: node experiment.mjs (prints a summary and writes results.json)
import { writeFileSync } from 'node:fs'
import {
  seedRandom, rnd, teamTypes, TEAM_TYPES, mean, sd, splitHalves, rse, chronoGap, mannKendallP, lag1,
  jackknifeInfluence, weeksToFinish, quantile, bootstrapP85Spread, actualWeeks, REMAINING,
} from './lib.mjs'

seedRandom(20261021)
// ---------- run ----------
const SIGNALS = [
  { key: 'splitHalves', label: 'Split-halves error (current)', threshold: 0.25, fmt: 'pct', rule: '> 25%' },
  { key: 'rse', label: 'Relative standard error', threshold: 0.16, fmt: 'pct', rule: '> 16%' },
  { key: 'chronoGap', label: 'Older vs newer half', threshold: 0.4, fmt: 'pct', rule: '> 40%' },
  { key: 'mkP', label: 'Mann–Kendall trend test', threshold: 0.05, fmt: 'p', rule: 'p < 0.05', below: true },
  { key: 'lag1', label: 'Lag-1 autocorrelation', threshold: 0.3, fmt: 'r', rule: '> 0.3' },
  { key: 'jackknife', label: 'Leave-one-out influence', threshold: 0.2, fmt: 'pct', rule: '> 20%' },
  { key: 'trendOrRuns', label: 'Trend or runs (combined)', threshold: 0, fmt: 'flag', rule: 'MK p < 0.05 or lag-1 > 0.3' },
  { key: 'bootSpread', label: 'Bootstrap P85 spread', threshold: 0.5, fmt: 'pct', rule: '> 50%' },
]

const N = 10, PER = 400
const rows = []
for (const key of TEAM_TYPES) {
  for (let r = 0; r < PER; r++) {
    const { history, next } = teamTypes[key].make(N)
    const fc = weeksToFinish(history, 2000)
    const p10 = quantile(fc, 0.1), p50 = quantile(fc, 0.5), p85 = quantile(fc, 0.85), p90 = quantile(fc, 0.9)
    const actual = actualWeeks(next)
    rows.push({
      archetype: key,
      splitHalves: splitHalves(history), rse: rse(history), chronoGap: chronoGap(history),
      mkP: mannKendallP(history), lag1: lag1(history), jackknife: jackknifeInfluence(history),
      bootSpread: bootstrapP85Spread(history),
      get trendOrRuns() { return +(this.mkP < 0.05 || this.lag1 > 0.3) },
      p50, p85, actual,
      outside80: actual < p10 || actual > p90,
      lateVsP85: actual > p85,
      absLogErr: Math.abs(Math.log(actual / p50)),
    })
  }
}

function ranks(v) {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0])
  const r = new Array(v.length)
  for (let i = 0; i < idx.length;) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1
    i = j + 1
  }
  return r
}
function spearman(x, y) {
  const rx = ranks(x), ry = ranks(y), mx = mean(rx), my = mean(ry)
  let n = 0, a = 0, b = 0
  for (let i = 0; i < rx.length; i++) { n += (rx[i] - mx) * (ry[i] - my); a += (rx[i] - mx) ** 2; b += (ry[i] - my) ** 2 }
  return n / Math.sqrt(a * b)
}
const flagged = (s, row) => (s.below ? row[s.key] < s.threshold : row[s.key] > s.threshold)

// Per archetype: forecast quality
const quality = TEAM_TYPES.map((k) => {
  const rs = rows.filter((r) => r.archetype === k)
  return {
    archetype: k,
    outside80: mean(rs.map((r) => +r.outside80)),
    medianAbsLogErr: quantile(rs.map((r) => r.absLogErr).sort((a, b) => a - b), 0.5),
  }
})
// Flag rate per signal per archetype
const flags = SIGNALS.map((s) => ({
  signal: s.key,
  rates: Object.fromEntries(TEAM_TYPES.map((k) => {
    const rs = rows.filter((r) => r.archetype === k)
    return [k, mean(rs.map((r) => +flagged(s, r)))]
  })),
}))
// Predictive power: does the signal rank series by how wrong their forecast turned out?
const errs = rows.map((r) => r.absLogErr)
const predictive = SIGNALS.map((s) => {
  const v = rows.map((r) => (s.below ? -r[s.key] : r[s.key]))
  // Miss rate among flagged vs unflagged
  const fl = rows.filter((r) => flagged(s, r)), un = rows.filter((r) => !flagged(s, r))
  return {
    signal: s.key,
    spearman: spearman(v, errs),
    missFlagged: fl.length ? mean(fl.map((r) => +r.outside80)) : null,
    missUnflagged: un.length ? mean(un.map((r) => +r.outside80)) : null,
    flaggedShare: fl.length / rows.length,
  }
})

// Split-halves vs RSE: steady + lumpy across n
const scatter = []
for (const k of ['steady', 'lumpy', 'trending']) for (const n of [4, 6, 8, 10, 12, 16, 20]) for (let r = 0; r < 25; r++) {
  const { history } = teamTypes[k].make(n)
  scatter.push({ archetype: k, n, splitHalves: splitHalves(history), rse: rse(history) })
}
const shFit = (() => { // least squares through origin: splitHalves ≈ c·rse
  let num = 0, den = 0
  for (const p of scatter) { num += p.splitHalves * p.rse; den += p.rse ** 2 }
  return num / den
})()
const shCorr = spearman(scatter.map((p) => p.splitHalves), scatter.map((p) => p.rse))

// User's proposal: decimation curve. For each archetype, 20 weeks of history; drop down to k weeks at random,
// measure spread of the subsample mean (as share of the full mean), averaged over series; compare with theory.
const DN = 20
const decimation = TEAM_TYPES.map((key) => {
  const ks = []
  for (let k = DN; k >= 2; k--) ks.push(k)
  const acc = ks.map(() => 0), theory = ks.map(() => 0)
  const SERIES = 150, DRAWS = 200
  for (let s = 0; s < SERIES; s++) {
    const { history } = teamTypes[key].make(DN)
    const m = mean(history), sdev = sd(history)
    if (m === 0) continue
    ks.forEach((k, i) => {
      const means = []
      for (let d = 0; d < DRAWS; d++) {
        const c = history.slice()
        let t = 0
        for (let j = 0; j < k; j++) { const x = j + Math.floor(rnd() * (c.length - j)); const p = c[x]; c[x] = c[j]; c[j] = p; t += p }
        means.push(t / k / m)
      }
      acc[i] += sd(means)
      theory[i] += (sdev / m) * Math.sqrt((1 / k) * ((DN - k) / (DN - 1)))
    })
  }
  return { archetype: key, points: ks.map((k, i) => ({ k, observed: acc[i] / SERIES, theory: theory[i] / SERIES })) }
})

// Example series per archetype, 12 weeks
const examples = TEAM_TYPES.map((k) => ({ archetype: k, weeks: teamTypes[k].make(12).history }))

// Strip-plot data: signal values per archetype (subset to keep the page small)
const strips = SIGNALS.map((s) => ({
  signal: s.key,
  values: Object.fromEntries(TEAM_TYPES.map((k) => [k, rows.filter((r) => r.archetype === k).slice(0, 150).map((r) => +r[s.key].toFixed(4))])),
}))

const out = {
  meta: { seed: 20261021, weeksOfHistory: N, seriesPerType: PER, remainingTickets: REMAINING, decimationWeeks: DN },
  archetypes: TEAM_TYPES.map((k) => ({ key: k, label: teamTypes[k].label, blurb: teamTypes[k].blurb })),
  signals: SIGNALS.map(({ key, label, threshold, fmt, rule, below }) => ({ key, label, threshold, fmt, rule, below: !!below })),
  quality, flags, predictive, scatter, shFit, shCorr, decimation, examples, strips,
}
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out))
console.log(JSON.stringify({ quality, flags, predictive, shFit, shCorr,
  decimation: decimation.map((d) => ({ a: d.archetype, ratio: d.points.filter((p) => [16, 10, 5, 3].includes(p.k)).map((p) => `${p.k}:${(p.observed / p.theory).toFixed(2)}`) })) }, null, 1))
