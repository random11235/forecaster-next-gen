// Steady team miss rate by history length: plain bootstrap vs Bayesian bootstrap. Usage: node widen-check.mjs
import { seedRandom, poissonExact, weeksTo, plainBootstrap, bayesianBootstrap, quantile } from './lib.mjs'

seedRandom(777)
const RUNS = 1500, TRIALS = 1000
const steadyWeek = () => poissonExact(6)
const samplers = { plain: plainBootstrap, bayes: bayesianBootstrap }
for (const weeksOfHistory of [5, 10, 20, 40]) {
  const misses = { plain: 0, bayes: 0 }
  for (let run = 0; run < RUNS; run++) {
    const history = Array.from({ length: weeksOfHistory }, steadyWeek), actual = weeksTo(steadyWeek)
    for (const [name, sampler] of Object.entries(samplers)) {
      const forecast = Array.from({ length: TRIALS }, () => weeksTo(sampler(history))).sort((a, b) => a - b)
      if (actual < quantile(forecast, 0.1) || actual > quantile(forecast, 0.9)) misses[name]++
    }
  }
  console.log(`n=${weeksOfHistory}: plain ${(misses.plain / RUNS * 100).toFixed(0)}%, bayesian ${(misses.bayes / RUNS * 100).toFixed(0)}%`)
}
