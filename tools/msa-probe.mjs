// MSA 步长 × 懒分配稳定标记：四种组合的收敛轮数与数值
//
// 背景：月步进里 46% 的时间是「后续 cycle（懒分配）」——车流冻结、需求没变，
// 只重算方式选择，结果必然与上一轮相同。它停不下来是因为懒分配分支里有一句
// `stable = false`，导致「连续两轮稳定」永远不成立，只能靠 maxSolveCycles 硬刹。
//
// 步长是另一件事：`lam = P.iters === 0 ? 1 : (opts.lam || CFG.road.msa)`，
// 常数 0.4 让残差按 0.6^n 衰减（4 轮后还剩 13% 的缺口）。
//
// 本工具同时测两件事，看它们怎么互相影响：
//   A 现状           λ=0.4 + stable=false
//   B 去掉空转标记    λ=0.4
//   C 去标记 + 1/n    λ=1/(轮次+1)
//   D 1/n + 标记      λ=1/(轮次+1) + stable=false
//
// 用法：node tools/msa-probe.mjs [mapId] [--months=2]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const MAP = argv.find((a) => !a.startsWith('--')) || 'gz2';
const MONTHS = +(argv.find((a) => a.startsWith('--months=')) || '--months=2').split('=')[1];

const NOOP = () => {};

function makeSandbox(inv) {
  const sb = {
    console: { log: NOOP, warn: NOOP, error: NOOP },
    performance,
    __INV: inv,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, Object, Array, Map, Set, Promise, Symbol,
    Float32Array, Float64Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray, ArrayBuffer, DataView,
    isFinite, isNaN, parseFloat, parseInt,
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  const mk = () => ({ style: { setProperty: NOOP }, getContext: () => new Proxy({}, { get: () => NOOP }), addEventListener: NOOP, appendChild: (c) => c, setAttribute: NOOP, classList: { add: NOOP, remove: NOOP }, querySelectorAll: () => [] });
  sb.document = { createElement: mk, createElementNS: mk, body: mk(), documentElement: mk(), querySelector: () => null, getElementById: mk, addEventListener: NOOP };
  sb.addEventListener = NOOP;
  sb.matchMedia = () => ({ matches: false, addEventListener: NOOP });
  sb.localStorage = { getItem: () => null, setItem: NOOP, removeItem: NOOP };
  sb.requestAnimationFrame = () => 0;
  sb.Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} arc() {} };
  return vm.createContext(sb);
}

function load(sb, rel, srcOverride) {
  const code = srcOverride != null ? srcOverride : fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(root, rel), 'utf8');
  vm.runInContext(code, sb, { filename: rel });
}

const parked = (rel) => {
  const p = path.join(root, 'maps', MAP, 'parked', path.basename(rel));
  return fs.existsSync(path.join(root, rel)) ? path.join(root, rel) : p;
};

const LAM_LINE = 'const lam = P.iters === 0 ? 1 : (opts.lam || CFG.road.msa);';
const LAM_INV = 'const lam = P.iters === 0 ? 1 : (opts.lam || (globalThis.__INV ? 1 / (Math.max(0, this.solveCycles) + 1) : CFG.road.msa));';
const LAZY_STABLE = '      stable = false;   // 沿用结果不算稳定，避免被当成「已收敛」而永久冻结\n';

function buildSimSource(noFreeze, inv) {
  let s = fs.readFileSync(path.join(root, 'js/sim.js'), 'utf8');
  if (noFreeze) {
    if (!s.includes(LAZY_STABLE)) throw new Error('找不到懒分配的 stable = false');
    s = s.replace(LAZY_STABLE, '');
  }
  if (inv) {
    if (!s.includes(LAM_LINE)) throw new Error('找不到步长那一行');
    s = s.replace(LAM_LINE, LAM_INV);
  }
  // 真实分支打点：跳过（stable）/ 懒分配（时间没怎么变）/ 全量
  s = s.replace('if (P.stable && !opts.fullSkim) { P.iters++; return; }',
    'if (P.stable && !opts.fullSkim) { this._skip = (this._skip || 0) + 1; P.iters++; return; }');
  s = s.replace('if (moved <= nA * LAZY_FRAC) opts = Object.assign({}, opts, { lazyCar: true });',
    'if (moved <= nA * LAZY_FRAC) { this._lazy = (this._lazy || 0) + 1; opts = Object.assign({}, opts, { lazyCar: true }); }');
  return s;
}

const VARIANTS = [
  { name: 'A 现状 λ=0.4 + 冻结标记', noFreeze: false, inv: false },
  { name: 'B λ=0.4，去掉冻结标记', noFreeze: true, inv: false },
  { name: 'C λ=1/n，去掉冻结标记', noFreeze: true, inv: true },
  { name: 'D λ=1/n + 冻结标记', noFreeze: false, inv: true },
  { name: 'E λ=0.2，去掉冻结标记', noFreeze: true, inv: false, msa: 0.2 },
];

const out = [];
for (const v of VARIANTS) {
  const sb = makeSandbox(v.inv);
  load(sb, 'js/util.js'); load(sb, 'js/config.js'); load(sb, 'js/manifest.js'); load(sb, 'js/news.js');
  for (const f of ['js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/data_tutorial.js',
    'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js', 'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js']) load(sb, f);
  load(sb, parked('js/geo_' + MAP + '.js'));
  load(sb, parked('js/data_' + MAP + '.js'));
  load(sb, 'js/maps.js'); load(sb, 'js/facility.js'); load(sb, 'js/city.js'); load(sb, 'js/metro.js');
  vm.runInContext(buildSimSource(v.noFreeze, v.inv), sb, { filename: 'js/sim.js' });
  for (const f of ['js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js']) load(sb, f);

  const CM = sb.CM;
  CM.useMap(MAP);
  if (v.msa) CM.CFG.road.msa = v.msa;
  const t0 = performance.now();
  const g = CM.Game.create({ map: MAP, preset: 'normal', name: 'msa' });
  const msCreate = performance.now() - t0;
  const m = g.model;
  const settle = () => { let n = 0; while (!m.settled && n++ < 900) m.step(4000); };
  const settleRest = () => { let n = 0; while ((!m.settled || m.prebuilding) && n++ < 4000) m.step(4000); };
  settle(); settleRest();

  // 数 iterate 调用与全量/懒的次数
  // 计数器挂在 model 实例上，避免跨 vm context 取不到 globalThis
  const origIterate = CM.Model.prototype.iterate;
  CM.Model.prototype.iterate = function* (net, P, p, opts) {
    this._it = (this._it || 0) + 1;
    if (opts && opts.lazyCar) this._lazy = (this._lazy || 0) + 1; else this._full = (this._full || 0) + 1;
    yield* origIterate.call(this, net, P, p, opts);
  };

  const rows = [];
  for (let i = 1; i <= MONTHS; i++) {
    let crossed = false;
    while (!crossed) crossed = g.endDay();
    m._it = 0; m._full = 0; m._lazy = 0; m._skip = 0;
    const t = performance.now();
    const gen = g.monthGen();
    for (let r = gen.next(); !r.done; r = gen.next()) { /* 跑完 */ }
    settle();
    const ms = performance.now() - t;
    const d = m.daily || {};
    rows.push({ i, ms, iters: m._it, full: m._it - m._lazy - m._skip, lazy: m._lazy, skip: m._skip, trips: Math.round(d.trips || 0), commute: d.commute || 0, cong: d.cong || 0 });
    settleRest();
  }
  const last = rows[rows.length - 1];
  out.push({ name: v.name, msCreate, ...last });
  console.log(`[${v.name}] create ${(msCreate / 1000).toFixed(1)}s · 月步进 ${(last.ms / 1000).toFixed(2)}s`
    + ` · 时段求解 ${last.iters}（全量 ${last.full} / 懒 ${last.lazy} / 跳过 ${last.skip}）`
    + ` · 客流 ${last.trips.toLocaleString()} · 车时 ${last.commute.toFixed(4)} · 拥堵 ${last.cong.toFixed(4)}`);
}

console.log('\n汇总（第 ' + MONTHS + ' 个月）：');
console.log('配置                        月步进   时段求解  全量/懒      客流        车时      拥堵');
for (const r of out) {
  console.log(r.name.padEnd(26) + (r.ms / 1000).toFixed(2).padStart(6) + 's'
    + String(r.iters).padStart(8) + ('  ' + r.full + '/' + r.lazy + '/' + r.skip).padStart(12)
    + r.trips.toLocaleString().padStart(12) + r.commute.toFixed(4).padStart(10) + r.cong.toFixed(4).padStart(9));
}
