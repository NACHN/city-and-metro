// 机场与「新区开放年」体检：这张图上，哪些地方 2000 年就能设站，哪些要等到某一年。
// 用法：node tools/airport-check.mjs [mapId]
// 为什么需要它：机场片区写 `open: 2099` 等于永久不开放，而历史任务又要求「通到机场」——
// 任务在数学上就不可能完成。正确写法是 airport.buildable + 片区 open 正常年份：
// 用地仍然不开发，但允许地下设站与地下穿越（台北松山就是这么写的）。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const MAP = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'wlmq';
const NOOP = () => {};
globalThis.window = globalThis;
globalThis.self = globalThis;
const mkEl = () => ({
  style: { setProperty: NOOP }, getContext: () => new Proxy({}, { get: () => NOOP }),
  addEventListener: NOOP, appendChild: (c) => c, setAttribute: NOOP,
  classList: { add: NOOP, remove: NOOP }, querySelectorAll: () => [],
});
globalThis.document = {
  createElement: mkEl, createElementNS: mkEl, body: mkEl(), documentElement: mkEl(),
  querySelector: () => null, getElementById: mkEl, addEventListener: NOOP,
};
globalThis.addEventListener = NOOP;
globalThis.matchMedia = () => ({ matches: false, addEventListener: NOOP });
globalThis.localStorage = { getItem: () => null, setItem: NOOP, removeItem: NOOP };
globalThis.requestAnimationFrame = () => 0;
globalThis.Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} arc() {} };

const pick = (rel) => {
  if (fs.existsSync(path.join(root, rel))) return path.join(root, rel);
  const p = path.join(root, 'maps', MAP, 'parked', path.basename(rel));
  return fs.existsSync(p) ? p : null;
};
const L = (f) => vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
for (const f of ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js', 'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js']) L(path.join(root, f));
for (const f of [pick('js/geo_' + MAP + '.js'), pick('js/data_' + MAP + '.js')].filter(Boolean)) L(f);
for (const f of ['js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js']) L(path.join(root, f));

const CM = globalThis.CM;
CM.useMap(MAP);
const D = CM.DATA;
CM.Geo.init();
const city = new CM.City();
city.generate(CM.CFG.START.y * 10000 + 101, CM.CFG.START.y);
const N = city.W * city.H;

console.log(`[${MAP}] ${city.W}×${city.H} · 机场 ${D.airport ? JSON.stringify(D.airport) : '（无）'}`);

// 1) 机场：能不能地下设站、能不能地面设站
if (D.airport && D.airport.name) {
  const k = city.regions.findIndex((r) => r.id === 'airport');
  if (k < 0) console.log('  ! 机场没有片区（<id>airport</id>），跑道与「不能开发」都不会生效');
  else {
    const rg = city.regions[k];
    // 取一块**真正的机场用地**格来试 —— 片区的质心可能落在多边形中间的空洞里，
    // 那格里不是 AIRPORT，量出来自然是「地面站也能建」。
    let cx = 0, cy = 0, n = 0, first = -1;
    for (let c = 0; c < N; c++) if (city.region[c] === k && city.lu[c] === CM.LU.AIRPORT) { cx += c % city.W + 0.5; cy += ((c / city.W) | 0) + 0.5; n++; if (first < 0) first = c; }
    let x = n ? cx / n : rg.cx, y = n ? cy / n : rg.cy;
    if (n) {
      let best = 1e9;
      for (let c = 0; c < N; c++) if (city.region[c] === k && city.lu[c] === CM.LU.AIRPORT) {
        const d = Math.abs(c % city.W + 0.5 - x) + Math.abs(((c / city.W) | 0) + 0.5 - y);
        if (d < best) { best = d; x = c % city.W + 0.5; y = ((c / city.W) | 0) + 0.5; }
      }
    }
    console.log(`  机场片区「${rg.name}」开放年 ${rg.open} · 跑道格 ${n} 个 · 中心 (${x.toFixed(1)}, ${y.toFixed(1)})`);
    for (const t of ['underground', 'surface']) {
      const r = CM.Metro.checkSite(city, x, y, t);
      console.log(`  设站(${t})：${r.ok ? '可以' : '不行 — ' + r.msg}`);
    }
    if (!rg.open || rg.open > 2100) console.log('  ! 片区开放年 ≥ 2100：整片永久不开放，任何「通到机场」的任务都不可能完成');
  }
}

// 2) 片区开放年：按年份列出这一年开始能设站的片区
const byYear = new Map();
city.regions.forEach((rg) => {
  if (rg.scenic) return;
  const y = rg.open == null ? CM.CFG.START.y : Math.max(CM.CFG.START.y, rg.open);
  if (!byYear.has(y)) byYear.set(y, []);
  byYear.get(y).push(`${rg.name}(${rg.cells}格)`);
});
console.log('  开放年（同年可设站的片区）：');
for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
  const list = byYear.get(y);
  console.log(`    ${y}  ${list.slice(0, 6).join(' · ')}${list.length > 6 ? ` … 共 ${list.length} 片` : ''}`);
}

// 3) 2000 年就能设站的格数占比
let open0 = 0, urban0 = 0;
for (let c = 0; c < N; c++) {
  const rg = city.regions[city.region[c]];
  if (rg.scenic) continue;
  const y = rg.open == null ? CM.CFG.START.y : Math.max(CM.CFG.START.y, rg.open);
  if (y <= CM.CFG.START.y) { open0++; if (city.lu[c] !== CM.LU.RURAL) urban0++; }
}
console.log(`  开局可设站 ${open0} 格（${(open0 * 0.0625).toFixed(1)} km²），其中已有城市用地 ${urban0} 格`);
