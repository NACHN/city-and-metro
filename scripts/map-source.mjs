// 地图数据层：源码 ↔ source.json 的双向工具（编辑器第一步）
//
// 运行时格式不变：maps/<id>/source.json 是唯一真源，js/data_<id>.js 是生成的产物。
// 这样编辑器可以只面对 JSON，而游戏仍然零依赖、双击 index.html 即可运行。
//
//   node scripts/map-source.mjs export [--map gz] [--out maps]   现有六图 → maps/<id>/source.json
//   node scripts/map-source.mjs build <id> [--out <file>]         source.json → data_<id>.js（默认打印到终端）
//   node scripts/map-source.mjs build <id> --in-place             写入 js/data_<id>.js（会丢注释，慎用）
//   node scripts/map-source.mjs check [--map gz] [--verbose]      往返校验：source → 合并后的数据必须与原图逐字段相同
//
// 设计要点：
//   · cfg 只存「与基线（config.js 默认值 + econ 派生）的差异」，不复制整表；
//   · data.places 与地理数据的地名表完全相同时省略，编译时重新派生；
//   · 坐标一律存求值后的字面量（at()/anchor()/ll() 这些书写糖在导出时一次性化掉）；
//   · 虚构地图（青湾）的几何由代码生成，导出时标记 geo:"inline"，暂不支持从 source 重建。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const SCHEMA = 'city-metro/map-source@1';

// modes 不在这里：它由 config.js 的能力表（CM.MODES[*].needs）算出，是派生量，不再逐图存储
const META_FIELDS = ['id', 'name', 'title', 'sub', 'desc', 'region', 'tagline', 'difficulty', 'tags',
  'kind', 'scenario', 'mapVersion', 'facts', 'intro', 'features', 'highlights', 'cam'];
const EXTRA_META = ['tutorial'];   // 少数地图特有的布尔标记

// ---------------------------------------------------------------- 加载

function loadGame(root) {
  const logs = [];
  const sandbox = { console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) } };
  sandbox.window = sandbox;
  sandbox.window.CM = {};
  vm.createContext(sandbox);
  const load = (rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });

  load('js/util.js');
  load('js/config.js');
  load('js/manifest.js');
  // 基线：config.js 的默认值（maps.js 也是在这里取的快照）。必须在任何数据文件之前抓。
  const baseline = JSON.parse(JSON.stringify(sandbox.window.CM.CFG));
  load('js/geo.js');
  const manifest = sandbox.window.CM.MAP_MANIFEST;
  for (const e of manifest) if (e.geo) load('js/geo_' + e.geo + '.js');
  for (const e of manifest) load('js/data_' + e.data + '.js');
  load('js/maps.js');
  load('js/facility.js');
  return { CM: sandbox.window.CM, baseline, manifest, logs };
}

// ---------------------------------------------------------------- 通用

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

// 逐字段比较，返回第一处差异的路径（用于可读的诊断）
function firstDiff(a, b, at = '') {
  if (deepEqual(a, b)) return null;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return at + ' : ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b);
  if (Array.isArray(a) !== Array.isArray(b)) return at + ' : 类型不同（数组 / 对象）';
  if (Array.isArray(a)) {
    if (a.length !== b.length) return at + ' : 长度 ' + a.length + ' ≠ ' + b.length;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], at + '[' + i + ']'); if (d) return d; }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) { const d = firstDiff(a[k], b[k], at ? at + '.' + k : k); if (d) return d; }
  return null;
}

// 只保留与基线不同的顶层键，值整体写出。
// 注意：maps.js 用 Object.assign 浅合并地图配置，所以这里不能做嵌套 diff——
// 否则 START 只写 {y:1970}，运行时会丢掉 m / d / minute。
function diffAgainst(base, actual) {
  if (deepEqual(base, actual)) return undefined;
  const out = {};
  let any = false;
  for (const k of Object.keys(actual)) {
    if (!deepEqual(base[k], actual[k])) { out[k] = clone(actual[k]); any = true; }
  }
  return any ? out : undefined;
}

// ---------------------------------------------------------------- 导出

function exportMap(CM, BASE, map) {
  const meta = {};
  for (const k of META_FIELDS) if (map[k] !== undefined) meta[k] = clone(map[k]);
  for (const k of EXTRA_META) if (map[k] !== undefined) meta[k] = clone(map[k]);

  const inlineGeo = !Object.values(CM.GEOS || {}).includes(map.geo);
  const geo = inlineGeo ? 'inline' : Object.keys(CM.GEOS).find(k => CM.GEOS[k] === map.geo);

  const data = clone(map.data);
  // 地名表与地理数据完全一致时省略（编译时重新派生），五个真实城市都满足
  if (!inlineGeo && deepEqual(data.places, (map.geo.places || []).map(p => [p[0], p[1], p[2], p[3]]))) delete data.places;

  const src = { $schema: SCHEMA, meta: Object.assign({ geo }, meta), data };
  if (map.econ) src.econ = clone(map.econ);
  // cfg 只存与基线（config.js 默认值 + econ 派生）的差异，避免把整表复制进 source
  let base = clone(baseline);
  if (map.econ) Object.assign(base, clone(CM.deriveChoice(map.econ.devOffset || 0, map.econ.money || 1)));
  const diff = diffAgainst(base, map.cfg);
  if (diff) src.cfg = diff;
  return src;
}

// ---------------------------------------------------------------- 编译（与 maps.js 的合并顺序一致）

function compileToMerged(CM, baseline, src) {
  const meta = src.meta || {};
  let base = clone(baseline);
  if (src.econ) Object.assign(base, clone(CM.deriveChoice(src.econ.devOffset || 0, src.econ.money || 1)));
  const cfg = Object.assign(clone(base), clone(src.cfg || {}));   // 与 maps.js 的浅合并一致
  cfg.macro = meta.kind === 'real' ? (cfg.macro || 'auto') : null;   // 与 maps.js 相同

  const data = clone(src.data || {});
  if (!data.places) {
    const geo = CM.GEOS && CM.GEOS[meta.geo];
    if (!geo) throw new Error('编译 ' + meta.id + '：data.places 缺失，且 geo 不是已加载的真实地理数据');
    data.places = (geo.places || []).map(p => [p[0], p[1], p[2], p[3]]);
  }
  return { meta, econ: src.econ, cfg, data };
}

// ---------------------------------------------------------------- 生成 data_<id>.js

function emitModule(mapId, src) {
  const meta = src.meta;
  const head = [
    "'use strict';",
    '// 本文件由 maps/' + mapId + '/source.json 生成：node scripts/map-source.mjs build ' + mapId,
    '// 请修改 source.json 后重新生成；直接编辑本文件的内容会在下次生成时被覆盖。',
    '(function (CM) {',
    '  const data = ' + JSON.stringify(src.data, null, 2).replace(/\n/g, '\n  ') + ';',
    '',
  ].join('\n');
  // 地名表在 source 里省略（体积大且完全由地理数据派生），生成时补回，与手写文件一致
  const placesLine = (src.meta.geo && src.meta.geo !== 'inline' && src.data.places === undefined)
    ? '  if (!data.places) data.places = (CM.GEOS.' + src.meta.geo + '.places || []).map(function (p) { return [p[0], p[1], p[2], p[3]]; });\n'
    : '';
  const metaLines = [];
  for (const k of META_FIELDS) if (meta[k] !== undefined && k !== 'id') metaLines.push('    ' + k + ': ' + JSON.stringify(meta[k]) + ',');
  const geoExpr = meta.geo === 'inline' ? 'GEO' : 'CM.GEOS.' + meta.geo;
  const body = [
    placesLine,
    '  CM.registerMap({',
    '    id: ' + JSON.stringify(meta.id) + ',',
    ...metaLines,
    '    geo: ' + geoExpr + ',',
    '    data: data,',
    src.econ ? '    econ: ' + JSON.stringify(src.econ) + ',' : null,
    '    cfg: ' + JSON.stringify(src.cfg || {}, null, 2).replace(/\n/g, '\n    ') + ',',
    '  });',
    '})(window.CM);',
    '',
  ].filter(x => x !== null).join('\n');
  return head + body;
}

// ---------------------------------------------------------------- CLI

const args = process.argv.slice(2);
const cmd = args[0];
const flags = new Set(args.filter(a => a.startsWith('--')));
const valueOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const mapArg = valueOf('--map');
const rest = args.slice(1).filter(a => !a.startsWith('--') && a !== mapArg);

if (!['export', 'build', 'check'].includes(cmd)) {
  console.error('用法：node scripts/map-source.mjs export|build|check [--map <id>] [--out <path>] [--in-place] [--verbose]');
  process.exit(2);
}

const root = DEFAULT_ROOT;
const { CM, baseline } = loadGame(root);
// 只有 CFG_KEYS 这些键会随地图切换；基线也只取这一组，否则 diff 会带上 GAME_VERSION 等全局常量
const BASE = {};
for (const k of CM.CFG_KEYS || []) { const v = k === 'START' ? baseline.START : baseline[k]; if (v !== undefined) BASE[k] = clone(v); }
const ids = CM.MAP_ORDER.filter(id => !mapArg || id === mapArg);
if (!ids.length) { console.error('没有这张地图：' + mapArg); process.exit(1); }

if (cmd === 'export') {
  const outDir = valueOf('--out') || path.join(root, 'maps');
  for (const id of ids) {
    const src = exportMap(CM, BASE, CM.MAPS[id]);
    const dir = path.join(outDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'source.json');
    fs.writeFileSync(file, JSON.stringify(src, null, 2) + '\n');
    const kb = Math.round(fs.statSync(file).size / 1024);
    console.log('导出 ' + id.padEnd(9) + (kb + ' KB').padStart(7) + '  ' + path.relative(root, file) + (src.meta.geo === 'inline' ? '  （几何由代码生成，不可重建）' : ''));
  }
}

if (cmd === 'build') {
  const id = rest[0];
  if (!id) { console.error('build 需要地图 id'); process.exit(1); }
  const file = path.join(root, 'maps', id, 'source.json');
  if (!fs.existsSync(file)) { console.error('找不到 ' + path.relative(root, file) + '，先运行 export'); process.exit(1); }
  const src = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (src.meta.geo === 'inline') {
    console.error('跳过 ' + id + '：几何由 data_' + id + '.js 代码生成，暂不支持从 source 重建（保留原文件）');
    process.exit(0);
  }
  const code = emitModule(id, src);
  const out = valueOf('--out');
  if (flags.has('--in-place')) {
    const target = path.join(root, 'js', 'data_' + id + '.js');
    fs.writeFileSync(target, code);
    console.error('已写入 ' + path.relative(root, target) + '（原有注释已丢失，注意版本对比）');
  } else if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, code);
    console.error('已写入 ' + out);
  } else {
    process.stdout.write(code);
  }
}

if (cmd === 'check') {
  let failed = 0;
  console.log('往返校验：maps/<id>/source.json 编译后必须与 js/data_<id>.js 逐字段相同');
  for (const id of ids) {
    const map = CM.MAPS[id];
    const file = path.join(root, 'maps', id, 'source.json');
    if (!fs.existsSync(file)) { console.log('  ✗ ' + id.padEnd(9) + '缺少 ' + path.relative(root, file) + '（先运行 export）'); failed++; continue; }
    let src;
    try { src = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log('  ✗ ' + id.padEnd(9) + 'JSON 解析失败：' + e.message); failed++; continue; }
    if (src.meta && src.meta.id !== id) { console.log('  ✗ ' + id.padEnd(9) + 'source.meta.id 是 ' + src.meta.id + '，与目录名不一致'); failed++; continue; }
    let merged;
    try { merged = compileToMerged(CM, BASE, src); } catch (e) { console.log('  ✗ ' + id.padEnd(9) + e.message); failed++; continue; }

    const problems = [];
    // meta：逐字段与注册结果比对（geo 是资源名，不参与比较）
    for (const k of [...META_FIELDS, ...EXTRA_META]) {
      if (k === 'id') continue;
      const d = firstDiff(src.meta[k], map[k], k);
      if (d) problems.push('meta.' + d);
    }
    const cfgDiff = firstDiff(merged.cfg, map.cfg);
    if (cfgDiff) problems.push('cfg.' + cfgDiff);
    const dataDiff = firstDiff(merged.data, map.data);
    if (dataDiff) problems.push('data.' + dataDiff);

    if (problems.length) { failed++; console.log('  ✗ ' + id.padEnd(9) + problems.slice(0, 3).join(' | ')); }
    else {
      const kb = Math.round(fs.statSync(file).size / 1024);
      const fields = countFields(merged.data) + countFields(merged.cfg);
      console.log('  ✓ ' + id.padEnd(9) + (kb + ' KB').padStart(7) + '  ' + String(fields).padStart(6) + ' 个字段一致' +
        (src.meta.geo === 'inline' ? '  （几何由代码生成，已跳过重建）' : ''));
    }
  }
  console.log('');
  console.log(failed ? '失败：' + failed + ' 张地图的 source.json 与 data_*.js 不一致' : '通过：' + ids.length + ' 张地图的 source 与产物完全一致');
  process.exit(failed ? 1 : 0);
}

function countFields(v) {
  if (v == null || typeof v !== 'object') return 1;
  if (Array.isArray(v)) return v.reduce((a, x) => a + countFields(x), 0);
  return Object.keys(v).reduce((a, k) => a + countFields(v[k]), 0);
}
