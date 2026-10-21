// Plain vs Bayesian bootstrap across team types at 10 weeks: miss rate, range width, median bias.
let s = 4242; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pois = (m) => { let L = Math.exp(-m), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const gam = (k) => { let x = 0; for (let i = 0; i < k; i++) x -= Math.log(rnd()); return x; }; // integer shape only
const N = 10;
const teams = {
  steady: () => { const h = Array.from({ length: N }, () => pois(6)); return { h, fut: () => pois(6) }; },
  lumpy: () => { const g = () => pois(6 * gam(1)); const h = Array.from({ length: N }, g); return { h, fut: g }; },
  trending: () => { const h = Array.from({ length: N }, (_, i) => pois(3 + 6 * i / (N - 1))); return { h, fut: () => pois(9) }; },
  step: () => { const h = Array.from({ length: N }, (_, i) => pois(i < N / 2 ? 4 : 8)); return { h, fut: () => pois(8) }; },
  regimes: () => { let good = rnd() < 0.5; const nx = () => { if (rnd() > 0.85) good = !good; return pois(good ? 9 : 3); }; const h = Array.from({ length: N }, nx); return { h, fut: nx }; },
  outlier: () => { const h = Array.from({ length: N }, () => pois(6)); h[Math.floor(rnd() * N)] = 30; return { h, fut: () => pois(6) }; },
};
const weeksTo = (draw, rem) => { let w = 0; while (rem > 0 && w < 500) { rem -= draw(); w++; } return w; };
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const plain = (h) => () => h[Math.floor(rnd() * h.length)];
const bayes = (h) => { const w = h.map(() => -Math.log(rnd())), tot = w.reduce((a, b) => a + b), c = []; let acc = 0; for (const x of w) c.push((acc += x) / tot); return () => { const u = rnd(); let i = 0; while (c[i] < u) i++; return h[i]; }; };
console.log('team      | miss plain→bayes | P10–P90 width (weeks) | P50 − actual median');
for (const [name, gen] of Object.entries(teams)) {
  const r = { plain: { miss: 0, w: 0, bias: [] }, bayes: { miss: 0, w: 0, bias: [] } }; const H = 800;
  for (let k = 0; k < H; k++) {
    const { h, fut } = gen(); const actual = weeksTo(fut, 60);
    for (const [m, mk] of [['plain', plain], ['bayes', bayes]]) {
      const sims = Array.from({ length: 1000 }, () => weeksTo(mk(h), 60)).sort((a, b) => a - b);
      const lo = q(sims, .1), hi = q(sims, .9);
      if (actual < lo || actual > hi) r[m].miss++; r[m].w += hi - lo; r[m].bias.push(q(sims, .5) - actual);
    }
  }
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  console.log(`${name.padEnd(9)} | ${(r.plain.miss / H * 100).toFixed(0)}% → ${(r.bayes.miss / H * 100).toFixed(0)}% | ${(r.plain.w / H).toFixed(1)} → ${(r.bayes.w / H).toFixed(1)} | ${med(r.plain.bias)} → ${med(r.bayes.bias)}`);
}
