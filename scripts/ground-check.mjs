// 底图绘制冒烟：对每张地图真正跑一遍 Renderer.drawGround（node scripts/ground-check.mjs）
//
// 为什么需要它：广州大图第一次出现「一格一格的马赛克、路网完全不见」，
// 根因是 drawGround 里 `lay = {2:[],3:[],4:[]}` 没有等级 1 这一档，
// 而真实 OSM 数据里支路（residential/unclassified）数量最多 —— `lay[cls].push` 直接抛错，
// 整帧底图（含其后绘制的水面、铁路、道路）全部中止，只剩上一帧的 overview 纹理。
// 这类错误只有「真的画一次」才能发现：数据校验器看得懂等级范围，但不知道渲染器只认 2–4。
//
// 桩只记录调用，不做像素运算，所以它测的是「会不会抛错 / 有没有漏层」，不是画得好不好看。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- 极简 canvas 桩 ----
const NOOP = () => {};
function makeCtx() {
  const stats = { fill: 0, stroke: 0, rect: 0, paths: 0 };
  const ctx = {
    stats,
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '', globalAlpha: 1, imageSmoothingEnabled: true,
    fill() { stats.fill++; }, stroke() { stats.stroke++; }, clip: NOOP,
    fillRect: NOOP, strokeRect: NOOP, clearRect: NOOP, drawImage: NOOP,
    beginPath: NOOP, closePath: NOOP, moveTo: NOOP, lineTo: NOOP, arc: NOOP, rect() { stats.rect++; },
    save: NOOP, restore: NOOP, translate: NOOP, scale: NOOP, rotate: NOOP,
    setTransform: NOOP, resetTransform: NOOP, setLineDash: NOOP,
    createLinearGradient: () => ({ addColorStop: NOOP }), createRadialGradient: () => ({ addColorStop: NOOP }),
    createPattern: () => null, measureText: () => ({ width: 0 }), fillText: NOOP, strokeText: NOOP,
  };
  return ctx;
}
class Path2DStub {
  constructor() { this.ops = 0; }
  addPath() { this.ops++; } rect() { this.ops++; } moveTo() { this.ops++; } lineTo() { this.ops++; }
  arc() { this.ops++; } closePath() { this.ops++; } bezierCurveTo() { this.ops++; }
  quadraticCurveTo() { this.ops++; } ellipse() { this.ops++; }
}
const mk = (tag) => ({
  tagName: (tag || 'div').toUpperCase(), width: 0, height: 0, style: { setProperty: NOOP },
  getContext: () => makeCtx(), addEventListener: NOOP, removeEventListener: NOOP,
  appendChild: (c) => c, setAttribute: NOOP, getAttribute: () => null, classList: { add: NOOP, remove: NOOP, toggle: NOOP },
});
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.Path2D = Path2DStub;
globalThis.document = { createElement: mk, createElementNS: (n, t) => mk(t), createTextNode: () => mk('text'), body: mk('body'), querySelector: () => null, getElementById: () => mk(), addEventListener: NOOP, documentElement: { style: { setProperty: NOOP }, dataset: {}, classList: { add: NOOP, remove: NOOP } } };
globalThis.addEventListener = NOOP; globalThis.removeEventListener = NOOP;
globalThis.matchMedia = () => ({ matches: false, addEventListener: NOOP });
globalThis.localStorage = { getItem: () => null, setItem: NOOP, removeItem: NOOP };
globalThis.getComputedStyle = () => ({ display: 'flex' });
globalThis.requestAnimationFrame = () => 0;
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const FILES = ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js',
  'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/data_tutorial.js',
  'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js',
  'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js',
  'js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js', 'js/economy.js',
  'js/macro.js', 'js/game.js', 'js/milestones.js', 'js/icons.js', 'js/render.js'];
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });

const CM = globalThis.CM;
if (!CM.Renderer) { console.log('✗ 没有 CM.Renderer，检查 render.js 的导出'); process.exit(1); }

let bad = 0;
for (const entry of CM.MAP_MANIFEST) {
  const id = entry.id;
  try {
    CM.useMap(id);
    const g = CM.Game.create({ map: id, preset: 'normal', name: 'ground-check' });
    const R = Object.create(CM.Renderer.prototype);
    R.game = g; R.geoPaths = new Map(); R.ground = new Map(); R.iso = new Map(); R.frame = 1; R.theme = 'light';
    R.setTheme('light');
    // 分两条带画：一条贴地（lvl=4，走 overview 那种低倍率），一条近景（lvl=16）
    const bands = [[4, 0, 0, 32], [16, 40, 40, 24]];
    let ops = 0;
    for (const [lvl, x0, y0, span] of bands) {
      const ctx = makeCtx();
      R.drawGround(ctx, x0, y0, Math.min(CM.CFG.W, x0 + span * 4), Math.min(CM.CFG.H, y0 + span), lvl);
      ops += ctx.stats.fill + ctx.stats.stroke + ctx.stats.rect;
    }
    // 等级分布（渲染按等级分桶，出现表外等级就会炸掉整帧）
    const cls = {};
    for (const gr of g.city.roadGroups) cls[gr.cls] = (cls[gr.cls] || 0) + 1;
    const badCls = Object.keys(cls).filter((k) => +k < 1 || +k > 4);
    if (badCls.length) throw new Error('道路等级超出 1–4：' + badCls.join(','));
    console.log('✓ ' + id.padEnd(9) + ' 底图绘制 ' + String(ops).padStart(6) + ' 次绘制 · 路段 ' + g.city.roadWays.length +
      ' · 等级 ' + Object.keys(cls).sort().join('/'));
  } catch (e) {
    bad++;
    console.log('✗ ' + id.padEnd(9) + ' ' + e.message);
    console.log(String(e.stack).split('\n').slice(1, 4).join('\n'));
  }
}
console.log(bad ? '✗ ' + bad + ' 张地图底图画不出来' : '全部地图底图可绘制');
process.exitCode = bad ? 1 : 0;
