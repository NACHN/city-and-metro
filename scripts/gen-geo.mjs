// 《城市与地铁》地理数据工具
//
// 仓库里只有 geo_<id>.js 的产物，没有「OSM → 产物」的流程。本工具补上两件能验证的事：
//
//   1) --verify          把现有 geo_<id>.js 的每条折线「解码 → 重新编码」，要求逐字节相同。
//                        这是编码器的自证：只要能复现产物，就说明编码规则已被固化，而不是靠记忆。
//   2) --from <geojson>  把一份已标注的 GeoJSON 投影、裁剪、编码成 js/geo_<id>.js。
//                        只负责「投影 / 裁剪 / 编码 / 格式」，不做 OSM 标签分类——
//                        图层、道路等级与 flags 必须由输入的 properties 明确给出（见下方契约）。
//
// 用法：
//   node scripts/gen-geo.mjs --verify                     校验五张真实地图的编码可复现性
//   node scripts/gen-geo.mjs --stats                      列出各图各图层的要素与点数
//   node scripts/gen-geo.mjs --from city.geojson --map xx --proj 113.2,23.215,409.6,443
//   node scripts/gen-geo.mjs --from city.geojson --map xx --out js/geo_xx.js   # 复用已有地图的投影
//
// GeoJSON 输入契约（每个要素的 properties）：
//   layer   必填：water | waterway | road | street | rail | park | reserve | wood | admin | place
//   name    可选：写入名称表（空名共用索引 0）
//   class   layer=road 时必填：1 支路 / 2 次干道 / 3 主干道 / 4 快速路
//   flags   可选整数：道路 1 桥 / 2 隧道 / 4 匝道；铁路 2 地下 / 16 高速铁路（与 city.js 的位运算一致）
//   width   layer=waterway 时必填：河宽（格，1 格 = 250 m）
//   level   layer=admin 时必填：行政层级
//   year    可选：铁路开通年份
//
// 输入坐标使用 WGS84（GeoJSON 标准，经度在前）。投影公式与各图一致：x = (lon - lon0) × kx，y = (lat0 - lat) × ky。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const PRECISION = 64;   // 1/64 格 ≈ 3.9 m，与 Geo.dec / Geo.enc 一致

// ---------------------------------------------------------------- 编码（与 js/geo.js 的 Geo.enc 等价）

function enc(pts) {
  let s = '', px = 0, py = 0;
  const put = (v) => {
    let u = v < 0 ? ~(v << 1) : (v << 1);
    while (u >= 32) { s += String.fromCharCode((32 | (u & 31)) + 63); u >>>= 5; }
    s += String.fromCharCode(u + 63);
  };
  for (let k = 0; k + 1 < pts.length; k += 2) {
    const x = Math.round(pts[k] * PRECISION), y = Math.round(pts[k + 1] * PRECISION);
    put(x - px); put(y - py); px = x; py = y;
  }
  return s;
}

// ---------------------------------------------------------------- 读取现有产物

function loadGeoModule(file) {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  sandbox.window.CM = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox.window.CM;
}

function readManifest(root) {
  const box = { console: { log() {}, warn() {}, error() {} } };
  box.window = box;
  box.window.CM = {};
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'manifest.js'), 'utf8'), box, { filename: 'manifest.js' });
  return box.window.CM.MAP_MANIFEST || [];
}

function dec(s, from) {
  const out = [];
  let i = from || 0, x = 0, y = 0;
  while (i < s.length) {
    let r = 0, sh = 0, b;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    x += (r & 1) ? ~(r >> 1) : (r >> 1);
    r = 0; sh = 0;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    y += (r & 1) ? ~(r >> 1) : (r >> 1);
    out.push(x / PRECISION, y / PRECISION);
  }
  return out;
}

// 遍历一张地图的全部折线：{ layer, encoded, offset, prefix }
function eachPolyline(G, visit) {
  for (const row of G.water || []) {
    if (typeof row[1] === 'number') { if (typeof row[2] === 'string') visit('water-line', row[2], 0, ''); }
    else for (let k = 1; k < row.length; k++) if (typeof row[k] === 'string') visit('water', row[k], 1, row[k][0]);
  }
  for (const key of ['parks', 'reserves', 'woods']) {
    for (const row of G[key] || []) for (let k = 1; k < row.length; k++) if (typeof row[k] === 'string') visit(key, row[k], 1, row[k][0]);
  }
  for (const row of G.admin || []) for (let k = 2; k < row.length; k++) if (typeof row[k] === 'string') visit('admin', row[k], 1, row[k][0]);
  for (const row of G.roads || []) if (typeof row[3] === 'string') visit('roads', row[3], 0, '');
  for (const row of G.rail || []) if (typeof row[2] === 'string') visit('rail', row[2], 0, '');
  for (const s of String(G.streets || '').split('!')) if (s) visit('streets', s, 0, '');
}

// ---------------------------------------------------------------- --verify

function verify(root) {
  const manifest = readManifest(root);
  let total = 0, bad = 0;
  const rows = [];
  for (const e of manifest) {
    if (!e.geo) { rows.push({ id: e.id, layers: '（几何由数据文件生成，跳过）', points: 0, result: 'skip' }); continue; }
    const file = path.join(root, 'js', 'geo_' + e.geo + '.js');
    const CM = loadGeoModule(file);
    const G = (CM.GEOS || {})[e.geo];
    if (!G) { rows.push({ id: e.id, layers: '', points: 0, result: 'fail', note: '模块没有导出 CM.GEOS.' + e.geo }); bad++; continue; }
    let points = 0, failed = 0, first = null;
    const byLayer = {};
    eachPolyline(G, (layer, encoded, offset, prefix) => {
      total++;
      const pts = dec(encoded, offset);
      const again = prefix + enc(pts);
      points += pts.length / 2;
      byLayer[layer] = (byLayer[layer] || 0) + 1;
      if (again !== encoded) {
        failed++; bad++;
        if (!first) first = layer;
      }
    });
    rows.push({ id: e.id, layers: Object.keys(byLayer).length, points, result: failed ? 'fail' : 'ok', note: failed ? failed + ' 条折线无法复现（首个：' + first + '）' : '' });
  }
  console.log('编码自证：解码后重新编码，要求与产物逐字节相同');
  for (const r of rows) {
    const mark = r.result === 'ok' ? '✓' : r.result === 'skip' ? '–' : '✗';
    console.log('  ' + mark + ' ' + r.id.padEnd(9) + String(r.points.toLocaleString('en-US')).padStart(10) + ' 点  ' + (r.layers === '（几何由数据文件生成，跳过）' ? r.layers : r.layers + ' 个图层') + (r.note ? '  ' + r.note : ''));
  }
  console.log('');
  console.log(bad ? '失败：' + bad + ' 条折线无法复现' : '通过：' + total + ' 条折线全部可复现（编码规则与产物一致）');
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- --stats

function stats(root) {
  const manifest = readManifest(root);
  for (const e of manifest) {
    if (!e.geo) { console.log(e.id.padEnd(9) + ' 虚构地图（几何由数据文件生成）'); continue; }
    const file = path.join(root, 'js', 'geo_' + e.geo + '.js');
    const G = loadGeoModule(file).GEOS[e.geo];
    const count = {};
    eachPolyline(G, (layer) => { count[layer] = (count[layer] || 0) + 1; });
    let pts = 0;
    eachPolyline(G, (layer, encoded, offset) => { pts += dec(encoded, offset).length / 2; });
    const proj = G.proj || {};
    console.log(e.id.padEnd(9) + '要素 ' + String(Object.values(count).reduce((a, b) => a + b, 0)).padStart(6) +
      '  点 ' + String(Math.round(pts).toLocaleString('en-US')).padStart(8) +
      '  地名 ' + String((G.places || []).length).padStart(5) +
      '  名称 ' + String((G.names || []).length).padStart(5) +
      '  投影 ' + [proj.lon0, proj.lat0, proj.kx, proj.ky].join(','));
    console.log('         ' + Object.entries(count).map(([k, v]) => k + ' ' + v).join(' · '));
  }
}

// ---------------------------------------------------------------- 投影与裁剪

function project(pt, proj) {
  return [(pt[0] - proj.lon0) * proj.kx, (proj.lat0 - pt[1]) * proj.ky];
}

// Liang–Barsky：把一条折线裁到矩形内，可能得到多段
function clipLine(pts, x0, y0, x1, y1) {
  const out = [];
  let cur = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    const tests = [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]];
    let ok = true;
    for (const [p, q] of tests) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { if (cur.length >= 4) out.push(cur); cur = []; continue; }
    const sx = ax + dx * t0, sy = ay + dy * t0, ex = ax + dx * t1, ey = ay + dy * t1;
    if (!cur.length) cur = [sx, sy];
    else if (Math.abs(cur[cur.length - 2] - sx) > 1e-9 || Math.abs(cur[cur.length - 1] - sy) > 1e-9) {
      if (cur.length >= 4) out.push(cur);
      cur = [sx, sy];
    }
    cur.push(ex, ey);
    if (t1 < 1) { if (cur.length >= 4) out.push(cur); cur = []; }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

// Sutherland–Hodgman：把一圈点裁到矩形内
function clipRing(pts, x0, y0, x1, y1) {
  let ring = [];
  for (let i = 0; i + 1 < pts.length; i += 2) ring.push([pts[i], pts[i + 1]]);
  const edges = [
    (p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= y0, (p) => p[1] <= y1,
  ];
  const inter = (a, b, k) => {
    if (k === 0) { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + (b[1] - a[1]) * t]; }
    if (k === 1) { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + (b[1] - a[1]) * t]; }
    if (k === 2) { const t = (y0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, y0]; }
    const t = (y1 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, y1];
  };
  for (let k = 0; k < 4; k++) {
    const inside = edges[k];
    const next = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const ia = inside(a), ib = inside(b);
      if (ia) { next.push(a); if (!ib) next.push(inter(a, b, k)); }
      else if (ib) next.push(inter(a, b, k));
    }
    ring = next;
    if (!ring.length) break;
  }
  const flat = [];
  for (const p of ring) flat.push(p[0], p[1]);
  return flat.length >= 6 ? flat : null;
}

// ---------------------------------------------------------------- --from

function fromGeoJSON(root, opts) {
  const src = JSON.parse(fs.readFileSync(opts.from, 'utf8'));
  const features = src.type === 'FeatureCollection' ? src.features : [src];
  let proj = opts.proj ? { lon0: +opts.proj[0], lat0: +opts.proj[1], kx: +opts.proj[2], ky: +opts.proj[3] } : null;
  if (!proj && opts.map) {
    const file = path.join(root, 'js', 'geo_' + opts.map + '.js');
    if (fs.existsSync(file)) {
      proj = loadGeoModule(file).GEOS[opts.map].proj;
      console.error('复用 js/geo_' + opts.map + '.js 的投影：' + [proj.lon0, proj.lat0, proj.kx, proj.ky].join(','));
    }
  }
  if (!proj) throw new Error('缺少投影：请用 --proj lon0,lat0,kx,ky 指定，或对已有地图使用 --map（复用其 proj）');
  if (!opts.map) throw new Error('缺少 --map <id>（决定 CM.GEOS 的键名与文件名）');

  const W = +opts.w, H = +opts.h;
  if (!W || !H) throw new Error('缺少 --w / --h（地图格网尺寸，须与数据文件的 cfg.W / cfg.H 一致）');
  const buf = opts.buffer == null ? 5 : +opts.buffer;

  const names = [''];
  const nameIdx = new Map();
  const idxOf = (n) => {
    if (!n) return 0;
    if (nameIdx.has(n)) return nameIdx.get(n);
    const i = names.length; names.push(n); nameIdx.set(n, i); return i;
  };

  const out = { proj, names, water: [], waterLines: [], roads: [], rail: [], parks: [], reserves: [], woods: [], admin: [], streets: [], places: [] };
  const dropped = { layer: 0, geometry: 0, offscreen: 0 };
  const x0 = -buf, y0 = -buf, x1 = W + buf, y1 = H + buf;

  const polygonsOf = (g) => {
    if (!g) return [];
    if (g.type === 'Polygon') return [g.coordinates];
    if (g.type === 'MultiPolygon') return g.coordinates;
    return [];
  };
  const linesOf = (g) => {
    if (!g) return [];
    if (g.type === 'LineString') return [g.coordinates];
    if (g.type === 'MultiLineString') return g.coordinates;
    if (g.type === 'Polygon') return [g.coordinates[0]];
    if (g.type === 'MultiPolygon') return g.coordinates.map(p => p[0]);
    return [];
  };

  for (const f of features) {
    const p = f.properties || {}, g = f.geometry;
    const layer = p.layer;
    const name = p.name || '';
    if (layer === 'place') {
      if (g && g.type === 'Point') {
        const q = project(g.coordinates, proj);
        if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) out.places.push([name, +q[0].toFixed(2), +q[1].toFixed(2), p.kind || 0]);
        else dropped.offscreen++;
      } else dropped.geometry++;
      continue;
    }
    if (!layer) { dropped.layer++; continue; }

    if (layer === 'waterway') {
      if (p.width == null) throw new Error('waterway 要素必须给出 width（格）：' + name);
      for (const line of linesOf(g)) {
        const pts = [];
        for (const c of line) { const q = project(c, proj); pts.push(q[0], q[1]); }
        for (const seg of clipLine(pts, x0, y0, x1, y1)) out.waterLines.push([idxOf(name), +p.width, enc(seg)]);
      }
      continue;
    }

    if (layer === 'street') {
      // 步行街道：与 roads 分开存放（geo.streets 用 ! 连接的几何串），决定 15 分钟步行接驳的可行网络
      for (const line of linesOf(g)) {
        const pts = [];
        for (const c of line) { const q = project(c, proj); pts.push(q[0], q[1]); }
        for (const seg of clipLine(pts, x0, y0, x1, y1)) out.streets.push(enc(seg));
      }
      continue;
    }

    if (layer === 'road' || layer === 'rail') {
      const flags = p.flags || 0;
      for (const line of linesOf(g)) {
        const pts = [];
        for (const c of line) { const q = project(c, proj); pts.push(q[0], q[1]); }
        for (const seg of clipLine(pts, x0, y0, x1, y1)) {
          if (layer === 'road') {
            if (![1, 2, 3, 4].includes(p.class)) throw new Error('road 要素必须给出 class 1–4：' + name);
            out.roads.push([idxOf(name), p.class, flags, enc(seg)]);
          } else {
            const row = [idxOf(name), flags, enc(seg)];
            if (p.year != null) row.push(p.year);
            out.rail.push(row);
          }
        }
      }
      continue;
    }

    const polys = polygonsOf(g);
    if (!polys.length) { dropped.geometry++; continue; }
    for (const poly of polys) {
      const rings = [];
      for (const ring of poly) {
        const pts = [];
        for (const c of ring) { const q = project(c, proj); pts.push(q[0], q[1]); }
        const clipped = clipRing(pts, x0, y0, x1, y1);
        if (clipped) rings.push(clipped);
      }
      if (!rings.length) { dropped.offscreen++; continue; }
      const encoded = rings.map((r, i) => (i === 0 ? 'o' : 'i') + enc(r));
      if (layer === 'water') out.water.push([idxOf(name)].concat(encoded));
      else if (layer === 'park') out.parks.push([idxOf(name)].concat(encoded));
      else if (layer === 'reserve') out.reserves.push([idxOf(name)].concat(encoded));
      else if (layer === 'wood') out.woods.push([idxOf(name)].concat(encoded));
      else if (layer === 'admin') out.admin.push([p.level == null ? 1 : p.level, idxOf(name)].concat(encoded));
      else { dropped.layer++; }
    }
  }

  // 输出成与现有产物一致的形态
  const body = {
    proj: out.proj,
    names: out.names,
    water: out.water.concat(out.waterLines),   // 多边形与折线共用 water：折线行为 [名称序号, 宽度, 串]
    roads: out.roads,
    rail: out.rail,
    parks: out.parks,
    reserves: out.reserves,
    woods: out.woods,
    admin: out.admin,
    streets: out.streets.join('!'),
    places: out.places,
  };
  const text = "'use strict';\n// 由 scripts/gen-geo.mjs 生成（输入：" + path.basename(opts.from) + "）。\n" +
    "// 坐标为游戏格（250 m），折线为增量编码，1/64 格精度。来源与许可须在地图文档中另行登记。\n" +
    "(function (CM) {\n  (CM.GEOS = CM.GEOS || {})." + opts.map + " = " +
    JSON.stringify(body, null, 0) + ";\n})(window.CM);\n";
  const outFile = opts.out || path.join(root, 'js', 'geo_' + opts.map + '.js');
  fs.writeFileSync(outFile, text);

  const counts = {
    water: body.water.length, roads: body.roads.length, streets: out.streets.length, rail: body.rail.length,
    parks: body.parks.length, reserves: body.reserves.length, woods: body.woods.length,
    admin: body.admin.length, places: body.places.length, names: body.names.length,
  };
  console.error('已写入 ' + outFile);
  console.error(JSON.stringify(counts));
  if (dropped.layer || dropped.geometry || dropped.offscreen) console.error('丢弃：未知图层 ' + dropped.layer + ' · 几何类型不符 ' + dropped.geometry + ' · 全在窗口外 ' + dropped.offscreen);
  if (!out.streets.length) console.error('警告：没有 street 图层（geo.streets 为空）。步行接驳将只依赖道路拓扑，15 分钟覆盖会明显偏小。');
  console.error('提醒：本工具不做 OSM 标签 → 图层/等级/flags 的分类，输入必须已标注；生成后务必跑 node scripts/validate-map.mjs。');
}

// ---------------------------------------------------------------- CLI

const args = process.argv.slice(2);
const opts = { root: DEFAULT_ROOT };
let mode = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--verify') { mode = 'verify'; continue; }
  if (a === '--stats') { mode = 'stats'; continue; }
  if (a === '--from') { mode = 'from'; opts.from = args[++i]; continue; }
  if (a === '--map') { opts.map = args[++i]; continue; }
  if (a === '--out') { opts.out = args[++i]; continue; }
  if (a === '--proj') { opts.proj = String(args[++i]).split(','); continue; }
  if (a === '--w') { opts.w = args[++i]; continue; }
  if (a === '--h') { opts.h = args[++i]; continue; }
  if (a === '--buffer') { opts.buffer = args[++i]; continue; }
  if (a === '--root') { opts.root = path.resolve(args[++i]); continue; }
  console.error('未知参数：' + a);
  process.exit(2);
}

if (!mode) {
  console.error('用法：node scripts/gen-geo.mjs --verify | --stats | --from <geojson> --map <id> --w <W> --h <H> [--proj lon0,lat0,kx,ky]');
  process.exit(2);
}
try {
  if (mode === 'verify') verify(opts.root);
  else if (mode === 'stats') stats(opts.root);
  else fromGeoJSON(opts.root, opts);
} catch (e) {
  console.error('失败：' + e.message);
  process.exit(1);
}
