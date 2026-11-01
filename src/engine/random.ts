/**
 * A seeded, non-cryptographic PRNG (xoshiro128**) returning uniforms in [0, 1).
 * Its 2^128 period stays far beyond the most draws the input limits allow (about 10^10).
 */
export type Random = () => number

export function createRandom(seed: number): Random {
  // splitmix32 spreads both 32-bit halves of the seed over the 128-bit state
  const fromLow = splitmix32(seed >>> 0)
  const fromHigh = splitmix32(Math.floor(seed / 4_294_967_296) >>> 0)
  const next = xoshiro128StarStar(fromLow(), fromHigh(), fromLow(), fromHigh())
  return () => next() / 4_294_967_296
}

/** The xoshiro128** 1.1 generator from a 128-bit state; each call returns an unsigned 32-bit integer. */
export function xoshiro128StarStar(s0: number, s1: number, s2: number, s3: number): () => number {
  return () => {
    const result = Math.imul(rotateLeft(Math.imul(s1, 5), 7), 9)
    const t = s1 << 9
    s2 ^= s0
    s3 ^= s1
    s1 ^= s2
    s0 ^= s3
    s2 ^= t
    s3 = rotateLeft(s3, 11)
    return result >>> 0
  }
}

function splitmix32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x9e3779b9) | 0
    let t = state ^ (state >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t ^= t >>> 15
    t = Math.imul(t, 0x735a2d97)
    return t ^ (t >>> 15)
  }
}

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits))
}

/** One draw, with replacement, from the samples. */
export function drawFrom(random: Random, samples: readonly number[]): number {
  return samples[Math.floor(random() * samples.length)]!
}

/** One whole number drawn uniformly from [low, high], both ends included. */
export function drawWholeNumberIn(random: Random, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1))
}

/**
 * The Bayesian bootstrap (ADR-0001): `reweight` gives every sample a fresh random weight, and `draw` picks
 * samples in proportion to those weights until the next `reweight`. Call `reweight` once per trial, so some
 * trials lean on the faster samples and some on the slower ones. Reuses its arrays, so neither call allocates.
 */
export function bayesianBootstrap(random: Random, samples: readonly number[]): { reweight(): void; draw(): number } {
  const cumulative = new Float64Array(samples.length)
  const last = samples.length - 1
  return {
    reweight() {
      let total = 0
      for (let i = 0; i < samples.length; i++) {
        // Exponential weights, normalised, are the flat Dirichlet the Bayesian bootstrap draws from
        total -= Math.log(1 - random())
        cumulative[i] = total
      }
    },
    draw() {
      const target = random() * cumulative[last]!
      // the first sample whose cumulative weight passes the target
      let low = 0
      let high = last
      while (low < high) {
        const mid = (low + high) >>> 1
        if (cumulative[mid]! > target) high = mid
        else low = mid + 1
      }
      return samples[low]!
    },
  }
}
