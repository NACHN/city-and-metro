// 路网每月变动，到底破坏了每棵最短路树的「多少」——子树哈希/局部修复值不值得做。
//
// 背景：树的整树缓存被判死，是因为「用到消失弧的整棵树作废」，而消失的常常是要道，
// 2 条弧就能带走 88% 的树。但那 88% 里可能只有很小一部分节点在受损子树里。
// 这个探针量两件事：
//   1. 每条消失的弧，能不能在新图里找到替代（同端点 → 直接；2–3 跳 → 可拼接）
//   2. 每棵树里，有多少节点位于「父弧失效且无法替代」的子树中（= 必须重建的部分）
//
// 节点身份用顶点号（road.nodeVert），它是城市网格里的固定编号，跨月稳定；
// 弧的端点换成顶点对之后，就不要 link.key 了（key 里含折点数，路一被延伸就变）。
//
// 用法：node tools/tree-damage.mjs [mapId] [months]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const argv = process.argv.slice(2);
const mapId = argv.find((a) => !a.startsWith('--')) || 'gz2';
const MONTHS = +(argv.find((a) => a.startsWith('--months=')) || '--months=8').split('=')[1];
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

let armed = false;
let curKey = null;
const trees = new Map();
globalThis.__onTree = (o, no, order, pred) => {
  if (!armed || !curKey) return;
  let t = trees.get(curKey);
  if (!t) { t = new Map(); trees.set(curKey, t); }
  const a = new Int16Array(no);
  for (let q = 0; q < no; q++) a[no - 1 - q] = pred[order[q]];
  t.set(o, { no, arcs: a });
};
globalThis.__onDem = (key) => { curKey = key; };

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
if (!simSrc.includes(hookTree)) throw new Error('钩子锚点失效');
simSrc = simSrc.replace(hookTree, hookTree + '\n    if (globalThis.__onTree) globalThis.__onTree(o, no, work.order, work.pred);')
  .replace('      odOrigin(K, i);', '      odOrigin(K, i);')
  .replace(`    let cnt = 0;
    for (let i = 0; i < Z; i++) {
      odOrigin(K, i);
      if ((++cnt & 7) === 0) yield;
    }`, `    let cnt = 0;
    for (let i = 0; i < Z; i++) {
      odOrigin(K, i);
      if ((++cnt & 7) === 0) yield;
    }
    if (globalThis.__onDem) globalThis.__onDem(P.dt + '|' + p);`);
vm.runInThisContext(simSrc, { filename: 'js/sim.js' });

for (const f of ['js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js']) L(path.join(root, f));

const CM = globalThis.CM;
CM.useMap(mapId);
const g = CM.Game.create({ map: mapId, preset: 'normal', name: 'dmg' });
const m = g.model;
console.log(`图 ${mapId}：小区 ${m.Z} · 节点 ${m.road.nN} · 有向弧 ${m.road.nA}`);

// 快照当前路网：节点身份用顶点号
const snapRoad = () => {
  const r = m.road;
  return {
    nA: r.nA, nN: r.nN,
    // 接驳点也要按旧编号存：roadData 每月重建，新编号对不上旧树
    connStart: Int32Array.from(m.roadData.start),
    connNode: Int32Array.from(m.roadData.nodes),
    nodeVert: Int32Array.from(r.nodeVert),
    vertNode: Int32Array.from(r.vertNode),
    arcFrom: Int32Array.from(r.arcFrom),
    arcTo: Int32Array.from(r.arcTo),
    outStart: Int32Array.from(r.outStart),
    outArc: Int32Array.from(r.outArc),
  };
};

const advanceMonth = () => {
  let crossed = false;
  while (!crossed) crossed = g.endDay();
  const gen = g.monthGen();
  for (let rr = gen.next(); !rr.done; rr = gen.next()) { /* 跑完 */ }
};
const settle = () => { let guard = 0; while (!m.settled && guard++ < 600) m.step(2000); };

advanceMonth();
settle();
console.log(`[月 1] 已收敛 · roadVersion ${g.city.roadVersion}\n`);

const PERIOD = m.ctxs.wd.per[1];
const quant = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);

console.log('月  弧     消失   同端点→直接  2–3跳→可拼接  无法替代(节点消失)   树的受损节点占比 中位/p90/最大   零受损树');
for (let mo = 0; mo < MONTHS; mo++) {
  // 1) 抓这一轮全部起点在 wd|1 的树
  armed = true; trees.clear(); curKey = null;
  {
    const gen = m.iterate(m.net, PERIOD, 1, { fullSkim: true });
    for (let rr = gen.next(); !rr.done; rr = gen.next()) { /* 跑完 */ }
  }
  armed = false;
  const snapshot = trees.get('wd|1');
  const old = snapRoad();

  // 2) 过一个月
  advanceMonth();
  const nw = m.road;
  const newVertNode = nw.vertNode;

  // 3) 弧映射：旧弧的端点换成顶点 → 找新图里同端点的弧；找不到就 BFS 2–3 跳
  //    key 里含折点数（路被延伸就变），所以这里完全不用 key。
  const byPair = new Map();
  for (let a = 0; a < nw.nA; a++) byPair.set(nw.arcFrom[a] * 100000 + nw.arcTo[a], a);
  const oldToNew = new Int32Array(old.nA).fill(-1);   // -1 = 无法直连；-2 = 不可救
  const needSplice = [];
  let direct = 0, spliced = 0, hopeless = 0, vanished = 0;
  for (let a = 0; a < old.nA; a++) {
    const vf = old.nodeVert[old.arcFrom[a]], vt = old.nodeVert[old.arcTo[a]];
    const nf = newVertNode[vf], nt = newVertNode[vt];
    if (nf < 0 || nt < 0) { oldToNew[a] = -2; hopeless++; vanished++; continue; }
    const hit = byPair.get(nf * 100000 + nt);
    if (hit !== undefined) { oldToNew[a] = hit; direct++; }
    else { oldToNew[a] = -1; needSplice.push(a); vanished++; }
  }
  // 2–3 跳拼接：在旧弧两端的新节点之间找一条最短路（限 3 跳）
  const spliceLen = new Map();
  for (const a of needSplice) {
    const vf = old.nodeVert[old.arcFrom[a]], vt = old.nodeVert[old.arcTo[a]];
    const s = newVertNode[vf], t = newVertNode[vt];
    let found = 0;
    // 深度受限 BFS（只沿出弧）
    const qn = [s], qd = [0];
    let head = 0, hitLen = 0;
    while (head < qn.length && !hitLen) {
      const u = qn[head], d = qd[head]; head++;
      if (d >= 3) continue;
      for (let k = nw.outStart[u]; k < nw.outStart[u + 1]; k++) {
        const v = nw.arcTo[nw.outArc[k]];
        if (v === t) { hitLen = d + 1; break; }
        qn.push(v); qd.push(d + 1);
      }
    }
    if (hitLen) { spliceLen.set(a, hitLen); spliced++; } else { oldToNew[a] = -2; hopeless++; }
  }

  // 4) 每棵树的受损节点占比：父弧不可用 → 整棵子树失效
  const dam = [];
  const reach = new Int8Array(old.nN);
  for (const [o, tr] of snapshot) {
    reach.fill(0);
    // 根 = 接驳点
    for (let k = old.connStart[o]; k < old.connStart[o + 1]; k++) reach[old.connNode[k]] = 1;
    const A = tr.arcs, no = tr.no;
    let live = 0;
    // 反向遍历 = settle 正序（父先于子）
    for (let i = no - 1; i >= 0; i--) {
      const e = A[i];
      if (e < 0) { live++; continue; }
      const child = old.arcTo[e], parent = old.arcFrom[e];
      if (reach[parent] && oldToNew[e] !== -2) { reach[child] = 1; live++; }
    }
    dam.push(1 - live / Math.max(1, no));
  }
  dam.sort((a, b) => a - b);
  if (process.env.DIAG) {
    const samples = [...snapshot.entries()].slice(0, 3).map(([o, tr]) => {
      let roots = 0;
      for (let i = 0; i < tr.no; i++) if (tr.arcs[i] < 0) roots++;
      return 'o' + o + ' no=' + tr.no + ' 根=' + roots;
    });
    console.log('   [diag] ' + samples.join(' | ') + ' · 受损中位 ' + (quant(dam, 0.5) * 100).toFixed(3) + '%');
  }
  const zero = dam.filter((d) => d === 0).length;
  console.log(`${String(mo + 1).padStart(2)} ${String(old.nA).padStart(6)} ${String(vanished).padStart(6)}`
    + `   ${String(direct).padStart(9)}  ${String(spliced).padStart(11)}  ${String(hopeless).padStart(15)}`
    + `      ${(quant(dam, 0.5) * 100).toFixed(2)}%/${(quant(dam, 0.9) * 100).toFixed(2)}%/${(dam[dam.length - 1] * 100).toFixed(2)}%`
    + `   ${zero}/${dam.length}`);
  settle();
}
