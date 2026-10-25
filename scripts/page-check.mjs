// 面板渲染回归检查（node scripts/page-check.mjs）
//
// 无头环境里调用 UI.page_* 的渲染函数，确认没有运行期异常——smoke 只跑模型，不碰界面，
// 所以这一类错误（未定义变量、回调里的 this 丢失、空数据分支）只能靠它兜住。
// 目前覆盖：车站面板的 已运营 / 上盖+接驳线 / 草案态 / 未接线 四种状态。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function mk(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), children: [], style: {}, dataset: {}, attrs: {},
    className: '', textContent: '', innerHTML: '', inert: false, disabled: false, value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, append(c) { this.children.push(c); },
    append(...cs) { for (const c of cs) if (c) this.children.push(c); },
    insertBefore(c) { this.children.push(c); return c; }, removeChild() {}, remove() {},
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; },
    getContext() { return null; }, scrollHeight: 100, offsetHeight: 100, offsetWidth: 400, firstChild: null,
  };
  return el;
}
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = {
  createElement: mk, createElementNS: (ns, tag) => mk(tag),
  addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {} } },
  body: mk('body'), querySelector() { return null; }, getElementById() { return mk(); },
  createTextNode: () => mk('text'), activeElement: null,
};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 0;
const FILES = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js','js/data_tutorial.js','js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js','js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js','js/icons.js','js/render.js','js/ui.js','js/pages.js'];
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const CM = globalThis.CM, M = CM.Metro, U = CM.U;
CM.useMap('gz');
const g = CM.Game.create({ map: 'gz', mode: 'tycoon', name: 'pg' });
CM.game = g;
const city = g.city;
let row = 0, br = -1;
for (let j = 6; j < city.H - 6; j++) { let s = 0; for (let i = 6; i < city.W - 6; i++) s += city.pop[j * city.W + i]; if (s > br) { br = s; row = j; } }
const net = M.empty(), lid = M.newLine(net, '测试线');
let prev = null, ids = [];
for (let k = 0; k < 6; k++) { const sid = M.addStation(net, 40 + k * 4 + 0.5, row + 0.5, { size: 'M', type: 'underground' }, city); if (prev) M.addSegment(net, lid, prev, sid, [], 'underground'); prev = sid; ids.push(sid); }
g.net = net; g.compiled = M.compile(net, city); g.model.setNetwork(g.compiled); g.model.solveNow(2);
const ui = Object.create(CM.UI.prototype);
ui.open = {}; ui.live = []; ui.multi = null;
const t0 = Date.now();
let ok = 0;
for (const sid of ids) {
  try {
    const p = ui.page_station(sid);
    if (!p || !p.el) throw new Error('返回空');
    ok++;
  } catch (e) {
    console.log('✗ 站点 ' + sid + '：' + e.message);
    console.log(String(e.stack).split('\n').slice(1, 4).join('\n'));
    break;
  }
}
console.log('渲染 ' + ok + '/' + ids.length + ' 个车站面板 · 用时 ' + (Date.now() - t0) + ' ms');
// 上盖 + 接驳站 + 接驳线 的分支
try {
  const st = g.net.stations[ids[1]];
  st.dev = 2; g.applyDevJobs();
  st.busHub = 1;
  st.bus = [{ id: 'b1', x: st.x + 6, y: st.y + 4, lenM: 1800, cars: 3, name: '华南理工大学' }, { id: 'b2', x: st.x - 5, y: st.y + 6, lenM: 2400, cars: 2, name: '华师一带' }];
  g.model.solveNow(1);
  ui.page_station(ids[1]);
  console.log('✓ 上盖 + 接驳线分支正常');
  // 草案态
  g.edit(function (n) { n.stations[ids[2]].name = '改名测试'; });
  ui.page_station(ids[2]);
  g.cancelDraft();
  console.log('✓ 草案态分支正常');
} catch (e) { console.log('✗ 扩展分支：' + e.message + '\n' + String(e.stack).split('\n').slice(1, 3).join('\n')); }
// 也测一下未接入线路的站（潜在覆盖分支）
try {
  const sid2 = M.addStation(net, 40.5, row + 20.5, { size: 'S', type: 'underground' }, city);
  g.net = net; g.compiled = M.compile(net, city); g.model.setNetwork(g.compiled); g.model.solveNow(1);
  ui.page_station(sid2);
  console.log('✓ 未接线车站分支正常');
} catch (e) { console.log('✗ 未接线分支：' + e.message + '\n' + String(e.stack).split('\n')[1]); }
