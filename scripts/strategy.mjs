// 「像玩家一样经营」的模拟（node scripts/strategy.mjs [years] [map] [--calm]）
//
// 与 balance.mjs 的区别：这里会**扩张**——每年按财力延伸线路、每 4 年做上盖开发，
// 造价按真实单价从资金里扣，钱不够就发债。用来回答「扩张会不会把一局玩死」。
// 直接操作线网（不经过草案的冲突校验），所以它衡量的是**财务与运营**，不是规划可行性。
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
const CALM = process.argv.includes('--calm');
CM.useMap(MAP);

const g = CM.Game.create({ map: MAP, mode: 'tycoon', name: 'strat' });
const city = g.city;
let row = 0, br = -1, col = 0, bc = -1;
for (let j = 6; j < city.H - 6; j++) { let s = 0; for (let i = 6; i < city.W - 6; i++) s += city.pop[j * city.W + i]; if (s > br) { br = s; row = j; } }
for (let i = 6; i < city.W - 6; i++) { let s = 0; for (let j = 6; j < city.H - 6; j++) s += city.pop[j * city.W + i]; if (s > bc) { bc = s; col = i; } }

const net = g.net, lid = M.newLine(net, 'L1');
let ends = { lo: col - 14, hi: col + 14 };
const okCell = function (x, y) {
  if (x < 3 || y < 3 || x > city.W - 3 || y > city.H - 3) return false;
  const c = city.cellAt(x, y);
  return c >= 0 && city.landFrac[c] >= 0.55;
};
const stationCost = function () { return M.stationCost('underground', 'M', g.clock.y); };
const segCost = function (km) { return km * CFG.cost.trackPerKm.underground; };
let spend = 0, built = 0;
const addStation = function (x, y, prev) {
  if (!okCell(x, y)) return null;
  const sid = M.addStation(net, x + 0.5, y + 0.5, { size: 'M', type: 'underground' }, city);
  let c = stationCost();
  if (prev) { M.addSegment(net, lid, prev, sid, [], 'underground'); c += segCost(4 * CFG.CELL_M / 1000); }
  spend += c; built++;
  return sid;
};

// 开局：8 站
let prev = null;
for (let k = 0; k < 8; k++) { const sid = addStation(col - 14 + k * 4, row, prev); prev = sid; }
g.econ.spend('construction', Math.min(g.econ.funds, spend));
g.compiled = M.compile(net, city); g.model.setNetwork(g.compiled); g.model.solveNow(3);

const yearly = {};
const Y0 = g.clock.y, Y1 = Y0 + YEARS;
let guard = 0, lastOps = 0;
while (g.clock.y < Y1 && guard++ < YEARS * 366 * 2) {
  if (g.econ.failed) break;
  if (g.endDay()) {
    const gen = g.monthGen();
    for (let r = gen.next(); !r.done; r = gen.next()) { /* run */ }
    g.model.solveNow(1);
    // 记录运维开支（用于预留）
    const L = g.econ.ledger;
    if (L && L.length) { const last = L[L.length - 1]; if (last && last.closed && last.days >= 28) lastOps = last.ops || lastOps; }
    if (g.clock.m === 1) {
      yearly[g.clock.y] = { funds: g.econ.funds, debt: g.econ.debtTotal(), metro: g.model.daily.metro, sat: g.econ.sat, stations: Object.keys(net.stations).length };
      // 玩家动作：延伸（两端各 1 站）+ 每 4 年做上盖
      if (!CALM) {
        const reserve = lastOps * 12;
        for (const side of ['lo', 'hi']) {
          const x = side === 'lo' ? ends.lo - 4 : ends.hi + 4;
          const cost = stationCost() + segCost(4 * CFG.CELL_M / 1000);
          if (g.econ.funds - reserve < cost) continue;
          const tail = side === 'lo' ? Object.keys(net.stations)[0] : prev;
          const sid = addStation(x, row, tail);
          if (sid) { ends[side] = x; g.econ.spend('construction', cost); prev = sid; }
        }
        if ((g.clock.y - Y0) % 4 === 0 && g.econ.funds - reserve > 20000) {
          const P = CFG.property, list = Object.values(net.stations).sort(function (a, b) { return (city.pop[city.cellAt(b.x, b.y)] || 0) - (city.pop[city.cellAt(a.x, a.y)] || 0); });
          for (const s of list.slice(0, 4)) {
            const lv = Math.min(3, ((s.dev | 0) + 1));
            const cost2 = (P.areaBySize[s.size] || 0) * (P.levels[lv] || 0) * ((P.levelCost && P.levelCost[lv]) || P.buildCost) / 1e4;
            if (g.econ.funds - reserve < cost2) continue;
            s.dev = lv; s.devAt = [g.clock.y, g.clock.m];
            g.econ.spend('construction', cost2);
            g.applyDevJobs();
          }
        }
        g.compiled = M.compile(net, city); g.model.setNetwork(g.compiled); g.model.solveNow(1);
      }
    }
  }
}
const last = g.econ.ledger || [];
const by = {};
for (const r of last) { if (!r.closed) continue; const o = by[r.y] || (by[r.y] = { fare: 0, ops: 0, prop: 0, reward: 0, subsidy: 0 }); o.fare += r.fare || 0; o.ops += r.ops || 0; o.prop += (r.property || 0) - (r.propMaint || 0); o.reward += r.reward || 0; o.subsidy += r.subsidy || 0; }
console.log('');
console.log('== ' + MAP + ' · ' + (CALM ? '不扩张' : '像玩家一样扩张') + ' · 起点 ' + Y0 + ' · 造价累计 ' + U.fmtMoney(spend));
console.log('年份   站点  资金      债务      地铁/日   满意度   票款/运营');
for (const y of Object.keys(yearly).map(Number).sort((a, b) => a - b)) {
  const o = yearly[y];
  if ((y - Y0) % 5 !== 0 && y !== Y1 - 1) continue;
  const b = by[y] || { fare: 0, ops: 0 };
  console.log(String(y).padEnd(6) + String(o.stations).padStart(3) + Math.round(o.funds).toLocaleString('en').padStart(9) +
    (o.debt > 0 ? Math.round(o.debt).toLocaleString('en').padStart(9) : '        —') +
    Math.round(o.metro).toLocaleString('en').padStart(10) + o.sat.toFixed(0).padStart(7) +
    (b.ops > 0 ? (b.fare / b.ops * 100).toFixed(0) + '%' : '—').padStart(10));
}
console.log(g.econ.failed ? ('【失败】' + g.clock.y + '-' + g.clock.m + '：' + g.econ.failed.reasons.join('；')) : '【存活到 ' + g.clock.y + ' 年】');
