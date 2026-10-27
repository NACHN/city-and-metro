// OD 的「精度—性能」对照实验（node scripts/exp-od.mjs）
//
// 不改主代码：把 js/sim.js 的源码读进来，打一处小补丁后放进独立的 vm 上下文，逐个变体重跑同一局面
// （同一张广州图、同一个种子、同一条 24 站十字线网），所以差异只来自补丁本身。
//
// 变体：目的地按距离截断（20/12/8 km）、按排名截断（上限 120/60）、块内共用最短路树（带接入偏移），
// 以及 0.5 km 小区下的两组对照（模拟更大的 OD 规模）。
// 输出：每起点 OD 条数、日均地铁客流与相对基线的偏差、分担率、平均通勤、一轮耗时（相对）。
// 计时是三次取最小、且都跑在同一套 vm 上下文里，所以只看相对值，绝对值会偏慢。
// 每个变体都从同一张地图、同一个种子、同一条线网重新生成城市，所以差异只来自补丁。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRE = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js', 'js/geo_gz2.js', 'js/data_gz2.js','js/geo_sh.js','js/data_sh.js','js/data_tutorial.js',
 'js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js',
 'js/maps.js','js/facility.js','js/city.js','js/metro.js'];
const POST = ['js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js'];
const T = () => Number(process.hrtime.bigint()) / 1e6;

function sandbox() {
  const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {}, append() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, offsetWidth: 100, offsetHeight: 40, innerHTML: '', textContent: '', getContext() { return null; } });
  const sb = { console: { log() {}, warn() {}, error() {} }, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
  sb.window = sb; sb.self = sb; sb.CM = {};
  sb.document = { createElement: el, createElementNS: el, addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }, body: el(), querySelector() { return null; }, getElementById() { return null; } };
  sb.matchMedia = () => ({ matches: false, addEventListener() {} });
  sb.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  vm.createContext(sb);
  return sb;
}
const load = (sb, rel, text) => vm.runInContext(text != null ? text : fs.readFileSync(path.join(root, rel), 'utf8'), sb, { filename: rel });

// ---- 补丁：每个都是一处源码替换，锚点唯一；找不到就直接报错，避免静默跑成基线 ----
const PATCH = {
  cap: function (src, n) {
    const a = 'if (nc > 240) nc = 240;';
    if (src.indexOf(a) < 0) throw new Error('cap 锚点缺失');
    return src.replace(a, 'if (nc > ' + n + ') nc = ' + n + ';');
  },
  // 真正的距离截断：把超过 R 公里的目的地从 OD 记录里去掉（skim 保持完整）
  odcut: function (src) {
    const a = '  function demandOrigin(D, i) {';
    if (src.indexOf(a) < 0) throw new Error('odcut 锚点缺失');
    let s = src.replace(a, '  let OD_CUT = 1e9;\n  CM.setOdCut = function (v) { OD_CUT = v; };\n' + a);
    const b = '      if (nc > 240) nc = 240;';
    if (s.indexOf(b) < 0) throw new Error('odcut 循环锚点缺失');
    s = s.replace(b, b + '\n      if (OD_CUT < 1e9) { let m2 = 0; for (let q = 0; q < nc; q++) { const j = cand[q], ddx = xi - zCx[j], ddy = yi - zCy[j]; if (Math.sqrt(ddx * ddx + ddy * ddy) * kmPerCell <= OD_CUT) cand[m2++] = j; } nc = m2; }');
    return s;
  },
  // 只计时：包裹 roadTree，累计它在整轮里的耗时
  timer: function (src) {
    const a = '  function roadTree(road, rd, time, origin, work, heap) {';
    if (src.indexOf(a) < 0) throw new Error('timer 锚点缺失');
    let s = src.replace(a, a + '\n    const __t0 = performance.now();');
    const b = '    return no;\n  }';
    if (s.indexOf(b) < 0) throw new Error('timer 返回锚点缺失');
    s = s.replace(b, '    CM.__rt = (CM.__rt || 0) + (performance.now() - __t0);\n    return no;\n  }');
    return s;
  },
  // 代表起点（块内共用一棵最短路树）+ 起点到代表点的接入时间偏移
  tree: function (src) {
    let s = src;
    const a = 'const no = roadTree(road, rd, cw.time, o, work, cw.heap);';
    if (s.indexOf(a) < 0) throw new Error('tree 锚点缺失');
    s = s.replace(a, 'const no = roadTree(road, rd, cw.time, (cw.rep ? cw.rep[o] : o), work, cw.heap);\n' +
      '    let offT = 0, offK = 0;\n' +
      '    if (cw.rep && cw.rep[o] !== o) { let bt = Infinity, bkk = 0; for (let k2 = connStart[o]; k2 < connStart[o + 1]; k2++) { const nd2 = connNode[k2], v2 = dist[nd2] + connTime[k2]; if (v2 < bt) { bt = v2; bkk = dkm[nd2] + connKm[k2]; } } if (bt < Infinity) { offT = bt; offK = bkk; } }');
    const b = 'skT[row + d] = best; skK[row + d] = bk;';
    if (s.indexOf(b) < 0) throw new Error('tree skim 锚点缺失');
    s = s.replace(b, 'skT[row + d] = best + offT; skK[row + d] = bk + offK;');
    return s;
  }
};

// 出行距离分布：区块中心直线距离，按 desTot 加权（工作日 + 周末，按小时数折算）
function distProfile(model, CM) {
  const B = model.B, ZW = model.ZW, BW = model.BW;
  const bx = new Float64Array(B), by = new Float64Array(B), bn = new Float64Array(B);
  for (let z = 0; z < model.Z; z++) { const b = (((z / ZW) | 0) >> 1) * BW + ((z % ZW) >> 1); bx[b] += model.zCx[z]; by[b] += model.zCy[z]; bn[b]++; }
  for (let b = 0; b < B; b++) { bx[b] /= Math.max(1, bn[b]); by[b] /= Math.max(1, bn[b]); }
  let tot = 0, t10 = 0, t15 = 0, sumKm = 0;
  for (const dt of ['wd', 'we']) {
    const per = model.ctxs[dt].per;
    for (let p = 0; p < per.length; p++) {
      const P2 = per[p], h = model.pHours[p];
      for (let b1 = 0; b1 < B; b1++) for (let b2 = 0; b2 < B; b2++) {
        const k = b1 * B + b2, t = P2.desTot[k];
        if (t <= 0) continue;
        const dx = bx[b1] - bx[b2], dy = by[b1] - by[b2];
        const km = Math.sqrt(dx * dx + dy * dy) * CM.CFG.CELL_M / 1000;
        const w = t * h;
        tot += w; sumKm += w * km;
        if (km > 10) t10 += w;
        if (km > 15) t15 += w;
      }
    }
  }
  return { t10: tot > 0 ? t10 / tot : 0, t15: tot > 0 ? t15 / tot : 0, avg: tot > 0 ? sumKm / tot : 0 };
}
function run(name, patches, after, withTimer, zone, decay, impMode, opt) {
  const sb = sandbox();
  for (const f of PRE) load(sb, f);
  const CM = sb.CM, M = CM.Metro;
  CM.useMap('gz');
  if (zone) CM.CFG.ZONE = zone;   // 小区边长（格）：2 → 0.5 km，模拟更大城市的 OD 规模
  if (opt && opt.fast) CM.CFG.metro.vmax = { underground: 44, surface: 38, elevated: 44 };   // ≈158 km/h
  if (impMode) CM.CFG.choice.impedance = impMode;   // 'time' → 用广义时间代替直线距离
  if (decay && decay !== 1) {      // 距离衰减的特征长度（km）：放大它 → 允许更长距离的出行
    const c = CM.CFG.choice;
    for (const k of ['distDecayHW', 'distDecayHO']) c[k] = c[k].map(function (p) { return [p[0], p[1] * decay]; });
  }
  // 同一条线网：按人口重心建 24 站十字线
  const city = new CM.City(); city.generate(19900101, 1990);
  let br = -1, bc = -1, row = 40, col = 40;
  for (let j = 8; j < city.H - 8; j++) { let s = 0; for (let i = 10; i < city.W - 10; i++) s += city.pop[j * city.W + i]; if (s > br) { br = s; row = j; } }
  for (let i = 8; i < city.W - 8; i++) { let s = 0; for (let j = 10; j < city.H - 10; j++) s += city.pop[j * city.W + i]; if (s > bc) { bc = s; col = i; } }
  const net = M.empty(), la = M.newLine(net, '横'), lb = M.newLine(net, '竖');
  // opt.line === 'long'：一条贯穿全图的 25 km 干线（4 km 站距，7 站），用来检验「睡城—市中心」的 OD
  if (opt && opt.line === 'long') {
    let prev = null;
    for (let k = 0; k < 7; k++) {
      const s = M.addStation(net, 10 + k * 16 + 0.5, row + 0.5, { size: 'M', type: 'underground' }, city);
      if (prev) M.addSegment(net, la, prev, s, [], 'underground');
      prev = s;
    }
  } else {
    let prev = null;
    for (let k = 0; k < 12; k++) { const s = M.addStation(net, 26 + k * 4 + 0.5, row + 0.5, { size: 'M', type: 'underground' }, city); if (prev) M.addSegment(net, la, prev, s, [], 'underground'); prev = s; }
    prev = null;
    for (let k = 0; k < 12; k++) { const s = M.addStation(net, col + 0.5, 22 + k * 4 + 0.5, { size: 'M', type: 'underground' }, city); if (prev) M.addSegment(net, lb, prev, s, [], 'underground'); prev = s; }
  }
  const compiled = M.compile(net, city);
  // sim.js（带补丁）+ 其余模块
  const simSrc = patches.reduce((s, f) => f(s), fs.readFileSync(path.join(root, 'js/sim.js'), 'utf8'));
  load(sb, 'js/sim.js', simSrc);
  for (const f of POST) load(sb, f);
  const model = new sb.CM.Model(city);
  model.setNetwork(compiled);
  if (after) after(CM, model, city);
  // 真实游戏里需求表是在「有 skim」之后重建的（城市/线网变化时）。这里照同样顺序：
  // 先解一次把 skim 填满，再重建需求，避免时间口径落到自由流兜底上。
  model.solveNow(2);
  model.buildDemand();
  model.solveNow(3);
  const recs = model.od.dest.length;
  let ms = Infinity, rt = 0;
  for (let r = 0; r < 3; r++) {
    if (withTimer) CM.__rt = 0;
    const t0 = T(); model.solveNow(1); const dt = T() - t0;
    if (dt < ms) { ms = dt; rt = CM.__rt || 0; }
  }
  const prof = distProfile(model, CM);
  return { name: name, Z: model.Z, recs: recs, t10: prof.t10, t15: prof.t15, avg: prof.avg, per: recs / model.Z, ms: ms, rt: rt, metro: model.daily.metro, share: model.daily.metroShare, commute: model.daily.commute, trips: model.daily.trips };
}

const rows = [];
const V = [
  { name: '十字线 · 距离', patches: [] },
  { name: '十字线 · 时间', patches: [], imp: 'time' },
  { name: '长线 · 距离', patches: [], opt: { line: 'long' } },
  { name: '长线 · 时间', patches: [], opt: { line: 'long' }, imp: 'time' },
  { name: '长线快车 · 距离', patches: [], opt: { line: 'long', fast: true } },
  { name: '长线快车 · 时间', patches: [], opt: { line: 'long', fast: true }, imp: 'time' },
  { name: '长线快车 · 时间 ×1.5', patches: [], opt: { line: 'long', fast: true }, imp: 'time', decay: 1.5 },
];
for (const v of V) rows.push(run(v.name, v.patches || [], v.setup, v.timer, v.zone, v.decay, v.imp, v.opt));

const b = rows[0];
console.log('');
console.log('变体                       OD 条数  >10km  >15km  均距   通勤   地铁/日     相对基线   分担率   一轮');
for (const r of rows) {
  const d = ((r.metro / b.metro - 1) * 100);
  console.log(r.name.padEnd(25) + String(r.recs).padStart(8) +
    '  ' + (r.t10 * 100).toFixed(1).padStart(5) + '%' +
    '  ' + (r.t15 * 100).toFixed(1).padStart(5) + '%' +
    '  ' + r.avg.toFixed(1).padStart(4) + ' km' +
    '  ' + r.commute.toFixed(1).padStart(4) + ' 分' +
    '  ' + Math.round(r.metro).toLocaleString('en').padStart(9) +
    '  ' + ((d >= 0 ? '+' : '') + d.toFixed(1) + '%').padStart(8) +
    '  ' + (r.share * 100).toFixed(2) + '%' +
    '  ' + r.ms.toFixed(0).padStart(4) + ' ms');
}
