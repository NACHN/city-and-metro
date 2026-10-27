// 树级懒更新：每棵树「还能不能继续用」的精确判据与实测结论
//
// 判据 = 对偶可行性（最短路最优性条件）：
//   对每条弧 (u,v)：dist[u] + t[u,v] >= dist[v]。
//   全部成立 ⇒ 这棵树在当前时间下仍然是最短路树（可能不唯一），重放结果与重建逐位相同；
//   有一条不成立 ⇒ 已经过期。gap = max( (dv - du - t) / dv ) 就是「这棵树最多能被改进多少」。
//
// 结论（gz2 · 240×192 · 2880 小区 · 2026-10-27）：
//   1. 自检：同一份时间上重放自己的树，2,838 棵全部 0 违反 —— 重放本身是精确的。
//   2. 树的过期程度**分时段极端不均匀**：
//        wd-1 / wd-3（占 7.3% / 3.3% 车次）   gap 中位 0.01%，p90 0.14%，max 0.5% —— 几乎不用重建
//        wd-0 / wd-2（各占 29% 车次）          gap 中位 6.8% ~ 14.8%，max 85% —— 一个月内大面积翻转
//      根因是**月内的 MSA 收敛**：它把弧时推到新均衡（wd-0 最大弧时 6.32 → 7.82 分），
//      而重放只更新距离、不更新拓扑。低流量时段路径本身近似并列，微小扰动就整片翻转。
//   3. 所以「整月 8 个时段一起重建」是浪费的：真正需要重建的只有流量大的那 2~4 个时段。
//   4. 成本：对偶检查 0.13 s/时段（扫完 14,746 条弧），重建 0.73 s/时段。
//      把刷新粒度从「整月」降到「时段」，刷新月 12.5 s → 约 6 s。
//
// 踩到的两个坑（都不是算法）：
//   · 抓树的时间点必须在 iterate **之前**记录 —— BPR 会改 arcTime，用改后的时间去比会让所有树恒为「坏」。
//   · 弧身份不能只用顶点对：立交/跨线桥会让同一对端点之间有两条弧（这张图 176 对），
//     后一条覆盖前一条，树就被翻到错误的平行弧上（gap 假性飙到 1.57%）。加上弧长做键才唯一。
//
// 用法：node tools/tree-lazy-probe.mjs [mapId] [--months=3] [--period=wd-1]   （DIAG=1 打印单点的距离细节）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const MAP = argv.find((a) => !a.startsWith('--')) || 'gz2';
const MONTHS = +(argv.find((a) => a.startsWith('--months=')) || '--months=3').split('=')[1];
const ONLY = (argv.find((a) => a.startsWith('--period=')) || '').split('=')[1] || null;

const NOOP = () => {};
globalThis.window = globalThis; globalThis.self = globalThis;
const mk = () => ({ style: { setProperty: NOOP }, getContext: () => new Proxy({}, { get: () => NOOP }), addEventListener: NOOP, appendChild: (c) => c, setAttribute: NOOP, classList: { add: NOOP, remove: NOOP }, querySelectorAll: () => [] });
globalThis.document = { createElement: mk, createElementNS: mk, body: mk(), documentElement: mk(), querySelector: () => null, getElementById: mk, addEventListener: NOOP };
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
for (const f of ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js', 'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/data_tutorial.js',
  'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js', 'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js']) L(path.join(root, f));
L(parked('js/geo_' + MAP + '.js')); L(parked('js/data_' + MAP + '.js'));

// ---- 钩子：armed 时把树存成「回溯顺序的弧号」 ----
const CAP = new Map();
let armed = false;
globalThis.__cap = (o, no, order, pred) => {
  if (!armed) return;
  const a = new Int16Array(no);
  for (let i = 0; i < no; i++) a[i] = pred[order[no - 1 - i]];
  CAP.set(o, a);
};
let simSrc = fs.readFileSync(path.join(root, 'js/sim.js'), 'utf8');
simSrc = simSrc.replace('const no = roadTree(road, rd, cw.time, o, work, cw.heap);',
  'const no = roadTree(road, rd, cw.time, o, work, cw.heap); globalThis.__cap(o, no, work.order, work.pred);');
vm.runInThisContext(simSrc, { filename: 'js/sim.js' });
for (const f of ['js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js']) L(path.join(root, f));

const CM = globalThis.CM;
CM.useMap(MAP);
CM.CFG.perf.treeCache = false;      // 只测探针自己的缓存
const g = CM.Game.create({ map: MAP, preset: 'normal', name: 'lp' });
const m = g.model;

const periods = [];
for (const dt of ['wd', 'we']) for (let p = 0; p < 4; p++) periods.push({ dt, p, key: dt + '-' + p });
const P_of = (q) => m.ctxs[q.dt].per[q.p];
const settle = () => { let n = 0; while (!m.settled && n++ < 900) m.step(4000); };
const advanceMonth = () => {
  let crossed = false;
  while (!crossed) crossed = g.endDay();
  const gen = g.monthGen();
  for (let r = gen.next(); !r.done; r = gen.next()) { /* 跑完 */ }
};

const snapNet = () => {
  const r = m.road;
  return {
    nA: r.nA, nN: r.nN,
    arcFrom: Int32Array.from(r.arcFrom), arcTo: Int32Array.from(r.arcTo), arcLen: Float32Array.from(r.arcLen),
    nodeVert: Int32Array.from(r.nodeVert), vertNode: Int32Array.from(r.vertNode),
  };
};
const remap = (old, arcs) => {
  const r = m.road;
  // 先看弧表是不是逐条相同：相同就用恒等映射。
  // 不能无脑按顶点对映射 —— 有平行弧（立交、桥）时，顶点对会把弧号错配到另一条弧上。
  let same = old.nA === r.nA;
  if (same) {
    for (let a = 0; a < old.nA; a++) {
      if (old.arcFrom[a] !== r.arcFrom[a] || old.arcTo[a] !== r.arcTo[a]) { same = false; break; }
    }
  }
  if (same) return { arcs, lost: 0, identical: true, lut: null };

  // 顶点对不够：立交/桥会让同一对端点之间有两条弧（这张图 176 对）。
  // 加上弧长（路还是那条路，长度跨月稳定）才能唯一确定。
  const byPair = new Map();
  let dup = 0;
  const keyOf = (from, to, len) => from + '_' + to + '_' + Math.round(len);
  for (let a = 0; a < r.nA; a++) {
    const k = keyOf(r.arcFrom[a], r.arcTo[a], r.arcLen[a]);
    if (byPair.has(k)) dup++;
    byPair.set(k, a);
  }
  const lut = new Int32Array(old.nA).fill(-2);
  let lost = 0;
  for (let a = 0; a < old.nA; a++) {
    const vf = old.nodeVert[old.arcFrom[a]], vt = old.nodeVert[old.arcTo[a]];
    const nf = r.vertNode[vf], nt = r.vertNode[vt];
    if (nf < 0 || nt < 0) { lost++; continue; }
    const hit = byPair.get(keyOf(nf, nt, old.arcLen[a]));
    if (hit === undefined) { lost++; continue; }
    lut[a] = hit;
  }
  const out = new Map();
  for (const [o, a] of arcs) {
    const b = new Int16Array(a.length);
    for (let i = 0; i < a.length; i++) b[i] = a[i] < 0 ? -1 : lut[a[i]];
    out.set(o, b);
  }
  return { arcs: out, lost, identical: false, lut, dup };
};

// ---- 重放：沿旧树拓扑，用当前时间累加 ----
const dist = new Float64Array(m.road.nN);
function replay(arcs, o, time) {
  const r = m.road, rd = m.roadData;
  dist.fill(Infinity);
  for (let k = rd.start[o]; k < rd.start[o + 1]; k++) {
    const v = rd.nodes[k], t = rd.times[k];
    if (t < dist[v]) dist[v] = t;
  }
  for (let i = arcs.length - 1; i >= 0; i--) {   // 反着走 = settle 正序
    const e = arcs[i];
    if (e < 0) continue;
    const du = dist[r.arcFrom[e]];
    if (du === Infinity) continue;
    dist[r.arcTo[e]] = du + time[e];
  }
}

// ---- 对偶检查：扫完全部弧，返回违反条数（0 = 仍是最短路树） ----
function check(time) {
  const r = m.road, nA = r.nA, from = r.arcFrom, to = r.arcTo;
  let gap = 0;
  for (let a = 0; a < nA; a++) {
    const du = dist[from[a]];
    if (du === Infinity) continue;
    const dv = dist[to[a]];
    if (dv === Infinity) continue;
    const g = (dv - du - time[a]) / Math.max(dv, 1e-6);
    if (g > gap) gap = g;
  }
  return gap;
}

// ---- 自己建树（与 roadTree 同构），用于「重建坏树」的对照 ----
const bd = new Float64Array(m.road.nN);
const hk = new Float64Array(m.road.nA + 8), hv = new Int32Array(m.road.nA + 8);
function build(o, time) {
  const r = m.road, rd = m.roadData;
  const outStart = r.outStart, outArc = r.outArc, arcTo = r.arcTo;
  bd.fill(Infinity);
  let cnt = 0;
  const push = (k, v) => {
    let i = cnt++;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
    hk[i] = k; hv[i] = v;
  };
  for (let k = rd.start[o]; k < rd.start[o + 1]; k++) {
    const v = rd.nodes[k], t = rd.times[k];
    if (t < bd[v]) { bd[v] = t; push(t, v); }
  }
  while (cnt) {
    const u = hv[0], du = hk[0], n = --cnt;
    if (n > 0) {
      const k2 = hk[n], v2 = hv[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1; if (l >= n) break;
        const rr = l + 1, c = rr < n && hk[rr] < hk[l] ? rr : l;
        if (hk[c] >= k2) break;
        hk[i] = hk[c]; hv[i] = hv[c]; i = c;
      }
      hk[i] = k2; hv[i] = v2;
    }
    if (du > bd[u]) continue;
    for (let k = outStart[u]; k < outStart[u + 1]; k++) {
      const a = outArc[k], v = arcTo[a], nd = du + time[a];
      if (nd < bd[v]) { bd[v] = nd; push(nd, v); }
    }
  }
}

// ---- 抓「某月第一轮」的树：必须在 iterate 之前记下时间，因为 BPR 会改它 ----
function captureAll() {
  const trees = new Map(), times = new Map();
  for (const q of periods) {
    const P = P_of(q);
    times.set(q.key, Float32Array.from(P.arcTime));   // 建树用的就是这个时间
    armed = true; CAP.clear();
    const gen = m.iterate(m.net, P, q.p, { fullSkim: true });
    for (let r = gen.next(); !r.done; r = gen.next()) { /* 跑完 */ }
    armed = false;
    trees.set(q.key, new Map(CAP));
  }
  return { trees, times };
}

// ---------- 流程 ----------
settle();                 // 月 1 收敛
advanceMonth();           // → 月 2 月初
const t0 = performance.now();
const base = captureAll();  // 模拟「月 2 第一轮把树存进缓存」
const baseNet = snapNet();
console.log(`[${MAP}] 小区 ${m.Z} · 节点 ${m.road.nN} · 弧 ${m.road.nA}`
  + ` · 抓 8 时段 ${(performance.now() - t0).toFixed(0)} ms · ${[...base.trees.values()].reduce((s, x) => s + x.size, 0)} 棵树`);
settle();                 // 月 2 收敛

// ---- 自检：把树放回它自己建树时的那份时间上重放，必须 0 违反。
// 不为 0 就说明 replay/check 本身有错，后面所有数字都不可信。 ----
{
  const q = periods[0];
  const time = base.times.get(q.key), trees = base.trees.get(q.key);
  let badTotal = 0, checked = 0, first = null;
  for (const [o, arcs] of trees) {
    if (m.roadData.start[o] === m.roadData.start[o + 1]) continue;
    replay(arcs, o, time);
    checked++;
    if (check(time) > 1e-9) { badTotal++; if (!first) first = o; }
  }
  console.log(`[自检] 同一份时间上重放 ${checked} 棵树 → ${badTotal} 棵违反（应为 0）`);
  if (first != null) {
    replay(trees.get(first), first, time);
    const r = m.road;
    // 找第一条违反的弧，打印它两端的重放距离与重建距离
    let a0 = -1;
    for (let a = 0; a < r.nA; a++) {
      const du = dist[r.arcFrom[a]];
      if (du === Infinity) continue;
      if (du + time[a] + 1e-6 < dist[r.arcTo[a]]) { a0 = a; break; }
    }
    build(first, time);
    console.log(` 起点 ${first}：首条违反弧 ${a0}（${r.arcFrom[a0]}→${r.arcTo[a0]}）`
      + ` 重放 dist[u]=${dist[r.arcFrom[a0]].toFixed(4)} t=${time[a0].toFixed(4)} 重放 dist[v]=${dist[r.arcTo[a0]].toFixed(4)}`
      + ` 重建 dist[v]=${bd[r.arcTo[a0]].toFixed(4)}`
      + ` · 树里该节点入弧=${trees.get(first)[trees.get(first).length - 1 - 0]}`);
    let diffMax = 0, cntDiff = 0;
    for (let n = 0; n < r.nN; n++) {
      if (dist[n] === Infinity) continue;
      const d = Math.abs(dist[n] - bd[n]);
      if (d > 1e-6) { cntDiff++; if (d > diffMax) diffMax = d; }
    }
    console.log(` 重放与重建的距离：${cntDiff} 个节点不同，最大差 ${diffMax.toFixed(6)} 分钟`);
  }
}

const use = ONLY ? periods.filter((q) => q.key === ONLY) : periods;

for (let mo = 1; mo <= MONTHS; mo++) {
  advanceMonth();
  const net = snapNet();
  const rows = [];
  for (const q of use) {
    const P = P_of(q), time = P.arcTime;
    const old = remap(baseNet, base.trees.get(q.key));
    const bt = base.times.get(q.key);

    const t1 = performance.now();
    let bad = 0, checked = 0;
    const badList = [], gaps = [];
    for (const o of old.arcs.keys()) {
      if (m.roadData.start[o] === m.roadData.start[o + 1]) continue;
      replay(old.arcs.get(o), o, time);
      checked++;
      const gap = check(time);
      gaps.push(gap);
      if (gap > 0.01) badList.push(o);   // ε=1% 才算「真该重建」
    }
    const tCheck = (performance.now() - t1) / 1000;

    const t2 = performance.now();
    for (const o of badList) build(o, time);
    const tRebuildBad = (performance.now() - t2) / 1000;

    // 全量重建对照：同样的 Dijkstra 跑遍全部起点（抽样 300 个外推）
    const all = [...old.arcs.keys()].filter((o) => m.roadData.start[o] !== m.roadData.start[o + 1]);
    const sample = all.slice(0, 300);
    const t3 = performance.now();
    for (const o of sample) build(o, time);
    const perTree = (performance.now() - t3) / sample.length;
    const tFull = perTree * checked / 1000;

    if (process.env.DIAG && mo === 2 && q === use[0]) {
      const r = m.road;
      const cg = (arr) => { let s2 = 0; for (let a = 0; a < arr.length; a++) s2 += arr[a] / r.arcT0[a]; return s2 / arr.length; };
      const stat = (arr) => { let mn = Infinity, mx = 0, sm = 0, n = 0; for (let a = 0; a < arr.length; a++) { const v = arr[a]; if (!(v > 0)) continue; mn = Math.min(mn, v); mx = Math.max(mx, v); sm += v; n++; } return { mn: mn.toFixed(3), mx: mx.toFixed(3), mean: (sm / n).toFixed(3), n }; };
      const st2 = stat(time), sb2 = stat(bt);
      console.log(`[diag] 检查用时间 min/mean/max ${st2.mn}/${st2.mean}/${st2.mx} · 建树时 ${sb2.mn}/${sb2.mean}/${sb2.mx} · 拥堵 ${cg(time).toFixed(3)} / ${cg(bt).toFixed(3)}`);
      const seeds = []; for (let k = m.roadData.start[0]; k < m.roadData.start[1]; k++) seeds.push(m.roadData.nodes[k] + '@' + m.roadData.times[k].toFixed(2));
      console.log('[diag] 起点0 的接驳点 ' + seeds.join(' '));
      const o = [...old.arcs.keys()][0];
      replay(old.arcs.get(o), o, time);
      const rp = Float64Array.from(dist);
      build(o, time);
      let cnt = 0, mx = 0, at = -1;
      for (let n = 0; n < r.nN; n++) {
        if (rp[n] < Infinity && bd[n] < Infinity) {
          const d = Math.abs(rp[n] - bd[n]);
          if (d > 1e-6) { cnt++; if (d > mx) { mx = d; at = n; } }
        }
      }
      const arcs0 = old.arcs.get(o);
      let roots = 0; for (const e of arcs0) if (e < 0) roots++;
      console.log(`[diag] 起点 ${o}: 树 ${arcs0.length} 弧 / 根 ${roots} · 重放与重建 ${cnt} 个节点不同，最大差 ${mx.toFixed(4)} 分 @${at}`);
    }
    const dr = [];
    for (let a = 0; a < baseNet.nA; a++) {
      const na = old.lut ? old.lut[a] : a;
      if (na < 0) continue;
      dr.push(Math.abs(time[na] - bt[a]) / Math.max(bt[a], 1));
    }
    dr.sort((x, y) => x - y);
    gaps.sort((a, b) => a - b);
    const qq = (p2) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p2))];
    const over = {};
    for (const e of [0.001, 0.005, 0.01, 0.02, 0.05]) over[e] = gaps.filter((g) => g > e).length;
    rows.push({
      key: q.key, checked,
      q50: qq(0.5), q90: qq(0.9), q99: qq(0.99), qmax: gaps[gaps.length - 1], over,
      tCheck, tRebuildBad, tFull,
      driftMed: dr[Math.floor(dr.length * 0.5)], driftP90: dr[Math.floor(dr.length * 0.9)],
      lost: old.lost, ident: old.identical, dup: old.dup || 0,
    });
  }
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  console.log(`\n[复用 ${mo} 个月] 弧 ${net.nA}（救不回 ${rows[0].lost}${rows[0].ident ? ' · 弧表逐条相同' : ' · 弧号重排（平行弧 ' + rows[0].dup + ' 对）'}）`
    + ` · arcTime 漂移 中位 ${(rows[0].driftMed * 100).toFixed(3)}% / p90 ${(rows[0].driftP90 * 100).toFixed(3)}%`);
  console.log('  时段    最大可改进幅度 p50/p90/p99/max     >0.1%    >0.5%      >1%      >2%      >5%'
    + '   检查 重建坏 全量 省');
  for (const r of rows) {
    const save = (1 - (r.tCheck + r.tRebuildBad) / r.tFull) * 100;
    console.log(`  ${r.key.padEnd(7)}`
      + `${(r.q50 * 100).toFixed(2)}%/${(r.q90 * 100).toFixed(2)}%/${(r.q99 * 100).toFixed(2)}%/${(r.qmax * 100).toFixed(1)}%`
      + [0.001, 0.005, 0.01, 0.02, 0.05].map((e) => `${(r.over[e] / r.checked * 100).toFixed(1)}%`.padStart(9)).join('')
      + `  ${r.tCheck.toFixed(2)} ${r.tRebuildBad.toFixed(2)} ${r.tFull.toFixed(2)} ${save.toFixed(0)}%`);
  }
  console.log(`  合计  检查 ${sum('tCheck').toFixed(2)} s · 只重建(ε>1%) ${sum('tRebuildBad').toFixed(2)} s`
    + ` · 全量 ${sum('tFull').toFixed(2)} s`
    + ` · 节省 ${(100 * (1 - (sum('tCheck') + sum('tRebuildBad')) / sum('tFull'))).toFixed(0)}%`);
  settle();
}
