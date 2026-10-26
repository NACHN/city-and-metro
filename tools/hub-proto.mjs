// 原型：把「重要节点（枢纽）」做成几级树，看能不能在大图上省掉大部分最短路。
//
//   node tools/hub-proto.mjs gz2
//
// 做法（教科书里的 landmark / hub 分层）：
//   1. 从车行图里挑枢纽节点（等级 ≥3 的路段端点，按度数排序取前 K 个，再补足覆盖）
//   2. **只在时间变化时才**把 K 个枢纽到全网的 dist 算一遍（K 次 Dijkstra，K=200 时约 0.1 s）
//   3. 每个起点的 Dijkstra 仍然跑，但**所有枢纽被 settled 之后就停**（这就是省下来的部分），
//      剩下远处的目的地用 min_k(dist(o,k) + dist(k,d)) 近似
// 这里只做精度与节点数的测量，不改主程序。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapId = process.argv[2] || 'gz2';
const HUBS = +(process.argv[3] || 200);
const NOOP = () => {};
globalThis.window = globalThis; globalThis.self = globalThis;
const mk = () => ({ style: { setProperty: NOOP }, getContext: () => new Proxy({}, { get: () => NOOP }), addEventListener: NOOP, appendChild: (c) => c, setAttribute: NOOP, classList: { add: NOOP, remove: NOOP } });
globalThis.document = { createElement: mk, createElementNS: mk, body: mk(), documentElement: mk(), querySelector: () => null, getElementById: mk, addEventListener: NOOP };
globalThis.addEventListener = NOOP; globalThis.matchMedia = () => ({ matches: false, addEventListener: NOOP });
globalThis.localStorage = { getItem: () => null, setItem: NOOP, removeItem: NOOP }; globalThis.requestAnimationFrame = () => 0;
globalThis.Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} arc() {} };

const L = (f) => vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
const geo = ['js/geo_' + mapId + '.js', 'maps/' + mapId + '/parked/geo_' + mapId + '.js'].find((f) => fs.existsSync(path.join(root, f)));
const data = ['js/data_' + mapId + '.js', 'maps/' + mapId + '/parked/data_' + mapId + '.js'].find((f) => fs.existsSync(path.join(root, f)));
for (const f of ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js', 'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/data_tutorial.js',
  'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js', 'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js']) L(path.join(root, f));
L(path.join(root, geo)); L(path.join(root, data));
for (const f of ['js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js', 'js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js']) L(path.join(root, f));

const CM = globalThis.CM;
CM.useMap(mapId);
const g = CM.Game.create({ map: mapId, preset: 'normal', name: 'hub' });
const city = g.city, road = city.car;
const nN = road.nN, nA = road.nA;
const outStart = road.outStart, outArc = road.outArc, arcTo = road.arcTo, arcLen = road.arcLen, arcT0 = road.arcT0;
console.log('车行图：节点 ' + nN + ' · 有向弧 ' + nA + ' · 小区 ' + g.model.Z);

// ---- 1. 挑枢纽：等级高的路段端点优先（用 link 的 cls） ----
const deg = new Int32Array(nN);
for (let a = 0; a < nA; a++) deg[road.arcFrom[a]]++;
const important = new Float64Array(nN);
for (const L2 of road.links) {
  const w = L2.cls === 4 ? 4 : L2.cls === 3 ? 2 : L2.cls === 2 ? 1 : 0.2;
  for (const v of L2.verts) important[v] += w;
}
const order = Array.from({ length: nN }, (_, i) => i).sort((a, b) => important[b] - important[a] || deg[b] - deg[a]);
const hubs = order.slice(0, HUBS);
const isHub = new Uint8Array(nN);
for (const h of hubs) isHub[h] = 1;
console.log('枢纽 ' + hubs.length + ' 个（按等级权重取前 ' + HUBS + '）');

// ---- 2. 全量 Dijkstra（照抄 sim.js 的 roadTree，带单源多终点提前停） ----
function dijkstra(src, time, stopAtHubs) {
  const dist = new Float64Array(nN).fill(1e30);
  const keys = new Float64Array(nA + 4), vals = new Int32Array(nA + 4);
  let count = 0, settled = 0, hubsLeft = 0;
  if (stopAtHubs) for (const h of hubs) if (h !== src) hubsLeft++;
  dist[src] = 0;
  keys[0] = 0; vals[0] = src; count = 1;
  while (count) {
    const u = vals[0], du = keys[0], n = --count;
    if (n > 0) {
      const key = keys[n], val = vals[n];
      let i = 0;
      for (;;) { const l = i * 2 + 1; if (l >= n) break; const r = l + 1, ch = r < n && keys[r] < keys[l] ? r : l; if (keys[ch] >= key) break; keys[i] = keys[ch]; vals[i] = vals[ch]; i = ch; }
      keys[i] = key; vals[i] = val;
    }
    if (du > dist[u]) continue;
    settled++;
    if (stopAtHubs && isHub[u] && u !== src) { if (--hubsLeft <= 0) break; }
    for (let k = outStart[u]; k < outStart[u + 1]; k++) {
      const a = outArc[k], v = arcTo[a], nd = du + time[a];
      if (nd < dist[v]) {
        dist[v] = nd;
        let i = count++;
        while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= nd) break; keys[i] = keys[p]; vals[i] = vals[p]; i = p; }
        keys[i] = nd; vals[i] = v;
      }
    }
  }
  return { dist: dist, settled: settled };
}

// 自由流时间 + 一次拥堵（用当前的 arcTime）
const time = Float32Array.from(g.model.ctxs.wd.per[0].arcTime);
// 枢纽到全网
let t0 = performance.now();
const hubDist = hubs.map((h) => dijkstra(h, time, false).dist);
console.log('枢纽到全网 ' + hubs.length + ' 次 Dijkstra：' + (performance.now() - t0).toFixed(0) + ' ms · 约 ' + (hubs.length * nN * 4 / 1048576).toFixed(1) + ' MB');

// ---- 3. 抽样比较：精确 vs 枢纽近似 ----
const rd = g.model.roadData, connStart = rd.start, connNode = rd.nodes, connTime = rd.times;
const Z = g.model.Z;
function skimExact(o) { const r = dijkstra(connNode[connStart[o]], time, false); return r; }
function skimHub(o) { const r = dijkstra(connNode[connStart[o]], time, true); return r; }
function zoneTime(dist, d) {
  let best = 1e30;
  for (let k = connStart[d]; k < connStart[d + 1]; k++) { const v = dist[connNode[k]] + connTime[k]; if (v < best) best = v; }
  return best;
}
const sample = [];
for (let o = 0; o < Z; o += 37) sample.push(o);
let worst = 0, sumRel = 0, cnt = 0, settledAll = 0, settledHub = 0;
t0 = performance.now();
const exactRows = sample.map((o) => zoneTimesFor(o));
function zoneTimesFor(o) { const r = skimExact(o); settledAll += r.settled; const out = new Float64Array(Z); for (let d = 0; d < Z; d++) out[d] = zoneTime(r.dist, d); return out; }
const tExact = performance.now() - t0;
t0 = performance.now();
const hubRows = sample.map((o) => zoneTimesFor2(o));
function zoneTimesFor2(o) {
  const r = skimHub(o); settledHub += r.settled;
  const out = new Float64Array(Z);
  for (let d = 0; d < Z; d++) {
    let best = zoneTime(r.dist, d);
    for (let h = 0; h < hubs.length; h++) {
      const dh = r.dist[hubs[h]];
      if (dh >= 1e29) continue;
      const rest = hubDist[h][connNode[connStart[d]]];
      if (rest >= 1e29) continue;
      const v = dh + rest;
      if (v < best) best = v;
    }
    out[d] = best;
  }
  return out;
}
const tHub = performance.now() - t0;
for (let r = 0; r < sample.length; r++) {
  for (let d = 0; d < Z; d++) {
    const a = exactRows[r][d], b = hubRows[r][d];
    if (a >= 1e29 || b >= 1e29) continue;
    const rel = Math.abs(a - b) / Math.max(a, 1e-6);
    if (rel > worst) worst = rel;
    sumRel += rel; cnt++;
  }
}
console.log('抽样起点 ' + sample.length + ' 个：');
console.log('  精确 ' + tExact.toFixed(0) + ' ms（平均 settled ' + Math.round(settledAll / sample.length) + '/' + nN + '）');
console.log('  枢纽 ' + tHub.toFixed(0) + ' ms（平均 settled ' + Math.round(settledHub / sample.length) + '）· 含近似展开');
console.log('  时间相对误差：平均 ' + (100 * sumRel / cnt).toFixed(3) + '% · 最大 ' + (100 * worst).toFixed(2) + '%');
