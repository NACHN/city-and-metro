import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const root = 'C:/dev/city-and-metro';
const MAP = process.argv[2] || 'gz2';
globalThis.window = globalThis; globalThis.CM = {};
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/geo_' + MAP + '.js'), 'utf8'), { filename: 'geo' });
const g = globalThis.CM.GEOS[MAP], P = 64;
function dec(s) {
  const o = []; let i = 0, x = 0, y = 0;
  while (i < s.length) {
    let r = 0, sh = 0, b;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    x += (r & 1) ? ~(r >> 1) : (r >> 1);
    r = 0; sh = 0;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    y += (r & 1) ? ~(r >> 1) : (r >> 1);
    o.push(x / P, y / P);
  }
  return o;
}
const polys = [];
for (const r of g.water) {
  if (typeof r[1] === 'number') continue;
  const rings = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let k = 1; k < r.length; k++) {
    const p = dec(r[k].slice(1)); rings.push(p);
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  }
  polys.push({ rings, x0, y0, x1, y1 });
}
const lines = [];
for (const r of g.water) {
  if (typeof r[1] !== 'number') continue;
  const p = dec(r[2]);
  if (p.length < 4) continue;
  const pts = []; for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  lines.push({ w: r[1], pts, nm: g.names[r[0]] || '' });
}
const inRing = (x, y, r) => {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
};
const covered = (x, y) => {
  for (const o of polys) {
    if (x < o.x0 || x > o.x1 || y < o.y0 || y > o.y1) continue;
    let c = false;
    for (const r of o.rings) if (inRing(x, y, r)) c = !c;
    if (c) return true;
  }
  return false;
};
let nAll = 0, nMid = 0, lenAll = 0, lenOut = 0;
const worst = [];
for (const l of lines) {
  const a = l.pts[(l.pts.length / 2 | 0) - 1] || l.pts[0], b = l.pts[l.pts.length / 2 | 0];
  nAll++;
  if (covered((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) nMid++;
  let out = 0, all = 0;
  for (let i = 1; i < l.pts.length; i++) {
    const p = l.pts[i - 1], q = l.pts[i];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]); all += d;
    const steps = Math.max(1, Math.ceil(d * 4));
    let o = 0;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      if (!covered(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)) o++;
    }
    out += d * o / steps;
  }
  lenAll += all; lenOut += out;
  if (out > 1) worst.push({ ...l, out, all });
}
console.log(`[${MAP}] 水面 ${polys.length} 个 · 水系线 ${nAll} 条`);
console.log(`  线中段落在水面内的：${nMid} 条（${(100 * nMid / nAll).toFixed(1)}%）`);
console.log(`  线总长 ${lenAll.toFixed(1)} 格，其中在水面外 ${lenOut.toFixed(1)} 格（${(100 * lenOut / lenAll).toFixed(1)}%）`);
worst.sort((a, b) => b.out - a.out);
console.log('  水面外露最多的 8 条：');
for (const w of worst.slice(0, 8)) console.log(`    宽 ${String(w.w).padStart(4)}  岸外 ${w.out.toFixed(1)} 格 / 共 ${w.all.toFixed(1)} 格  ${w.nm || '（无名）'}`);
