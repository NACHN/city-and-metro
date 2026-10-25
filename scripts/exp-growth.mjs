// 城市增长的「可达项」对照实验（node scripts/exp-growth.mjs）
//
// 同一张广州图、同一条线网、同一个种子，只改 CM.GROWTH_ACCESS.from：
//   'walk'      → 增长权重按「步行到站距离三档」（现状）
//   'jobAccess' → 按「45 分钟内可达岗位数」的相对档位（经营模式）
// 每 6 个月重编译线网并求解一次（让 skim 与可达性跟上城市变化），共跑 20 年。
// 输出：按「距最近车站」与「距市中心」两个口径的人口增长，以及最终的地铁客流。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {}, append() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, offsetWidth: 100, offsetHeight: 40, innerHTML: '', textContent: '', getContext() { return null; } });
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { createElement: el, createElementNS: el, addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }, body: el(), querySelector() { return null; }, getElementById() { return null; } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const FILES = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js','js/data_tutorial.js',
 'js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js',
 'js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js'];
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const CM = globalThis.CM, M = CM.Metro, U = CM.U, CFG = CM.CFG;
const MAPID = process.argv[5] || 'gz';
CM.useMap(MAPID);
const YEARS = Number(process.argv[2] || 40);

function run(from) {
  CM.GROWTH_ACCESS.from = from;
  const Y0 = CFG.START.y;
  const city = new CM.City(); city.generate(Y0 * 10000 + 101, Y0);
  // 按各区域的开放年份逐步开放（与游戏一致）：早期需求集中在核心，才会真的堵起来
  const openByYear = function (yr, m) {
    for (let k = 0; k < city.regions.length; k++) {
      const rg = city.regions[k];
      if (city.regionOpen[k]) continue;
      if (rg.open != null && rg.open <= yr && city.openRegion) city.openRegion(k, yr, m);
    }
  };
  openByYear(Y0, 0);
  // 24 站十字线网（与之前的实验一致）
  let row = 40, br = -1, col = 40, bc = -1;
  for (let j = 8; j < city.H - 8; j++) { let s = 0; for (let i = 10; i < city.W - 10; i++) s += city.pop[j * city.W + i]; if (s > br) { br = s; row = j; } }
  for (let i = 8; i < city.W - 8; i++) { let s = 0; for (let j = 10; j < city.H - 10; j++) s += city.pop[j * city.W + i]; if (s > bc) { bc = s; col = i; } }
  const net = M.empty(), la = M.newLine(net, '横'), lb = M.newLine(net, '竖');
  let prev = null;
  for (let k = 0; k < 12; k++) { const s = M.addStation(net, 26 + k * 4 + 0.5, row + 0.5, { size: 'M', type: 'underground' }, city); if (prev) M.addSegment(net, la, prev, s, [], 'underground'); prev = s; }
  prev = null;
  for (let k = 0; k < 12; k++) { const s = M.addStation(net, col + 0.5, 22 + k * 4 + 0.5, { size: 'M', type: 'underground' }, city); if (prev) M.addSegment(net, lb, prev, s, [], 'underground'); prev = s; }
  const pts = Object.values(net.stations).map(function (s) { return [s.x, s.y]; });
  const model = new CM.Model(city);
  const p0 = Float32Array.from(city.pop);
  const snap = [];
  for (let m = 0; m < YEARS * 12; m++) {
    const yy = Y0 + Math.floor(m / 12);
    if (m % 12 === 0) openByYear(yy, m % 12);
    if (m % 6 === 0) { const C = M.compile(net, city); model.setNetwork(C); model.solveNow(2); }   // 收敛两轮，让拥堵进入 skim
    const ja = from === 'jobAccess' ? model.computeJobAccess(45) : null;
    if (m % 60 === 59) {
      // 每 5 年记一次：人口、拥堵（与道路面板同口径）、地铁，以及公交/含车两种可达岗位的差距
      const jaT = model.computeJobAccess(45, 'transit'), jaB = model.computeJobAccess(45, 'both');
      const mean = function (a) { let s2 = 0, n = 0; for (let q = 0; q < a.length; q++) if (a[q] > 0) { s2 += a[q]; n++; } return n ? s2 / n : 0; };
      const W = model.weights(8 * 60 + 30);
      const vr = [];
      for (let a = 0; a < model.road.nA; a++) vr.push(model.arcVolAt(a, W) / (model.cap(a) || 1));
      vr.sort(function (x, y2) { return x - y2; });
      const qq = function (f) { return vr.length ? vr[Math.min(vr.length - 1, Math.floor(f * vr.length))] : 0; };
      snap.push({ y: yy, pop: city.totals().pop, cong: model.cityCongAt(W), metro: model.daily ? model.daily.metro : 0,
        jaT: mean(jaT), jaB: mean(jaB), vc95: qq(0.95), vcMax: vr.length ? vr[vr.length - 1] : 0 });
    }
    city.growMonth({ year: yy, monthIndex: m, zoneAccess: null, cellWalk: model.net && model.net.acc ? model.net.acc.cellWalk : null, coverage: model.net && model.net.acc ? model.net.acc.coverage : 0, econ: null, jobAccess: ja });
  }
  const tot = city.totals();
  // 统计
  const bands = [0, 500, 1000, 1500, 3000, 1e9];
  const stat = bands.slice(1).map(function () { return { a: 0, b: 0, n: 0 }; });
  let cx = 0, cy = 0, cw = 0;
  for (let c = 0; c < city.N; c++) { if (city.landFrac[c] < 0.5) continue; const p = p0[c] + city.jobs[c]; if (p <= 0) continue; cx += (c % city.W) * p; cy += ((c / city.W) | 0) * p; cw += p; }
  cx /= Math.max(1, cw); cy /= Math.max(1, cw);   // 人口重心（不是几何中心）
  for (let c = 0; c < city.N; c++) {
    if (city.landFrac[c] < 0.5) continue;
    const x = (c % city.W) + 0.5, y = ((c / city.W) | 0) + 0.5;
    let d = Infinity; for (const p of pts) d = Math.min(d, U.dist(p[0], p[1], x, y) * CFG.CELL_M);
    let bi = bands.length - 2;
    for (let k = 0; k < bands.length - 1; k++) if (d >= bands[k] && d < bands[k + 1]) { bi = k; break; }
    stat[bi].a += p0[c]; stat[bi].b += city.pop[c]; stat[bi].n++;
  }
  // 距人口重心的距离分布（看是否更集中）
  const rings = [0, 3, 6, 10, 1e9], rs = rings.slice(1).map(function () { return { a: 0, b: 0 }; });
  for (let c = 0; c < city.N; c++) {
    if (city.landFrac[c] < 0.5) continue;
    const d = U.dist(cx, cy, (c % city.W) + 0.5, ((c / city.W) | 0) + 0.5) * CFG.CELL_M / 1000;
    let bi = rings.length - 2;
    for (let k = 0; k < rings.length - 1; k++) if (d >= rings[k] && d < rings[k + 1]) { bi = k; break; }
    rs[bi].a += p0[c]; rs[bi].b += city.pop[c];
  }
  return { from: from, pop: tot.pop, metro: model.daily ? model.daily.metro : 0, stat: stat, bands: bands, rs: rs, rings: rings, snap: snap };
}

const A = run(process.argv[3] || 'walk'), B = run(process.argv[4] || 'jobAccess');
console.log('地图 ' + MAPID + ' · 每 5 年：人口 / 拥堵指数（行车时间 ÷ 自由流）/ 地铁日客流 / 平均可达岗位（纯公交 vs 含开车）');
for (let k = 0; k < A.snap.length; k++) {
  const a = A.snap[k], b = B.snap[k];
  console.log('  ' + a.y + '  ' + (a.pop / 1e6).toFixed(2) + 'M  ' + a.cong.toFixed(2) + ' / ' + b.cong.toFixed(2) +
    '   ' + Math.round(a.metro).toLocaleString('en').padStart(8) + ' / ' + Math.round(b.metro).toLocaleString('en').padStart(8) +
    '   ' + Math.round(a.jaT).toLocaleString('en').padStart(7) + ' / ' + Math.round(a.jaB).toLocaleString('en').padStart(7) +
    '   V/C p95 ' + a.vc95.toFixed(2) + ' · 最大 ' + a.vcMax.toFixed(2));
}
console.log('');
console.log('全市人口：' + A.from + ' ' + (A.pop / 1e6).toFixed(2) + 'M · jobAccess ' + (B.pop / 1e6).toFixed(2) + 'M · 期末地铁/日 ' + Math.round(A.metro) + ' / ' + Math.round(B.metro));
console.log('');
console.log('按「距最近车站」的人口增长');
console.log('距离段       格数   walk        jobAccess   差');
for (let k = 0; k < A.stat.length; k++) {
  const a = A.stat[k], b = B.stat[k];
  const ga = (a.b / Math.max(1, a.a) - 1) * 100, gb = (b.b / Math.max(1, b.a) - 1) * 100;
  const lbl = A.bands[k + 1] > 1e8 ? '> ' + (A.bands[k] / 1000) + ' km' : A.bands[k] + '–' + A.bands[k + 1] + ' m';
  console.log(lbl.padEnd(12) + String(a.n).padStart(5) + '  ' + ga.toFixed(1).padStart(6) + '%  ' + gb.toFixed(1).padStart(8) + '%  ' + ((gb - ga) >= 0 ? '+' : '') + (gb - ga).toFixed(1) + ' pt');
}
console.log('');
console.log('按「距人口重心」的人口增长（看是否更集中）');
for (let k = 0; k < A.rs.length; k++) {
  const a = A.rs[k], b = B.rs[k];
  const ga = (a.b / Math.max(1, a.a) - 1) * 100, gb = (b.b / Math.max(1, b.a) - 1) * 100;
  const lbl = A.rings[k + 1] > 1e8 ? '> ' + A.rings[k] + ' km' : A.rings[k] + '–' + A.rings[k + 1] + ' km';
  console.log(lbl.padEnd(12) + '             ' + ga.toFixed(1).padStart(6) + '%  ' + gb.toFixed(1).padStart(8) + '%  ' + ((gb - ga) >= 0 ? '+' : '') + (gb - ga).toFixed(1) + ' pt');
}
