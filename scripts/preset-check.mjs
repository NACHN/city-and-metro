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
    const b = run(mapId, { preset: 'real' });
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
console.log(bad === 0 ? '✓ 预设 real 与旧 tycoon 逐位一致（开关重构未改变行为）' : '✗ 有 ' + bad + ' 张图不一致');
process.exitCode = bad === 0 ? 0 : 1;
