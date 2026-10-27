// 用游戏自己的数据画一张 PNG 预览（node tools/preview-map.mjs gz2）
//
// 不看渲染器的笔画细节，只看「用地 / 水域 / 路网 / 铁路 / 未开放」这几层是否对得上：
// 直接取 City.generate 之后的 lu、Geo 的 roads/water，按 4 px 一格画出来。
// 目的是在没有浏览器的环境下核对新地图，而不是替代真实渲染。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, '..');
const mapId = process.argv[2] || 'gz2';
const out = process.argv[3] || path.join(HERE, '_preview_' + mapId + '.ppm');

// 只加载请求的那张图（外加广州，因为 CM.GEO 是广州单例，其它模块默认读它）。
// 以前这里把 gz2 写死进清单，结果新加的图（sh）根本进不来 —— useMap 找不到就退回广州，
// 预览出来的是广州底图。现在按 mapId 找文件，停放的地图（maps/<id>/parked/）也认。
const pick = (rel) => {
  const direct = path.join(root, rel);
  if (fs.existsSync(direct)) return direct;
  const parked = path.join(root, 'maps', mapId, 'parked', path.basename(rel));
  return fs.existsSync(parked) ? parked : null;
};
const FILES = ['js/util.js', 'js/config.js', 'js/manifest.js', 'js/geo_gz.js', 'js/geo.js',
  pick('js/geo_' + mapId + '.js'), 'js/data_gz.js', pick('js/data_' + mapId + '.js'),
  'js/data_tutorial.js', 'js/data_hz.js', 'js/data_hk.js', 'js/data_tk.js', 'js/data_tp.js',
  'js/maps.js', 'js/facility.js', 'js/city.js'].filter(Boolean);
const sb = { console: { log() {}, warn() {}, error() {} } };
sb.window = sb; vm.createContext(sb);
for (const f of FILES) {
  try { vm.runInContext(fs.readFileSync(f, 'utf8'), sb, { filename: f }); } catch (e) { console.error('load', f, e.message); }
}
const CM = sb.CM;
CM.useMap(mapId);
const city = new CM.City();
city.generate(CM.CFG.START.y * 10000 + 101, CM.CFG.START.y);
CM.Geo.init();

const W = CM.CFG.W, H = CM.CFG.H, S = 4, FW = W * S, FH = H * S;
const buf = Buffer.alloc(FW * FH * 3, 240);
const put = (x, y, c, a) => {
  x = Math.round(x * S); y = Math.round(y * S);
  if (x < 0 || y < 0 || x >= FW || y >= FH) return;
  const o = (y * FW + x) * 3, k = a == null ? 1 : a;
  buf[o] = Math.round(buf[o] * (1 - k) + c[0] * k);
  buf[o + 1] = Math.round(buf[o + 1] * (1 - k) + c[1] * k);
  buf[o + 2] = Math.round(buf[o + 2] * (1 - k) + c[2] * k);
};
const line = (p, c, w) => {
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * S));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      for (let dx = -w; dx <= w; dx += 0.5) for (let dy = -w; dy <= w; dy += 0.5) put(x + dx / S, y + dy / S, c);
    }
  }
};

// 1) 用地底色
const LU = CM.LU;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const c = j * W + i, L = city.lu[c];
  let col = [226, 232, 214];                                    // 农田
  if (L === LU.WATER) col = [214, 226, 232];
  else if (L === LU.HILL) col = [206, 216, 200];
  else if (L === LU.PARK) col = [196, 216, 186];
  else if (city.street[c]) col = [228, 222, 214];               // 建成街区
  for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) put(i + a / S, j + b / S, col);
}
// 2) 水面（多边形扫描线，用游戏自己的 Geo.fill）
const wm = new Uint8Array(FW * FH);
CM.Geo.fill(wm, FW, FH, S, CM.Geo.water);
for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (wm[y * FW + x]) put(x / S, y / S, [150, 192, 224]);
CM.Geo.waterLines.forEach((l) => line(l.p, [150, 192, 224], Math.max(l.w / 2, 0.03)));
// 3) 铁路与道路
CM.Geo.rail.forEach((r) => line(r.p, [90, 90, 90], 0.25));
const RC = { 1: [200, 196, 190], 2: [176, 160, 140], 3: [222, 178, 78], 4: [236, 124, 52] };
const ways = city.roadWays || [];
// 虚线段：与 render.js 里隧道的画法对应（on/off 以格为单位）
const dashFlat = (p, c, w, on = 0.24, off = 0.14) => {
  let acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.ceil(len * 6));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if ((acc + t * len) % (on + off) > on) continue;
      for (let a = -w; a <= w; a += 0.5) for (let b = -w; b <= w; b += 0.5) put(x0 + (x1 - x0) * t + a / S, y0 + (y1 - y0) * t + b / S, c);
    }
    acc += len;
  }
};
// 桥：先描一圈浅色边，再画路面；隧道：虚线（与 render.js 的处理对应）
ways.forEach((w) => { if (!city.roadsBuilt[w.g]) return; const gr = city.roadGroups[w.g]; if (!(gr.flags & 1) || (gr.flags & 2)) return; line(w.p, [96, 108, 130], gr.cls >= 3 ? 1.4 : 0.9); });
ways.forEach((w) => { if (!city.roadsBuilt[w.g]) return; const gr = city.roadGroups[w.g]; line(w.p, RC[gr.cls] || [180, 180, 180], gr.cls >= 3 ? 0.8 : 0.45); });
ways.forEach((w) => { if (!city.roadsBuilt[w.g]) return; const gr = city.roadGroups[w.g]; if (!(gr.flags & 2)) return; dashFlat(w.p, [70, 110, 170], gr.cls >= 3 ? 1.0 : 0.6); });
// 4) 未开放片区（半透明灰）
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const c = j * W + i, rg = city.regions[city.region[c]];
  if (city.regionOpen[city.region[c]] || rg.scenic || city.lu[c] === LU.WATER) continue;
  for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) put(i + a / S, j + b / S, [120, 120, 130], 0.22);
}

fs.writeFileSync(out, 'P6\n' + FW + ' ' + FH + '\n255\n');
fs.appendFileSync(out, buf);
console.log('-> ' + out + ' (' + FW + '×' + FH + ') · 路 ' + ways.length + ' 条，已建 ' + ways.filter((w) => city.roadsBuilt[w.g]).length);
