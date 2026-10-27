// 懒判定的门槛到底卡在哪：每个 cycle 到底有多少条弧「算变了」。
//
// 判据两套并列，看同一时刻的两种口径差多少：
//   老：|Δt| / t_full > 1%（相对口径）
//   新：|Δt| > lazyTolKm × 弧长（按长度给，分钟/公里）
// 用法：node tools/lazy-gate.mjs [mapId] [--period=wd-0] [--cycles=6]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const MAP = argv.find((a) => !a.startsWith('--')) || 'gz2';
const ONLY = (argv.find((a) => a.startsWith('--period=')) || '').split('=')[1] || 'wd-0';
const CYCLES = +(argv.find((a) => a.startsWith('--cycles=')) || '--cycles=6').split('=')[1];
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
const g = CM.Game.create({ map: MAP, preset: 'normal', name: 'gate' });
const m = g.model;
let n0 = 0;
while (!m.settled && n0++ < 900) m.step(4000);

const [dt, ps] = ONLY.split('-');
const p = +ps;
const P = m.ctxs[dt].per[p];
const nA = m.road.nA, arcKm = m.roadData.arcKm;
const KMS = [0.15, 0.3, 0.45, 0.6, 1.0];

console.log(`[${MAP}] ${ONLY} · 弧 ${nA} · 懒上限 ${(nA * 0.02) | 0} 条（2%）`);
console.log('cycle  1%口径    ' + KMS.map((k) => String(k).padStart(6) + ' ').join('') + '  0.45 门槛');
for (let k = 1; k <= CYCLES; k++) {
  const full0 = P.timeFull ? P.timeFull.slice() : null;
  // fullSkim 会禁用懒分配，正好用来问「这一轮如果是全量，下一轮过得了门槛吗」
  const gen = m.iterate(m.net, P, p, { fullSkim: true, noSmooth: true });
  for (let r = gen.next(); !r.done; r = gen.next()) { /* run */ }
  const cur = P.arcTime;
  const base = full0 || t0;
  let pc = 0;
  const cnt = KMS.map(() => 0);
  for (let a = 0; a < nA; a++) {
    const d = Math.abs(cur[a] - base[a]);
    if (d / (base[a] || 1) > 0.01) pc++;
    for (let q = 0; q < KMS.length; q++) if (d > KMS[q] * arcKm[a]) cnt[q]++;
  }
  // fullSkim 下懒分配被禁用，所以这里只报「若走全量，门槛是否会被突破」
  const lazy = cnt[2] <= nA * 0.02 ? '过(0.45)' : '不过';
  console.log(`${String(k).padStart(5)}  ${String(pc).padStart(6)}    ` + cnt.map((c) => String(c).padStart(6) + ' ').join('') + '  ' + lazy);
}
