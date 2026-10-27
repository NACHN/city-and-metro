// 路段长度分布：路径惰性容差要按「路口到路口的实际长度」给，先看看这个尺度的真实分布。
// 用法：node tools/arc-stats.mjs [mapId]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const MAP = argv.find((a) => !a.startsWith('--')) || 'gz2';
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

const parked = (rel) => {
  const p = path.join(root, 'maps', MAP, 'parked', path.basename(rel));
  return fs.existsSync(path.join(root, rel)) ? path.join(root, rel) : p;
};
const L = (f) => vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
for (const f of ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js', 'js/geo_gz.js', 'js/geo.js',
  'js/data_gz.js', 'js/data_tutorial.js', 'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js',
  'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js']) L(path.join(root, f));
L(parked('js/geo_' + MAP + '.js'));
L(parked('js/data_' + MAP + '.js'));
for (const f of ['js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js', 'js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js']) L(path.join(root, f));

const CM = globalThis.CM;
CM.useMap(MAP);
const g = CM.Game.create({ map: MAP, preset: 'normal', name: 'arc' });
const road = g.model.road;
const nA = road.nA;
const len = Array.from(road.arcLen, (v) => v);
const t0 = Array.from(road.arcT0, (v) => v);
const km = Array.from(road.arcCap, (v) => v);

// 只统计有向弧成对的一半（0,2,4…）就够看分布
const half = [];
for (let a = 0; a < nA; a += 2) half.push({ km: len[a] / 1000, t0: t0[a], cap: km[a] });
half.sort((x, y) => x.km - y.km);
const q = (f) => half[Math.min(half.length - 1, Math.floor(f * half.length))].km;
const mean = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;

console.log(`[${MAP}] 无向路段 ${half.length} 条（有向 ${nA}）· 节点 ${road.nN}`);
console.log(`长度 km   p10 ${q(0.1).toFixed(3)}  p25 ${q(0.25).toFixed(3)}  p50 ${q(0.5).toFixed(3)}  p75 ${q(0.75).toFixed(3)}  p90 ${q(0.9).toFixed(3)}  p99 ${q(0.99).toFixed(3)}  max ${q(0.999).toFixed(2)}`);
console.log(`平均 ${mean(half, (x) => x.km).toFixed(3)} km · 平均自由流 ${mean(half, (x) => x.t0).toFixed(2)} 分钟`);
console.log(`每跳 0.15 分钟折成 min/km：p50 ${(0.15 / q(0.5)).toFixed(2)} · 均值 ${(0.15 / mean(half, (x) => x.km)).toFixed(2)}`);

// 路程长度分布：抽若干起点，沿最短路看每趟的物理里程
const m = g.model;
let n0 = 0;
while (!m.settled && n0++ < 900) m.step(4000);
const P = m.ctxs.wd.per[0];
const skK = P.skimK, Z = m.Z;
const trip = [];
for (let o = 0; o < Z; o += 7) {
  for (let d = 0; d < Z; d++) {
    const v = skK[o * Z + d];
    if (v > 0) trip.push(v);
  }
}
trip.sort((x, y) => x - y);
const tq = (f) => trip[Math.min(trip.length - 1, Math.floor(f * trip.length))];
console.log(`行程 km（${trip.length} 个 OD）  p10 ${tq(0.1).toFixed(1)}  p50 ${tq(0.5).toFixed(1)}  p90 ${tq(0.9).toFixed(1)}  p99 ${tq(0.99).toFixed(1)} · 均值 ${(trip.reduce((s, x) => s + x, 0) / trip.length).toFixed(1)}`);
console.log(`若容差 = 0.3 min/km：p50 行程 ${(tq(0.5) * 0.3).toFixed(1)} 分钟 · 均值 ${(trip.reduce((s, x) => s + x, 0) / trip.length * 0.3).toFixed(1)} 分钟`);
