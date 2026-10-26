// 性能体检：在一张大图上把「加载」和「结算」拆开计时，配合 --cpu-prof 看热点。
//
//   node --cpu-prof --cpu-prof-dir=/tmp/prof tools/perf.mjs gz2 --months=2
//
// 大图（gz2）的生成物在 maps/gz2/parked/，没在 manifest 里登记也能跑：registerMap 只依赖 data 文件。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapId = process.argv[2] || 'gz2';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const months = +arg('months', 2);

// ---- 浏览器桩 ----
const NOOP = () => {};
const mk = (t) => ({ tagName: (t || 'div').toUpperCase(), width: 0, height: 0, style: { setProperty: NOOP }, getContext: () => new Proxy({}, { get: () => NOOP }), addEventListener: NOOP, appendChild: (c) => c, setAttribute: NOOP, dataset: {}, classList: { add: NOOP, remove: NOOP }, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) });
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { createElement: mk, createElementNS: (n, t) => mk(t), body: mk(), documentElement: mk(), querySelector: () => null, getElementById: () => mk(), addEventListener: NOOP };
globalThis.addEventListener = NOOP; globalThis.matchMedia = () => ({ matches: false, addEventListener: NOOP });
globalThis.localStorage = { getItem: () => null, setItem: NOOP, removeItem: NOOP };
globalThis.requestAnimationFrame = () => 0;
globalThis.Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} arc() {} };

const parked = (f) => {
  const p = path.join(root, 'maps', mapId, 'parked', path.basename(f));
  return fs.existsSync(path.join(root, f)) ? path.join(root, f) : p;
};
// 顺序与 index.html 一致：data 文件必须在 maps.js 之前（maps.js 载入时就把登记表建成 MAPS）
const FILES = ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js', 'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/data_tutorial.js',
  'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js', 'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js',
  'js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js', 'js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js'];
// 目标地图的数据文件（停放时从 maps/<id>/parked/ 读），要在 maps.js 之前注入
const GEO_FILE = parked('js/geo_' + mapId + '.js');
const DATA_FILE = parked('js/data_' + mapId + '.js');
const mark = [];
const t = (label, fn) => { const a = performance.now(); const r = fn(); mark.push([label, performance.now() - a]); return r; };

let t0 = performance.now();
const beforeMaps = FILES.slice(0, FILES.indexOf('js/maps.js'));
const afterMaps = FILES.slice(FILES.indexOf('js/maps.js'));
for (const f of beforeMaps) {
  if (f === 'js/data_tutorial.js' && mapId !== 'tutorial') {
    vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
    t('加载 geo_' + mapId + '（解析 + 注册）', () => vm.runInThisContext(fs.readFileSync(GEO_FILE, 'utf8'), { filename: GEO_FILE }));
    t('加载 data_' + mapId, () => vm.runInThisContext(fs.readFileSync(DATA_FILE, 'utf8'), { filename: DATA_FILE }));
    continue;
  }
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const tLib = performance.now() - t0;
for (const f of afterMaps) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });

const CM = globalThis.CM;
t('useMap（数据与配置切换）', () => CM.useMap(mapId));
t('Geo.init（解码全部图层）', () => CM.Geo.init());
if (!CM.MAPS[mapId]) throw new Error('地图未登记：' + mapId);
console.log('图 ' + mapId + ' · ' + CM.CFG.W + '×' + CM.CFG.H + ' · 小区 ' + (CM.CFG.W / CM.CFG.ZONE | 0) + '×' + (CM.CFG.H / CM.CFG.ZONE | 0));

const g = t('Game.create（含 city.generate + 图构建）', () => CM.Game.create({ map: mapId, preset: 'normal', name: 'perf' }));
const city = g.city, model = g.model;
mark.push(['  · 其中 city 路网分组', 0], ['  · 其中 water 栅格 + SDF', 0]);
// 细化城市生成
const city2 = t('  City.generate（单独重跑一次）', () => { const c = new CM.City(); c.generate(g.clock.y * 10000 + g.clock.m * 100 + 1, g.clock.y); return c; });

t('solveNow(1)', () => model.solveNow(1));
t('solveNow(2)', () => model.solveNow(2));
if (CM.CFG.choice && CM.CFG.choice.impedance === 'time') t('buildDemand', () => model.buildDemand());

// 整月推进（generate 分步执行的同一套逻辑，同步跑完）
for (let i = 0; i < months; i++) {
  t('推进一个月 #' + (i + 1), () => {
    const gen = g.monthGen();
    for (let r = gen.next(); !r.done; r = gen.next()) { /* run */ }
  });
}

console.log('\n耗时（ms）');
for (const [k, v] of mark) console.log('  ' + String(v.toFixed(1)).padStart(8) + '  ' + k);
console.log('  ' + tLib.toFixed(1).padStart(8) + '  常驻 lib（util…game，一次）');
console.log('\n模型规模：小区 Z=' + model.Z + ' · 人口 ' + Math.round(city.totals().pop).toLocaleString() +
  ' · OD 目的地 ' + (model.od ? model.od.dest.length : 0) + ' · 车行路段 ' + city.car.links.length +
  ' · 站点 ' + (model.net ? model.net.S : 0));
