// 「岗位缺口 → 外围产业区 → 住宅聚集」的实验（node scripts/exp-jobdistrict.mjs）
//
// 现状模型里居住增长权重完全不看岗位（growMonth 的 wR 只有「剩余容量 × 可达 × 临街 × 随机」），
// 所以就算在外围凭空长出一片产业区，住宅也不会向它聚集。这个脚本用补丁把「岗位吸引力」加进去，
// 并模拟「岗位缺口时在外围便宜土地上生成产业区」的机制，看能不能长出一个次中心。
//
// 四个对照：是否生成产业区 × 住宅是否读岗位吸引。
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
// 补丁：让居住增长读「可达岗位」、让容积率可以读通勤可达性
let citySrc = fs.readFileSync(path.join(root, 'js/city.js'), 'utf8');
const a1 = '    const ja = jaOn ? ctx.jobAccess : null;';
if (citySrc.indexOf(a1) < 0) throw new Error('补丁锚点 1 缺失');
citySrc = citySrc.replace(a1, '    const ja = ctx.jobAccess || null;');
const a2 = '    if (jaOn) {\n      let sum = 0, n = 0;';
if (citySrc.indexOf(a2) < 0) throw new Error('补丁锚点 2 缺失');
citySrc = citySrc.replace(a2, '    if (ja) {\n      let sum = 0, n = 0;');
const a3 = '      if (remR > 0) { wR[c] = remR * (0.25 + acc) * (1 + 1.6 * st) * (0.3 + nb) * rnd * seed; sR += wR[c]; }';
if (citySrc.indexOf(a3) < 0) throw new Error('补丁锚点 3 缺失');
citySrc = citySrc.replace(a3, '      if (remR > 0) {\n' +
  '        let jp = 1;\n' +
  '        if (ja && CM.JOB_PULL > 0) { const r = ja[this.zoneOf(c)] / jaMean; jp = 1 + CM.JOB_PULL * Math.min(2.5, Math.max(0, r - 0.6)); }\n' +
  '        wR[c] = remR * (0.25 + acc) * (1 + 1.6 * st) * (0.3 + nb) * rnd * seed * jp; sR += wR[c];\n' +
  '      }');
const a4 = '      const Ld = CFG.land;\n      let farK = 1;\n      if (this.landAcc && Ld && Ld.farGain > 0) {\n        const am = this.landAcc[c] || 1;';
if (citySrc.indexOf(a4) < 0) throw new Error('补丁锚点 4 缺失');
citySrc = citySrc.replace(a4,
  '      const Ld = CFG.land;\n      let farK = 1;\n      const __am = ctx.accFar ? ctx.accFar[c] : (this.landAcc ? this.landAcc[c] : 0);\n      if (__am && Ld && Ld.farGain > 0) {\n        const am = __am || 1;');
// 加载：city.js 用打过补丁的源码，并且必须在 metro.js 之前（metro.js 会捕获 CM.LU）
for (const f of FILES) {
  if (f === 'js/city.js') vm.runInThisContext(citySrc, { filename: f });
  else vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const CM = globalThis.CM, M = CM.Metro, U = CM.U, CFG = CM.CFG;
CM.useMap('gz');
const YEARS = Number(process.argv[2] || 25);

// capMin 分钟内可达的「权重场之和」：weights[j] 可以是岗位数，也可以是劳动力（人口 × 参与率）。
// 与 Model.computeJobAccess 同一套口径（小汽车与地铁取较优），只是被求和的量可换。
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
// 可用岗位：12 分钟可达岗位 − 12 分钟可达劳动力（本地求职者已占掉的部分），不小于 0。
// 市中心岗位多、劳动力也多，缺口可能只有几千；郊区新区岗位多、劳动力少，缺口能有几万。
function availJobs(model, capMin, year) {
  const Z = model.Z, wr = U.interp(CFG.choice.workerRate, year);
  const J = accessSum(model, capMin, model.zJobs);
  const W = accessSum(model, capMin, Float32Array.from(model.zPop, function (p) { return p * wr; }));
  const out = new Float32Array(Z);
  for (let z = 0; z < Z; z++) out[z] = Math.max(0, J[z] - W[z]);
  return out;
}

function run(label, useDistrict, pull, useSupply, useFar, useLine) {
  CM.GROWTH_ACCESS.from = 'walk';   // 站旁加成仍用步行距离；岗位只作为额外吸引
  CM.JOB_PULL = pull;
  const Y0 = CFG.START.y;
  const city = new CM.City(); city.generate(Y0 * 10000 + 101, Y0);
  const openByYear = function (yr) {
    for (let k = 0; k < city.regions.length; k++) { const rg = city.regions[k]; if (!city.regionOpen[k] && rg.open != null && rg.open <= yr) city.openRegion(k, yr, 0); }
  };
  openByYear(Y0);
  // 线网：先不建地铁，只看城市自身怎么长（避免地铁把结果带偏）
  let net = M.empty();
  const lineIds = [];
  // 从初始中心修一条 160 km/h 级快线到指定坐标（站距约 4 km）
  const buildLine = function (tx, ty) {
    const lid = M.newLine(net, '快线');
    const dx = tx - C0.x, dy = ty - C0.y, len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.round(len / 16));
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const x = C0.x + dx * k / n, y = C0.y + dy * k / n;
      const st = M.addStation(net, Math.round(x) + 0.5, Math.round(y) + 0.5, { size: 'M', type: 'elevated' }, city);
      if (prev) M.addSegment(net, lid, prev, st, [], 'elevated');
      prev = st;
    }
    lineIds.push(lid);
  };
  const model = new CM.Model(city);
  model.setNetwork(M.compile(net, city));
  // 初始就业中心（人口×岗位重心）
  const center = function () {
    let sx = 0, sy = 0, sw = 0;
    for (let c = 0; c < city.N; c++) { const w = city.pop[c] + city.jobs[c]; if (w <= 0) continue; sx += (c % city.W) * w; sy += ((c / city.W) | 0) * w; sw += w; }
    return { x: sx / Math.max(1, sw), y: sy / Math.max(1, sw) };
  };
  const C0 = center();
  const districts = [];
  let supplyCells = 0;
  for (let m = 0; m < YEARS * 12; m++) {
    const yy = Y0 + Math.floor(m / 12);
    if (m % 12 === 0) openByYear(yy);
    if (m % 6 === 0) { model.setNetwork(M.compile(net, city)); model.solveNow(2); }
    // 岗位缺口：岗位 ÷ 劳动力（人口 × 劳动参与率）
    if (useDistrict && (m === 96 || m === 156)) {
      {
        // 在外围 8–16 km、土地成片、还没城市化的地方找一块 3×3，改规划为工业
        let best = -1, bestD = -1;
        for (let c = 0; c < city.N; c++) {
          if (city.landFrac[c] < 0.7 || city.lu[c] !== 0 || !city.regionOpen[city.region[c]]) continue;   // LU.RURAL = 0
          const d = U.dist(C0.x, C0.y, (c % city.W) + 0.5, ((c / city.W) | 0) + 0.5) * CFG.CELL_M / 1000;
          if (d < 8 || d > 16) continue;
          if (districts.some(function (q) { return U.dist(q.x, q.y, (c % city.W) + 0.5, ((c / city.W) | 0) + 0.5) * CFG.CELL_M < 6000; })) continue;
          if (d > bestD) { bestD = d; best = c; }
        }
        if (best >= 0) {
          const bi = best % city.W, bj = (best / city.W) | 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = bi + di, jj = bj + dj;
            if (ii < 0 || jj < 0 || ii >= city.W || jj >= city.H) continue;
            const c = jj * city.W + ii;
            if (city.landFrac[c] >= 0.7 && city.lu[c] === 0) city.plan[c] = 3;   // LU.IND = 3
          }
          districts.push({ x: bi + 0.5, y: bj + 0.5, at: yy });
          if (useLine) buildLine(bi + 0.5, bj + 0.5);
          city.version++;
        }
      }
    }
    const ja = (pull > 0 || useSupply) ? availJobs(model, 12, yy) : null;   // 可用岗位（岗位 − 本地劳动力），12 分钟窗口
    // 容积率读通勤可达性：30 分钟内可达岗位 → 归一化乘子（1 … 1+accessGain），住宅与岗位容量共用同一个乘子
    let accFar = null;
    if (useFar) {
      const j30 = accessSum(model, 30, model.zJobs);
      let mx = 0;
      for (let z = 0; z < j30.length; z++) if (j30[z] > mx) mx = j30[z];
      const gain = (CFG.land && CFG.land.accessGain) || 0.7;
      accFar = new Float32Array(city.N);
      for (let c = 0; c < city.N; c++) accFar[c] = 1 + gain * (mx > 0 ? Math.sqrt(j30[city.zoneOf(c)] / mx) : 0);
    }
    // 土地供给响应：可用岗位高的地方，开发商在周边把低效用地改成居住用地（受「必须已有街道」与配额约束）
    if (useSupply && ja && m % 12 === 0) {
      let mean = 0, nz = 0;
      for (let z = 0; z < ja.length; z++) if (ja[z] > 0) { mean += ja[z]; nz++; }
      mean = nz > 0 ? mean / nz : 1;
      // 先找出「就业缺口显著」的片区（相对均值 1.2 倍以上）
      const hot = [];
      for (let z = 0; z < ja.length; z++) if (ja[z] > 1.2 * mean && model.zJobs[z] > 200) hot.push(z);
      if (hot.length) {
        const quota = 40;   // 每年最多转 40 格（约 2.5 km²），避免一夜之间全城改规划
        let done = 0;
        for (const z of hot) {
          if (done >= quota) break;
          const zc = model.zCx[z], zy = model.zCy[z];
          const ci = Math.floor(zc), cj = Math.floor(zy);
          for (let r = 1; r <= 16 && done < quota; r++) {   // 半径 16 格 ≈ 4 km
            for (let dj = -r; dj <= r && done < quota; dj++) {
              for (let di = -r; di <= r && done < quota; di++) {
                if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
                const ii = ci + di, jj = cj + dj;
                if (ii < 1 || jj < 1 || ii >= city.W - 1 || jj >= city.H - 1) continue;
                const c = jj * city.W + ii;
                if (city.lu[c] !== 0 || city.landFrac[c] < 0.6 || !city.regionOpen[city.region[c]]) continue;
                if (city.plan[c] === 3 || city.plan[c] === 2) continue;   // 已规划为工业/商业的不动
                // 必须挨着已建成区或街道，否则开发商没理由去
                let near = false;
                for (let q = -1; q <= 1 && !near; q++) for (let w = -1; w <= 1; w++) {
                  if (!q && !w) continue;
                  const cc = (jj + q) * city.W + (ii + w);
                  if (city.street[cc] || city.lu[cc] !== 0) { near = true; break; }
                }
                if (!near) continue;
                city.plan[c] = 1;   // LU.RES
                city.dirty.add(c);
                done++;
              }
            }
          }
        }
        if (done) { city.version++; supplyCells += done; }
      }
    }
    city.growMonth({ year: yy, monthIndex: m, zoneAccess: null, cellWalk: model.net && model.net.acc ? model.net.acc.cellWalk : null, coverage: 0, econ: null, jobAccess: ja, accFar: accFar });
  }
  const tot = city.totals();
  const wrF = U.interp(CFG.choice.workerRate, Y0 + YEARS);
  const near = districts.map(function (q) {
    let p = 0, j = 0;
    for (let c = 0; c < city.N; c++) {
      const d = U.dist(q.x, q.y, (c % city.W) + 0.5, ((c / city.W) | 0) + 0.5) * CFG.CELL_M;
      if (d <= 3000) { p += city.pop[c]; j += city.jobs[c]; }
    }
    return { x: q.x, y: q.y, at: q.at, pop: p, jobs: j };
  });
  const C1 = center();
  return { label: label, supply: supplyCells, pop: tot.pop, jobs: tot.jobs, ratio: tot.jobs / Math.max(1, tot.pop * wrF), districts: near, shift: U.dist(C0.x, C0.y, C1.x, C1.y) * CFG.CELL_M / 1000 };
}

const rows = [
  run('基线', false, 0, false, false),
  run('容积率读通勤可达', false, 0, false, true),
  run('播产业区 + 容积率', true, 0, false, true),
  run('产业区 + 快线 + 容积率', true, 0, false, true, true),
  run('产业区 + 容积率 + 供给', true, 0, true, true),
  run('产业区 + 容积率 + 供给 + 吸引', true, 0.8, true, true),
];
console.log('');
console.log('变体                  人口     岗位    岗位/劳动力  产业区  改居住格  区内人口  区内岗位  重心位移');
for (const r of rows) {
  const d = r.districts;
  const dp = d.reduce(function (s, q) { return s + q.pop; }, 0), dj = d.reduce(function (s, q) { return s + q.jobs; }, 0);
  console.log(r.label.padEnd(22) + (r.pop / 1e6).toFixed(2) + 'M  ' + (r.jobs / 1e6).toFixed(2) + 'M   ' + r.ratio.toFixed(2) +
    '        ' + String(d.length).padStart(2) + '    ' + String(r.supply).padStart(6) + '    ' + Math.round(dp).toLocaleString('en').padStart(9) + '  ' + Math.round(dj).toLocaleString('en').padStart(8) +
    '   ' + r.shift.toFixed(1) + ' km');
}
for (const r of rows) for (const q of r.districts) console.log('  ' + r.label + ' · 产业区 @' + q.x.toFixed(0) + ',' + q.y.toFixed(0) + '（' + q.at + ' 年）：3 km 内人口 ' + Math.round(q.pop).toLocaleString('en') + ' · 岗位 ' + Math.round(q.jobs).toLocaleString('en'));
