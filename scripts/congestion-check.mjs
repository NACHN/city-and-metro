// 道路饱和度体检（node scripts/congestion-check.mjs）
//
// 对五张真实地图各开一局（挑战模式），打印早高峰的 V/C 分布（路段流量 ÷ 通行能力）：
// 均值、中位、p95、最大，以及 V/C > 0.8 的路段数。用来回答「这个模型的马路到底会不会堵」。
// 现实参照：城市干道高峰 V/C 常在 0.8–1.2，全网均值 0.3–0.6；低于 0.1 说明容量相对需求明显偏大。

import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, getContext() { return null; } });
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { createElement: el, createElementNS: el, addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {} } }, body: el(), querySelector() { return null; }, getElementById() { return null; } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const FILES = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js', 'js/geo_gz2.js', 'js/data_gz2.js','js/geo_sh.js','js/data_sh.js','js/geo_wlmq.js','js/data_wlmq.js','js/data_tutorial.js','js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js','js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js'];
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const CM = globalThis.CM;
console.log('地图   年份   人口    高峰车出行   V/C 均  p50   p95   最大   >0.8 段  拥堵指数');
for (const id of ['gz', 'hz', 'hk', 'tk', 'tp']) {
  CM.useMap(id);
  const g = CM.Game.create({ map: id, mode: 'challenge', name: 'vc' });
  const m = g.model;
  // 与道路面板同口径：取早高峰整点（8:30）的加权流量，而不是时段平均
  const W = m.weights(8 * 60 + 30);
  const P = m.ctxs.wd.per[1];
  const v = [];
  for (let a = 0; a < m.road.nA; a++) v.push(m.arcVolAt(a, W) / (m.cap(a) || 1));
  v.sort((x, y) => x - y);
  const q = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
  let sum = 0; for (const x of v) sum += x;
  const over = v.filter((x) => x > 0.8).length;
  console.log(id.padEnd(6) + String(CM.CFG.START.y).padEnd(7) + (g.city.totals().pop / 1e6).toFixed(2) + 'M  ' +
    String(Math.round(P.stats && P.stats.car || 0)).padStart(12) + '   ' + (sum / v.length).toFixed(3) + '  ' +
    q(0.5).toFixed(2) + '  ' + q(0.95).toFixed(2) + '  ' + v[v.length - 1].toFixed(2) + '   ' + over +
    '   拥堵指数 ' + m.cityCongAt(W).toFixed(2));
}
