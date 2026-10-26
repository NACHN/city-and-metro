// 可达性窗口对比：30 / 40 / 50 / 60 分钟可达岗位，接入地价与容积率
//（node scripts/exp-access.mjs [years]）
//
// 目的：验证「远程通勤」需要的可达性窗口有多长。做法是让地价的可达项与容积率的可达项
// 都读「T 分钟内可达岗位数」（而不是离站距离），并叠加地价惩罚，看城市形态怎么变。
// 每个变体都从同一张广州图、同一个种子重新生成；补丁只作用于本次运行的内存副本。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {}, append() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, offsetWidth: 100, offsetHeight: 40, innerHTML: '', textContent: '', getContext() { return null; } });
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { createElement: el, createElementNS: el, addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }, body: el(), querySelector() { return null; }, getElementById() { return null; } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

// ---------------- city.js 补丁 ----------------
let citySrc = fs.readFileSync(path.join(root, 'js/city.js'), 'utf8');
const patch = (a, b, tag) => { if (citySrc.indexOf(a) < 0) throw new Error('补丁锚点缺失：' + tag); citySrc = citySrc.replace(a, b); };
// 1) 需求表里的 jobAccess 始终可用（不依赖 GROWTH_ACCESS.from）
patch('    const ja = jaOn ? ctx.jobAccess : null;', '    const ja = ctx.jobAccess || null;', 'ja');
patch('    if (jaOn) {\n      let sum = 0, n = 0;', '    if (ja) {\n      let sum = 0, n = 0;', 'jaMean');
// 2) 容积率的可达项来自 ctx.accFar
patch('      const Ld = CFG.land;\n      let farK = 1;\n      if (this.landAcc && Ld && Ld.farGain > 0) {\n        const am = this.landAcc[c] || 1;',
  '      const Ld = CFG.land;\n      let farK = 1;\n      const __am = ctx.accFar ? ctx.accFar[c] : (this.landAcc ? this.landAcc[c] : 0);\n      if (__am && Ld && Ld.farGain > 0) {\n        const am = __am || 1;', 'farK');
// 3) 地价惩罚（同样可达性下，越贵越盖不动）
patch('        if (am > 1.02) farK = 1 + Ld.farGain * Math.min(1, (am - 1) / (Ld.accessGain || 0.7));',
  '        if (am > 1.02) farK = 1 + Ld.farGain * Math.min(1, (am - 1) / (Ld.accessGain || 0.7));\n        if (ctx.priceK) farK *= ctx.priceK[c];', 'price');
// 4) 地价的可达项：优先用「T 分钟可达岗位」的乘子
patch('      if (walk) { const wm = Math.min(walk[c] || 0, 4000); accMul = 1 + L.accessGain * Math.exp(-wm / L.accessScale); }',
  '      if (this._accMulArr) accMul = this._accMulArr[c] || 1;\n      else if (walk) { const wm = Math.min(walk[c] || 0, 4000); accMul = 1 + L.accessGain * Math.exp(-wm / L.accessScale); }', 'landAcc');

const FILES = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js','js/data_tutorial.js',
 'js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js',
 'js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js'];
for (const f of FILES) {
  const src = f === 'js/city.js' ? citySrc : fs.readFileSync(path.join(root, f), 'utf8');
  vm.runInThisContext(src, { filename: f });
}
const CM = globalThis.CM, M = CM.Metro, U = CM.U, CFG = CM.CFG;
CM.useMap('gz');
const YEARS = Number(process.argv[2] || 25);

// T 分钟内可达的权重场之和（与 Model.computeJobAccess 同口径）
function accessSum(model, capMin, weights) {
  const Z = model.Z, acc = model.net && model.net.acc;
  const P0 = model.ctxs && model.ctxs.wd && model.ctxs.wd.per ? model.ctxs.wd.per[1] : null;
  const car = P0 ? P0.skimT : null;
  const gt = model.liveBuf && model.liveBuf.skim ? model.liveBuf.skim.gt : null;
  const N = model.net && model.net.C ? model.net.C.stations.length : 0;
  const walkW = (CFG.choice && CFG.choice.walkW) || 1;
  const zl = acc ? acc.zl : null;
  const out = new Float32Array(Z);
  for (let i = 0; i < Z; i++) {
    let s = weights[i];
    const lo = zl ? zl[i] : null;
    for (let j = 0; j < Z; j++) {
      if (i === j || !(weights[j] > 0)) continue;
      let t = Infinity;
      if (car) { const v = car[i * Z + j]; if (v > 0 && v < 1e8) t = v; }
      if (t > capMin && lo && gt && zl && zl[j] && N > 0) {
        const ld = zl[j];
        for (let a = 0; a < lo.length; a++) {
          const A = lo[a], row = A.s * N;
          for (let b = 0; b < ld.length; b++) { const B = ld[b]; if (A.s === B.s) continue; const g = gt[row + B.s]; if (!(g < 1e8)) continue; const v = walkW * (A.w + B.w) + g; if (v < t) t = v; }
        }
      }
      if (t <= capMin) s += weights[j];
    }
    out[i] = s;
  }
  return out;
}

function run(label, T, usePrice, k) {
  const Y0 = CFG.START.y;
  const city = new CM.City(); city.generate(Y0 * 10000 + 101, Y0);
  const openByYear = function (yr) {
    for (let kk = 0; kk < city.regions.length; kk++) { const rg = city.regions[kk]; if (!city.regionOpen[kk] && rg.open != null && rg.open <= yr) city.openRegion(kk, yr, 0); }
  };
  openByYear(Y0);
  const net = M.empty();
  const model = new CM.Model(city);
  model.setNetwork(M.compile(net, city));
  // 初始重心与产业区
  const center = function () {
    let sx = 0, sy = 0, sw = 0;
    for (let c = 0; c < city.N; c++) { const w = city.pop[c] + city.jobs[c]; if (w <= 0) continue; sx += (c % city.W) * w; sy += ((c / city.W) | 0) * w; sw += w; }
    return { x: sx / Math.max(1, sw), y: sy / Math.max(1, sw) };
  };
  const C0 = center();
  const districts = [];
  let lineStations = [];
  for (let m = 0; m < YEARS * 12; m++) {
    const yy = Y0 + Math.floor(m / 12);
    if (m % 12 === 0) openByYear(yy);
    if (m % 6 === 0) { model.setNetwork(M.compile(net, city)); model.solveNow(2); }
    // 第 8 年在外围播一片 3×3 工业，并修一条快线连过去（保证走廊存在）
    if (m === 96 && !districts.length) {
      let best = -1, bestD = -1;
      for (let c = 0; c < city.N; c++) {
        if (city.landFrac[c] < 0.7 || city.lu[c] !== 0 || !city.regionOpen[city.region[c]]) continue;
        const d = U.dist(C0.x, C0.y, (c % city.W) + 0.5, ((c / city.W) | 0) + 0.5) * CFG.CELL_M / 1000;
        if (d < 8 || d > 16) continue;
        if (d > bestD) { bestD = d; best = c; }
      }
      if (best >= 0) {
        const bi = best % city.W, bj = (best / city.W) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = bi + di, jj = bj + dj;
          if (ii < 0 || jj < 0 || ii >= city.W || jj >= city.H) continue;
          const c = jj * city.W + ii;
          if (city.landFrac[c] >= 0.7 && city.lu[c] === 0) city.plan[c] = 3;   // LU.IND
        }
        districts.push({ x: bi + 0.5, y: bj + 0.5 });
        // 快线：从初始重心到产业区，站距约 4 km
        const lid = M.newLine(net, '快线');
        const dx = bi + 0.5 - C0.x, dy = bj + 0.5 - C0.y, len = Math.hypot(dx, dy), n = Math.max(2, Math.round(len / 16));
        let prev = null;
        for (let q = 0; q <= n; q++) {
          const sid = M.addStation(net, Math.round(C0.x + dx * q / n) + 0.5, Math.round(C0.y + dy * q / n) + 0.5, { size: 'M', type: 'elevated' }, city);
          if (prev) M.addSegment(net, lid, prev, sid, [], 'elevated');
          prev = sid;
          const so = net.stations[sid];
          lineStations.push([so.x, so.y]);
        }
        city.version++;
        model.setNetwork(M.compile(net, city)); model.solveNow(2);
      }
    }
    // 可达性乘子：T 分钟内可达岗位（住宅与岗位容量、地价共用同一个量）
    const jT = accessSum(model, T, model.zJobs);
    let mx = 0;
    for (let z = 0; z < jT.length; z++) if (jT[z] > mx) mx = jT[z];
    const gain = (CFG.land && CFG.land.accessGain) || 0.7;
    const accArr = new Float32Array(city.N);
    for (let c = 0; c < city.N; c++) accArr[c] = 1 + gain * (mx > 0 ? Math.sqrt(jT[city.zoneOf(c)] / mx) : 0);
    city._accMulArr = accArr;
    // 地价（含可达项）→ 惩罚乘子
    let priceArr = null;
    if (usePrice) {
      city.buildLandPrice(yy, model.net && model.net.acc ? model.net.acc : null);
      const p50 = city.landStat ? city.landStat.p50 : 0;
      if (p50 > 0 && city.landPrice) {
        priceArr = new Float32Array(city.N);
        for (let c = 0; c < city.N; c++) priceArr[c] = 1 / (1 + k * Math.max(0, ((city.landPrice[c] || 0) / p50) - 1));
      }
    }
    city.growMonth({ year: yy, monthIndex: m, zoneAccess: null, cellWalk: null, coverage: 0, econ: null, jobAccess: null, accFar: accArr, priceK: priceArr });
  }
  // 统计
  const tot = city.totals();
  const near = districts.map(function (q) {
    let p = 0, j = 0;
    for (let c = 0; c < city.N; c++) {
      if (U.dist(q.x, q.y, (c % city.W) + 0.5, ((c / city.W) | 0) + 0.5) * CFG.CELL_M > 3000) continue;
      p += city.pop[c]; j += city.jobs[c];
    }
    return { pop: p, jobs: j };
  });
  // 沿快线 2 km 带内的人口：band 为全线，bandMid 为「除产业区 3 km 以外」的那一段（真正的通勤走廊）
  let band = 0, bandMid = 0;
  if (lineStations.length) {
    for (let c = 0; c < city.N; c++) {
      const x = (c % city.W) + 0.5, y = ((c / city.W) | 0) + 0.5;
      let d = Infinity;
      for (const st of lineStations) d = Math.min(d, U.dist(st[0], st[1], x, y) * CFG.CELL_M);
      if (d > 2000) continue;
      band += city.pop[c];
      const dd = districts.length ? U.dist(districts[0].x, districts[0].y, x, y) * CFG.CELL_M : 0;
      if (dd > 3000) bandMid += city.pop[c];
    }
  }
  const C1 = center();
  city.buildLandPrice(Y0 + YEARS, model.net && model.net.acc ? model.net.acc : null);
  const p50 = city.landStat ? city.landStat.p50 : 0;
  let pmax = 0, pStation = 0, pFar = 0, ns = 0, nf = 0;
  for (let c = 0; c < city.N; c++) {
    const v = city.landPrice ? city.landPrice[c] : 0;
    if (v > pmax) pmax = v;
    if (!lineStations.length) continue;
    const x = (c % city.W) + 0.5, y = ((c / city.W) | 0) + 0.5;
    let d = Infinity;
    for (const st of lineStations) d = Math.min(d, U.dist(st[0], st[1], x, y) * CFG.CELL_M);
    if (d <= 1000 && v > 0) { pStation += v; ns++; }
    else if (d > 6000 && v > 0) { pFar += v; nf++; }
  }
  return { label: label, T: T, price: usePrice, pop: tot.pop, jobs: tot.jobs,
    dPop: near.length ? near[0].pop : 0, dJobs: near.length ? near[0].jobs : 0,
    band: band, bandMid: bandMid, shift: U.dist(C0.x, C0.y, C1.x, C1.y) * CFG.CELL_M / 1000,
    p50: p50, pmax: pmax, pStation: ns ? pStation / ns : 0, pFar: nf ? pFar / nf : 0 };
}

const rows = [
  run('T=30 · 有价格惩罚', 30, true, 1.0),
  run('T=40 · 有价格惩罚', 40, true, 1.0),
  run('T=50 · 有价格惩罚', 50, true, 1.0),
  run('T=60 · 有价格惩罚', 60, true, 1.0),
  run('T=50 · 无价格惩罚', 50, false, 1.0),
];
console.log('');
console.log('变体              区内3km人口   区内3km岗位  沿线2km人口  沿线走廊人口  重心位移  地价中位  站旁/外围');
for (const r of rows) {
  console.log(r.label.padEnd(18) + Math.round(r.dPop).toLocaleString('en').padStart(10) + '  ' + Math.round(r.dJobs).toLocaleString('en').padStart(10) +
    '  ' + Math.round(r.band).toLocaleString('en').padStart(12) + '  ' + Math.round(r.bandMid).toLocaleString('en').padStart(10) + '  ' + r.shift.toFixed(1).padStart(6) + ' km' +
    '  ' + Math.round(r.p50).toLocaleString('en').padStart(7) + '  ' + (r.pFar > 0 ? (r.pStation / r.pFar).toFixed(2) : '—'));
}
