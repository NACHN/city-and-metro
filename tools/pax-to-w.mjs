// 把设施数据里「绝对到访量」写法（pax，万人次/日）换算成「份额」写法（w，占全市该目的吸引的比例）。
//
// 为什么必须换算：出行总量只由居住人口与出行率决定，设施（不包括铁路与机场）只改变**去向**。
// 直接写绝对人次当吸引量，等于凭空造需求；而且它的量纲和小区吸引量对不上，
// 实测会差一个数量级（写 8,000 人次只落出 600 多）。
//
// 换算口径：w = 到访量 ÷ Σ_p (该目的的份额 fr_p × 全市该目的日出行量)
//           全市该目的日出行量 = 人口(y) × 出行率(y)
// 出行率取自 CFG.choice 的 workerRate / hoRate 与 purposeShare，人口取自该图的 growth.popCurve，
// 所以换算出来的 w 与引擎实际用的量纲一致。
//
// 用法：
//   node tools/pax-to-w.mjs sh            # 就地改写 maps/sh/source.json
//   node tools/pax-to-w.mjs sh --dry      # 只打印，不写
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'C:/dev/city-and-metro';
const MAP = process.argv.slice(2).find((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry');
if (!MAP) { console.error('用法：node tools/pax-to-w.mjs <mapId> [--dry]'); process.exit(1); }

globalThis.window = globalThis;
globalThis.CM = { U: {}, DATA: { facilities: [], landmarks: [] } };
const L = (f) => vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
L('js/util.js');
L('js/config.js');
L('js/facility.js');
const CM = globalThis.CM, U = CM.U, CFG = CM.CFG, TYPES = CM.Fac.TYPES;

const srcPath = path.join(root, 'maps', MAP, 'source.json');
const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const D = src.data;
const popCurve = (src.cfg && src.cfg.growth && src.cfg.growth.popCurve) || [[2000, 1e6]];

function rates(y) {
  const c = CFG.choice, ps = c.purposeShare;
  const hr = U.interp(c.hoRate, y);
  const sc = U.interp(ps.sc, y), md = U.interp(ps.md, y), lz = U.interp(ps.lz, y);
  const sh = Math.max(0.05, 1 - sc - md - lz);
  // 索引与 PK 一致：1 上学 2 购物 3 就医 4 休闲
  return [0, hr * sc, hr * sh, hr * md, hr * lz];
}
// 设施类型的目的键 → PK 索引；facility 自己的 p 覆盖优先
const PKOF = { sc: 1, sh: 2, md: 3, lz: 4 };
// 份额上限：换算公式是「到访量 ÷ 全市该目的出行量」，而模型里的就医、上学总量比现实小，
// 一家三甲医院写 1 万人次/日会算出 30% 的份额 —— 那不是「份额」，是把整类出行全塞给它。
// 上限按类型给，超出就截断（截断后界面上的到访量会比原始 pax 小，这是有意的）。
const CAP = { hosp: 0.10, uni: 0.10, shop: 0.12, cbd: 0.10, scenic: 0.10, park: 0.05, stadium: 0.04, venue: 0.06 };

function toW(item) {
  const T = TYPES[item.t];
  if (!T || T.hub) return null;                       // 枢纽保留 pax（外生旅客量）
  const fr = item.p || T.p;
  let changed = false;
  const curve = (Array.isArray(item.pax[0]) ? item.pax : [[popCurve[0][0], item.pax]]).map(function (e) {
    const y = e[0], pax = e[1];
    const pop = U.interp(popCurve, y), r = rates(y);
    let denom = 0, sumFr = 0;
    for (const k in fr) { const p = PKOF[k]; if (!p) continue; denom += fr[k] * pop * r[p]; sumFr += fr[k]; }
    if (!(denom > 0)) return [y, 0];
    const cap = CAP[item.t] || 0.12;
    const w = Math.min(cap, (pax * 1e4) / denom);
    changed = true;
    return [y, Number(w.toPrecision(3))];
  });
  return changed ? curve : null;
}

const rows = [];
for (const f of D.facilities || []) {
  if (!f.pax || f.w != null) continue;
  const w = toW(f);
  if (!w) continue;
  rows.push({ id: f.id, n: f.n, t: f.t, pax: f.pax, w: w });
  if (!DRY) { f.w = w.length === 1 ? w[0][1] : w; delete f.pax; }
}
if (!rows.length) { console.log(`[${MAP}] 没有需要换算的设施（都已经是 w 写法）`); process.exit(0); }

console.log(`[${MAP}] 换算 ${rows.length} 处设施（pax → w），人口曲线 ${popCurve[0][0]}–${popCurve[popCurve.length - 1][0]}`);
for (const r of rows) {
  const f = (v) => (typeof v === 'number' ? v.toPrecision(3) : '');
  const a = r.pax.map((e) => e[0] + ':' + e[1]).join(' ');
  const b = (Array.isArray(r.w[0]) ? r.w : [[popCurve[0][0], r.w]]).map((e) => e[0] + ':' + f(e[1])).join(' ');
  const capped = (Array.isArray(r.w) ? r.w : [[0, r.w]]).some((e) => e[1] >= (CAP[r.t] || 0.12) - 1e-9);
  console.log('  ' + String(r.n).padEnd(14) + String(r.t).padEnd(8) + 'pax ' + a.padEnd(44) + ' → w ' + b + (capped ? '  ← 截断' : ''));
}
if (DRY) { console.log('（--dry，未写回）'); process.exit(0); }
fs.writeFileSync(srcPath, JSON.stringify(src, null, 1), 'utf8');
console.log('已写回 ' + srcPath + '，接着跑 node scripts/map-source.mjs build ' + MAP + ' --in-place');
