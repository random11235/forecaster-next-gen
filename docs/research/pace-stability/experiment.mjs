// Synthetic comparison of pace-stability signals. Seeded, deterministic.
// Usage: node experiment.mjs > results.json
import { writeFileSync } from 'node:fs'

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20261021)

function poisson(lambda) {
  if (lambda <= 0) return 0
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal()))
  const L = Math.exp(-lambda)
  let k = 0, p = 1
  do { k++; p *= rnd() } while (p > L)
  return k - 1
}
function normal() {
  const u = 1 - rnd(), v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
function gamma(shape, scale) { // Marsaglia–Tsang
  if (shape < 1) return gamma(shape + 1, scale) * Math.pow(rnd(), 1 / shape)
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x, v
    do { x = normal(); v = 1 + c * x } while (v <= 0)
    v = v * v * v
    const u = rnd()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale
  }
}

const MEAN = 6
// Each archetype: history(n) -> weeks[], and future() -> generator of weekly counts continuing the true process.
const archetypes = {
  steady: {
    label: 'Steady',
    blurb: 'Poisson, mean 6 a week. The case the bootstrap assumes.',
    make(n) { return { history: Array.from({ length: n }, () => poisson(MEAN)), next: () => poisson(MEAN) } },
  },
  lumpy: {
    label: 'Lumpy',
    blurb: 'Mean 6, but weeks vary about as much as the mean (CV ≈ 1): batch releases, zero weeks.',
    make(n) {
      const k = 1.2
      const draw = () => poisson(gamma(k, MEAN / k))
      return { history: Array.from({ length: n }, draw), next: draw }
    },
  },
  trending: {
    label: 'Speeding up',
    blurb: 'Mean rises steadily from 3 to 9 a week over the history, then holds at 9.',
    make(n) {
      const history = Array.from({ length: n }, (_, i) => poisson(3 + (6 * i) / Math.max(1, n - 1)))
      return { history, next: () => poisson(9) }
    },
  },
  step: {
    label: 'Team change',
    blurb: 'Mean 4 a week, then 8 a week from halfway through the history onward.',
    make(n) {
      const history = Array.from({ length: n }, (_, i) => poisson(i < n / 2 ? 4 : 8))
      return { history, next: () => poisson(8) }
    },
  },
  regimes: {
    label: 'Good and bad spells',
    blurb: 'Runs of good weeks (9) and bad weeks (3); each week has an 85% chance of staying in the same spell.',
    make(n) {
      let good = rnd() < 0.5
      const step = () => { if (rnd() > 0.85) good = !good; return poisson(good ? 9 : 3) }
      const history = Array.from({ length: n }, step)
      return { history, next: step }
    },
  },
  outlier: {
    label: 'One odd week',
    blurb: 'Steady at 6, except one week where 30 tickets were closed at once.',
    make(n) {
      const history = Array.from({ length: n }, () => poisson(MEAN))
      history[Math.floor(rnd() * n)] = 30
      return { history, next: () => poisson(MEAN) }
    },
  },
}
const KEYS = Object.keys(archetypes)

// ---------- signals ----------
const sum = (a) => a.reduce((s, x) => s + x, 0)
const mean = (a) => sum(a) / a.length
const sd = (a) => { const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)) }

function splitHalves(samples, splits = 100) { // mirrors src/engine/simulate.ts
  const s = Float64Array.from(samples), half = Math.floor(s.length / 2)
  const total = sum(samples), m = total / s.length
  if (m === 0) return 0
  let err = 0
  for (let k = 0; k < splits; k++) {
    let first = 0
    for (let i = 0; i < half; i++) {
      const j = i + Math.floor(rnd() * (s.length - i))
      const p = s[j]; s[j] = s[i]; s[i] = p; first += p
    }
    err += Math.abs(first / half - (total - first) / (s.length - half)) / m
  }
  return err / splits
}
const rse = (a) => (mean(a) === 0 ? 0 : sd(a) / mean(a) / Math.sqrt(a.length))
function chronoGap(a) {
  const h = Math.floor(a.length / 2), m = mean(a)
  return m === 0 ? 0 : Math.abs(mean(a.slice(a.length - h)) - mean(a.slice(0, h))) / m
}
function mannKendallP(a) { // two-sided p, normal approximation with tie correction
  const n = a.length
  let S = 0
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(a[j] - a[i])
  const ties = new Map()
  for (const x of a) ties.set(x, (ties.get(x) ?? 0) + 1)
  let tieTerm = 0
  for (const t of ties.values()) tieTerm += t * (t - 1) * (2 * t + 5)
  const v = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18
  if (v <= 0) return 1
  const z = S === 0 ? 0 : (S - Math.sign(S)) / Math.sqrt(v)
  return 2 * (1 - phi(Math.abs(z)))
}
function phi(z) { // standard normal CDF (Abramowitz–Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * z / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2)
  return 0.5 * (1 + y)
}
function lag1(a) {
  const m = mean(a)
  let num = 0, den = 0
  for (let i = 0; i < a.length; i++) { den += (a[i] - m) ** 2; if (i > 0) num += (a[i] - m) * (a[i - 1] - m) }
  return den === 0 ? 0 : num / den
}
function jackknifeInfluence(a) {
  const m = mean(a), t = sum(a), n = a.length
  if (m === 0) return 0
  return Math.max(...a.map((x) => Math.abs((t - x) / (n - 1) - m) / m))
}

// ---------- forecasting ----------
const REMAINING = 60
function weeksToFinish(samples, trials) {
  const out = new Float64Array(trials)
  for (let t = 0; t < trials; t++) {
    let done = 0, w = 0
    while (done < REMAINING && w < 200) { done += samples[Math.floor(rnd() * samples.length)]; w++ }
    out[t] = w
  }
  return out.sort()
}
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
function bootstrapP85Spread(samples, outer = 40, trials = 400) {
  const p85s = []
  for (let b = 0; b < outer; b++) {
    const re = samples.map(() => samples[Math.floor(rnd() * samples.length)])
    if (sum(re) === 0) { p85s.push(200); continue }
    p85s.push(q(weeksToFinish(re, trials), 0.85))
  }
  p85s.sort((x, y) => x - y)
  const med = q(p85s, 0.5)
  return (q(p85s, 0.9) - q(p85s, 0.1)) / med
}
function actualWeeks(next) {
  let done = 0, w = 0
  while (done < REMAINING && w < 200) { done += next(); w++ }
  return w
}

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
for (const key of KEYS) {
  for (let r = 0; r < PER; r++) {
    const { history, next } = archetypes[key].make(N)
    const fc = weeksToFinish(history, 2000)
    const p10 = q(fc, 0.1), p50 = q(fc, 0.5), p85 = q(fc, 0.85), p90 = q(fc, 0.9)
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
const quality = KEYS.map((k) => {
  const rs = rows.filter((r) => r.archetype === k)
  return {
    archetype: k,
    outside80: mean(rs.map((r) => +r.outside80)),
    medianAbsLogErr: q(rs.map((r) => r.absLogErr).sort((a, b) => a - b), 0.5),
  }
})
// Flag rate per signal per archetype
const flags = SIGNALS.map((s) => ({
  signal: s.key,
  rates: Object.fromEntries(KEYS.map((k) => {
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
  const { history } = archetypes[k].make(n)
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
const decimation = KEYS.map((key) => {
  const ks = []
  for (let k = DN; k >= 2; k--) ks.push(k)
  const acc = ks.map(() => 0), theory = ks.map(() => 0)
  const SERIES = 150, DRAWS = 200
  for (let s = 0; s < SERIES; s++) {
    const { history } = archetypes[key].make(DN)
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
const examples = KEYS.map((k) => ({ archetype: k, weeks: archetypes[k].make(12).history }))

// Strip-plot data: signal values per archetype (subset to keep the page small)
const strips = SIGNALS.map((s) => ({
  signal: s.key,
  values: Object.fromEntries(KEYS.map((k) => [k, rows.filter((r) => r.archetype === k).slice(0, 150).map((r) => +r[s.key].toFixed(4))])),
}))

const out = {
  meta: { seed: 20261021, weeksOfHistory: N, seriesPerType: PER, remainingTickets: REMAINING, decimationWeeks: DN },
  archetypes: KEYS.map((k) => ({ key: k, label: archetypes[k].label, blurb: archetypes[k].blurb })),
  signals: SIGNALS.map(({ key, label, threshold, fmt, rule, below }) => ({ key, label, threshold, fmt, rule, below: !!below })),
  quality, flags, predictive, scatter, shFit, shCorr, decimation, examples, strips,
}
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out))
console.log(JSON.stringify({ quality, flags, predictive, shFit, shCorr,
  decimation: decimation.map((d) => ({ a: d.archetype, ratio: d.points.filter((p) => [16, 10, 5, 3].includes(p.k)).map((p) => `${p.k}:${(p.observed / p.theory).toFixed(2)}`) })) }, null, 1))
