// 大举建设 vs 稳健建设：验证「钱不是卡点、规划才是」的设计（node scripts/exp-overbuild.mjs [years] [map]）
//
// 两种策略，同一张图、同一年开局：
//   稳健：一条 10 站线，造价由当年建设批次支付
//   大举：三条线共 36 站，一次性建完，缺口用债券补（按年度额度上限发，3 年期）
// 造价按真实单价（M 站 2.5 亿/站 + 地下 3 亿/km），从资金里扣；每年记录债务、利息、资金、客流、满意度。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {}, append() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, getContext() { return null; } });
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { createElement: el, createElementNS: el, addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {} } }, body: el(), querySelector() { return null; }, getElementById() { return null; } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const FILES = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js', 'js/geo_gz2.js', 'js/data_gz2.js','js/geo_sh.js','js/data_sh.js','js/data_tutorial.js','js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js','js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js'];
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const CM = globalThis.CM, M = CM.Metro, U = CM.U, CFG = CM.CFG;
const YEARS = Number(process.argv[2] || 25);
const MAP = process.argv[3] || 'gz';

function build(g, lines, perLine) {
  // 沿人口轴布置若干条平行/交叉线，返回线网与总造价（万元）
  const city = g.city;
  let row = 0, br = -1, col = 0, bc = -1;
  for (let j = 4; j < city.H - 4; j++) { let s = 0; for (let i = 4; i < city.W - 4; i++) s += city.pop[j * city.W + i]; if (s > br) { br = s; row = j; } }
  for (let i = 4; i < city.W - 4; i++) { let s = 0; for (let j = 4; j < city.H - 4; j++) s += city.pop[j * city.W + i]; if (s > bc) { bc = s; col = i; } }
  const net = M.empty();
  let cost = 0;
  for (let li = 0; li < lines; li++) {
    const lid = M.newLine(net, 'L' + (li + 1));
    const horiz = li % 2 === 0;
    const off = Math.round((li - (lines - 1) / 2) * 6);
    let prev = null;
    for (let k = 0; k < perLine; k++) {
      const x = horiz ? col - (perLine - 1) * 2 + k * 4 + 0.5 : col + off + 0.5;
      const y = horiz ? row + off + 0.5 : row - (perLine - 1) * 2 + k * 4 + 0.5;
      if (x < 2 || y < 2 || x > city.W - 2 || y > city.H - 2) continue;
      const sid = M.addStation(net, x, y, { size: 'M', type: 'underground' }, city);
      cost += M.stationCost('underground', 'M', g.clock.y);
      if (prev) { M.addSegment(net, lid, prev, sid, [], 'underground'); cost += 4 * CFG.CELL_M / 1000 * CFG.cost.trackPerKm.underground; }
      prev = sid;
    }
  }
  return { net: net, cost: cost };
}

// 渐进扩张：每年在第一条线两端各延长 2 站（按年付造价，缺口发债）
function runGrow(label, perYear) {
  CM.useMap(MAP);
  const g = CM.Game.create({ map: MAP, mode: 'tycoon', name: label });
  const city = g.city;
  let row = 0, br = -1, col = 0, bc = -1;
  for (let j = 4; j < city.H - 4; j++) { let s = 0; for (let i = 4; i < city.W - 4; i++) s += city.pop[j * city.W + i]; if (s > br) { br = s; row = j; } }
  for (let i = 4; i < city.W - 4; i++) { let s = 0; for (let j = 4; j < city.H - 4; j++) s += city.pop[j * city.W + i]; if (s > bc) { bc = s; col = i; } }
  const net = M.empty(), lid = M.newLine(net, 'L1');
  let lo = col, hi = col;
  const addAt = function (x) {
    const sid = M.addStation(net, x + 0.5, row + 0.5, { size: 'M', type: 'underground' }, city);
    return { sid: sid, cost: M.stationCost('underground', 'M', g.clock.y) + 4 * CFG.CELL_M / 1000 * CFG.cost.trackPerKm.underground };
  };
  let prev = null, cost0 = 0;
  for (let k = 0; k < 5; k++) {
    const x = col - 8 + k * 4;
    const a = addAt(x);
    if (prev) M.addSegment(net, lid, prev, a.sid, [], 'underground');
    prev = a.sid; cost0 += a.cost;
  }
  g.net = net; g.compiled = M.compile(net, city); g.model.setNetwork(g.compiled); g.model.solveNow(3);
  let need = cost0;
  if (g.econ.funds > 0) { const pay = Math.min(g.econ.funds, need); g.econ.spend('construction', pay); need -= pay; }
  if (need > 1) g.econ.spend('construction', need);
  const Y0 = g.clock.y, Y1 = Y0 + YEARS;
  const yearly = {};
  let guard = 0, total = cost0;
  while (g.clock.y < Y1 && guard++ < YEARS * 366 * 2) {
    if (g.econ.failed) break;
    if (g.endDay()) {
      const gen = g.monthGen();
      for (let r = gen.next(); !r.done; r = gen.next()) { /* run */ }
      g.model.solveNow(1);
      if (g.clock.m === 1) {
        yearly[g.clock.y] = { metro: g.model.daily ? g.model.daily.metro : 0, sat: g.econ.sat, funds: g.econ.funds, debt: g.econ.debtTotal() };
        // 每年两端各加 perYear 站，先付钱（不够发债，再不够就欠着）
        for (let q = 0; q < perYear && !g.econ.failed; q++) {
          lo -= 4; hi += 4;
          if (lo < 2 || hi > city.W - 2) break;
          let c2 = 0;
          const a = M.addStation(net, lo + 0.5, row + 0.5, { size: 'M', type: 'underground' }, city);
          const first = Object.keys(net.stations)[0];
          M.addSegment(net, lid, a, first, [], 'underground');
          c2 += M.stationCost('underground', 'M', g.clock.y) + 4 * CFG.CELL_M / 1000 * CFG.cost.trackPerKm.underground;
          const b2 = M.addStation(net, hi + 0.5, row + 0.5, { size: 'M', type: 'underground' }, city);
          const last = Object.keys(net.stations).filter(function (k) { return k !== a && k !== b2; }).pop();
          M.addSegment(net, lid, last, b2, [], 'underground');
          c2 += M.stationCost('underground', 'M', g.clock.y) + 4 * CFG.CELL_M / 1000 * CFG.cost.trackPerKm.underground;
          total += c2;
          let nd = c2;
          if (g.econ.funds > 0) { const pay = Math.min(g.econ.funds, nd); g.econ.spend('construction', pay); nd -= pay; }
          for (const k of ['local', 'ct']) {
            if (nd <= 1) break;
            const room = g.econ.bondRoom(k, g.clock.y);
            if (!(room > 1)) continue;
            const amt = Math.min(nd, room);
            const rr = g.econ.issueBond(k, 6, amt, { y: g.clock.y, m: g.clock.m, d: 1 });
            if (rr && rr.ok) { g.econ.income('bond', amt); nd -= amt; }
          }
          if (nd > 1) g.econ.spend('construction', nd);
          g.compiled = M.compile(net, city); g.model.setNetwork(g.compiled); g.model.solveNow(1);
        }
      }
    }
  }
  return { label: label, cost: total, bond: 0, yearly: yearly, Y0: Y0, failed: g.econ.failed ? (g.clock.y + '-' + g.clock.m) : null, failedReasons: g.econ.failed && g.econ.failed.reasons, stations: Object.keys(g.net.stations).length };
}

function run(label, lines, perLine) {
  CM.useMap(MAP);
  const g = CM.Game.create({ map: MAP, mode: 'tycoon', name: label });
  const b = build(g, lines, perLine);
  g.net = b.net; g.compiled = M.compile(g.net, g.city);
  g.model.setNetwork(g.compiled); g.model.solveNow(3);
  // 付款：先扣资金，不够就发债（按当年额度上限，3 年期）
  let need = b.cost;
  if (g.econ.funds > 0) { const pay = Math.min(g.econ.funds, need); g.econ.spend('construction', pay); need -= pay; }
  let bond = 0;
  for (let round = 0; round < 20 && need > 1; round++) {
    const y = g.clock.y;
    // 两种债券：地方债（额度大、利率低）与城投债（额度小、利率高）；优先用地方债
    const kinds = ['local', 'ct'].filter(function (k) { return g.econ.bondRoom(k, y) > 1; });
    if (!kinds.length) break;
    const kind = kinds[0];
    const amt = Math.min(need, g.econ.bondRoom(kind, y));
    if (!(amt > 1)) break;
    const r = g.econ.issueBond(kind, 6, amt, { y: y, m: g.clock.m, d: 1 });
    if (!r || !r.ok) break;
    g.econ.income('bond', amt);
    bond += amt; need -= amt;
  }
  // 发债补不上的部分照记支出：资金转负 → 触发「资金低于负债下限」的失败判定
  if (need > 1) g.econ.spend('construction', need);
  const Y0 = g.clock.y, Y1 = Y0 + YEARS;
  const yearly = {};
  let guard = 0, failed = null;
  while (g.clock.y < Y1 && guard++ < YEARS * 366 * 2) {
    if (g.econ.failed) { failed = g.clock.y + '-' + g.clock.m; break; }
    if (g.endDay()) {
      const gen = g.monthGen();
      for (let r = gen.next(); !r.done; r = gen.next()) { /* run */ }
      g.model.solveNow(1);
      if (g.clock.m === 1) yearly[g.clock.y] = { metro: g.model.daily ? g.model.daily.metro : 0, sat: g.econ.sat, funds: g.econ.funds, debt: g.econ.debtTotal() };
    }
  }
  if (g.econ.failed) failed = g.clock.y + '-' + g.clock.m;
  return { label: label, cost: b.cost, bond: bond, yearly: yearly, Y0: Y0, failed: failed, failedReasons: g.econ.failed && g.econ.failed.reasons, stations: Object.keys(g.net.stations).length };
}

const only = process.argv[4] || 'both';
const rows = [];
if (only !== 'big') rows.push(run('稳健（1 条 10 站）', 1, 10));
if (only !== 'small') rows.push(run('大举（3 条 36 站）', 3, 12));
if (only === 'grow') rows.length = 0, rows.push(runGrow('渐进（5 站起，每年加 2 站）', 1));
for (const r of rows) {
  console.log('');
  console.log('== ' + r.label + ' · ' + MAP + ' · 造价 ' + Math.round(r.cost).toLocaleString('en') + ' 万 · 发债 ' + Math.round(r.bond).toLocaleString('en') + ' 万 · ' + r.stations + ' 站');
  console.log('年份   资金      债务      地铁/日   满意度');
  const ys = Object.keys(r.yearly).map(Number).sort((a, b) => a - b);
  for (const y of ys) {
    if ((y - r.Y0) % 5 !== 0 && y !== ys[ys.length - 1]) continue;
    const o = r.yearly[y];
    console.log(String(y).padEnd(6) + Math.round(o.funds).toLocaleString('en').padStart(9) + Math.round(o.debt).toLocaleString('en').padStart(9) +
      Math.round(o.metro).toLocaleString('en').padStart(10) + o.sat.toFixed(0).padStart(8));
  }
  console.log(r.failed ? ('【失败】' + r.failed + '：' + (r.failedReasons || []).join('；')) : '【未失败】');
}
