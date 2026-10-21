// Plain vs Bayesian bootstrap across team types at 10 weeks: miss rate, P10–P90 width and median bias.
// The team types are simplified from lib.mjs (lumpy uses an exponential mean). Usage: node bayes-sideeffects.mjs
import { seedRandom, rnd, poissonExact, exponential, weeksTo, plainBootstrap, bayesianBootstrap, quantile } from './lib.mjs'

seedRandom(4242)
const WEEKS = 10, RUNS = 800, TRIALS = 1000
const weeksOf = (week) => Array.from({ length: WEEKS }, week)
const teams = {
  steady: () => ({ history: weeksOf(() => poissonExact(6)), next: () => poissonExact(6) }),
  lumpy: () => { const week = () => poissonExact(6 * exponential()); return { history: weeksOf(week), next: week } },
  trending: () => ({ history: weeksOf((_, i) => poissonExact(3 + 6 * i / (WEEKS - 1))), next: () => poissonExact(9) }),
  step: () => ({ history: weeksOf((_, i) => poissonExact(i < WEEKS / 2 ? 4 : 8)), next: () => poissonExact(8) }),
  regimes: () => {
    let good = rnd() < 0.5
    const week = () => { if (rnd() > 0.85) good = !good; return poissonExact(good ? 9 : 3) }
    return { history: weeksOf(week), next: week }
  },
  outlier: () => { const history = weeksOf(() => poissonExact(6)); history[Math.floor(rnd() * WEEKS)] = 30; return { history, next: () => poissonExact(6) } },
}
const samplers = { plain: plainBootstrap, bayes: bayesianBootstrap }
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
console.log('team      | miss plain→bayes | P10–P90 width (weeks) | P50 − actual median')
for (const [team, make] of Object.entries(teams)) {
  const stats = { plain: { misses: 0, totalWidth: 0, biases: [] }, bayes: { misses: 0, totalWidth: 0, biases: [] } }
  for (let run = 0; run < RUNS; run++) {
    const { history, next } = make(), actual = weeksTo(next)
    for (const [name, sampler] of Object.entries(samplers)) {
      const forecast = Array.from({ length: TRIALS }, () => weeksTo(sampler(history))).sort((a, b) => a - b)
      const p10 = quantile(forecast, 0.1), p90 = quantile(forecast, 0.9), s = stats[name]
      if (actual < p10 || actual > p90) s.misses++
      s.totalWidth += p90 - p10
      s.biases.push(quantile(forecast, 0.5) - actual)
    }
  }
  const { plain, bayes } = stats
  console.log(`${team.padEnd(9)} | ${(plain.misses / RUNS * 100).toFixed(0)}% → ${(bayes.misses / RUNS * 100).toFixed(0)}% | ${(plain.totalWidth / RUNS).toFixed(1)} → ${(bayes.totalWidth / RUNS).toFixed(1)} | ${median(plain.biases)} → ${median(bayes.biases)}`)
}
