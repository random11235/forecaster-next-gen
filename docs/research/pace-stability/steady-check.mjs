// Steady team miss rate by history length, separating "truly outside the range" from ties at the range edges,
// plus the perfect-forecast baseline (ranges from the true process). Usage: node steady-check.mjs
import { seedRandom, poissonExact, weeksTo, plainBootstrap, quantile } from './lib.mjs'

seedRandom(12345)
const RUNS = 2000, TRIALS = 2000
const steadyWeek = () => poissonExact(6)
const sortedWeeks = (draw) => Array.from({ length: TRIALS }, () => weeksTo(draw)).sort((a, b) => a - b)
for (const weeksOfHistory of [5, 10, 20, 40, 80]) {
  let outside = 0, onEdge = 0, outsideTrueRange = 0
  for (let run = 0; run < RUNS; run++) {
    const history = Array.from({ length: weeksOfHistory }, steadyWeek)
    const forecast = sortedWeeks(plainBootstrap(history))
    const p10 = quantile(forecast, 0.1), p90 = quantile(forecast, 0.9), actual = weeksTo(steadyWeek)
    if (actual < p10 || actual > p90) outside++
    if (actual === p10 || actual === p90) onEdge++
    if (weeksOfHistory === 10) {
      const truth = sortedWeeks(steadyWeek)
      if (actual < quantile(truth, 0.1) || actual > quantile(truth, 0.9)) outsideTrueRange++
    }
  }
  const pct = (count) => (count / RUNS * 100).toFixed(1)
  console.log(`n=${weeksOfHistory}: outside ${pct(outside)}%, on an edge ${pct(onEdge)}%` + (weeksOfHistory === 10 ? `; true-process bands: outside ${pct(outsideTrueRange)}%` : ''))
}
