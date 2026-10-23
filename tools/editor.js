'use strict';
/* 地图编辑器 · 地图优先布局
 *
 * 设计：全屏画布是主界面；顶栏、左侧图层坞、右侧检查器、底部工具条都浮在地图上，
 * 与游戏本体的 HUD 同构。元数据、配置、区域、剧情、经济等非空间设定收进「数据」抽屉。
 * 依赖同仓库的 js/ 模块（数据字典唯一来源），不复制 schema。
 */
(function () {
  var CM = window.CM;

  // ============================================================ 启动检查

  function bootError(html) {
    var box = document.getElementById('bootErr');
    if (!box) {
      box = document.createElement('div');
      box.id = 'bootErr';
      document.body.appendChild(box);
    }
    box.innerHTML = html;
    box.classList.add('on');
  }

  if (!CM || !CM.U || !CM.CFG || !CM.Tasks || !CM.Fac || !CM.LANDMARK_STYLES || !CM.MAP_CFG_KEYS || !CM.icon) {
    bootError('<div class="box"><h2>无法加载游戏模块</h2>' +
      '<p>本页依赖同仓库的 <code>../js/util.js</code>、<code>config.js</code>、<code>manifest.js</code>、' +
      '<code>facility.js</code>、<code>economy.js</code>、<code>geo.js</code> 与 <code>icons.js</code>。</p>' +
      '<p>请把 <code>tools/editor.html</code> 与 <code>tools/editor.js</code> 留在仓库里打开：</p><ol>' +
      '<li>在仓库根目录运行 <code>python -m http.server 8000</code>，访问 <code>http://localhost:8000/tools/editor.html</code>；</li>' +
      '<li>或直接双击 <code>tools/editor.html</code>（用「打开本地文件」读取 source.json）。</li></ol>' +
      '<p>单独拷走这一个 HTML 会读不到旁边的 <code>js/</code> 目录。</p></div>');
    return;
  }

  // ============================================================ 常量

  var MAP_CARDS = [
    { id: 'tutorial', name: '青湾', desc: '虚构教程 · 2000 年 · 零地铁开局', tag: '教程' },
    { id: 'gz', name: '广州', desc: '真实地理 · 1990 年 · 珠江两岸', tag: '真实' },
    { id: 'hz', name: '杭州', desc: '真实地理 · 2000 年 · 西湖与钱塘江', tag: '真实' },
    { id: 'hk', name: '香港', desc: '真实地理 · 1970 年 · 山地与填海', tag: '真实' },
    { id: 'tp', name: '台北', desc: '真实地理 · 1990 年 · 盆地与三河', tag: '真实' },
    { id: 'tk', name: '东京', desc: '真实地理 · 1950 年 · 银座线与填海', tag: '真实' }
  ];

  var ENTITY = {
    regions: { label: '区域', one: '区域', icon: 'layers', color: 'var(--c-regions)' },
    centers: { label: '职住中心', one: '中心', icon: 'people', color: 'var(--c-centers)' },
    landmarks: { label: '地标', one: '地标', icon: 'pin', color: 'var(--c-landmarks)' },
    facilities: { label: '重要设施', one: '设施', icon: 'lyFac', color: 'var(--c-facilities)' },
    anchors: { label: '任务锚点', one: '锚点', icon: 'target', color: 'var(--c-anchors)' },
    tasks: { label: '历史任务', one: '任务', icon: 'flag', color: 'var(--c-anchors)' },
    events: { label: '历史事件', one: '事件', icon: 'clock', color: 'var(--c-anchors)' }
  };

  var TRIP_KEYS = (CM.CFG.trips && CM.CFG.trips.keys) || ['hw', 'sc', 'sh', 'md', 'lz', 'hb'];
  var FAC_TYPES = Object.keys(CM.Fac.TYPES);
  var TASK_TYPES = Object.keys(CM.Tasks.TYPES);
  var LM_STYLES = Object.keys(CM.LANDMARK_STYLES || {});
  var REGIONS = Object.keys(CM.REGION_STYLE).concat(['虚构']);
  var CFG_KEYS = CM.MAP_CFG_KEYS;

  var DATA_TABS = [
    { id: 'meta', label: '元数据', icon: 'map' },
    { id: 'cfg', label: '世界设定', icon: 'gear' },
    { id: 'regions', label: '区域', icon: 'layers', count: function (d) { return (d.regions || []).length; } },
    { id: 'tasks', label: '任务', icon: 'flag', count: function (d) { return (d.histTasks || []).length; } },
    { id: 'events', label: '事件', icon: 'clock', count: function (d) { return (d.events || []).length; } },
    { id: 'macro', label: '经济', icon: 'chart' },
    { id: 'rest', label: '其他', icon: 'folder' },
    { id: 'raw', label: 'JSON', icon: 'report' }
  ];

  // ============================================================ 状态

  var S = {
    src: null, name: '', dir: '', handle: null, issues: [],
    sel: null, hover: null, regionSel: null, taskFocus: null,
    year: null, yearMin: 1900, yearMax: 2030, yearPlay: 0,
    tool: 'select', layers: { regions: true, centers: true, landmarks: true, facilities: true, anchors: true },
    sheet: { open: false, tab: 'meta', regionIdx: 0, taskIdx: 0 },
    browser: { open: false, tab: 'all', q: '' },
    pop: null
  };

  var H = { stack: [], idx: -1, timer: 0, saved: '', suspend: false, busy: false };

  // ============================================================ 通用工具

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') n[k] = !!v;
      else n.setAttribute(k, v);
    }
    for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
    return n;
  }
  function append(n, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(n, x); }); return; }
    n.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(n) { if (n) n.innerHTML = ''; return n; }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isInt(v) { return Number.isInteger(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function pretty(v) { return v === undefined ? '' : JSON.stringify(v, null, 2); }
  function short(v) {
    if (v === undefined) return '—';
    var s = JSON.stringify(v);
    if (!s) s = String(v);
    return s.length > 46 ? s.slice(0, 44) + '…' : s;
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function debounce(fn, ms) {
    var t = 0;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }
  function icon(name, size) {
    var el = CM.icon ? CM.icon(name) : h('span', { class: 'ico' });
    if (size) { el.style.width = size + 'px'; el.style.height = size + 'px'; }
    return el;
  }
  function timeNow() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }

  function mapW() { return (S.src && S.src.cfg && S.src.cfg.W) || CM.CFG.W; }
  function mapH() { return (S.src && S.src.cfg && S.src.cfg.H) || CM.CFG.H; }
  function startYear() { return (S.src && S.src.cfg && S.src.cfg.START ? S.src.cfg.START.y : CM.CFG.START.y); }
  function data() { return (S.src && S.src.data) || {}; }
  function regionList() { return data().regions || []; }
  function taskList() { return data().histTasks || []; }
  function landmarkList() { return data().landmarks || []; }
  function facilityList() { return data().facilities || []; }
  function centerList() { return data().centers || []; }
  function anchorList() {
    var out = [];
    taskList().forEach(function (t, ti) {
      (t.anchors || []).forEach(function (a, ai) { out.push({ task: t, taskIdx: ti, idx: ai, a: a }); });
    });
    return out;
  }
  function regionName(idx) {
    var r = regionList()[idx];
    return r ? (r.name || r.id || ('区域 ' + (idx + 1))) : '区域';
  }
  function taskName(t) { return t ? (t.title || t.id || '任务') : '任务'; }
  function landmarkName(l) { return l ? (l.name || l.id || '地标') : '地标'; }
  function facilityName(f) { return f ? (f.n || f.id || '设施') : '设施'; }
  function anchorName(a) { return a ? (a.name || '锚点') : '锚点'; }
  function entityTypeName(kind) { return (ENTITY[kind] && ENTITY[kind].one) || '对象'; }
  function yearOf(v) {
    if (v == null) return null;
    if (Array.isArray(v)) return isNum(v[0]) ? v[0] : null;
    return isNum(v) ? v : null;
  }
  function facilityYear(f) {
    if (!f) return null;
    var y0 = yearOf(f.y0);
    if (y0 != null) return y0;
    if (f.lm) {
      var l = landmarkList().filter(function (x) { return x.id === f.lm; })[0];
      return l ? yearOf(l.year) : null;
    }
    return null;
  }
  function facilityCloseYear(f) { return f ? yearOf(f.y1) : null; }
  function markerYear(m) {
    if (!m) return null;
    if (m.kind === 'landmarks') return yearOf(m.item && m.item.year);
    if (m.kind === 'facilities') return facilityYear(m.item);
    if (m.kind === 'anchors') return m.task ? yearOf((m.task.appear || [])[0]) : null;
    return null;
  }

  // ============================================================ 主题

  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function applyTheme(t, quiet) {
    t = t === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('cm1.editor.theme', t); } catch (e) {}
    var b = $('btnTheme');
    if (b) { clear(b); b.appendChild(icon(t === 'dark' ? 'sun' : 'moon')); b.title = t === 'dark' ? '切换浅色 · T' : '切换深色 · T'; }
    if (MAP && MAP.cv) {
      MAP.base = null;
      if (MAP.ix) MAP.base = buildBase(MAP.ix);
      draw();
    }
    if (!quiet && S.src) toast(t === 'dark' ? '深色底图' : '浅色底图');
  }

  // ============================================================ 历史（快照式）

  function snap() { return S.src ? JSON.stringify(S.src) : ''; }
  function resetHistory() {
    H.stack = [snap()]; H.idx = 0; H.saved = H.stack[0]; H.suspend = false;
    clearTimeout(H.timer); H.timer = 0;
    updateUndoButtons();
  }
  function updateUndoButtons() {
    var u = $('btnUndo'), r = $('btnRedo');
    if (u) u.disabled = !S.src || H.idx <= 0;
    if (r) r.disabled = !S.src || H.idx >= H.stack.length - 1;
  }
  function commitHistory() {
    if (!S.src || H.suspend || H.busy) return;
    clearTimeout(H.timer); H.timer = 0;
    var s = snap();
    if (H.stack[H.idx] === s) return;
    H.stack = H.stack.slice(0, H.idx + 1);
    H.stack.push(s);
    if (H.stack.length > 80) H.stack.shift();
    H.idx = H.stack.length - 1;
    updateUndoButtons();
  }
  function scheduleHistory() {
    if (!S.src || H.suspend || H.busy) return;
    clearTimeout(H.timer);
    H.timer = setTimeout(commitHistory, 420);
  }
  function applySnapshot(text) {
    if (!text) return;
    H.busy = true;
    try {
      S.src = JSON.parse(text);
      S.sel = null;
      S.regionSel = null;
      S.taskFocus = null;
      normalizeYear();
      rebuildRegionShapes();
      precheck();
      renderInspector();
      renderBrowser();
      if (S.sheet.open) renderSheet();
      updateFileChrome();
      draw();
    } catch (e) {
      toast('撤销失败：' + e.message);
    }
    H.busy = false;
    updateDirtyUI();
  }
  function undo() {
    commitHistory();
    if (H.idx <= 0) { toast('没有可撤销的操作'); return; }
    H.idx--;
    applySnapshot(H.stack[H.idx]);
    updateUndoButtons();
    toast('已撤销');
  }
  function redo() {
    commitHistory();
    if (H.idx >= H.stack.length - 1) { toast('没有可重做的操作'); return; }
    H.idx++;
    applySnapshot(H.stack[H.idx]);
    updateUndoButtons();
    toast('已重做');
  }

  function updateDirtyUI() {
    var d = !!(S.src && snap() !== H.saved);
    document.body.classList.toggle('dirty', d);
    var b = $('btnSave');
    if (b) b.disabled = !S.src;
  }
  function markSaved() { H.saved = snap(); updateDirtyUI(); }

  // 所有编辑都走这里：脏标记、历史、预检、重画
  function touch(opts) {
    opts = opts || {};
    if (!S.src) return;
    document.body.classList.add('dirty');
    if (opts.draw !== false) scheduleDraw();
    precheckSoon();
    if (opts.now) commitHistory();
    else scheduleHistory();
    if (opts.panels) refreshPanels();
    updateFileChrome();
  }

  // ============================================================ 预检（纯函数）

  function validate(src) {
    var out = [];
    function err(sec, msg) { out.push({ level: 'error', section: sec, msg: msg }); }
    function warn(sec, msg) { out.push({ level: 'warn', section: sec, msg: msg }); }
    if (!isObj(src) || !isObj(src.meta)) { err('meta', '文件结构不对：缺少 meta'); return out; }

    var m = src.meta, d = src.data || {}, cfg = src.cfg || {};
    var W = cfg.W !== undefined ? cfg.W : CM.CFG.W;
    var H = cfg.H !== undefined ? cfg.H : CM.CFG.H;
    var inB = function (x, y, tol) { return isNum(x) && isNum(y) && x >= -tol && y >= -tol && x <= W + tol && y <= H + tol; };

    // --- 概览
    ['id', 'name', 'title', 'sub', 'desc', 'region', 'tagline', 'intro', 'kind', 'scenario', 'mapVersion', 'difficulty', 'tags', 'modes', 'facts', 'features', 'highlights', 'cam'].forEach(function (k) {
      if (m[k] === undefined || m[k] === null || m[k] === '') err('meta', '缺少字段 ' + k);
    });
    if (m.kind && ['real', 'fictional'].indexOf(m.kind) < 0) err('meta', 'kind 必须是 real / fictional');
    if (m.difficulty !== undefined && (!isInt(m.difficulty) || m.difficulty < 1 || m.difficulty > 4)) err('meta', 'difficulty 必须是 1–4');
    if (m.mapVersion !== undefined && (!isInt(m.mapVersion) || m.mapVersion < 1)) err('meta', 'mapVersion 必须是正整数');
    if (m.region && REGIONS.indexOf(m.region) < 0) warn('meta', '地区「' + m.region + '」不在 REGION_STYLE 中，建筑与车型会回退为内地风格');
    if (m.modes && (!Array.isArray(m.modes) || m.modes.some(function (x) { return ['challenge', 'free'].indexOf(x) < 0; }))) err('meta', 'modes 只能是 challenge / free');
    if (m.cam && !inB(m.cam.cx, m.cam.cy, 0)) warn('meta', '默认镜头 (cx, cy) 在地图范围外：' + m.cam.cx + ',' + m.cam.cy);
    if (m.geo === 'inline') warn('meta', 'geo 为 inline：几何由代码生成，无法用 map-source 重建，也没有底图');

    // --- 配置
    Object.keys(cfg).forEach(function (k) { if (CFG_KEYS.indexOf(k) < 0) err('cfg', 'cfg.' + k + ' 不是随地图切换的配置键'); });
    if (!isInt(W) || W <= 0 || W % CM.CFG.ZONE) err('cfg', 'W 必须是正数且能被 ' + CM.CFG.ZONE + ' 整除，当前 ' + W);
    if (!isInt(H) || H <= 0 || H % CM.CFG.ZONE) err('cfg', 'H 必须是正数且能被 ' + CM.CFG.ZONE + ' 整除，当前 ' + H);
    var ST = cfg.START || CM.CFG.START;
    if (!isInt(ST.y) || ST.y < 1800 || ST.y > 2200) err('cfg', 'START.y 不合理：' + ST.y);
    if (!isInt(ST.m) || ST.m < 1 || ST.m > 12) err('cfg', 'START.m 必须是 1–12');
    if (!isInt(ST.d) || ST.d < 1 || ST.d > CM.U.daysInMonth(ST.y, ST.m)) err('cfg', 'START.d 超出当月天数');
    var fr = cfg.fareRange || CM.CFG.fareRange, fd = cfg.fareDefault || CM.CFG.fareDefault;
    if (fd && isNum(fd.flat) && fr && isNum(fr.min) && isNum(fr.max) && (fd.flat < fr.min || fd.flat > fr.max)) err('cfg', '默认票价 ' + fd.flat + ' 不在范围 ' + fr.min + '–' + fr.max);
    var pc = (cfg.growth || CM.CFG.growth).popCurve || [];
    for (var i = 1; i < pc.length; i++) {
      if (!isNum(pc[i][1]) || pc[i][1] <= 0) err('cfg', 'popCurve 第 ' + i + ' 个人口值无效');
      if (pc[i][0] <= pc[i - 1][0]) err('cfg', 'popCurve 年份必须递增（第 ' + i + ' 点）');
    }

    // --- 区域
    var regs = d.regions || [];
    if (!regs.length) err('regions', 'regions 不能为空');
    var plans = d.plans || {};
    if (!plans.res) err('regions', 'data.plans 缺少 res（未声明 plan 的区域会用它）');
    Object.keys(plans).forEach(function (k) {
      var t = Object.keys(plans[k]).reduce(function (a, x) { return a + plans[k][x]; }, 0);
      if (Math.abs(t - 1) > 0.02) warn('regions', 'plans.' + k + ' 各类占比合计 ' + t.toFixed(3) + '，应为 1');
    });
    var rid = {};
    regs.forEach(function (r, k) {
      if (!r.id) { err('regions', 'regions[' + k + '] 缺少 id'); return; }
      if (rid[r.id]) err('regions', '区域 id 重复：' + r.id);
      rid[r.id] = 1;
      if (r.open !== null && r.open !== undefined && !isNum(r.open)) err('regions', '区域 ' + r.id + ' 的 open 必须是年份或 null');
      if (r.plan && !plans[r.plan]) err('regions', '区域 ' + r.id + ' 引用不存在的用地配方 ' + r.plan);
    });

    // --- 职住中心
    (d.centers || []).forEach(function (c, k) {
      if (!inB(c.x, c.y, CM.CFG.ZONE * 4)) err('centers', 'centers[' + k + '] 坐标越界：' + c.x + ',' + c.y);
      if (c.pop != null && (!isNum(c.pop) || c.pop < 0)) err('centers', 'centers[' + k + '] 的 pop 必须是非负数');
      if (c.jobs != null && (!isNum(c.jobs) || c.jobs < 0)) err('centers', 'centers[' + k + '] 的 jobs 必须是非负数');
    });

    // --- 地标
    var lms = d.landmarks || [], lid = {};
    lms.forEach(function (l, k) {
      if (!l.id) { err('landmarks', 'landmarks[' + k + '] 缺少 id'); return; }
      if (lid[l.id]) err('landmarks', '地标 id 重复：' + l.id);
      lid[l.id] = 1;
      if (!inB(l.x, l.y, 4)) err('landmarks', '地标 ' + l.id + ' 坐标越界：' + l.x + ',' + l.y);
      if (!isNum(l.year)) err('landmarks', '地标 ' + l.id + ' 缺少落成年份 year');
      if (l.style) {
        var st = CM.LANDMARK_STYLES[l.style];
        if (!st) err('landmarks', '地标 ' + l.id + ' 的造型 ' + l.style + ' 未登记（可选：' + LM_STYLES.join('/') + '）');
        else if (l.kind && st.kinds && st.kinds.indexOf(l.kind) < 0) err('landmarks', '地标 ' + l.id + ' 的造型 ' + l.style + ' 只适用于 ' + st.kinds.join('/'));
      }
    });

    // --- 设施
    var fid = {};
    (d.facilities || []).forEach(function (f, k) {
      var tag = f.id || ('#' + k);
      if (f.id && fid[f.id]) err('facilities', '设施 id 重复：' + f.id);
      if (f.id) fid[f.id] = 1;
      if (!FAC_TYPES.length || FAC_TYPES.indexOf(f.t) < 0) { err('facilities', '设施 ' + tag + ' 的类型 ' + f.t + ' 不存在（可选：' + FAC_TYPES.join('/') + '）'); return; }
      if (!f.n) err('facilities', '设施 ' + tag + ' 缺少名称 n');
      if (f.lm && f.at) err('facilities', '设施 ' + tag + ' 同时声明了 lm 与 at');
      if (f.lm) { if (!lid[f.lm]) err('facilities', '设施 ' + tag + ' 引用了不存在的地标 ' + f.lm); }
      else if (f.at) { if (!Array.isArray(f.at) || !inB(f.at[0], f.at[1], 1)) err('facilities', '设施 ' + tag + ' 坐标越界：' + (f.at || []).join(',')); }
      else err('facilities', '设施 ' + tag + ' 既没有 lm 也没有 at');
      if (f.p) Object.keys(f.p).forEach(function (x) { if (TRIP_KEYS.indexOf(x) < 0) err('facilities', '设施 ' + tag + ' 的出行目的 ' + x + ' 不存在'); });
      if (f.pax != null) curve(f.pax, '设施 ' + tag + ' 的 pax', 'facilities', err);
    });

    // --- 任务
    var tid = {};
    (d.histTasks || []).forEach(function (t, k) {
      var tag = t.id || ('#' + k);
      if (t.id && tid[t.id]) err('tasks', '任务 id 重复：' + t.id);
      if (t.id) tid[t.id] = 1;
      if (!t.title) err('tasks', '任务 ' + tag + ' 缺少 title');
      if (!Array.isArray(t.appear) || !Array.isArray(t.deadline)) { err('tasks', '任务 ' + tag + ' 需要 appear / deadline 的 [年, 月]'); return; }
      if (t.deadline[0] * 12 + t.deadline[1] <= t.appear[0] * 12 + t.appear[1]) err('tasks', '任务 ' + tag + ' 的截止不晚于出现时间');
      if (!isNum(t.reward) || t.reward < 0) err('tasks', '任务 ' + tag + ' 的 reward 必须是非负数');
      var H2 = CM.Tasks.TYPES[t.type];
      if (!H2) err('tasks', '任务 ' + tag + ' 的类型 ' + t.type + ' 未登记（可选：' + TASK_TYPES.join('/') + '）');
      else (H2.params || []).forEach(function (pr) {
        if (!pr[2] && t[pr[0]] === undefined) err('tasks', '任务 ' + tag + '（' + H2.name + '）缺少参数 ' + pr[0] + '：' + pr[1]);
      });
      (t.anchors || []).forEach(function (a, x) {
        if (!inB(a.x, a.y, 6)) err('tasks', '任务 ' + tag + ' 的锚点 ' + (a.name || x) + ' 坐标越界');
        if (!isNum(a.r) || a.r <= 0) err('tasks', '任务 ' + tag + ' 的锚点 ' + (a.name || x) + ' 半径必须大于 0');
      });
    });

    // --- 事件
    var lastYm = -Infinity;
    (d.events || []).forEach(function (e, k) {
      if (!isNum(e.y)) { err('events', 'events[' + k + '] 缺少年份'); return; }
      if (e.m != null && (!isInt(e.m) || e.m < 1 || e.m > 12)) err('events', 'events[' + k + '] 月份无效');
      var ym = e.y * 12 + ((e.m || 1) - 1);
      if (ym < lastYm) warn('events', 'events 未按时间升序（第 ' + k + ' 条）');
      lastYm = ym;
    });

    return out;

    function curve(v, label, sec, e) {
      if (isNum(v)) { if (v < 0) e(sec, label + ' 不能为负'); return; }
      if (!Array.isArray(v) || !v.length) { e(sec, label + ' 必须是数字或 [年份, 值] 曲线'); return; }
      var last = -Infinity;
      v.forEach(function (p, k) {
        if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) { e(sec, label + ' 第 ' + k + ' 点必须是 [年份, 值]'); return; }
        if (p[0] <= last) e(sec, label + ' 的年份必须递增（第 ' + k + ' 点）');
        last = p[0];
        if (p[1] < 0) e(sec, label + ' 第 ' + k + ' 点为负数');
      });
    }
  }

  var precheckTimer = 0;
  function precheckSoon() {
    clearTimeout(precheckTimer);
    precheckTimer = setTimeout(precheck, 90);
  }
  function precheck() {
    if (!S.src) {
      S.issues = [];
      var c0 = $('issCount');
      if (c0) c0.textContent = '—';
      return;
    }
    S.issues = validate(S.src);
    var errs = 0;
    S.issues.forEach(function (i) { if (i.level === 'error') errs++; });
    var warns = S.issues.length - errs;
    var b = $('btnIssues'), n = $('issCount');
    if (b) {
      b.classList.remove('err', 'warn', 'good');
      b.classList.add(errs ? 'err' : (warns ? 'warn' : 'good'));
      b.title = '结构预检：' + errs + ' 错误 · ' + warns + ' 警告';
    }
    if (n) n.textContent = S.issues.length ? String(S.issues.length) : '0';
    if (!$('issuePop').classList.contains('closed')) renderIssues();
    updateOverviewIssues(errs, warns);
  }

  // ============================================================ 表单构件

  function field(def, obj, opts) {
    opts = opts || {};
    var wrap = h('div', { class: 'f' + (def.wide ? ' wide' : '') });
    var lab = h('label', { text: def.label });
    if (def.unit) lab.appendChild(h('span', { class: 'u', text: def.unit }));
    wrap.appendChild(lab);
    var input;
    function after() {
      touch({ draw: opts.draw !== false });
      if (opts.onChange) opts.onChange();
    }
    function setv(v) {
      if (def.k in obj && obj[def.k] === v) return;
      obj[def.k] = v;
      after();
    }

    if (def.kind === 'select') {
      input = h('select');
      if (def.allowEmpty) input.appendChild(h('option', { value: '' }, def.emptyLabel || '（空）'));
      (def.options || []).forEach(function (o) {
        var val = Array.isArray(o) ? o[0] : o;
        var label = Array.isArray(o) ? o[1] : o;
        input.appendChild(h('option', { value: String(val), selected: String(obj[def.k] == null ? '' : obj[def.k]) === String(val) }, label));
      });
      if (obj[def.k] == null && def.allowEmpty) input.value = '';
      input.onchange = function () {
        var v = input.value;
        if (v === '') { setv(def.allowEmpty ? undefined : v); return; }
        setv(def.num ? Number(v) : v);
        if (def.draw !== false) draw();
      };
    } else if (def.kind === 'bool') {
      input = h('label', { class: 'chk' }, h('input', {
        type: 'checkbox', checked: !!obj[def.k],
        onchange: function () { setv(input.querySelector('input').checked); if (def.draw !== false) draw(); }
      }), def.checkLabel || '是');
      wrap.appendChild(input);
      if (def.hint) wrap.appendChild(h('div', { class: 'hint', text: def.hint }));
      return wrap;
    } else if (def.kind === 'json' || def.kind === 'textarea') {
      input = h('textarea', { rows: def.rows || (def.kind === 'json' ? 3 : 3), spellcheck: 'false' });
      input.value = def.kind === 'json' ? pretty(obj[def.k]) : (obj[def.k] == null ? '' : String(obj[def.k]));
      if (def.placeholder) input.placeholder = def.placeholder;
      input.oninput = function () {
        if (def.kind === 'json') {
          try {
            var v = JSON.parse(input.value || 'null');
            if (v === null && def.optional) delete obj[def.k]; else obj[def.k] = v;
            input.classList.remove('bad');
            after();
            if (def.draw !== false) draw();
          } catch (e) { input.classList.add('bad'); }
        } else {
          obj[def.k] = input.value;
          after();
        }
      };
    } else if (def.kind === 'num' || def.kind === 'int') {
      input = h('input', { type: 'number', step: def.step || (def.kind === 'int' ? '1' : 'any') });
      input.value = obj[def.k] == null ? '' : obj[def.k];
      if (def.placeholder) input.placeholder = def.placeholder;
      input.oninput = function () {
        if (input.value === '') {
          if (def.optional) setv(undefined);
          return;
        }
        var v = Number(input.value);
        if (!isFinite(v)) return;
        if (def.kind === 'int') v = Math.round(v);
        if (def.min != null && v < def.min) v = def.min;
        if (def.max != null && v > def.max) v = def.max;
        setv(v);
        if (def.draw !== false) draw();
      };
    } else {
      input = h('input', { type: 'text' });
      input.value = obj[def.k] == null ? '' : String(obj[def.k]);
      if (def.placeholder) input.placeholder = def.placeholder;
      input.oninput = function () {
        setv(input.value === '' && def.optional ? undefined : input.value);
      };
    }
    wrap.appendChild(input);
    if (def.hint) wrap.appendChild(h('div', { class: 'hint', text: def.hint }));
    return wrap;
  }

  function formCard(title, fields, obj, opts) {
    opts = opts || {};
    var card = h('div', { class: 'card' });
    if (title) card.appendChild(h('h3', null, opts.icon ? icon(opts.icon) : null, title));
    var g = h('div', { class: opts.cols === 3 ? 'grid3' : 'grid2' });
    fields.forEach(function (f) {
      if (f.if && !f.if(obj)) return;
      g.appendChild(field(f, obj, opts));
    });
    card.appendChild(g);
    if (opts.note) card.appendChild(h('div', { class: 'note', text: opts.note }));
    return card;
  }

  // 表格：cols = [{k,label,kind,options,w}]
  function table(arr, cols, opts) {
    opts = opts || {};
    var box = h('div');
    var bar = h('div', { class: 'sheet-bar' },
      h('span', { class: 'count', text: arr.length + ' 项' }),
      h('button', { class: 'btn sm', onclick: function () { if (opts.onAdd) opts.onAdd(); } }, icon('plus'), '添加'));
    if (opts.extra) bar.appendChild(opts.extra);
    box.appendChild(bar);
    if (!arr.length) { box.appendChild(h('div', { class: 'sheet-empty', text: opts.empty || '（暂无）' })); return box; }
    var wrap = h('div', { class: 'tbl-wrap' });
    var t = h('table');
    var tr = h('tr');
    if (opts.index !== false) tr.appendChild(h('th', { text: '#' }));
    cols.forEach(function (c) { tr.appendChild(h('th', { text: c.label })); });
    tr.appendChild(h('th', { text: '' }));
    t.appendChild(h('thead', null, tr));
    var tb = h('tbody');
    arr.forEach(function (row, idx) {
      var r = h('tr');
      if (opts.index !== false) r.appendChild(h('td', { class: 'idx', text: idx + 1 }));
      cols.forEach(function (c) {
        var td = h('td');
        td.appendChild(cell(c, row, opts));
        r.appendChild(td);
      });
      r.appendChild(h('td', null, h('button', {
        class: 'del', title: '删除', onclick: function () { if (opts.onDel) opts.onDel(idx); }
      }, icon('trash'))));
      tb.appendChild(r);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    box.appendChild(wrap);
    return box;
  }

  function cell(c, row, opts) {
    function set(v) {
      if (v === undefined) delete row[c.k]; else row[c.k] = v;
      touch({ draw: opts && opts.draw !== false });
      if (opts && opts.onChange) opts.onChange(row);
    }
    if (c.kind === 'json' || c.kind === 'jsonRow') {
      var ta = h('textarea', { rows: 1, spellcheck: 'false', style: c.w ? 'min-width:' + c.w + 'px' : '' });
      ta.value = pretty(row[c.k]);
      ta.oninput = function () {
        try {
          var v = JSON.parse(ta.value || 'null');
          if (v === null) delete row[c.k]; else row[c.k] = v;
          ta.classList.remove('bad'); touch({ draw: opts && opts.draw !== false });
          if (opts && opts.onChange) opts.onChange(row);
        } catch (e) { ta.classList.add('bad'); }
      };
      return ta;
    }
    if (c.kind === 'select') {
      var sel = h('select');
      if (c.allowEmpty) sel.appendChild(h('option', { value: '' }, '—'));
      (c.options || []).forEach(function (o) {
        var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
        sel.appendChild(h('option', { value: String(v), selected: String(row[c.k]) === String(v) }, l));
      });
      sel.value = row[c.k] == null ? '' : String(row[c.k]);
      sel.onchange = function () { set(sel.value === '' ? undefined : (c.num ? Number(sel.value) : sel.value)); };
      return sel;
    }
    if (c.kind === 'num' || c.kind === 'int') {
      var inp = h('input', { type: 'number', step: c.kind === 'int' ? '1' : 'any', style: 'min-width:58px' });
      inp.value = row[c.k] == null ? '' : row[c.k];
      inp.oninput = function () {
        if (inp.value === '') { if (c.optional) set(undefined); return; }
        var v = Number(inp.value); if (!isFinite(v)) return;
        set(c.kind === 'int' ? Math.round(v) : v);
      };
      return inp;
    }
    var tx = h('input', { type: 'text', style: c.w ? 'min-width:' + c.w + 'px' : '' });
    tx.value = row[c.k] == null ? '' : row[c.k];
    tx.oninput = function () { set(tx.value === '' && c.optional ? undefined : tx.value); };
    return tx;
  }

  // ============================================================ 地图状态

  var MAP = {
    geoId: null, geo: null, ix: null, base: null, baseScale: 24,
    cv: null, ctx: null, cam: { x: 0, y: 0, z: 7 },
    regions: [], regionLabels: [], hoverRegion: null,
    hover: null, drag: null, down: null, cycle: null, overlap: 0,
    pointers: {}, pinch: null, gesture: false,
    fly: null, flyRaf: 0, loadToken: 0, bound: false
  };

  var BASE_STYLE = {
    light: {
      land: '#e7eef5', wood: 'rgba(166,203,176,.55)', reserve: 'rgba(174,203,207,.9)', park: '#d2e6cb',
      water: '#9cc4e6', bank: '#c2daf0',
      street: '#ffffff', streetCase: '#cdd8e5',
      road: { 2: ['#ffffff', '#ccd7e5'], 3: ['#ffffff', '#b4c3d6'], 4: ['#fbfcfe', '#9bafc8'] },
      link: ['#f7f9fc', '#c9d5e4'], tunnel: 'rgba(146,162,186,.6)',
      rail: ['#ffffff', '#a3b0c2'],
      ink: 'rgba(28,44,69,.92)', halo: 'rgba(255,255,255,.92)', border: 'rgba(140,160,185,.45)',
      grid: 'rgba(27,54,92,.07)', gridMajor: 'rgba(27,54,92,.14)', region: '#2a9d8f', regionText: 'rgba(38,83,93,.72)',
      mark: { centers: '#b06f00', landmarks: '#6b3fc4', facilities: '#0a7d63', anchors: '#c3352d' }
    },
    dark: {
      land: '#16202e', wood: 'rgba(40,78,66,.6)', reserve: 'rgba(34,62,66,.85)', park: '#1d3a31',
      water: '#1d3f60', bank: '#2a5177',
      street: '#3d4a5c', streetCase: '#101a26',
      road: { 2: ['#2b384b', '#101a26'], 3: ['#37485f', '#0d1622'], 4: ['#4a5f7d', '#0b131e'] },
      link: ['#2a3850', '#0d1520'], tunnel: 'rgba(110,130,160,.45)',
      rail: ['#5a6678', '#0c121b'],
      ink: 'rgba(230,237,247,.9)', halo: 'rgba(12,18,28,.87)', border: 'rgba(120,140,170,.45)',
      grid: 'rgba(180,205,235,.06)', gridMajor: 'rgba(180,205,235,.12)', region: '#55cdbd', regionText: 'rgba(170,220,228,.72)',
      mark: { centers: '#f0b54a', landmarks: '#a78bfa', facilities: '#2bd4a8', anchors: '#ff8a8a' }
    }
  };
  function BS() { return BASE_STYLE[currentTheme()] || BASE_STYLE.light; }

  function bboxOf(p, bb) {
    bb = bb || [1e9, 1e9, -1e9, -1e9];
    for (var k = 0; k < p.length; k += 2) {
      var x = p[k], y = p[k + 1];
      if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y;
      if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
    }
    return bb;
  }

  function loadGeoScript(id) {
    return new Promise(function (res, rej) {
      if (!id) return res(null);
      if (CM.GEOS && CM.GEOS[id]) return res(CM.GEOS[id]);
      var reg = registryGeo(id);
      if (reg) return res(reg);
      if (id === 'inline') return res(null);
      var sc = document.createElement('script');
      sc.src = '../js/geo_' + id + '.js';
      sc.onload = function () { res((CM.GEOS || {})[id] || null); };
      sc.onerror = function () { rej(new Error('geo_' + id + '.js 加载失败')); };
      document.head.appendChild(sc);
    });
  }

  function registryGeo(id) {
    var L = CM.MAP_LIST || [];
    for (var i = 0; i < L.length; i++) if (L[i] && L[i].id === id && L[i].geo) return L[i].geo;
    return null;
  }

  // 青湾的几何由 data_tutorial.js 内联生成；按需载入该数据文件后从注册表取 geo
  function loadInlineGeo(id) {
    if (CM.GEOS && CM.GEOS[id]) return Promise.resolve(CM.GEOS[id]);
    var reg = registryGeo(id);
    if (reg) return Promise.resolve(reg);
    if (id !== 'tutorial') return Promise.resolve(null);
    return new Promise(function (res) {
      var sc = document.createElement('script');
      sc.src = '../js/data_' + id + '.js';
      sc.onload = function () { res(registryGeo(id)); };
      sc.onerror = function () { res(null); };
      document.head.appendChild(sc);
    });
  }

  function geoKey() {
    if (!S.src || !S.src.meta) return null;
    var g = S.src.meta.geo;
    if (g && g !== 'inline') return g;
    var id = S.src.meta.id;
    if (id && ((CM.GEOS && CM.GEOS[id]) || registryGeo(id))) return id;
    return g || null;
  }

  // 几何索引：一次性解码成 Float32Array + 外包框；高倍按视口矢量重绘时不再重复解码
  function prepareGeo(G) {
    if (!G || !CM.Geo || !CM.Geo.dec) return null;
    var dec = CM.Geo.dec, names = G.names || [];

    function polys(rows) {
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i], rings = [], b = [1e9, 1e9, -1e9, -1e9];
        for (var k = 1; k < row.length; k++) {
          if (typeof row[k] !== 'string') continue;
          var p = dec(row[k], 1);
          rings.push(p); bboxOf(p, b);
        }
        if (rings.length) out.push({ name: names[row[0]] || '', rings: rings, b: b });
      }
      return out;
    }

    var ix = {
      woods: polys(G.woods || []),
      reserves: polys(G.reserves || []),
      parks: polys(G.parks || []),
      water: polys((G.water || []).filter(function (r) { return typeof r[1] !== 'number'; })),
      admin: [],
      rivers: [], rail: [], streets: [],
      roads: { 2: [], 3: [], 4: [], link: [], tun: [] }
    };
    (G.admin || []).forEach(function (row) {
      if (!row || row.length < 3) return;
      var rings = [], b = [1e9, 1e9, -1e9, -1e9];
      for (var k = 2; k < row.length; k++) {
        if (typeof row[k] !== 'string') continue;
        var p = dec(row[k], 1);   // 首字符是外环 / 内环标记（与 Geo.polyFeat 一致）
        rings.push(p); bboxOf(p, b);
      }
      if (rings.length) ix.admin.push({ level: row[0], name: names[row[1]] || '', rings: rings, b: b });
    });
    (G.water || []).forEach(function (r) {
      if (typeof r[1] !== 'number' || typeof r[2] !== 'string') return;
      var p = dec(r[2]); ix.rivers.push({ p: p, b: bboxOf(p), w: r[1] });
    });
    (G.rail || []).forEach(function (r) {
      if (!r || (r[1] & 2) || typeof r[2] !== 'string') return;
      var p = dec(r[2]); ix.rail.push({ p: p, b: bboxOf(p) });
    });
    (G.roads || []).forEach(function (r) {
      if (!r || typeof r[3] !== 'string') return;
      var p = dec(r[3]), f = r[2] || 0;
      var g = (f & 4) ? 'link' : ((f & 2) ? 'tun' : (ix.roads[r[1]] ? r[1] : null));
      if (g == null) return;
      ix.roads[g].push({ p: p, b: bboxOf(p) });
    });
    if (G.streets) G.streets.split('!').forEach(function (str) {
      if (!str) return;
      var p = dec(str); if (p.length >= 4) ix.streets.push({ p: p, b: bboxOf(p) });
    });
    return ix;
  }

  function paintBase(c, ix, k, vis) {
    var ST = BS();
    vis = vis || [-1e9, -1e9, 1e9, 1e9];
    function hit(b) { return !!b && !(b[2] < vis[0] || b[0] > vis[2] || b[3] < vis[1] || b[1] > vis[3]); }
    function lw(px) { return px / k; }
    var i, it;

    function fillList(list, col, perFeature) {
      c.fillStyle = col;
      if (perFeature) {
        for (var j = 0; j < list.length; j++) {
          it = list[j]; if (!hit(it.b)) continue;
          c.beginPath();
          for (var r = 0; r < it.rings.length; r++) traceRing(c, it.rings[r]);
          c.fill('evenodd');
        }
        return;
      }
      c.beginPath();
      var any = false;
      for (var j2 = 0; j2 < list.length; j2++) {
        it = list[j2]; if (!hit(it.b)) continue;
        for (var r2 = 0; r2 < it.rings.length; r2++) { traceRing(c, it.rings[r2]); any = true; }
      }
      if (any) c.fill('evenodd');
    }
    function strokeList(list, width, color) {
      c.strokeStyle = color; c.lineWidth = width; c.beginPath();
      var any = false;
      for (var j = 0; j < list.length; j++) {
        it = list[j]; if (!hit(it.b)) continue;
        traceLine(c, it.p); any = true;
      }
      if (any) c.stroke();
    }

    fillList(ix.woods, ST.wood, false);
    fillList(ix.reserves, ST.reserve, true);
    fillList(ix.parks, ST.park, false);
    fillList(ix.water, ST.water, false);

    for (i = 0; i < ix.rivers.length; i++) {
      it = ix.rivers[i]; if (!hit(it.b)) continue;
      c.strokeStyle = ST.bank; c.lineWidth = Math.max(it.w * k, 2.2) / k + lw(2);
      c.beginPath(); traceLine(c, it.p); c.stroke();
      c.strokeStyle = ST.water; c.lineWidth = Math.max(it.w * k, 1.8) / k;
      c.beginPath(); traceLine(c, it.p); c.stroke();
    }

    strokeList(ix.rail, lw(2.2), ST.rail[1]);
    strokeList(ix.rail, lw(0.9), ST.rail[0]);

    // 街道层是城市肌理，必须画；线宽按屏幕像素折算
    strokeList(ix.streets, lw(1.7), ST.streetCase);
    strokeList(ix.streets, lw(0.8), ST.street);

    [2, 3, 4].forEach(function (cls) {
      var w = { 2: 1.8, 3: 2.4, 4: 3.4 }[cls], st = ST.road[cls];
      strokeList(ix.roads[cls], lw(w + 1.7), st[1]);
      strokeList(ix.roads[cls], lw(w), st[0]);
    });
    strokeList(ix.roads.link, lw(2.6), ST.link[1]);
    strokeList(ix.roads.link, lw(1.3), ST.link[0]);
    if (ix.roads.tun.length) {
      c.setLineDash([lw(4), lw(3)]);
      strokeList(ix.roads.tun, lw(1.2), ST.tunnel);
      c.setLineDash([]);
    }
  }

  function traceRing(c, p) {
    if (p.length < 6) return;
    c.moveTo(p[0], p[1]);
    for (var q = 2; q < p.length; q += 2) c.lineTo(p[q], p[q + 1]);
    c.closePath();
  }
  function traceLine(c, p) {
    if (p.length < 4) return;
    c.moveTo(p[0], p[1]);
    for (var q = 2; q < p.length; q += 2) c.lineTo(p[q], p[q + 1]);
  }

  function buildBase(ix) {
    if (!ix) return null;
    var W = mapW(), H = mapH(), k = MAP.baseScale;
    var cv = document.createElement('canvas');
    cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    var c = cv.getContext && cv.getContext('2d');
    if (!c) return null;
    c.fillStyle = BS().land; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.lineCap = 'round'; c.lineJoin = 'round';
    paintBase(c, ix, k);
    c.strokeStyle = BS().border; c.lineWidth = 1 / k; c.strokeRect(0, 0, W, H);
    return cv;
  }

  // ============================================================ 区域形状

  function ringCentroid(p) {
    var a = 0, cx = 0, cy = 0;
    for (var i = 0; i < p.length; i += 2) {
      var j = (i + 2) % p.length;
      var x0 = p[i], y0 = p[i + 1], x1 = p[j], y1 = p[j + 1];
      var cross = x0 * y1 - x1 * y0;
      a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
    }
    if (Math.abs(a) < 1e-9) return { area: 0, x: p[0] || 0, y: p[1] || 0 };
    return { area: Math.abs(a / 2), x: cx / (3 * a), y: cy / (3 * a) };
  }

  function polyToShapes(poly) {
    if (!Array.isArray(poly) || !poly.length) return [];
    var list = (typeof poly[0][0] === 'number') ? [poly] : poly;
    var out = [];
    list.forEach(function (pl) {
      if (!Array.isArray(pl) || pl.length < 3) return;
      var p = new Float32Array(pl.length * 2);
      for (var i = 0; i < pl.length; i++) { p[i * 2] = pl[i][0]; p[i * 2 + 1] = pl[i][1]; }
      out.push({ rings: [p], b: bboxOf(p) });
    });
    return out;
  }

  function rebuildRegionShapes() {
    var regs = regionList(), ix = MAP.ix;
    MAP.regions = regs.map(function (rg) {
      var shapes = [], rule = null;
      function addFeat(f) { if (f && f.rings && f.rings.length) shapes.push({ rings: f.rings, b: f.b }); }
      if (rg.geo && ix) {
        if (rg.geo.reserve) ix.reserves.forEach(function (f) { if (f.name === rg.geo.reserve) addFeat(f); });
        else if (rg.geo.park) ix.parks.forEach(function (f) { if (f.name === rg.geo.park) addFeat(f); });
      }
      if (rg.poly) polyToShapes(rg.poly).forEach(function (s) { shapes.push(s); });
      if (ix && rg.streets && rg.streets.length) {
        var names = {};
        rg.streets.forEach(function (n) { names[n] = 1; });
        ix.admin.forEach(function (f) { if (f.level === 8 && names[f.name]) addFeat(f); });
      }
      if (ix && rg.district && rg.district.length) {
        var dn = {};
        rg.district.forEach(function (n) { dn[n] = 1; });
        ix.admin.forEach(function (f) { if ((f.level === 6 || f.level === 7) && dn[f.name]) addFeat(f); });
      }
      if (rg.woodMin != null) rule = '林地覆盖率 ≥ ' + Math.round(rg.woodMin * 100) + '%';
      if (!shapes.length && !rule) rule = '按外围默认区域处理';

      var bb = [1e9, 1e9, -1e9, -1e9], cx = 0, cy = 0, tot = 0;
      shapes.forEach(function (s) {
        bboxOf(s.rings[0], bb);
        var c = ringCentroid(s.rings[0]);
        cx += c.x * (c.area || 1); cy += c.y * (c.area || 1); tot += (c.area || 1);
      });
      var center = tot ? [cx / tot, cy / tot] : null;
      return { rg: rg, shapes: shapes, bbox: bb[2] > bb[0] ? bb : null, center: center, rule: rule };
    });
  }

  function normalizeYear() {
    var ys = [startYear()];
    landmarkList().forEach(function (l) { if (isNum(l.year)) ys.push(l.year); });
    regionList().forEach(function (r) { if (isNum(r.open)) ys.push(r.open); });
    (data().events || []).forEach(function (e) { if (isNum(e.y)) ys.push(e.y); });
    taskList().forEach(function (t) {
      if (Array.isArray(t.appear) && isNum(t.appear[0])) ys.push(t.appear[0]);
      if (Array.isArray(t.deadline) && isNum(t.deadline[0])) ys.push(t.deadline[0]);
    });
    facilityList().forEach(function (f) { var y = facilityYear(f); if (y != null) ys.push(y); });
    var lo = Math.min.apply(null, ys) - 5;
    var hi = Math.max.apply(null, ys) + 5;
    S.yearMin = Math.min(lo, startYear() - 10);
    S.yearMax = Math.max(hi, startYear() + 60);
    if (S.year != null) {
      if (S.year < S.yearMin) S.year = S.yearMin;
      if (S.year > S.yearMax) S.year = S.yearMax;
    }
    updateYearUI();
  }

  // ============================================================ 标记与位置

  function lmPos(id) {
    var list = landmarkList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return [list[i].x, list[i].y];
    return null;
  }
  function landmarkById(id) {
    var list = landmarkList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function facilityPos(f) {
    if (f.lm) { var p = lmPos(f.lm); if (p) return { x: p[0], y: p[1], derived: true }; }
    if (Array.isArray(f.at) && f.at.length >= 2 && isNum(f.at[0]) && isNum(f.at[1])) return { x: f.at[0], y: f.at[1], derived: false };
    return null;
  }
  function facilityRadius(f) {
    if (isNum(f.r)) return f.r;
    var T = CM.Fac.TYPES[f.t];
    return T && isNum(T.r) ? T.r : 0.6;
  }
  function centerRadius(c) { return (isNum(c.r) ? c.r : 2) * 4; }
  function anchorRadius(a) { return isNum(a.r) ? a.r : 4; }

  function markers() {
    var out = [], MC = BS().mark;
    centerList().forEach(function (c, i) {
      out.push({ kind: 'centers', idx: i, item: c, x: c.x, y: c.y, color: MC.centers, label: '中心', radius: centerRadius(c), derived: false });
    });
    taskList().forEach(function (t, ti) {
      (t.anchors || []).forEach(function (a, ai) {
        out.push({ kind: 'anchors', idx: ai, taskIdx: ti, task: t, item: a, x: a.x, y: a.y, color: MC.anchors, label: anchorName(a), radius: anchorRadius(a), derived: false });
      });
    });
    facilityList().forEach(function (f, i) {
      var p = facilityPos(f); if (!p) return;
      out.push({ kind: 'facilities', idx: i, item: f, x: p.x, y: p.y, color: MC.facilities, label: facilityName(f), radius: facilityRadius(f), derived: p.derived });
    });
    landmarkList().forEach(function (l, i) {
      out.push({ kind: 'landmarks', idx: i, item: l, x: l.x, y: l.y, color: MC.landmarks, label: landmarkName(l), radius: 0, derived: false, year: yearOf(l.year) });
    });
    return out.filter(function (m) { return S.layers[m.kind] !== false; });
  }

  function itemOf(sel) {
    if (!sel || !S.src) return null;
    var d = data();
    if (sel.kind === 'anchors') {
      var t = (d.histTasks || [])[sel.taskIdx];
      return t && (t.anchors || [])[sel.idx];
    }
    if (sel.kind === 'regions') return (d.regions || [])[sel.idx];
    if (sel.kind === 'tasks') return (d.histTasks || [])[sel.idx];
    return (d[sel.kind] || [])[sel.idx];
  }
  function selKey(sel) {
    if (!sel) return '';
    return sel.kind + ':' + (sel.taskIdx == null ? '' : sel.taskIdx) + ':' + sel.idx;
  }
  function sameItem(m) { return !!m && selKey(m) === selKey(S.sel); }
  function markerSel(m) {
    return m.kind === 'anchors' ? { kind: m.kind, idx: m.idx, taskIdx: m.taskIdx } : { kind: m.kind, idx: m.idx };
  }
  function markerOfSel(sel) {
    if (!sel) return null;
    var list = markers();
    for (var i = 0; i < list.length; i++) if (selKey(list[i]) === selKey(sel)) return list[i];
    return null;
  }

  function markerGhost(m) {
    if (S.year == null) return false;
    if (m.kind === 'landmarks') return m.year != null && m.year > S.year;
    if (m.kind === 'facilities') {
      var y0 = facilityYear(m.item), y1 = facilityCloseYear(m.item);
      if (y0 != null && y0 > S.year) return true;
      if (y1 != null && S.year >= y1) return true;
      return false;
    }
    if (m.kind === 'anchors') {
      var ap = m.task && m.task.appear ? m.task.appear[0] : null;
      var dl = m.task && m.task.deadline ? m.task.deadline[0] : null;
      if (ap != null && ap > S.year) return true;
      if (dl != null && dl < S.year) return true;
      return false;
    }
    return false;
  }

  // ============================================================ 坐标与相机

  function w2s(x, y) {
    var cv = MAP.cv, cw = cv ? cv.clientWidth : 0, ch = cv ? cv.clientHeight : 0;
    return [(x - MAP.cam.x) * MAP.cam.z + cw / 2, (y - MAP.cam.y) * MAP.cam.z + ch / 2];
  }
  function s2w(px, py) {
    var cv = MAP.cv, cw = cv ? cv.clientWidth : 0, ch = cv ? cv.clientHeight : 0;
    return [MAP.cam.x + (px - cw / 2) / MAP.cam.z, MAP.cam.y + (py - ch / 2) / MAP.cam.z];
  }
  function clampCam() {
    MAP.cam.z = clamp(MAP.cam.z, 2.5, 40);
    MAP.cam.x = clamp(MAP.cam.x, -12, mapW() + 12);
    MAP.cam.y = clamp(MAP.cam.y, -12, mapH() + 12);
  }
  function mapInsets() {
    var cv = MAP.cv;
    var cw = cv ? cv.clientWidth : (window.innerWidth || 900);
    var ch = cv ? cv.clientHeight : (window.innerHeight || 600);
    var left = 12, right = 12, top = 76, bottom = 78;
    if (S.src) {
      var dock = $('dock');
      if (dock && dock.offsetParent) left = Math.max(12, dock.getBoundingClientRect().right + 10);
      var sheet = $('sheet'), insp = $('inspector');
      if (sheet && S.sheet.open) right = Math.max(12, cw - sheet.getBoundingClientRect().left + 8);
      else if (insp && !insp.classList.contains('hidden')) right = Math.max(12, cw - insp.getBoundingClientRect().left + 8);
      right = clamp(right, 12, Math.max(12, cw - left - 180));
    }
    return { cw: cw, ch: ch, left: left, right: right, top: top, bottom: bottom };
  }

  function fitMap() {
    var cv = MAP.cv; if (!cv) return;
    var ins = mapInsets();
    var availW = Math.max(160, ins.cw - ins.left - ins.right);
    var availH = Math.max(160, ins.ch - ins.top - ins.bottom);
    MAP.cam.z = clamp(Math.min(availW / mapW(), availH / mapH()) * 0.94, 2.5, 32);
    var cx = ins.left + availW / 2, cy = ins.top + availH / 2;
    MAP.cam.x = mapW() / 2 - (cx - ins.cw / 2) / MAP.cam.z;
    MAP.cam.y = mapH() / 2 - (cy - ins.ch / 2) / MAP.cam.z;
    clampCam();
  }
  function cancelFly() {
    MAP.fly = null;
    if (MAP.flyRaf) { cancelAnimationFrame(MAP.flyRaf); MAP.flyRaf = 0; }
  }
  function flyTo(x, y, z) {
    cancelFly();
    var ins = mapInsets();
    var zt = clamp(z, 2.5, 40);
    var vx = ins.left + Math.max(40, ins.cw - ins.left - ins.right) / 2;
    var vy = ins.top + Math.max(40, ins.ch - ins.top - ins.bottom) / 2;
    var to = { x: x - (vx - ins.cw / 2) / zt, y: y - (vy - ins.ch / 2) / zt, z: zt };
    to.x = clamp(to.x, -12, mapW() + 12);
    to.y = clamp(to.y, -12, mapH() + 12);
    var from = { x: MAP.cam.x, y: MAP.cam.y, z: MAP.cam.z };
    if (Math.abs(from.x - to.x) < 0.01 && Math.abs(from.y - to.y) < 0.01 && Math.abs(from.z - to.z) < 0.01) return;
    var t0 = performance.now(), dur = 280;
    function step(t) {
      var k = clamp((t - t0) / dur, 0, 1);
      var e = 1 - Math.pow(1 - k, 3);
      MAP.cam.x = from.x + (to.x - from.x) * e;
      MAP.cam.y = from.y + (to.y - from.y) * e;
      MAP.cam.z = from.z + (to.z - from.z) * e;
      draw();
      if (k < 1) MAP.flyRaf = requestAnimationFrame(step);
      else { MAP.flyRaf = 0; }
    }
    MAP.flyRaf = requestAnimationFrame(step);
  }
  function ensureVisible(x, y) {
    var ins = mapInsets();
    var p = w2s(x, y);
    var mx = Math.min(140, Math.max(30, (ins.cw - ins.left - ins.right) * 0.2));
    var my = Math.min(120, Math.max(30, (ins.ch - ins.top - ins.bottom) * 0.2));
    if (p[0] < ins.left + mx || p[0] > ins.cw - ins.right - mx || p[1] < ins.top + my || p[1] > ins.ch - ins.bottom - my) {
      flyTo(x, y, Math.max(MAP.cam.z, 10));
    }
  }
  function ensureTaskVisible(t) {
    var anchors = (t && t.anchors) || [];
    if (!anchors.length) return;
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    anchors.forEach(function (a) {
      minx = Math.min(minx, a.x); miny = Math.min(miny, a.y);
      maxx = Math.max(maxx, a.x); maxy = Math.max(maxy, a.y);
    });
    var ins = mapInsets();
    var availW = Math.max(100, ins.cw - ins.left - ins.right);
    var availH = Math.max(100, ins.ch - ins.top - ins.bottom);
    var z = clamp(Math.min(availW / Math.max(8, maxx - minx + 8), availH / Math.max(8, maxy - miny + 8)) * 0.8, 5, 18);
    flyTo((minx + maxx) / 2, (miny + maxy) / 2, z);
  }
  function focusRegion(idx) {
    var q = MAP.regions[idx];
    if (!q || !q.center) return;
    var ins = mapInsets();
    var availW = Math.max(100, ins.cw - ins.left - ins.right);
    var availH = Math.max(100, ins.ch - ins.top - ins.bottom);
    var z = MAP.cam.z;
    if (q.bbox) {
      var w = Math.max(3, q.bbox[2] - q.bbox[0]), h = Math.max(3, q.bbox[3] - q.bbox[1]);
      z = clamp(Math.min(availW / w, availH / h) * 0.72, 5, 16);
    }
    flyTo(q.center[0], q.center[1], z);
  }
  function ensureRegionVisible(idx) {
    var q = MAP.regions[idx];
    if (!q || !q.center) return;
    var ins = mapInsets(), p = w2s(q.center[0], q.center[1]);
    if (p[0] < ins.left + 16 || p[0] > ins.cw - ins.right - 16 || p[1] < ins.top + 16 || p[1] > ins.ch - ins.bottom - 16) focusRegion(idx);
  }

  // ============================================================ 绘制

  var drawQueued = false;
  function scheduleDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () { drawQueued = false; draw(); });
  }

  function draw() {
    var cv = MAP.cv; if (!cv) return;
    var c = cv.getContext && cv.getContext('2d'); if (!c) return;
    var dpr = window.devicePixelRatio || 1;
    var cw = cv.clientWidth, ch = cv.clientHeight;
    if (!cw || !ch) return;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var ST = BS(), z = MAP.cam.z;
    c.fillStyle = ST.land; c.fillRect(0, 0, cw, ch);

    if (!S.src) {
      paintGrid(c, cw, ch);
      MAP.regionLabels = [];
      return;
    }

    if (MAP.ix && z * dpr > MAP.baseScale) {
      var vis = [MAP.cam.x - cw / 2 / z, MAP.cam.y - ch / 2 / z, MAP.cam.x + cw / 2 / z, MAP.cam.y + ch / 2 / z];
      c.save();
      c.setTransform(dpr * z, 0, 0, dpr * z, dpr * (cw / 2 - MAP.cam.x * z), dpr * (ch / 2 - MAP.cam.y * z));
      c.lineCap = 'round'; c.lineJoin = 'round';
      paintBase(c, MAP.ix, z, vis);
      c.restore();
    } else if (MAP.base) {
      var sx = (0 - MAP.cam.x) * z + cw / 2, sy = (0 - MAP.cam.y) * z + ch / 2;
      c.imageSmoothingEnabled = true;
      c.drawImage(MAP.base, sx, sy, mapW() * z, mapH() * z);
    } else {
      paintGrid(c, cw, ch);
      c.strokeStyle = ST.border; c.lineWidth = 1;
      var p0 = w2s(0, 0), p1 = w2s(mapW(), mapH());
      c.strokeRect(p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1]);
    }

    drawRegionHighlight(c);
    drawRadiusHalos(c);
    drawFootprint(c);
    drawRegionLabels(c);
    drawMarkers(c);
    var zb = $('stZoom');
    if (zb) zb.textContent = z.toFixed(1) + ' px/格';
    updateScaleBar();
    updateStatusSel();
  }

  function paintGrid(c, cw, ch) {
    var ST = BS(), z = MAP.cam.z, step = 4;
    var x0 = MAP.cam.x - cw / 2 / z, x1 = MAP.cam.x + cw / 2 / z;
    var y0 = MAP.cam.y - ch / 2 / z, y1 = MAP.cam.y + ch / 2 / z;
    var major = 20;
    c.save();
    c.lineWidth = 1;
    for (var pass = 0; pass < 2; pass++) {
      c.strokeStyle = pass ? ST.gridMajor : ST.grid;
      c.beginPath();
      var s = pass ? major : step;
      var x = Math.ceil(x0 / s) * s;
      for (; x <= x1; x += s) {
        if (!pass && Math.round(x) % major === 0) continue;
        var px = Math.round((x - MAP.cam.x) * z + cw / 2) + .5;
        c.moveTo(px, 0); c.lineTo(px, ch);
      }
      var y = Math.ceil(y0 / s) * s;
      for (; y <= y1; y += s) {
        if (!pass && Math.round(y) % major === 0) continue;
        var py = Math.round((y - MAP.cam.y) * z + ch / 2) + .5;
        c.moveTo(0, py); c.lineTo(cw, py);
      }
      c.stroke();
    }
    // 每 20 格（5 km）标一次坐标，便于无底图时定位
    c.fillStyle = ST.gridMajor;
    c.font = '9px ' + 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    for (x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
      var lx = (x - MAP.cam.x) * z + cw / 2;
      for (y = Math.ceil(y0 / major) * major; y <= y1; y += major) {
        var ly = (y - MAP.cam.y) * z + ch / 2;
        c.fillText(x + ',' + y, lx + 3, ly + 11);
      }
    }
    c.restore();
  }

  function regionShapesOf(idx) {
    var r = MAP.regions[idx];
    return r ? r.shapes : [];
  }

  function fillShapes(c, shapes, color, outline, alpha) {
    if (!shapes || !shapes.length) return;
    c.save();
    c.globalAlpha = alpha == null ? 1 : alpha;
    c.fillStyle = color;
    shapes.forEach(function (s) {
      c.beginPath();
      for (var r = 0; r < s.rings.length; r++) traceRing(c, s.rings[r]);
      c.fill('evenodd');
      if (outline) {
        c.strokeStyle = outline; c.lineWidth = 1.4;
        for (var r2 = 0; r2 < s.rings.length; r2++) { c.beginPath(); traceRing(c, s.rings[r2]); c.stroke(); }
      }
    });
    c.restore();
  }

  function drawRegionHighlight(c) {
    var ST = BS();
    var idx = S.regionSel != null ? S.regionSel : MAP.hoverRegion;
    if (idx == null || S.layers.regions === false) return;
    var shapes = regionShapesOf(idx);
    if (!shapes.length) return;
    // 区域多边形是格网坐标：先套用世界→屏幕变换，否则会画在画布左上角
    var z = MAP.cam.z, cw = MAP.cv.clientWidth, ch = MAP.cv.clientHeight;
    c.save();
    c.translate(cw / 2 - MAP.cam.x * z, ch / 2 - MAP.cam.y * z);
    c.scale(z, z);
    fillShapes(c, shapes, ST.region, null, idx === S.regionSel ? 0.22 : 0.09);
    if (idx === S.regionSel) {
      c.strokeStyle = ST.region; c.lineWidth = 2.4 / z;
      shapes.forEach(function (s) {
        for (var r = 0; r < s.rings.length; r++) { c.beginPath(); traceRing(c, s.rings[r]); c.stroke(); }
      });
    }
    c.restore();
  }

  function drawRadiusHalos(c) {
    var z = MAP.cam.z;
    var list = markers();
    // 职住中心影响半径（km → 4 格）
    list.forEach(function (m) {
      if (m.kind !== 'centers') return;
      var p = w2s(m.x, m.y), rr = m.radius * z;
      if (rr < 3) return;
      var on = sameItem(m) || (MAP.hover && selKey(MAP.hover) === selKey(m));
      c.save();
      c.globalAlpha = on ? .4 : .16;
      c.strokeStyle = m.color; c.lineWidth = on ? 1.6 : 1;
      c.setLineDash([4, 4]);
      c.beginPath(); c.arc(p[0], p[1], rr, 0, Math.PI * 2); c.stroke();
      c.restore();
    });
    // 锚点半径（格）与当前任务连线
    var focused = S.taskFocus;
    list.forEach(function (m) {
      if (m.kind !== 'anchors') return;
      var p = w2s(m.x, m.y), rr = m.radius * z;
      var on = sameItem(m) || (focused && m.task === focused);
      if (rr < 3 && !on) return;
      c.save();
      c.globalAlpha = on ? .42 : .13;
      c.strokeStyle = m.color; c.lineWidth = on ? 1.5 : 1;
      c.setLineDash([3, 5]);
      c.beginPath(); c.arc(p[0], p[1], Math.max(2, rr), 0, Math.PI * 2); c.stroke();
      c.restore();
    });
    if (focused && focused.anchors && focused.anchors.length > 1) {
      c.save();
      c.globalAlpha = .5;
      c.strokeStyle = BS().mark.anchors; c.lineWidth = 1.2; c.setLineDash([5, 4]);
      c.beginPath();
      focused.anchors.forEach(function (a, i) {
        var p = w2s(a.x, a.y);
        if (i === 0) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]);
      });
      c.stroke();
      c.restore();
    }
    // 选中的独立设施半径
    var sel = itemOf(S.sel);
    if (S.sel && S.sel.kind === 'facilities' && sel && !sel.lm) {
      var fp = facilityPos(sel); if (fp) {
        var p2 = w2s(fp.x, fp.y), rr2 = facilityRadius(sel) * z;
        c.save(); c.globalAlpha = .5; c.strokeStyle = BS().mark.facilities; c.lineWidth = 1.3; c.setLineDash([4, 3]);
        c.beginPath(); c.arc(p2[0], p2[1], Math.max(2, rr2), 0, Math.PI * 2); c.stroke(); c.restore();
      }
    }
  }

  function drawFootprint(c) {
    var m = null;
    if (S.sel && S.sel.kind === 'landmarks') m = markerOfSel(S.sel);
    else if (MAP.hover && MAP.hover.kind === 'landmarks') m = MAP.hover;
    if (!m || !m.item) return;
    var l = m.item;
    if (!isNum(l.w) || !isNum(l.d)) return;
    var z = MAP.cam.z, p = w2s(l.x, l.y);
    var w = Math.max(3, l.w / CM.CFG.CELL_M * z), d = Math.max(3, l.d / CM.CFG.CELL_M * z);
    c.save();
    c.translate(p[0], p[1]);
    c.rotate((isNum(l.rot) ? l.rot : 0) * Math.PI / 180);
    c.globalAlpha = .18;
    c.fillStyle = BS().mark.landmarks;
    c.strokeStyle = BS().mark.landmarks;
    c.lineWidth = 1.2;
    if (c.roundRect) { c.beginPath(); c.roundRect(-w / 2, -d / 2, w, d, 2); c.fill(); c.globalAlpha = .85; c.stroke(); }
    else { c.fillRect(-w / 2, -d / 2, w, d); c.globalAlpha = .85; c.strokeRect(-w / 2, -d / 2, w, d); }
    c.restore();
  }

  function drawRegionLabels(c) {
    MAP.regionLabels = [];
    if (S.layers.regions === false) return;
    var z = MAP.cam.z;
    if (z < 4) return;
    var ST = BS(), cw = MAP.cv.clientWidth, ch = MAP.cv.clientHeight;
    var font = (z > 9 ? 11 : 10) + 'px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
    c.save();
    c.font = font;
    c.textBaseline = 'middle';
    var occupied = [];
    MAP.regions.forEach(function (r, idx) {
      if (!r.center) return;
      var p = w2s(r.center[0], r.center[1]);
      if (p[0] < -80 || p[1] < -20 || p[0] > cw + 80 || p[1] > ch + 20) return;
      var txt = r.rg.name || r.rg.id || '区域';
      if (txt.length > 16) txt = txt.slice(0, 15) + '…';
      var w = c.measureText(txt).width, h = 15;
      var rect = [p[0] - w / 2 - 3, p[1] - h / 2, w + 6, h];
      for (var i = 0; i < occupied.length; i++) {
        var o = occupied[i];
        if (!(rect[0] > o[0] + o[2] || rect[0] + rect[2] < o[0] || rect[1] > o[1] + o[3] || rect[1] + rect[3] < o[1])) return;
      }
      occupied.push(rect);
      MAP.regionLabels.push({ idx: idx, x: p[0], y: p[1], w: w, h: h, text: txt });
      var ghost = S.year != null && isNum(r.rg.open) && r.rg.open > S.year;
      var on = S.regionSel === idx || MAP.hoverRegion === idx;
      c.globalAlpha = ghost ? .32 : (on ? 1 : .78);
      c.fillStyle = on ? ST.region : ST.regionText;
      c.strokeStyle = ST.halo; c.lineWidth = 3;
      c.strokeText(txt, p[0] - w / 2, p[1]);
      c.fillText(txt, p[0] - w / 2, p[1]);
      if (S.regionSel === idx) {
        c.globalAlpha = .5;
        c.strokeStyle = ST.region; c.lineWidth = 1;
        c.beginPath(); c.moveTo(p[0] - w / 2, p[1] + 8); c.lineTo(p[0] + w / 2, p[1] + 8); c.stroke();
      }
    });
    c.restore();
  }

  function markerShape(c, p, m, selected, ghost) {
    var r = selected ? 6.5 : (MAP.hover && selKey(MAP.hover) === selKey(m) ? 5.5 : 4.4);
    var alpha = ghost ? .34 : (m.derived ? .6 : .96);
    c.save();
    c.globalAlpha = alpha;
    c.fillStyle = m.color;
    c.strokeStyle = BS().halo;
    c.lineWidth = 1.5;
    if (selected) {
      c.globalAlpha = .18;
      c.beginPath(); c.arc(p[0], p[1], r + 7, 0, Math.PI * 2); c.fillStyle = m.color; c.fill();
      c.globalAlpha = alpha;
      c.fillStyle = m.color;
    }
    if (m.kind === 'centers') {
      c.beginPath(); c.arc(p[0], p[1], r, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = BS().halo;
      c.beginPath(); c.arc(p[0], p[1], Math.max(1.2, r * .34), 0, Math.PI * 2); c.fill();
    } else if (m.kind === 'landmarks') {
      c.translate(p[0], p[1]); c.rotate(Math.PI / 4);
      if (ghost) c.setLineDash([2, 2]);
      c.beginPath(); c.rect(-r * .8, -r * .8, r * 1.6, r * 1.6); c.fill(); c.stroke();
    } else if (m.kind === 'facilities') {
      if (m.derived) {
        c.beginPath(); c.arc(p[0], p[1], r, 0, Math.PI * 2); c.strokeStyle = m.color; c.lineWidth = 2; c.stroke();
      } else {
        c.beginPath();
        if (c.roundRect) c.roundRect(p[0] - r * .85, p[1] - r * .85, r * 1.7, r * 1.7, 1.6);
        else c.rect(p[0] - r * .85, p[1] - r * .85, r * 1.7, r * 1.7);
        c.fill(); c.stroke();
      }
    } else if (m.kind === 'anchors') {
      c.beginPath(); c.arc(p[0], p[1], r * .9, 0, Math.PI * 2); c.fill(); c.stroke();
      c.strokeStyle = BS().ink; c.globalAlpha = alpha * .75; c.lineWidth = 1;
      c.beginPath();
      c.moveTo(p[0] - r - 3, p[1]); c.lineTo(p[0] - r * .9, p[1]);
      c.moveTo(p[0] + r * .9, p[1]); c.lineTo(p[0] + r + 3, p[1]);
      c.moveTo(p[0], p[1] - r - 3); c.lineTo(p[0], p[1] - r * .9);
      c.moveTo(p[0], p[1] + r * .9); c.lineTo(p[0], p[1] + r + 3);
      c.stroke();
    }
    c.restore();
    if (selected) {
      c.save();
      c.strokeStyle = BS().ink; c.globalAlpha = .9; c.lineWidth = 1.3;
      c.beginPath(); c.arc(p[0], p[1], r + 3.5, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
  }

  function drawMarkers(c) {
    var z = MAP.cam.z, cw = MAP.cv.clientWidth, ch = MAP.cv.clientHeight;
    var list = markers().slice().sort(function (a, b) {
      var rank = { centers: 0, anchors: 1, facilities: 2, landmarks: 3 };
      return rank[a.kind] - rank[b.kind];
    });
    var visible = [];
    list.forEach(function (m) {
      var p = w2s(m.x, m.y);
      if (p[0] < -40 || p[1] < -40 || p[0] > cw + 40 || p[1] > ch + 40) return;
      m._p = p;
      visible.push(m);
    });
    visible.forEach(function (m) { markerShape(c, m._p, m, sameItem(m), markerGhost(m)); });

    // 标签：选中 > 悬停 > 地标 > 锚点 > 设施 > 中心
    var order = visible.slice().sort(function (a, b) {
      function score(m) {
        if (sameItem(m)) return 0;
        if (MAP.hover && selKey(MAP.hover) === selKey(m)) return 1;
        return { landmarks: 2, anchors: 3, facilities: 4, centers: 5 }[m.kind] || 9;
      }
      return score(a) - score(b);
    });
    var occupied = [];
    c.save();
    c.textBaseline = 'middle';
    order.forEach(function (m) {
      var selected = sameItem(m), hover = MAP.hover && selKey(MAP.hover) === selKey(m);
      var focusedAnchor = m.kind === 'anchors' && S.taskFocus === m.task;
      var show = !!m.label && (selected || hover || z >= 9 || (m.kind === 'landmarks' && z >= 6) || focusedAnchor);
      if (!show) return;
      var text = m.label;
      if (!text) return;
      if (text.length > 22) text = text.slice(0, 21) + '…';
      var font = (selected ? '600 ' : '') + '11px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
      c.font = font;
      var tw = c.measureText(text).width;
      var p = m._p;
      var lx = p[0] + 8, ly = p[1] - 7;
      var rect = [lx - 2, ly - 7, tw + 5, 14];
      if (lx + tw > cw - 6) { lx = p[0] - tw - 10; rect[0] = lx - 2; }
      if (ly < 4) ly = p[1] + 7;
      for (var i = 0; i < occupied.length; i++) {
        var o = occupied[i];
        if (!(rect[0] > o[0] + o[2] || rect[0] + rect[2] < o[0] || rect[1] > o[1] + o[3] || rect[1] + rect[3] < o[1])) {
          if (!selected && !hover) return;
        }
      }
      occupied.push(rect);
      c.globalAlpha = markerGhost(m) ? .42 : 1;
      c.fillStyle = BS().halo;
      if (c.roundRect) { c.beginPath(); c.roundRect(rect[0], rect[1], rect[2], rect[3], 3); c.fill(); }
      else c.fillRect(rect[0], rect[1], rect[2], rect[3]);
      c.fillStyle = selected ? BS().mark[m.kind] : BS().ink;
      c.fillText(text, lx, ly);
    });
    c.restore();
  }

  function updateScaleBar() {
    var box = $('scalebar'); if (!box) return;
    var z = MAP.cam.z;
    var opts = [[4, '1 km'], [8, '2 km'], [20, '5 km'], [40, '10 km'], [80, '20 km']];
    var pick = opts[0];
    for (var i = 0; i < opts.length; i++) if (opts[i][0] * z <= 140) pick = opts[i];
    box.querySelector('i').style.width = (pick[0] * z) + 'px';
    box.querySelector('span').textContent = pick[1];
  }

  // ============================================================ 拾取

  var PICK_RANK = { anchors: 0, facilities: 1, landmarks: 2, centers: 3 };
  function pickAll(px, py) {
    var out = [], R = 13;
    markers().forEach(function (m) {
      var p = w2s(m.x, m.y), d = Math.hypot(p[0] - px, p[1] - py);
      if (d <= R) out.push({ m: m, d: d });
    });
    out.sort(function (a, b) {
      var da = Math.round(a.d / 2), db = Math.round(b.d / 2);
      return (da - db) || (PICK_RANK[a.m.kind] - PICK_RANK[b.m.kind]) || (a.m.idx - b.m.idx);
    });
    return out.map(function (o) { return o.m; });
  }
  function pick(px, py) { var l = pickAll(px, py); return l.length ? l[0] : null; }
  function pickRegionLabel(px, py) {
    var l = MAP.regionLabels;
    for (var i = 0; i < l.length; i++) {
      var r = l[i];
      if (px >= r.x - r.w / 2 - 4 && px <= r.x + r.w / 2 + 4 && py >= r.y - 9 && py <= r.y + 9) return r.idx;
    }
    return null;
  }
  function resolveDrag(m) {
    if (!m) return null;
    if (m.kind === 'facilities' && m.derived) {
      var f = facilityList()[m.idx];
      if (!f || !f.lm) return null;
      var idx = -1, list = landmarkList();
      list.forEach(function (l, i) { if (l.id === f.lm) idx = i; });
      return idx < 0 ? null : { kind: 'landmarks', idx: idx };
    }
    return markerSel(m);
  }

  function moveSelected(x, y) {
    var item = itemOf(S.sel); if (!item) return;
    if (S.sel.kind === 'facilities') {
      if (item.lm) return;
      item.at = [r2(x), r2(y)];
    } else if (S.sel.kind === 'regions') {
      return;
    } else { item.x = r2(x); item.y = r2(y); }
    touch({ draw: false });
    scheduleDraw();
  }

  // ============================================================ 放置与删除

  function uniqueId(prefix, list) {
    var n = list.length + 1, id = prefix + n;
    var used = {};
    list.forEach(function (x) { if (x && x.id) used[x.id] = 1; });
    while (used[id]) { n++; id = prefix + n; }
    return id;
  }

  function currentTask() {
    if (S.sel && S.sel.kind === 'anchors') return taskList()[S.sel.taskIdx] || null;
    if (S.taskFocus) return S.taskFocus;
    if (S.sheet.open && S.sheet.tab === 'tasks') return taskList()[S.sheet.taskIdx] || null;
    return null;
  }

  function placeAt(kind, w) {
    if (!S.src) return;
    var d = data(), x = r2(w[0]), y = r2(w[1]), y0 = startYear();
    if (kind === 'landmarks') {
      d.landmarks = d.landmarks || [];
      d.landmarks.push({ id: uniqueId('lm', d.landmarks), name: '新地标', kind: 'box', x: x, y: y, year: y0, w: 60, d: 60, h: 40 });
      S.sel = { kind: 'landmarks', idx: d.landmarks.length - 1 };
      S.regionSel = null;
    } else if (kind === 'facilities') {
      d.facilities = d.facilities || [];
      d.facilities.push({ id: uniqueId('f', d.facilities), n: '新设施', t: 'shop', at: [x, y] });
      S.sel = { kind: 'facilities', idx: d.facilities.length - 1 };
      S.regionSel = null;
    } else if (kind === 'centers') {
      d.centers = d.centers || [];
      d.centers.push({ x: x, y: y, pop: 10000, jobs: 5000, r: 2 });
      S.sel = { kind: 'centers', idx: d.centers.length - 1 };
      S.regionSel = null;
    } else if (kind === 'anchors') {
      var t = currentTask();
      if (!t) { toast('先在「数据 → 任务」里选中一个任务，再放置锚点'); return; }
      t.anchors = t.anchors || [];
      t.anchors.push({ name: '新锚点', x: x, y: y, r: 4 });
      var ti = taskList().indexOf(t);
      S.sel = { kind: 'anchors', idx: t.anchors.length - 1, taskIdx: ti };
      S.taskFocus = t;
      S.regionSel = null;
    } else return;
    S.tool = 'select';
    touch({ now: true, draw: true });
    precheck();
    renderToolbar();
    renderDock();
    renderInspector();
    renderBrowser();
    renderSheetIfOpen();
    scheduleDraw();
    toast('已放置' + entityTypeName(kind) + '，拖动可调整位置');
  }

  function deleteSelected() {
    if (!S.sel || !S.src) return;
    var sel = S.sel, d = data(), item = itemOf(sel);
    if (!item) { S.sel = null; renderInspector(); scheduleDraw(); return; }
    var label = ENTITY[sel.kind] ? ENTITY[sel.kind].one : '对象';
    if (sel.kind === 'landmarks') {
      var followers = facilityList().filter(function (f) { return f.lm && f.lm === item.id; }).length;
      if (followers && !window.confirm('有 ' + followers + ' 个设施跟随这个地标，删除后它们会失去定位。继续？')) return;
    }
    if (sel.kind === 'anchors') {
      var t = taskList()[sel.taskIdx];
      if (!t || !t.anchors) return;
      t.anchors.splice(sel.idx, 1);
    } else {
      (d[sel.kind] || []).splice(sel.idx, 1);
    }
    S.sel = null;
    touch({ now: true, draw: true });
    precheck();
    renderDock();
    renderInspector();
    renderBrowser();
    renderSheetIfOpen();
    draw();
    toast('已删除' + label);
  }

  function nudgeSelected(dx, dy, big) {
    if (!S.sel || !S.src) return;
    var item = itemOf(S.sel); if (!item) return;
    var step = big ? 1 : 0.25;
    if (S.sel.kind === 'facilities') {
      if (item.lm) { toast('该设施跟随地标，请拖动地标'); return; }
      item.at = [r2((item.at ? item.at[0] : 0) + dx * step), r2((item.at ? item.at[1] : 0) + dy * step)];
    } else if (S.sel.kind === 'regions') return;
    else {
      item.x = r2((isNum(item.x) ? item.x : 0) + dx * step);
      item.y = r2((isNum(item.y) ? item.y : 0) + dy * step);
    }
    touch({ now: true, draw: true });
    renderInspector();
    ensureVisible(item.at ? item.at[0] : item.x, item.at ? item.at[1] : item.y);
  }

  // ============================================================ 点击与选择

  function clickCanvas(px, py) {
    if (!S.src) return;
    var world = s2w(px, py);
    if (S.tool !== 'select') { placeAt(S.tool, world); return; }
    var list = pickAll(px, py);
    if (list.length) {
      var i = 0, cyc = MAP.cycle;
      var near = cyc && Math.abs(cyc.x - px) < 5 && Math.abs(cyc.y - py) < 5;
      if (near) {
        i = (cyc.i + 1) % list.length;
        for (var k = 0; k < list.length; k++) if (sameItem(list[k])) { i = (k + 1) % list.length; break; }
      }
      var m = list[i];
      MAP.cycle = { x: px, y: py, i: i };
      MAP.overlap = list.length;
      select(markerSel(m));
      return;
    }
    MAP.cycle = null; MAP.overlap = 0;
    var rg = pickRegionLabel(px, py);
    if (rg != null) { selectRegion(rg, { open: true }); return; }
    clearSelection();
    if (S.regionSel != null) { S.regionSel = null; scheduleDraw(); }
  }

  // ============================================================ 指针交互

  function updatePointerReadout(px, py, world) {
    var box = $('stPos');
    if (box && world) box.textContent = 'x ' + world[0].toFixed(2) + ' · y ' + world[1].toFixed(2) + ' 格';
    updateMapTip(px, py);
  }

  function updateMapTip(px, py) {
    var tip = $('mapTip'); if (!tip) return;
    var m = MAP.hover;
    var rg = m ? null : MAP.hoverRegion;
    if (!m && rg == null) { tip.classList.remove('on'); return; }
    clear(tip);
    if (m) {
      var type = ENTITY[m.kind] ? ENTITY[m.kind].one : '对象';
      var sub = '';
      if (m.kind === 'landmarks') sub = (m.item.year || '—') + ' 年 · ' + (m.item.kind || '地标') + (m.item.style ? ' · ' + m.item.style : '');
      else if (m.kind === 'facilities') sub = (CM.Fac.TYPES[m.item.t] ? CM.Fac.TYPES[m.item.t].name : m.item.t) + (m.derived ? ' · 跟随地标' : '') + (m.item.id ? ' · ' + m.item.id : '');
      else if (m.kind === 'centers') sub = '人口 ' + short(m.item.pop) + ' · 岗位 ' + short(m.item.jobs);
      else if (m.kind === 'anchors') sub = taskName(m.task) + ' · 半径 ' + anchorRadius(m.item) + ' 格';
      tip.appendChild(h('b', null, m.label || type));
      tip.appendChild(h('span', null, type + (sub ? ' · ' + sub : '')));
      if (markerGhost(m)) tip.appendChild(h('span', { class: 'warn' }, '当前年代未出现'));
    } else {
      var r = MAP.regions[rg];
      tip.appendChild(h('b', null, r ? (r.rg.name || r.rg.id) : '区域'));
      tip.appendChild(h('span', null, '区域 · ' + (r && isNum(r.rg.open) ? (r.rg.open + ' 年开放') : '永久保护 / 默认') + ' · 点击编辑'));
    }
    tip.classList.add('on');
    var w = tip.offsetWidth || 180, ht = tip.offsetHeight || 40;
    var x = px + 16, y = py + 18;
    if (x + w > window.innerWidth - 8) x = px - w - 14;
    if (y + ht > window.innerHeight - 8) y = py - ht - 14;
    tip.style.left = Math.max(6, x) + 'px';
    tip.style.top = Math.max(6, y) + 'px';
  }

  function updateStatusSel() {
    var box = $('stSel'); if (!box) return;
    if (!S.src) { box.textContent = '—'; return; }
    var m = markerOfSel(S.sel);
    if (m) { box.textContent = ENTITY[m.kind].one + ' · ' + (m.label || ''); return; }
    if (S.regionSel != null) { box.textContent = '区域 · ' + regionName(S.regionSel); return; }
    box.textContent = S.src.meta ? (S.src.meta.title || S.src.meta.name || '') : '—';
  }

  function bindWindowOnce() {
    if (MAP.bound) return;
    MAP.bound = true;
    var cv = MAP.cv;
    if (!cv) return;

    cv.addEventListener('pointerdown', function (e) {
      if (!S.src) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelFly();
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      var r = cv.getBoundingClientRect();
      var px = e.clientX - r.left, py = e.clientY - r.top;
      MAP.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(MAP.pointers);
      if (ids.length === 2) {
        var pts = ids.map(function (id) { return MAP.pointers[id]; });
        MAP.pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), z: MAP.cam.z };
        MAP.drag = null;
        if (MAP.down) MAP.down.moved = true;
        return;
      }
      if (ids.length > 2) return;
      var list = pickAll(px, py), hitM = null;
      for (var i = 0; i < list.length; i++) if (sameItem(list[i])) { hitM = list[i]; break; }
      if (!hitM && list.length) hitM = list[0];
      MAP.down = { id: e.pointerId, x: e.clientX, y: e.clientY, px: px, py: py, cam: [MAP.cam.x, MAP.cam.y], moved: false, hit: hitM };
      MAP.drag = null;
      MAP.gesture = false;
      cv.style.cursor = 'grabbing';
      var tip = $('mapTip'); if (tip) tip.classList.remove('on');
    });

    window.addEventListener('pointermove', function (e) {
      var cv2 = MAP.cv; if (!cv2) return;
      if (MAP.pointers[e.pointerId]) MAP.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var r = cv2.getBoundingClientRect();
      var px = e.clientX - r.left, py = e.clientY - r.top;
      var world = s2w(px, py);

      if (MAP.pinch) {
        var ids2 = Object.keys(MAP.pointers);
        if (ids2.length >= 2) {
          var a = MAP.pointers[ids2[0]], b = MAP.pointers[ids2[1]];
          var d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > 4 && MAP.pinch.d > 4) {
            var mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
            var before = s2w(mid.x, mid.y);
            MAP.cam.z = clamp(MAP.pinch.z * d / MAP.pinch.d, 2.5, 40);
            var after = s2w(mid.x, mid.y);
            MAP.cam.x += before[0] - after[0]; MAP.cam.y += before[1] - after[1];
            clampCam();
            MAP.gesture = true;
            scheduleDraw();
          }
        }
        return;
      }

      if (MAP.down && e.pointerId === MAP.down.id) {
        var dx = e.clientX - MAP.down.x, dy = e.clientY - MAP.down.y;
        if (!MAP.down.moved) {
          if (Math.abs(dx) + Math.abs(dy) <= 3) return;
          MAP.down.moved = true;
          MAP.drag = resolveDrag(MAP.down.hit);
          if (MAP.drag) {
            select(MAP.drag);
            MAP.overlap = 0;
          }
        }
        if (MAP.drag) {
          moveSelected(world[0], world[1]);
          updatePointerReadout(px, py, world);
          return;
        }
        MAP.cam.x = MAP.down.cam[0] - dx / MAP.cam.z;
        MAP.cam.y = MAP.down.cam[1] - dy / MAP.cam.z;
        clampCam();
        scheduleDraw();
        updatePointerReadout(px, py, world);
        return;
      }

      // hover
      if (e.pointerType !== 'mouse' && !MAP.hover) return;
      var hm = pick(px, py);
      var hr = hm ? null : pickRegionLabel(px, py);
      var changed = (hm ? selKey(hm) : '') !== (MAP.hover ? selKey(MAP.hover) : '') || hr !== MAP.hoverRegion;
      MAP.hover = hm;
      MAP.hoverRegion = hr;
      if (changed) scheduleDraw();
      cv2.style.cursor = S.tool !== 'select' ? 'crosshair' : (hm ? 'pointer' : (hr != null ? 'pointer' : 'grab'));
      updatePointerReadout(px, py, world);
    });

    window.addEventListener('pointerup', function (e) {
      var cv3 = MAP.cv; if (!cv3) return;
      delete MAP.pointers[e.pointerId];
      if (MAP.pinch) {
        if (Object.keys(MAP.pointers).length < 2) {
          MAP.pinch = null;
          MAP.down = null;
          MAP.drag = null;
          cv3.style.cursor = 'grab';
        }
        return;
      }
      if (!MAP.down || e.pointerId !== MAP.down.id) return;
      var r = cv3.getBoundingClientRect();
      var px = e.clientX - r.left, py = e.clientY - r.top;
      var inside = px >= 0 && py >= 0 && px <= cv3.clientWidth && py <= cv3.clientHeight;
      var wasMoved = MAP.down.moved;
      var wasDrag = wasMoved && !!MAP.drag;
      MAP.drag = null;
      if (wasMoved) {
        if (wasDrag) { commitHistory(); renderInspector(); scheduleDraw(); }
        MAP.down = null;
        cv3.style.cursor = S.tool !== 'select' ? 'crosshair' : 'grab';
        return;
      }
      if (inside) clickCanvas(px, py);
      MAP.down = null;
      cv3.style.cursor = S.tool !== 'select' ? 'crosshair' : 'grab';
    });

    cv.addEventListener('wheel', function (e) {
      if (!S.src) return;
      e.preventDefault();
      cancelFly();
      var r = cv.getBoundingClientRect();
      var px = e.clientX - r.left, py = e.clientY - r.top;
      var before = s2w(px, py);
      var f = Math.exp(-e.deltaY * 0.0015);
      MAP.cam.z = clamp(MAP.cam.z * f, 2.5, 40);
      var after = s2w(px, py);
      MAP.cam.x += before[0] - after[0]; MAP.cam.y += before[1] - after[1];
      clampCam();
      scheduleDraw();
    }, { passive: false });

    cv.addEventListener('pointerleave', function () {
      if (MAP.down) return;
      MAP.hover = null; MAP.hoverRegion = null;
      var tip = $('mapTip'); if (tip) tip.classList.remove('on');
      scheduleDraw();
    });

    window.addEventListener('resize', function () { scheduleDraw(); });
    window.addEventListener('blur', function () { MAP.pointers = {}; MAP.pinch = null; MAP.down = null; MAP.drag = null; });
  }

  // ============================================================ 载入底图

  function setupMapVisuals() {
    if (!S.src) {
      MAP.ix = null; MAP.base = null; MAP.regions = []; MAP.regionLabels = [];
      scheduleDraw();
      return;
    }
    var token = ++MAP.loadToken;
    var key = geoKey();
    MAP.geoId = key;
    MAP.ix = null; MAP.base = null; MAP.regions = [];
    MAP.cam = { x: mapW() / 2, y: mapH() / 2, z: 7 };
    fitMap();
    normalizeYear();
    rebuildRegionShapes();
    scheduleDraw();

    if (!key) { scheduleDraw(); return; }
    var inline = S.src.meta && S.src.meta.geo === 'inline';
    var mapId = (S.src.meta && S.src.meta.id) || '';
    var loader = inline ? loadInlineGeo(mapId) : loadGeoScript(key);
    loader.then(function (G) {
      if (token !== MAP.loadToken || !S.src) return;
      MAP.geo = G || null;
      MAP.ix = prepareGeo(G);
      MAP.base = MAP.ix ? buildBase(MAP.ix) : null;
      if (!G) toast('这张图没有可用的地理底图（geo: inline），只显示坐标网格');
      rebuildRegionShapes();
      normalizeYear();
      scheduleDraw();
      renderBrowser();
    }).catch(function (err) {
      if (token !== MAP.loadToken) return;
      toast(err.message || '底图加载失败');
      scheduleDraw();
    });
  }

  // ============================================================ 选择

  function select(sel, opts) {
    if (!S.src) return;
    S.sel = sel ? { kind: sel.kind, idx: sel.idx, taskIdx: sel.taskIdx } : null;
    S.regionSel = null;
    if (S.sel && S.sel.kind === 'anchors') {
      var t = taskList()[S.sel.taskIdx];
      if (t) S.taskFocus = t;
      if (S.sheet.open && S.sheet.tab === 'tasks') S.sheet.taskIdx = S.sel.taskIdx;
    } else if (S.sel) {
      S.taskFocus = null;
    }
    renderInspector();
    renderBrowser();
    updateStatusSel();
    scheduleDraw();
    if (opts && opts.focus) { var m = markerOfSel(S.sel); if (m) ensureVisible(m.x, m.y); }
  }

  function clearSelection() {
    S.sel = null;
    MAP.overlap = 0;
    MAP.cycle = null;
    if (!(S.sheet.open && S.sheet.tab === 'tasks')) S.taskFocus = null;
    renderInspector();
    renderBrowser();
    updateStatusSel();
    scheduleDraw();
  }

  function selectRegion(idx, opts) {
    if (!S.src) return;
    opts = opts || {};
    S.regionSel = idx;
    S.sel = null;
    S.taskFocus = null;
    MAP.cycle = null;
    if (opts.open) {
      S.sheet.regionIdx = idx;
      openSheet('regions', { regionIdx: idx });
    } else if (S.sheet.open && S.sheet.tab === 'regions') {
      S.sheet.regionIdx = idx;
      renderSheet();
    }
    var r = MAP.regions[idx];
    if (opts.focus && r && r.center) flyTo(r.center[0], r.center[1], Math.max(9, MAP.cam.z));
    else ensureRegionVisible(idx);
    renderInspector();
    renderBrowser();
    updateStatusSel();
    scheduleDraw();
  }

  function pruneSelection() {
    if (!S.src) return;
    if (S.sel) {
      var it = itemOf(S.sel);
      if (!it) S.sel = null;
    }
    var regs = regionList(), tasks = taskList();
    if (S.regionSel != null && !regs[S.regionSel]) S.regionSel = null;
    if (S.sheet.regionIdx >= regs.length) S.sheet.regionIdx = Math.max(0, regs.length - 1);
    if (S.sheet.taskIdx >= tasks.length) S.sheet.taskIdx = Math.max(0, tasks.length - 1);
    if (S.taskFocus && tasks.indexOf(S.taskFocus) < 0) S.taskFocus = null;
  }

  // ============================================================ 顶栏与文件

  function updateFileChrome() {
    if (!S.src) {
      document.body.classList.remove('has-map', 'dirty', 'sheet-open');
      document.title = '地图编辑器 · 城市与地铁';
      var fp0 = $('filePath');
      if (fp0) fp0.textContent = '未打开 source.json';
      var mi0 = $('mapTitle');
      if (mi0) mi0.textContent = '选择一张地图';
      var ms0 = $('mapSub');
      if (ms0) ms0.textContent = '示例地图或打开本地 source.json';
      var sv0 = $('btnSave');
      if (sv0) sv0.disabled = true;
      updateUndoButtons();
      return;
    }
    document.body.classList.add('has-map');
    var d = data(), m = S.src.meta || {};
    var fp = $('filePath');
    if (fp) {
      clear(fp);
      append(fp, (S.dir ? S.dir + '/' : '') + (S.name || 'source.json'));
      if (snap() !== H.saved) fp.appendChild(h('span', { class: 'star', text: ' *' }));
    }
    var mi = $('mapTitle');
    if (mi) mi.textContent = m.title || m.name || m.id || '未命名地图';
    var ms = $('mapSub');
    if (ms) {
      var parts = [mapW() + '×' + mapH() + ' 格'];
      if ((d.regions || []).length) parts.push((d.regions || []).length + ' 区域');
      if ((d.landmarks || []).length) parts.push((d.landmarks || []).length + ' 地标');
      if ((d.facilities || []).length) parts.push((d.facilities || []).length + ' 设施');
      if ((d.histTasks || []).length) parts.push((d.histTasks || []).length + ' 任务');
      ms.textContent = parts.join(' · ');
    }
    document.title = (snap() !== H.saved ? '* ' : '') + (m.title || m.name || '地图编辑器') + ' · 地图编辑器';
    var sv = $('btnSave');
    if (sv) sv.disabled = false;
    updateUndoButtons();
  }

  function initTopbar() {
    var brand = $('brandBadge');
    if (brand) brand.appendChild(icon('map'));
    var undo = $('btnUndo'); if (undo) undo.appendChild(icon('undo'));
    var redo = $('btnRedo'); if (redo) redo.appendChild(icon('redo'));
    var open = $('btnOpen');
    if (open) { clear(open); open.appendChild(icon('folder')); open.appendChild(h('span', { class: 'lb', text: '打开' })); }
    var save = $('btnSave');
    if (save) { clear(save); save.appendChild(icon('save')); save.appendChild(h('span', { text: '保存' })); }
    var dark = $('btnTheme');
    if (dark) dark.appendChild(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
    var help = $('btnHelp'); if (help) help.appendChild(icon('help'));
    var menu = $('btnMenu'); if (menu) menu.appendChild(icon('menu'));
    var dataBtn = $('btnData');
    if (dataBtn) { clear(dataBtn); dataBtn.appendChild(icon('report')); dataBtn.appendChild(h('span', { class: 'lb', text: '数据' })); }
    var yearBtn = $('btnYear');
    if (yearBtn) { clear(yearBtn); yearBtn.appendChild(icon('clock')); yearBtn.appendChild(h('span', { class: 'lb', text: '全部年代' })); }
    var iss = $('btnIssues');
    if (iss) { clear(iss); iss.appendChild(icon('warn')); iss.appendChild(h('span', { class: 'lb', text: '预检' })); iss.appendChild(h('span', { class: 'n', id: 'issCount', text: '—' })); }
    var yIco = $('yearPopIco'); if (yIco) yIco.appendChild(icon('clock'));
    var iIco = $('issuePopIco'); if (iIco) iIco.appendChild(icon('warn'));
    var bClose = $('browserClose'); if (bClose) bClose.appendChild(icon('close'));
    var sClose = $('sheetClose'); if (sClose) sClose.appendChild(icon('close'));
    var hClose = $('helpClose'); if (hClose) hClose.appendChild(icon('close'));
    var bIco = $('browserSearchIco'); if (bIco) bIco.appendChild(icon('search'));
    var lLogo = $('landingLogo'); if (lLogo) lLogo.appendChild(icon('map'));
    var lOpen = $('landingOpen');
    if (lOpen) { clear(lOpen); lOpen.appendChild(icon('folder')); lOpen.appendChild(h('span', { text: '打开本地 source.json' })); }

    $('btnUndo').onclick = undo;
    $('btnRedo').onclick = redo;
    $('btnOpen').onclick = openFile;
    $('btnSave').onclick = function () { saveFile(false); };
    $('btnTheme').onclick = function () { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); };
    $('btnHelp').onclick = showHelp;
    $('btnMenu').onclick = function (e) { e.stopPropagation(); togglePop('filePop'); };
    $('btnYear').onclick = function (e) { e.stopPropagation(); togglePop('yearPop'); };
    $('btnIssues').onclick = function (e) { e.stopPropagation(); togglePop('issuePop'); };
    $('btnData').onclick = function (e) { e.stopPropagation(); if (S.sheet.open) closeSheet(); else openSheet(S.sheet.tab || 'meta'); };
    $('sheetClose').onclick = closeSheet;
    $('browserClose').onclick = closeBrowser;
    $('helpClose').onclick = hideHelp;
    $('landingOpen').onclick = openFile;
    $('landingHelp').onclick = showHelp;
    $('helpOverlay').addEventListener('click', function (e) { if (e.target === $('helpOverlay')) hideHelp(); });
    $('issueRecheck').onclick = function () { precheck(); renderIssues(); toast('已重新校验'); };
    $('yearStart').onclick = function () { setYear(startYear()); };
    $('yearAll').onclick = function () { setYear(null); };
    $('yearPlay').onclick = toggleYearPlay;
    $('browserSearch').oninput = function () { S.browser.q = $('browserSearch').value.trim(); renderBrowser(); };
    $('yearSlider').oninput = function () {
      stopYearPlay();
      var v = Number($('yearSlider').value);
      setYear(v >= S.yearMax ? null : v);
    };

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.onclick = function () { closePop(b.getAttribute('data-close')); };
    });
    document.addEventListener('pointerdown', function (e) {
      if (!S.pop) return;
      var pop = $(S.pop);
      if (!pop || pop.contains(e.target)) return;
      var trig = { yearPop: 'btnYear', issuePop: 'btnIssues', filePop: 'btnMenu' }[S.pop];
      if (trig && $(trig) && $(trig).contains(e.target)) return;
      closePop(S.pop);
    }, true);
    window.addEventListener('resize', function () {
      if (S.pop) positionPop($(S.pop), S.pop === 'yearPop' ? $('btnYear') : (S.pop === 'issuePop' ? $('btnIssues') : $('btnMenu')));
      updateYearUI();
    });
  }

  // ============================================================ 左侧坞

  var LAYER_META = [
    ['regions', '区域', 'layers'],
    ['centers', '职住中心', 'people'],
    ['landmarks', '地标', 'pin'],
    ['facilities', '重要设施', 'lyFac'],
    ['anchors', '任务锚点', 'target']
  ];

  function renderDock() {
    var dock = $('dock'); if (!dock) return;
    clear(dock);
    dock.appendChild(h('div', { class: 'dock-title', text: '图层' }));
    LAYER_META.forEach(function (x) {
      var kind = x[0], label = x[1], ico = x[2];
      var on = S.layers[kind] !== false;
      var count = layerCount(kind);
      var b = h('button', {
        class: 'dockbtn layer' + (on ? '' : ' off'),
        style: '--kc:' + ENTITY[kind].color,
        title: label + '：单击显示 / 隐藏，双击在对象列表中筛选',
        onclick: function () { S.layers[kind] = !S.layers[kind]; renderDock(); scheduleDraw(); },
        ondblclick: function (e) { e.preventDefault(); openBrowser(kind); }
      }, icon(ico), h('span', { class: 'bar' }), h('span', { class: 'n', text: count }));
      if (!on) b.appendChild(h('span', { class: 'eye' }, icon('eyeOff')));
      dock.appendChild(b);
    });
    dock.appendChild(h('div', { class: 'dock-sep' }));
    dock.appendChild(h('button', {
      class: 'dockbtn' + (S.browser.open ? ' on' : ''), title: '对象列表 · L',
      onclick: function () { S.browser.open ? closeBrowser() : openBrowser(S.browser.tab === 'all' ? 'all' : S.browser.tab); }
    }, icon('label')));
    dock.appendChild(h('div', { class: 'dock-sep' }));
    dock.appendChild(h('button', { class: 'dockbtn', title: '适配全图 · F', onclick: function () { fitMap(); scheduleDraw(); } }, icon('expand')));
    dock.appendChild(h('button', { class: 'dockbtn', title: '放大 · +', onclick: function () { zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25); } }, icon('plus')));
    dock.appendChild(h('button', { class: 'dockbtn', title: '缩小 · −', onclick: function () { zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.25); } }, icon('minus')));
  }

  function layerCount(kind) {
    if (!S.src) return 0;
    if (kind === 'regions') return regionList().length;
    if (kind === 'centers') return centerList().length;
    if (kind === 'landmarks') return landmarkList().length;
    if (kind === 'facilities') return facilityList().length;
    if (kind === 'anchors') return anchorList().length;
    return 0;
  }

  function zoomAt(px, py, f) {
    var cv = MAP.cv; if (!cv) return;
    var r = cv.getBoundingClientRect();
    var x = px - r.left, y = py - r.top;
    var before = s2w(x, y);
    MAP.cam.z = clamp(MAP.cam.z * f, 2.5, 40);
    var after = s2w(x, y);
    MAP.cam.x += before[0] - after[0]; MAP.cam.y += before[1] - after[1];
    clampCam(); scheduleDraw();
  }

  // ============================================================ 底部工具条

  var TOOLS = [
    { id: 'select', label: '选择', icon: 'cursor', key: 'V', hint: '点选 / 拖动对象' },
    { id: 'landmarks', label: '地标', icon: 'pin', key: 'B', hint: '点空白放置地标' },
    { id: 'facilities', label: '设施', icon: 'lyFac', key: 'P', hint: '点空白放置设施' },
    { id: 'centers', label: '中心', icon: 'people', key: 'C', hint: '点空白放置职住中心' },
    { id: 'anchors', label: '锚点', icon: 'target', key: 'A', hint: '需先在任务面板选中任务' }
  ];

  function renderToolbar() {
    var bar = $('toolbar'); if (!bar) return;
    clear(bar);
    TOOLS.forEach(function (t) {
      bar.appendChild(h('button', {
        class: 'tbtn' + (S.tool === t.id ? ' on' : ''),
        title: t.label + ' · ' + t.key + ' · ' + t.hint,
        onclick: function () { setTool(t.id); }
      }, icon(t.icon), h('span', { class: 'lb', text: t.label })));
    });
    bar.appendChild(h('span', { class: 'tool-hint', text: '拖动平移 · 滚轮缩放' }));
    if (MAP.cv) MAP.cv.style.cursor = S.tool !== 'select' ? 'crosshair' : 'grab';
  }

  function setTool(tool) {
    if (tool !== 'select' && !S.src) return;
    if (tool === 'anchors' && !currentTask()) {
      toast('先在「数据 → 任务」里选中一个任务，再放置锚点');
      openSheet('tasks');
      return;
    }
    S.tool = tool;
    renderToolbar();
    if (tool !== 'select') {
      var hint = { landmarks: '点击地图空白处放置地标', facilities: '点击地图空白处放置设施', centers: '点击地图空白处放置职住中心', anchors: '点击地图为当前任务放置锚点' }[tool];
      toast(hint);
    }
  }

  // ============================================================ 对象浏览器

  var BROWSER_TABS = [
    ['all', '全部'], ['regions', '区域'], ['centers', '中心'], ['landmarks', '地标'],
    ['facilities', '设施'], ['tasks', '任务'], ['anchors', '锚点']
  ];

  function renderBrowserTabs() {
    var box = $('browserTabs'); if (!box) return;
    clear(box);
    BROWSER_TABS.forEach(function (t) {
      box.appendChild(h('button', {
        class: S.browser.tab === t[0] ? 'on' : '',
        onclick: function () { S.browser.tab = t[0]; renderBrowser(); }
      }, t[1]));
    });
  }

  function browserItems(kind) {
    var out = [];
    if (kind === 'regions') {
      regionList().forEach(function (r, i) {
        out.push({
          key: 'r:' + i, label: r.name || r.id || ('区域 ' + (i + 1)),
          sub: (r.open == null ? '永久保护' : r.open + ' 年开放') + (r.plan ? ' · ' + r.plan : ''),
          active: S.regionSel === i,
          onSelect: function () { selectRegion(i, { open: true }); },
          onFocus: function () { selectRegion(i, { open: true }); var q = MAP.regions[i]; if (q && q.center) flyTo(q.center[0], q.center[1], Math.max(9, MAP.cam.z)); }
        });
      });
    } else if (kind === 'centers') {
      centerList().forEach(function (c, i) {
        out.push({
          key: 'c:' + i, label: '职住中心 ' + (i + 1),
          sub: 'x ' + Number(c.x).toFixed(1) + ' · y ' + Number(c.y).toFixed(1) + ' · 人口 ' + fmtCompact(c.pop),
          active: S.sel && S.sel.kind === 'centers' && S.sel.idx === i,
          onSelect: function () { select({ kind: 'centers', idx: i }); },
          onFocus: function () { select({ kind: 'centers', idx: i }, { focus: true }); }
        });
      });
    } else if (kind === 'landmarks') {
      landmarkList().forEach(function (l, i) {
        out.push({
          key: 'l:' + i, label: landmarkName(l),
          sub: (l.id || '—') + ' · ' + (l.year || '—') + ' 年 · x ' + Number(l.x).toFixed(1) + ' · y ' + Number(l.y).toFixed(1),
          active: S.sel && S.sel.kind === 'landmarks' && S.sel.idx === i,
          onSelect: function () { select({ kind: 'landmarks', idx: i }); },
          onFocus: function () { select({ kind: 'landmarks', idx: i }, { focus: true }); }
        });
      });
    } else if (kind === 'facilities') {
      facilityList().forEach(function (f, i) {
        var p = facilityPos(f);
        out.push({
          key: 'f:' + i, label: facilityName(f),
          sub: (CM.Fac.TYPES[f.t] ? CM.Fac.TYPES[f.t].name : f.t) + (f.lm ? ' · 跟随 ' + f.lm : (p ? ' · x ' + Number(p.x).toFixed(1) + ' · y ' + Number(p.y).toFixed(1) : ' · 无坐标')),
          active: S.sel && S.sel.kind === 'facilities' && S.sel.idx === i,
          onSelect: function () { select({ kind: 'facilities', idx: i }); },
          onFocus: function () { select({ kind: 'facilities', idx: i }, { focus: true }); }
        });
      });
    } else if (kind === 'tasks') {
      taskList().forEach(function (t, i) {
        out.push({
          key: 't:' + i, label: taskName(t),
          sub: taskTypeName(t.type) + ' · ' + (t.appear ? t.appear.join('/') : '?') + ' → ' + (t.deadline ? t.deadline.join('/') : '?') + ' · ' + ((t.anchors || []).length) + ' 锚点',
          active: S.sheet.open && S.sheet.tab === 'tasks' && S.sheet.taskIdx === i,
          onSelect: function () { selectTask(i); },
          onFocus: function () { selectTask(i); ensureTaskVisible(t); }
        });
      });
    } else if (kind === 'anchors') {
      anchorList().forEach(function (x) {
        out.push({
          key: 'a:' + x.taskIdx + ':' + x.idx, label: anchorName(x.a),
          sub: taskName(x.task) + ' · r ' + anchorRadius(x.a) + ' 格 · x ' + Number(x.a.x).toFixed(1) + ' · y ' + Number(x.a.y).toFixed(1),
          active: S.sel && S.sel.kind === 'anchors' && S.sel.taskIdx === x.taskIdx && S.sel.idx === x.idx,
          onSelect: function () { select({ kind: 'anchors', idx: x.idx, taskIdx: x.taskIdx }); },
          onFocus: function () { select({ kind: 'anchors', idx: x.idx, taskIdx: x.taskIdx }, { focus: true }); }
        });
      });
    }
    return out;
  }

  function taskTypeName(t) { var T = CM.Tasks.TYPES[t]; return T ? T.name : (t || '未知'); }
  function fmtCompact(v) {
    if (!isNum(v)) return '—';
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + '亿';
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + '万';
    return String(Math.round(v));
  }

  function renderBrowser() {
    var box = $('browserList'); if (!box) return;
    if (!S.src) { if (S.browser.open) closeBrowser(); return; }
    renderBrowserTabs();
    var q = (S.browser.q || '').toLowerCase();
    var kinds = S.browser.tab === 'all' ? ['regions', 'centers', 'landmarks', 'facilities', 'tasks', 'anchors'] : [S.browser.tab];
    clear(box);
    var total = 0;
    kinds.forEach(function (kind) {
      var items = browserItems(kind);
      if (q) items = items.filter(function (it) { return (it.label + ' ' + it.sub).toLowerCase().indexOf(q) >= 0; });
      if (S.browser.tab !== 'all' && !items.length) {
        box.appendChild(h('div', { class: 'b-empty', text: '没有匹配的' + ENTITY[kind].label }));
        return;
      }
      if (!items.length) return;
      total += items.length;
      var group = h('div', { class: 'b-group' });
      var gh = h('div', { class: 'b-group-h', style: '--kc:' + ENTITY[kind].color },
        h('i', { class: 'sw' }), h('b', { text: ENTITY[kind].label }), h('span', { class: 'cnt', text: items.length }));
      if (['regions', 'centers', 'landmarks', 'facilities', 'anchors'].indexOf(kind) >= 0) {
        gh.appendChild(h('button', {
          title: S.layers[kind] === false ? '显示图层' : '隐藏图层',
          onclick: function () { S.layers[kind] = S.layers[kind] === false; renderDock(); renderBrowser(); scheduleDraw(); }
        }, icon(S.layers[kind] === false ? 'eyeOff' : 'check')));
        gh.appendChild(h('button', {
          title: '新建' + ENTITY[kind].one,
          onclick: function () { addFromBrowser(kind); }
        }, icon('plus')));
      } else if (kind === 'tasks') {
        gh.appendChild(h('button', { title: '新建任务', onclick: function () { openSheet('tasks'); addTask(); } }, icon('plus')));
      }
      group.appendChild(gh);
      items.forEach(function (it) {
        var row = h('div', {
          class: 'b-item' + (it.active ? ' on' : ''), role: 'button', tabindex: '0',
          onclick: function () { it.onSelect(); },
          ondblclick: function () { it.onFocus(); },
          onkeydown: function (e) { if (e.key === 'Enter') it.onSelect(); }
        }, h('i', { class: 'bd', style: '--kc:' + ENTITY[kind].color }),
          h('div', { class: 'tx' }, h('b', { text: it.label }), h('span', { text: it.sub })),
          h('button', {
            class: 'go', title: '定位', onclick: function (e) { e.stopPropagation(); it.onFocus(); }
          }, icon('locate')));
        group.appendChild(row);
      });
      box.appendChild(group);
    });
    if (!total) box.appendChild(h('div', { class: 'b-empty', text: q ? '没有匹配的对象' : '这个分类还没有内容' }));
    var bc = $('browserCount'); if (bc) bc.textContent = total + ' 项';
    var bf = $('browserFoot'); if (bf) bf.textContent = S.browser.q ? '筛选：' + S.browser.q : '共 ' + total + ' 项';
    $('browserSearch').value = S.browser.q || '';
  }

  function addFromBrowser(kind) {
    if (kind === 'regions') { openSheet('regions'); addRegion(); return; }
    if (kind === 'tasks') { openSheet('tasks'); addTask(); return; }
    if (kind === 'anchors') { openSheet('tasks'); toast('在任务详情里点「放置锚点」，或先选中一个任务'); return; }
    closeBrowser();
    setTool(kind);
    if (S.tool === kind) toast('在地图空白处点击放置' + ENTITY[kind].one);
  }

  function openBrowser(tab) {
    if (!S.src) { toast('先打开一张地图'); return; }
    S.browser.open = true;
    if (tab) S.browser.tab = tab;
    $('browser').classList.remove('closed');
    renderBrowser();
    renderDock();
  }
  function closeBrowser() {
    S.browser.open = false;
    $('browser').classList.add('closed');
    renderDock();
  }

  // ============================================================ 检查器

  function iSection(title, children, iconName) {
    var sec = h('div', { class: 'i-sec' });
    sec.appendChild(h('h4', null, iconName ? icon(iconName) : null, h('span', { text: title }), h('span', { class: 'line' })));
    children.forEach(function (c) { if (c) sec.appendChild(c); });
    return sec;
  }

  function kvGrid(children, cls) {
    var g = h('div', { class: cls || 'kv2' });
    children.forEach(function (c) { if (c) g.appendChild(c); });
    return g;
  }

  function renderInspector() {
    var box = $('inspector'); if (!box) return;
    if (!S.src) {
      box.classList.add('hidden');
      clear(box);
      return;
    }
    box.classList.remove('hidden');
    clear(box);
    var m = S.src.meta || {};

    // 未选中：地图概览
    if (!S.sel) {
      var head = h('div', { class: 'i-head' },
        h('div', { class: 'i-badge', style: 'background:linear-gradient(145deg,#3f8cc9,#235a8e)' }, icon('map')),
        h('div', { class: 'i-title' }, h('b', { text: m.title || m.name || '未命名地图' }), h('span', { text: (m.sub || m.region || '') + (m.difficulty ? ' · 难度 ' + m.difficulty : '') })),
        h('button', { class: 'iconbtn', title: '打开数据', onclick: function () { openSheet('meta'); } }, icon('report')));
      box.appendChild(head);
      var body = h('div', { class: 'i-body' });
      var d = data();
      var stats = [
        ['区域', (d.regions || []).length, function () { openSheet('regions'); }],
        ['地标', (d.landmarks || []).length, function () { openBrowser('landmarks'); }],
        ['设施', (d.facilities || []).length, function () { openBrowser('facilities'); }],
        ['中心', (d.centers || []).length, function () { openBrowser('centers'); }],
        ['任务', (d.histTasks || []).length, function () { openSheet('tasks'); }],
        ['锚点', anchorList().length, function () { openBrowser('anchors'); }]
      ];
      var sg = h('div', { class: 'stats' });
      stats.forEach(function (s) {
        sg.appendChild(h('button', { class: 'stat', onclick: s[2] }, h('b', { text: s[1] }), h('span', { text: s[0] })));
      });
      body.appendChild(iSection('地图内容', [sg], 'layers'));
      var facts = h('dl', { class: 'facts' });
      function fact(k, v) { facts.appendChild(h('dt', { text: k })); facts.appendChild(h('dd', { text: v, title: v })); }
      fact('文件', (S.dir ? S.dir + '/' : '') + S.name);
      fact('尺寸', mapW() + ' × ' + mapH() + ' 格 · ' + (mapW() * 0.25).toFixed(1) + ' × ' + (mapH() * 0.25).toFixed(1) + ' km');
      fact('开局', startYear() + ' 年');
      fact('地理', m.geo || '—');
      fact('版本', 'mapVersion ' + (m.mapVersion == null ? '—' : m.mapVersion));
      body.appendChild(iSection('地图信息', [facts], 'info'));

      var issWrap = h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('button', { class: 'issue-mini good', id: 'ovIssues', onclick: function (e) { e.stopPropagation(); togglePop('issuePop'); } },
          icon('good'), h('span', { text: '结构预检通过' })));
      body.appendChild(iSection('预检', [issWrap], 'warn'));
      body.appendChild(iSection('快捷操作', [
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          h('button', { class: 'btn sm', onclick: function () { openSheet('meta'); } }, icon('report'), '数据与设定'),
          h('button', { class: 'btn sm', onclick: function () { fitMap(); scheduleDraw(); } }, icon('expand'), '适配全图'),
          h('button', { class: 'btn sm', onclick: function () { saveFile(false); } }, icon('save'), '保存'))
      ], 'gear'));
      box.appendChild(body);
      updateOverviewIssues(
        S.issues.filter(function (i) { return i.level === 'error'; }).length,
        S.issues.filter(function (i) { return i.level !== 'error'; }).length
      );
      return;
    }

    var sel = S.sel, item = itemOf(sel);
    if (!item) { clearSelection(); return; }
    var E = ENTITY[sel.kind];
    var head2 = h('div', { class: 'i-head' },
      h('div', { class: 'i-badge', style: 'background:' + E.color }, icon(E.icon)),
      h('div', { class: 'i-title' },
        h('b', { id: 'inspTitle', text: sel.kind === 'centers' ? ('职住中心 ' + (sel.idx + 1)) : (sel.kind === 'landmarks' ? landmarkName(item) : sel.kind === 'facilities' ? facilityName(item) : anchorName(item)) }),
        h('span', { id: 'inspSub', text: inspectorSub(sel, item) })),
      h('button', { class: 'iconbtn', title: '取消选中 · Esc', onclick: clearSelection }, icon('close')));
    box.appendChild(head2);
    var body2 = h('div', { class: 'i-body' });
    var secs = [];

    if (sel.kind === 'centers') {
      secs.push(iSection('位置', [kvGrid([
        field({ k: 'x', label: 'x', unit: '格', kind: 'num', step: '0.01' }, item),
        field({ k: 'y', label: 'y', unit: '格', kind: 'num', step: '0.01' }, item)
      ])], 'locate'));
      secs.push(iSection('人口与岗位', [kvGrid([
        field({ k: 'pop', label: '人口密度', unit: '人/km²', kind: 'num' }, item),
        field({ k: 'jobs', label: '岗位密度', unit: '个/km²', kind: 'num' }, item),
        field({ k: 'r', label: '影响半径', unit: 'km', kind: 'num', step: '0.1' }, item)
      ]), h('div', { class: 'note', text: '半径 ' + ((isNum(item.r) ? item.r : 2) * 4) + ' 格；生成时按全图总量归一化，写相对值即可。' })], 'people'));
    } else if (sel.kind === 'landmarks') {
      secs.push(iSection('标识', [kvGrid([
        field({ k: 'id', label: 'id', kind: 'text' }, item),
        field({ k: 'name', label: '名称', kind: 'text', onChange: function () { var t = $('inspTitle'); if (t) t.textContent = landmarkName(item); } }, item),
        field({ k: 'kind', label: '形体 kind', kind: 'text', hint: 'tower / hall / box / campus / bridge' }, item),
        field({ k: 'style', label: '造型', kind: 'select', allowEmpty: true, options: LM_STYLES.map(function (s) { return [s, s + ' · ' + CM.LANDMARK_STYLES[s].name]; }) }, item)
      ])], 'info'));
      secs.push(iSection('位置', [kvGrid([
        field({ k: 'x', label: 'x', unit: '格', kind: 'num', step: '0.01' }, item),
        field({ k: 'y', label: 'y', unit: '格', kind: 'num', step: '0.01' }, item),
        field({ k: 'year', label: '落成年', unit: '年', kind: 'int' }, item)
      ])], 'locate'));
      secs.push(iSection('体量', [kvGrid([
        field({ k: 'w', label: '宽', unit: 'm', kind: 'num' }, item),
        field({ k: 'd', label: '深', unit: 'm', kind: 'num' }, item),
        field({ k: 'h', label: '高', unit: 'm', kind: 'num' }, item),
        field({ k: 'rot', label: '旋转', unit: '°', kind: 'num' }, item)
      ])], 'layers'));
      var followers = facilityList().filter(function (f) { return f.lm && f.lm === item.id; });
      if (followers.length) {
        var chips = h('div', { class: 'chips' }, followers.map(function (f) {
          var i = facilityList().indexOf(f);
          return h('button', { class: 'chip-link', onclick: function () { select({ kind: 'facilities', idx: i }, { focus: true }); } }, icon('lyFac'), facilityName(f));
        }));
        secs.push(iSection('跟随的设施', [chips, h('div', { class: 'note', text: '拖动地标时这些设施一起移动。' })], 'lyFac'));
      }
    } else if (sel.kind === 'facilities') {
      var mode = item.lm ? 'lm' : 'at';
      var pos = facilityPos(item);
      var seg = h('div', { class: 'seg' },
        h('button', { class: mode === 'lm' ? 'on' : '', onclick: function () {
          if (item.lm) return;
          var near = null, best = 1e9;
          landmarkList().forEach(function (l) {
            var d = Math.hypot(l.x - (pos ? pos.x : 0), l.y - (pos ? pos.y : 0));
            if (d < best) { best = d; near = l; }
          });
          if (!near) { toast('这张图还没有地标'); return; }
          item.lm = near.id; delete item.at;
          touch({ now: true, draw: true }); renderInspector(); scheduleDraw();
        } }, '跟随地标'),
        h('button', { class: mode === 'at' ? 'on' : '', onclick: function () {
          if (!item.lm) return;
          var p = facilityPos(item) || { x: 0, y: 0 };
          item.at = [r2(p.x), r2(p.y)]; delete item.lm;
          touch({ now: true, draw: true }); renderInspector(); scheduleDraw();
        } }, '独立坐标'));
      var posChildren = [seg];
      if (mode === 'lm') {
        var lmSel = h('select');
        landmarkList().forEach(function (l, i) {
          lmSel.appendChild(h('option', { value: l.id, selected: l.id === item.lm }, landmarkName(l) + ' · ' + l.id));
        });
        lmSel.onchange = function () { item.lm = lmSel.value; touch({ now: true, draw: true }); renderInspector(); scheduleDraw(); };
        posChildren.push(h('div', { class: 'f wide' }, h('label', { text: '地标' }), lmSel, h('div', { class: 'hint', text: '位置与落成年份由地标决定，拖动地标会一起移动。' })));
        if (pos) posChildren.push(h('div', { class: 'note', text: '当前坐标：x ' + pos.x.toFixed(2) + ' · y ' + pos.y.toFixed(2) + ' 格' }));
      } else {
        var atx = h('input', { type: 'number', step: '0.01', value: item.at && isNum(item.at[0]) ? item.at[0] : (pos ? pos.x : 0) });
        var aty = h('input', { type: 'number', step: '0.01', value: item.at && isNum(item.at[1]) ? item.at[1] : (pos ? pos.y : 0) });
        function setAt() {
          var x = Number(atx.value), y = Number(aty.value);
          if (!isFinite(x) || !isFinite(y)) return;
          item.at = [r2(x), r2(y)];
          touch({ draw: true }); scheduleDraw();
        }
        atx.oninput = setAt; aty.oninput = setAt;
        posChildren.push(h('div', { class: 'kv2' },
          h('div', { class: 'f' }, h('label', null, 'x', h('span', { class: 'u', text: '格' })), atx),
          h('div', { class: 'f' }, h('label', null, 'y', h('span', { class: 'u', text: '格' })), aty)));
      }
      secs.push(iSection('位置', posChildren, 'locate'));
      secs.push(iSection('标识', [kvGrid([
        field({ k: 'id', label: 'id', kind: 'text' }, item),
        field({ k: 'n', label: '名称', kind: 'text', onChange: function () { var t = $('inspTitle'); if (t) t.textContent = facilityName(item); } }, item),
        field({ k: 't', label: '类型', kind: 'select', options: FAC_TYPES.map(function (x) { return [x, x + ' · ' + CM.Fac.TYPES[x].name]; }) }, item),
        field({ k: 'r', label: '场地半径', unit: '格', kind: 'num', step: '0.1' }, item)
      ])], 'info'));
      var adv = h('details', { class: 'card', style: 'margin:0;padding:9px 11px' },
        h('summary', { style: 'cursor:pointer;font-size:12px;color:var(--muted)', text: '接驳量、启用年份与出行目的' }),
        h('div', { style: 'height:8px' }),
        kvGrid([
          field({ k: 'pax', label: '接驳量曲线', kind: 'json', rows: 3, hint: '[[年份, 万人次/日], …]' }, item),
          field({ k: 'w', label: '吸引占比曲线', kind: 'json', rows: 3 }, item),
          field({ k: 'p', label: '出行目的占比', kind: 'json', rows: 3 }, item),
          field({ k: 'y0', label: '启用', kind: 'json', rows: 2, hint: '年份或 [年, 月]' }, item),
          field({ k: 'y1', label: '停用', kind: 'json', rows: 2, hint: '年份或 [年, 月]' }, item),
          field({ k: 'note', label: '备注', kind: 'text' }, item)
        ]));
      secs.push(iSection('高级', [adv], 'gear'));
    } else if (sel.kind === 'anchors') {
      var task = taskList()[sel.taskIdx];
      secs.push(iSection('所属任务', [h('div', { class: 'card', style: 'margin:0' },
        h('div', { class: 'row between' },
          h('b', { style: 'font-size:12.5px', text: taskName(task) }),
          h('button', { class: 'btn sm', onclick: function () { openSheet('tasks', { taskIdx: sel.taskIdx }); } }, icon('flag'), '编辑任务')),
        h('div', { class: 'note', style: 'margin-top:4px', text: (taskTypeName(task && task.type)) + ' · ' + (task && task.appear ? task.appear.join('/') : '?') + ' → ' + (task && task.deadline ? task.deadline.join('/') : '?') + ' · 半径 ' + anchorRadius(item) + ' 格' })
      )], 'flag'));
      secs.push(iSection('锚点', [kvGrid([
        field({ k: 'name', label: '名称', kind: 'text', onChange: function () { var t = $('inspTitle'); if (t) t.textContent = anchorName(item); } }, item),
        field({ k: 'r', label: '半径', unit: '格', kind: 'num', step: '0.5' }, item),
        field({ k: 'x', label: 'x', unit: '格', kind: 'num', step: '0.01' }, item),
        field({ k: 'y', label: 'y', unit: '格', kind: 'num', step: '0.01' }, item)
      ]), h('div', { class: 'note', text: '判定：半径内要有运营车站，且这些车站属于同一地铁网络。' })], 'target'));
    }
    secs.forEach(function (s) { body2.appendChild(s); });
    if (MAP.overlap > 1 && MAP.cycle) {
      var at = 1;
      var cand = pickAll(MAP.cycle.x, MAP.cycle.y);
      for (var z = 0; z < cand.length; z++) if (sameItem(cand[z])) at = z + 1;
      body2.appendChild(h('div', { class: 'note', text: '同处 ' + MAP.overlap + ' 个对象 · 当前第 ' + at + ' 个；在同一处再点一次切换。' }));
    }
    box.appendChild(body2);
    var foot = h('div', { class: 'i-foot' },
      h('button', { class: 'btn sm', onclick: function () { var mk = markerOfSel(S.sel); if (mk) ensureVisible(mk.x, mk.y); } }, icon('locate'), '定位'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm danger', onclick: deleteSelected }, icon('trash'), '删除'));
    box.appendChild(foot);
  }

  function inspectorSub(sel, item) {
    if (sel.kind === 'centers') return 'x ' + Number(item.x).toFixed(2) + ' · y ' + Number(item.y).toFixed(2) + ' 格';
    if (sel.kind === 'landmarks') return (item.id || '') + ' · ' + (item.year || '—') + ' 年 · ' + (item.kind || '地标');
    if (sel.kind === 'facilities') {
      var p = facilityPos(item);
      return (CM.Fac.TYPES[item.t] ? CM.Fac.TYPES[item.t].name : item.t) + (item.lm ? ' · 跟随 ' + item.lm : (p ? ' · ' + p.x.toFixed(2) + ', ' + p.y.toFixed(2) : ''));
    }
    return (item.name || '') + ' · 半径 ' + anchorRadius(item) + ' 格';
  }

  function updateOverviewIssues(errs, warns) {
    var b = $('ovIssues'); if (!b) return;
    b.classList.remove('bad', 'good', 'warn');
    clear(b);
    if (errs) {
      b.classList.add('bad');
      b.appendChild(icon('error'));
      b.appendChild(h('span', { text: errs + ' 个结构错误' + (warns ? ' · ' + warns + ' 个警告' : '') + ' · 点击查看' }));
    } else if (warns) {
      b.classList.add('warn');
      b.appendChild(icon('warn'));
      b.appendChild(h('span', { text: warns + ' 个警告 · 点击查看' }));
    } else {
      b.classList.add('good');
      b.appendChild(icon('good'));
      b.appendChild(h('span', { text: '结构预检通过 · 点击查看明细' }));
    }
  }

  // ============================================================ 年代预览

  function updateYearUI() {
    var btn = $('btnYear');
    if (btn) {
      clear(btn);
      btn.appendChild(icon('clock'));
      btn.appendChild(h('span', { class: 'lb', text: S.year == null ? '全部年代' : S.year + ' 年' }));
      btn.classList.toggle('on', S.year != null);
    }
    var big = $('yearBig'), sub = $('yearBigSub'), slider = $('yearSlider'), stats = $('yearStats'), play = $('yearPlay');
    if (big) big.textContent = S.year == null ? '全部' : String(S.year);
    if (sub) sub.textContent = S.year == null ? '显示所有已配置内容' : '预览该年代的城市状态';
    if (slider) {
      slider.min = S.yearMin; slider.max = S.yearMax;
      slider.value = S.year == null ? S.yearMax : S.year;
      slider.disabled = !S.src;
      var p = S.yearMax > S.yearMin ? ((slider.value - S.yearMin) / (S.yearMax - S.yearMin)) * 100 : 100;
      slider.style.setProperty('--p', p + '%');
    }
    if (play) {
      clear(play);
      play.appendChild(icon(S.yearPlay ? 'pause' : 'play'));
      play.appendChild(h('span', { text: S.yearPlay ? '暂停' : '播放' }));
    }
    if (stats) {
      if (!S.src) { stats.textContent = '打开地图后可预览年代。'; }
      else {
        var y = S.year == null ? null : S.year;
        var lms = landmarkList().filter(function (l) { return y == null || (isNum(l.year) && l.year <= y); }).length;
        var fcs = facilityList().filter(function (f) { var a = facilityYear(f), b = facilityCloseYear(f); return y == null || ((a == null || a <= y) && (b == null || y < b)); }).length;
        var rgs = regionList().filter(function (r) { return y == null || r.open == null || !isNum(r.open) || r.open <= y; }).length;
        stats.innerHTML = '地标 <b>' + lms + '</b> / ' + landmarkList().length +
          ' · 设施 <b>' + fcs + '</b> / ' + facilityList().length +
          ' · 区域 <b>' + rgs + '</b> / ' + regionList().length +
          '<br><span class="faint">' + (y == null ? '滑块拖到最右或点「全部」恢复完整视图。' : '未出现的地标以半透明显示，仍可点选编辑。') + '</span>';
      }
    }
  }

  function setYear(y) {
    S.year = y == null ? null : clamp(Math.round(y), S.yearMin, S.yearMax);
    updateYearUI();
    scheduleDraw();
  }
  function stepYear(d) {
    if (!S.src) return;
    if (S.year == null) setYear(d > 0 ? S.yearMin : S.yearMax);
    else setYear(S.year + d);
  }
  function stopYearPlay() {
    if (S.yearPlay) { clearInterval(S.yearPlay); S.yearPlay = 0; updateYearUI(); }
  }
  function toggleYearPlay() {
    if (!S.src) return;
    if (S.yearPlay) { stopYearPlay(); return; }
    if (S.year == null) S.year = startYear();
    S.yearPlay = setInterval(function () {
      if (S.year == null || S.year >= S.yearMax) { stopYearPlay(); return; }
      setYear(S.year + 1);
    }, 180);
    updateYearUI();
  }

  // ============================================================ 预检面板

  var SECTION_LABEL = {
    meta: '元数据', cfg: '配置', regions: '区域', plans: '用地配方', centers: '职住中心',
    landmarks: '地标', facilities: '设施', tasks: '任务', events: '事件', macro: '经济', rest: '其他'
  };

  function renderIssues() {
    var box = $('issueList'); if (!box) return;
    clear(box);
    if (!S.src) { box.appendChild(h('div', { class: 'sheet-empty', text: '打开地图后自动预检' })); return; }
    var errs = S.issues.filter(function (i) { return i.level === 'error'; }).length;
    var warns = S.issues.length - errs;
    box.appendChild(h('div', { class: 'note', style: 'margin:0 0 8px', text: '结构预检：' + errs + ' 错误 · ' + warns + ' 警告。点击条目跳转；几何、指纹与字段往返由 node scripts/validate-map.mjs 与 map-source check 负责。' }));
    if (!S.issues.length) {
      box.appendChild(h('div', { class: 'sheet-empty', text: '✓ 结构预检通过' }));
      return;
    }
    S.issues.forEach(function (iss) {
      box.appendChild(h('button', {
        class: 'iss ' + iss.level,
        onclick: function () { navigateIssue(iss); }
      }, h('span', { class: 'lv', text: iss.level === 'error' ? 'ERR' : 'WARN' }),
        h('span', { class: 'tx' }, iss.msg, h('span', { class: 'sec', text: SECTION_LABEL[iss.section] || iss.section || '其他' }))));
    });
  }

  function navigateIssue(iss) {
    closePop('issuePop');
    var sec = iss.section;
    if (sec === 'centers' || sec === 'landmarks' || sec === 'facilities' || sec === 'anchors') {
      openBrowser(sec);
      var target = findByMessage(sec, iss.msg);
      if (target != null) select(sec === 'anchors' ? target : { kind: sec, idx: target }, { focus: true });
      return;
    }
    if (sec === 'tasks') {
      var ti = findByMessage('tasks', iss.msg);
      openSheet('tasks', { taskIdx: ti == null ? S.sheet.taskIdx : ti });
      return;
    }
    if (sec === 'regions') {
      var ri = findByMessage('regions', iss.msg);
      openSheet('regions', { regionIdx: ri == null ? S.sheet.regionIdx : ri });
      return;
    }
    if (sec === 'plans') { openSheet('cfg'); return; }
    if (sec === 'events') { openSheet('events'); return; }
    openSheet(DATA_TABS.some(function (t) { return t.id === sec; }) ? sec : 'meta');
  }

  function findByMessage(kind, msg) {
    var list = data()[kind] || [];
    if (kind === 'tasks') list = taskList();
    if (kind === 'anchors') {
      var found = null;
      anchorList().forEach(function (x) {
        if (msg.indexOf(anchorName(x.a)) >= 0 || msg.indexOf(x.task.id) >= 0) found = { kind: 'anchors', idx: x.idx, taskIdx: x.taskIdx };
      });
      return found;
    }
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      if (it.id && msg.indexOf(it.id) >= 0) return i;
      if (it.name && msg.indexOf(it.name) >= 0) return i;
      if (it.n && msg.indexOf(it.n) >= 0) return i;
      if (it.title && msg.indexOf(it.title) >= 0) return i;
    }
    return null;
  }

  // ============================================================ 浮层

  function positionPop(pop, trigger) {
    if (!pop || !trigger) return;
    var r = trigger.getBoundingClientRect();
    var w = pop.offsetWidth || 320;
    var top = r.bottom + 8;
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    pop.style.right = 'auto';
  }
  function closePop(id) {
    var pop = $(id); if (pop) pop.classList.add('closed');
    if (S.pop === id) S.pop = null;
  }
  function closePops() { if (S.pop) closePop(S.pop); }
  function openPop(id, trigger) {
    closePops();
    var pop = $(id); if (!pop) return;
    if (id === 'yearPop') updateYearUI();
    if (id === 'issuePop') renderIssues();
    if (id === 'filePop') renderFileMenu();
    pop.classList.remove('closed');
    S.pop = id;
    requestAnimationFrame(function () { positionPop(pop, trigger); });
  }
  function togglePop(id) {
    if (S.pop === id) { closePop(id); return; }
    var trig = { yearPop: 'btnYear', issuePop: 'btnIssues', filePop: 'btnMenu' }[id];
    openPop(id, $(trig));
  }

  function renderFileMenu() {
    var box = $('fileMenu'); if (!box) return;
    clear(box);
    if (!S.src) {
      box.appendChild(h('button', { class: 'menu-item', onclick: function () { closePops(); openFile(); } }, icon('folder'), '打开 source.json…', h('span', { class: 'k', text: 'Ctrl+O' })));
      box.appendChild(h('button', { class: 'menu-item', onclick: function () { closePops(); showHelp(); } }, icon('help'), '工作流与快捷键'));
      return;
    }
    box.appendChild(h('div', { class: 'note', style: 'margin:0 0 7px;padding:0 2px' },
      h('div', { class: 'nowrap', text: (S.dir ? S.dir + '/' : '') + S.name }),
      h('div', { text: S.handle ? '已连接本地文件，可直接写回。' : '未连接本地文件，保存会下载 JSON。' })));
    function item(ico, label, key, fn, danger) {
      box.appendChild(h('button', { class: 'menu-item' + (danger ? ' danger' : ''), onclick: function () { closePops(); fn(); } }, icon(ico), label, key ? h('span', { class: 'k', text: key }) : null));
    }
    item('folder', '打开…', 'Ctrl+O', openFile);
    item('save', '保存', 'Ctrl+S', function () { saveFile(false); });
    item('export', '另存为 / 下载 JSON', '', function () { saveFile(true); });
    if (S.dir && S.dir.indexOf('maps/') === 0) {
      item('import', '重新载入磁盘副本', '', function () { reloadFromDisk(); });
    }
    item('trash', '关闭地图', '', closeMap, true);
  }

  function showHelp() {
    closePops();
    var o = $('helpOverlay'); if (o) { o.hidden = false; requestAnimationFrame(function () { o.style.opacity = '1'; }); }
  }
  function hideHelp() { var o = $('helpOverlay'); if (o) o.hidden = true; }

  // ============================================================ 数据抽屉

  function renderSheetTabs() {
    var box = $('sheetTabs'); if (!box) return;
    clear(box);
    var d = data();
    DATA_TABS.forEach(function (t) {
      var n = t.count ? t.count(d) : null;
      box.appendChild(h('button', {
        class: 's-tab' + (S.sheet.tab === t.id ? ' on' : ''),
        onclick: function () {
          S.sheet.tab = t.id;
          if (t.id === 'regions') { if (S.regionSel == null) S.regionSel = S.sheet.regionIdx; }
          if (t.id === 'tasks') { var q = taskList()[S.sheet.taskIdx]; if (q) S.taskFocus = q; }
          renderSheet(); renderBrowser(); scheduleDraw();
        }
      }, icon(t.icon), h('span', { text: t.label }), n == null ? null : h('span', { class: 'n', text: n })));
    });
  }

  function openSheet(tab, opts) {
    if (!S.src) { toast('先打开一张地图'); return; }
    opts = opts || {};
    S.sheet.open = true;
    if (tab && DATA_TABS.some(function (t) { return t.id === tab; })) S.sheet.tab = tab;
    if (opts.regionIdx != null) {
      S.sheet.regionIdx = opts.regionIdx;
      if (S.sheet.tab === 'regions') S.regionSel = opts.regionIdx;
      S.taskFocus = null;
    }
    if (opts.taskIdx != null) {
      S.sheet.taskIdx = opts.taskIdx;
      if (S.sheet.tab === 'tasks') {
        var tt0 = taskList()[opts.taskIdx];
        if (tt0) S.taskFocus = tt0;
        S.regionSel = null;
      }
    }
    document.body.classList.add('sheet-open');
    $('sheet').classList.remove('closed');
    closePops();
    if (S.sheet.tab === 'regions' && S.regionSel == null) S.regionSel = S.sheet.regionIdx;
    if (S.sheet.tab === 'tasks') {
      var t = taskList()[S.sheet.taskIdx];
      if (t) S.taskFocus = t;
    }
    renderSheet();
    renderDock();
    renderInspector();
    scheduleDraw();
    if (opts.focusTask) ensureTaskVisible(taskList()[S.sheet.taskIdx]);
  }

  function closeSheet() {
    S.sheet.open = false;
    document.body.classList.remove('sheet-open');
    $('sheet').classList.add('closed');
    if (!(S.sel && S.sel.kind === 'anchors')) S.taskFocus = null;
    S.regionSel = null;
    renderDock();
    renderInspector();
    renderBrowser();
    scheduleDraw();
  }

  function renderSheetIfOpen() {
    if (S.sheet.open) renderSheet();
  }

  function renderSheet() {
    if (!S.sheet.open || !S.src) return;
    pruneSelection();
    var m = S.src.meta || {};
    var sub = $('sheetSub');
    if (sub) {
      var iss = S.issues.length ? (' · ' + S.issues.length + ' 个预检问题') : ' · 预检通过';
      sub.textContent = (m.title || m.id || '') + ' · ' + (S.dir ? S.dir + '/' : '') + S.name + iss;
    }
    renderSheetTabs();
    var box = $('sheetMain'); if (!box) return;
    clear(box);
    var fn = {
      meta: renderMetaTab, cfg: renderCfgTab, regions: renderRegionsTab, tasks: renderTasksTab,
      events: renderEventsTab, macro: renderMacroTab, rest: renderRestTab, raw: renderRawTab
    }[S.sheet.tab];
    if (fn) fn(box);
  }

  // ---------- 元数据

  var META_ID_FIELDS = [
    { k: 'id', label: 'id', kind: 'text', hint: '与 maps/<id>/ 目录名、manifest 中的 id 一致' },
    { k: 'name', label: '城市名', kind: 'text' },
    { k: 'title', label: '标题', kind: 'text', hint: '如「广州 · 1990」' },
    { k: 'sub', label: '副标题', kind: 'text' },
    { k: 'region', label: '地区', kind: 'select', options: REGIONS, hint: '决定建筑配色与车型构成' },
    { k: 'difficulty', label: '难度', kind: 'select', num: true, options: [[1, '1 · 教程'], [2, '2 · 普通'], [3, '3 · 较难'], [4, '4 · 最难']] },
    { k: 'kind', label: '真实 / 虚构', kind: 'select', options: [['real', 'real · 真实城市'], ['fictional', 'fictional · 虚构城市']] },
    { k: 'scenario', label: '场景 id', kind: 'text', hint: '如 gz-1990' },
    { k: 'mapVersion', label: '地图版本', kind: 'int', hint: '内容修订须递增' },
    { k: 'geo', label: '地理资源', kind: 'text', hint: 'CM.GEOS 的键；inline 表示由数据文件生成几何' }
  ];
  var META_TEXT_FIELDS = [
    { k: 'tagline', label: '一句话特色', kind: 'text', wide: true },
    { k: 'desc', label: '介绍（列表页）', kind: 'textarea', wide: true, rows: 3 },
    { k: 'intro', label: '开局介绍', kind: 'textarea', wide: true, rows: 4 }
  ];
  var META_LIST_FIELDS = [
    { k: 'tags', label: '标签', kind: 'json', rows: 3, hint: '字符串数组，用于列表筛选' },
    { k: 'cam', label: '默认镜头', kind: 'json', rows: 3, hint: '{cx, cy, zoom}，游戏内开局镜头' },
    { k: 'facts', label: '信息卡', kind: 'json', wide: true, rows: 6, hint: '[[标签, 值], …]' },
    { k: 'features', label: '特色卡', kind: 'json', wide: true, rows: 6, hint: '[[图标, 标题, 说明], …]，图标须存在于 icons.js' },
    { k: 'highlights', label: '大事年表', kind: 'json', wide: true, rows: 6, hint: '[[年份, 文字], …]，按年份升序' }
  ];

  function renderMetaTab(box) {
    var m = S.src.meta || (S.src.meta = {});
    box.appendChild(h('h2', { text: '元数据与文案' }));
    box.appendChild(h('p', { class: 'sub', text: '列表页、开局简报与地图卡片读到的字段。改 id / geo 前先确认目录与 geo_<id>.js 已存在。' }));
    box.appendChild(formCard('标识与难度', META_ID_FIELDS, m, { icon: 'info' }));
    var card = formCard('文案', META_TEXT_FIELDS, m, { icon: 'report' });
    box.appendChild(card);
    box.appendChild(formCard('列表展示与镜头', META_LIST_FIELDS, m, { icon: 'chart' }));
    var modes = Array.isArray(m.modes) ? m.modes.slice() : [];
    var box2 = h('div', { class: 'f wide' });
    box2.appendChild(h('label', { text: '可选模式' }));
    var row2 = h('div', { class: 'row', style: 'gap:16px;height:30px' });
    [['challenge', '经营挑战'], ['free', '自由建造']].forEach(function (x) {
      var cb = h('input', { type: 'checkbox', checked: modes.indexOf(x[0]) >= 0, style: 'margin-right:5px;width:auto;height:auto;accent-color:var(--accent)' });
      cb.onchange = function () {
        var i = modes.indexOf(x[0]);
        if (cb.checked && i < 0) modes.push(x[0]);
        else if (!cb.checked && i >= 0) modes.splice(i, 1);
        m.modes = modes.slice();
        touch({ draw: false }); precheck();
      };
      row2.appendChild(h('label', { style: 'display:flex;align-items:center;font-size:12px;color:var(--muted);cursor:pointer' }, cb, x[1]));
    });
    box2.appendChild(row2);
    card.appendChild(h('div', { style: 'height:9px' }));
    card.appendChild(h('div', { class: 'grid2' }, box2));
    box.appendChild(h('div', { class: 'note', text: '提示：source.json 由编辑器写回后，需在仓库根目录运行 node scripts/map-source.mjs build ' + (m.id || '<id>') + ' --in-place 生成 js/data_' + (m.id || '<id>') + '.js；改 id / geo 后还要同步 maps.js 与 index.html 的资源引入。' }));
  }

  // ---------- 配置

  function renderCfgTab(box) {
    box.appendChild(h('h2', { text: '世界设定' }));
    box.appendChild(h('p', { class: 'sub', text: '只保存与基线（config.js 默认值）不同的键。取消勾选即恢复继承。运行时是浅合并，所以对象要写完整对象。' }));
    box.appendChild(h('div', { class: 'card' }, CFG_KEYS.map(function (k) {
      var own = S.src.cfg && Object.prototype.hasOwnProperty.call(S.src.cfg, k);
      var row = h('div', { class: 'kv' });
      row.appendChild(h('div', { class: 'k', text: k }));
      row.appendChild(h('div', { class: 'base' + (own ? '' : ' on'), title: pretty(CM.CFG[k]), text: short(CM.CFG[k]) }));
      var val = h('div', { class: 'val' });
      if (own) {
        var ta = h('textarea', { spellcheck: 'false' });
        ta.value = pretty(S.src.cfg[k]);
        ta.oninput = function () {
          try {
            S.src.cfg[k] = JSON.parse(ta.value || 'null');
            ta.classList.remove('bad');
            touch({ draw: false }); precheck();
            if (k === 'START' || k === 'growth') normalizeYear();
            if (k === 'W' || k === 'H' || k === 'START') scheduleDraw();
          } catch (e) { ta.classList.add('bad'); }
        };
        val.appendChild(ta);
        if (k === 'macro') val.appendChild(h('button', { class: 'btn sm', style: 'margin-top:5px', onclick: function () { S.sheet.tab = 'macro'; renderSheet(); } }, '编辑经济'));
      } else {
        val.appendChild(h('div', { class: 'base on', text: '继承基线' }));
      }
      row.appendChild(val);
      row.appendChild(h('label', { class: 'tog' }, h('input', {
        type: 'checkbox', checked: own, onchange: function (e) {
          S.src.cfg = S.src.cfg || {};
          if (e.target.checked) S.src.cfg[k] = clone(CM.CFG[k]);
          else delete S.src.cfg[k];
          if (!Object.keys(S.src.cfg).length) delete S.src.cfg;
          touch({ now: true, draw: true }); precheck();
          renderSheet();
        }
      }), '覆盖'));
      return row;
    })));
    box.appendChild(h('div', { class: 'card' },
      h('h3', null, icon('layers'), '用地配方'),
      h('div', { class: 'hint', text: '每份配方是各类用地（RES / MIX / COM / INST / IND）在同一街区内的占比，合计应为 1。区域通过 plan 字段引用。' }),
      plansEditor()));
    box.appendChild(h('div', { class: 'note', text: 'W / H 会改变格网与交通小区数量，改动后所有坐标、区域与底图都要重新核对；底图按 W×H 生成，改尺寸后请点上方「重新载入底图」或重开地图。START 决定开局年月。' }));
    box.appendChild(h('div', { class: 'sheet-bar', style: 'margin-top:8px' },
      h('button', { class: 'btn sm', onclick: function () { setupMapVisuals(); toast('已按当前 W/H 重载底图'); } }, icon('expand'), '重新载入底图')));
  }

  function plansEditor() {
    var d = data();
    var plans = d.plans || (d.plans = {});
    var box = h('div');
    var keys = Object.keys(plans);
    if (!keys.length) { box.appendChild(h('div', { class: 'sheet-empty', text: '还没有用地配方；至少需要 res。' })); }
    keys.forEach(function (k) {
      var row = h('div', { class: 'card', style: 'margin-bottom:9px;padding:9px 10px' });
      var head = h('div', { class: 'row between', style: 'margin-bottom:5px' }, h('b', { style: 'font-size:12px', text: k }),
        h('button', { class: 'btn sm danger', onclick: function () { delete plans[k]; touch({ now: true }); precheck(); renderSheet(); } }, icon('trash')));
      var ta = h('textarea', { spellcheck: 'false', rows: 2, style: 'width:100%;min-height:46px;background:var(--input-bg);border:1px solid var(--input-line);border-radius:6px;padding:5px 7px;font:10.5px/1.5 var(--mono)' });
      ta.value = pretty(plans[k]);
      ta.oninput = function () {
        try { plans[k] = JSON.parse(ta.value || '{}'); ta.classList.remove('bad'); touch({ draw: false }); precheck(); }
        catch (e) { ta.classList.add('bad'); }
      };
      row.appendChild(head); row.appendChild(ta);
      box.appendChild(row);
    });
    box.appendChild(h('div', { class: 'sheet-bar' },
      h('button', { class: 'btn sm', onclick: function () {
        var name = 'plan' + (Object.keys(plans).length + 1);
        while (plans[name]) name += 'x';
        plans[name] = { RES: 0.7, MIX: 0.15, COM: 0.05, INST: 0.05, IND: 0.05 };
        touch({ now: true }); precheck(); renderSheet();
      } }, icon('plus'), '新增配方')));
    return box;
  }

  // ---------- 区域

  function renderRegionsTab(box) {
    var regs = data().regions || (data().regions = []);
    if (S.regionSel != null) S.sheet.regionIdx = S.regionSel;
    if (S.sheet.regionIdx >= regs.length) S.sheet.regionIdx = Math.max(0, regs.length - 1);
    box.appendChild(h('h2', { text: '区域' }));
    box.appendChild(h('p', { class: 'sub', text: '区域用 geo.reserve / geo.park、admin 街道名（level 8）、区名（level 6/7）或显式 poly 划定；编辑器会解析并在地图上高亮。运行时还会用 woodMin 的林地覆盖率规则补足。' }));
    var master = h('div', { class: 'master' });
    var list = h('div', { class: 'm-list' });
    list.appendChild(h('div', { class: 'm-list-h' }, h('b', { text: regs.length + ' 个区域' }),
      h('button', { class: 'iconbtn', title: '新增区域', onclick: addRegion }, icon('plus'))));
    if (!regs.length) list.appendChild(h('div', { class: 'm-empty', text: '还没有区域' }));
    regs.forEach(function (r, i) {
      var q = MAP.regions[i];
      var status = q && q.shapes.length ? '可定位' : (q && q.rule ? '规则区域' : '无形状');
      list.appendChild(h('button', {
        class: 'm-row' + (i === S.sheet.regionIdx ? ' on' : ''),
        onclick: function () { selectRegionInSheet(i); }
      }, h('span', { class: 'tx' }, h('b', { text: r.name || r.id || ('区域 ' + (i + 1)) }),
        h('span', { text: (r.open == null ? '永久保护' : r.open + ' 年') + ' · ' + (r.plan || '默认') + ' · ' + status }))));
    });
    master.appendChild(list);
    var det = h('div');
    var r = regs[S.sheet.regionIdx];
    if (!r) {
      det.appendChild(h('div', { class: 'sheet-empty', text: '选择左侧区域，或新建一个。' }));
    } else {
      var q2 = MAP.regions[S.sheet.regionIdx];
      var head = h('div', { class: 'row between', style: 'margin-bottom:10px;flex-wrap:wrap;gap:7px' },
        h('div', { class: 'row', style: 'gap:7px' }, h('b', { style: 'font-size:14px', text: r.name || r.id || '区域' }),
          h('span', { class: 'tiny', style: 'color:' + (q2 && q2.shapes.length ? 'var(--good)' : 'var(--warn)'), text: q2 && q2.shapes.length ? (q2.shapes.length + ' 个多边形') : (q2 && q2.rule ? q2.rule : '无法解析形状') })),
        h('div', { class: 'row', style: 'gap:5px' },
          h('button', { class: 'btn sm', onclick: function () {
            S.regionSel = S.sheet.regionIdx;
            if (q2 && q2.center) flyTo(q2.center[0], q2.center[1], Math.max(9, MAP.cam.z));
            else toast('这个区域没有可定位的图形');
            scheduleDraw(); renderBrowser();
          } }, icon('locate'), '高亮'),
          h('button', { class: 'btn sm danger', onclick: function () { deleteRegion(S.sheet.regionIdx); } }, icon('trash'), '删除')));
      det.appendChild(head);

      var openPerma = r.open == null;
      var openYear = h('input', { type: 'number', step: '1', value: r.open == null ? startYear() : r.open, disabled: openPerma });
      var perma = h('input', { type: 'checkbox', checked: openPerma, style: 'width:auto;height:auto;accent-color:var(--accent)' });
      function setOpen() {
        if (perma.checked) r.open = null;
        else {
          var v = Number(openYear.value);
          r.open = isFinite(v) ? Math.round(v) : startYear();
        }
        openYear.disabled = perma.checked;
        touch({ draw: false }); precheck(); normalizeYear(); scheduleDraw();
      }
      perma.onchange = setOpen;
      openYear.oninput = function () { if (!perma.checked) setOpen(); };

      var planNames = Object.keys(data().plans || {});
      var fields1 = [
        { k: 'id', label: 'id', kind: 'text' },
        { k: 'name', label: '名称', kind: 'text' },
        { k: 'plan', label: '用地配方', kind: 'select', allowEmpty: true, options: planNames },
        { k: 'pop', label: '人口总量', kind: 'num', optional: true },
        { k: 'scenic', label: '风景区（不可建设）', kind: 'bool', hint: '风景区内不生成普通街区' },
        { k: 'woodMin', label: '最低林地覆盖率', kind: 'num', step: '0.01', optional: true, hint: '按林地覆盖率划分区域时使用' },
        { k: 'note', label: '备注', kind: 'text', wide: true }
      ];
      det.appendChild(h('div', { class: 'card' }, h('div', { class: 'grid2' }, fields1.map(function (f) { return field(f, r, { draw: false }); }))));
      var shapeSrc = r.geo ? short(r.geo) : (r.poly ? '显式多边形' : (r.streets ? (r.streets.length + ' 条街道') : (r.district ? (r.district.length + ' 个区') : '默认 / 规则区域')));
      det.appendChild(h('div', { class: 'card' },
        h('div', { class: 'grid2' },
          h('div', { class: 'f' },
            h('label', null, '开放年份', h('span', { class: 'u', text: '年' })),
            h('div', { class: 'row', style: 'gap:7px' }, openYear,
              h('label', { class: 'chk', style: 'height:30px' }, perma, '永久保护'))),
          h('div', { class: 'f' },
            h('label', { text: '形状来源' }),
            h('div', { class: 'base on', style: 'font-family:var(--mono);font-size:11px;padding-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: shapeSrc })))));
      var shapeCard = h('div', { class: 'card' },
        h('h3', null, icon('layers'), '形状与地形'),
        h('div', { class: 'grid2' },
          field({ k: 'geo', label: '地理选择', kind: 'json', rows: 3, hint: '{ "reserve": "…" } 或 { "park": "…" }', onChange: function () { rebuildRegionShapes(); scheduleDraw(); renderSheet(); } }, r),
          field({ k: 'streets', label: '街道名（admin 8）', kind: 'json', rows: 3, hint: '["…街道", …]', onChange: function () { rebuildRegionShapes(); scheduleDraw(); renderSheet(); } }, r),
          field({ k: 'district', label: '区名（admin 6/7）', kind: 'json', rows: 3, hint: '["…区", …]', onChange: function () { rebuildRegionShapes(); scheduleDraw(); renderSheet(); } }, r),
          field({ k: 'poly', label: '显式多边形', kind: 'json', rows: 3, hint: '[[x,y],…] 或 [[[x,y],…],…]', onChange: function () { rebuildRegionShapes(); scheduleDraw(); renderSheet(); } }, r)));
      det.appendChild(shapeCard);
      det.appendChild(h('div', { class: 'note', text: '区域边界的权威结果由运行时 city.js 的 buildTerrain 计算（含 woodMin 林地规则）；这里的高亮是编辑器按 geo/admin/poly 复算的近似，用来定位与核对。' }));
    }
    master.appendChild(det);
    box.appendChild(master);
  }

  function selectRegionInSheet(idx) {
    S.sheet.regionIdx = idx;
    S.regionSel = idx;
    S.sel = null;
    S.taskFocus = null;
    scheduleDraw();
    renderBrowser();
    renderInspector();
    renderSheet();
    ensureRegionVisible(idx);
  }

  function addRegion() {
    var regs = data().regions || (data().regions = []);
    var r = { id: uniqueId('r', regs), name: '新区域', open: startYear(), plan: 'res' };
    regs.push(r);
    S.sheet.regionIdx = regs.length - 1;
    S.regionSel = regs.length - 1;
    touch({ now: true, draw: true });
    precheck();
    rebuildRegionShapes();
    renderDock();
    renderSheet();
    renderBrowser();
    scheduleDraw();
    toast('已新增区域，设置名称与形状来源');
  }

  function deleteRegion(idx) {
    var regs = data().regions || [];
    var r = regs[idx]; if (!r) return;
    if (!window.confirm('删除区域「' + (r.name || r.id) + '」？引用它的数据不会自动清理。')) return;
    regs.splice(idx, 1);
    S.regionSel = null;
    S.sheet.regionIdx = Math.min(idx, regs.length - 1);
    touch({ now: true, draw: true });
    precheck();
    rebuildRegionShapes();
    normalizeYear();
    pruneSelection();
    renderDock();
    renderSheet();
    renderBrowser();
    scheduleDraw();
    toast('已删除区域');
  }

  // ---------- 任务

  function renderTasksTab(box) {
    var tasks = data().histTasks || (data().histTasks = []);
    if (S.sel && S.sel.kind === 'anchors') S.sheet.taskIdx = S.sel.taskIdx;
    if (S.sheet.taskIdx >= tasks.length) S.sheet.taskIdx = Math.max(0, tasks.length - 1);
    var t = tasks[S.sheet.taskIdx];
    if (t) S.taskFocus = t;
    box.appendChild(h('h2', { text: '历史任务' }));
    box.appendChild(h('p', { class: 'sub', text: '按类型填参数。connect 用锚点数组；其它类型用 target / zone / station 等参数。任务只在出现年月到截止年月之间可完成。' }));
    var master = h('div', { class: 'master' });
    var list = h('div', { class: 'm-list' });
    list.appendChild(h('div', { class: 'm-list-h' }, h('b', { text: tasks.length + ' 个任务' }),
      h('button', { class: 'iconbtn', title: '新增任务', onclick: addTask }, icon('plus'))));
    if (!tasks.length) list.appendChild(h('div', { class: 'm-empty', text: '还没有历史任务' }));
    tasks.forEach(function (tt, i) {
      list.appendChild(h('button', {
        class: 'm-row' + (i === S.sheet.taskIdx ? ' on' : ''),
        onclick: function () { selectTask(i); },
        ondblclick: function () { ensureTaskVisible(tt); }
      }, h('span', { class: 'tx' }, h('b', { text: taskName(tt) }),
        h('span', { text: taskTypeName(tt.type) + ' · ' + fmtYm(tt.appear) + ' → ' + fmtYm(tt.deadline) })),
        h('span', { class: 'cnt', text: ((tt.anchors || []).length) + ' 锚点' })));
    });
    master.appendChild(list);

    var det = h('div');
    if (!t) {
      det.appendChild(h('div', { class: 'sheet-empty', text: '选择左侧任务，或新建一个。' }));
    } else {
      det.appendChild(h('div', { class: 'row between', style: 'margin-bottom:10px;flex-wrap:wrap;gap:6px' },
        h('div', { class: 'row', style: 'gap:7px' }, h('b', { style: 'font-size:14px', text: taskName(t) }), h('span', { class: 'tag', text: taskTypeName(t.type) })),
        h('div', { class: 'row', style: 'gap:5px' },
          h('button', { class: 'btn sm', onclick: function () { ensureTaskVisible(t); scheduleDraw(); } }, icon('locate'), '在图上显示'),
          h('button', { class: 'btn sm', onclick: function () { if (Array.isArray(t.appear)) setYear(t.appear[0]); } }, icon('clock'), '预览出现年'),
          h('button', { class: 'btn sm danger', onclick: function () { deleteTask(S.sheet.taskIdx); } }, icon('trash'), '删除'))));
      var fields = [
        { k: 'id', label: 'id', kind: 'text' },
        { k: 'title', label: '标题', kind: 'text', wide: true },
        { k: 'type', label: '类型', kind: 'select', options: TASK_TYPES.map(function (x) { return [x, x + ' · ' + CM.Tasks.TYPES[x].name]; }), onChange: function () { touch({ now: true }); renderSheet(); } },
        { k: 'reward', label: '奖励', kind: 'num' },
        { k: 'desc', label: '说明', kind: 'textarea', wide: true, rows: 3 }
      ];
      det.appendChild(h('div', { class: 'card' }, h('div', { class: 'grid2' }, fields.map(function (f) { return field(f, t, { draw: false }); }))));
      det.appendChild(h('div', { class: 'card' },
        h('h3', null, icon('clock'), '时间'),
        h('div', { class: 'grid2' },
          datePairField('出现', t, 'appear'),
          datePairField('截止', t, 'deadline')),
        h('div', { class: 'note', text: '截止必须晚于出现；提前或推迟会改变任务在游戏里的可完成窗口。' })));

      var T = CM.Tasks.TYPES[t.type];
      var params = T ? (T.params || []).filter(function (p) { return p[0] !== 'anchors'; }) : [];
      if (params.length) {
        var pfields = params.map(function (p) {
          var k = p[0], optional = !!p[2];
          var def = { k: k, label: k, hint: p[1], optional: optional };
          if (k === 'target') { def.kind = 'num'; def.step = '0.01'; }
          else if (k === 'zone' || k === 'sustain') { def.kind = 'int'; }
          else if (k === 'start') def.kind = 'num';
          else if (k === 'basis') { def.kind = 'select'; def.options = [['wd', 'wd · 工作日'], ['we', 'we · 周末'], ['avg', 'avg · 周平均']]; }
          else if (k === 'fac') {
            def.kind = 'select'; def.allowEmpty = true;
            def.options = facilityList().map(function (f) { return [f.id, facilityName(f) + ' · ' + f.id]; });
          } else def.kind = 'text';
          return field(def, t, { draw: false });
        });
        det.appendChild(h('div', { class: 'card' }, h('h3', null, icon('flag'), '判定参数（' + T.name + '）'),
          h('div', { class: 'grid2' }, pfields),
          T.basis ? h('div', { class: 'note', text: '统计口径：' + (typeof T.basis === 'function' ? '按任务 basis 字段' : T.basis) }) : null));
      }

      var anchors = t.anchors || (t.anchors = []);
      var acard = h('div', { class: 'card' });
      acard.appendChild(h('div', { class: 'row between', style: 'margin-bottom:7px' },
        h('h3', { style: 'margin:0' }, icon('target'), '锚点（' + anchors.length + '）'),
        h('div', { class: 'row', style: 'gap:5px' },
          h('button', { class: 'btn sm', onclick: function () {
            S.taskFocus = t;
            setTool('anchors');
            toast('点击地图放置锚点；放置后回来自动出现在这里');
          }, disabled: !S.src }, icon('pin'), '放置锚点'),
          h('button', { class: 'btn sm', onclick: function () {
            t.anchors = t.anchors || [];
            t.anchors.push({ name: '新锚点', x: r2(mapW() / 2), y: r2(mapH() / 2), r: 4 });
            touch({ now: true, draw: true }); precheck(); renderSheet(); scheduleDraw();
          } }, icon('plus'), '添加'))));
      if (anchors.length) {
        acard.appendChild(h('div', { class: 'anchor-head' }, h('span', { text: '名称' }), h('span', { text: 'x' }), h('span', { text: 'y' }), h('span', { text: '半径' }), h('span', { text: '' })));
        anchors.forEach(function (a, ai) {
          var name = h('input', { type: 'text', value: anchorName(a) });
          var x = h('input', { type: 'number', step: '0.01', value: a.x });
          var y = h('input', { type: 'number', step: '0.01', value: a.y });
          var r = h('input', { type: 'number', step: '0.5', value: a.r == null ? 4 : a.r });
          function upd() {
            a.name = name.value;
            var xv = Number(x.value), yv = Number(y.value), rv = Number(r.value);
            if (isFinite(xv)) a.x = r2(xv);
            if (isFinite(yv)) a.y = r2(yv);
            if (isFinite(rv) && rv > 0) a.r = rv;
            touch({ draw: true }); scheduleDraw();
          }
          name.oninput = upd; x.oninput = upd; y.oninput = upd; r.oninput = upd;
          var row = h('div', { class: 'anchor-row' }, name, x, y, r,
            h('div', { class: 'row', style: 'gap:1px' },
              h('button', { class: 'iconbtn', title: '定位', onclick: function () {
                S.sel = { kind: 'anchors', idx: ai, taskIdx: S.sheet.taskIdx };
                ensureVisible(a.x, a.y); renderInspector(); renderBrowser(); scheduleDraw();
              } }, icon('locate')),
              h('button', { class: 'iconbtn', title: '删除', onclick: function () {
                anchors.splice(ai, 1);
                if (S.sel && S.sel.kind === 'anchors' && S.sel.taskIdx === S.sheet.taskIdx && S.sel.idx === ai) S.sel = null;
                touch({ now: true, draw: true }); precheck(); renderSheet(); renderInspector(); renderBrowser(); scheduleDraw();
              } }, icon('trash'))));
          acard.appendChild(row);
        });
        acard.appendChild(h('div', { class: 'note', text: '锚点半径单位为格（4 格 = 1 km）。connect 任务要求每个锚点半径内都有车站，且这些车站在同一网络。' }));
      } else {
        acard.appendChild(h('div', { class: 'empty-note', text: '还没有锚点。connect 任务必须至少有一个；其它类型可以不用。' }));
      }
      det.appendChild(acard);
    }
    master.appendChild(det);
    box.appendChild(master);
  }

  function fmtYm(v) {
    if (!Array.isArray(v)) return '—';
    return v[0] + '/' + ('0' + (v[1] || 1)).slice(-2);
  }

  function datePairField(label, obj, key) {
    var wrap = h('div', { class: 'f' });
    wrap.appendChild(h('label', null, label, h('span', { class: 'u', text: '年 / 月' })));
    var row = h('div', { class: 'row', style: 'gap:5px' });
    var arr = Array.isArray(obj[key]) ? obj[key] : (obj[key] = [startYear(), 1]);
    var y = h('input', { type: 'number', step: '1', value: arr[0], style: 'flex:1.4' });
    var m = h('input', { type: 'number', step: '1', min: '1', max: '12', value: arr[1], style: 'flex:1' });
    function upd() {
      var yv = Number(y.value), mv = Number(m.value);
      if (!isFinite(yv) || !isFinite(mv)) return;
      arr[0] = Math.round(yv); arr[1] = clamp(Math.round(mv), 1, 12);
      obj[key] = arr;
      touch({ draw: false }); precheckSoon(); normalizeYear();
    }
    y.oninput = upd; m.oninput = upd;
    row.appendChild(y); row.appendChild(m);
    wrap.appendChild(row);
    return wrap;
  }

  function selectTask(idx) {
    S.sheet.open = true;
    S.sheet.tab = 'tasks';
    S.sheet.taskIdx = idx;
    var t = taskList()[idx];
    S.taskFocus = t || null;
    S.sel = null;
    S.regionSel = null;
    document.body.classList.add('sheet-open');
    $('sheet').classList.remove('closed');
    closePops();
    renderSheet();
    renderBrowser();
    renderInspector();
    scheduleDraw();
    renderDock();
  }

  function addTask() {
    var tasks = data().histTasks || (data().histTasks = []);
    var y = startYear();
    var t = { id: uniqueId('t', tasks), title: '新任务', type: 'connect', appear: [y, 1], deadline: [y + 8, 12], reward: 100000, desc: '', anchors: [] };
    tasks.push(t);
    S.sheet.taskIdx = tasks.length - 1;
    S.taskFocus = t;
    touch({ now: true, draw: true });
    precheck();
    renderDock();
    selectTask(tasks.length - 1);
    toast('已新增任务，填写标题、类型与锚点');
  }

  function deleteTask(idx) {
    var tasks = data().histTasks || [];
    var t = tasks[idx]; if (!t) return;
    if (!window.confirm('删除任务「' + taskName(t) + '」？它的锚点也会一起删除。')) return;
    tasks.splice(idx, 1);
    S.sheet.taskIdx = Math.min(idx, tasks.length - 1);
    S.taskFocus = tasks[S.sheet.taskIdx] || null;
    if (S.sel && S.sel.kind === 'anchors') S.sel = null;
    touch({ now: true, draw: true });
    precheck();
    pruneSelection();
    renderDock();
    renderSheet();
    renderInspector();
    renderBrowser();
    scheduleDraw();
    toast('已删除任务');
  }

  // ---------- 事件

  function renderEventsTab(box) {
    var evs = data().events || (data().events = []);
    box.appendChild(h('h2', { text: '历史事件' }));
    box.appendChild(h('p', { class: 'sub', text: '写入城市纪事，按年代顺序排列。编辑器只检查年月结构与顺序；是否合史实需要人工判断。' }));
    var cols = [
      { k: 'y', label: '年', kind: 'int', w: 50 },
      { k: 'm', label: '月', kind: 'int', optional: true, w: 42 },
      { k: 'tag', label: '标签', kind: 'text', w: 52 },
      { k: 'title', label: '标题', kind: 'text', w: 170 },
      { k: 'desc', label: '说明', kind: 'text', w: 280 }
    ];
    var extra = h('button', { class: 'btn sm', onclick: function () {
      evs.sort(function (a, b) { return (a.y * 12 + (a.m || 1)) - (b.y * 12 + (b.m || 1)); });
      touch({ now: true }); renderSheet(); toast('已按时间排序');
    } }, icon('clock'), '按时间排序');
    box.appendChild(table(evs, cols, {
      extra: extra,
      onAdd: function () {
        evs.push({ y: startYear(), m: 1, tag: '史实', title: '新事件', desc: '' });
        evs.sort(function (a, b) { return (a.y * 12 + (a.m || 1)) - (b.y * 12 + (b.m || 1)); });
        touch({ now: true }); precheck(); renderSheet();
      },
      onDel: function (i) { evs.splice(i, 1); touch({ now: true }); precheck(); renderSheet(); }
    }));
    box.appendChild(h('div', { class: 'note', text: '事件年份会影响年代预览的上限与列表排序，但不会在地图上产生图形。' }));
  }

  // ---------- 经济

  function renderMacroTab(box) {
    box.appendChild(h('h2', { text: '宏观经济' }));
    box.appendChild(h('p', { class: 'sub', text: '仅真实城市启用；虚构地图对应 fake（不启用）。GDP、财政与结构数据用于城市统计与经营难度校准。' }));
    var cfg = S.src.cfg || (S.src.cfg = {});
    if (!cfg.macro) {
      box.appendChild(h('div', { class: 'card' },
        h('h3', null, icon('chart'), '当前没有 macro 配置'),
        h('div', { class: 'hint', text: '真实城市必须在 cfg 里覆盖 macro。可以从 config.js 的基线复制一份再改。' }),
        h('button', { class: 'btn sm primary', style: 'margin-top:9px', onclick: function () {
          cfg.macro = clone(CM.CFG.macro);
          touch({ now: true, draw: false }); precheck(); renderSheet(); toast('已复制基线 macro');
        } }, icon('plus'), '从基线创建')));
      return;
    }
    var mac = cfg.macro;
    var fields = [
      { k: 'area', label: '统计范围', kind: 'text', wide: true },
      { k: 'region', label: '地区', kind: 'text' },
      { k: 'gdp0', label: '开局 GDP（万）', kind: 'num' },
      { k: 'histEnd', label: '历史截止年', kind: 'int' },
      { k: 'ref', label: '参考序列', kind: 'text' },
      { k: 'infl', label: '价格序列', kind: 'text' },
      { k: 'revElastic', label: '财政弹性', kind: 'num' },
      { k: 'revRatio', label: '财政占 GDP', kind: 'json' },
      { k: 'prod', label: '生产率趋势', kind: 'json' },
      { k: 'longRun', label: '远期', kind: 'json' },
      { k: 'struct', label: '产业结构暴露度', kind: 'json' },
      { k: 'events', label: '经济事件', kind: 'json', wide: true, rows: 9 }
    ];
    box.appendChild(formCard('宏观参数', fields, mac, { icon: 'chart', note: '经济事件中缺省 desc 会使用内置文案；scale 为冲击强度。' }));
    box.appendChild(h('div', { class: 'note', text: '修改后请在游戏里跑一次三方案校准（不建设 / 合理首线 / 低效超规模），确认起步资金与财政可持续性。' }));
  }

  // ---------- 其他与 JSON

  var KNOWN_DATA_KEYS = { regions: 1, centers: 1, landmarks: 1, facilities: 1, histTasks: 1, events: 1, plans: 1 };

  function renderRestTab(box) {
    var d = data();
    box.appendChild(h('h2', { text: '其余数据' }));
    box.appendChild(h('p', { class: 'sub', text: '上面没有专属表单的字段。JSON 失焦/输入时校验，坏 JSON 只标红、不写入。' }));
    if (isObj(d.briefing)) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h3', null, icon('flag'), '开场简报 briefing'));
      card.appendChild(field({ k: 'lead', label: '导语', kind: 'textarea', rows: 3, wide: true }, d.briefing, { draw: false }));
      card.appendChild(field({ k: 'modes', label: '交通方式说明', kind: 'json', rows: 6, wide: true, hint: '[[key, 名称, 说明], …]' }, d.briefing, { draw: false }));
      box.appendChild(card);
    }
    var keys = Object.keys(d).filter(function (k) { return !KNOWN_DATA_KEYS[k] && k !== 'briefing'; });
    if (!keys.length) { box.appendChild(h('div', { class: 'sheet-empty', text: '没有其他字段。' })); return; }
    keys.forEach(function (k) {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h3', null, icon('folder'), k));
      var ta = h('textarea', { spellcheck: 'false', rows: 6, style: 'width:100%;min-height:74px;background:var(--input-bg);border:1px solid var(--input-line);border-radius:7px;padding:7px 8px;font:10.5px/1.55 var(--mono);resize:vertical' });
      ta.value = pretty(d[k]);
      ta.oninput = function () {
        try {
          var v = JSON.parse(ta.value || 'null');
          if (v === null) delete d[k]; else d[k] = v;
          ta.classList.remove('bad');
          touch({ draw: false }); precheck();
          if (k === 'defaultRegion' || k === 'roadYears' || k === 'simRoads') scheduleDraw();
        } catch (e) { ta.classList.add('bad'); }
      };
      card.appendChild(ta);
      box.appendChild(card);
    });
    box.appendChild(h('div', { class: 'note', text: '字段很多且结构不同，这里不做逐字段表单；常用字段已在其它分页里覆盖。' }));
  }

  function renderRawTab(box) {
    box.appendChild(h('h2', { text: '整份 JSON' }));
    box.appendChild(h('p', { class: 'sub', text: '直接编辑整个 source.json。点「应用」后才会替换编辑器中的对象；坏 JSON 不会写入。' }));
    var ta = h('textarea', { class: 'rawbox', spellcheck: 'false' });
    ta.value = pretty(S.src);
    var bar = h('div', { class: 'sheet-bar' },
      h('button', { class: 'btn sm primary', onclick: function () {
        try {
          var v = JSON.parse(ta.value);
          if (!isObj(v) || !isObj(v.meta)) throw new Error('缺少 meta');
          commitHistory();
          var oldGeo = S.src.meta && S.src.meta.geo, oldW = mapW(), oldH = mapH();
          S.src = v;
          S.sel = null; S.regionSel = null; S.taskFocus = null;
          normalizeYear();
          rebuildRegionShapes();
          precheck();
          updateFileChrome();
          updateDirtyUI();
          setupMapVisuals();
          renderInspector();
          renderBrowser();
          renderSheet();
          commitHistory();
          toast('已应用整份 JSON');
        } catch (e) { ta.classList.add('bad'); toast('JSON 无法应用：' + e.message); }
      } }, icon('check'), '应用'),
      h('button', { class: 'btn sm', onclick: function () {
        try { ta.value = pretty(JSON.parse(ta.value)); ta.classList.remove('bad'); }
        catch (e) { ta.classList.add('bad'); toast('JSON 解析失败：' + e.message); }
      } }, '格式化'),
      h('button', { class: 'btn sm', onclick: function () {
        try {
          var v = JSON.parse(ta.value);
          if (navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(v, null, 2)).then(function () { toast('已复制'); }, function () { toast('复制失败'); });
        } catch (e) { toast('JSON 解析失败'); }
      } }, icon('export'), '复制'));
    box.appendChild(bar);
    box.appendChild(ta);
    box.appendChild(h('div', { class: 'note', text: '应用会重新载入底图与预检；地图尺寸或 geo 变化时相机会重置。' }));
  }

  // ============================================================ 启动页

  function renderLandingCards() {
    var box = $('mapCards'); if (!box) return;
    clear(box);
    MAP_CARDS.forEach(function (m) {
      var b = h('button', { class: 'map-card', onclick: function () { loadMapById(m.id); } },
        h('b', null, m.name, h('span', { class: 'tag', text: m.tag })),
        h('span', { text: m.desc }),
        h('span', { class: 'go' }, '载入', icon('chev')));
      b.id = 'mapcard-' + m.id;
      box.appendChild(b);
    });
  }

  function showLandingError(msg) {
    var e = $('landingErr'); if (!e) return;
    e.textContent = msg;
    e.classList.toggle('on', !!msg);
  }

  function refreshPanels() {
    renderDock();
    renderInspector();
    renderBrowser();
    renderSheetIfOpen();
    updateFileChrome();
    updateYearUI();
    updateStatusSel();
    scheduleDraw();
  }

  // ============================================================ 文件与载入

  function setSource(text, name, dir, handle) {
    try {
      var src = JSON.parse(text);
      if (!isObj(src) || !isObj(src.meta)) throw new Error('缺少 meta');
      stopYearPlay();
      S.src = src;
      S.name = name || 'source.json';
      S.dir = dir || '';
      S.handle = handle || null;
      S.sel = null; S.regionSel = null; S.taskFocus = null;
      S.issues = []; S.year = null;
      S.tool = 'select';
      S.sheet.open = false; S.sheet.tab = 'meta'; S.sheet.regionIdx = 0; S.sheet.taskIdx = 0;
      S.browser.open = false; S.browser.tab = 'all'; S.browser.q = '';
      document.body.classList.remove('sheet-open');
      $('sheet').classList.add('closed');
      $('browser').classList.add('closed');
      closePops();
      H.busy = false;
      resetHistory();
      document.body.classList.add('has-map');
      showLandingError('');
      MAP.ix = null; MAP.base = null; MAP.regions = []; MAP.regionLabels = []; MAP.hover = null;
      updateFileChrome();
      updateDirtyUI();
      renderDock();
      renderToolbar();
      renderInspector();
      renderBrowser();
      updateYearUI();
      setupMapVisuals();
      precheck();
      draw();
      toast('已打开 ' + (S && S.name) + (dir ? ' · ' + dir : ''));
    } catch (e) {
      showLandingError('打开失败：' + e.message);
      toast('打开失败：' + e.message);
    }
  }

  function loadMapById(id) {
    if (!id) return;
    if (S.src && snap() !== H.saved && !window.confirm('当前地图有未保存改动，载入示例地图会丢失。继续？')) return;
    showLandingError('');
    document.querySelectorAll('.map-card').forEach(function (b) { b.disabled = true; });
    toast('载入示例地图：' + id + '…');
    fetch('../maps/' + encodeURIComponent(id) + '/source.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        setSource(text, 'source.json', 'maps/' + id, null);
      })
      .catch(function (err) {
        document.querySelectorAll('.map-card').forEach(function (b) { b.disabled = false; });
        showLandingError('无法读取 maps/' + id + '/source.json：' + err.message +
          '。示例地图需要通过 http 访问，请在仓库根目录运行 python -m http.server 8000，再打开 http://localhost:8000/tools/editor.html。');
        toast('示例地图读取失败，请用本地静态服务器打开');
      });
  }

  async function openFile() {
    if (S.src && snap() !== H.saved && !window.confirm('当前地图有未保存改动，打开另一份会丢失。继续？')) return;
    if (window.showOpenFilePicker) {
      try {
        var picked = await window.showOpenFilePicker({ types: [{ description: 'source.json', accept: { 'application/json': ['.json'] } }] });
        var fh = picked[0], f = await fh.getFile(), text = await f.text();
        setSource(text, f.name, '', fh);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    $('pick').click();
  }

  async function saveFile(asNew) {
    if (!S.src) return;
    var text = JSON.stringify(S.src, null, 2) + '\n';
    if (!asNew && S.handle) {
      try {
        var w = await S.handle.createWritable();
        await w.write(text); await w.close();
        markSaved();
        updateFileChrome();
        toast('已写回 ' + S.name);
        return;
      } catch (e) {
        toast('写回失败，改为下载：' + e.message);
      }
    }
    var id = (S.src.meta && S.src.meta.id) || 'source';
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = id + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast('已下载 ' + id + '.json；请覆盖 maps/' + id + '/source.json 后再运行 map-source build');
  }

  function closeMap() {
    if (!S.src) return;
    if (snap() !== H.saved && !window.confirm('当前地图有未保存改动，关闭会丢失。继续？')) return;
    stopYearPlay();
    S.src = null; S.name = ''; S.dir = ''; S.handle = null;
    S.sel = null; S.regionSel = null; S.taskFocus = null; S.issues = []; S.year = null;
    S.sheet.open = false; S.browser.open = false;
    H.stack = []; H.idx = -1; H.saved = ''; H.busy = false; clearTimeout(H.timer); H.timer = 0;
    MAP.ix = null; MAP.base = null; MAP.regions = []; MAP.regionLabels = []; MAP.hover = null; MAP.hoverRegion = null;
    MAP.loadToken++;
    closePops();
    hideHelp();
    $('sheet').classList.add('closed');
    $('browser').classList.add('closed');
    document.body.classList.remove('has-map', 'dirty', 'sheet-open');
    updateFileChrome();
    updateDirtyUI();
    renderDock();
    renderToolbar();
    renderInspector();
    updateYearUI();
    precheck();
    fitMap();
    scheduleDraw();
    toast('已关闭地图');
  }

  function reloadFromDisk() {
    if (!S.src) return;
    if (S.handle && S.handle.getFile) {
      S.handle.getFile().then(function (f) { return f.text(); }).then(function (text) {
        var d = S.dir;
        setSource(text, S.handle.name || 'source.json', d, S.handle);
      }).catch(function (e) { toast('重新读取失败：' + e.message); });
      return;
    }
    var m = /^maps\/([^/]+)$/.exec(S.dir || '');
    if (m) { loadMapById(m[1]); return; }
    toast('这个文件不是通过示例地图或文件句柄打开的，无法重新载入');
  }

  // ============================================================ 键盘

  function isTyping(e) {
    var t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function initKeyboard() {
    window.addEventListener('keydown', function (e) {
      var k = (e.key || '').toLowerCase();
      if (k === 'escape') {
        if (isTyping(e)) { e.target.blur(); return; }
        if (!$('helpOverlay').hidden) { hideHelp(); return; }
        if (S.pop) { closePop(S.pop); return; }
        if (S.sheet.open) { closeSheet(); return; }
        if (S.browser.open) { closeBrowser(); return; }
        if (S.tool !== 'select') { setTool('select'); return; }
        if (S.regionSel != null) { S.regionSel = null; scheduleDraw(); renderInspector(); return; }
        clearSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveFile(false); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); openFile(); return; }
      if (isTyping(e)) return;
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'v') setTool('select');
      else if (k === 'b') setTool('landmarks');
      else if (k === 'p') setTool('facilities');
      else if (k === 'c') setTool('centers');
      else if (k === 'a') setTool('anchors');
      else if (k === 'l') { if (S.browser.open) closeBrowser(); else openBrowser('all'); }
      else if (k === 'd') { if (!S.src) return; if (S.sheet.open) closeSheet(); else openSheet(S.sheet.tab || 'meta'); }
      else if (k === 'y') { if (S.src) togglePop('yearPop'); }
      else if (k === 't') applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      else if (k === 'f') { fitMap(); scheduleDraw(); }
      else if (k === '?') showHelp();
      else if (k === 'delete' || k === 'backspace') { if (S.sel) { e.preventDefault(); deleteSelected(); } }
      else if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') {
        e.preventDefault();
        if (S.sel) {
          var dx = k === 'arrowleft' ? -1 : (k === 'arrowright' ? 1 : 0);
          var dy = k === 'arrowup' ? -1 : (k === 'arrowdown' ? 1 : 0);
          nudgeSelected(dx, dy, e.shiftKey);
        } else {
          var step = 24 / MAP.cam.z;
          if (k === 'arrowleft') MAP.cam.x -= step;
          if (k === 'arrowright') MAP.cam.x += step;
          if (k === 'arrowup') MAP.cam.y -= step;
          if (k === 'arrowdown') MAP.cam.y += step;
          clampCam(); scheduleDraw();
        }
      }
      else if (k === '+' || k === '=') { zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25); }
      else if (k === '-' || k === '_') { zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.25); }
      else if (k === '[') { if (S.src) stepYear(-1); }
      else if (k === ']') { if (S.src) stepYear(1); }
      else if (/^[1-5]$/.test(k)) {
        var kind = ['regions', 'centers', 'landmarks', 'facilities', 'anchors'][Number(k) - 1];
        if (kind && S.src) { S.layers[kind] = S.layers[kind] === false; renderDock(); scheduleDraw(); }
      }
    });
  }

  // ============================================================ 启动

  function boot() {
    MAP.cv = $('mapcv');
    MAP.ctx = MAP.cv && MAP.cv.getContext ? MAP.cv.getContext('2d') : null;
    renderLandingCards();
    initTopbar();
    bindWindowOnce();
    initKeyboard();

    applyTheme(currentTheme(), true);
    renderDock();
    renderToolbar();
    renderInspector();
    updateFileChrome();
    updateYearUI();
    precheck();
    fitMap();
    scheduleDraw();

    $('pick').onchange = async function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (S.src && snap() !== H.saved && !window.confirm('当前地图有未保存改动，打开另一份会丢失。继续？')) { e.target.value = ''; return; }
      setSource(await f.text(), f.name, '', null);
      e.target.value = '';
    };

    var dragDepth = 0;
    window.addEventListener('dragover', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      e.preventDefault();
      dragDepth++;
      $('drop').classList.add('on');
    });
    window.addEventListener('dragleave', function (e) {
      if (e.relatedTarget === null) { dragDepth = 0; $('drop').classList.remove('on'); }
    });
    window.addEventListener('drop', async function (e) {
      e.preventDefault();
      dragDepth = 0;
      $('drop').classList.remove('on');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (S.src && snap() !== H.saved && !window.confirm('当前地图有未保存改动，打开另一份会丢失。继续？')) return;
      setSource(await f.text(), f.name, '', null);
    });

    window.addEventListener('beforeunload', function (e) {
      if (S.src && snap() !== H.saved) { e.preventDefault(); e.returnValue = ''; }
    });

    var q = new URLSearchParams(location.search);
    var qm = q.get('map');
    var qt = q.get('theme');
    if (qt === 'dark' || qt === 'light') applyTheme(qt, true);
    if (qm) {
      var ok = MAP_CARDS.some(function (m) { return m.id === qm; });
      if (ok) loadMapById(qm);
      else showLandingError('未知地图 id：' + qm);
    }
  }

  // 供测试与调试（无头浏览器 / Node 脚本）
  window.ED = {
    ready: true,
    state: S, map: MAP, history: H,
    validate: validate, setSource: setSource, loadMap: loadMapById,
    markers: markers, pickAll: pickAll, w2s: w2s, s2w: s2w,
    placeAt: placeAt, deleteSelected: deleteSelected, draw: draw, scheduleDraw: scheduleDraw,
    buildBase: buildBase, loadGeoScript: loadGeoScript, prepareGeo: prepareGeo, paintBase: paintBase,
    select: select, selectTask: selectTask, selectRegion: selectRegion,
    openSheet: openSheet, closeSheet: closeSheet, openBrowser: openBrowser, closeBrowser: closeBrowser,
    setTool: setTool, undo: undo, redo: redo, saveFile: saveFile, closeMap: closeMap,
    setYear: setYear, stepYear: stepYear, togglePop: togglePop, addTask: addTask, addRegion: addRegion,
    nudgeSelected: nudgeSelected,
    regionShapes: function () { return MAP.regions; },
    snapshot: function () { return snap(); },
    saved: function () { return H.saved; },
    render: function () { renderDock(); renderInspector(); renderBrowser(); renderSheetIfOpen(); updateFileChrome(); updateYearUI(); scheduleDraw(); }
  };

  boot();
})();
