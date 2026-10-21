// Steady miss rate: plain bootstrap vs Bayesian bootstrap (Dirichlet weights per trial).
let s = 777; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pois = (m) => { let L = Math.exp(-m), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const weeksTo = (draw, rem) => { let w = 0; while (rem > 0 && w < 500) { rem -= draw(); w++; } return w; };
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const plain = (h) => () => h[Math.floor(rnd() * h.length)];
const bayes = (h) => { const w = h.map(() => -Math.log(rnd())), tot = w.reduce((a, b) => a + b), c = []; let acc = 0; for (const x of w) c.push((acc += x) / tot); return () => { const u = rnd(); let i = 0; while (c[i] < u) i++; return h[i]; }; };
for (const n of [5, 10, 20, 40]) {
  const miss = { plain: 0, bayes: 0 }, H = 1500;
  for (let k = 0; k < H; k++) {
    const hist = Array.from({ length: n }, () => pois(6)), actual = weeksTo(() => pois(6), 60);
    for (const [name, mk] of [['plain', (h) => plain(h)], ['bayes', (h) => bayes(h)]]) {
      const sims = Array.from({ length: 1000 }, () => weeksTo(mk(hist), 60)).sort((a, b) => a - b);
      if (actual < q(sims, 0.1) || actual > q(sims, 0.9)) miss[name]++;
    }
  }
  console.log(`n=${n}: plain ${(miss.plain / H * 100).toFixed(0)}%, bayesian ${(miss.bayes / H * 100).toFixed(0)}%`);
}
