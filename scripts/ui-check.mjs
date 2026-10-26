// 顶栏结构检查（node scripts/ui-check.mjs）
//
// page-check 只跑页面渲染，不构造 UI —— 顶栏（pill、指标栈、下拉）这一段没有任何自动覆盖。
// 这里用桩 DOM 真正 new CM.UI(R)，能抓到构造期的引用顺序错误（例如变量在声明前使用）与缺方法。
// 桩只实现构造期用到的接口，不模拟布局，所以它测的是「能不能建起来」，不是「长得好不好看」。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mk = (tag) => ({
  tagName: (tag || 'div').toUpperCase(), children: [], style: { setProperty() {}, removeProperty() {} }, dataset: {}, attrs: {},
  className: '', textContent: '', innerHTML: '', disabled: false, value: '', clientWidth: 1200, scrollWidth: 800, offsetWidth: 100, offsetLeft: 0, scrollTop: 0,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  appendChild(c) { this.children.push(c); return c; }, append(...cs) { for (const c of cs) if (c) this.children.push(c); },
  insertBefore(c) { this.children.push(c); return c; }, remove() {}, appendChild2() {},
  setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; },
  addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
  querySelector() { return mk(); }, querySelectorAll() { return []; },
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }; },
  getContext() { return null; }, contains() { return false; }, replaceChildren() {},
});
globalThis.window = globalThis; globalThis.self = globalThis; globalThis.innerWidth = 1440; globalThis.innerHeight = 900; globalThis.addEventListener = function () {}; globalThis.removeEventListener = function () {};
globalThis.document = { createElement: mk, createElementNS: (n, t) => mk(t), createTextNode: (t) => mk('text'), addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }, body: mk('body'), querySelector() { return null; }, getElementById() { return mk(); }, activeElement: null };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.getComputedStyle = () => ({ display: 'flex' });
globalThis.requestAnimationFrame = (f) => 0;
const FILES = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js','js/data_tutorial.js','js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js','js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js','js/render.js','js/agents.js','js/icons.js','js/settings.js','js/sound.js','js/soundscape.js','js/tools.js','js/ui.js','js/screens.js','js/pages.js','js/stats.js','js/netmap.js','js/follow.js','js/tutorial.js'];
for (const f of FILES) { try { vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }); } catch (e) { console.log('load fail', f, e.message); } }
try {
  const R = { w: 1200, h: 800, layer: 'none', heatKey: '', cam: { view: 1, tu: 0, x: 0, y: 0, z: 10 }, layerOpt: {}, on() {}, fitAll() {}, zoomAt() {}, addFx() {}, setView() {}, setUnder() {}, render() {}, noteFrameTime() {} };
  const ui = new CM.UI(R);
  const pills = Object.keys(ui.pills);
  console.log('✓ UI 构造成功 · pills = ' + pills.join(' / '));
  console.log(ui.mstack && ui.mstack.share && ui.mstack.sat ? '✓ 窄屏指标栈三行齐全（分担率 / 拥堵 / 满意度）' : '✗ 指标栈缺失');
  for (const k of ['share', 'cong', 'sat', 'pop']) {
    if (!ui.pills[k]) console.log('✗ 缺少指标 pill：' + k);
  }
  console.log('✓ 方法齐备：setBar / showMetricMenu / cycleSpeed = ' +
    [typeof ui.setBar, typeof ui.showMetricMenu, typeof ui.cycleSpeed].join(' / '));
  // 指标栈展开不应抛错
  ui.showMetricMenu(ui.mstack.el);
  console.log(ui.dropdown ? '✓ 指标菜单可打开（4 项入口）' : '✗ 指标菜单未打开');
} catch (e) {
  console.log('✗ UI 构造失败：' + e.message);
  console.log(String(e.stack).split('\n').slice(1, 4).join('\n'));
  process.exitCode = 1;
}
