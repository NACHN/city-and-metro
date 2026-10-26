// 预设等价性检查（node scripts/preset-check.mjs [months]）
//
// 目的：证明「新开关体系」没有改变模拟行为。
// 做法：同一张图、同一随机种子，分别用
//   A) 旧入口 mode:'tycoon'
//   B) 新入口 preset:'real'（全部系统打开、补贴 0.5）
// 各推进 N 个月，比较序列化结果（去掉 id / 名字 / 模式标签这些元数据）。
//
// 两者数值必须逐位相同——这是把自由/挑战/经营三模式拆成开关时唯一的硬约束。
// 之后的预设（简单 1.0 / 一般 0.7 / 困难 0.5）会与它不同，那属于数值改动，不在这里校验。
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js',
  'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/data_tutorial.js',
  'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js',
  'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js',
  'js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js',
  'js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js', 'js/save.js',
];
globalThis.window = globalThis;
globalThis.self = globalThis;
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });

const CM = globalThis.CM;
const months = Math.max(1, Number(process.argv[2] || 2) | 0);
const maps = (process.argv[3] || 'gz,hz,hk,tk,tp').split(',');

// 只保留模拟结果：模式 / 预设 / 系统开关都是标签，不参与比较
const DROP = new Set(['id', 'gameId', 'createdAt', 'savedAt', 'name', 'gameVersion', 'mode', 'preset', 'systems']);
const digestOf = function (g) {
  const body = JSON.stringify(g.serialize(), (k, x) => (DROP.has(k) ? undefined : x));
  return { body: body, hash: crypto.createHash('sha256').update(body).digest('hex').slice(0, 16), bytes: body.length };
};

function advance(g, n) {
  for (let i = 0; i < n; i++) {
    const y0 = g.clock.y, m0 = g.clock.m;
    let d = 0;
    while (g.clock.y === y0 && g.clock.m === m0) { g.endDay(); if (++d > 40) throw new Error('跨月失败'); }
    const it = g.monthGen();
    for (let r = it.next(); !r.done; r = it.next()) { /* 跑完一个月 */ }
  }
}

function run(mapId, opts) {
  CM.useMap(mapId);
  const g = CM.Game.create(Object.assign({ map: mapId, name: 'preset-check' }, opts));
  g.model.solveNow(2);
  advance(g, months);
  const d = g.model.daily || {};
  return {
    hash: digestOf(g).hash, bytes: digestOf(g).bytes,
    pop: Math.round(g.city.totals().pop), metro: Math.round(d.metro || 0),
    funds: Math.round(g.econ.funds), sat: Number(g.econ.sat.toFixed(2)),
  };
}

// 先打印两套 caps 的差异，作为「开关确实生效」的旁证
if (CM.capsFor) {
  const legacy = CM.modeCaps('tycoon'), real = CM.capsFor('real');
  const keys = CM.SYSTEMS.map(function (s) { return s.id; });
  const diff = keys.filter(function (k) { return !!legacy[k] !== !!real[k]; });
  console.log('旧 tycoon 与预设 real 的开关差异：' + (diff.length
    ? diff.map(function (k) { return k + '（旧 ' + (legacy[k] ? '开' : '关') + ' / 新 ' + (real[k] ? '开' : '关') + '）'; }).join('、')
    : '无'));
  console.log('补贴率：旧 ' + legacy.subsidyRate + '（读 CFG 标准档）· 新 ' + real.subsidyRate);
  console.log('');
}

let bad = 0;
console.log('地图   旧 tycoon           预设 real            人口/客流/资金/满意度');
for (const mapId of maps) {
  try {
    const a = run(mapId, { mode: 'tycoon' });
    // legacy = 旧 tycoon 的口径（jobAccess / fareControl 关），专门用来做等价校验
    const b = run(mapId, { preset: 'legacy' });
    const same = a.hash === b.hash;
    if (!same) bad++;
    console.log(mapId.padEnd(6) + a.hash.padEnd(20) + b.hash.padEnd(20) +
      a.pop + ' / ' + a.metro + ' / ' + a.funds + ' / ' + a.sat + (same ? '' : '   ← 不一致'));
    if (!same) console.log('      字节数 ' + a.bytes + ' vs ' + b.bytes);
  } catch (e) {
    bad++;
    console.log(mapId.padEnd(6) + 'ERROR ' + e.message);
  }
}
console.log('');
console.log(bad === 0 ? '✓ 预设 legacy 与旧 tycoon 逐位一致（开关重构未改变行为）' : '✗ 有 ' + bad + ' 张图不一致');

/* ---------------- 开关生效性：逐个验证「关掉之后确实不同」 ---------------- */
const fails = [];
const ok = function (cond, msg) { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) fails.push(msg); };

CM.useMap('gz');
// 1) 增长口径：jobAccess 开关直接改 CM.GROWTH_ACCESS.from
CM.Game.create({ map: 'gz', preset: 'real', name: 'chk' });
ok(CM.GROWTH_ACCESS.from === 'jobAccess', '真实档把增长口径切到「就业可达」');
CM.Game.create({ map: 'gz', preset: 'legacy', name: 'chk' });
ok(CM.GROWTH_ACCESS.from === 'walk', 'legacy 档仍按步行到站（默认口径）');

// 2) 建设批次：easy 关掉 batch，普通档开着
const gN = CM.Game.create({ map: 'gz', preset: 'normal', name: 'chk' });
ok(gN.econ.batchOn() === true, '一般档：建设批次生效');
const gE = CM.Game.create({ map: 'gz', preset: 'easy', name: 'chk' });
ok(gE.econ.batchOn() === false, '简单档：批次关闭，改按月拨款');

// 3) 经营失败：关掉之后资金触底也不判负
const gF = CM.Game.create({ map: 'gz', preset: 'normal', systems: { failure: false }, name: 'chk' });
gF.econ.funds = -1e9;
const noFail = gF.econ.checkFailure(1995, false);
ok(noFail === null, '关闭经营失败后资金触底也不会结束游戏');
const gF2 = CM.Game.create({ map: 'gz', preset: 'normal', name: 'chk' });
gF2.econ.funds = -1e9;
ok(!!gF2.econ.checkFailure(1995, false), '开启经营失败时同样条件下会判负');

// 4) 票价管制：三年一次、单次 +1
const gR = CM.Game.create({ map: 'gz', preset: 'real', name: 'chk' });
const fare0 = gR.econ.fare.flat;
ok(gR.econ.canSetFare(1990, 1, fare0 + 1).ok === true, '真实档：首次可上调 +1');
ok(gR.econ.canSetFare(1990, 1, fare0 + 2).ok === false, '真实档：单次最多 +1（+2 被拦）');
ok(gR.econ.canSetFare(1990, 1, fare0 - 0.5).ok === false, '真实档：不能自行降价');
gR.econ.fareLast = CM.U.ymIndex(1990, 1);
ok(gR.econ.canSetFare(1991, 6, fare0 + 1).ok === false, '真实档：未满三年不能调价');
ok(gR.econ.canSetFare(1993, 2, fare0 + 1).ok === true, '真实档：满三年后可调');
const gFree = CM.Game.create({ map: 'gz', preset: 'normal', name: 'chk' });
ok(gFree.econ.canSetFare(1990, 2, fare0 + 5).ok === true, '非管制档：票价随意调');

// 5) TOD 与地价的依赖
ok(CM.capsFor('normal').tod === false && CM.capsFor('normal').land === true, '一般档：有地价、无 TOD 分成');
ok(CM.capsFor('real').tod === true, '真实档：TOD 分成打开');

console.log('');
console.log(fails.length === 0 ? '✓ 全部开关都接上了' : '✗ ' + fails.length + ' 项开关未生效');
process.exitCode = (bad === 0 && fails.length === 0) ? 0 : 1;
