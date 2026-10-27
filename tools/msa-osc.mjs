// MSA 在均衡附近到底在振荡，还是单调收敛？
//
// 判据不是「gap 有没有降」（那是整体指标），而是**每条弧的流量变化方向**：
//   第 k 轮 d_k = v_k - v_{k-1}，若 d_k 与 d_{k-1} 反号，这条弧就在来回翻。
// 翻转率高低决定两件事：
//   1. 要不要加阻尼/滤波（PID 思路）
//   2. 懒判定（弧时变动 >1% 的路段占比 ≤2%）为什么命中/不命中
//
// 用法：node tools/msa-osc.mjs [mapId] [--period=wd-1] [--rounds=12]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const MAP = argv.find((a) => !a.startsWith('--')) || 'gz2';
const ONLY = (argv.find((a) => a.startsWith('--period=')) || '').split('=')[1] || 'wd-1';
const ROUNDS = +(argv.find((a) => a.startsWith('--rounds=')) || '--rounds=12').split('=')[1];
const TOL = +(argv.find((a) => a.startsWith('--tol=')) || '').split('=')[1];

const NOOP = () => {};
const sb = { console: { log: NOOP, warn: NOOP, error: NOOP }, performance };
sb.window = sb; sb.self = sb; sb.globalThis = sb;
const mk = () => ({ style: { setProperty: NOOP }, getContext: () => new Proxy({}, { get: () => NOOP }), addEventListener: NOOP, appendChild: (c) => c, setAttribute: NOOP, classList: { add: NOOP, remove: NOOP }, querySelectorAll: () => [] });
sb.document = { createElement: mk, createElementNS: mk, body: mk(), documentElement: mk(), querySelector: () => null, getElementById: mk, addEventListener: NOOP };
sb.addEventListener = NOOP;
sb.matchMedia = () => ({ matches: false, addEventListener: NOOP });
sb.localStorage = { getItem: () => null, setItem: NOOP, removeItem: NOOP };
sb.requestAnimationFrame = () => 0;
sb.Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} arc() {} };
const ctx = vm.createContext(sb);

const parked = (rel) => {
  const p = path.join(root, 'maps', MAP, 'parked', path.basename(rel));
  return fs.existsSync(path.join(root, rel)) ? path.join(root, rel) : p;
};
const L = (f) => vm.runInContext(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f), 'utf8'), ctx, { filename: f });
for (const f of ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js', 'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/data_tutorial.js',
  'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js', 'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js']) L(f);
L(parked('js/geo_' + MAP + '.js')); L(parked('js/data_' + MAP + '.js'));
for (const f of ['js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js', 'js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js']) L(f);

const CM = sb.CM;
CM.useMap(MAP);
if (Number.isFinite(TOL)) CM.CFG.road.routeTol = TOL;
const g = CM.Game.create({ map: MAP, preset: 'normal', name: 'osc' });
const m = g.model;
let n0 = 0; while (!m.settled && n0++ < 900) m.step(4000);

const [dt, ps] = ONLY.split('-');
const p = +ps;
const P = m.ctxs[dt].per[p];
const nA = m.road.nA;
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

console.log(`[${MAP}] ${ONLY} · ${ROUNDS} 轮 · tol=${CM.CFG.road.routeTol} 分钟 · 弧 ${nA} · 小区 ${m.Z}`);
console.log('轮  gap       变动弧   反号率   平均相对变化   Σv         拥堵');
let prevV = Float32Array.from(P.arcVol), prevD = null;
for (let k = 1; k <= ROUNDS; k++) {
  const v0 = Float32Array.from(P.arcVol), t0 = Float32Array.from(P.arcTime);
  const gen = m.iterate(m.net, P, p, { fullSkim: true, noSmooth: true });
  for (let r = gen.next(); !r.done; r = gen.next()) { /* 跑完 */ }
  const v1 = Float32Array.from(P.arcVol);
  const aux = Float32Array.from(m.liveBuf.roadWork.aux);
  const gap = 1 - dot(v0, t0) / Math.max(1e-9, dot(aux, t0));
  const d = new Float32Array(nA);
  let moved = 0, flip = 0, sumRel = 0;
  for (let a = 0; a < nA; a++) {
    d[a] = v1[a] - v0[a];
    if (Math.abs(d[a]) > 0.01) {
      moved++;
      sumRel += Math.abs(d[a]) / Math.max(1, v1[a]);
      if (prevD && prevD[a] * d[a] < 0) flip++;
    }
  }
  const cg = (() => { let s = 0; for (let a = 0; a < nA; a++) s += P.arcTime[a] / m.road.arcT0[a]; return s / nA; })();
  console.log(`${String(k).padStart(2)}  ${(gap * 100).toFixed(2).padStart(7)}%  ${String(moved).padStart(6)}`
    + `  ${(flip / Math.max(1, moved) * 100).toFixed(1).padStart(6)}%  ${(sumRel / Math.max(1, moved) * 100).toFixed(2).padStart(8)}%`
    + `  ${Math.round(sum(v1)).toString().padStart(9)}  ${cg.toFixed(4)}`);
  prevD = d; prevV = v1;
}
