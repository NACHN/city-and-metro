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
const PRE = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js','js/data_tutorial.js',
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

function run(name, patches, after, withTimer, zone) {
  const sb = sandbox();
  for (const f of PRE) load(sb, f);
  const CM = sb.CM, M = CM.Metro;
  CM.useMap('gz');
  if (zone) CM.CFG.ZONE = zone;   // 小区边长（格）：2 → 0.5 km，模拟更大城市的 OD 规模
  // 同一条线网：按人口重心建 24 站十字线
  const city = new CM.City(); city.generate(19900101, 1990);
  let br = -1, bc = -1, row = 40, col = 40;
  for (let j = 8; j < city.H - 8; j++) { let s = 0; for (let i = 10; i < city.W - 10; i++) s += city.pop[j * city.W + i]; if (s > br) { br = s; row = j; } }
  for (let i = 8; i < city.W - 8; i++) { let s = 0; for (let j = 10; j < city.H - 10; j++) s += city.pop[j * city.W + i]; if (s > bc) { bc = s; col = i; } }
  const net = M.empty(), la = M.newLine(net, '横'), lb = M.newLine(net, '竖');
  let prev = null;
  for (let k = 0; k < 12; k++) { const s = M.addStation(net, 26 + k * 4 + 0.5, row + 0.5, { size: 'M', type: 'underground' }, city); if (prev) M.addSegment(net, la, prev, s, [], 'underground'); prev = s; }
  prev = null;
  for (let k = 0; k < 12; k++) { const s = M.addStation(net, col + 0.5, 22 + k * 4 + 0.5, { size: 'M', type: 'underground' }, city); if (prev) M.addSegment(net, lb, prev, s, [], 'underground'); prev = s; }
  const compiled = M.compile(net, city);
  // sim.js（带补丁）+ 其余模块
  const simSrc = patches.reduce((s, f) => f(s), fs.readFileSync(path.join(root, 'js/sim.js'), 'utf8'));
  load(sb, 'js/sim.js', simSrc);
  for (const f of POST) load(sb, f);
  const model = new sb.CM.Model(city);
  model.setNetwork(compiled);
  if (after) after(CM, model, city);
  model.buildDemand();   // 需求表在构造时已建好；补丁只影响重建，所以这里重建一次
  model.solveNow(3);
  const recs = model.od.dest.length;
  let ms = Infinity, rt = 0;
  for (let r = 0; r < 3; r++) {
    if (withTimer) CM.__rt = 0;
    const t0 = T(); model.solveNow(1); const dt = T() - t0;
    if (dt < ms) { ms = dt; rt = CM.__rt || 0; }
  }
  return { name: name, Z: model.Z, recs: recs, per: recs / model.Z, ms: ms, rt: rt, metro: model.daily.metro, share: model.daily.metroShare, commute: model.daily.commute, trips: model.daily.trips };
}

const rows = [];
const V = [
  { name: '基线', patches: [] },
  { name: '基线（含最短路计时）', patches: [s => PATCH.timer(s)], timer: true },
  { name: 'OD 上限 120', patches: [s => PATCH.cap(s, 120)] },
  { name: 'OD 上限 60', patches: [s => PATCH.cap(s, 60)] },
  { name: '目的地截断 20 km', patches: [s => PATCH.odcut(s)], setup: function (CM) { CM.setOdCut(20); } },
  { name: '目的地截断 12 km', patches: [s => PATCH.odcut(s)], setup: function (CM) { CM.setOdCut(12); } },
  { name: '目的地截断 8 km', patches: [s => PATCH.odcut(s)], setup: function (CM) { CM.setOdCut(8); } },
  { name: '细分小区 基线', patches: [], zone: 2 },
  { name: '细分小区 截断 12 km', patches: [s => PATCH.odcut(s)], setup: function (CM) { CM.setOdCut(12); }, zone: 2 },
  { name: '块内共用树（人口）', patches: [s => PATCH.tree(s)], setup: function (CM, model) {
    const rep = reps(model, 'pop');
    model._treeRep = rep;
  } },
  { name: '块内共用树（几何）', patches: [s => PATCH.tree(s)], setup: function (CM, model) { model._treeRep = reps(model, 'geo'); } },
];
function reps(model, how) {
  const Z = model.Z, ZW = model.ZW, BW = model.BW, x = model.zCx, y = model.zCy;
  const blockOf = function (z) { return (((z / ZW) | 0) >> 1) * BW + ((z % ZW) >> 1); };
  const repBlock = new Int32Array(model.B).fill(-1), best = new Float64Array(model.B).fill(-Infinity);
  const bx = new Float64Array(model.B), by = new Float64Array(model.B), bn = new Float64Array(model.B);
  for (let z = 0; z < Z; z++) { const b = blockOf(z); bx[b] += x[z]; by[b] += y[z]; bn[b]++; }
  for (let b = 0; b < model.B; b++) { bx[b] /= Math.max(1, bn[b]); by[b] /= Math.max(1, bn[b]); }
  for (let z = 0; z < Z; z++) {
    const b = blockOf(z);
    const score = how === 'pop' ? model.zPop[z] : -(Math.abs(x[z] - bx[b]) + Math.abs(y[z] - by[b]));
    if (score > best[b]) { best[b] = score; repBlock[b] = z; }
  }
  const rep = new Int32Array(Z);
  for (let z = 0; z < Z; z++) { const r = repBlock[blockOf(z)]; rep[z] = r >= 0 ? r : z; }
  return rep;
}
for (const v of V) {
  const r = run(v.name, v.patches || [], v.setup, v.timer, v.zone);
  rows.push(r);
}

const b = rows[0];
const dif = function (v) { const x = (v / b.metro - 1) * 100; return (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; };
console.log('');
console.log('变体                    每起点  OD 条数      地铁/日    相对基线   分担率   通勤    一轮');
for (const r of rows) {
  console.log(r.name.padEnd(23) + String(Math.round(r.per)).padStart(5) + '  ' + String(r.recs).padStart(8) +
    '  ' + Math.round(r.metro).toLocaleString('en').padStart(9) + '  ' + dif(r.metro).padStart(8) +
    '  ' + (r.share * 100).toFixed(2) + '%  ' + r.commute.toFixed(1) + ' 分  ' +
    r.ms.toFixed(0).padStart(4) + ' ms  ' + (r.ms / b.ms).toFixed(2) + '×' +
    (r.rt ? '   其中最短路 ' + r.rt.toFixed(0) + ' ms（' + (r.rt / r.ms * 100).toFixed(0) + '%）' : ''));
}
