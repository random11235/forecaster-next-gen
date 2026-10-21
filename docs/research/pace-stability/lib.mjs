// Shared by the pace-stability scripts: the seeded random stream, the synthetic team types,
// the pace signals and the bootstrap forecast. Call seedRandom(seed) before drawing.

export let rnd = () => { throw new Error('call seedRandom(seed) first') }
export function seedRandom(seed) { rnd = mulberry32(seed) }

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function poisson(lambda) { // normal approximation above 30
  if (lambda <= 0) return 0
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal()))
  return poissonExact(lambda)
}
export function poissonExact(lambda) { // Knuth: one draw per count, so only for small means
  const L = Math.exp(-lambda)
  let k = 0, p = 1
  do { k++; p *= rnd() } while (p > L)
  return k - 1
}
export const exponential = () => -Math.log(rnd())
export function normal() {
  const u = 1 - rnd(), v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
export function gamma(shape, scale) { // Marsaglia–Tsang
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
// Each team type: make(n) -> { history: n weekly counts, next: draws the following weeks of the same process }.
// The keys (steady, lumpy, trending, step, regimes, outlier) appear as `archetype` in results.json.
export const teamTypes = {
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
export const TEAM_TYPES = Object.keys(teamTypes)

// ---------- signals ----------
export const sum = (a) => a.reduce((s, x) => s + x, 0)
export const mean = (a) => sum(a) / a.length
export const sd = (a) => { const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)) }

export function splitHalves(samples, splits = 100) { // mirrors src/engine/simulate.ts
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
export const rse = (a) => (mean(a) === 0 ? 0 : sd(a) / mean(a) / Math.sqrt(a.length))
export function chronoGap(a) {
  const h = Math.floor(a.length / 2), m = mean(a)
  return m === 0 ? 0 : Math.abs(mean(a.slice(a.length - h)) - mean(a.slice(0, h))) / m
}
export function mannKendallP(a) { // two-sided p, normal approximation with tie correction
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
export function phi(z) { // standard normal CDF (Abramowitz–Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * z / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2)
  return 0.5 * (1 + y)
}
export function lag1(a) {
  const m = mean(a)
  let num = 0, den = 0
  for (let i = 0; i < a.length; i++) { den += (a[i] - m) ** 2; if (i > 0) num += (a[i] - m) * (a[i - 1] - m) }
  return den === 0 ? 0 : num / den
}
export function jackknifeInfluence(a) {
  const m = mean(a), t = sum(a), n = a.length
  if (m === 0) return 0
  return Math.max(...a.map((x) => Math.abs((t - x) / (n - 1) - m) / m))
}

// ---------- forecasting ----------
export const REMAINING = 60
/** Weeks until `remaining` tickets are done, drawing one week's count from `draw` per week. */
export function weeksTo(draw, remaining = REMAINING, maxWeeks = 500) {
  let weeks = 0
  while (remaining > 0 && weeks < maxWeeks) { remaining -= draw(); weeks++ }
  return weeks
}
/** Plain bootstrap: every past week equally likely. */
export const plainBootstrap = (history) => () => history[Math.floor(rnd() * history.length)]
/** Bayesian bootstrap: fresh random weights on the past weeks for each simulated run. */
export function bayesianBootstrap(history) {
  const weights = history.map(exponential), total = sum(weights), cumulative = []
  let acc = 0
  for (const w of weights) cumulative.push((acc += w) / total)
  return () => { const u = rnd(); let i = 0; while (cumulative[i] < u) i++; return history[i] }
}
export const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
/** Sorted weeks-to-finish for `trials` plain-bootstrap runs, capped at 200 weeks. */
export function weeksToFinish(samples, trials) {
  const out = new Float64Array(trials)
  for (let t = 0; t < trials; t++) out[t] = weeksTo(plainBootstrap(samples), REMAINING, 200)
  return out.sort()
}
export function bootstrapP85Spread(samples, outer = 40, trials = 400) {
  const p85s = []
  for (let b = 0; b < outer; b++) {
    const re = samples.map(() => samples[Math.floor(rnd() * samples.length)])
    if (sum(re) === 0) { p85s.push(200); continue }
    p85s.push(quantile(weeksToFinish(re, trials), 0.85))
  }
  p85s.sort((x, y) => x - y)
  const med = quantile(p85s, 0.5)
  return (quantile(p85s, 0.9) - quantile(p85s, 0.1)) / med
}
export const actualWeeks = (next) => weeksTo(next, REMAINING, 200)
