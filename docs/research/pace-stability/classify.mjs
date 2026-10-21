// Tests a rule-based classifier that names each history's pace pattern, at 10 and 20 weeks. Seeded, deterministic.
// Usage: node classify.mjs (prints a confusion matrix as JSON: actual team type -> named pattern -> count)
import { seedRandom, teamTypes, TEAM_TYPES, sum, mean, sd, mannKendallP, lag1 } from './lib.mjs'

seedRandom(20261021)
// ---------- pattern classifier ----------
const median = (a) => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 }
function stepVsLine(a) { // SSE of best two-level split vs SSE of a straight line
  const n = a.length, xs = a.map((_, i) => i), mx = mean(xs), my = mean(a)
  let sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (a[i] - my); sxx += (xs[i] - mx) ** 2 }
  const b = sxy / sxx, lineSSE = sum(a.map((y, i) => (y - (my + b * (i - mx))) ** 2))
  let best = Infinity, at = 0
  for (let k = 2; k <= n - 2; k++) {
    const l = a.slice(0, k), r = a.slice(k), ml = mean(l), mr = mean(r)
    const s = sum(l.map((y) => (y - ml) ** 2)) + sum(r.map((y) => (y - mr) ** 2))
    if (s < best) { best = s; at = k }
  }
  return { stepSSE: best, lineSSE, at }
}
function classify(a) {
  if (a.length < 6) return 'thin'
  const med = median(a), spread = Math.max(1, Math.sqrt(med))
  const iMax = a.indexOf(Math.max(...a))
  const rest = a.filter((_, i) => i !== iMax)
  const restDispersion = sd(rest) ** 2 / Math.max(1e-9, mean(rest))
  if ((a[iMax] - med) / spread > 4 && restDispersion < 2) return 'outlier'
  if (mannKendallP(a) < 0.05) {
    const { stepSSE, lineSSE } = stepVsLine(a)
    return stepSSE < 0.8 * lineSSE ? 'step' : 'trending'
  }
  if (lag1(a) > 0.3) return 'regimes'
  if (sd(a) ** 2 / Math.max(1e-9, mean(a)) > 2) return 'lumpy'
  return 'steady'
}
const LABELS = [...TEAM_TYPES, 'thin']
const out = { weeks: {} }
for (const n of [10, 20]) {
  const m = Object.fromEntries(TEAM_TYPES.map((k) => [k, Object.fromEntries(LABELS.map((l) => [l, 0]))]))
  for (const key of TEAM_TYPES) for (let r = 0; r < 400; r++) m[key][classify(teamTypes[key].make(n).history)]++
  out.weeks[n] = m
}
console.log(JSON.stringify(out, null, 1))
