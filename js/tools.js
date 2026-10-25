'use strict';
// 地图交互与建设工具：选择、建站、绘线、修改、拆除；平移缩放与快捷键
(function (CM) {
  const U = CM.U, CFG = CM.CFG, M = CM.Metro;
  const sfx = function (n) { if (CM.Sound) CM.Sound.play(n); };

  function Tools(R, ui) {
    this.R = R; this.ui = ui;
    this.tool = 'select';
    this.buildType = 'underground'; this.stationSize = 'M';
    this.lineChoice = 'new';
    this.chain = null; this.bends = [];
    this.pick = null;
    this.cursor = null; this.hover = null; this.hint = null;
    this.ptr = null; this.drag = null;
    this.keys = new Set();
    this.bind();
  }
  CM.Tools = Tools;

  Tools.prototype.game = function () { return CM.game; };
  Tools.prototype.setTool = function (t) {
    if (this.tool === t) return;
    this.cancelDrag();
    if (this.ui.closeLinePicker) this.ui.closeLinePicker();
    this.tool = t;
    this.chain = null; this.bends = []; this.drag = null; this.hint = null; this.hover = null; this.lineLock = false; this.pick = null;
    this.ui.setTooltip(null);
    this.ui.onToolChange(t);
  };
  // 中断未完成的拖动：恢复拖动前草案，不留下阻塞保存的 liveSnap。
  Tools.prototype.cancelDrag = function () {
    const g = this.game(), active = !!this.drag || !!(g && g.draft && g.draft.liveSnap);
    this.drag = null; this.ptr = null;
    if (g && g.draft && g.draft.liveSnap) g.endLive(false);
    return active;
  };
  Tools.prototype.net = function () { const g = this.game(); return g.draft ? g.draft.net : g.net; };
  // 草案变化（编辑、撤销、重做、放弃、确认）后校正工具状态，避免引用已不存在的车站或线路
  Tools.prototype.syncDraft = function () {
    if (!this.game()) return;
    const net = this.net();
    if (this.chain && !net.stations[this.chain]) { this.chain = null; this.bends = []; }
    if (this.ui.linePicker && this.ui.linePicker.sid !== this.chain) this.ui.closeLinePicker();
    if (this.lineChoice !== 'new' && !net.lines[this.lineChoice]) this.lineChoice = 'new';
  };

  // ---------------- 事件绑定 ----------------
  Tools.prototype.bind = function () {
    const cv = this.R.cv, self = this;
    cv.addEventListener('pointerdown', function (e) { if (self.touchDown(e)) return; self.onDown(e); });
    window.addEventListener('pointermove', function (e) { if (self.touchMove(e)) return; self.onMove(e); });
    window.addEventListener('pointerup', function (e) { if (self.touchUp(e)) return; self.onUp(e); });
    window.addEventListener('pointercancel', function (e) { if (self.touchUp(e)) return; self.cancelDrag(); });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); if (!self.game()) return; const k = e.deltaMode === 1 ? 40 : 1; self.R.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * k * 0.0016)); }, { passive: false });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('dblclick', function (e) { self.onDbl(e); });
    window.addEventListener('keydown', function (e) { self.onKey(e); });
    window.addEventListener('keyup', function (e) { self.keys.delete(e.key.toLowerCase()); });
    window.addEventListener('blur', function () { self.keys.clear(); self.cancelDrag(); if (self.touches) self.touches.clear(); self.pinch = null; });
  };
  // ---------------- 触屏：双指缩放与平移 ----------------
  // 第二根手指按下时进入缩放：取消单指的点击 / 拖动，按两指距离缩放、按中点平移；返回 true 表示事件已处理
  Tools.prototype.touchDown = function (e) {
    if (e.pointerType !== 'touch') return false;
    const T = this.touches || (this.touches = new Map());
    T.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (T.size < 2) return false;
    this.cancelDrag();
    this.ptr = null; this.ui.setTooltip(null);
    const p = Array.from(T.values());
    this.pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2 };
    if (CM.Follow && CM.Follow.active()) CM.Follow.stop();
    return true;
  };
  Tools.prototype.touchMove = function (e) {
    const T = this.touches;
    if (e.pointerType !== 'touch' || !T || !T.has(e.pointerId)) return false;
    T.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.pinch || T.size < 2 || !this.game()) return false;
    const p = Array.from(T.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
    this.R.panBy(mx - this.pinch.mx, my - this.pinch.my);
    this.R.zoomAt(mx, my, d / this.pinch.d);
    this.pinch.d = d; this.pinch.mx = mx; this.pinch.my = my;
    return true;
  };
  Tools.prototype.touchUp = function (e) {
    const T = this.touches;
    if (e.pointerType !== 'touch' || !T) return false;
    T.delete(e.pointerId);
    if (!this.pinch) return false;
    if (T.size < 2) this.pinch = null;   // 松开一指后不再把剩下的手指当作点击
    this.ptr = null;
    return true;
  };
  Tools.prototype.onDown = function (e) {
    const g = this.game(); if (!g || this.ui.blocking()) return;
    try { if (this.R.cv.setPointerCapture) this.R.cv.setPointerCapture(e.pointerId); } catch (err) { /* 指针已失效时忽略 */ }
    this.ptr = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: false, shift: e.shiftKey, alt: e.altKey, t: performance.now() };
    if (e.button === 1) { this.ptr.pan = true; e.preventDefault(); return; }
    // 延长手柄：进入绘线，拖到目标位置松开即连线（只点击则从该端点开始逐站绘制）
    const ext = e.button === 0 ? this.pickExtend(e.clientX, e.clientY) : null;
    if (ext) { this.ui.startDraw(ext.station, ext.line, false); this.ptr.extend = true; return; }
    if (e.button === 0 && this.tool === 'edit' && !g.jumping) {
      const h = this.pickHandle(e.clientX, e.clientY);
      if (h) { this.drag = h; this.drag.changed = false; g.beginLive(); this.ptr.handle = true; }
    }
  };
  Tools.prototype.onMove = function (e) {
    const g = this.game(); if (!g) return;
    const R = this.R;
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.ptr) {
      const dx = e.clientX - this.ptr.x, dy = e.clientY - this.ptr.y;
      if (!this.ptr.moved && Math.hypot(e.clientX - this.ptr.sx, e.clientY - this.ptr.sy) > (e.pointerType === 'touch' ? 10 : 4)) this.ptr.moved = true;
      if (this.drag) { this.dragTo(e.clientX, e.clientY); }
      else if (this.ptr.extend) { /* 拖动延长手柄：只更新绘线预览 */ }
      else if (this.ptr.moved || this.ptr.pan) { if (CM.Follow && CM.Follow.active()) CM.Follow.stop(); R.panBy(dx, dy); this.ptr.pan = true; }
      this.ptr.x = e.clientX; this.ptr.y = e.clientY;
    }
    if (e.target !== R.cv && !this.ptr) { this.hover = null; this.ui.setTooltip(null); return; }
    this.updateHover(e.clientX, e.clientY, e.shiftKey || e.altKey);
    if (e.pointerType === 'touch') this.ui.setTooltip(null);   // 触屏没有悬停：拖动地图时不显示提示
  };
  Tools.prototype.onUp = function (e) {
    const g = this.game(); const p = this.ptr; this.ptr = null;
    if (!g || !p) return;
    if (this.drag) { const ch = this.drag.changed; this.drag = null; g.endLive(ch); if (ch) sfx('place'); return; }
    if (p.extend) { if (p.moved && this.tool === 'line' && this.chain) this.onClick(e.clientX, e.clientY, false); return; }
    if (p.pan && p.moved) return;
    if (p.button === 2) { this.onRight(e); return; }
    // 选择工具下点击行驶中的列车：进入跟随模式（车站优先）
    if (p.button === 0 && !p.moved && this.tool === 'select' && CM.Follow && !this.R.pickStation(e.clientX, e.clientY)) { const tr = CM.Follow.pick(e.clientX, e.clientY); if (tr) { CM.Follow.start(tr); return; } }
    if (p.button === 0 && !p.moved) this.onClick(e.clientX, e.clientY, e.shiftKey || e.altKey, e.ctrlKey || e.metaKey || e.shiftKey);
  };

  // ---------------- 地图选点（接驳线终点等） ----------------
  // 有些东西没法用「候选清单」表达：接驳线该接到哪儿，取决于玩家看到的盲区。
  // 进入拾取状态后，下一次左键点击即回调地图坐标；右键、Esc 或换工具都会取消。
  Tools.prototype.startPick = function (opt) {
    this.cancelDrag();
    this.pick = { kind: (opt && opt.kind) || 'point', station: (opt && opt.station) || null, cb: opt && opt.cb };
    this.chain = null; this.bends = [];
    this.ui.onToolChange(this.tool);
    this.hint = null;
    this.ui.setTooltip(null);   // 提示等鼠标移到地图上再显示（需要坐标定位）
  };
  Tools.prototype.cancelPick = function () {
    if (!this.pick) return false;
    this.pick = null; this.hint = null; this.hover = null; this.ui.setTooltip(null);
    return true;
  };

  // ---------------- 悬停与提示 ----------------
  Tools.prototype.world = function (sx, sy) { return this.R.unproject(sx, sy); };
  Tools.prototype.updateHover = function (sx, sy, mod) {
    const g = this.game(), R = this.R;
    const w = this.world(sx, sy);
    this.cursor = { sx: sx, sy: sy, x: w.x, y: w.y, mod: mod };
    if (this.pick) {
      this.hover = null;
      const tip = this.pick.kind === 'bus' && this.ui.busPickTip ? this.ui.busPickTip(this.pick.station, w.x, w.y) : null;
      this.hint = tip;
      this.ui.setTooltip(tip, sx, sy);
      R.cv.style.cursor = 'crosshair';
      return;
    }
    const ext = this.ptr ? null : this.pickExtend(sx, sy);
    if (ext) {
      const net0 = this.net();
      this.hover = null;
      this.hint = { title: '延长 ' + net0.lines[ext.line].name, lines: ['拖到目标位置松开：新建车站并连线', '点击：从「' + net0.stations[ext.station].name + '」开始逐站绘制'] };
      this.ui.setTooltip(this.hint, sx, sy);
      R.cv.style.cursor = 'grab';
      return;
    }
    const st = R.pickStation(sx, sy);
    const seg = st ? null : R.pickSegment(sx, sy);
    this.hover = st ? { kind: 'station', id: st } : (seg ? { kind: 'seg', id: seg } : null);
    let tip = null;
    const net = this.net();
    if (this.tool === 'select' || this.tool === 'edit' || this.tool === 'demolish') {
      if (st && net.stations[st]) {
        const s = net.stations[st];
        tip = { title: s.name, lines: [CFG.metro.sizeName[s.size] + ' · ' + CFG.metro.typeName[s.type] + '车站'] };
        if (this.tool === 'demolish') this.demolishTip(tip, { kind: 'station', id: st });
      } else if (seg && net.segments[seg]) {
        const sg = net.segments[seg], ln = net.lines[sg.line];
        tip = { title: (ln && ln.name ? ln.name + ' · ' : '') + net.stations[sg.a].name + '—' + net.stations[sg.b].name, lines: [CFG.metro.typeName[sg.type] + '轨道'] };
        if (this.tool === 'demolish') this.demolishTip(tip, { kind: 'seg', id: seg });
        if (this.tool === 'edit') tip.lines.push('点击选中后可拖动控制点调整线形');
      } else if (this.tool === 'select' && CM.Follow && CM.Follow.pick(sx, sy)) {
        tip = CM.Follow.describe(CM.Follow.pick(sx, sy));
      } else if (this.tool === 'select' && R.tEase < 0.5) {
        const L = R.pickLink(w.x, w.y, 0.22);
        if (L && L.name) {
          const W = g.model.weights(g.clock.minute);
          const r0 = g.model.arcVolAt(2 * L.id, W) / g.model.cap(2 * L.id), r1 = g.model.arcVolAt(2 * L.id + 1, W) / g.model.cap(2 * L.id);
          tip = { title: g.city.roadNames[L.name] || ['', '支路', '次干道', '主干道', '快速路'][L.cls] || '道路', lines: ['当前饱和度（流量/通行能力）：' + U.fmtPct(Math.max(r0, r1), 0), '点击查看道路详情'] };
        }
      }
    } else if (this.tool === 'station') {
      if (seg) tip = { title: '在轨道上插入车站', lines: ['新车站将成为该线路的一站'] };
      else if (!st) { const chk = M.checkSite(g.city, w.x, w.y, this.buildType); tip = chk.ok ? null : { title: '不能在此建站', lines: [chk.msg], bad: true }; }
    } else if (this.tool === 'line') {
      tip = this.linePreviewTip(w, st, seg, mod);
    }
    this.hint = tip;
    this.ui.setTooltip(tip, sx, sy);
    R.cv.style.cursor = this.ptr && this.ptr.pan ? 'grabbing' : (st || seg ? 'pointer' : (this.tool === 'select' ? 'default' : 'crosshair'));
  };
  // 拆除预览说明：实际网络变化（地图上同步高亮）
  Tools.prototype.demolishTip = function (tip, t) {
    const imp = this.ui.demolishImpact(t);
    tip.title = '拆除 ' + tip.title;
    if (imp && imp.lines.length) { for (const l of imp.lines.slice(0, 6)) tip.lines.push('· ' + l); if (imp.lines.length > 6) tip.lines.push('· 另有 ' + (imp.lines.length - 6) + ' 项变化'); }
    else tip.lines.push('· 不影响其他线路与车站');
    tip.lines.push('点击：拆除（进入草案，可撤销；确认前不生效）');
    tip.bad = true;
  };
  // 选中线路时，在线路端点显示延长手柄（选择 / 修改工具）
  Tools.prototype.extendHandles = function () {
    const g = this.game(), R = this.R, lid = this.ui.highlightLine;
    if (!g || g.jumping || !lid || (this.tool !== 'select' && this.tool !== 'edit')) return [];
    const net = this.net(), line = net.lines[lid];
    if (!line) return [];
    const tp = M.lineTopo(net, lid);
    if (tp.topo !== 'path' && tp.topo !== 'branch') return [];
    const out = [];
    for (const sid of tp.leaves) {
      const s = net.stations[sid], e = tp.adj.get(sid)[0];
      const p = M.adjCtrl(net, e.seg, sid);
      let dx = s.x - p[0], dy = s.y - p[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const q = R.P(s.x, s.y, 0), q2 = R.P(s.x + dx, s.y + dy, 0);
      let ux = q2.x - q.x, uy = q2.y - q.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      out.push({ kind: 'extend', station: sid, line: lid, color: line.color, ox: q.x, oy: q.y, sx: q.x + ux * 28, sy: q.y + uy * 28 });
    }
    return out;
  };
  Tools.prototype.pickExtend = function (sx, sy) {
    let best = null, bd = 13;
    for (const hd of this.extendHandles()) { const d = Math.hypot(hd.sx - sx, hd.sy - sy); if (d < bd) { bd = d; best = hd; } }
    return best;
  };
  // 起点决定线路：线路端点站 → 延长该线路；其余（空地、中间站、轨道上新建的换乘站）→ 新线路。
  // 返回将使用的线路 id（'new' 为新线路）；端点同时属于多条线路时优先保留当前所选
  // 以该站为端点、可以延长的线路（普通线与支线的叶端点）
  Tools.prototype.endLines = function (sid) {
    const net = this.net();
    if (!sid || !net.stations[sid]) return [];
    return M.stationLines(net, sid).filter(function (lid) {
      const tp = M.lineTopo(net, lid);
      return (tp.topo === 'path' || tp.topo === 'branch') && tp.adj && tp.adj.get(sid) && tp.adj.get(sid).length === 1;
    });
  };
  // 端点同时属于多条线路时：优先当前选中（高亮）的线路，其次上次绘制的线路；仍有歧义时由玩家在弹出的选择框中确认
  Tools.prototype.lineForStart = function (sid) {
    const ends = this.endLines(sid);
    if (!ends.length) return 'new';
    const hl = this.ui.highlightLine;
    if (hl && ends.indexOf(hl) >= 0) return hl;
    return ends.indexOf(this.lineChoice) >= 0 ? this.lineChoice : ends[0];
  };
  Tools.prototype.lineName = function (lid) {
    const net = this.net();
    if (lid !== 'new' && net.lines[lid]) return net.lines[lid].name;
    const used = new Set(Object.values(net.lines).map(function (l) { return l.num; }));
    let n = 1; while (used.has(n)) n++;
    return n + ' 号线（新）';
  };
  Tools.prototype.nextLineColor = function () {
    const net = this.net(), used = new Set(Object.values(net.lines).map(function (l) { return l.num; }));
    let n = 1; while (used.has(n)) n++;
    const cols = CM.DATA.lineColorsNice; return cols[(n - 1) % cols.length];
  };
  Tools.prototype.linePreviewTip = function (w, st, seg, mod) {
    const g = this.game(), net = this.net();
    if (!this.chain) {
      if (st) {
        const ends = this.endLines(st);
        if (ends.length >= 2) return { title: '「' + net.stations[st].name + '」是 ' + ends.length + ' 条线路的端点', lines: [ends.map(function (l) { return net.lines[l].name; }).join('、'), '点击后选择要延长的线路（也可以改为新线路）'] };
        const lid = this.lineForStart(st);
        return { title: (lid === 'new' ? '从「' + net.stations[st].name + '」开始新线路' : '延长 ' + net.lines[lid].name), lines: [lid === 'new' ? (M.stationLines(net, st).length ? '与已有线路在此换乘' : '依次点击车站或空地连线') : '从端点「' + net.stations[st].name + '」继续绘制', 'Shift+点击添加转弯点；右键结束'] };
      }
      if (seg) return { title: '在轨道上新建换乘站并开始新线路', lines: [] };
      const chk = M.checkSite(g.city, w.x, w.y, this.buildType);
      return chk.ok ? { title: '点击放置第一座车站（新线路）', lines: ['点击线路端点车站则延长该线路'] } : { title: '不能在此建站', lines: [chk.msg], bad: true };
    }
    const A = net.stations[this.chain];
    if (!A) return null;
    let end = [w.x, w.y], newSt = true;
    if (st) { end = [net.stations[st].x, net.stations[st].y]; newSt = false; }
    const pv = this.previewGeom(end);
    const geo = pv.geo;
    let cost = M.trackCost(geo, this.buildType, g.clock.y);
    if (newSt && !mod && !seg) cost += M.stationCost(this.buildType, this.stationSize, g.clock.y);
    const lines = ['长度 ' + U.fmtKm(geo.lenM) + (geo.waterM > 1 ? '，' + (this.buildType === 'underground' ? '越江隧道 ' : '跨江桥梁 ') + U.fmtKm(geo.waterM) : '') + ' · 约 ' + U.fmtMoney(cost)];
    let bad = false;
    if (mod) lines.unshift('松开 Shift 点击 = 连接；当前为添加转弯点');
    if (geo.hillM > 1 && this.buildType !== 'underground') { lines.push('经过山地风景区：仅可地下穿越'); bad = true; }
    if (geo.protM > 1 && this.buildType !== 'underground') { lines.push('穿越受保护建筑：' + geo.protNames.join('、')); bad = true; }
    if (geo.locked.length) { lines.push('经过未开放区域：' + geo.locked[0].name); bad = true; }
    if (!mod && isFinite(geo.minRadiusM) && geo.minRadiusM < CFG.metro.minRadiusM) { lines.push('弯道过急：半径约 ' + Math.round(geo.minRadiusM) + ' m（最小 ' + CFG.metro.minRadiusM + ' m），可 Shift+点击加转弯点'); bad = true; }
    if (!mod && pv.turn > CFG.metro.maxTurnAtStationDeg) { lines.push('在「' + A.name + '」处转向约 ' + Math.round(pv.turn) + '°（最大 ' + CFG.metro.maxTurnAtStationDeg + '°）'); bad = true; }
    if (newSt && !mod && !st && !seg) { const chk = M.checkSite(g.city, w.x, w.y, this.buildType); if (!chk.ok) { lines.push(chk.msg); bad = true; } }
    return { title: st ? '连接到「' + net.stations[st].name + '」' : (seg ? '连接并在该轨道上新建换乘站' : (mod ? '添加转弯点' : '新建车站并连接')), lines: lines, bad: bad };
  };
  // 预览：与正式建设相同的线形规则（站台直线段、与既有线路切线连续）
  Tools.prototype.previewGeom = function (end) {
    const g = this.game(), net = this.net();
    const A = net.stations[this.chain];
    const lid = this.lineChoice !== 'new' && net.lines[this.lineChoice] ? this.lineChoice : '__new';
    const stations = Object.create(net.stations);
    stations.__end = { id: '__end', x: end[0], y: end[1], type: this.buildType, size: this.stationSize, name: '' };
    const proxy = { stations: stations, segments: net.segments, lines: net.lines };
    const seg = { id: '__tmp', line: lid, a: this.chain, b: '__end', pts: this.bends, type: this.buildType };
    const ctrl = M.segControl(proxy, seg);
    const geo = M.geomFromControl(ctrl, this.buildType, g.city);
    // 车站处转角
    let turn = 0;
    const own = M.adjCtrl(proxy, seg, this.chain);
    let dx = own[0] - A.x, dy = own[1] - A.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    let best = 180, any = false;
    for (const id in net.segments) {
      const o = net.segments[id];
      if (o.line !== lid || (o.a !== this.chain && o.b !== this.chain)) continue;
      const p = M.adjCtrl(net, o, this.chain);
      let ox = p[0] - A.x, oy = p[1] - A.y; const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
      best = Math.min(best, 180 - Math.acos(U.clamp(dx * ox + dy * oy, -1, 1)) * 180 / Math.PI); any = true;
    }
    if (any) turn = best;
    return { geo: geo, turn: turn };
  };

  // ---------------- 点击 ----------------
  Tools.prototype.onClick = function (sx, sy, mod, multiKey) {
    const g = this.game(), R = this.R;
    if (g.jumping) return;
    const w = this.world(sx, sy);
    if (this.pick) {
      const pk = this.pick;
      this.cancelPick();
      if (pk.cb) pk.cb(w.x, w.y);
      return;
    }
    const st = R.pickStation(sx, sy);
    const seg = st ? null : R.pickSegment(sx, sy);
    const ui = this.ui;
    // 多选：Ctrl / Shift + 点击车站或轨道（选择、修改工具）
    if (multiKey && (st || seg) && (this.tool === 'select' || this.tool === 'edit')) { ui.toggleMulti(st ? 'station' : 'seg', st || seg); this.updateHover(sx, sy, mod); return; }
    switch (this.tool) {
      case 'select': {
        // 设施图层中优先选中设施圆点；其余情况下道路优先，其次是重要设施的场地（v1.9），再次是片区
        const facLayer = this.ui.layer === 'fac' || this.ui.layer === 'gap';
        const fid0 = !st && !seg && facLayer ? R.pickFacility(sx, sy, w.x, w.y) : null;
        if (st) ui.select({ kind: 'station', id: st });
        else if (seg) ui.select({ kind: 'seg', id: seg });
        else if (fid0) ui.select({ kind: 'facility', id: fid0 });
        else {
          const L = R.tEase < 0.5 ? R.pickLink(w.x, w.y, 0.22) : null;
          const fid = L && L.cls >= 2 ? null : R.pickFacility(sx, sy, w.x, w.y);
          if (L && L.cls >= 2) ui.select({ kind: 'road', id: L.id });
          else if (fid) ui.select({ kind: 'facility', id: fid });
          else {
            const c = g.city.cellAt(w.x, w.y);
            if (c >= 0 && this.ui.layer !== 'none') ui.select({ kind: 'zone', id: g.city.zoneOf(c) });
            else ui.select(null);
          }
        }
        break;
      }
      case 'station': {
        if (st) { ui.select({ kind: 'station', id: st }); break; }
        if (seg) {
          const r = g.edit((net) => M.splitSegment(net, seg, w.x, w.y, { size: this.stationSize, type: this.buildType }, g.city));
          if (r.station) ui.select({ kind: 'station', id: r.station });
          break;
        }
        const chk = M.checkSite(g.city, w.x, w.y, this.buildType);
        if (!chk.ok) { ui.toast('不能在此建站：' + chk.msg, 'bad'); break; }
        let id = null;
        g.edit((net) => { id = M.addStation(net, w.x, w.y, { size: this.stationSize, type: this.buildType }, g.city); });
        sfx('place');
        this.R.addFx('ripple', w.x, w.y);
        ui.select({ kind: 'station', id: id });
        break;
      }
      case 'line': this.lineClick(w, st, seg, mod); break;
      case 'edit': {
        if (st) ui.select({ kind: 'station', id: st });
        else if (seg) ui.select({ kind: 'seg', id: seg });
        else ui.select(null);
        break;
      }
      case 'demolish': {
        const net = this.net();
        if (st) {
          const s = net.stations[st];
          this.R.addFx('dust', s.x, s.y);
          ui.demolish({ kind: 'station', id: st });
        } else if (seg) {
          const gp = M.segGeom(net, net.segments[seg], g.city).pts;
          for (let k = 0; k < gp.length; k += Math.max(1, Math.floor(gp.length / 5))) this.R.addFx('dust', gp[k][0], gp[k][1], { small: true });
          ui.demolish({ kind: 'seg', id: seg });
        }
        break;
      }
    }
    this.updateHover(sx, sy, mod);
  };
  Tools.prototype.lineClick = function (w, st, seg, mod) {
    const g = this.game(), ui = this.ui, self = this;
    const opts = { size: this.stationSize, type: this.buildType };
    this.syncDraft();
    // 线路选择框打开时直接在地图上继续点击：按当前（默认）选择继续绘制
    if (ui.linePicker && !mod) ui.closeLinePicker();
    if (mod) {
      if (this.chain) { this.bends.push([w.x, w.y]); sfx('soft'); }
      else ui.toast('请先选择或放置起点车站，再添加转弯点', 'info');
      return;
    }
    if (!this.chain) {
      if (st) {
        // 起点自动决定线路；在工具条上明确选过、且经过该站的线路（如绘制支线）则保留
        const keep = this.lineLock && (this.lineChoice === 'new' || M.stationLines(this.net(), st).indexOf(this.lineChoice) >= 0);
        if (!keep) this.lineChoice = this.lineForStart(st);
        this.chain = st; this.bends = []; sfx('soft');
        ui.renderToolOpts();
        // 两条及以上线路在此站结束：弹出选择框，让玩家确认延长哪一条（默认项已预选，可直接继续点击）
        const ends = this.endLines(st);
        if (!keep && ends.length >= 2) ui.showLinePicker(st, ends);
        return;
      }
      if (seg) {
        const r = g.edit(function (net) { return M.splitSegment(net, seg, w.x, w.y, opts, g.city); });
        if (r.station) { this.chain = r.station; this.bends = []; if (!this.lineLock) this.lineChoice = 'new'; ui.renderToolOpts(); }
        return;
      }
      const chk = M.checkSite(g.city, w.x, w.y, this.buildType);
      if (!chk.ok) { ui.toast('不能在此建站：' + chk.msg, 'bad'); return; }
      let id = null;
      g.edit(function (net) { id = M.addStation(net, w.x, w.y, opts, g.city); });
      sfx('place');
      this.R.addFx('ripple', w.x, w.y);
      this.chain = id; this.bends = []; this.lineChoice = 'new';
      ui.renderToolOpts();
      return;
    }
    // 再次点击当前端点：结束本次绘线
    if (st && st === this.chain) { this.endChain(); return; }
    // 已有起点：连接
    const from = this.chain, bends = this.bends.slice();
    let target = st, err = null;
    if (!st && !seg) {
      const chk = M.checkSite(g.city, w.x, w.y, this.buildType);
      if (!chk.ok) { ui.toast('不能在此建站：' + chk.msg, 'bad'); return; }
    }
    const r = g.edit(function (net) {
      let lid = self.lineChoice;
      if (lid === 'new' || !net.lines[lid]) lid = M.newLine(net);
      let to = st;
      if (!to && seg) { const sp = M.splitSegment(net, seg, w.x, w.y, opts, g.city); to = sp.station; }
      if (!to) to = M.addStation(net, w.x, w.y, opts, g.city);
      if (to === from) return { error: '不能连接到同一车站' };
      const res = M.addSegment(net, lid, from, to, bends, self.buildType);
      if (res.error) return res;
      return { lid: lid, to: to };
    });
    if (r.error) { ui.toast(r.error, 'bad'); return; }
    sfx('lay');
    {
      const net0 = this.net(), sg0 = M.findSeg(net0, r.lid, from, r.to), ln0 = net0.lines[r.lid];
      if (sg0 && ln0) this.R.addFx('trace', 0, 0, { pts: M.segGeom(net0, sg0, g.city).pts, color: ln0.color, dur: 0.7 });
      const ts = net0.stations[r.to]; if (ts && !st) this.R.addFx('ripple', ts.x, ts.y, { color: ln0 ? ln0.color : null });
    }
    this.lineChoice = r.lid; target = r.to;
    this.chain = target; this.bends = [];
    const net = this.net();
    const tp = M.lineTopo(net, r.lid);
    if (tp.topo === 'loop') { ui.toast(net.lines[r.lid].name + ' 已形成环线', 'good'); this.chain = null; this.lineLock = false; }
    ui.renderToolOpts();
  };
  // 结束本次绘线（草案保留）；下次起点重新自动选择线路
  Tools.prototype.endChain = function (silent) {
    if (this.ui.closeLinePicker) this.ui.closeLinePicker();
    if (!this.chain && !this.bends.length) return false;
    this.chain = null; this.bends = []; this.lineLock = false;
    if (!silent) this.ui.toast('已结束本次绘线，草案保留', 'info');
    this.ui.renderToolOpts();
    return true;
  };
  Tools.prototype.onRight = function () {
    if (this.cancelPick()) return;
    if (this.tool === 'line') this.endChain();
  };
  Tools.prototype.onDbl = function (e) {
    const g = this.game(); if (!g || this.tool !== 'edit') return;
    const h = this.pickHandle(e.clientX, e.clientY);
    if (h && h.kind === 'bend') {
      g.edit(function (net) { const s = net.segments[h.seg]; s.pts.splice(h.k, 1); });
    }
  };

  // ---------------- 修改工具：控制点 ----------------
  Tools.prototype.handles = function () {
    const g = this.game(), sel = this.ui.selection, R = this.R;
    const out = [];
    if (!g || this.tool !== 'edit' || !sel) return out;
    const net = this.net();
    const addSeg = function (sid) {
      const s = net.segments[sid]; if (!s) return;
      const ctrl = M.userControl(net, s);
      for (let k = 0; k < (s.pts || []).length; k++) { const p = R.P(s.pts[k][0], s.pts[k][1], 0); out.push({ kind: 'bend', seg: sid, k: k, sx: p.x, sy: p.y }); }
      for (let k = 0; k + 1 < ctrl.length; k++) {
        const mx = (ctrl[k][0] + ctrl[k + 1][0]) / 2, my = (ctrl[k][1] + ctrl[k + 1][1]) / 2;
        const p = R.P(mx, my, 0); out.push({ kind: 'mid', seg: sid, k: k, sx: p.x, sy: p.y });
      }
    };
    if (sel.kind === 'seg') addSeg(sel.id);
    if (sel.kind === 'station' && net.stations[sel.id]) {
      const s = net.stations[sel.id], p = R.P(s.x, s.y, 0);
      out.push({ kind: 'station', id: sel.id, sx: p.x, sy: p.y });
      for (const id in net.segments) { const sg = net.segments[id]; if (sg.a === sel.id || sg.b === sel.id) addSeg(id); }
    }
    return out;
  };
  Tools.prototype.pickHandle = function (sx, sy) {
    let best = null, bd = 9;
    for (const h of this.handles()) { const d = Math.hypot(h.sx - sx, h.sy - sy); if (d < bd) { bd = d; best = h; } }
    if (!best) { const st = this.R.pickStation(sx, sy); if (st && this.ui.selection && this.ui.selection.kind === 'station' && this.ui.selection.id === st) best = { kind: 'station', id: st }; }
    return best ? Object.assign({}, best) : null;
  };
  Tools.prototype.dragTo = function (sx, sy) {
    const g = this.game(), d = this.drag, w = this.world(sx, sy);
    g.liveEdit(function (net) {
      if (d.kind === 'station') { const s = net.stations[d.id]; if (s) { s.x = w.x; s.y = w.y; } }
      else if (d.kind === 'bend') { const s = net.segments[d.seg]; if (s && s.pts[d.k]) s.pts[d.k] = [w.x, w.y]; }
      else if (d.kind === 'mid') { const s = net.segments[d.seg]; if (s) { s.pts = s.pts || []; s.pts.splice(d.k, 0, [w.x, w.y]); d.kind = 'bend'; } }
    });
    d.changed = true;
  };

  // ---------------- 键盘 ----------------
  Tools.prototype.onKey = function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    const g = this.game();
    const t = e.target, tag = (t && t.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // 文本框内 Esc 只取消编辑（移出焦点）；滑块、复选框、下拉框等控件上的 Esc 按全局关闭处理
      const textual = tag === 'TEXTAREA' || t.isContentEditable || (tag === 'INPUT' && /^(text|search|number|email|password|url|tel)$/i.test(t.type || 'text'));
      t.blur();
      if (textual) return;
    }
    if (this.pick && e.key === 'Escape') { e.preventDefault(); this.cancelPick(); return; }
    if (!g || this.ui.blocking()) { if (e.key === 'Escape') this.ui.escape(); return; }
    const k = e.key.toLowerCase();
    // 线路选择框打开时：数字键选择对应线路，Esc 关闭（保留当前选择）
    if (this.ui.linePicker && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (/^[1-9]$/.test(k) && this.ui.linePicker.pick(+k - 1)) { e.preventDefault(); return; }
      if (k === 'escape') { this.ui.closeLinePicker(); return; }
    }
    // 先匹配重做（Ctrl+Y / Ctrl+Shift+Z），再匹配撤销
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.ui.redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.ui.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'enter') { e.preventDefault(); if (g.draft) this.ui.confirmDraft(); return; }   // Ctrl+Enter 确认建设
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // 跟随列车时：H 隐藏/显示界面，Esc 退出跟随
    if (CM.Follow && CM.Follow.active()) {
      if (k === 'h') { CM.Follow.toggleUI(); return; }
      if (k === 'escape') { CM.Follow.stop(); return; }
    }
    this.keys.add(k);
    switch (k) {
      case ' ': e.preventDefault(); this.ui.togglePause(); break;
      case '1': case '2': case '3': this.ui.setSpeed(+k); break;
      case 'v': this.setTool('select'); break;
      case 'b': this.setTool('station'); break;
      case 'l': this.setTool('line'); break;
      case 'e': this.setTool('edit'); break;
      case 'x': this.setTool('demolish'); break;
      case 't': this.ui.toggleView(); break;
      case 'u': this.ui.toggleUnder(); break;
      case 'g': this.ui.openStats(); break;
      case 'k': this.ui.openNetMap(); break;
      case '/': e.preventDefault(); this.ui.openSearch(); break;
      case 'n': this.ui.toggleTheme(); break;
      case 'm': this.ui.toggleSound(); break;
      case 'f': this.R.fitAll(); break;
      case '=': case '+': this.R.zoomAt(this.R.w / 2, this.R.h / 2, 1.3); break;
      case '-': case '_': this.R.zoomAt(this.R.w / 2, this.R.h / 2, 1 / 1.3); break;
      case 'backspace': if (this.tool === 'line' && this.bends.length) { this.bends.pop(); e.preventDefault(); } else if (g.draft) { e.preventDefault(); this.ui.undo(); } break;
      case 'enter': if (this.tool === 'line') this.endChain(); break;
      case 'escape': this.escape(); break;
      default: break;
    }
  };
  Tools.prototype.escape = function () {
    if (this.tool === 'line' && this.endChain(true)) return;
    if (this.tool !== 'select') { this.setTool('select'); return; }
    this.ui.escape();
  };
  // 每帧：键盘平移
  Tools.prototype.tick = function (dt) {
    const K = this.keys; if (!K.size || !this.game()) return;
    const sp = 600 * dt;
    let dx = 0, dy = 0;
    if (K.has('a') || K.has('arrowleft')) dx += sp;
    if (K.has('d') || K.has('arrowright')) dx -= sp;
    if (K.has('w') || K.has('arrowup')) dy += sp;
    if (K.has('s') || K.has('arrowdown')) dy -= sp;
    if (dx || dy) { if (CM.Follow && CM.Follow.active()) CM.Follow.stop(); this.R.panBy(dx, dy); }
  };

  // ---------------- 覆盖层绘制 ----------------
  Tools.prototype.drawOverlay = function (ctx, R) {
    const g = this.game(); if (!g) return;
    const net = this.net();
    const cur = this.cursor;
    // 选点预览：站 → 光标 的虚线，加上终点步行圈（半径＝接驳端点步行覆盖）
    if (this.pick && cur && this.pick.station && net.stations[this.pick.station]) {
      const s0 = net.stations[this.pick.station];
      const bad = this.hint && this.hint.bad;
      const col = bad ? '#d63031' : '#e8590c';
      const a = R.P(s0.x, s0.y, 0), b = R.P(cur.x, cur.y, 0);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([7, 5]); ctx.lineDashOffset = -R.time * 18;
      ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      const rr = (CFG.bus ? CFG.bus.walkReachM : 400) / CFG.CELL_M;
      ctx.strokeStyle = bad ? 'rgba(214,48,49,0.5)' : 'rgba(232,89,12,0.55)'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) { const ang = k / 40 * Math.PI * 2; const p = R.P(cur.x + Math.cos(ang) * rr, cur.y + Math.sin(ang) * rr, 0); if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); ctx.fill();
    }
    // 绘线预览
    if (this.tool === 'line' && this.chain && net.stations[this.chain] && cur) {
      const st = this.hover && this.hover.kind === 'station' ? net.stations[this.hover.id] : null;
      const end = st ? [st.x, st.y] : [cur.x, cur.y];
      const geo = this.previewGeom(end).geo;
      const lid = this.lineChoice;
      const col = net.lines[lid] ? net.lines[lid].color : CM.DATA.lineColorsNice[(Object.keys(net.lines).length) % CM.DATA.lineColorsNice.length];
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = R.lineWidthPx() + 3;
      ctx.beginPath(); geo.pts.forEach(function (p, i) { const q = R.P(p[0], p[1], 0); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
      ctx.strokeStyle = this.hint && this.hint.bad ? '#d63031' : col; ctx.lineWidth = R.lineWidthPx(); ctx.setLineDash([8, 6]); ctx.lineDashOffset = -R.time * 20;
      ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      for (const b of this.bends) { const q = R.P(b[0], b[1], 0); ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      if (!st) { const q = R.P(end[0], end[1], 0); ctx.strokeStyle = this.hint && this.hint.bad ? '#d63031' : col; ctx.lineWidth = 2.5; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    // 建站预览
    if (this.tool === 'station' && cur && !this.hover) {
      const q = R.P(cur.x, cur.y, 0);
      const ok = M.checkSite(g.city, cur.x, cur.y, this.buildType).ok;
      ctx.strokeStyle = ok ? '#1e88e5' : '#d63031'; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (!ok) { ctx.beginPath(); ctx.moveTo(q.x - 4, q.y - 4); ctx.lineTo(q.x + 4, q.y + 4); ctx.moveTo(q.x + 4, q.y - 4); ctx.lineTo(q.x - 4, q.y + 4); ctx.stroke(); }
      // 步行覆盖半径示意（直线 15 分钟）
      const r = CFG.walk.maxAccessM / CFG.CELL_M;
      ctx.strokeStyle = 'rgba(30,136,229,0.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI * 2; const p = R.P(cur.x + Math.cos(a) * r, cur.y + Math.sin(a) * r, 0); if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // 拆除预览：红色 = 将拆除；绿色虚线 = 轨道直连保留；灰色 = 失去服务的车站；橙色 = 不再换乘
    if (this.tool === 'demolish' && this.hover) {
      const imp = this.ui.demolishImpact(this.hover);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (imp) for (const id of imp.removed) if (R.segPx && R.segPx.get(id)) { ctx.strokeStyle = 'rgba(214,48,49,0.7)'; ctx.lineWidth = R.lineWidthPx() + 6; R.strokeArr(ctx, R.segPx.get(id)); }
      if (this.hover.kind === 'station') { const s = net.stations[this.hover.id]; if (s) { const q = R.P(s.x, s.y, 0); ctx.strokeStyle = 'rgba(214,48,49,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(q.x, q.y, 12, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(q.x - 6, q.y - 6); ctx.lineTo(q.x + 6, q.y + 6); ctx.moveTo(q.x + 6, q.y - 6); ctx.lineTo(q.x - 6, q.y + 6); ctx.stroke(); } }
      if (imp) {
        for (const id of imp.added) {
          const sg = imp.after.segments[id], ln = imp.after.lines[sg.line];
          const pts = M.segGeom(imp.after, sg, g.city).pts;
          ctx.beginPath(); pts.forEach(function (p, i) { const q = R.P(p[0], p[1], 0); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
          ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = R.lineWidthPx() + 3; ctx.stroke();
          ctx.strokeStyle = ln ? ln.color : '#2e9d57'; ctx.lineWidth = R.lineWidthPx(); ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]);
        }
        const ring = function (sid, col) { const s = imp.after.stations[sid]; if (!s) return; const q = R.P(s.x, s.y, 0); ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); };
        for (const sid of imp.lost) ring(sid, 'rgba(110,118,130,0.95)');
        for (const sid of imp.lostXfer) ring(sid, 'rgba(232,130,30,0.95)');
      }
    }
    // 多选高亮
    const mu = this.ui.multi;
    if (mu) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      mu.segs.forEach(function (id) { if (R.segPx && R.segPx.get(id)) { ctx.strokeStyle = 'rgba(30,136,229,0.45)'; ctx.lineWidth = R.lineWidthPx() + 9; R.strokeArr(ctx, R.segPx.get(id)); } });
      mu.stations.forEach(function (sid) {
        const s = net.stations[sid]; if (!s) return;
        const q = R.P(s.x, s.y, 0);
        ctx.fillStyle = 'rgba(30,136,229,0.18)'; ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(q.x, q.y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    }
    // 延长手柄
    for (const hd of this.extendHandles()) {
      ctx.strokeStyle = hd.color; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hd.ox, hd.oy); ctx.lineTo(hd.sx, hd.sy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hd.sx, hd.sy, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hd.color; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hd.sx - 4.5, hd.sy); ctx.lineTo(hd.sx + 4.5, hd.sy); ctx.moveTo(hd.sx, hd.sy - 4.5); ctx.lineTo(hd.sx, hd.sy + 4.5); ctx.lineWidth = 2.2; ctx.stroke();
    }
    // 修改工具控制点
    if (this.tool === 'edit') {
      for (const h of this.handles()) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 2;
        ctx.beginPath();
        if (h.kind === 'mid') { ctx.moveTo(h.sx, h.sy - 5); ctx.lineTo(h.sx + 5, h.sy); ctx.lineTo(h.sx, h.sy + 5); ctx.lineTo(h.sx - 5, h.sy); ctx.closePath(); }
        else if (h.kind === 'bend') ctx.arc(h.sx, h.sy, 5, 0, Math.PI * 2);
        else continue;
        ctx.fill(); ctx.stroke();
      }
    }
    // 冲突：高亮涉及的轨道/车站，并在准确位置放置编号图钉（与面板列表编号一致）
    if (g.draft) {
      const ev = g.draftEval();
      if (ev && ev.conflicts.length) {
        const hov = this.ui.hoverConflict;
        const pulse = 0.5 + 0.5 * Math.sin(R.time * 5);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const c of ev.conflicts) {
          const on = hov === c.n;
          if (c.kind === 'seg' && R.segPx && R.segPx.get(c.ref)) {
            ctx.strokeStyle = 'rgba(214,48,49,' + (on ? 0.55 : 0.28 + 0.12 * pulse) + ')';
            ctx.lineWidth = R.lineWidthPx() + (on ? 12 : 8);
            R.strokeArr(ctx, R.segPx.get(c.ref));
          }
          if (c.kind === 'station' && net.stations[c.ref]) {
            const s = net.stations[c.ref], q = R.P(s.x, s.y, 0);
            ctx.strokeStyle = 'rgba(214,48,49,0.85)'; ctx.lineWidth = on ? 4 : 2.5;
            ctx.beginPath(); ctx.arc(q.x, q.y, 11 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
          }
        }
        for (const c of ev.conflicts) {
          const q = R.P(c.x, c.y, 0), on = hov === c.n;
          const s = on ? 1.25 : 1, r = 10 * s;
          const tipY = q.y, cy = tipY - 16 * s;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
          ctx.fillStyle = '#e03131';
          ctx.beginPath(); ctx.moveTo(q.x, tipY); ctx.lineTo(q.x - r * 0.62, cy + r * 0.5); ctx.arc(q.x, cy, r, Math.PI * 0.82, Math.PI * 0.18, false); ctx.closePath(); ctx.fill();
          ctx.restore();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, cy, r, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(11 * s) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(c.n), q.x, cy + 0.5);
          ctx.fillStyle = 'rgba(224,49,49,' + (0.25 + 0.25 * pulse) + ')'; ctx.beginPath(); ctx.ellipse(q.x, tipY, 6 + pulse * 4, 3 + pulse * 2, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  };
})(window.CM);
