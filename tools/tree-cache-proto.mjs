// 跨月复用最短路树 —— 实验结论：**不划算，不接入游戏**（保留原型与数据，免得以后重跑）
//
// 机制是可行的，而且可以做到逐位一致：
//   · 树可以只存**弧号序列**（2 B/点），不必存节点顺序 —— 回溯只要按 settle 逆序取 pred 弧，
//     距离可以从树反推（序列反过来 = settle 正序，dist[arcTo[e]] = dist[arcFrom[e]] + t[e]）。
//   · 同树同时间重放，aux 逐位相同（自检 8/8）。
//   · 重放比重新建树快 5.2 倍：8 个时段 2.0 s vs 10.4 s。
//
// 但真正卡住它的是**路网每月都在变**（见 tools/road-churn.mjs）：
//   · 城市每月重建 car 图，link.key = 两端点 + 折点数，所以一条路被延伸/拆分就会换 key；
//     实测 14 个月里只有 5 个月「零弧消失」，其余 1–14 条弧消失或换 key。
//   · 按 key 重映射弧号可行（约 0.3–0.7 s / 8 个时段），但**消失的弧**会让用到它的整棵树作废 ——
//     消失的往往是干道，2 条弧消失就能带走 2514/2838 棵树（88%）。
//   · 于是平均收益只有 8 s × 36% ≈ 2.9 s/月（月步进 13.5 s 的 21%），其余月份等于没做；
//     而且它**完全帮不到载入**（没有上一个月可复用）。
//
// 对比 Web Worker 分起点：2.5–4×，每个月都生效，载入也一起变快，不改数值口径。
// 所以这条路留作记录：数据在这里，结论是「不值得」。
//
// 基准数据（gz2，240×192 / 2880 小区 / 6189 节点 / 14746 弧）：
//   · 8 个时段 2,838 棵/时段，合计 1.1 亿个回溯条目
//   · 编码体积：原始 210.7 MB · brotli q3 47.1 MB（1.15 s）· brotli q5 37.2 MB（3.9 s，解压 0.54 s）
//   · 干净月份（零弧消失）：全城车流偏差 −0.4%~+0.01%，单弧流量中位 0.03%~5.8%，8%~47% 的弧有差异
//
// 用法：node tools/tree-cache-proto.mjs [mapId]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const mapId = argv.find((a) => !a.startsWith('--')) || 'gz2';
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

// ---------- 钩子 ----------
let armed = false;
let curKey = null;
const stage = { trees: new Map(), dem: new Map(), aux: new Map(), seen: new Map() };
const resetStage = () => { stage.trees.clear(); stage.dem.clear(); stage.aux.clear(); stage.seen.clear(); };

globalThis.__onDem = (key, carDem) => {
  curKey = key;
  if (armed) stage.dem.set(key, Float32Array.from(carDem));
};
globalThis.__onTree = (o, no, order, pred) => {
  if (!armed || !curKey) return;
  let t = stage.trees.get(curKey);
  if (!t) { t = new Map(); stage.trees.set(curKey, t); stage.seen.set(curKey, new Set()); }
  const a = new Int16Array(no);
  for (let q = 0; q < no; q++) a[no - 1 - q] = pred[order[q]];   // 存成回溯顺序
  t.set(o, { no, arcs: a });
  stage.seen.get(curKey).add(o);
};
globalThis.__onAux = (key, aux) => {
  if (armed) stage.aux.set(key, Float32Array.from(aux));
};

const parked = (rel) => {
  const p = path.join(root, 'maps', mapId, 'parked', path.basename(rel));
  return fs.existsSync(path.join(root, rel)) ? path.join(root, rel) : p;
};
const L = (f) => vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });

for (const f of ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js', 'js/geo_gz.js', 'js/geo.js',
  'js/data_gz.js', 'js/data_tutorial.js', 'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js',
  'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js']) L(path.join(root, f));
L(parked('js/geo_' + mapId + '.js'));
L(parked('js/data_' + mapId + '.js'));
for (const f of ['js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js']) L(path.join(root, f));

let simSrc = fs.readFileSync(path.join(root, 'js/sim.js'), 'utf8');
const hookTree = 'const no = roadTree(road, rd, cw.time, o, work, cw.heap);';
const odLoop = `    let cnt = 0;
    for (let i = 0; i < Z; i++) {
      odOrigin(K, i);
      if ((++cnt & 7) === 0) yield;
    }`;
const beforeBpr = `    const lam = P.iters === 0 ? 1 : (opts.lam || CFG.road.msa);`;
for (const s of [hookTree, odLoop, beforeBpr]) if (!simSrc.includes(s)) throw new Error('钩子锚点失效：' + s.slice(0, 40));
simSrc = simSrc.replace(hookTree, hookTree + '\n    if (globalThis.__onTree) globalThis.__onTree(o, no, work.order, work.pred);')
  .replace(odLoop, odLoop + `\n    if (globalThis.__onDem) globalThis.__onDem(P.dt + '|' + p, carDem);`)
  .replace(beforeBpr, `    if (globalThis.__onAux) globalThis.__onAux(P.dt + '|' + p, aux);\n` + beforeBpr);
vm.runInThisContext(simSrc, { filename: 'js/sim.js' });

for (const f of ['js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js']) L(path.join(root, f));

const CM = globalThis.CM;
CM.useMap(mapId);
const tCreate = performance.now();
const g = CM.Game.create({ map: mapId, preset: 'normal', name: 'proto' });
const tCreateMs = performance.now() - tCreate;
const m = g.model;
const road = m.road, rd = m.roadData;
const Z = m.Z, nN = road.nN, nA = road.nA;
const arcFrom = road.arcFrom, arcTo = road.arcTo, arcKm = rd.arcKm;
const cStart = rd.start, cNode = rd.nodes, cTime = rd.times, cKm = rd.km, zones = rd.zones;
const MB = (b) => (b / 1048576).toFixed(1);
console.log(`图 ${mapId}：小区 ${Z} · 节点 ${nN} · 有向弧 ${nA} · 建局 ${(tCreateMs / 1000).toFixed(1)} s`);
console.log(`接驳小区 ${zones.length} · 接驳条目 ${cNode.length} · skim 每时段 ${MB(Z * Z * 4 * 2)} MB（时间+里程）`);

const periods = [];
for (const dt of ['wd', 'we']) for (let p = 0; p < 4; p++) periods.push({ dt, p, key: dt + '|' + p });
const P_of = (pq) => m.ctxs[pq.dt].per[pq.p];

// ---------- 重放：给定树、（当前的）arcTime 与需求，算出 aux 与 skim ----------
function replay(trees, time, dem, origins, outAux, outSkim) {
  // 城市每月重建一次路网对象（弧号可能整体重排），所以这里必须实时读，不能用加载时抓的引用
  const road = m.road, rdd = m.roadData;
  const nN = road.nN;
  const arcFrom = road.arcFrom, arcTo = road.arcTo, arcKm = rdd.arcKm;
  const cStart = rdd.start, cNode = rdd.nodes, cTime = rdd.times, cKm = rdd.km, zones = rdd.zones;
  const dist = new Float64Array(nN), dkm = new Float32Array(nN), accN = new Float64Array(nN);
  let replayed = 0, absent = 0, nodes = 0;
  for (const o of origins) {
    const tr = trees.get(o);
    if (!tr) { absent++; continue; }
    replayed++; nodes += tr.no;
    dist.fill(Infinity);
    for (let k = cStart[o]; k < cStart[o + 1]; k++) {
      const v = cNode[k], tt = cTime[k];
      if (tt < dist[v]) { dist[v] = tt; dkm[v] = cKm[k]; }
    }
    const A = tr.arcs, no = tr.no;
    // 反过来一趟 = settle 正序：父节点一定先算好（拓扑性质，换新时间也成立）
    for (let i = no - 1; i >= 0; i--) {
      const e = A[i];
      if (e < 0) continue;
      const n = arcTo[e];
      dist[n] = dist[arcFrom[e]] + time[e];
      dkm[n] = dkm[arcFrom[e]] + arcKm[e];
    }
    const row = o * Z;
    for (let zi = 0; zi < zones.length; zi++) {
      const d = zones[zi];
      if (d === o) continue;
      let best = Infinity, bn = -1;
      for (let k = cStart[d]; k < cStart[d + 1]; k++) {
        const nd = cNode[k], v = dist[nd] + cTime[k];
        if (v < best) { best = v; bn = nd; }
      }
      if (bn < 0 || best >= Infinity) continue;
      if (outSkim) outSkim[row + d] = best;
      const dm = dem[row + d];
      if (dm > 0) accN[bn] += dm;
    }
    for (let i = 0; i < no; i++) {
      const e = A[i];
      if (e < 0) continue;
      const n = arcTo[e], a = accN[n];
      if (a > 0) { outAux[e] += a; accN[arcFrom[e]] += a; accN[n] = 0; }
    }
    for (let k = cStart[o]; k < cStart[o + 1]; k++) accN[cNode[k]] = 0;   // 种子累加器必须清
  }
  return { replayed, absent, nodes };
}
const quant = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
const relStats = (a, b) => {
  const rel = [];
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) { same++; continue; }
    if (a[i] <= 0.5 && b[i] <= 0.5) continue;
    rel.push(Math.abs(b[i] - a[i]) / Math.max(Math.abs(a[i]), 1));
  }
  rel.sort((x, y) => x - y);
  return { med: quant(rel, 0.5), p90: quant(rel, 0.9), max: rel.length ? rel[rel.length - 1] : 0, diffShare: 1 - same / a.length };
};
const pct = (x) => (x * 100).toFixed(2) + '%';

const settle = () => { let guard = 0; while (!m.settled && guard++ < 600) m.step(2000); };
const advanceMonth = () => {
  let crossed = false;
  while (!crossed) crossed = g.endDay();
  const t0 = performance.now();
  const gen = g.monthGen();
  for (let r = gen.next(); !r.done; r = gen.next()) { /* 跑完 */ }
  return performance.now() - t0;
};
// 用某个缓存重放本时段，并与真值比（skim 只在本时段内存活，不复制）
const compareOne = (t, sources) => {
  const P = P_of(periods.find((x) => x.key === t.key));
  const out = {};
  for (const src of sources) {
    const trees = src.trees instanceof Map ? src.trees.get(t.key) : src.trees.find((c) => c.key === t.key).trees;
    const nAc = m.road.nA;
    const repAux = new Float32Array(nAc);
    const repSkim = new Float32Array(Z * Z);
    const t0 = performance.now();
    const info = replay(trees, P.arcTime, t.dem, t.seen, repAux, repSkim);
    const ms = performance.now() - t0;
    const st = relStats(t.aux, repAux);
    const skRel = [];
    for (let i = 0; i < Z * Z; i++) if (P.skimT[i] > 0 && repSkim[i] > 0) skRel.push(Math.abs(repSkim[i] - P.skimT[i]) / P.skimT[i]);
    skRel.sort((a, b) => a - b);
    let vT = 0, vR = 0, hT = 0, hR = 0;
    for (let a = 0; a < nAc; a++) {
      vT += t.aux[a]; vR += repAux[a];
      hT += t.aux[a] * P.arcTime[a]; hR += repAux[a] * P.arcTime[a];
    }
    out[src.name] = { ms, st, info, skMed: quant(skRel, 0.5), skP90: quant(skRel, 0.9),
      skMax: skRel.length ? skRel[skRel.length - 1] : 0, vT, vR, hT, hR };
    if (process.env.DIAG) {
      let sumDem = 0;
      for (let i = 0; i < t.dem.length; i++) sumDem += t.dem[i];
      console.log(`    [diag ${src.name}] Σdem=${Math.round(sumDem)} Σaux(真)=${Math.round(vT)} Σaux(复放)=${Math.round(vR)}`
        + ` 起点 ${info.replayed} 缺 ${info.absent} 平均每树 ${(info.nodes / Math.max(1, info.replayed)).toFixed(0)} 点`);
    }
  }
  return out;
};

// 显式跑「每个时段的第一个 cycle」（全量分配），抓树与真值；sources 非空时顺手比一遍
const firstPass = (sources) => {
  armed = true; resetStage(); curKey = null;
  const rows = [];
  for (const pq of periods) {
    const P = P_of(pq);
    const t0 = performance.now();
    const gen = m.iterate(m.net, P, pq.p, { fullSkim: true });
    for (let r = gen.next(); !r.done; r = gen.next()) { /* 跑完 */ }
    const ms = performance.now() - t0;
    const rec = {
      key: pq.key, ms,
      aux: Float32Array.from(m.liveBuf.roadWork.aux),
      dem: stage.dem.get(pq.key),
      seen: [...(stage.seen.get(pq.key) || [])],
      trees: stage.trees.get(pq.key),
      timeSnap: Float32Array.from(P.arcTime),
    };
    if (sources) rec.cmp = compareOne(rec, sources);
    rows.push(rec);
  }
  armed = false;
  return rows;
};

// ---------- 弧号重映射：城市每月重建路网，弧号会整体重排 ----------
// syncRoad 是按 link.key 把状态搬过去的，所以旧树里的弧号也能按 key 翻译成新弧号。
// 翻译不了的（道路消失了）→ 那棵树作废，只重建那个起点。
const cacheLinks = () => m.road.links.map((L) => ({ key: L.key, id: L.id, v0: L.verts[0] }));
const remapTrees = (cache) => {
  const byKey = new Map();
  for (const L of m.road.links) byKey.set(L.key, L);
  const lut = new Int32Array(cache.nA).fill(-1);
  let mapped = 0;
  for (const o of cache.links) {
    const n = byKey.get(o.key);
    if (!n) continue;
    const same = o.v0 === n.verts[0];
    lut[2 * o.id] = 2 * n.id + (same ? 0 : 1);
    lut[2 * o.id + 1] = 2 * n.id + (same ? 1 : 0);
    mapped += 2;
  }
  const gone = cache.nA - mapped;
  const trees = new Map();
  let dropped = 0, remapped = 0;
  for (const [key, list] of cache.trees) {
    const out = new Map();
    for (const [o, tr] of list) {
      const a = new Int16Array(tr.arcs.length);
      let ok = true;
      for (let i = 0; i < a.length; i++) {
        const e = tr.arcs[i];
        if (e < 0) { a[i] = -1; continue; }
        const ne = lut[e];
        if (ne < 0) { ok = false; break; }
        a[i] = ne;
      }
      if (!ok) { dropped++; continue; }
      out.set(o, { no: tr.no, arcs: a });
      remapped++;
    }
    trees.set(key, out);
  }
  return { trees, dropped, remapped, gone };
};

// ---------- 按月推进 ----------
const grabCache = (truth) => ({
  trees: new Map(truth.map((t) => [t.key, t.trees])),
  links: cacheLinks(),
  nA: m.road.nA,
  time: truth.map((t) => ({ key: t.key, time: t.timeSnap })),
});

advanceMonth();
settle();
const months = [];
let last = null;    // 上个月的树
let base = null;    // 最早那个月的树（不刷新，用来量「复用 N 个月」的偏差）
let baseAge = 0;

for (let mo = 2; mo <= 7; mo++) {
  const genMs = advanceMonth();
  const arcs = m.road.nA;
  const sources = [];
  let note = '无缓存';
  const tRemap = performance.now();
  if (last) sources.push({ name: '上月', trees: remapTrees(last).trees });
  if (base) { sources.push({ name: `${baseAge}个月前`, trees: remapTrees(base).trees }); }
  const remapMs = performance.now() - tRemap;
  if (sources.length) note = `重映射 ${remapMs.toFixed(0)} ms`;

  const truth = firstPass(sources.length ? sources : null);
  const sumTruth = truth.reduce((s, t) => s + t.ms, 0);
  months.push({ mo, arcs, genMs, sumTruth });
  console.log(`\n[月 ${mo}] nA ${arcs} · monthGen ${(genMs / 1000).toFixed(2)} s · 重建 8 时段 ${(sumTruth / 1000).toFixed(2)} s · ${note}`);

  for (const src of sources) {
    console.log(`  ── 复用「${src.name}」 ──  时段   重放/重建     aux 偏差 中位/p90/最大     不同弧    skim 偏差 中位/p90`);
    for (const t of truth) {
      const s2 = t.cmp[src.name];
      console.log(`  ${t.key.padEnd(7)}${s2.ms.toFixed(0).padStart(5)}/${t.ms.toFixed(0).toString().padStart(5)}ms`
        + `   ${pct(s2.st.med).padStart(7)}/${pct(s2.st.p90).padStart(7)}/${pct(s2.st.max).padStart(8)}`
        + `   ${pct(s2.st.diffShare).padStart(6)}`
        + `    ${pct(s2.skMed).padStart(7)}/${pct(s2.skP90).padStart(7)}`
        + `   起点 ${s2.info.replayed}`);
    }
    const sumRep = truth.reduce((a, t) => a + t.cmp[src.name].ms, 0);
    const dv = truth.reduce((a, t) => a + (t.cmp[src.name].vR / t.cmp[src.name].vT - 1), 0) / truth.length;
    const dh = truth.reduce((a, t) => a + (t.cmp[src.name].hR / t.cmp[src.name].hT - 1), 0) / truth.length;
    console.log(`  合计：重放 ${(sumRep / 1000).toFixed(2)} s vs 重建 ${(sumTruth / 1000).toFixed(2)} s（${(sumTruth / sumRep).toFixed(1)}×）`
      + ` · 全城车流 ${(dv * 100).toFixed(3)}% · 总车时 ${(dh * 100).toFixed(3)}%`);
  }

  last = grabCache(truth);
  if (!base) { base = last; baseAge = 0; }
  baseAge++;
  settle();
}
