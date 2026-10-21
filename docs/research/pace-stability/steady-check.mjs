// Steady (Poisson 6) miss rate vs history length; separates "truly outside" from ties at band edges.
let s = 12345; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pois = (m) => { let L = Math.exp(-m), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const weeksTo = (draw, rem) => { let w = 0; while (rem > 0) { rem -= draw(); w++; if (w > 500) break; } return w; };
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
for (const n of [5, 10, 20, 40, 80]) {
  let out = 0, edge = 0, oracle = 0; const H = 2000;
  for (let h = 0; h < H; h++) {
    const hist = Array.from({ length: n }, () => pois(6));
    const sims = Array.from({ length: 2000 }, () => weeksTo(() => hist[Math.floor(rnd() * n)], 60)).sort((a, b) => a - b);
    const lo = q(sims, 0.1), hi = q(sims, 0.9), actual = weeksTo(() => pois(6), 60);
    if (actual < lo || actual > hi) out++; if (actual === lo || actual === hi) edge++;
    if (n === 10) { const t = Array.from({ length: 2000 }, () => weeksTo(() => pois(6), 60)).sort((a, b) => a - b); const l = q(t, .1), u = q(t, .9); if (actual < l || actual > u) oracle++; }
  }
  console.log(`n=${n}: outside ${(out / H * 100).toFixed(1)}%, on an edge ${(edge / H * 100).toFixed(1)}%` + (n === 10 ? `; true-process bands: outside ${(oracle / H * 100).toFixed(1)}%` : ''));
}
