// 平衡曲线（node scripts/balance.mjs [years] [map,map...]）
//
// 在经营模式下给每张真实地图一条「合理的起步线」（沿人口轴的 10 站地下线），然后按日推进，
// 逐年记录：客流、票款、运营成本、物业净额、补贴、净现金流、年末资金、满意度。
// 线路是直接放进线网的（不计建设费），所以这张表看的是**运营账能不能自己站住**（断奶），
// 而不是建设资金够不够。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {}, append() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, getContext() { return null; } });
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { createElement: el, createElementNS: el, addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {}, classList: { add() {} } }, body: el(), querySelector() { return null; }, getElementById() { return null; } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const FILES = ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js','js/data_tutorial.js','js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js','js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js','js/save.js'];
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const CM = globalThis.CM, M = CM.Metro, U = CM.U;
const YEARS = Number(process.argv[2] || 30);
const MAPS = (process.argv[3] || 'gz,hz,hk,tk,tp').split(',');

function run(id) {
  CM.useMap(id);
  const g = CM.Game.create({ map: id, mode: 'tycoon', name: 'bal' });
  const city = g.city;
  // 起步线：人口最多的行，10 站、1 km 间距、地下、M 级
  let row = 0, br = -1;
  for (let j = 4; j < city.H - 4; j++) { let s = 0; for (let i = 4; i < city.W - 4; i++) s += city.pop[j * city.W + i]; if (s > br) { br = s; row = j; } }
  let col = 0, bc = -1;
  for (let i = 4; i < city.W - 4; i++) { let s = 0; for (let j = 4; j < city.H - 4; j++) s += city.pop[j * city.W + i]; if (s > bc) { bc = s; col = i; } }
  const net = M.empty(), lid = M.newLine(net, '起步线');
  let prev = null, n = 0;
  for (let k = 0; k < 10; k++) {
    const x = col - 18 + k * 4 + 0.5, y = row + 0.5;
    if (x < 2 || x > city.W - 2) continue;
    const sid = M.addStation(net, x, y, { size: 'M', type: 'underground' }, city);
    if (prev) { M.addSegment(net, lid, prev, sid, [], 'underground'); n++; }
    prev = sid;
  }
  g.net = net; g.compiled = M.compile(net, city);
  g.model.setNetwork(g.compiled); g.model.solveNow(3);
  // 月度账本：经济系统自己会把每月封账后的账页推进 this.ledger（上限 600 个月，30 年内全在）
  // 按真实主循环推进：endDay() 跨月时会返回 true，此时必须把 monthGen 跑完
  //（月初的 openMonth / 拨款 / 债务 / 城市增长都在那里），否则账本永远停在第一个月。
  const Y0 = g.clock.y, Y1 = Y0 + YEARS;
  let guard = 0, failed = null;
  const yearly = {};
  while (g.clock.y < Y1 && guard++ < YEARS * 366 * 2) {
    if (g.econ.failed) { failed = g.clock.y + '-' + g.clock.m; break; }
    if (g.endDay()) {
      const gen = g.monthGen();
      for (let r = gen.next(); !r.done; r = gen.next()) { /* run */ }
      // 主循环里模型是在每帧 step() 里持续求解的；这里按日推进，必须自己补一次求解，
      // 否则 refreshCityGen 之后 daily 一直停在开局那一次的解上（客流会「三十年不变」）。
      g.model.solveNow(1);
      // 年末快照：客流、满意度、资金（客流必须逐年取，否则表格里三十年都是同一个数）
      if (g.clock.m === 1) yearly[g.clock.y] = { metro: g.model.daily ? g.model.daily.metro : 0, sat: g.econ.sat, funds: g.econ.funds };
    }
  }
  // 按年汇总
  // 同一个月的账页可能被重复归档（closeMonth 在两条路径上都会被调用），按 (年,月) 去重、保留 days 最大的那份
  const uniq = new Map();
  for (const r of (g.econ.ledger || [])) {
    const k = r.y * 12 + r.m, old = uniq.get(k);
    if (!old || (r.days || 0) > (old.days || 0)) uniq.set(k, r);
  }
  const by = {};
  for (const r of uniq.values()) {
    const o = by[r.y] || (by[r.y] = { fare: 0, ops: 0, subsidy: 0, capexGrant: 0, prop: 0, propMaint: 0, interest: 0, principal: 0, n: 0, end: 0 });
    o.fare += r.fare; o.ops += r.ops; o.subsidy += r.subsidy || 0; o.capexGrant += r.grantCapex || 0;
    o.prop += r.property || 0; o.propMaint += r.propMaint || 0;
    o.interest += r.interest; o.principal += r.principal; o.n++; o.end = r.end;
  }
  if (failed) console.log('  [注意] 资金失败线在 ' + failed + ' 触发，曲线到此为止');
  if (process.env.DBG) console.log('  [dbg] 结束时钟 ' + g.clock.y + '-' + g.clock.m + '-' + g.clock.d + ' · 账页 ' + (g.econ.ledger || []).length + ' · guard ' + guard);
  // 月度现金流（供外部画图）：按封账的每个月导出
  const months = [];
  for (const r of uniq.values()) {
    months.push({
      y: r.y, m: r.m,
      fare: r.fare || 0, ops: r.ops || 0, prop: r.property || 0, propMaint: r.propMaint || 0,
      subsidy: r.subsidy || 0, grant: r.grantCapex || 0, reward: r.reward || 0,
      interest: r.interest || 0, principal: r.principal || 0,
      construction: r.construction || 0, demolition: r.demolition || 0, upgrade: r.upgrade || 0,
      end: r.end,
    });
  }
  months.sort(function (a, b) { return a.y * 12 + a.m - (b.y * 12 + b.m); });
  return { id: id, Y0: Y0, by: by, yearly: yearly, months: months, metro: g.model.daily ? g.model.daily.metro : 0, sat: g.econ.sat, funds: g.econ.funds, debt: g.econ.debtTotal ? g.econ.debtTotal() : 0, stations: n + 1 };
}

for (const id of MAPS) {
  const r = run(id);
  const mo = CM.CFG.money || {};
  console.log('');
  console.log('== ' + id + '（' + r.Y0 + ' 起，' + r.stations + ' 站）· 单位：万' + (mo.yi ? '（' + mo.code + '）' : ''));
  console.log('年份   票款    运营    物业净   运营补贴  建设批次  利息    净现金流  年末资金   地铁/日  满意度');
  const ys = Object.keys(r.by).map(Number).sort((a, b) => a - b);
  for (const y of ys) {
    const o = r.by[y];
    if ((y - r.Y0) % 5 !== 0 && y !== ys[ys.length - 1]) continue;
    const propNet = o.prop - o.propMaint;
    const net = o.fare + o.subsidy + o.capexGrant + propNet - o.ops - o.interest - o.principal;
    const yr = r.yearly[y] || r.yearly[y + 1] || { metro: 0, sat: r.sat };
    console.log(String(y).padEnd(6) + Math.round(o.fare).toLocaleString('en').padStart(7) + Math.round(o.ops).toLocaleString('en').padStart(8) +
      Math.round(propNet).toLocaleString('en').padStart(9) + Math.round(o.subsidy).toLocaleString('en').padStart(9) +
      Math.round(o.capexGrant).toLocaleString('en').padStart(9) + Math.round(o.interest).toLocaleString('en').padStart(7) +
      Math.round(net).toLocaleString('en').padStart(10) + Math.round(o.end).toLocaleString('en').padStart(10) +
      Math.round(yr.metro).toLocaleString('en').padStart(9) + yr.sat.toFixed(0).padStart(8));
  }
  // 现金流统计
  const mrec = r.months;
  let minF = Infinity, minAt = null, neg = 0, rewardSum = 0, rewardMax = 0, grantSum = 0, fareSum = 0, propSum = 0, opsSum = 0;
  for (const x of mrec) {
    if (x.end < minF) { minF = x.end; minAt = x.y + '-' + x.m; }
    if (x.end < 0) neg++;
    rewardSum += x.reward; if (x.reward > rewardMax) rewardMax = x.reward;
    grantSum += x.grant; fareSum += x.fare; propSum += x.prop - x.propMaint; opsSum += x.ops;
  }
  console.log('现金流：资金最低 ' + U.fmtMoney(minF) + '（' + minAt + '）· 负余额月数 ' + neg +
    ' · 任务奖励合计 ' + U.fmtMoney(rewardSum) + '（单笔最大 ' + U.fmtMoney(rewardMax) + '）');
  console.log('       票款合计 ' + U.fmtMoney(fareSum) + ' · 物业净 ' + U.fmtMoney(propSum) + ' · 运营合计 ' + U.fmtMoney(opsSum) + ' · 建设批次合计 ' + U.fmtMoney(grantSum));
  if (r.months.length) {
    const f = process.env.CASH_CSV;
    if (f) {
      const head = 'y,m,fare,ops,prop,propMaint,subsidy,grant,reward,interest,principal,construction,demolition,upgrade,end\n';
      const body = r.months.map(function (x) {
        return [x.y, x.m, x.fare, x.ops, x.prop, x.propMaint, x.subsidy, x.grant, x.reward, x.interest, x.principal, x.construction, x.demolition, x.upgrade, x.end].join(',');
      }).join('\n');
      fs.writeFileSync(f, head + body + '\n');
      console.log('       月度明细已写入 ' + f + '（' + r.months.length + ' 个月）');
    }
  }
  console.log('末期：资金 ' + Math.round(r.funds).toLocaleString('en') + ' · 债务 ' + Math.round(r.debt).toLocaleString('en') + ' · 地铁/日 ' + Math.round(r.metro).toLocaleString('en') + ' · 满意度 ' + r.sat.toFixed(0));
}
