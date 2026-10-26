// 道路容量敏感性（node scripts/congestion-scale.mjs）
//
// 把 CFG.road.cap 整体缩放 k 倍，看「要堵到什么程度才会出现全城拥堵、以及地铁是否因此受益」。
// 每档都重新生成城市与线网（12 站单线），输出 V/C 分布、拥堵指数、地铁分担、平均通勤，
// 以及「可达岗位」在纯公交口径与含开车口径下的差距。
// 现实参照：干道高峰 V/C ≈ 1.0–1.2，全网均值 0.4–0.6；拥堵指数（行程时间 ÷ 自由流）1.2–1.8。

import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, getContext() { return null; } });
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { createElement: el, createElementNS: el, addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {} } }, body: el(), querySelector() { return null; }, getElementById() { return null; } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const FILES = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js','js/data_tutorial.js','js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js','js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js'];
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const CM = globalThis.CM, M = CM.Metro, CFG = CM.CFG;
CM.useMap('gz');
const CAP0 = CFG.road.cap.slice();
function run(k) {
  CFG.road.cap = CAP0.map(function (v) { return v * k; });
  const city = new CM.City(); city.generate(19900101, 1990);
  let row = 40, br = -1;
  for (let j = 8; j < city.H - 8; j++) { let s = 0; for (let i = 10; i < city.W - 10; i++) s += city.pop[j * city.W + i]; if (s > br) { br = s; row = j; } }
  const net = M.empty(), lid = M.newLine(net, 'L');
  let prev = null;
  for (let kk = 0; kk < 12; kk++) { const s = M.addStation(net, 26 + kk * 4 + 0.5, row + 0.5, { size: 'M', type: 'underground' }, city); if (prev) M.addSegment(net, lid, prev, s, [], 'underground'); prev = s; }
  const model = new CM.Model(city);
  model.setNetwork(M.compile(net, city));
  model.solveNow(3);
  // 与道路面板同口径：早高峰整点的加权流量 / 通行能力
  const W = model.weights(8 * 60 + 30), P = model.ctxs.wd.per[1], v = [];
  for (let a = 0; a < model.road.nA; a++) v.push(model.arcVolAt(a, W) / (model.cap(a) || 1));
  v.sort((x, y) => x - y);
  const q = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
  let sum = 0;
  for (const x of v) sum += x;
  const cong = model.cityCongAt(W);
  const mean = (arr) => { let s = 0, n = 0; for (const x of arr) if (x > 0) { s += x; n++; } return n ? s / n : 0; };
  const jaT = mean(model.computeJobAccess(45, 'transit')), jaB = mean(model.computeJobAccess(45, 'both'));
  return { k: k, vc50: q(0.5), vc95: q(0.95), vcMax: v[v.length - 1], cong: cong, share: model.daily.metroShare, commute: model.daily.commute, jaT: jaT, jaB: jaB, metro: model.daily.metro };
}
console.log('容量倍数   V/C p50  p95   最大   拥堵指数  地铁分担  通勤    可达岗位(公交/含车)');
for (const k of [1, 0.5, 0.25, 0.15, 0.1]) {
  const r = run(k);
  console.log(String(k).padEnd(9) + r.vc50.toFixed(2) + '    ' + r.vc95.toFixed(2) + '  ' + r.vcMax.toFixed(2) + '   ' +
    r.cong.toFixed(2) + '     ' + (r.share * 100).toFixed(2) + '%   ' + r.commute.toFixed(1) + ' 分  ' +
    Math.round(r.jaT).toLocaleString('en') + ' / ' + Math.round(r.jaB).toLocaleString('en'));
}
