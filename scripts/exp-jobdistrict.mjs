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
for (const f of FILES) if (f !== 'js/city.js') vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });

// 补丁：让居住增长读「可达岗位」，权重 = 1 + JOB_PULL × (相对全市均值超出 0.6 的部分，封顶 2.5)
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
vm.runInThisContext(citySrc, { filename: 'js/city.js' });
const CM = globalThis.CM, M = CM.Metro, U = CM.U, CFG = CM.CFG;
CM.useMap('gz');
const YEARS = Number(process.argv[2] || 25);

function run(label, useDistrict, pull) {
  CM.GROWTH_ACCESS.from = 'walk';   // 站旁加成仍用步行距离；岗位只作为额外吸引
  CM.JOB_PULL = pull;
  const Y0 = CFG.START.y;
  const city = new CM.City(); city.generate(Y0 * 10000 + 101, Y0);
  const openByYear = function (yr) {
    for (let k = 0; k < city.regions.length; k++) { const rg = city.regions[k]; if (!city.regionOpen[k] && rg.open != null && rg.open <= yr) city.openRegion(k, yr, 0); }
  };
  openByYear(Y0);
  // 线网：先不建地铁，只看城市自身怎么长（避免地铁把结果带偏）
  const net = M.empty();
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
          city.version++;
        }
      }
    }
    const ja = pull > 0 ? model.computeJobAccess(15, 'both') : null;   // 15 分钟：衡量「家门口的工作机会」
    city.growMonth({ year: yy, monthIndex: m, zoneAccess: null, cellWalk: model.net && model.net.acc ? model.net.acc.cellWalk : null, coverage: 0, econ: null, jobAccess: ja });
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
  return { label: label, pop: tot.pop, jobs: tot.jobs, ratio: tot.jobs / Math.max(1, tot.pop * wrF), districts: near, shift: U.dist(C0.x, C0.y, C1.x, C1.y) * CFG.CELL_M / 1000 };
}

const rows = [run('基线', false, 0), run('只生成产业区', true, 0), run('只加岗位吸引', false, 0.8), run('产业区 + 岗位吸引', true, 0.8)];
console.log('');
console.log('变体                 人口     岗位    岗位/劳动力  产业区  区内人口  区内岗位  人口重心位移');
for (const r of rows) {
  const d = r.districts;
  const dp = d.reduce(function (s, q) { return s + q.pop; }, 0), dj = d.reduce(function (s, q) { return s + q.jobs; }, 0);
  console.log(r.label.padEnd(20) + (r.pop / 1e6).toFixed(2) + 'M  ' + (r.jobs / 1e6).toFixed(2) + 'M   ' + r.ratio.toFixed(2) +
    '        ' + String(d.length).padStart(2) + '    ' + Math.round(dp).toLocaleString('en').padStart(9) + '  ' + Math.round(dj).toLocaleString('en').padStart(8) +
    '   ' + r.shift.toFixed(1) + ' km');
}
for (const r of rows) for (const q of r.districts) console.log('  ' + r.label + ' · 产业区 @' + q.x.toFixed(0) + ',' + q.y.toFixed(0) + '（' + q.at + ' 年）：3 km 内人口 ' + Math.round(q.pop).toLocaleString('en') + ' · 岗位 ' + Math.round(q.jobs).toLocaleString('en'));
