// 用真实存档跑「未来的经营」（node scripts/save-sim.mjs save.json [years] [presets]）
//
// 目的：不靠新建的测试线网，而是拿玩家真实玩到一半的城市（几十站、多条线），
// 在几个难度预设下各跑若干年，看「同一座城市换一套规则会长成什么样」。
//
// 存档里 mode 是旧标签（tycoon 等），恢复后按预设覆盖 caps，
// 并把阻抗口径 / 增长口径同步过去——这三步与 Game.create 里的 applyImpedance 一致。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js',
  'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/geo_gz2.js', 'js/data_gz2.js', 'js/data_tutorial.js',
  'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js',
  'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js',
  'js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js',
  'js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js', 'js/save.js',
];
globalThis.window = globalThis;
globalThis.self = globalThis;
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const CM = globalThis.CM;

const file = process.argv[2] || '_save.json';
const years = Number(process.argv[3] || 10);
const presets = (process.argv[4] || 'easy,normal,hard,real').split(',');
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const meta = raw.meta || {};
if (!CM.MAPS[meta.map]) { console.error('未知地图：' + meta.map); process.exit(1); }

function advance(g, months) {
  for (let i = 0; i < months; i++) {
    const y0 = g.clock.y, m0 = g.clock.m;
    let d = 0;
    while (g.clock.y === y0 && g.clock.m === m0) { g.endDay(); if (++d > 40) throw new Error('跨月失败'); }
    const it = g.monthGen();
    for (let r = it.next(); !r.done; r = it.next()) { /* 跑完一个月 */ }
    g.model.solveNow(1);
  }
}

function run(preset) {
  CM.useMap(meta.map);
  const s = JSON.parse(JSON.stringify(raw));
  const g = CM.Game.restore(s);
  // 按预设覆盖能力（restore 用的是存档里的旧 mode）
  g.preset = preset === 'legacy' ? null : preset;
  g.systems = null;
  g.caps = preset === 'legacy' ? CM.modeCaps('tycoon') : CM.capsFor(preset);
  g.econ.caps = g.caps;
  g.econ.mode = preset;
  CM.CFG.choice.impedance = g.caps.timeCommute ? 'time' : 'distance';
  if (CM.GROWTH_ACCESS) CM.GROWTH_ACCESS.from = g.caps.jobAccess ? 'jobAccess' : 'walk';
  if (CM.CFG.choice.impedance === 'time') { g.model.buildDemand(); g.model.solveNow(2); }

  if (process.env.DEBUG) console.log('  [debug] ' + preset + '：增长口径 ' + CM.GROWTH_ACCESS.from + ' · 阻抗 ' + CM.CFG.choice.impedance + ' · 补贴率 ' + g.econ.subsidyRate());
  const y0 = g.clock.y, m0 = g.clock.m, startYm = y0 * 12 + m0;
  const start = {
    funds: g.econ.funds, debt: g.econ.debtTotal(), metro: (g.model.daily || {}).metro || 0,
    share: (g.model.daily || {}).metroShare || 0, sat: g.econ.sat, pop: g.city.totals().pop,
    stations: Object.keys(g.net.stations).length, lines: Object.keys(g.net.lines).length,
  };
  const agg = { fare: 0, ops: 0, subsidy: 0, property: 0, capture: 0, construction: 0, interest: 0, principal: 0, reward: 0 };
  const seen = new Set();
  let failed = null, months = 0;
  const t0 = Date.now();
  for (let i = 0; i < years * 12; i++) {
    if (g.econ.failed) { failed = { at: g.clock.y + '-' + g.clock.m, reasons: g.econ.failed.reasons }; break; }
    advance(g, 1);
    months++;
    // 账本去重后累计（同一个月可能被归档两次）
    for (const r of g.econ.ledger) {
      const k = r.y * 12 + r.m;
      // 只统计存档之后结算的月份：账本里还留着存档之前的全部历史
      if (seen.has(k) || !r.closed || k <= startYm) continue;
      seen.add(k);
      agg.fare += r.fare || 0; agg.ops += r.ops || 0; agg.subsidy += r.subsidy || 0;
      agg.property += (r.property || 0) - (r.propMaint || 0); agg.capture += r.capture || 0;
      agg.interest += r.interest || 0; agg.principal += r.principal || 0; agg.reward += r.reward || 0;
      for (const kk of CM.Economy.BUILD_KINDS) agg.construction += r[kk] || 0;
    }
  }
  const d = g.model.daily || {};
  if (process.env.DEBUG) {
    const f = (g.econ.satFactors && g.econ.satFactors.factors) || [];
    console.log('  [debug] 满意度分项：' + f.map(function (x) { return x.label + ' ' + (x.v >= 0 ? '+' : '') + x.v.toFixed(1); }).join(' · '));
    if ((g.econ.mods || []).length) console.log('  [debug] 任务修正：' + g.econ.mods.map(function (m) { return m.reason + '(' + m.kind + ' ' + m.factor + '/' + m.delta + ')'; }).join('、'));
    else console.log('  [debug] 任务修正：无');
  }
  return {
    preset, fail: failed, ms: Date.now() - t0, months,
    start, end: {
      funds: g.econ.funds, debt: g.econ.debtTotal(), metro: d.metro || 0, share: d.metroShare || 0,
      sat: g.econ.sat, pop: g.city.totals().pop, stations: Object.keys(g.net.stations).length,
      lines: Object.keys(g.net.lines).length, negMonths: g.econ.negMonths,
    },
    agg,
  };
}

const fmt = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toLocaleString('en', { maximumFractionDigits: 0 });
const nSt = Object.keys(raw.net.stations || {}).length, nLn = Object.keys(raw.net.lines || {}).length;
console.log('存档：' + (meta.name || '') + ' · ' + meta.map + ' · ' + raw.clock.y + ' 年 ' + raw.clock.m + ' 月 · ' + nSt + ' 站 / ' + nLn + ' 线');
console.log('推演 ' + years + ' 年（' + (raw.clock.y + years) + ' 年 ' + raw.clock.m + ' 月止）· 单位：万元');
console.log('');
console.log('预设    结局        人口        客流/日     分担率   满意度  资金(末)     债务(末)    年票款  年补贴   年运营   年物业+分成  年建设');
for (const p of presets) {
  let r;
  try { r = run(p); } catch (e) { console.log(p.padEnd(8) + 'ERROR ' + e.message); continue; }
  const n = Math.max(1, r.months / 12);
  const row = [
    p.padEnd(8),
    (r.fail ? ('失败 ' + r.fail.at) : '存活').padEnd(12),
    String(Math.round(r.end.pop)).padStart(10),
    String(Math.round(r.end.metro)).padStart(9),
    ((r.end.share * 100).toFixed(1) + '%').padStart(8),
    r.end.sat.toFixed(0).padStart(7),
    fmt(Math.round(r.end.funds)).padStart(12),
    fmt(Math.round(r.end.debt)).padStart(11),
    fmt(Math.round(r.agg.fare / n)).padStart(8),
    fmt(Math.round(r.agg.subsidy / n)).padStart(8),
    fmt(Math.round(-r.agg.ops / n)).padStart(8),
    fmt(Math.round((r.agg.property + r.agg.capture) / n)).padStart(11),
    fmt(Math.round(-r.agg.construction / n)).padStart(9),
  ];
  console.log(row.join(' '));
}
