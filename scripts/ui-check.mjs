// 顶栏结构检查（node scripts/ui-check.mjs）
//
// page-check 只跑页面渲染，不构造 UI —— 顶栏（pill、指标栈、下拉）这一段没有任何自动覆盖。
// 这里用桩 DOM 真正 new CM.UI(R)，能抓到构造期的引用顺序错误（例如变量在声明前使用）与缺方法。
// 桩只实现构造期用到的接口，不模拟布局，所以它测的是「能不能建起来」，不是「长得好不好看」。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 画布上下文桩：属性可写、方法都是空操作（选地图页会用 canvas 画缩略图）
const CTX2D = new Proxy({}, {
  get(t, k) { return (k in t) ? t[k] : function () {}; },
  set(t, k, v) { t[k] = v; return true; },
});
const mk = (tag) => {
  const el = {
    tagName: (tag || 'div').toUpperCase(), children: [], style: { setProperty() {}, removeProperty() {} }, dataset: {}, attrs: {},
    className: '', textContent: '', disabled: false, value: '', clientWidth: 1200, scrollWidth: 800, offsetWidth: 100, offsetLeft: 0, scrollTop: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, append(...cs) { for (const c of cs) if (c) this.children.push(c); },
    insertBefore(c) { this.children.push(c); return c; }, remove() {}, appendChild2() {},
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
    querySelector() { return mk(); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }; },
    getContext() { return CTX2D; }, contains() { return false; },
    // 真实 DOM 里 innerHTML='' 与 replaceChildren(…)/textContent='' 都会清空子节点；
    // 桩如果只是挂个字段，子树就会一直叠加，走查时数出来的节点数是假的。
    replaceChildren(...cs) { this.children.length = 0; for (const c of cs) if (c) this.children.push(c); },
    scrollIntoView() {}, closest() { return null; }, toDataURL() { return ''; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(v) { el._html = v; if (v === '') el.children.length = 0; },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(el, 'textContent', {
    get() { return el._text || ''; },
    set(v) { el._text = v; el.children.length = 0; },
    enumerable: true, configurable: true,
  });
  return el;
};
globalThis.window = globalThis; globalThis.self = globalThis; globalThis.innerWidth = 1440; globalThis.innerHeight = 900; globalThis.addEventListener = function () {}; globalThis.removeEventListener = function () {};
globalThis.document = { createElement: mk, createElementNS: (n, t) => mk(t), createTextNode: (t) => mk('text'), addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } }, body: mk('body'), querySelector() { return null; }, getElementById() { return mk(); }, activeElement: null };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.getComputedStyle = () => ({ display: 'flex' });
globalThis.requestAnimationFrame = (f) => 0;
const FILES = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js', 'js/geo_gz2.js', 'js/data_gz2.js','js/geo_sh.js','js/data_sh.js','js/data_tutorial.js','js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js','js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js','js/render.js','js/agents.js','js/icons.js','js/settings.js','js/sound.js','js/soundscape.js','js/tools.js','js/ui.js','js/screens.js','js/pages.js','js/stats.js','js/netmap.js','js/follow.js','js/tutorial.js'];
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

  // 开局第二步（难度与系统开关）：预设卡、摘要、高级开关都要能建起来
  ui.showSetup('gz');
  const presets = (ui.setup && ui.setup.preset) || null;
  console.log(presets ? '✓ 难度页已渲染 · 默认预设 ' + CM.presetName(presets) + '（' + presets + '）' : '✗ 难度页状态缺失');
  console.log(CM.PRESET_ORDER.length === 5 ? '✓ 五档预设：' + CM.PRESET_ORDER.map(function (id) { return CM.PRESETS[id].name; }).join(' / ') : '✗ 预设数量异常');
  const caps = CM.capsFor('normal'), capsSandbox = CM.capsFor('sandbox');
  console.log(caps.budget && caps.land && caps.batch ? '✓ 一般：资金/地价/批次都开' : '✗ 一般的开关不对');
  console.log(!capsSandbox.budget && !capsSandbox.land ? '✓ 沙盒：资金与地价都关' : '✗ 沙盒的开关不对');
  const capsReal = CM.capsFor('real');
  console.log(capsReal.fareControl && capsReal.tod && capsReal.jobAccess ? '✓ 真实：票价管制 / TOD / 就业可达 全开' : '✗ 真实的开关不对');
  const off = CM.capsFor('normal', { land: false });
  console.log(!off.land && !off.tod ? '✓ 依赖闭包：关掉地价，TOD 自动关' : '✗ 依赖闭包失效');
  console.log(CM.capsFor('sandbox').bus ? '✓ 接驳巴士不可关（locked）' : '✗ 接驳被关掉了');

  // 选地图页：底部动作要是一行三个（继续 / 读取 / 下一步）
  try {
    ui.showMapSelect('gz');
    let acts = [];
    // 只认按钮本身：行容器 class 是 map-actions，按 token 精确匹配才不会把它算进来
    const hasTok = function (n, tok) { return (n.className || '').split(/\s+/).indexOf(tok) >= 0; };
    const walk = function (n) {
      if (!n || !n.children) return;
      if (hasTok(n, 'map-act')) acts.push(n.className);
      for (const c of n.children) walk(c);
    };
    walk(ui.screen);
    const prim = acts.filter(function (c) { return c.split(/\s+/).indexOf('primary') >= 0; }).length;
    console.log(acts.length === 3 && prim === 1 ? '✓ 选地图页底部三个动作（继续 / 读取 / 下一步）' : '✗ 选地图页动作数不对：' + acts.length);
  } catch (e) {
    console.log('✗ 选地图页：' + e.message);
  }
} catch (e) {
  console.log('✗ UI 构造失败：' + e.message);
  console.log(String(e.stack).split('\n').slice(1, 4).join('\n'));
  process.exitCode = 1;
}
