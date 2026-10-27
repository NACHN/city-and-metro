// 月步进的完整时间账：把「剩下的几秒」逐项拆开。
// 用法：node tools/month-breakdown.mjs [mapId] [months]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const MAP = argv.find((a) => !a.startsWith('--')) || 'gz2';
const MONTHS = +(argv.find((a) => a.startsWith('--months=')) || '--months=4').split('=')[1];
const TOL = +(argv.find((a) => a.startsWith('--tol=')) || '').split('=')[1];
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
if (Number.isFinite(TOL)) { CM.CFG.road.routeTolKm = TOL; CM.CFG.road.routeTol = 0; }
// --hop=：复刻「每跳固定分钟」的老口径（routeTolKm 归零），用于 A/B
const HOP = +(argv.find((a) => a.startsWith('--hop=')) || '').split('=')[1];
if (Number.isFinite(HOP)) { CM.CFG.road.routeTol = HOP; CM.CFG.road.routeTolKm = 0; }
// --lazy=：懒分配判定的门槛（分钟/公里）；0 = 老的百分比口径
const LZ = +(argv.find((a) => a.startsWith('--lazy=')) || '').split('=')[1];
if (Number.isFinite(LZ)) CM.CFG.road.lazyTolKm = LZ;

const t0 = performance.now();
const g = CM.Game.create({ map: MAP, preset: 'normal', name: 'mb' });
const tCreate = performance.now() - t0;
const m = g.model;

// ---- 计时容器 ----
const ACC = {};
const add = (k, t) => { ACC[k] = (ACC[k] || 0) + t; };
const wrapSync = (obj, key, name) => {
  const f = obj[key];
  if (typeof f !== 'function') return;
  obj[key] = function (...a) { const t = performance.now(); const r = f.apply(this, a); add(name, performance.now() - t); return r; };
};
const wrapGen = (obj, key, name) => {
  const f = obj[key];
  if (typeof f !== 'function') return;
  obj[key] = function* (...a) { const t = performance.now(); try { yield* f.apply(this, a); } finally { add(name, performance.now() - t); } };
};

// 哪些时段这个月是「重放」、哪些是「重建」
let replayKeys = new Set(), capKeys = new Set(), seenKeys = new Set();
const r0 = CM.Model.prototype.treeReplayFor, c0 = CM.Model.prototype.treeCaptureFor;
CM.Model.prototype.treeReplayFor = function (dt, p) {
  const v = r0.apply(this, arguments);
  if (v) replayKeys.add(dt + '|' + p);
  return v;
};
CM.Model.prototype.treeCaptureFor = function (dt, p) {
  const v = c0.apply(this, arguments);
  if (v) capKeys.add(dt + '|' + p);
  return v;
};

// iterate 的耗时按「第一个 cycle / 后续 cycle」拆开
const it0 = CM.Model.prototype.iterate;
CM.Model.prototype.iterate = function* (net, P, p, opts) {
  const key = P.dt + '|' + p;
  const first = !seenKeys.has(key);
  seenKeys.add(key);
  // 名字要按**实际**命中来取，不能假设「第一个 cycle 之后都是懒分配」：
  // 懒判定有 2% 的弧变动上限与连懒 3 轮的上限，后面的 cycle 经常还是全量建树。
  const lz0 = P.lazyStreak || 0;
  const t = performance.now();
  try { yield* it0.call(this, net, P, p, opts); } finally {
    const lazy = (P.lazyStreak || 0) > lz0;
    const name = first ? (replayKeys.has(key) ? 'cycle0 · 重放树' : (capKeys.has(key) ? 'cycle0 · 重建树' : 'cycle0 · 其它'))
      : (lazy ? '后续 cycle（懒分配）' : '后续 cycle（重建树）');
    add(name, performance.now() - t);
  }
};

wrapGen(CM.Model.prototype, 'refreshCityGen', 'A 城市与需求刷新（合计）');
wrapGen(CM.Model.prototype, 'buildDemandGen', 'A1 · 重建需求表');
wrapSync(CM.Model.prototype, 'buildZones', 'A0 · 重划小区');
wrapSync(CM.Model.prototype, 'syncRoad', 'A2 · 同步路网');
wrapSync(CM.Model.prototype, 'setNetwork', 'A3 · 编译线网');
wrapSync(CM.Model.prototype, 'computeLandAccess', 'A4 · 土地可达性');
wrapSync(CM.Model.prototype, 'computeJobAccess', 'A5 · 就业可达性');
wrapSync(CM.Model.prototype, 'computeDaily', 'B · 统计日指标（computeDaily）');
wrapSync(CM.City.prototype, 'growMonth', 'C · 城市生长（人口/就业/地价扩散）');
wrapSync(CM.City.prototype, 'buildLandPrice', 'C2 · 地价');
wrapSync(CM.Metro, 'compile', 'D · 编译地铁');
wrapSync(CM.Economy.prototype, 'updateSatisfaction', 'E · 满意度');
wrapSync(CM.Economy.prototype, 'openMonth', 'E2 · 经营开账');
wrapSync(CM.Game.prototype, 'accrueProperty', 'E3 · 物业收入');
wrapSync(CM.Game.prototype, 'recordHistory', 'E4 · 历史记录');

// 只跑到「收敛」= 玩家等待的那一段；月末预建是后台的事，单独计时
const settle = () => { let guard = 0; while (!m.settled && guard++ < 800) m.step(4000); };
const settleRest = () => { let guard = 0; while ((!m.settled || m.prebuilding) && guard++ < 4000) m.step(4000); };
settle();
console.log(`[${MAP}] 建局 ${(tCreate / 1000).toFixed(1)} s · 小区 ${m.Z} · 节点 ${m.road.nN} · 弧 ${m.road.nA}`);
console.log('（node 单线程；浏览器大约快 1.8–1.9 倍）\n');

for (let i = 1; i <= MONTHS; i++) {
  for (const k in ACC) delete ACC[k];
  replayKeys = new Set(); capKeys = new Set(); seenKeys = new Set();
  let crossed = false;
  while (!crossed) crossed = g.endDay();
  const tA = performance.now();
  const gen = g.monthGen();
  for (let r = gen.next(); !r.done; r = gen.next()) { /* 跑完 */ }
  const tCity = performance.now() - tA;
  settle();
  const total = performance.now() - tA;
  const tPb = performance.now();
  settleRest();
  const msPb = performance.now() - tPb;
  const cycles = m.solveCycles;
  const c = m.treeCache;
  const mode = !c ? '无缓存' : (c.fresh ? '预建命中（复用）' : '缓存失效（重建）');
  console.log(`── 第 ${i} 个月 · ${mode} · 合计 ${(total / 1000).toFixed(2)} s · ${cycles} 轮 ──`);
  const rows = Object.entries(ACC).filter(([k]) => !k.startsWith('A ')).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of rows) {
    if (v < 1) continue;
    console.log(`   ${k.padEnd(30)} ${(v / 1000).toFixed(2).padStart(6)} s  ${(v / total * 100).toFixed(1).padStart(5)}%`);
  }
  const acc = ACC['A 城市与需求刷新（合计）'] || 0;
  console.log(`   （其中 monthGen 合计 ${(tCity / 1000).toFixed(2)} s，refreshCityGen ${(acc / 1000).toFixed(2)} s；月末预建 ${(msPb / 1000).toFixed(2)} s 在后台）`);
  // 结果侧的三个数：容差改动只能影响「路径怎么走」，所以看车时、车速与分担率有没有漂
  const d = m.daily || {};
  const carKm = d.carPkm || 0, carH = (d.carTime || 0) / 60;
  console.log(`   结果：出行 ${Math.round(d.trips || 0)} · 地铁分担 ${(100 * (d.metroShare || 0)).toFixed(2)}%`
    + ` · 车公里 ${Math.round(carKm).toLocaleString()} · 车时 ${Math.round(d.carTime || 0).toLocaleString()} 车分钟`
    + ` · 车均速 ${(carKm / Math.max(1e-9, carH)).toFixed(2)} km/h · 拥堵 ${(d.cong || 1).toFixed(4)} · 全方式 ${(d.avgTime || 0).toFixed(1)} 分钟`);
  console.log('');
}
