// 无头冒烟与数值回归：在 Node 里加载纯逻辑模块（不加载渲染与界面），
// 对固定地图 / 模式推进固定月数，输出状态指纹。零依赖。
//
//   node scripts/smoke.mjs                        # 六图 × 两模式，推进 2 个月
//   node scripts/smoke.mjs --months=6 --maps=gz,hk
//   node scripts/smoke.mjs --json                 # 只输出 JSON
//
// 用途：改动模拟内核后对比两次运行的指纹，确认既有模式数值未漂移。
// 注意：指纹包含地图数据与交通模型版本，所以跨版本比较前先确认地图数据未变。
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 逻辑模块的加载顺序与 index.html 一致；渲染 / 界面 / 声音相关模块不参与
const FILES = [
  'js/util.js', 'js/config.js', 'js/manifest.js', 'js/news.js',
  'js/geo_gz.js', 'js/geo.js', 'js/data_gz.js', 'js/data_tutorial.js',
  'js/geo_hz.js', 'js/data_hz.js', 'js/geo_hk.js', 'js/data_hk.js',
  'js/geo_tk.js', 'js/data_tk.js', 'js/geo_tp.js', 'js/data_tp.js',
  'js/maps.js', 'js/facility.js', 'js/city.js', 'js/metro.js', 'js/sim.js',
  'js/economy.js', 'js/macro.js', 'js/game.js', 'js/milestones.js', 'js/save.js',
];

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const hit = argv.find((a) => a.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3) : d;
};
const months = Math.max(0, Number(arg('months', '2')) | 0);
const jsonOnly = argv.includes('--json');
const mapArg = arg('maps', 'gz,tutorial,hz,hk,tk,tp');
// 强制模式（逗号分隔），用于测试地图尚未放行的模式，例如 --modes=tycoon
const modeArg = arg('modes', null);

globalThis.window = globalThis;
globalThis.self = globalThis;

for (const f of FILES) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  try {
    vm.runInThisContext(code, { filename: f });
  } catch (e) {
    console.error('加载失败：' + f + ' — ' + e.message);
    process.exit(1);
  }
}

const CM = globalThis.CM;
const log = (...a) => { if (!jsonOnly) console.log(...a); };

// 去掉每次新建都会变的字段，只留下模拟结果
const NONDET = new Set(['id', 'gameId', 'createdAt', 'savedAt', 'name']);
function normalize(v) {
  return JSON.stringify(v, (k, x) => (NONDET.has(k) ? null : x));
}

function runMap(mapId, mode) {
  CM.useMap(mapId);
  const g = CM.Game.create({ map: mapId, mode: mode, name: 'smoke' });
  g.model.solveNow(2);
  for (let i = 0; i < months; i++) {
    const it = g.monthGen();
    for (let r = it.next(); !r.done; r = it.next()) { /* 跑完一个月 */ }
  }
  const d = g.model.daily || {};
  const t = g.city.totals();
  const body = normalize(g.serialize());
  const row = {
    map: mapId,
    mode: mode,
    pop: Math.round(t.pop),
    jobs: Math.round(t.jobs),
    trips: Math.round(d.trips || 0),
    metro: Math.round(d.metro || 0),
    share: Number((d.metroShare || 0).toFixed(6)),
    cong: Number((d.cong || 1).toFixed(6)),
    coverage: Number((d.coverage || 0).toFixed(6)),
    funds: Math.round(g.econ.funds),
    sat: Number(g.econ.sat.toFixed(4)),
    tasks: g.tasks ? g.tasks.active.length : 0,
    bytes: body.length,
    hash: crypto.createHash('sha256').update(body).digest('hex').slice(0, 16),
  };
  // 经营模式才有地价：给出分位数与核心/外围梯度，便于检查标定是否落在 4–6 倍
  if (g.city.landStat) {
    const s = g.city.landStat;
    row.land = {
      mean: Math.round(s.mean), p10: Math.round(s.p10), p50: Math.round(s.p50), p90: Math.round(s.p90),
      gradient: Number(s.gradient.toFixed(2)), max: Math.round(s.max),
    };
  }
  return row;
}

const rows = [];
for (const mapId of mapArg.split(',').map((s) => s.trim()).filter(Boolean)) {
  const mp = CM.MAPS[mapId];
  if (!mp) { log('跳过未知地图：' + mapId); continue; }
  const modes = modeArg ? modeArg.split(',').map((s) => s.trim()).filter(Boolean) : (mp.modes || ['challenge']);
  for (const mode of modes) {
    const t0 = Date.now();
    try {
      const r = runMap(mapId, mode);
      r.ms = Date.now() - t0;
      rows.push(r);
      log([r.map.padEnd(9), r.mode.padEnd(10), String(r.pop).padStart(9), String(r.metro).padStart(8),
        String(r.share).padStart(8), String(r.funds).padStart(9), String(r.sat).padStart(7),
        (r.land ? ('地价 ' + r.land.mean + ' 中位 ' + r.land.p50 + ' 梯度 ' + r.land.gradient.toFixed(2) + '×').padEnd(34) : ''.padEnd(34)),
        r.hash].join('  '));
    } catch (e) {
      rows.push({ map: mapId, mode: mode, error: e.message });
      log([mapId.padEnd(9), mode.padEnd(10), 'ERROR ' + e.message].join('  '));
    }
  }
}

const digest = crypto.createHash('sha256').update(JSON.stringify(rows.map((r) => [r.map, r.mode, r.hash || r.error]))).digest('hex').slice(0, 16);
if (jsonOnly) {
  console.log(JSON.stringify({ months: months, digest: digest, rows: rows }, null, 2));
} else {
  log('');
  log('月份 ' + months + ' · 总指纹 ' + digest);
}
