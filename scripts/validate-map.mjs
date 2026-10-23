// 《城市与地铁》地图数据校验器
//
// 目的：把《地图设计指南》里靠肉眼执行的数据约束变成可运行的检查，让新地图的错误在构建期暴露，
// 而不是在玩家手里表现成「这张图客流怎么莫名偏低」「这个站为什么点不进去」。
//
// 用法：
//   node scripts/validate-map.mjs                 校验仓库源码
//   node scripts/validate-map.mjs dist            校验构建产物
//   node scripts/validate-map.mjs --map hk        只校验一张图
//   node scripts/validate-map.mjs --strict        警告也视为失败
//   node scripts/validate-map.mjs --json          机器可读输出
//
// 退出码：0 通过；1 有错误（--strict 时警告也算）
//
// 检查分四组：元数据与配置、场景数据、地理数据、存档指纹。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');

// 地理坐标允许越出地图窗口的格数：实测五图最多约 4.5 格（≈1.1 km，边缘缓冲），
// 超过 WARN 提示、超过 ERROR 视为投影或裁剪错误。
const BOUND_WARN = 8;
const BOUND_ERROR = 24;

const REQUIRED_META = ['id', 'name', 'title', 'sub', 'desc', 'region', 'tagline', 'intro', 'kind',
  'scenario', 'mapVersion', 'difficulty', 'tags', 'modes', 'facts', 'features', 'highlights', 'cam', 'data', 'geo', 'cfg'];
const KINDS = ['real', 'fictional'];
const MODES = ['challenge', 'free'];
const TRIP_KEYS = ['hw', 'sc', 'sh', 'md', 'lz', 'hb'];
const LAYERS = ['water', 'parks', 'reserves', 'woods', 'admin', 'roads', 'rail'];

// ---------------------------------------------------------------- 加载

function loadCM(root) {
  const logs = [];
  const sandbox = { console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) } };
  sandbox.window = sandbox;
  sandbox.window.CM = {};
  vm.createContext(sandbox);

  const load = (rel) => {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) throw new Error('缺少资源 ' + rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: rel });
  };

  load('js/util.js');
  load('js/config.js');
  load('js/manifest.js');
  load('js/icons.js');
  load('js/geo.js');

  const manifest = sandbox.window.CM.MAP_MANIFEST;
  if (!Array.isArray(manifest) || !manifest.length) throw new Error('js/manifest.js 没有声明 CM.MAP_MANIFEST');
  for (const e of manifest) if (e.geo) load('js/geo_' + e.geo + '.js');
  for (const e of manifest) load('js/data_' + e.data + '.js');
  load('js/maps.js');
  load('js/facility.js');
  load('js/economy.js');   // 任务类型注册表（CM.Tasks.TYPES）

  return { CM: sandbox.window.CM, manifest, logs };
}

// ---------------------------------------------------------------- 工具

const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// 数值或 [年份, 值] 曲线（设施规模、吸引比例都用这种形式，由 U.interp 读取）
function checkCurve(v, label, id, rep, max) {
  if (isNum(v)) {
    if (v < 0 || (max != null && v > max)) rep.error(id, label + ' 取值越界：' + v);
    return;
  }
  if (!Array.isArray(v) || !v.length) { rep.error(id, label + ' 必须是数字或 [年份, 值] 曲线'); return; }
  let last = -Infinity;
  for (const [i, p] of v.entries()) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) { rep.error(id, label + ' 第 ' + i + ' 点必须是 [年份, 值]'); continue; }
    if (p[0] <= last) rep.error(id, label + ' 的年份必须递增（第 ' + i + ' 点）');
    last = p[0];
    if (p[1] < 0 || (max != null && p[1] > max)) rep.error(id, label + ' 第 ' + i + ' 点取值越界：' + p[1]);
  }
}

function makeReporter() {  const errors = [], warnings = [];
  return {
    errors, warnings,
    error(map, msg) { errors.push({ map, msg }); },
    warn(map, msg) { warnings.push({ map, msg }); },
  };
}

function checkMeta(CM, m, rep) {
  const id = m.id;
  for (const k of REQUIRED_META) if (m[k] == null) rep.error(id, '缺少元数据字段 ' + k);
  if (m.kind && !KINDS.includes(m.kind)) rep.error(id, 'kind 必须是 ' + KINDS.join(' / ') + '，实际 ' + m.kind);
  if (!Array.isArray(m.modes) || !m.modes.length) rep.error(id, 'modes 不能为空');
  else for (const x of m.modes) if (!MODES.includes(x)) rep.error(id, '未知模式 ' + x);
  if (!isInt(m.difficulty) || m.difficulty < 1 || m.difficulty > 4) rep.error(id, 'difficulty 必须是 1–4 的整数，实际 ' + m.difficulty);
  if (!isInt(m.mapVersion) || m.mapVersion < 1) rep.error(id, 'mapVersion 必须是正整数');
  if (typeof m.scenario !== 'string' || !m.scenario) rep.error(id, 'scenario 不能为空');
  if (!Array.isArray(m.tags) || m.tags.some(t => typeof t !== 'string')) rep.error(id, 'tags 必须是字符串数组');
  if (!Array.isArray(m.facts) || !m.facts.length) rep.error(id, 'facts 不能为空');
  else for (const f of m.facts) if (!Array.isArray(f) || f.length !== 2 || typeof f[0] !== 'string') rep.error(id, 'facts 必须是 [标签, 值] 二元组');
  if (!Array.isArray(m.features)) rep.error(id, 'features 必须是数组');
  else for (const f of m.features) {
    if (!Array.isArray(f) || f.length !== 3) { rep.error(id, 'features 必须是 [图标, 标题, 说明] 三元组'); continue; }
    if (!CM.ICON || !CM.ICON[f[0]]) rep.warn(id, '特色卡图标 ' + f[0] + ' 在 icons.js 中不存在');
  }
  if (!Array.isArray(m.highlights)) rep.error(id, 'highlights 必须是数组');
  else {
    let last = -Infinity;
    for (const h of m.highlights) {
      if (!Array.isArray(h) || h.length !== 2 || !isInt(h[0])) { rep.error(id, 'highlights 必须是 [年份, 文字] 二元组'); continue; }
      if (h[0] < last) rep.warn(id, 'highlights 年份未按升序排列（' + last + ' → ' + h[0] + '）');
      last = h[0];
    }
  }
  if (m.kind !== 'fictional' && !CM.REGION_STYLE[m.region]) rep.warn(id, '地区「' + m.region + '」不在 CM.REGION_STYLE 中，建筑与车型会回退为内地风格');
  const clim = CM.mapManifest(id);
  if (!clim) rep.error(id, '地图未在 CM.MAP_MANIFEST 中登记');
  else if (!['cold', 'mild'].includes(clim.climate)) rep.error(id, '清单中的 climate 必须是 cold / mild，实际 ' + clim.climate);
}

function checkCfg(CM, m, rep) {
  const id = m.id, cfg = m.cfg || {}, CFG = CM.CFG;
  for (const k of CM.CFG_KEYS || []) if (cfg[k] === undefined) rep.error(id, '配置缺少键 ' + k + '（未覆盖时会静默继承基线）');
  const W = cfg.W, H = cfg.H;
  if (!isInt(W) || W <= 0 || W % CFG.ZONE !== 0) rep.error(id, 'W 必须是正数且能被交通小区边长 ' + CFG.ZONE + ' 整除，实际 ' + W);
  if (!isInt(H) || H <= 0 || H % CFG.ZONE !== 0) rep.error(id, 'H 必须是正数且能被 ' + CFG.ZONE + ' 整除，实际 ' + H);
  const S = cfg.START || {};
  if (!isInt(S.y) || S.y < 1800 || S.y > 2200) rep.error(id, 'START.y 不合理：' + S.y);
  if (!isInt(S.m) || S.m < 1 || S.m > 12) rep.error(id, 'START.m 必须是 1–12');
  if (!isInt(S.d) || S.d < 1 || (isInt(S.y) && isInt(S.m) && S.d > CM.U.daysInMonth(S.y, S.m))) rep.error(id, 'START.d 超出当月天数');
  if (!isNum(S.minute) || S.minute < 0 || S.minute >= 1440) rep.error(id, 'START.minute 必须是 0–1439');
  const fr = cfg.fareRange || {}, fd = cfg.fareDefault || {};
  if (!isNum(fd.flat)) rep.error(id, 'fareDefault.flat 必须是数字');
  else if (isNum(fr.min) && isNum(fr.max) && (fd.flat < fr.min || fd.flat > fr.max)) rep.error(id, '默认票价 ' + fd.flat + ' 不在票价范围 ' + fr.min + '–' + fr.max + ' 内');
  if (!cfg.money || !cfg.money.code || !cfg.money.unit) rep.error(id, 'money 缺少 code / unit');
  const pc = (cfg.growth && cfg.growth.popCurve) || [];
  if (pc.length < 2) rep.error(id, 'growth.popCurve 至少需要两个点');
  else for (let i = 1; i < pc.length; i++) {
    if (!isNum(pc[i][1]) || pc[i][1] <= 0) rep.error(id, 'popCurve 第 ' + i + ' 个人口值无效');
    if (pc[i][0] <= pc[i - 1][0]) rep.error(id, 'popCurve 年份必须严格递增（第 ' + i + ' 点）');
  }
  if (m.kind === 'real' && !cfg.macro) rep.error(id, '真实城市必须启用 macro（城市经济）');
  if (m.kind === 'fictional' && cfg.macro) rep.error(id, '虚构地图不应启用 macro');
}

function checkData(CM, m, rep) {
  const id = m.id, d = m.data || {}, cfg = m.cfg || {};
  const W = cfg.W, H = cfg.H, Z = CM.CFG.ZONE;
  const inBounds = (x, y, tol) => isNum(x) && isNum(y) && x >= -tol && y >= -tol && x <= W + tol && y <= H + tol;

  if (typeof d.city !== 'string' || !d.city) rep.error(id, 'data.city 不能为空');
  const plans = d.plans || {};
  if (!plans.res) rep.error(id, 'plans 缺少 res（区域未声明 plan 时会用到）');
  for (const [name, recipe] of Object.entries(plans)) {
    const sum = Object.values(recipe).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.02) rep.warn(id, 'plans.' + name + ' 各类占比合计 ' + sum.toFixed(3) + '，应为 1');
  }

  // 区域
  const regions = d.regions || [];
  if (!regions.length) rep.error(id, 'regions 不能为空');
  const rid = new Set();
  for (const r of regions) {
    if (!r.id) { rep.error(id, '区域缺少 id'); continue; }
    if (rid.has(r.id)) rep.error(id, '区域 id 重复：' + r.id);
    rid.add(r.id);
    if (r.open !== null && r.open !== undefined && !isNum(r.open)) rep.error(id, '区域 ' + r.id + ' 的 open 必须是年份或 null');
    if (r.plan && !plans[r.plan]) rep.error(id, '区域 ' + r.id + ' 引用了不存在的用地配方 ' + r.plan);
    if (r.pop != null && !isNum(r.pop)) rep.error(id, '区域 ' + r.id + ' 的 pop 不是数字');
  }

  // 职住中心
  for (const [i, c] of (d.centers || []).entries()) {
    if (!inBounds(c.x, c.y, 4 * Z)) rep.error(id, 'centers[' + i + '] 坐标越界：' + c.x + ',' + c.y);
    if (c.pop != null && (!isNum(c.pop) || c.pop < 0)) rep.error(id, 'centers[' + i + '] 的 pop 必须是非负数');
    if (c.jobs != null && (!isNum(c.jobs) || c.jobs < 0)) rep.error(id, 'centers[' + i + '] 的 jobs 必须是非负数');
    if (c.r != null && (!isNum(c.r) || c.r <= 0)) rep.error(id, 'centers[' + i + '] 的 r 必须大于 0');
  }

  // 地标
  const lms = d.landmarks || [];
  const lmId = new Set();
  for (const [i, l] of lms.entries()) {
    if (!l.id) { rep.error(id, 'landmarks[' + i + '] 缺少 id'); continue; }
    if (lmId.has(l.id)) rep.error(id, '地标 id 重复：' + l.id);
    lmId.add(l.id);
    if (!inBounds(l.x, l.y, 4)) rep.error(id, '地标 ' + l.id + ' 坐标越界：' + l.x + ',' + l.y);
    if (!isNum(l.year)) rep.error(id, '地标 ' + l.id + ' 缺少落成年份 year');
    for (const k of ['w', 'd', 'h']) if (l[k] != null && (!isNum(l[k]) || l[k] <= 0)) rep.error(id, '地标 ' + l.id + ' 的 ' + k + ' 必须大于 0');
    // 专属造型：写错会安静回退成普通楼宇，所以按错误处理
    if (l.style) {
      const ST = CM.LANDMARK_STYLES || {};
      const st = ST[l.style];
      if (!st) rep.error(id, '地标 ' + l.id + ' 的造型 ' + l.style + ' 未登记（可选：' + Object.keys(ST).join('/') + '），会退回默认楼宇');
      else if (l.kind && st.kinds && !st.kinds.includes(l.kind)) rep.error(id, '地标 ' + l.id + ' 的造型 ' + l.style + ' 只适用于 ' + st.kinds.join('/') + '，当前 kind 是 ' + l.kind);
    }
    if (l.rot != null && !isNum(l.rot)) rep.error(id, '地标 ' + l.id + ' 的 rot 必须是数字（度）');
  }

  // 重要设施
  const TYPES = CM.Fac && CM.Fac.TYPES ? CM.Fac.TYPES : {};
  const fids = new Set();
  for (const [i, f] of (d.facilities || []).entries()) {
    const tag = f.id || ('#' + i);
    if (f.id && fids.has(f.id)) rep.error(id, '设施 id 重复：' + f.id);
    if (f.id) fids.add(f.id);
    if (!TYPES[f.t]) { rep.error(id, '设施 ' + tag + ' 的类型 ' + f.t + ' 不存在（可选：' + Object.keys(TYPES).join('/') + '）'); continue; }
    if (!f.n) rep.error(id, '设施 ' + tag + ' 缺少名称 n');
    if (f.lm && f.at) rep.error(id, '设施 ' + tag + ' 同时声明了 lm 与 at');
    if (f.lm) {
      const k = lms.findIndex(l => l.id === f.lm);
      if (k < 0) rep.error(id, '设施 ' + tag + ' 引用了不存在的地标 ' + f.lm + '（该设施会被静默丢弃）');
    } else if (f.at) {
      if (!inBounds(f.at[0], f.at[1], 1)) rep.error(id, '设施 ' + tag + ' 坐标越界：' + f.at.join(','));
    } else rep.error(id, '设施 ' + tag + ' 既没有 lm 也没有 at');
    if (f.r != null && (!isNum(f.r) || f.r <= 0)) rep.error(id, '设施 ' + tag + ' 的 r 必须大于 0');
    if (f.pax != null) checkCurve(f.pax, '设施 ' + tag + ' 的 pax', id, rep);
    if (f.p) for (const k of Object.keys(f.p)) if (!TRIP_KEYS.includes(k)) rep.error(id, '设施 ' + tag + ' 的出行目的 ' + k + ' 不存在（可选：' + TRIP_KEYS.join('/') + '）');
    if (f.y1 != null) {
      const y1 = Array.isArray(f.y1) ? f.y1[0] : f.y1;
      if (!isNum(y1)) rep.error(id, '设施 ' + tag + ' 的 y1 必须是年份或 [年, 月]');
    }
  }

  // 历史事件与任务
  let lastYm = -Infinity;
  for (const [i, e] of (d.events || []).entries()) {
    if (!isNum(e.y)) { rep.error(id, 'events[' + i + '] 缺少年份 y'); continue; }
    if (e.m != null && (!isInt(e.m) || e.m < 1 || e.m > 12)) rep.error(id, 'events[' + i + '] 的月份无效：' + e.m);
    const ym = e.y * 12 + ((e.m || 1) - 1);
    if (ym < lastYm) rep.warn(id, 'events 未按时间升序（第 ' + i + ' 条）');
    lastYm = ym;
  }
  for (const [i, t] of (d.histTasks || []).entries()) {
    const tag = t.id || ('#' + i);
    if (!Array.isArray(t.appear) || !Array.isArray(t.deadline)) { rep.error(id, '任务 ' + tag + ' 需要 appear / deadline 的 [年, 月]'); continue; }
    if (t.deadline[0] * 12 + t.deadline[1] <= t.appear[0] * 12 + t.appear[1]) rep.error(id, '任务 ' + tag + ' 的截止时间不晚于出现时间');
    if (!t.title) rep.error(id, '任务 ' + tag + ' 缺少 title');
    const TT = CM.Tasks && CM.Tasks.TYPES ? CM.Tasks.TYPES : null;
    if (!TT) rep.warn(id, '任务类型注册表不可用（未加载 economy.js），跳过类型检查');
    else {
      const H = TT[t.type];
      if (!H) rep.error(id, '任务 ' + tag + ' 的类型 ' + t.type + ' 未登记（可选：' + Object.keys(TT).join('/') + '）');
      else for (const pr of H.params || []) {
        const [field, desc, optional] = pr;
        if (!optional && t[field] === undefined) rep.error(id, '任务 ' + tag + '（' + H.name + '）缺少参数 ' + field + '：' + desc);
      }
    }
    if (!isNum(t.reward) || t.reward < 0) rep.error(id, '任务 ' + tag + ' 的 reward 必须是非负数');
    for (const [k, a] of (t.anchors || []).entries()) {
      if (!inBounds(a.x, a.y, 6)) rep.error(id, '任务 ' + tag + ' 的锚点 ' + (a.name || k) + ' 坐标越界：' + a.x + ',' + a.y);
      if (!isNum(a.r) || a.r <= 0) rep.error(id, '任务 ' + tag + ' 的锚点 ' + (a.name || k) + ' 半径必须大于 0');
    }
  }

  // 开局既有线网
  const IN = d.initialNetwork;
  if (IN) {
    for (const [i, L] of (IN.lines || []).entries()) {
      const st = L.stations || [];
      if (st.length < 2) rep.error(id, 'initialNetwork.lines[' + i + '] 至少需要 2 座车站');
      for (const s of st) if (!inBounds(s[1], s[2], 2)) rep.error(id, 'initialNetwork 车站 ' + s[0] + ' 坐标越界：' + s[1] + ',' + s[2]);
    }
  }
}

function checkGeo(CM, m, rep) {
  const id = m.id, G = m.geo, cfg = m.cfg;
  const W = cfg.W, H = cfg.H;
  if (!G || typeof G !== 'object') { rep.error(id, '缺少地理数据 geo'); return; }
  const proj = G.proj || {};
  if (m.kind !== 'fictional') {
    // 虚构地图（青湾）由数据文件生成几何，没有经纬度投影；真实城市必须有可复现的投影参数
    for (const k of ['lon0', 'lat0', 'kx', 'ky']) if (!isNum(proj[k])) rep.error(id, 'geo.proj.' + k + ' 必须是数字');
    if (!(proj.kx > 0) || !(proj.ky > 0)) rep.error(id, 'geo.proj.kx / ky 必须大于 0');
  }
  if (!Array.isArray(G.names) || !G.names.length) rep.error(id, 'geo.names 不能为空');

  const names = G.names || [];
  const dec = CM.Geo.dec;
  const stat = { points: 0, maxOver: 0, worst: '' };
  const scan = (p, layer) => {
    stat.points += p.length / 2;
    for (let k = 0; k < p.length; k += 2) {
      const x = p[k], y = p[k + 1];
      const over = Math.max(0 - x, x - W, 0 - y, y - H);
      if (over > stat.maxOver) { stat.maxOver = over; stat.worst = layer + ' @' + x.toFixed(1) + ',' + y.toFixed(1); }
    }
  };
  const nameIdx = (row, label, i) => {
    if (!isInt(row[0]) || row[0] < 0 || row[0] >= names.length) {
      rep.error(id, label + '[' + i + '] 的名称序号越界：' + row[0] + '（names 共 ' + names.length + ' 条）');
      return false;
    }
    return true;
  };

  for (let i = 0; i < (G.water || []).length; i++) {
    const row = G.water[i];
    if (!nameIdx(row, 'water', i)) continue;
    if (typeof row[1] === 'number') {
      if (!(row[1] > 0)) rep.error(id, 'water[' + i + '] 的河宽必须大于 0');
      if (typeof row[2] === 'string') scan(dec(row[2]), 'water');
    } else for (let k = 1; k < row.length; k++) if (typeof row[k] === 'string') scan(dec(row[k], 1), 'water');
  }
  for (const key of ['parks', 'reserves', 'woods']) {
    for (let i = 0; i < (G[key] || []).length; i++) {
      const row = G[key][i];
      if (!nameIdx(row, key, i)) continue;
      for (let k = 1; k < row.length; k++) if (typeof row[k] === 'string') scan(dec(row[k], 1), key);
    }
  }
  for (let i = 0; i < (G.admin || []).length; i++) {
    const row = G.admin[i];
    if (!isNum(row[0])) rep.error(id, 'admin[' + i + '] 缺少层级');
    if (!nameIdx(row.slice(1), 'admin', i)) continue;
    for (let k = 2; k < row.length; k++) if (typeof row[k] === 'string') scan(dec(row[k], 1), 'admin');
  }
  for (let i = 0; i < (G.roads || []).length; i++) {
    const row = G.roads[i];
    if (!nameIdx(row, 'roads', i)) continue;
    if (![1, 2, 3, 4].includes(row[1])) rep.error(id, 'roads[' + i + '] 的等级必须是 1–4，实际 ' + row[1]);
    if (!isInt(row[2]) || row[2] < 0 || row[2] > 511) rep.error(id, 'roads[' + i + '] 的 flags 无效：' + row[2]);
    if (typeof row[3] !== 'string') rep.error(id, 'roads[' + i + '] 缺少几何串');
    else scan(dec(row[3]), 'roads');
  }
  for (let i = 0; i < (G.rail || []).length; i++) {
    const row = G.rail[i];
    if (!nameIdx(row, 'rail', i)) continue;
    if (!isInt(row[1]) || row[1] < 0 || row[1] > 511) rep.error(id, 'rail[' + i + '] 的 flags 无效：' + row[1]);
    if (typeof row[2] !== 'string') rep.error(id, 'rail[' + i + '] 缺少几何串');
    else scan(dec(row[2]), 'rail');
    if (row[3] != null && !isNum(row[3])) rep.error(id, 'rail[' + i + '] 的开通年份必须是数字');
  }
  const streets = typeof G.streets === 'string' ? G.streets.split('!').filter(Boolean) : [];
  if (G.streets != null && typeof G.streets !== 'string') rep.error(id, 'geo.streets 必须是字符串');
  for (const s of streets) scan(dec(s), 'streets');
  for (const [i, p] of (G.places || []).entries()) {
    if (!Array.isArray(p) || p.length < 3 || typeof p[0] !== 'string') { rep.error(id, 'places[' + i + '] 必须是 [名称, x, y, …]'); continue; }
    if (!isNum(p[1]) || !isNum(p[2])) rep.error(id, 'places[' + i + '] 坐标不是数字');
    else if (p[1] < -BOUND_ERROR || p[2] < -BOUND_ERROR || p[1] > W + BOUND_ERROR || p[2] > H + BOUND_ERROR) rep.warn(id, '地名 ' + p[0] + ' 在窗口外：' + p[1] + ',' + p[2]);
  }

  if (stat.maxOver > BOUND_ERROR) rep.error(id, '地理坐标越界 ' + stat.maxOver.toFixed(1) + ' 格（' + stat.worst + '），疑似投影或裁剪错误');
  else if (stat.maxOver > BOUND_WARN) rep.warn(id, '地理坐标越界 ' + stat.maxOver.toFixed(1) + ' 格（' + stat.worst + '），超出边缘缓冲');
  if (!stat.points) rep.error(id, '地理数据没有任何折线');
  for (const key of LAYERS) if (!Array.isArray(G[key]) && key !== 'roads' && key !== 'rail') rep.warn(id, '缺少地理图层 ' + key + '（按空集合处理）');
  return stat;
}

function checkFp(CM, m, rep) {
  const G = m.geo || {}, d = m.data || {}, cfg = m.cfg || {};
  // 与 maps.js 完全相同的公式；用于锁定「存档识别」口径，公式一改这里立刻报错
  const fp = CM.U.fnv([m.id, cfg.W, cfg.H, (G.water || []).length, (G.roads || []).length, (G.names || []).length, (d.regions || []).map(r => r.id).join(',')].join('|'));
  if (fp !== m.fp) rep.error(m.id, '地图指纹与公式不一致：期望 ' + fp + '，实际 ' + m.fp + '（改动指纹公式会破坏旧存档识别）');
  if (!/^[0-9a-f]{8}$/.test(m.fp || '')) rep.error(m.id, '地图指纹格式应为 8 位十六进制');
}

// ---------------------------------------------------------------- 主流程

export async function validateMaps(root = DEFAULT_ROOT, opts = {}) {
  const rep = makeReporter();
  const { CM, manifest } = loadCM(root);
  const maps = CM.MAPS || {};
  const only = opts.map ? String(opts.map) : null;
  const stats = {}, checked = [];

  for (const e of manifest) if (!maps[e.id]) rep.error(e.id, '已在 MAP_MANIFEST 声明，但数据文件没有调用 CM.registerMap');
  for (const id of Object.keys(maps)) if (!CM.mapManifest(id)) rep.error(id, '已注册但未在 CM.MAP_MANIFEST 中登记（无法参与排序与气候判定）');
  if (!CM.MAP_ORDER || !CM.MAP_ORDER.length) rep.error('*', 'CM.MAP_ORDER 为空');

  for (const id of (CM.MAP_ORDER || [])) {
    if (only && id !== only) continue;
    const m = maps[id];
    if (!m) continue;
    checked.push(id);
    checkMeta(CM, m, rep);
    checkCfg(CM, m, rep);
    checkData(CM, m, rep);
    stats[id] = checkGeo(CM, m, rep);
    checkFp(CM, m, rep);
  }
  if (only && !checked.length) rep.error(only, '没有这张地图（可用：' + (CM.MAP_ORDER || []).join(' / ') + '）');

  return { errors: rep.errors, warnings: rep.warnings, stats, maps: CM.MAP_ORDER || [], checked };
}

// ---------------------------------------------------------------- CLI

function isMain() {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { return false; }
}

if (isMain()) {
  const args = process.argv.slice(2);
  let mapArg = null, wantJson = false, strict = false;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--map') { mapArg = args[++i]; continue; }
    if (a === '--json') { wantJson = true; continue; }
    if (a === '--strict') { strict = true; continue; }
    if (a.startsWith('--')) { console.error('未知参数：' + a); process.exit(2); }
    rest.push(a);
  }
  const root = path.resolve(rest[0] || DEFAULT_ROOT);

  let report;
  try {
    report = await validateMaps(root, { map: mapArg });
  } catch (e) {
    console.error('校验无法开始：' + e.message);
    process.exit(1);
  }

  if (wantJson) {
    console.log(JSON.stringify({ root, errors: report.errors, warnings: report.warnings }, null, 1));
  } else {
    console.log('地图数据校验 · ' + root);
    for (const id of report.checked) {
      const errs = report.errors.filter(x => x.map === id);
      const warns = report.warnings.filter(x => x.map === id);
      const st = report.stats[id];
      const mark = errs.length ? '✗' : '✓';
      const detail = st ? '  几何 ' + Math.round(st.points).toLocaleString('en-US') + ' 点，最大越界 ' + st.maxOver.toFixed(1) + ' 格' : '';
      console.log('  ' + mark + ' ' + id.padEnd(9) + (errs.length ? errs.length + ' 错误' : '通过') + (warns.length ? '，' + warns.length + ' 警告' : '') + detail);
      for (const e of errs) console.log('      error  ' + e.msg);
      for (const w of warns) console.log('      warn   ' + w.msg);
    }
    const other = report.errors.filter(x => !report.checked.includes(x.map));
    for (const e of other) console.log('  ✗ ' + e.map + ': ' + e.msg);
    const bad = report.checked.filter(id => report.errors.some(x => x.map === id)).length;
    const globalErrs = report.errors.filter(x => !report.checked.includes(x.map)).length;
    console.log('');
    console.log('结果：' + (report.checked.length - bad) + '/' + report.checked.length + ' 张地图通过，' +
      report.errors.length + ' 个错误，' + report.warnings.length + ' 个警告' +
      (globalErrs ? '（其中 ' + globalErrs + ' 个跨图错误）' : ''));
  }

  const failed = report.errors.length > 0 || (strict && report.warnings.length > 0);
  process.exit(failed ? 1 : 0);
}
