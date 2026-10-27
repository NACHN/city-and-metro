// 每个片区到底占了多少格 —— 片区是按 OSM 的街道名匹配的，名字写错不会报错，只会静默变成 0 格。
// 新图写完 source.json、build 之后跑一次这个，确认没有空片区。
//
//   node tools/region-cells.mjs wlmq
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const MAP = argv.find((a) => !a.startsWith('--')) || 'wlmq';
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
  const direct = path.join(root, rel);
  if (fs.existsSync(direct)) return direct;
  const parked = path.join(root, 'maps', MAP, 'parked', path.basename(rel));
  return fs.existsSync(parked) ? parked : null;
};
const L = (f) => vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
for (const f of ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js', 'js/geo_gz.js', 'js/geo.js',
  'js/data_gz.js', 'js/data_tutorial.js', 'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js',
  'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js']) L(path.join(root, f));
// 清单里的每张图都按需加载：只加载一张会有「已声明但未登记」的警告，也看不到别的图
const MANIFEST = (() => {
  const box = { window: { CM: {} } };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'manifest.js'), 'utf8'), box, { filename: 'js/manifest.js' });
  return box.window.CM.MAP_MANIFEST || [];
})();
for (const e of MANIFEST) {
  for (const f of [e.geo && pick('js/geo_' + e.geo + '.js'), pick('js/data_' + e.data + '.js')]) if (f) { try { L(f); } catch (err) { /* 缺资源就跳过 */ } }
}
for (const f of ['js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js', 'js/economy.js',
  'js/macro.js', 'js/game.js', 'js/milestones.js']) L(path.join(root, f));

const CM = globalThis.CM;
CM.useMap(MAP);
CM.Geo.init();
const city = new CM.City();
city.generate(CM.CFG.START.y * 10000 + 101, CM.CFG.START.y);

const N = city.region.length;
const cnt = new Int32Array(city.regions.length);
for (let c = 0; c < N; c++) cnt[city.region[c]]++;
const total = N * 0.0625;

console.log(`[${MAP}] ${CM.CFG.W}×${CM.CFG.H} = ${total.toFixed(0)} km² · 片区 ${city.regions.length}`);
let empty = 0, sum = 0;
const rows = city.regions.map((r, i) => ({ i, name: r.name, n: cnt[i], open: r.open, plan: r.plan }));
rows.sort((a, b) => b.n - a.n);
for (const r of rows) {
  if (!r.n) empty++;
  sum += r.n;
  const km2 = (r.n * 0.0625).toFixed(1);
  console.log(`  ${String(r.n).padStart(5)} 格 ${String(km2).padStart(7)} km²  ${r.name}` +
    `  ${r.open == null ? '（永久/景区）' : '开放 ' + r.open}  ${r.plan || ''}`);
}
console.log(`合计 ${sum} / ${N} 格 · 空片区 ${empty} 个${empty ? ' ← 名字对不上 OSM 的 level-8 边界，检查 source.json 的 streets' : ''}`);
