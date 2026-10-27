// 确认跨月树缓存真的在用，并量它带来的时间与数值变化。
// 用法：node tools/cache-check.mjs [mapId] [months] [--off]
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const MAP = argv.find((a) => !a.startsWith('--')) || 'gz2';
const MONTHS = +(argv.find((a) => a.startsWith('--months=')) || '--months=5').split('=')[1];
const OFF = argv.includes('--off');
const NOOP = () => {};
globalThis.window = globalThis; globalThis.self = globalThis;
const mk = () => ({ style: { setProperty: NOOP }, getContext: () => new Proxy({}, { get: () => NOOP }), addEventListener: NOOP, appendChild: (c) => c, setAttribute: NOOP, classList: { add: NOOP, remove: NOOP }, querySelectorAll: () => [] });
globalThis.document = { createElement: mk, createElementNS: mk, body: mk(), documentElement: mk(), querySelector: () => null, getElementById: mk, addEventListener: NOOP };
globalThis.addEventListener = NOOP; globalThis.matchMedia = () => ({ matches: false, addEventListener: NOOP });
globalThis.localStorage = { getItem: () => null, setItem: NOOP, removeItem: NOOP }; globalThis.requestAnimationFrame = () => 0;
globalThis.Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} arc() {} };
const parked = (rel) => { const p = path.join(root, 'maps', MAP, 'parked', path.basename(rel)); return fs.existsSync(path.join(root, rel)) ? path.join(root, rel) : p; };
const L = (f) => vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
for (const f of ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js', 'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/data_tutorial.js', 'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js', 'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js']) L(path.join(root, f));
L(parked('js/geo_' + MAP + '.js')); L(parked('js/data_' + MAP + '.js'));
for (const f of ['js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js', 'js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js']) L(path.join(root, f));
const CM = globalThis.CM;
if (OFF) CM.CFG.perf.treeCache = false;
CM.useMap(MAP);
const g = CM.Game.create({ map: MAP, preset: 'normal', name: 'ck' });
const m = g.model;
// 统计「复用了几次 / 重建了几次」
let rep = 0, cap = 0;
const r0 = CM.Model.prototype.treeReplayFor, c0 = CM.Model.prototype.treeCaptureFor;
CM.Model.prototype.treeReplayFor = function (...a) { const v = r0.apply(this, a); if (v) rep++; return v; };
CM.Model.prototype.treeCaptureFor = function (...a) { const v = c0.apply(this, a); if (v) cap++; return v; };
const settle = () => { let guard = 0; while (!m.settled && guard++ < 600) m.step(2000); };
settle();
console.log(`[${MAP}] 缓存${OFF ? '关' : '开'} · 小区 ${m.Z} · 节点 ${m.road.nN} · 弧 ${m.road.nA}`);
console.log('月  缓存   复用/重建   月步进      客流        地铁分担   车时');
for (let i = 1; i <= MONTHS; i++) {
  let crossed = false; while (!crossed) crossed = g.endDay();
  const t0 = performance.now();
  const gen = g.monthGen(); for (let r = gen.next(); !r.done; r = gen.next()) { /* 跑完 */ }
  rep = 0; cap = 0;
  const sc0 = m.sinceChange, age0 = m.treeCache ? m.treeCache.age : -1;
  settle();
  const ms = performance.now() - t0;
  const c = m.treeCache;
  const d = m.daily || {};
  console.log(`${String(i).padStart(2)}  ${c ? ('age' + c.age).padEnd(6) : '无    '} ${String(rep).padStart(3)}/${String(cap).padEnd(4)}`
    + `  ${ms.toFixed(0).padStart(6)} ms  ${Math.round(d.trips || 0).toLocaleString().padStart(10)}`
    + `  ${((d.metroShare || 0) * 100).toFixed(3).padStart(7)}%  ${(d.commute || 0).toFixed(4).padStart(8)}` + '  sinceChange ' + sc0 + '→' + m.sinceChange + ' 缓存年龄 ' + age0 + '→' + (m.treeCache ? m.treeCache.age : -1));
}
if (m.treeCache && m.treeCache.lastRemap) console.log('最近一次重映射', JSON.stringify(m.treeCache.lastRemap));
