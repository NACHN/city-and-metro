'use strict';
// 地铁网络：数据结构、编辑操作、几何、线路形态、合法性检查与费用计算、编译为运营结构
(function (CM) {
  const U = CM.U, CFG = CM.CFG, D = CM.DATA, LU = CM.LU;
  const M = {};
  const STEP = 0.12;

  M.empty = function () { return { stations: {}, segments: {}, lines: {}, nextId: 1 }; };
  M.clone = function (n) { return JSON.parse(JSON.stringify(n)); };
  M.newId = function (net, p) { return p + (net.nextId++); };
  M.idNum = function (id) { return parseInt(id.slice(1), 10); };
  M.sortIds = function (ids) { return ids.sort(function (a, b) { return M.idNum(a) - M.idNum(b); }); };
  M.typeH = function (type) { return CFG.metro.height[type] || 0; };

  // ---------------- 几何 ----------------
  const geomCache = new Map();
  // 玩家可编辑的控制点：起点站、转弯点、终点站
  M.userControl = function (net, seg) {
    const A = net.stations[seg.a], B = net.stations[seg.b];
    return [[A.x, A.y]].concat(seg.pts || [], [[B.x, B.y]]);
  };
  // 段落在车站一侧的相邻控制点
  M.adjCtrl = function (net, seg, sid) {
    const pts = seg.pts || [];
    if (seg.a === sid) return pts.length ? pts[0] : [net.stations[seg.b].x, net.stations[seg.b].y];
    return pts.length ? pts[pts.length - 1] : [net.stations[seg.a].x, net.stations[seg.a].y];
  };
  // 同一线路在车站处的连续方向：取本段方向与“最顺直”的另一段方向的角平分线，使线路平顺穿过车站
  M.stationTangent = function (net, seg, sid) {
    const S = net.stations[sid];
    const own = M.adjCtrl(net, seg, sid);
    let dx = own[0] - S.x, dy = own[1] - S.y;
    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    let best = null, bestDot = 2;
    for (const id in net.segments) {
      const o = net.segments[id];
      if (o === seg || o.line !== seg.line || (o.a !== sid && o.b !== sid)) continue;
      const p = M.adjCtrl(net, o, sid);
      let ox = p[0] - S.x, oy = p[1] - S.y;
      const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
      const dot = dx * ox + dy * oy;
      if (dot < bestDot) { bestDot = dot; best = [ox, oy]; }
    }
    if (!best) return [dx, dy];
    let tx = dx - best[0], ty = dy - best[1];
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) return [dx, dy];
    return [tx / tl, ty / tl];
  };
  // 几何控制点：在两端车站加入站台直线段，并与相邻区段保持切线连续
  M.segControl = function (net, seg) {
    const user = M.userControl(net, seg);
    let len = 0; for (let i = 0; i + 1 < user.length; i++) len += U.dist(user[i][0], user[i][1], user[i + 1][0], user[i + 1][1]);
    const Lp = Math.min(CFG.metro.platformHalfM / CFG.CELL_M, len / 4);
    if (Lp < 0.02) return user;
    const A = user[0], B = user[user.length - 1];
    const tA = M.stationTangent(net, seg, seg.a), tB = M.stationTangent(net, seg, seg.b);
    const ctrl = [A, [A[0] + tA[0] * Lp, A[1] + tA[1] * Lp]].concat(seg.pts || [], [[B[0] + tB[0] * Lp, B[1] + tB[1] * Lp], B]);
    ctrl.plat = true;
    return ctrl;
  };
  // 轨道曲线：分段三次 Hermite，切线取相邻弦方向的角平分线、长度按弦长缩放（间距不均也不会打结）；
  // 有站台时首末两段为直线，且站台端点切线与站台方向一致（线路平顺地进出车站）
  function trackCurve(ctrl, plat, step) {
    const n = ctrl.length;
    if (n < 2) return ctrl.map(function (p) { return [p[0], p[1]]; });
    const unit = function (x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    const dir = function (i) { return unit(ctrl[i + 1][0] - ctrl[i][0], ctrl[i + 1][1] - ctrl[i][1]); };
    const T = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) T.push(dir(0));
      else if (i === n - 1) T.push(dir(n - 2));
      else if (plat && i === 1) T.push(dir(0));
      else if (plat && i === n - 2) T.push(dir(n - 2));
      else { const a = dir(i - 1), b = dir(i); const t = unit(a[0] + b[0], a[1] + b[1]); T.push(t); }
    }
    const out = [];
    for (let i = 0; i + 1 < n; i++) {
      const p1 = ctrl[i], p2 = ctrl[i + 1];
      const L = U.dist(p1[0], p1[1], p2[0], p2[1]);
      const k = Math.max(1, Math.ceil(L / step));
      const straight = n === 2 || (plat && (i === 0 || i === n - 2));
      const m0x = T[i][0] * L, m0y = T[i][1] * L, m1x = T[i + 1][0] * L, m1y = T[i + 1][1] * L;
      for (let j = 0; j < k; j++) {
        const t = j / k;
        if (j === 0) { out.push([p1[0], p1[1]]); continue; }
        if (straight) { out.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]); continue; }
        const t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        out.push([h00 * p1[0] + h10 * m0x + h01 * p2[0] + h11 * m1x, h00 * p1[1] + h10 * m0y + h01 * p2[1] + h11 * m1y]);
      }
    }
    out.push([ctrl[n - 1][0], ctrl[n - 1][1]]);
    return out;
  }
  M.trackCurve = trackCurve;
  M.geomFromControl = function (ctrl, type, city) {
    // 缓存键含城市实例（地图）与地形阶段（填海），同坐标不同地图或不同年代地形不会互相复用
    const key = type + '|' + (city.uid || 0) + ':' + city.version + ':' + (city.terrainVer || 0) + '|' + (ctrl.plat ? 'p|' : '') + ctrl.map(function (p) { return p[0].toFixed(3) + ',' + p[1].toFixed(3); }).join(';');
    const hit = geomCache.get(key);
    if (hit) return hit;
    const pts = trackCurve(ctrl, !!ctrl.plat, STEP);
    const spanStart = [0];
    for (let i = 0; i + 1 < ctrl.length; i++) {
      const k = Math.max(1, Math.ceil(U.dist(ctrl[i][0], ctrl[i][1], ctrl[i + 1][0], ctrl[i + 1][1]) / STEP));
      spanStart.push(spanStart[i] + k);
    }
    const cum = U.cumLen(pts);
    const n = pts.length, lenC = cum[n - 1];
    let waterC = 0, hillC = 0, protC = 0, airC = 0, outside = false;
    const protNames = new Set(), locked = [], cellLen = new Map();
    let hillHit = null, protHit = null, waterHit = null, airHit = null;
    const airOk = !!(D.airport && D.airport.buildable);   // 运营中的机场可以地下穿越（台北松山）
    for (let i = 0; i + 1 < n; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2, ds = cum[i + 1] - cum[i];
      const c = city.cellAt(mx, my);
      if (c < 0) { outside = true; continue; }
      if (city.waterDistAt(mx, my) < 0) { waterC += ds; if (!waterHit) waterHit = [mx, my]; }
      const rg = city.regions[city.region[c]];
      if (rg.scenic) { hillC += ds; if (!hillHit) hillHit = [mx, my, rg.name]; }
      else if (!city.regionOpen[city.region[c]]) {
        if (!locked.some(function (l) { return l.name === rg.name; })) locked.push({ x: mx, y: my, name: rg.name, open: rg.open, lockNote: rg.lockNote });
      } else if (city.lu[c] === LU.AIRPORT) {
        if (airOk) { airC += ds; if (!airHit) airHit = [mx, my]; }
        else if (!locked.some(function (l) { return l.open === D.airport.closeYear; })) locked.push({ x: mx, y: my, name: (D.airport.name || '机场') + '（运营中）', open: D.airport.closeYear });
      }
      if (city.protectedId[c] > 0 && D.landmarks[city.protectedId[c] - 1].kind !== 'campus') { protC += ds; protNames.add(D.landmarks[city.protectedId[c] - 1].name); if (!protHit) protHit = [mx, my]; }
      cellLen.set(c, (cellLen.get(c) || 0) + ds);
    }
    // 曲线半径：用相隔约 60 m 的三点外接圆估计，减少采样噪声
    let minR = Infinity, minRi = -1;
    const kk = Math.max(1, Math.round(0.24 / STEP));
    for (let i = kk; i + kk < n; i++) {
      const p0 = pts[i - kk], p1 = pts[i], p2 = pts[i + kk];
      const a = U.dist(p0[0], p0[1], p1[0], p1[1]), b = U.dist(p1[0], p1[1], p2[0], p2[1]), c = U.dist(p0[0], p0[1], p2[0], p2[1]);
      const area2 = Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]));
      if (area2 < 1e-9 || a < 1e-6 || b < 1e-6) continue;
      const R = a * b * c / (2 * area2);
      if (R < minR) { minR = R; minRi = i; }
    }
    // 与运营中铁路的交叉（v1.9）：地面铁路 surf、高架铁路 via（同一走廊的多股轨道计为一处）
    const rx = city.railCross ? city.railCross(pts) : { surf: [], via: [] };
    const g = {
      pts: pts, cum: cum, lenC: lenC, lenM: lenC * CFG.CELL_M, waterM: waterC * CFG.CELL_M, hillM: hillC * CFG.CELL_M, protM: protC * CFG.CELL_M,
      protNames: Array.from(protNames), locked: locked, outside: outside, cellLen: cellLen, minRadiusM: minR * CFG.CELL_M,
      minRxy: minRi >= 0 ? pts[minRi] : null, minRi: minRi,
      spanStart: spanStart, hillHit: hillHit, protHit: protHit, waterHit: waterHit,
      airM: airC * CFG.CELL_M, airHit: airHit, railSurf: rx.surf, railVia: rx.via, railS: rx.surf.length, railV: rx.via.length,
    };
    if (geomCache.size > 3000) geomCache.clear();
    geomCache.set(key, g);
    return g;
  };
  M.clearCaches = function () { geomCache.clear(); };
  M.segGeom = function (net, seg, city) { return M.geomFromControl(M.segControl(net, seg), seg.type, city); };

  // 区间两端坡道长度（米）：按轨面高程差与最大坡度计算
  M.rampNeed = function (tA, tS, tB) {
    const lv = CFG.metro.levelM, gmax = CFG.metro.maxGrade;
    return { a: Math.abs(lv[tA] - lv[tS]) / gmax, b: Math.abs(lv[tB] - lv[tS]) / gmax };
  };
  // 段落高度剖面（视觉高度；车站一侧按坡度过渡到车站类型高度）
  M.heightProfile = function (g, tA, tS, tB) {
    const n = g.pts.length, L = g.lenC, out = new Float32Array(n);
    const hA = M.typeH(tA), hS = M.typeH(tS), hB = M.typeH(tB);
    const need = M.rampNeed(tA, tS, tB);
    const plat = CFG.metro.platformHalfM / CFG.CELL_M;
    const ra = Math.min(need.a / CFG.CELL_M, Math.max(0.1, L / 2 - plat)), rb = Math.min(need.b / CFG.CELL_M, Math.max(0.1, L / 2 - plat));
    for (let i = 0; i < n; i++) {
      const d = g.cum[i];
      let h = hS;
      if (hA !== hS && d < plat + ra) h = d <= plat ? hA : U.lerp(hA, hS, U.smooth((d - plat) / ra));
      else if (hB !== hS && L - d < plat + rb) h = L - d <= plat ? hB : U.lerp(hB, hS, U.smooth((L - d - plat) / rb));
      out[i] = h;
    }
    return out;
  };

  // ---------------- 线路形态 ----------------
  M.lineSegs = function (net, lineId) {
    const out = [];
    for (const id in net.segments) if (net.segments[id].line === lineId) out.push(net.segments[id]);
    return out;
  };
  M.lineTopo = function (net, lineId) {
    const segs = M.lineSegs(net, lineId);
    if (!segs.length) return { topo: 'empty', routes: [], stations: [] };
    const adj = new Map();
    const addAdj = function (s, seg, o) { if (!adj.has(s)) adj.set(s, []); adj.get(s).push({ seg: seg, other: o }); };
    for (const sg of segs) { addAdj(sg.a, sg, sg.b); addAdj(sg.b, sg, sg.a); }
    const nodes = Array.from(adj.keys());
    const seen = new Set([nodes[0]]), q = [nodes[0]];
    while (q.length) { const s = q.pop(); for (const e of adj.get(s)) if (!seen.has(e.other)) { seen.add(e.other); q.push(e.other); } }
    if (seen.size < nodes.length) return { topo: 'invalid', reason: '线路不连通', routes: [], stations: nodes, adj: adj };
    const E = segs.length, Vn = nodes.length;
    let maxDeg = 0; const leaves = [];
    for (const s of nodes) { const d = adj.get(s).length; if (d > maxDeg) maxDeg = d; if (d === 1) leaves.push(s); }
    M.sortIds(leaves);
    const line = net.lines[lineId];
    const orient = function (seg, from) { return { id: seg.id, rev: seg.a !== from }; };
    if (E === Vn - 1) {
      // 树：普通线路或支线
      let root = (line && line.root && leaves.indexOf(line.root) >= 0) ? line.root : null;
      const bfs = function (src) {
        const par = new Map([[src, null]]), dist = new Map([[src, 0]]), qq = [src];
        let far = src;
        while (qq.length) {
          const s = qq.shift();
          for (const e of adj.get(s)) if (!par.has(e.other)) { par.set(e.other, { s: s, seg: e.seg }); dist.set(e.other, dist.get(s) + 1); qq.push(e.other); if (dist.get(e.other) > dist.get(far)) far = e.other; }
        }
        return { par: par, far: far };
      };
      if (!root) root = maxDeg <= 2 ? leaves[0] : bfs(leaves[0]).far;
      const tr = bfs(root);
      const routes = [];
      for (const lf of leaves) {
        if (lf === root) continue;
        const st = [], sg = [];
        let cur = lf;
        while (cur !== root) { const p = tr.par.get(cur); st.push(cur); sg.push(orient(p.seg, p.s)); cur = p.s; }
        st.push(root);
        st.reverse(); sg.reverse();
        routes.push({ st: st, segs: sg, loop: false });
      }
      return { topo: maxDeg <= 2 ? 'path' : 'branch', routes: routes, stations: nodes, adj: adj, root: root, leaves: leaves };
    }
    if (E === Vn && maxDeg === 2) {
      let start = (line && line.root && adj.has(line.root)) ? line.root : M.sortIds(nodes.slice())[0];
      const st = [start], sg = [];
      let prev = null, cur = start, prevSeg = null;
      for (let k = 0; k < E; k++) {
        const opts = adj.get(cur);
        let e = opts[0];
        if (prevSeg && e.seg === prevSeg) e = opts[1];
        else if (!prevSeg && opts.length > 1 && M.idNum(opts[1].other) < M.idNum(opts[0].other)) e = opts[1];
        sg.push(orient(e.seg, cur));
        prev = cur; cur = e.other; prevSeg = e.seg;
        if (cur !== start) st.push(cur);
      }
      return { topo: 'loop', routes: [{ st: st, segs: sg, loop: true }], stations: nodes, adj: adj, root: start };
    }
    return { topo: 'invalid', reason: E === Vn ? '环线上不能再接支线（可另建新线路）' : '线路含多个闭环', routes: [], stations: nodes, adj: adj };
  };
  M.TOPO_NAME = { path: '普通线路', loop: '环线', branch: '支线', empty: '无轨道', invalid: '形态无效' };

  // 拆除后线路不连通时自动拆分
  M.normalizeLines = function (net) {
    const notes = [];
    for (const lid of Object.keys(net.lines)) {
      const segs = M.lineSegs(net, lid);
      if (!segs.length) { if (!net.lines[lid].keep) delete net.lines[lid]; continue; }
      const adj = new Map();
      for (const s of segs) { (adj.get(s.a) || adj.set(s.a, []).get(s.a)).push(s); (adj.get(s.b) || adj.set(s.b, []).get(s.b)).push(s); }
      const comp = new Map(); let nc = 0;
      for (const st of adj.keys()) {
        if (comp.has(st)) continue;
        const q = [st]; comp.set(st, nc);
        while (q.length) { const s = q.pop(); for (const sg of adj.get(s)) { const o = sg.a === s ? sg.b : sg.a; if (!comp.has(o)) { comp.set(o, nc); q.push(o); } } }
        nc++;
      }
      if (nc <= 1) continue;
      const sizes = new Array(nc).fill(0);
      for (const s of segs) sizes[comp.get(s.a)]++;
      let keep = 0; for (let k = 1; k < nc; k++) if (sizes[k] > sizes[keep]) keep = k;
      for (let k = 0; k < nc; k++) {
        if (k === keep) continue;
        const nl = M.newLine(net, net.lines[lid].name + '（拆分）');
        for (const s of segs) if (comp.get(s.a) === k) s.line = nl;
        notes.push(net.lines[lid].name + ' 被拆分，部分区段成为 ' + net.lines[nl].name);
      }
    }
    return notes;
  };

  // ---------------- 编辑操作 ----------------
  M.newLine = function (net, name) {
    const used = new Set(Object.values(net.lines).map(function (l) { return l.num; }));
    let num = 1; while (used.has(num)) num++;
    const id = M.newId(net, 'l');
    const cols = D.lineColorsNice;
    net.lines[id] = { id: id, num: num, name: name || (num + ' 号线'), color: cols[(num - 1) % cols.length], root: null };
    return id;
  };
  M.addStation = function (net, x, y, opts, city) {
    const id = M.newId(net, 's');
    net.stations[id] = { id: id, name: M.suggestName(net, x, y, city), x: x, y: y, size: opts.size || 'M', type: opts.type || 'underground' };
    return id;
  };
  M.findSeg = function (net, lineId, a, b) {
    for (const id in net.segments) {
      const s = net.segments[id];
      if (s.line === lineId && ((s.a === a && s.b === b) || (s.a === b && s.b === a))) return s;
    }
    return null;
  };
  M.addSegment = function (net, lineId, a, b, bends, type) {
    if (!net.stations[a] || !net.stations[b]) return { error: '绘线起点或终点车站已不存在，请重新选择起点' };
    if (a === b) return { error: '起点与终点为同一车站' };
    if (M.findSeg(net, lineId, a, b)) return { error: '该线路已连接这两座车站' };
    const id = M.newId(net, 'g');
    net.segments[id] = { id: id, line: lineId, a: a, b: b, pts: (bends || []).map(function (p) { return [p[0], p[1]]; }), type: type || 'underground', base: null };
    const line = net.lines[lineId];
    if (line && !line.root) line.root = a;
    return { id: id };
  };
  // 在既有轨道上插入车站（拆分段落）
  M.splitSegment = function (net, segId, x, y, opts, city) {
    const seg = net.segments[segId];
    const ctrl = M.segControl(net, seg);
    const g = M.geomFromControl(ctrl, seg.type, city);
    const d = U.distToPoly(x, y, g.pts);
    const si = U._i, st = U._t;
    const px = g.pts[si][0] + (g.pts[si + 1][0] - g.pts[si][0]) * st, py = g.pts[si][1] + (g.pts[si + 1][1] - g.pts[si][1]) * st;
    let span = 0;
    for (let k = 0; k + 1 < g.spanStart.length; k++) if (si >= g.spanStart[k]) span = k;
    const bends = seg.pts || [];
    // 几何控制点含两端站台点时，跨度编号需减去起点站台段
    const offset = ctrl.length === bends.length + 4 ? 1 : 0;
    const nb = U.clamp(span - offset, 0, bends.length);
    const before = bends.slice(0, nb), after = bends.slice(nb);
    const sid = M.addStation(net, px, py, opts, city);
    const base = seg.base ? seg.base.slice() : [seg.id];
    delete net.segments[segId];
    const g1 = M.newId(net, 'g'), g2 = M.newId(net, 'g');
    net.segments[g1] = { id: g1, line: seg.line, a: seg.a, b: sid, pts: before, type: seg.type, base: base };
    net.segments[g2] = { id: g2, line: seg.line, a: sid, b: seg.b, pts: after, type: seg.type, base: base };
    return { station: sid, dist: d };
  };
  M.removeSegment = function (net, segId) { delete net.segments[segId]; return M.normalizeLines(net); };
  M.removeStation = function (net, sid) {
    const st = net.stations[sid], notes = [];
    const byLine = new Map();
    const ctrlLen = function (pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += U.dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); return L; };
    for (const id in net.segments) {
      const s = net.segments[id];
      if (s.a === sid || s.b === sid) { if (!byLine.has(s.line)) byLine.set(s.line, []); byLine.get(s.line).push(s); }
    }
    for (const entry of byLine) {
      const lid = entry[0], segs = entry[1];
      if (segs.length === 2) {
        const s1 = segs[0], s2 = segs[1];
        const o1 = s1.a === sid ? s1.b : s1.a, o2 = s2.a === sid ? s2.b : s2.a;
        // s1: o1 → sid ；s2: sid → o2
        const p1 = s1.a === sid ? (s1.pts || []).slice().reverse() : (s1.pts || []).slice();
        const p2 = s2.a === sid ? (s2.pts || []).slice() : (s2.pts || []).slice().reverse();
        const base = [];
        for (const s of [s1, s2]) { if (s.base) base.push.apply(base, s.base); else base.push(s.id); }
        delete net.segments[s1.id]; delete net.segments[s2.id];
        if (o1 !== o2 && !M.findSeg(net, lid, o1, o2)) {
          const id = M.newId(net, 'g');
          // 两侧建设方式不同时（如一侧地下、一侧高架），合并后的轨道沿用较长一侧的方式；另一侧在草案中按改建计费
          let type = s1.type;
          if (s1.type !== s2.type) {
            const A = net.stations[o1], B = net.stations[o2];
            const l1 = ctrlLen([[A.x, A.y]].concat(p1, [[st.x, st.y]])), l2 = ctrlLen([[st.x, st.y]].concat(p2, [[B.x, B.y]]));
            type = l1 >= l2 ? s1.type : s2.type;
            const other = type === s1.type ? s2.type : s1.type;
            const ln = net.lines[lid];
            notes.push((ln ? ln.name + ' ' : '') + A.name + '—' + B.name + ' 两侧建设方式不同，合并后统一为' + CFG.metro.typeName[type] + '，原' + CFG.metro.typeName[other] + '部分按改建计费');
          }
          net.segments[id] = { id: id, line: lid, a: o1, b: o2, pts: p1.concat([[st.x, st.y]], p2), type: type, base: Array.from(new Set(base)) };
        }
      } else {
        for (const s of segs) delete net.segments[s.id];
      }
      const line = net.lines[lid];
      if (line && line.root === sid) line.root = null;
    }
    delete net.stations[sid];
    return notes.concat(M.normalizeLines(net) || []);
  };
  // 拆除预览：按实际拆除规则在副本上执行，比较前后网络（直连保留、断开环线、取消支线、失去换乘或服务）
  M.demolishImpact = function (net, target) {
    const after = M.clone(net);
    const notes = target.kind === 'station' ? M.removeStation(after, target.id) : M.removeSegment(after, target.id);
    const removed = [], added = [], lines = [], lost = [], lostXfer = [];
    for (const id in net.segments) if (!after.segments[id]) removed.push(id);
    for (const id in after.segments) if (!net.segments[id]) added.push(id);
    const nm = function (n, sid) { return n.stations[sid] ? n.stations[sid].name : ''; };
    if (target.kind === 'station') {
      const n0 = M.stationLines(net, target.id).length;
      if (n0 >= 2) lines.push('换乘站「' + nm(net, target.id) + '」将消失');
    }
    for (const id of added) { const s = after.segments[id], L = after.lines[s.line]; lines.push((L ? L.name : '') + ' 轨道直连 ' + nm(after, s.a) + '—' + nm(after, s.b) + '（保留运营）'); }
    for (const lid in net.lines) {
      const t0 = M.lineTopo(net, lid), L = net.lines[lid];
      if (t0.topo === 'empty') continue;
      if (!after.lines[lid] || !M.lineSegs(after, lid).length) { lines.push(L.name + ' 将被整条拆除'); continue; }
      const t1 = M.lineTopo(after, lid);
      if (t0.topo === 'loop' && t1.topo !== 'loop') lines.push(L.name + ' 环线断开，变为普通线路');
      else if (t0.topo === 'branch' && t1.topo === 'path') lines.push(L.name + ' 的支线将取消');
    }
    for (const t of notes || []) lines.push(t);
    for (const sid in after.stations) {
      const a = M.stationLines(net, sid).length, b = M.stationLines(after, sid).length;
      if (a >= 1 && b === 0) { lost.push(sid); lines.push('「' + nm(after, sid) + '」将失去线路服务（车站保留）'); }
      else if (a >= 2 && b < 2) { lostXfer.push(sid); lines.push('「' + nm(after, sid) + '」不再是换乘站'); }
    }
    return { after: after, removed: removed, added: added, lost: lost, lostXfer: lostXfer, lines: lines };
  };
  // 网络完整性：区段两端车站与所属线路必须存在（异常编辑据此回滚）
  M.validate = function (net) {
    for (const id in net.segments) {
      const s = net.segments[id];
      if (!net.stations[s.a] || !net.stations[s.b]) return '轨道 ' + id + ' 的端点车站不存在';
      if (!net.lines[s.line]) return '轨道 ' + id + ' 所属线路不存在';
    }
    return null;
  };
  M.stationLines = function (net, sid) {
    const set = new Set();
    for (const id in net.segments) { const s = net.segments[id]; if (s.a === sid || s.b === sid) set.add(s.line); }
    return Array.from(set);
  };

  // 车站命名
  M.suggestName = function (net, x, y, city) {
    const used = new Set(Object.values(net.stations).map(function (s) { return s.name; }));
    const cands = D.places.map(function (p) { return { n: p[0], d: U.dist(x, y, p[1], p[2]), x: p[1], y: p[2] }; }).sort(function (a, b) { return a.d - b.d; });
    for (const c of cands) { if (c.d > 3.2) break; if (!used.has(c.n)) return c.n; }
    const c0 = cands[0];
    if (c0 && c0.d < 7) {
      const dx = x - c0.x, dy = y - c0.y;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '东' : '西') : (dy > 0 ? '南' : '北');
      const nm = c0.n + dir;
      if (!used.has(nm)) return nm;
    }
    const rg = city.regionAt(x, y);
    const base = rg ? rg.name.replace(/（.*）/, '') : '新区';
    for (let k = 1; k < 99; k++) { const nm = base + k + '站'; if (!used.has(nm)) return nm; }
    return '新站';
  };

  // ---------------- 选址检查 ----------------
  M.checkSite = function (city, x, y, type) {
    const c = city.cellAt(x, y);
    if (c < 0) return { ok: false, msg: '超出地图范围', how: '把车站移回地图内。' };
    if (city.waterDistAt(x, y) < 0.05) return { ok: false, msg: '车站不能建在水面上（' + city.riverNameAt(x, y) + '）', how: '把车站移到岸边；跨江请用两岸的车站之间的轨道（地下为隧道、高架为桥梁）。' };
    const rg = city.regions[city.region[c]];
    if (rg.scenic) return { ok: false, msg: rg.name + '：山地风景区不能设站', how: '把车站移出风景区，轨道可以地下穿越。' };
    if (!city.regionOpen[city.region[c]]) return { ok: false, msg: rg.name + ' 尚未开放（' + U.regionLock(rg) + '）', how: rg.open == null ? '该区域不开放建设，请把车站移到其他区域。' : '区域开放前不能建设。可推进时间等待开放，或把车站移到已开放区域。' };
    if (city.lu[c] === LU.AIRPORT) {
      if (!D.airport.buildable) return { ok: false, msg: (D.airport.name || '机场') + '仍在运营（' + D.airport.closeYear + ' 年关闭）', how: '机场关闭前不能建设，请把车站移到机场范围以外。' };
      if (type !== 'underground') return { ok: false, msg: (D.airport.name || '机场') + '照常运营：范围内只能建地下车站', how: '把车站改为地下站（建设方式选「地下」），或移到机场范围以外。' };
    }
    // 地面铁路（v1.9）：地面车站不能压在运营中的铁路上；地下与高架车站可以
    if (type === 'surface' && city.railDist && city.railDist(x, y) < 0.3) return { ok: false, msg: '地面车站不能建在铁路上', how: '把车站移离铁路约 80 m 以上，或改为地下 / 高架车站。' };
    if (city.protectedId[c] > 0 && D.landmarks[city.protectedId[c] - 1].kind !== 'campus' && city.inLandmarkSite(city.protectedId[c] - 1, x, y)) return { ok: false, msg: '受保护建筑「' + D.landmarks[city.protectedId[c] - 1].name + '」，不能设站或拆除', how: '把车站移到相邻街区，保护建筑周边仍可通过车站出入口服务。' };
    return { ok: true };
  };

  // ---------------- 编译（供模拟与渲染） ----------------
  function legTime(Lm, vmax, a) {
    const dAcc = vmax * vmax / a;
    if (Lm >= dAcc) return Lm / vmax + vmax / a;
    return 2 * Math.sqrt(Math.max(1, Lm) / a);
  }
  M.legTime = legTime;
  M.compile = function (net, city) {
    const C = { net: net, stations: [], sIndex: new Map(), segs: new Map(), lines: [], routes: [], topo: new Map() };
    const ids = M.sortIds(Object.keys(net.stations));
    ids.forEach(function (id, k) { C.sIndex.set(id, k); C.stations.push(net.stations[id]); });
    for (const id in net.segments) {
      const s = net.segments[id];
      const A = net.stations[s.a], B = net.stations[s.b];
      if (!A || !B) continue;   // 防御：不完整的区段不参与运营
      const g = M.segGeom(net, s, city);
      C.segs.set(id, { seg: s, g: g, h: M.heightProfile(g, A.type, s.type, B.type) });
    }
    const mc = CFG.metro;
    for (const lid of M.sortIds(Object.keys(net.lines))) {
      const line = net.lines[lid];
      const tp = M.lineTopo(net, lid);
      C.topo.set(lid, tp);
      C.lines.push(line);
      if (tp.topo === 'invalid' || tp.topo === 'empty') continue;
      if (tp.routes.some(function (rt) { return rt.segs.some(function (ref) { return !C.segs.has(ref.id); }); })) continue;
      tp.routes.forEach(function (rt, ri) {
        const pts = [], hs = [], stopDist = [0], legLenM = [], legSec = [], legSeg = [];
        let minCars = 8, length = 0;
        for (let k = 0; k < rt.segs.length; k++) {
          const ref = rt.segs[k], cs = C.segs.get(ref.id);
          let p = cs.g.pts, h = cs.h;
          if (ref.rev) { p = p.slice().reverse(); h = Array.from(h).reverse(); }
          for (let i = (pts.length ? 1 : 0); i < p.length; i++) {
            if (pts.length) { const prev = pts[pts.length - 1]; length += U.dist(prev[0], prev[1], p[i][0], p[i][1]); }
            pts.push(p[i]); hs.push(h[i]);
          }
          stopDist.push(length);
          const Lm = cs.g.lenM;
          let vmax = mc.vmax[cs.seg.type];
          if (isFinite(cs.g.minRadiusM)) vmax = Math.min(vmax, Math.max(8, Math.sqrt(mc.latAccel * cs.g.minRadiusM)));
          legLenM.push(Lm); legSec.push(legTime(Lm, vmax, mc.accel)); legSeg.push(ref);
        }
        const stIdx = rt.st.map(function (s) { return C.sIndex.get(s); });
        for (const s of rt.st) minCars = Math.min(minCars, mc.carsBySize[net.stations[s].size]);
        const cum = U.cumLen(pts);
        const nStops = rt.st.length;
        let runSec = 0; for (const t of legSec) runSec += t;
        const cycleSec = rt.loop ? runSec + mc.dwell * nStops : 2 * runSec + 2 * mc.dwell * Math.max(0, nStops - 2) + 2 * mc.turnaround;
        let label = line.name;
        if (tp.topo === 'branch') label = line.name + '（往' + net.stations[rt.st[rt.st.length - 1]].name + '）';
        C.routes.push({
          id: C.routes.length, lineId: lid, line: line, color: line.color, label: label, loop: rt.loop, branch: tp.topo === 'branch',
          stIds: rt.st, stIdx: stIdx, segRefs: legSeg, pts: pts, hs: hs, cum: cum, stopDist: stopDist, legLenM: legLenM, legSec: legSec,
          cars: minCars, cap: minCars * mc.carCap, runSec: runSec, cycleSec: cycleSec, lenM: cum[cum.length - 1] * CFG.CELL_M,
        });
      });
    }
    // 车站服务线路
    C.stationRoutes = C.stations.map(function () { return []; });
    C.stationLines = C.stations.map(function () { return new Set(); });
    for (const r of C.routes) for (const si of r.stIdx) { C.stationRoutes[si].push(r.id); C.stationLines[si].add(r.lineId); }
    C.serviced = C.stations.map(function (s, i) { return C.stationRoutes[i].length > 0; });
    return C;
  };

  // ---------------- 草案差异、费用与冲突 ----------------
  function costIndex(year) { return U.priceIndex(year, CFG.cost.inflation, CFG.econBase || 1990); }
  M.costIndex = costIndex;
  M.stationCost = function (type, size, year) { return CFG.cost.station[type][size] * costIndex(year); };
  M.devFactor = function (city, c) {
    if (c < 0) return 0;
    const L = city.lu[c];
    if (L === LU.WATER || L === LU.PARK || L === LU.HILL) return 0;
    if (!city.street[c]) return 0.06;
    return U.clamp((city.pop[c] + city.jobs[c]) / 2500, 0.15, 1.6) * (1 - city.taken[c]);
  };
  M.trackCost = function (g, type, year) {
    const ci = costIndex(year), C = CFG.cost;
    let v = g.lenM / 1000 * C.trackPerKm[type] + g.waterM / 1000 * C.riverPerKm[type];
    if (type === 'underground') v += g.hillM / 1000 * C.hillPerKm + g.protM / 1000 * C.protectedPerKm;
    v += M.railCrossCost(g, type);
    return v * ci;
  };
  // 跨越铁路的附加费用（基年价格）：地下线下穿地面铁路、高架线上跨地面或高架铁路，每处按等效长度计
  M.railCrossN = function (g, type) { return type === 'underground' ? (g.railS || 0) : (type === 'elevated' ? (g.railS || 0) + (g.railV || 0) : 0); };
  M.railCrossCost = function (g, type) {
    const k = CFG.cost.railCrossKm || { underground: 0.25, elevated: 0.35 };
    return M.railCrossN(g, type) * (k[type] || 0) * CFG.cost.trackPerKm[type];
  };
  M.trackDemolition = function (city, g, type, year, scale) {
    const f = CFG.cost.demolishFactor.track[type];
    if (!f) return { cost: 0, cells: [] };
    let cost = 0; const cells = [];
    g.cellLen.forEach(function (len, c) {
      const fr = Math.min(0.6, len * 0.16) * f * (scale === undefined ? 1 : scale);
      const df = M.devFactor(city, c);
      if (df <= 0 || fr <= 0) return;
      cost += city.clearPerCell(c) * df * fr;
      cells.push({ c: c, frac: fr * 0.6 });
    });
    return { cost: cost * costIndex(year), cells: cells };
  };

  M.evaluate = function (draft, off, city, year) {
    const res = { items: [], total: 0, byKind: { construction: 0, demolition: 0, upgrade: 0, relocation: 0 }, conflicts: [], warnings: [], demolitions: [], changes: { add: [], mod: [], del: [] }, affectedLines: new Set(), notes: [] };
    const C = CFG.cost, ci = costIndex(year);
    const item = function (kind, label, amount, ref) {
      if (amount <= 0.5) return;
      res.items.push({ kind: kind, label: label, amount: amount, ref: ref });
      res.total += amount; res.byKind[kind] += amount;
    };
    // 冲突：类型、位置、涉及对象、原因说明、解决办法与一键修复
    const conflict = function (o) { res.conflicts.push(o); };
    const warn = function (msg, x, y, ref, kind) { res.warnings.push({ msg: msg, x: x, y: y, ref: ref, kind: kind || 'seg' }); };
    const touched = new Set();      // 本次新建或改动的轨道
    const touchedSt = new Set();    // 本次新建或移动的车站

    // 车站
    res.siteReset = [];   // 确认后需记录新“付费选址”的车站（新建、改建、搬迁）
    res.paidLen = {};     // 确认后各轨道的“已付费长度”（米）：免费的小幅调整按它累计，累计超出免费额度即按延长收费
    for (const id in draft.stations) {
      const s = draft.stations[id], o = off.stations[id];
      const c = city.cellAt(s.x, s.y);
      let newSite = false;       // 需要按新站计费（拆迁等）
      let relocated = false;     // 位置或建设方式有变化：始终检查选址与站距（与是否收费无关）
      if (!o) {
        res.changes.add.push('新建车站「' + s.name + '」（' + CFG.metro.sizeName[s.size] + '·' + CFG.metro.typeName[s.type] + '）');
        item('construction', '新建车站 ' + s.name, M.stationCost(s.type, s.size, year), id);
        newSite = true;
      } else {
        const moved = U.dist(s.x, s.y, o.x, o.y) * CFG.CELL_M;
        // 免费微调按“上次付费选址”累计计算，避免多次小幅移动绕过搬迁费用
        const site = o.site ? { x: o.site[0], y: o.site[1] } : o;
        const fromSite = U.dist(s.x, s.y, site.x, site.y) * CFG.CELL_M;
        relocated = moved > 0.5 || s.type !== o.type;
        if (s.type !== o.type) {
          res.changes.mod.push('车站「' + s.name + '」改建为' + CFG.metro.typeName[s.type]);
          item('construction', '改建车站 ' + s.name + '（' + CFG.metro.typeName[s.type] + '）', M.stationCost(s.type, s.size, year), id);
          newSite = true;
        } else if (moved > 0.5 && fromSite > C.freeMoveM) {
          res.changes.mod.push('车站「' + s.name + '」搬迁 ' + Math.round(fromSite) + ' m' + (Math.abs(fromSite - moved) > 5 ? '（自原选址累计）' : ''));
          item('relocation', '搬迁车站 ' + s.name + '（' + Math.round(fromSite) + ' m）', M.stationCost(s.type, s.size, year) * C.relocationFactor, id);
          newSite = true;
        } else if (moved > 1) {
          res.changes.mod.push('车站「' + s.name + '」微调位置 ' + Math.round(moved) + ' m（免费' + (Math.abs(fromSite - moved) > 5 ? '，距原选址 ' + Math.round(fromSite) + ' m' : '') + '）');
        }
        const ord = { S: 0, M: 1, L: 2 };
        if (ord[s.size] > ord[o.size] && s.type === o.type) {
          res.changes.mod.push('车站「' + s.name + '」升级为' + CFG.metro.sizeName[s.size]);
          item('upgrade', '升级车站 ' + s.name + '（' + CFG.metro.sizeName[o.size] + '→' + CFG.metro.sizeName[s.size] + '）', (M.stationCost(s.type, s.size, year) - M.stationCost(s.type, o.size, year)) * C.upgradeFactor, id);
        } else if (ord[s.size] < ord[o.size]) {
          res.changes.mod.push('车站「' + s.name + '」缩减为' + CFG.metro.sizeName[s.size] + '（不退款）');
        }
        if (s.name !== o.name) res.changes.mod.push('车站更名：' + o.name + ' → ' + s.name);
      }
      if (!o || U.dist(s.x, s.y, o.x, o.y) > 1e-6 || s.type !== o.type) touchedSt.add(id);
      if (newSite) {
        res.siteReset.push(id);
        const df = M.devFactor(city, c);
        const fr = CFG.cost.demolishFactor.station[s.type] * 0.35;
        if (df > 0 && fr > 0) {
          item('demolition', '车站拆迁 ' + s.name, city.clearPerCell(c) * df * fr * ci, id);
          res.demolitions.push({ c: c, frac: fr * 0.7 });
        }
      }
      if (newSite || relocated) {
        const chk = M.checkSite(city, s.x, s.y, s.type);
        if (!chk.ok) {
          const fixes = [{ label: '移动车站', op: 'editStation', station: id }, { label: o ? '撤回移动' : '删除车站', op: o ? 'restoreStation' : 'removeStation', station: id }];
          conflict({ type: 'site', kind: 'station', ref: id, x: s.x, y: s.y, msg: '车站「' + s.name + '」：' + chk.msg, how: chk.how || '用「修改」工具把车站拖到允许建设的位置，或删除该车站。', fixes: fixes });
        }
        for (const id2 in draft.stations) {
          if (id2 === id) continue;
          const s2 = draft.stations[id2];
          const dm = U.dist(s.x, s.y, s2.x, s2.y) * CFG.CELL_M;
          if (dm < CFG.metro.minSpacingM) {
            conflict({ type: 'spacing', kind: 'station', ref: id, ref2: id2, x: (s.x + s2.x) / 2, y: (s.y + s2.y) / 2, msg: '车站「' + s.name + '」与「' + s2.name + '」相距仅 ' + Math.round(dm) + ' m（最小 ' + CFG.metro.minSpacingM + ' m）', how: '两站太近，乘客步行即可到达。删除其中一站，或把车站移开到 ' + CFG.metro.minSpacingM + ' m 以外。若想形成换乘，请直接点击已有车站连线。', fixes: o ? [{ label: '撤回移动', op: 'restoreStation', station: id }, { label: '移动车站', op: 'editStation', station: id }] : [{ label: '删除「' + s.name + '」', op: 'removeStation', station: id }, { label: '移动车站', op: 'editStation', station: id }] });
            break;
          }
        }
      }
      // 步行接入
      if (c >= 0) {
        const i = c % city.W, j = (c / city.W) | 0, VW = city.VW;
        const vs = [j * VW + i, j * VW + i + 1, (j + 1) * VW + i, (j + 1) * VW + i + 1];
        let ok = false; for (const v of vs) if (city.walk.deg[v] > 0) ok = true;
        if (!ok) warn('车站「' + s.name + '」周边暂无步行道路，覆盖与客流受限（城市发展后会改善）', s.x, s.y, id, 'station');
      }
    }
    for (const id in off.stations) if (!draft.stations[id]) res.changes.del.push('拆除车站「' + off.stations[id].name + '」');

    // 轨道
    const offGeom = {};
    for (const id in off.segments) offGeom[id] = M.segGeom(off, off.segments[id], city);
    const groups = new Map();
    const usedBase = new Set();
    for (const id in draft.segments) {
      const s = draft.segments[id];
      const g = M.segGeom(draft, s, city);
      const line = draft.lines[s.line];
      const lname = line ? line.name : '';
      const A = draft.stations[s.a], B = draft.stations[s.b];
      const lbl = lname + ' ' + A.name + '—' + B.name;
      const o = off.segments[id];
      let base = null;
      if (o) base = [id]; else if (s.base) base = s.base.filter(function (b) { return off.segments[b]; });
      if (base && base.length) for (const b of base) usedBase.add(b);
      let full = false;
      if (!base || !base.length) { full = true; res.changes.add.push('新建轨道 ' + lbl + '（' + U.fmtKm(g.lenM) + '，' + CFG.metro.typeName[s.type] + '）'); res.affectedLines.add(s.line); }
      else {
        // 原轨道可能不止一段（拆除中间站后合并），逐段比较建设方式：全部不同按新建计费；部分不同则对不同的那部分按改建计费
        const diffT = base.filter(function (b) { return off.segments[b].type !== s.type; });
        if (diffT.length === base.length) { full = true; res.changes.mod.push('轨道 ' + lbl + ' 改为' + CFG.metro.typeName[s.type] + '（按新建计费）'); res.affectedLines.add(s.line); }
        else {
          const key = base.slice().sort().join('+');
          if (!groups.has(key)) groups.set(key, { base: base, segs: [], lbl: lbl, type: s.type, changed: false });
          const gr = groups.get(key);
          gr.segs.push({ s: s, g: g });
          const stMoved = function (sid) { const a = draft.stations[sid], b = off.stations[sid]; return !b || a.x !== b.x || a.y !== b.y; };
          const changed = !o || o.a !== s.a || o.b !== s.b || o.line !== s.line || JSON.stringify(o.pts) !== JSON.stringify(s.pts) || stMoved(s.a) || stMoved(s.b);
          if (changed) { res.affectedLines.add(s.line); touched.add(id); gr.changed = true; }
          if (diffT.length) {
            const pg = { lenM: 0, waterM: 0, hillM: 0, protM: 0, railS: 0, railV: 0 }, from = new Set();
            for (const b of diffT) { const og = offGeom[b]; pg.lenM += og.lenM; pg.waterM += og.waterM; pg.hillM += og.hillM; pg.protM += og.protM; pg.railS += og.railS || 0; pg.railV += og.railV || 0; from.add(CFG.metro.typeName[off.segments[b].type]); }
            res.changes.mod.push('轨道 ' + lbl + ' 中原为' + Array.from(from).join('、') + '的 ' + U.fmtKm(pg.lenM) + ' 改为' + CFG.metro.typeName[s.type] + '（按新建计费）');
            item('construction', '改建轨道 ' + lbl + '（' + U.fmtKm(pg.lenM) + ' 改为' + CFG.metro.typeName[s.type] + '）', M.trackCost(pg, s.type, year), id);
            const dm = M.trackDemolition(city, g, s.type, year, U.clamp(pg.lenM / Math.max(1, g.lenM), 0, 1));
            item('demolition', '沿线拆迁 ' + lbl, dm.cost, id);
            res.demolitions.push.apply(res.demolitions, dm.cells);
            res.affectedLines.add(s.line); touched.add(id); gr.changed = true; gr.retyped = true;
          }
        }
      }
      if (full) { touched.add(id); res.paidLen[id] = g.lenM; }
      if (full) {
        const rn = M.railCrossN(g, s.type);
        item('construction', (base && base.length ? '改建轨道 ' : '新建轨道 ') + lbl + '（' + U.fmtKm(g.lenM) + (g.waterM > 1 ? '，' + (s.type === 'underground' ? '越江隧道 ' : '跨江桥梁 ') + U.fmtKm(g.waterM) : '') + (rn ? '，' + (s.type === 'underground' ? '下穿' : '上跨') + '铁路 ' + rn + ' 处' : '') + '）', M.trackCost(g, s.type, year), id);
        const dm = M.trackDemolition(city, g, s.type, year);
        item('demolition', '沿线拆迁 ' + lbl, dm.cost, id);
        res.demolitions.push.apply(res.demolitions, dm.cells);
      }
      // 冲突
      const toUnder = { label: '改为地下（隧道）', op: 'segType', seg: id, value: 'underground' };
      const editSeg = { label: '调整线形', op: 'editSeg', seg: id };
      if (g.outside) conflict({ type: 'outside', kind: 'seg', ref: id, x: A.x, y: A.y, msg: lbl + '：超出地图范围', how: '把转弯点或车站移回地图内。', fixes: [editSeg] });
      if (g.hillM > 1 && s.type !== 'underground') conflict({ type: 'hill', kind: 'seg', ref: id, x: g.hillHit[0], y: g.hillHit[1], msg: lbl + '：穿过' + g.hillHit[2] + '，风景区禁止地面/高架轨道', how: '风景区内只能以隧道穿越。把这段轨道改为地下即可（会增加山体隧道费用），或调整线形绕开。', fixes: [toUnder, editSeg] });
      if (g.protM > 1 && s.type !== 'underground') conflict({ type: 'protected', kind: 'seg', ref: id, x: g.protHit[0], y: g.protHit[1], msg: lbl + '：地面/高架轨道将穿过受保护建筑「' + g.protNames.join('、') + '」', how: '历史建筑和重要地标不能拆除。改为地下从下方穿越（需加固费用），或调整线形绕开。', fixes: [toUnder, editSeg] });
      for (const lk of g.locked) conflict({ type: 'locked', kind: 'seg', ref: id, x: lk.x, y: lk.y, msg: lbl + '：经过尚未开放的区域「' + lk.name + '」', how: lk.open == null ? '该区域' + U.regionLock(lk) + '，线路不能穿过。用「修改」工具拖动控制点绕开。' : '该区域' + U.regionLock(lk) + '，开放前不能建设。用「修改」工具拖动控制点绕开，或等区域开放后再建。', fixes: [editSeg, { label: '删除该区段', op: 'removeSeg', seg: id }] });
      // 运营中的机场（台北松山）：跑道与航站区只能地下穿越
      if (g.airM > 1 && s.type !== 'underground') conflict({ type: 'airport', kind: 'seg', ref: id, x: g.airHit[0], y: g.airHit[1], msg: lbl + '：' + (D.airport.name || '机场') + '照常运营，范围内不能建地面或高架轨道', how: '机场范围内只能以隧道穿越。把这段轨道改为地下，或调整线形绕开机场。', fixes: [toUnder, editSeg] });
      // 地面铁路（v1.9）：新建或改动的地面轨道不能与运营中的地面铁路平交；既有的交叉保留
      if (touched.has(id) && s.type === 'surface' && g.railS > 0) {
        const p = g.railSurf[0];
        conflict({ type: 'rail', kind: 'seg', ref: id, x: p[0], y: p[1], msg: lbl + '：地面轨道与铁路平面交叉（' + g.railS + ' 处）', how: '地铁不能与铁路平交。把这段轨道改为高架（上跨铁路）或地下（下穿铁路），每处交叉会增加相应的跨越费用；也可以调整线形，在铁路的高架段下方通过。', fixes: [{ label: '改为高架', op: 'segType', seg: id, value: 'elevated' }, toUnder, editSeg] });
      }
      if (touched.has(id) && isFinite(g.minRadiusM)) {
        const R = Math.round(g.minRadiusM), p = g.minRxy || [A.x, A.y];
        if (R < CFG.metro.minRadiusM) {
          const fixes = [editSeg];
          const pts = s.pts || [];
          let nearK = -1, nd = 0.8;
          for (let k = 0; k < pts.length; k++) { const d = U.dist(pts[k][0], pts[k][1], p[0], p[1]); if (d < nd) { nd = d; nearK = k; } }
          if (nearK >= 0) fixes.unshift({ label: '删除此处转弯点', op: 'removeBend', seg: id, k: nearK });
          conflict({ type: 'radius', kind: 'seg', ref: id, x: p[0], y: p[1], msg: lbl + '：转弯半径约 ' + R + ' m，小于最小半径 ' + CFG.metro.minRadiusM + ' m', how: '弯道太急，列车无法安全通过。在弯道两侧增加转弯点（绘线时 Shift+点击）让曲线更平缓，或移动车站拉开距离。车站两侧约 ' + CFG.metro.platformHalfM + ' m 必须是直线站台。', fixes: fixes });
        } else if (R < CFG.metro.warnRadiusM) warn(lbl + '：转弯半径约 ' + R + ' m，列车需限速通过', p[0], p[1], id);
      }
      // 坡道：地下、地面、高架之间转换需要足够长度
      if (touched.has(id) || touchedSt.has(s.a) || touchedSt.has(s.b)) {
        const need = M.rampNeed(A.type, s.type, B.type);
        const avail = g.lenM - 2 * CFG.metro.platformHalfM;
        const req = need.a + need.b;
        if (req > 1 && req > avail) {
          const mid = U.posAt(g.pts, g.cum, g.lenC / 2, {});
          const fixes = [];
          if (A.type === B.type && s.type !== A.type) fixes.push({ label: '改为' + CFG.metro.typeName[A.type], op: 'segType', seg: id, value: A.type });
          fixes.push({ label: '把「' + B.name + '」改为' + CFG.metro.typeName[s.type] + '站', op: 'stationType', station: s.b, value: s.type });
          fixes.push({ label: '移动车站', op: 'editStation', station: s.b });
          conflict({ type: 'ramp', kind: 'seg', ref: id, x: mid.x, y: mid.y, msg: lbl + '：' + CFG.metro.typeName[A.type] + '/' + CFG.metro.typeName[s.type] + '/' + CFG.metro.typeName[B.type] + '转换坡道不足（需约 ' + Math.round(req) + ' m，可用 ' + Math.max(0, Math.round(avail)) + ' m）', how: '轨道最大坡度为 ' + Math.round(CFG.metro.maxGrade * 100) + '%，地下与高架之间高差约 ' + (CFG.metro.levelM.elevated - CFG.metro.levelM.underground) + ' m，需要较长坡道。让区间与两端车站采用相同的建设方式，或拉长两站距离。', fixes: fixes });
        }
      }
    }
    // 车站前后转角（站台为直线，线路不能在车站处急转）
    const segsBySt = new Map();
    for (const id in draft.segments) { const s = draft.segments[id]; for (const e of [s.a, s.b]) { if (!segsBySt.has(e)) segsBySt.set(e, []); segsBySt.get(e).push(s); } }
    segsBySt.forEach(function (list, sid) {
      const byLine = new Map();
      for (const s of list) { if (!byLine.has(s.line)) byLine.set(s.line, []); byLine.get(s.line).push(s); }
      byLine.forEach(function (ls, lid) {
        if (ls.length < 2) return;
        if (!touchedSt.has(sid) && !ls.some(function (s) { return touched.has(s.id); })) return;
        const S = draft.stations[sid];
        const dirs = ls.map(function (s) { const p = M.adjCtrl(draft, s, sid); const dx = p[0] - S.x, dy = p[1] - S.y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; });
        let worst = 0;
        for (let i = 0; i < ls.length; i++) {
          let best = 180;
          for (let j = 0; j < ls.length; j++) {
            if (i === j) continue;
            const dot = U.clamp(dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1], -1, 1);
            best = Math.min(best, 180 - Math.acos(dot) * 180 / Math.PI);
          }
          worst = Math.max(worst, best);
        }
        if (worst > CFG.metro.maxTurnAtStationDeg) {
          const ln = draft.lines[lid];
          conflict({ type: 'turn', kind: 'station', ref: sid, x: S.x, y: S.y, msg: (ln ? ln.name : '') + ' 在车站「' + S.name + '」前后转向约 ' + Math.round(worst) + '°（最大 ' + CFG.metro.maxTurnAtStationDeg + '°）', how: '站台是一段直线，列车不能在车站处急转。把车站移到转弯之前或之后，或在车站两侧增加转弯点，让线路先直行进出车站再转弯。', fixes: [{ label: '移动车站', op: 'editStation', station: sid }].concat(ls.filter(function (s) { return (s.pts || []).length; }).slice(0, 1).map(function (s) { return { label: '调整线形', op: 'editSeg', seg: s.id }; })) });
        }
      });
    });
    // 地面线路平交
    const surf = [];
    for (const id in draft.segments) if (draft.segments[id].type === 'surface') surf.push(draft.segments[id]);
    for (let a = 0; a < surf.length; a++) for (let b = a + 1; b < surf.length; b++) {
      const s1 = surf[a], s2 = surf[b];
      if (!touched.has(s1.id) && !touched.has(s2.id)) continue;
      const g1 = M.segGeom(draft, s1, city), g2 = M.segGeom(draft, s2, city);
      const hit = polyCross(g1.pts, g2.pts, 0.3);
      if (!hit) continue;
      conflict({ type: 'level', kind: 'seg', ref: touched.has(s1.id) ? s1.id : s2.id, x: hit[0], y: hit[1], msg: '两条地面轨道平面交叉（' + (draft.lines[s1.line] ? draft.lines[s1.line].name : '') + ' 与 ' + (draft.lines[s2.line] ? draft.lines[s2.line].name : '') + '）', how: '地铁不能平面交叉。把其中一段改为高架或地下形成立体交叉，或在交叉处设换乘站。', fixes: [{ label: '改为高架', op: 'segType', seg: touched.has(s1.id) ? s1.id : s2.id, value: 'elevated' }, { label: '改为地下', op: 'segType', seg: touched.has(s1.id) ? s1.id : s2.id, value: 'underground' }] });
    }
    // 线形调整：与“已付费长度”比较（旧存档没有记录时按已建长度），免费的小幅调整会累计，
    // 多次小改累计超过免费额度时按累计增加的长度收费（与车站“自上次付费选址累计”的规则一致）
    groups.forEach(function (gr) {
      let baseLen = 0, basePaid = 0, baseWater = 0, baseHill = 0, baseProt = 0, dLen = 0, dWater = 0, dHill = 0, dProt = 0, baseRS = 0, baseRV = 0, dRS = 0, dRV = 0;
      for (const b of gr.base) { const g = offGeom[b], pl = off.segments[b].paidLen; baseLen += g.lenM; basePaid += pl != null ? pl : g.lenM; baseWater += g.waterM; baseHill += g.hillM; baseProt += g.protM; baseRS += g.railS || 0; baseRV += g.railV || 0; }
      for (const x of gr.segs) { dLen += x.g.lenM; dWater += x.g.waterM; dHill += x.g.hillM; dProt += x.g.protM; dRS += x.g.railS || 0; dRV += x.g.railV || 0; }
      const step = dLen - baseLen, extra = dLen - basePaid;   // 本次变化；自上次付费以来的累计变化
      const shaped = gr.changed || gr.segs.length !== gr.base.length;
      let charged = false;
      if (shaped || Math.abs(step) > 1) {
        if (extra > C.freeLengthM && step > 1) {
          charged = true;
          const pseudo = { lenM: extra, waterM: Math.max(0, dWater - baseWater), hillM: Math.max(0, dHill - baseHill), protM: Math.max(0, dProt - baseProt), railS: Math.max(0, dRS - baseRS), railV: Math.max(0, dRV - baseRV) };
          const acc = Math.abs(extra - step) > 1 ? '（含此前免费调整累计 ' + U.fmtKm(extra - step) + '）' : '';
          res.changes.mod.push('调整线形 ' + gr.lbl + '：增加 ' + U.fmtKm(extra) + acc);
          item('construction', '延长/调整轨道 ' + gr.lbl + '（+' + U.fmtKm(extra) + acc + '）', M.trackCost(pseudo, gr.type, year), gr.segs[0].s.id);
          for (const x of gr.segs) {
            const dm = M.trackDemolition(city, x.g, gr.type, year, U.clamp(extra / Math.max(1, dLen), 0, 1));
            item('demolition', '沿线拆迁 ' + gr.lbl, dm.cost, x.s.id);
            res.demolitions.push.apply(res.demolitions, dm.cells);
          }
        } else if (Math.abs(step) > 1) {
          res.changes.mod.push('调整线形 ' + gr.lbl + '（' + (step >= 0 ? '+' : '') + Math.round(step) + ' m' + (Math.abs(extra - step) > 1 ? '，自上次付费累计 ' + (extra >= 0 ? '+' : '') + Math.round(extra) + ' m' : '') + '，累计不超过 ' + C.freeLengthM + ' m 免费）');
        } else if (gr.changed && !gr.retyped) {
          res.changes.mod.push('调整线形 ' + gr.lbl + '（长度基本不变，免费）');
        }
      }
      // 免费的线形调整若新增了跨越铁路的位置，跨越费用照常收取
      if (!charged && (dRS > baseRS || dRV > baseRV)) {
        const pc = { railS: Math.max(0, dRS - baseRS), railV: Math.max(0, dRV - baseRV) }, n = M.railCrossN(pc, gr.type);
        if (n > 0) item('construction', '新增跨越铁路 ' + gr.lbl + '（' + n + ' 处）', M.railCrossCost(pc, gr.type) * ci, gr.segs[0].s.id);
      }
      for (const x of gr.segs) res.paidLen[x.s.id] = charged ? x.g.lenM : basePaid * x.g.lenM / Math.max(1, dLen);
    });
    for (const id in off.segments) {
      if (draft.segments[id] || usedBase.has(id)) continue;
      const s = off.segments[id];
      res.changes.del.push('拆除轨道 ' + (off.lines[s.line] ? off.lines[s.line].name : '') + ' ' + off.stations[s.a].name + '—' + off.stations[s.b].name);
      res.affectedLines.add(s.line);
    }
    // 与改动区段相接的既有区段：切线连续会改变其线形，同样检查半径
    for (const id in draft.segments) {
      if (touched.has(id)) continue;
      const s = draft.segments[id];
      const near = touchedSt.has(s.a) || touchedSt.has(s.b) || (segsBySt.get(s.a) || []).concat(segsBySt.get(s.b) || []).some(function (o) { return o.line === s.line && touched.has(o.id); });
      if (!near) continue;
      const g = M.segGeom(draft, s, city);
      if (isFinite(g.minRadiusM) && g.minRadiusM < CFG.metro.minRadiusM) {
        const p = g.minRxy || [draft.stations[s.a].x, draft.stations[s.a].y];
        const lbl = (draft.lines[s.line] ? draft.lines[s.line].name : '') + ' ' + draft.stations[s.a].name + '—' + draft.stations[s.b].name;
        conflict({ type: 'radius', kind: 'seg', ref: id, x: p[0], y: p[1], msg: lbl + '：受相邻改动影响，转弯半径降至约 ' + Math.round(g.minRadiusM) + ' m（最小 ' + CFG.metro.minRadiusM + ' m）', how: '线路在车站处需保持顺直，新接入的区段改变了这段轨道进出车站的方向。调整新区段的方向（增加转弯点），使其与既有线路走向更一致。', fixes: [{ label: '调整线形', op: 'editSeg', seg: id }] });
      }
    }
    // 线路形态
    for (const lid in draft.lines) {
      const tp = M.lineTopo(draft, lid);
      const line = draft.lines[lid];
      if (tp.topo === 'invalid') {
        const adj = tp.adj;
        let pick = tp.stations[0];
        if (adj) adj.forEach(function (list, sid) { if (list.length >= 3) pick = sid; });
        const s0 = draft.stations[pick];
        const isLoopBranch = tp.reason.indexOf('环线') >= 0;
        const disc = tp.reason.indexOf('不连通') >= 0;
        conflict({
          type: 'topology', kind: 'line', ref: lid, x: s0 ? s0.x : 0, y: s0 ? s0.y : 0, msg: line.name + '：' + tp.reason,
          how: disc ? '这条线路的轨道分成了互不相连的几部分。把它们连接起来，或拆分为不同的线路。' : (isLoopBranch ? '环线上的列车绕圈运行，无法再分出支线。把支线部分拆为一条新线路（可在车站换乘）。' : '一条线路只能是普通线路、一个环线或带支线的树形。删除多余的区段，或把部分区段拆为新线路。'),
          fixes: disc ? [{ label: '拆分为不同线路', op: 'normalize' }] : (isLoopBranch ? [{ label: '把支线拆为新线路', op: 'splitBranch', line: lid }] : []),
        });
      }
      const ol = off.lines[lid];
      if (!ol) res.changes.add.push('新线路 ' + line.name);
      else if (ol.name !== line.name || ol.color !== line.color) res.changes.mod.push('线路信息修改：' + line.name);
    }
    for (const lid in off.lines) if (!draft.lines[lid]) res.changes.del.push('线路 ' + off.lines[lid].name + ' 已无轨道，将移除');
    // 孤立车站
    const deg = {};
    for (const id in draft.segments) { const s = draft.segments[id]; deg[s.a] = 1; deg[s.b] = 1; }
    for (const id in draft.stations) if (!deg[id]) warn('车站「' + draft.stations[id].name + '」尚未接入线路，不提供服务', draft.stations[id].x, draft.stations[id].y, id);
    res.changed = res.changes.add.length + res.changes.mod.length + res.changes.del.length > 0;
    res.conflicts.forEach(function (c, i) { c.n = i + 1; });
    return res;
  };

  // 两条折线的交点（排除两端 ex 范围内的接触）
  function polyCross(p, q, ex) {
    const bb = function (a) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const t of a) { if (t[0] < x0) x0 = t[0]; if (t[0] > x1) x1 = t[0]; if (t[1] < y0) y0 = t[1]; if (t[1] > y1) y1 = t[1]; } return [x0, y0, x1, y1]; };
    const A = bb(p), B = bb(q);
    if (A[2] < B[0] || B[2] < A[0] || A[3] < B[1] || B[3] < A[1]) return null;
    const ends = [p[0], p[p.length - 1], q[0], q[q.length - 1]];
    for (let i = 0; i + 1 < p.length; i++) {
      for (let j = 0; j + 1 < q.length; j++) {
        const a = p[i], b = p[i + 1], c = q[j], d = q[j + 1];
        if (!U.segIntersect(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) continue;
        const d1x = b[0] - a[0], d1y = b[1] - a[1], d2x = d[0] - c[0], d2y = d[1] - c[1];
        const den = d1x * d2y - d1y * d2x;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c[0] - a[0]) * d2y - (c[1] - a[1]) * d2x) / den;
        const x = a[0] + d1x * t, y = a[1] + d1y * t;
        if (ends.some(function (e) { return U.dist(e[0], e[1], x, y) < ex; })) continue;
        return [x, y];
      }
    }
    return null;
  }

  // 环线带支线：保留环，把其余区段拆为新线路
  M.splitBranch = function (net, lid) {
    const segs = M.lineSegs(net, lid);
    const deg = new Map();
    for (const s of segs) { deg.set(s.a, (deg.get(s.a) || 0) + 1); deg.set(s.b, (deg.get(s.b) || 0) + 1); }
    const alive = new Set(segs.map(function (s) { return s.id; }));
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of segs) {
        if (!alive.has(s.id)) continue;
        if (deg.get(s.a) === 1 || deg.get(s.b) === 1) { alive.delete(s.id); deg.set(s.a, deg.get(s.a) - 1); deg.set(s.b, deg.get(s.b) - 1); changed = true; }
      }
    }
    const rest = segs.filter(function (s) { return !alive.has(s.id); });
    if (!rest.length) return { error: '没有可拆出的支线' };
    const nl = M.newLine(net, net.lines[lid].name + '支线');
    for (const s of rest) s.line = nl;
    const notes = M.normalizeLines(net);
    return { line: nl, notes: notes };
  };
  // 执行一键修复（在草案中）
  M.applyFix = function (net, fix) {
    switch (fix.op) {
      case 'segType': if (net.segments[fix.seg]) net.segments[fix.seg].type = fix.value; return {};
      case 'stationType': if (net.stations[fix.station]) net.stations[fix.station].type = fix.value; return {};
      case 'removeStation': return { notes: M.removeStation(net, fix.station) };
      case 'removeSeg': return { notes: M.removeSegment(net, fix.seg) };
      case 'removeBend': { const s = net.segments[fix.seg]; if (s && s.pts && s.pts[fix.k]) s.pts.splice(fix.k, 1); return {}; }
      case 'splitBranch': return M.splitBranch(net, fix.line);
      case 'normalize': return { notes: M.normalizeLines(net) };
      default: return { error: '无法自动处理' };
    }
  };

  CM.Metro = M;
})(window.CM);
