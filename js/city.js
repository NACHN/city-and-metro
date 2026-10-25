'use strict';
// 城市：地形、区域、土地利用、人口与就业、道路网络（格网顶点 + 边）及城市发展
(function (CM) {
  const U = CM.U, CFG = CM.CFG, D = CM.DATA;
  const LU = { RURAL: 0, RES: 1, COM: 2, IND: 3, MIX: 4, PARK: 5, INST: 6, WATER: 7, HILL: 8, AIRPORT: 9, LANDMARK: 10 };
  CM.LU = LU;
  CM.LU_NAME = ['农村/待开发', '住宅', '商业办公', '工业仓储', '混合功能', '公园绿地', '学校与机构', '水域', '山地风景区', '机场', '历史地标'];
  const PLAN_KEYS = { RES: LU.RES, COM: LU.COM, IND: LU.IND, MIX: LU.MIX, INST: LU.INST };
  const CELL_KM2 = 0.0625;

  let CITY_SEQ = 0;
  function City() {
    this.uid = ++CITY_SEQ;   // 城市实例编号：几何等缓存按实例区分（不同地图、不同进度不会互相复用）
    this.terrainVer = 0;     // 地形阶段（填海后递增）
    this.W = CFG.W; this.H = CFG.H; this.N = this.W * this.H;
    this.VW = this.W + 1; this.VH = this.H + 1; this.V = this.VW * this.VH;
    this.version = 0; this.roadVersion = 0;
    this.dirty = new Set();
  }
  CM.City = City;

  City.prototype.idx = function (i, j) { return j * this.W + i; };
  City.prototype.cellAt = function (x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return -1;
    return j * this.W + i;
  };
  City.prototype.zoneOf = function (c) {
    const Z = CFG.ZONE;
    const i = c % this.W, j = (c / this.W) | 0;
    return ((j / Z) | 0) * (this.W / Z) + ((i / Z) | 0);
  };

  // ---------------- 生成 ----------------
  const FS = 4;   // 水域、绿地栅格：每格 4×4 子像素（约 62 m）
  const BS = 8;   // 建筑避让栅格：每格 8×8 子像素（约 31 m）
  City.prototype.generate = function (seed, startYear) {
    const W = this.W, H = this.H, N = this.N;
    this.seed = seed;
    this.regions = D.regions.concat([D.defaultRegion]);
    this.regionOpen = new Uint8Array(this.regions.length);
    this.regionOpenDate = this.regions.map(function () { return null; });
    for (let k = 0; k < this.regions.length; k++) {
      const rg = this.regions[k];
      if (rg.open != null && rg.open <= startYear) { this.regionOpen[k] = 1; this.regionOpenDate[k] = [startYear, 1]; }
    }
    this.lu = new Uint8Array(N);
    this.plan = new Uint8Array(N);
    this.pop = new Float32Array(N);
    this.jobs = new Float32Array(N);
    this.bh = new Float32Array(N);
    this.street = new Uint8Array(N);
    this.protectedId = new Int16Array(N);
    this.taken = new Float32Array(N);
    this.urbanYear = new Uint16Array(N);
    this.isPark = new Uint8Array(N);
    this.landmarkOn = new Uint8Array(D.landmarks.length);
    this.terrainYear = startYear;   // 历史海岸线：此年份之后才形成的填海土地仍按水域处理
    this.buildTerrain();

    // 规划用地
    const airportK = this.regions.findIndex(function (r) { return r.id === 'airport'; });
    for (let c = 0; c < N; c++) {
      if (this.waterD[c] < 0 && this.landFrac[c] < 0.5) { this.plan[c] = LU.WATER; this.lu[c] = LU.WATER; continue; }
      if (this.regions[this.region[c]].scenic) { this.plan[c] = LU.HILL; this.lu[c] = LU.HILL; continue; }
      this.plan[c] = this.planFor(c);
      this.lu[c] = LU.RURAL;
      // 公园，或整体保留为绿地的区域（如湿地公园）
      if (this.parkCov[c] >= 0.45 || this.regions[this.region[c]].park) { this.plan[c] = LU.PARK; this.lu[c] = LU.PARK; this.isPark[c] = 1; }
      else if (this.region[c] === airportK && startYear < D.airport.closeYear) this.lu[c] = LU.AIRPORT;
    }
    this.activateLandmarks(startYear);

    // 1990 年人口与就业（估算）
    let sumP = 0, sumJ = 0;
    for (let c = 0; c < N; c++) {
      const L = this.lu[c];
      if (L === LU.WATER || L === LU.HILL || L === LU.PARK || L === LU.AIRPORT) continue;
      const i = c % W, j = (c / W) | 0, cx = i + 0.5, cy = j + 0.5;
      let p = D.rural.pop, jb = D.rural.jobs;
      for (const ct of D.centers) {
        const d = U.dist(cx, cy, ct.x, ct.y) / (ct.r * 4);
        const w = Math.exp(-d * d);
        p += ct.pop * w; jb += ct.jobs * w;
      }
      p *= 0.7 + 0.6 * U.fbm(cx * 0.3, cy * 0.3, seed + 3);
      jb *= 0.65 + 0.7 * U.hash2(i, j, seed + 5);
      // 林地与未开放区域人口较少
      p *= 1 - 0.6 * this.wood[c]; jb *= 1 - 0.6 * this.wood[c];
      const urban = p + jb > 2600;
      if (urban && L !== LU.LANDMARK) {
        this.lu[c] = this.plan[c];
        const f = luSplit(this.lu[c]);
        p *= f[0]; jb *= f[1];
        this.street[c] = 1; this.urbanYear[c] = startYear;
      }
      if (L === LU.LANDMARK) { const lm = D.landmarks[this.protectedId[c] - 1]; if (lm && lm.kind === 'campus') { p *= 0.5; } else { p = 0; jb *= 0.3; } this.street[c] = 1; }
      const lf = this.landFrac[c];
      this.pop[c] = p * CELL_KM2 * lf; this.jobs[c] = jb * CELL_KM2 * lf;
      sumP += this.pop[c]; sumJ += this.jobs[c];
    }
    const tP = U.interp(CFG.growth.popCurve, startYear), tJ = tP * U.interp(CFG.growth.jobsRatio, startYear);
    for (let c = 0; c < N; c++) { this.pop[c] *= tP / sumP; this.jobs[c] *= tJ / sumJ; }
    for (let c = 0; c < N; c++) this.bh[c] = this.heightFor(c, startYear);

    // 道路格网顶点（规则方格；真实道路在其上近似通行，绘制使用真实线形）
    this.vx = new Float32Array(this.V); this.vy = new Float32Array(this.V);
    for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) { const v = j * this.VW + i; this.vx[v] = i; this.vy[v] = j; }

    // 道路格网
    const nH = (H + 1) * W, nV = H * (W + 1), nD = H * W;
    this.nE = [nH, nV, nD, nD];
    this.eOff = [0, nH, nH + nV, nH + nV + nD];
    const nTot = nH + nV + 2 * nD;
    this.eArt = new Uint8Array(nTot);   // 规划道路等级
    this.eName = new Uint16Array(nTot);
    this.eCls = new Uint8Array(nTot);   // 最终等级
    this.eBlock = new Uint8Array(nTot); // 跨水
    for (let e = 0; e < nTot; e++) {
      const uv = this.edgeVerts(e);
      const ax = uv[0] % this.VW, ay = (uv[0] / this.VW) | 0, bx = uv[1] % this.VW, by = (uv[1] / this.VW) | 0;
      let b = this.waterDistAt((ax + bx) / 2, (ay + by) / 2) < 0.08 ? 1 : 0;
      if (!b && this.crossesRiver(ax, ay, bx, by)) b = 1;
      this.eBlock[e] = b;
    }
    this.buildRoadGroups();
    this.applyRoads(startYear);
    this.updateStreets();
    this.buildGraphs();
    this.version++;
  };

  function luSplit(L) {
    switch (L) {
      case LU.RES: return [1.25, 0.35];
      case LU.COM: return [0.35, 1.6];
      case LU.IND: return [0.25, 1.35];
      case LU.INST: return [0.55, 0.9];
      default: return [1, 1];
    }
  }

  // 规划用地：按所在区域的用地配方随机选取，并用低频噪声让同类用地成片（确定性，填海后的新土地复用）
  City.prototype.planFor = function (c) {
    const W = this.W, i = c % W, j = (c / W) | 0, rg = this.regions[this.region[c]];
    const planName = rg.plan || 'res', dist = D.plans[planName] || D.plans.res;
    const r = U.hash2(i, j, this.seed + 7);
    let acc = 0, pick = LU.RES;
    for (const key in dist) { acc += dist[key]; if (r <= acc) { pick = PLAN_KEYS[key]; break; } }
    const nz = U.noise2((i + 0.5) * 0.22, (j + 0.5) * 0.22, this.seed + 11);
    if (planName !== 'cbd' && nz > 0.72 && dist.COM) pick = LU.COM;
    else if (nz < 0.18 && dist.IND) pick = LU.IND;
    return pick;
  };
  // 历史海岸线：D.reclaim 为后来形成的填海土地（多边形，格坐标）。year 大于当前地形年份的仍按水域处理
  City.prototype.reclaimFeats = function (pendingOnly) {
    const out = [], self = this;
    (D.reclaim || []).forEach(function (r, k) {
      if (pendingOnly && r.year <= self.terrainYear) return;
      if (!r._f) { const p = new Float32Array([].concat.apply([], r.poly)); r._f = { name: r.name, rings: [{ outer: true, p: p }], bbox: CM.Geo.bbox(p), k: k }; }
      out.push(r._f);
    });
    return out;
  };
  // 水域栅格（值为水体序号：面 1…，线 30001…，尚未填海的海域 60001…）、有符号距离场与每格陆地比例
  City.prototype.buildWater = function () {
    const Geo = CM.Geo, W = this.W, H = this.H, N = this.N, FW = this.FW, FH = this.FH;
    const wm = new Uint16Array(FW * FH);
    Geo.fill(wm, FW, FH, FS, Geo.water, function (f, i) { return i + 1; });
    Geo.waterLines.forEach(function (l, i) { Geo.stroke(wm, FW, FH, FS, l.p, Math.max(l.w / 2, 0.025), 30001 + i); });
    if (!this.landMax) { const cov0 = Geo.coverage(wm, FW, FS, W, H); this.landMax = new Float32Array(N); for (let c = 0; c < N; c++) this.landMax[c] = 1 - cov0[c]; }   // 现代陆地（含全部填海）
    const rf = this.reclaimFeats(true);
    if (rf.length) Geo.fill(wm, FW, FH, FS, rf, function (f) { return 60001 + f.k; });
    this.wmask = wm;
    this.wsdf = Geo.sdf(wm, FW, FH);
    const wcov = Geo.coverage(wm, FW, FS, W, H);
    this.landFrac = new Float32Array(N); this.waterD = new Float32Array(N);
    for (let c = 0; c < N; c++) { this.landFrac[c] = 1 - wcov[c]; this.waterD[c] = this.waterDistAt(c % W + 0.5, ((c / W) | 0) + 0.5); }
  };
  // 系统填海：到达年份的填海土地成陆。更新水域、陆地比例、建筑避让、道路跨水标记与新土地的用地；
  // keepLu 为读档恢复时使用（用地等已从存档恢复，只重建地形）。返回本次成陆的填海项
  City.prototype.applyReclaim = function (year, keepLu) {
    const list = (D.reclaim || []).filter((r) => r.year > this.terrainYear && r.year <= year);
    if (year > this.terrainYear) this.terrainYear = year;
    if (!list.length) return list;
    const N = this.N, W = this.W, FW = this.FW, BW = this.BW, BH = this.BH, Geo = CM.Geo, old = this.landFrac;
    this.buildWater();
    this.terrainVer++;
    const fresh = new Set();
    for (let c = 0; c < N; c++) {
      if (old[c] === this.landFrac[c]) continue;
      this.dirty.add(c);
      if (this.landFrac[c] < 0.5) continue;
      // 风景区内成陆的格与开局时一样作为山林保护（不能留作“陆地上的水域”）
      if (this.regions[this.region[c]].scenic) { if (this.lu[c] === LU.WATER) { this.plan[c] = LU.HILL; this.lu[c] = LU.HILL; fresh.add(c); } continue; }
      if (this.plan[c] === LU.WATER) this.plan[c] = this.planFor(c);
      // 读档时（keepLu）用地已恢复，通常不会再有“陆地上的水域用地”；若填海年份在新版数据中提前，这里同样补成陆地
      if (this.lu[c] === LU.WATER) { this.lu[c] = LU.RURAL; fresh.add(c); }
    }
    // 已落成地标场地内刚成陆的格同样受保护（不会变成普通农田再被开发）
    if (fresh.size) for (let k = 0; k < D.landmarks.length; k++) if (this.landmarkOn[k]) this.protectLandmark(k, fresh);
    // 建筑避让：已成陆处去掉水域标记，补上街道
    const wm = this.wmask, bm = this.bmask;
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) { const i = y * BW + x; if (bm[i] === 3 && !wm[((y >> 1) * FW) + (x >> 1)]) bm[i] = 0; }
    const free = function (v) { return v === 0; };
    for (const r of list) for (const k of Geo.query(Geo.streetBk, r._f.bbox[0], r._f.bbox[1], r._f.bbox[2], r._f.bbox[3])) Geo.stroke(bm, BW, BH, BS, Geo.streets[k].p, 0.035, 1, free);
    // 道路格网的跨水标记
    for (let e = 0; e < this.eBlock.length; e++) {
      const uv = this.edgeVerts(e), VW = this.VW;
      const ax = uv[0] % VW, ay = (uv[0] / VW) | 0, bx = uv[1] % VW, by = (uv[1] / VW) | 0;
      this.eBlock[e] = this.waterDistAt((ax + bx) / 2, (ay + by) / 2) < 0.08 || this.crossesRiver(ax, ay, bx, by) ? 1 : 0;
    }
    this.version++;
    return list;
  };

  // 真实地理：水域、绿地、林地、区域（确定性，不随存档保存）
  City.prototype.buildTerrain = function () {
    const Geo = CM.Geo.init(), W = this.W, H = this.H, N = this.N;
    const FW = W * FS, FH = H * FS;
    this.FS = FS; this.FW = FW; this.FH = FH;
    this.buildWater();
    const wm = this.wmask;    // 公园与林地覆盖率
    const pm = new Uint8Array(FW * FH);
    Geo.fill(pm, FW, FH, FS, Geo.parks);
    this.parkCov = Geo.coverage(pm, FW, FS, W, H);
    const wd = new Uint8Array(FW * FH);
    Geo.fill(wd, FW, FH, FS, Geo.woods);
    Geo.fill(wd, FW, FH, FS, Geo.reserves);
    this.wood = Geo.coverage(wd, FW, FS, W, H);
    // 区域：风景区（真实保护区/公园范围）→ 街道 → 所属区 → 外围
    const self = this, regions = this.regions, NONE = 255;
    const rr = new Uint8Array(N).fill(NONE);
    const fillCells = function (feats, k) {
      if (!feats.length) return;
      const tmp = new Uint8Array(N);
      Geo.fill(tmp, W, H, 1, feats);
      for (let c = 0; c < N; c++) if (tmp[c] && rr[c] === NONE) rr[c] = k;
    };
    const streetOf = new Map(), distOf = new Map();
    regions.forEach(function (rg, k) {
      if (rg.geo) {
        const list = rg.geo.reserve ? Geo.reserves.filter(function (f) { return f.name === rg.geo.reserve; }) : Geo.parks.filter(function (f) { return f.name === rg.geo.park; });
        fillCells(list, k);
      }
      // 山地风景区按林地覆盖率划定（如香港郊野公园的山体），woodMin 为最低林地覆盖率
      if (rg.woodMin) for (let c = 0; c < N; c++) if (rr[c] === NONE && self.wood[c] >= rg.woodMin && self.landMax[c] >= 0.5) rr[c] = k;
      // 显式多边形（格坐标），可为多个：[[x, y], …] 或 [[[x, y], …], …]
      if (rg.poly) {
        const polys = typeof rg.poly[0][0] === 'number' ? [rg.poly] : rg.poly;
        fillCells(polys.map(function (pl) { const p = new Float32Array([].concat.apply([], pl)); return { rings: [{ outer: true, p: p }], bbox: Geo.bbox(p) }; }), k);
      }
      for (const s of rg.streets || []) if (!streetOf.has(s)) streetOf.set(s, k);
      for (const s of rg.district || []) if (!distOf.has(s)) distOf.set(s, k);
    });
    for (const f of Geo.admin) if (f.level === 8 && streetOf.has(f.name)) fillCells([f], streetOf.get(f.name));
    for (const f of Geo.admin) if ((f.level === 6 || f.level === 7) && distOf.has(f.name)) fillCells([f], distOf.get(f.name));   // 区（东京特别区为 7 级）
    const def = regions.length - 1;
    this.region = new Uint8Array(N);
    for (let c = 0; c < N; c++) this.region[c] = rr[c] === NONE ? def : rr[c];
    // 区域中心（标注与定位用）与范围
    const sx = new Float64Array(regions.length), sy = new Float64Array(regions.length), sn = new Float64Array(regions.length);
    const bb = regions.map(function () { return [1e9, 1e9, -1e9, -1e9]; });
    const LM = this.landMax;   // 区域范围与标注按现代陆地（含之后的填海）计算
    for (let c = 0; c < N; c++) {
      if (LM[c] < 0.5) continue;
      const k = this.region[c], i = c % W, j = (c / W) | 0;
      sx[k] += i + 0.5; sy[k] += j + 0.5; sn[k]++;
      const b = bb[k]; if (i < b[0]) b[0] = i; if (j < b[1]) b[1] = j; if (i + 1 > b[2]) b[2] = i + 1; if (j + 1 > b[3]) b[3] = j + 1;
    }
    regions.forEach(function (rg, k) {
      // 标注点取离质心最近的本区域格，避免落在别的区域上
      let cx = sn[k] ? sx[k] / sn[k] : W / 2, cy = sn[k] ? sy[k] / sn[k] : H / 2;
      let best = 1e9, bx = cx, by = cy;
      for (let c = 0; c < N; c++) if (self.region[c] === k && LM[c] >= 0.5) { const d = U.dist(c % W + 0.5, ((c / W) | 0) + 0.5, cx, cy); if (d < best) { best = d; bx = c % W + 0.5; by = ((c / W) | 0) + 0.5; } }
      rg.cx = bx; rg.cy = by; rg.bbox = bb[k]; rg.cells = sn[k];
    });
    const ak = regions.findIndex(function (r) { return r.id === 'airport'; });
    this.airportBox = ak >= 0 && sn[ak] ? regions[ak].bbox : null;
    // 区名标注位置：所列街道的质心
    this.districtLabels = (D.districtLabels || []).map(function (dl) {
      const feats = Geo.admin.filter(function (f) { return dl[1].indexOf(f.name) >= 0; });
      if (!feats.length) return null;
      const tmp = new Uint8Array(N); Geo.fill(tmp, W, H, 1, feats);
      let x = 0, y = 0, n = 0;
      for (let c = 0; c < N; c++) if (tmp[c] && self.landFrac[c] >= 0.5) { x += c % W + 0.5; y += ((c / W) | 0) + 0.5; n++; }
      return n ? [dl[0], x / n, y / n] : null;
    }).filter(Boolean);
    // 建筑避让栅格：水域、道路、铁路处不放建筑（1 支路，2 干道/铁路，3 水域）
    const BW = W * BS, BH = H * BS;
    this.BS = BS; this.BW = BW; this.BH = BH;
    const bm = new Uint8Array(BW * BH);
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) if (wm[((y >> 1) * FW) + (x >> 1)]) bm[y * BW + x] = 3;
    const free = function (v) { return v === 0; }, notWater = function (v) { return v < 2; };
    for (const s of Geo.streets) Geo.stroke(bm, BW, BH, BS, s.p, 0.035, 1, free);
    for (const r of Geo.rail) if (!(r.flags & 2)) Geo.stroke(bm, BW, BH, BS, r.p, 0.07, 2, notWater);
    this.bmask = bm;
  };

  // 有符号水域距离（格）：陆地为正，水面为负
  City.prototype.waterDistAt = function (x, y) {
    const S = this.FS, FW = this.FW, FH = this.FH, d = this.wsdf;
    let fx = x * S - 0.5, fy = y * S - 0.5;
    if (fx < 0) fx = 0; if (fy < 0) fy = 0; if (fx > FW - 1.001) fx = FW - 1.001; if (fy > FH - 1.001) fy = FH - 1.001;
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * FW + i;
    const a = d[k] * (1 - u) + d[k + 1] * u, b = d[k + FW] * (1 - u) + d[k + FW + 1] * u;
    return (a * (1 - v) + b * v) / S;
  };
  City.prototype.waterAt = function (x, y) {
    const i = Math.floor(x * this.FS), j = Math.floor(y * this.FS);
    if (i < 0 || j < 0 || i >= this.FW || j >= this.FH) return 0;
    return this.wmask[j * this.FW + i];
  };
  City.prototype.crossesRiver = function (ax, ay, bx, by) {
    const L = U.dist(ax, ay, bx, by), n = Math.max(1, Math.ceil(L * this.FS));
    for (let k = 0; k <= n; k++) { const t = k / n; if (this.waterAt(ax + (bx - ax) * t, ay + (by - ay) * t)) return true; }
    return false;
  };
  City.prototype.riverNameAt = function (x, y) {
    const Geo = CM.Geo;
    for (let r = 0; r <= 8; r++) {
      for (let a = 0; a < (r ? 16 : 1); a++) {
        const t = a / 16 * Math.PI * 2, id = this.waterAt(x + Math.cos(t) * r / this.FS, y + Math.sin(t) * r / this.FS);
        if (!id) continue;
        if (id > 60000) { const rc = (D.reclaim || [])[id - 60001]; return (rc && rc.sea) || D.seaName || D.riverName || '海'; }
        const f = id > 30000 ? Geo.waterLines[id - 30001] : Geo.water[id - 1];
        if (f && f.name) return f.name;
        if (f) return D.riverName || '珠江';
      }
    }
    return D.riverName || '珠江';
  };

  // 地标场地：旋转矩形（米）内的格
  City.prototype.landmarkCells = function (lm) {
    const out = [], hw = lm.w / 2 / CFG.CELL_M, hd = lm.d / 2 / CFG.CELL_M, a = (lm.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const R = Math.hypot(hw, hd) + 1;
    for (let j = Math.floor(lm.y - R); j <= Math.ceil(lm.y + R); j++) for (let i = Math.floor(lm.x - R); i <= Math.ceil(lm.x + R); i++) {
      if (i < 0 || j < 0 || i >= this.W || j >= this.H) continue;
      const dx = i + 0.5 - lm.x, dy = j + 0.5 - lm.y, u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if (Math.abs(u) <= hw + 0.15 && Math.abs(v) <= hd + 0.15) out.push(j * this.W + i);
    }
    const c0 = this.cellAt(lm.x, lm.y);
    if (c0 >= 0 && out.indexOf(c0) < 0) out.push(c0);
    return out;
  };
  // 点是否在地标的真实场地范围内（不含格的粗略误差）
  City.prototype.inLandmarkSite = function (k, x, y) {
    const lm = D.landmarks[k]; if (!lm) return false;
    const a = (lm.rot || 0) * Math.PI / 180, dx = x - lm.x, dy = y - lm.y;
    const u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(u) <= lm.w / 2 / CFG.CELL_M && Math.abs(v) <= lm.d / 2 / CFG.CELL_M;
  };
  // 地标按落成年份出现；建在填海土地上的地标要等场地成陆（中心所在格为陆地）后才出现
  City.prototype.activateLandmarks = function (year) {
    let changed = false;
    for (let k = 0; k < D.landmarks.length; k++) {
      const lm = D.landmarks[k];
      if (this.landmarkOn[k] || lm.year > year) continue;
      const c0 = this.cellAt(lm.x, lm.y);
      if (c0 >= 0 && this.landFrac[c0] < 0.5) continue;
      this.landmarkOn[k] = 1; changed = true;
      this.protectLandmark(k, null);
    }
    return changed;
  };
  // 地标场地内的陆地格设为受保护（cells 为 null 时处理全部场地格，否则只处理其中的格，如刚成陆的格）
  City.prototype.protectLandmark = function (k, cells) {
    const lm = D.landmarks[k];
    for (const c of this.landmarkCells(lm)) {
      if (cells && !cells.has(c)) continue;
      if (this.lu[c] === LU.WATER) continue;
      this.protectedId[c] = k + 1;
      // 校园：保留为学校与机构用地（照常生成校舍与人口），只受保护
      if (lm.kind === 'campus') { this.lu[c] = LU.INST; this.plan[c] = LU.INST; this.street[c] = 1; this.dirty.add(c); continue; }
      this.lu[c] = LU.LANDMARK;
      this.pop[c] = 0; this.jobs[c] = Math.min(this.jobs[c], 300);
      this.street[c] = 1;
      this.dirty.add(c);
    }
  };

  // ---------------- 道路 ----------------
  City.prototype.edgeVerts = function (e) {
    const W = this.W, VW = this.VW;
    if (e < this.eOff[1]) { const j = (e / W) | 0, i = e % W; return [j * VW + i, j * VW + i + 1]; }
    if (e < this.eOff[2]) { const k = e - this.eOff[1]; const j = (k / VW) | 0, i = k % VW; return [j * VW + i, (j + 1) * VW + i]; }
    if (e < this.eOff[3]) { const k = e - this.eOff[2]; const j = (k / W) | 0, i = k % W; return [j * VW + i, (j + 1) * VW + i + 1]; }
    const k = e - this.eOff[3]; const j = (k / W) | 0, i = k % W; return [j * VW + i + 1, (j + 1) * VW + i];
  };
  // 两相邻顶点之间的边编号
  City.prototype.edgeBetween = function (i, j, ni, nj) {
    const W = this.W, VW = this.VW;
    if (nj === j) return this.eOff[0] + j * W + Math.min(i, ni);
    if (ni === i) return this.eOff[1] + Math.min(j, nj) * VW + i;
    const ci = Math.min(i, ni), cj = Math.min(j, nj);
    if ((ni - i) * (nj - j) > 0) return this.eOff[2] + cj * W + ci;
    return this.eOff[3] + cj * W + ci;
  };
  // 真实道路分组：同名同级道路为一组（桥梁、隧道单独成组），并确定通车年份
  City.prototype.buildRoadGroups = function () {
    const Geo = CM.Geo, self = this;
    const groups = [], byKey = new Map();
    const yearOfName = function (name, flags, p) {
      if (!name) return null;
      if (D.roadYears[name] != null) return D.roadYears[name];
      if (flags & 3) for (const k in D.bridgeYears) if (name.indexOf(k) >= 0) return D.bridgeYears[k];
      let best = null, bl = 0;
      for (const k in D.roadYears) if (k.length > bl && name.indexOf(k) === 0) { best = D.roadYears[k]; bl = k.length; }
      return best;
    };
    Geo.roads.forEach(function (r) {
      const link = (r.flags & 4) !== 0;
      const key = r.name && !link ? r.name + '|' + r.cls + '|' + (r.flags & 3) : null;
      let g = key ? byKey.get(key) : null;
      if (!g) {
        g = { name: r.name, cls: r.cls, flags: r.flags & 7, ways: [], bbox: [1e9, 1e9, -1e9, -1e9], year: null, notable: false };
        groups.push(g); if (key) byKey.set(key, g);
      }
      g.ways.push(r.p);
      const b = g.bbox; b[0] = Math.min(b[0], r.bbox[0]); b[1] = Math.min(b[1], r.bbox[1]); b[2] = Math.max(b[2], r.bbox[2]); b[3] = Math.max(b[3], r.bbox[3]);
    });
    for (const sr of D.simRoads || []) {
      const p = new Float32Array([].concat.apply([], sr.p));
      groups.push({ name: sr.n, cls: sr.c, flags: 0, ways: [p], bbox: [Math.min.apply(null, sr.p.map(function (q) { return q[0]; })), Math.min.apply(null, sr.p.map(function (q) { return q[1]; })), Math.max.apply(null, sr.p.map(function (q) { return q[0]; })), Math.max.apply(null, sr.p.map(function (q) { return q[1]; }))], year: sr.y, notable: true, sim: true });
    }
    // 年份：名称表 → 跨江桥梁默认 → 所在区域开放年份
    for (const g of groups) {
      if (g.sim) continue;
      const y = yearOfName(g.name, g.flags, g.ways[0]);
      // 只为名称与年份表完全一致的道路/桥梁播报通车（匝道、辅路、出入口不单独播报；已有历史事件的不重复）
      if (y != null) { g.year = y; g.notable = y > CFG.START.y && !(g.flags & 4) && (D.roadYears[g.name] != null || D.bridgeYears[g.name] != null) && !D.events.some(function (e) { return e.title.indexOf(g.name) >= 0; }); continue; }
      let water = 0;
      if (g.flags & 3) for (const p of g.ways) for (let k = 0; k + 3 < p.length; k += 2) if (self.crossesRiver(p[k], p[k + 1], p[k + 2], p[k + 3])) water++;
      if (water >= 2 && (g.flags & 3)) { g.year = D.bridgeDefaultYear; continue; }
      const p = g.ways[0], m = (p.length / 4 | 0) * 2;
      const c = self.cellAt(p[m], p[m + 1]);
      const rg = c >= 0 ? self.regions[self.region[c]] : D.defaultRegion;
      g.year = rg.scenic || rg.open == null ? CFG.START.y : Math.max(CFG.START.y, rg.open);
    }
    // 填海土地上的道路：不早于该处填海成陆的年份（道路有三成以上的点在填海范围内，或桥梁接到填海土地上）
    const rf = this.reclaimFeats(false);
    if (rf.length) for (const g of groups) {
      for (const f of rf) {
        const a = g.bbox, b = f.bbox;
        if (a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]) continue;
        let n = 0, inside = 0;
        for (const p of g.ways) for (let k = 0; k + 1 < p.length; k += 2) { n++; if (inRing(p[k], p[k + 1], f.rings[0].p)) inside++; }
        if (inside && (inside >= 0.3 * n || (g.flags & 3))) g.year = Math.max(g.year, D.reclaim[f.k].year);
      }
    }
    this.roadGroups = groups;
    this.roadWays = [];
    groups.forEach(function (g, gi) { for (const p of g.ways) self.roadWays.push({ g: gi, p: p, bbox: CM.Geo.bbox(p) }); });
    this.roadWayBk = CM.Geo.buckets(this.roadWays, 4, this.W, this.H);
    this.roadNames = [''].concat(groups.map(function (g) { return g.name; }));
    this.roadsBuilt = new Uint8Array(groups.length);
  };
  City.prototype.applyRoads = function (year) {
    let changed = this.updateRail(year);
    const groups = this.roadGroups, BW = this.BW, BH = this.BH, bm = this.bmask;
    const notWater = function (v) { return v < 3; };
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      if (this.roadsBuilt[k] || g.year > year) continue;
      this.roadsBuilt[k] = 1; changed = true;
      // 建筑避让
      const hw = g.cls === 4 ? 0.1 : (g.cls === 3 ? 0.075 : 0.05);
      if (!(g.flags & 2)) for (const p of g.ways) Geo2().stroke(bm, BW, BH, BS, p, (g.flags & 4) ? 0.04 : hw, 2, notWater);
      // 车行格网：快速路与主干道（匝道除外）
      if (g.cls >= 3 && !(g.flags & 4)) {
        for (const p of g.ways) {
          for (let q = 0; q + 3 < p.length; q += 2) {
            let i = U.clamp(Math.round(p[q]), 0, this.W), j = U.clamp(Math.round(p[q + 1]), 0, this.H);
            const i1 = U.clamp(Math.round(p[q + 2]), 0, this.W), j1 = U.clamp(Math.round(p[q + 3]), 0, this.H);
            const dx = Math.abs(i1 - i), dy = Math.abs(j1 - j), sx = i < i1 ? 1 : -1, sy = j < j1 ? 1 : -1;
            let err = dx - dy, guard = 0;
            while ((i !== i1 || j !== j1) && guard++ < 1000) {
              const e2 = 2 * err; let ni = i, nj = j;
              if (e2 > -dy) { err -= dy; ni += sx; }
              if (e2 < dx) { err += dx; nj += sy; }
              const e = this.edgeBetween(i, j, ni, nj);
              if (g.cls > this.eArt[e] || (g.cls === this.eArt[e] && g.name && !this.eName[e])) { this.eArt[e] = g.cls; this.eName[e] = k + 1; }
              i = ni; j = nj;
            }
          }
        }
      }
      // 道路沿线的格重新绘制
      const b = g.bbox;
      if (year > CFG.START.y || this.version > 0) for (let jj = Math.max(0, Math.floor(b[1])); jj <= Math.min(this.H - 1, Math.floor(b[3])); jj++) for (let ii = Math.max(0, Math.floor(b[0])); ii <= Math.min(this.W - 1, Math.floor(b[2])); ii++) this.dirty.add(jj * this.W + ii);
    }
    if (changed) this.version++;
    return changed;
  };
  function Geo2() { return CM.Geo; }
  function inRing(x, y, p) {
    let ins = false;
    for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  // ---------------- 地面铁路（v1.9） ----------------
  // 普通铁路不参与乘客出行模拟，但地面铁路（非高架、非隧道）是城市空间的阻隔：在没有道口、地道或天桥的地方阻断步行与支路、次干道。
  // 合法通道 = 真实道路（已通车）或街道（所在街区已开发）跨越铁路的位置；格网边在通道附近（RAIL_R 以内）越过铁路时绕行到通道通过，
  // 否则阻断。主干道与快速路按真实道路处理（立交或道口），不受影响。高架铁路下方可以通行，隧道不构成阻隔。
  // 几何按地图缓存（与年份无关）；铁路是否运营按开通年份（高铁按本地图的高铁年份）每月判断。
  const RAIL_CACHE = new WeakMap(), RAIL_R = 0.7;
  function segT(ax, ay, bx, by, cx, cy, dx, dy) {
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return -1;
    const qx = cx - ax, qy = cy - ay, t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    return t < 0 || t > 1 || u < 0 || u > 1 ? -1 : t;
  }
  City.prototype.railGeom = function () {
    const Geo = CM.Geo, W = this.W, H = this.H;
    const hit = RAIL_CACHE.get(Geo.rail);
    if (hit && hit.W === W && hit.H === H && hit.nWays === this.roadWays.length) return hit;
    // 铁路线段：kind 0 地面（含路堤），1 高架；隧道不计
    const ax = [], ay = [], bx = [], by = [], fk = [], kind = [];
    Geo.rail.forEach(function (r, k) {
      if (r.flags & 2) return;
      const p = r.p, kd = (r.flags & 1) ? 1 : 0;
      for (let q = 0; q + 3 < p.length; q += 2) { ax.push(p[q]); ay.push(p[q + 1]); bx.push(p[q + 2]); by.push(p[q + 3]); fk.push(k); kind.push(kd); }
    });
    const n = fk.length, bk = new Array(W * H);
    for (let i = 0; i < n; i++) {
      const i0 = U.clamp(Math.floor(Math.min(ax[i], bx[i])), 0, W - 1), i1 = U.clamp(Math.floor(Math.max(ax[i], bx[i])), 0, W - 1);
      const j0 = U.clamp(Math.floor(Math.min(ay[i], by[i])), 0, H - 1), j1 = U.clamp(Math.floor(Math.max(ay[i], by[i])), 0, H - 1);
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) { const t = j * W + ii; (bk[t] || (bk[t] = [])).push(i); }
    }
    const R = { W: W, H: H, nWays: this.roadWays.length, n: n, ax: Float32Array.from(ax), ay: Float32Array.from(ay), bx: Float32Array.from(bx), by: Float32Array.from(by), fk: Int32Array.from(fk), kind: Uint8Array.from(kind), bk: bk };
    // 线段 (x0,y0)-(x1,y1) 与地面铁路的交点
    const surfHits = function (x0, y0, x1, y1, cb) {
      const i0 = U.clamp(Math.floor(Math.min(x0, x1)), 0, W - 1), i1 = U.clamp(Math.floor(Math.max(x0, x1)), 0, W - 1);
      const j0 = U.clamp(Math.floor(Math.min(y0, y1)), 0, H - 1), j1 = U.clamp(Math.floor(Math.max(y0, y1)), 0, H - 1);
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const list = bk[j * W + ii]; if (!list) continue;
        for (const s of list) {
          if (R.kind[s]) continue;
          const t = segT(x0, y0, x1, y1, R.ax[s], R.ay[s], R.bx[s], R.by[s]);
          if (t >= 0) cb(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, s);
        }
      }
    };
    R.surfHits = surfHits;
    // 合法通道：真实道路（g ≥ 0 为道路组）与街道（g = −1）跨越地面铁路的位置
    const cx = [], cy = [], cg = [];
    const scan = function (p, g) { for (let q = 0; q + 3 < p.length; q += 2) surfHits(p[q], p[q + 1], p[q + 2], p[q + 3], function (x, y) { cx.push(x); cy.push(y); cg.push(g); }); };
    for (const w of this.roadWays) scan(w.p, w.g);
    for (const s of Geo.streets) scan(s.p, -1);
    const cbk = new Array(W * H);
    for (let i = 0; i < cx.length; i++) { const t = U.clamp(Math.floor(cy[i]), 0, H - 1) * W + U.clamp(Math.floor(cx[i]), 0, W - 1); (cbk[t] || (cbk[t] = [])).push(i); }
    R.cross = { x: Float32Array.from(cx), y: Float32Array.from(cy), g: Int32Array.from(cg), bk: cbk };
    // 格网边越过地面铁路的位置（每条边每条铁路线最多记一次）
    const ee = [], ex = [], ey = [], ek = [];
    const nTot = this.eCls.length, VW = this.VW;
    for (let e = 0; e < nTot; e++) {
      const uv = this.edgeVerts(e), x0 = uv[0] % VW, y0 = (uv[0] / VW) | 0, x1 = uv[1] % VW, y1 = (uv[1] / VW) | 0;
      let lastK = -1;
      surfHits(x0, y0, x1, y1, function (x, y, s) { const k = R.fk[s]; if (k === lastK) return; lastK = k; ee.push(e); ex.push(x); ey.push(y); ek.push(k); });
    }
    R.edge = { e: Int32Array.from(ee), x: Float32Array.from(ex), y: Float32Array.from(ey), k: Int32Array.from(ek) };
    RAIL_CACHE.set(Geo.rail, R);
    return R;
  };
  City.railActiveAt = function (r, year) { return !((r.year && year < r.year) || ((r.flags & 16) && year < (D.hsrYear || 2009))); };
  // 按年份更新运营中的铁路；返回是否有变化（新线开通时需要重建步行与道路网络）
  City.prototype.updateRail = function (year) {
    const rail = CM.Geo.rail || [];
    const on = new Uint8Array(rail.length);
    let changed = !this.railOn || this.railOn.length !== on.length;
    for (let k = 0; k < rail.length; k++) { on[k] = City.railActiveAt(rail[k], year) ? 1 : 0; if (!changed && on[k] !== this.railOn[k]) changed = true; }
    this.railOn = on; this.railYear = year;
    return changed && this.version > 0;
  };
  // 每条格网边的铁路状态：eRail 0 无、1 绕行到附近通道（eRailDet 为附加米数）、2 阻断
  City.prototype.computeRailBlock = function () {
    const nTot = this.eCls.length;
    if (!this.eRail || this.eRail.length !== nTot) { this.eRail = new Uint8Array(nTot); this.eRailDet = new Float32Array(nTot); }
    const eR = this.eRail, eD = this.eRailDet;
    eR.fill(0); eD.fill(0);
    if (!this.railOn || !this.railOn.some(function (v) { return v; })) return;
    const R = this.railGeom(), W = this.W, H = this.H, C = R.cross, E = R.edge, st = this.street, built = this.roadsBuilt;
    const legal = (i) => {
      const g = C.g[i];
      if (g >= 0) return !!built[g];
      const ci = Math.floor(C.x[i]), cj = Math.floor(C.y[i]);
      for (let j = cj - 1; j <= cj + 1; j++) for (let ii = ci - 1; ii <= ci + 1; ii++) if (ii >= 0 && j >= 0 && ii < W && j < H && st[j * W + ii]) return true;
      return false;
    };
    for (let q = 0; q < E.e.length; q++) {
      const e = E.e[q];
      if (!this.railOn[E.k[q]] || eR[e] === 2) continue;
      const x = E.x[q], y = E.y[q];
      let best = Infinity;
      for (let j = Math.max(0, Math.floor(y - RAIL_R)); j <= Math.min(H - 1, Math.floor(y + RAIL_R)); j++) for (let i = Math.max(0, Math.floor(x - RAIL_R)); i <= Math.min(W - 1, Math.floor(x + RAIL_R)); i++) {
        const list = C.bk[j * W + i]; if (!list) continue;
        for (const c of list) { const d = U.dist(x, y, C.x[c], C.y[c]); if (d < best && d <= RAIL_R && legal(c)) best = d; }
      }
      if (best === Infinity) { eR[e] = 2; eD[e] = 0; }
      else { eR[e] = 1; eD[e] = Math.max(eD[e], 2 * Math.max(0, best - 0.15) * CFG.CELL_M); }
    }
  };
  // 折线与运营中铁路的交叉：surf 地面铁路、via 高架铁路；同一走廊的多股轨道（相距不足约 150 m）计为一处
  City.prototype.railCross = function (pts) {
    const out = { surf: [], via: [] };
    if (!this.railOn || !CM.Geo.rail.length) return out;
    const R = this.railGeom(), W = this.W, H = this.H, on = this.railOn;
    for (let q = 0; q + 1 < pts.length; q++) {
      const x0 = pts[q][0], y0 = pts[q][1], x1 = pts[q + 1][0], y1 = pts[q + 1][1];
      const i0 = U.clamp(Math.floor(Math.min(x0, x1)), 0, W - 1), i1 = U.clamp(Math.floor(Math.max(x0, x1)), 0, W - 1);
      const j0 = U.clamp(Math.floor(Math.min(y0, y1)), 0, H - 1), j1 = U.clamp(Math.floor(Math.max(y0, y1)), 0, H - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const list = R.bk[j * W + i]; if (!list) continue;
        for (const s of list) {
          if (!on[R.fk[s]]) continue;
          const t = segT(x0, y0, x1, y1, R.ax[s], R.ay[s], R.bx[s], R.by[s]); if (t < 0) continue;
          const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, arr = R.kind[s] ? out.via : out.surf;
          if (!arr.some(function (p) { return U.dist(p[0], p[1], x, y) < 0.6; })) arr.push([x, y, R.fk[s]]);
        }
      }
    }
    return out;
  };
  // 到最近的运营中地面铁路的距离（格，只查 1.5 格以内）
  City.prototype.railDist = function (x, y) {
    if (!this.railOn || !CM.Geo.rail.length) return Infinity;
    const R = this.railGeom(), W = this.W, H = this.H;
    let best = Infinity;
    for (let j = Math.max(0, Math.floor(y - 1.5)); j <= Math.min(H - 1, Math.floor(y + 1.5)); j++) for (let i = Math.max(0, Math.floor(x - 1.5)); i <= Math.min(W - 1, Math.floor(x + 1.5)); i++) {
      const list = R.bk[j * W + i]; if (!list) continue;
      for (const s of list) { if (R.kind[s] || !this.railOn[R.fk[s]]) continue; const d = segDist(x, y, R.ax[s], R.ay[s], R.bx[s], R.by[s]); if (d < best) best = d; }
    }
    return best;
  };
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.hypot(ax + dx * t - px, ay + dy * t - py);
  }

  // 根据街区开发情况生成支路与次干道（系统建设）
  City.prototype.updateStreets = function () {
    const W = this.W, H = this.H, Z = CFG.ZONE, st = this.street;
    const cls = this.eCls;
    cls.set(this.eArt);
    const hasSt = function (i, j) { return i >= 0 && j >= 0 && i < W && j < H && st[j * W + i] === 1; };
    // 横向边 (i,j)-(i+1,j)：相邻格 (i,j-1) 与 (i,j)
    for (let j = 0; j <= H; j++) {
      for (let i = 0; i < W; i++) {
        const e = this.eOff[0] + j * W + i;
        if (this.eBlock[e]) continue;
        if (hasSt(i, j - 1) || hasSt(i, j)) {
          const want = (j % Z === 0) ? 2 : 1;
          if (cls[e] < want) cls[e] = want;
        }
      }
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i <= W; i++) {
        const e = this.eOff[1] + j * this.VW + i;
        if (this.eBlock[e]) continue;
        if (hasSt(i - 1, j) || hasSt(i, j)) {
          const want = (i % Z === 0) ? 2 : 1;
          if (cls[e] < want) cls[e] = want;
        }
      }
    }
  };

  // 构建步行图（CSR）与汽车图（收缩后的路段 + 小区连接线）
  City.prototype.buildGraphs = function () {
    const V = this.V, VW = this.VW, nTot = this.eCls.length;
    const vx = this.vx, vy = this.vy, CM_ = CFG.CELL_M;
    // 地面铁路：没有通道处阻断支路与次干道（含步行），有通道时绕行（v1.9）
    this.computeRailBlock();
    const eRail = this.eRail, eDet = this.eRailDet;
    // ---- 步行 ----
    const wDeg = new Int32Array(V + 1);
    const walkable = new Uint8Array(nTot);
    for (let e = 0; e < nTot; e++) {
      const c = this.eCls[e];
      if (c < 1 || c === 4) continue;
      if (this.eBlock[e] && c < 3) continue;
      if (eRail[e] === 2 && c < 3) continue;
      walkable[e] = 1;
      const uv = this.edgeVerts(e); wDeg[uv[0]]++; wDeg[uv[1]]++;
    }
    const wStart = new Int32Array(V + 1);
    for (let v = 0; v < V; v++) wStart[v + 1] = wStart[v] + wDeg[v];
    const wTo = new Int32Array(wStart[V]), wLen = new Float32Array(wStart[V]);
    const fill = new Int32Array(V);
    for (let e = 0; e < nTot; e++) {
      if (!walkable[e]) continue;
      const uv = this.edgeVerts(e), a = uv[0], b = uv[1];
      const L = U.dist(vx[a], vy[a], vx[b], vy[b]) * CM_ + (this.eCls[e] < 3 ? eDet[e] : 0);
      wTo[wStart[a] + fill[a]] = b; wLen[wStart[a] + fill[a]] = L; fill[a]++;
      wTo[wStart[b] + fill[b]] = a; wLen[wStart[b] + fill[b]] = L; fill[b]++;
    }
    this.walk = { start: wStart, to: wTo, len: wLen, deg: wDeg };

    // ---- 汽车 ----
    // New pedestrian streets often leave the car graph exactly unchanged. Compare
    // all effective inputs instead of rebuilding contraction, snapping and OD links.
    const prior = this._carInputs;
    const rules = CFG.CELL_M + '|' + CFG.ZONE + '|' + CFG.road.speed.join(',') + '|' + CFG.road.cap.join(',');
    let same = !!(this.car && prior && prior.rules === rules && prior.ways === this.roadWays && prior.cls.length === nTot && prior.vx.length === V);
    if (same) for (let v = 0; v < V; v++) if (prior.vx[v] !== vx[v] || prior.vy[v] !== vy[v]) { same = false; break; }
    const carOn = function (e, c) { return c >= 2 && !(c < 3 && (this.eBlock[e] || eRail[e] === 2)); }.bind(this);
    const detOf = function (e, c) { return c < 3 ? eDet[e] : 0; };
    if (same && !prior.det) same = false;
    if (same) for (let e = 0; e < nTot; e++) {
      const c = this.eCls[e], active = carOn(e, c);
      if (prior.cls[e] !== (active ? c : 0) || prior.name[e] !== (active ? this.eName[e] : 0) || prior.block[e] !== (active ? this.eBlock[e] : 0) || prior.det[e] !== (active ? Math.fround(detOf(e, c)) : 0)) { same = false; break; }
    }
    if (same) { this.roadVersion++; return; }
    const cDeg = new Int32Array(V);
    const carE = [];
    for (let e = 0; e < nTot; e++) {
      const c = this.eCls[e];
      if (!carOn(e, c)) continue;
      carE.push(e);
      const uv = this.edgeVerts(e); cDeg[uv[0]]++; cDeg[uv[1]]++;
    }
    const cStart = new Int32Array(V + 1);
    for (let v = 0; v < V; v++) cStart[v + 1] = cStart[v] + cDeg[v];
    const cEdge = new Int32Array(cStart[V]);
    const cf = new Int32Array(V);
    for (const e of carE) {
      const uv = this.edgeVerts(e);
      cEdge[cStart[uv[0]] + cf[uv[0]]++] = e;
      cEdge[cStart[uv[1]] + cf[uv[1]]++] = e;
    }
    const forced = new Uint8Array(V);
    for (let v = 0; v < V; v++) {
      const d = cDeg[v];
      if (d === 0) continue;
      if (d !== 2) { forced[v] = 1; continue; }
      const e1 = cEdge[cStart[v]], e2 = cEdge[cStart[v] + 1];
      if (this.eCls[e1] !== this.eCls[e2] || this.eName[e1] !== this.eName[e2]) forced[v] = 1;
    }
    // 小区连接点
    const Z = CFG.ZONE, ZW = this.W / Z, ZH = this.H / Z;
    const zoneCand = [];
    for (let zj = 0; zj < ZH; zj++) {
      for (let zi = 0; zi < ZW; zi++) {
        const cx = zi * Z + Z / 2, cy = zj * Z + Z / 2;
        const cand = [];
        for (let rad = 1; rad <= 9 && cand.length === 0; rad += (rad < 3 ? 2 : 3)) {
          for (let j = Math.max(0, zj * Z - rad); j <= Math.min(this.H, zj * Z + Z + rad); j++) {
            for (let i = Math.max(0, zi * Z - rad); i <= Math.min(this.W, zi * Z + Z + rad); i++) {
              const v = j * VW + i;
              if (cDeg[v] > 0) cand.push([v, U.dist(vx[v], vy[v], cx, cy)]);
            }
          }
        }
        cand.sort(function (a, b) { return a[1] - b[1]; });
        const pick = [];
        for (const cnd of cand) {
          if (pick.length >= 3) break;
          let ok = true;
          for (const p of pick) if (U.dist(vx[p[0]], vy[p[0]], vx[cnd[0]], vy[cnd[0]]) < 1.6) ok = false;
          if (ok) pick.push(cnd);
        }
        for (const p of pick) forced[p[0]] = 1;
        zoneCand.push(pick);
      }
    }
    // 收缩路段
    const visited = new Uint8Array(nTot);
    const links = [];
    const self = this;
    function walkChain(s, e0) {
      const verts = [s];
      let cur = s, e = e0, lenM = 0, bridge = 0, guard = 0;
      for (;;) {
        visited[e] = 1;
        const uv = self.edgeVerts(e);
        const nxt = uv[0] === cur ? uv[1] : uv[0];
        lenM += U.dist(vx[cur], vy[cur], vx[nxt], vy[nxt]) * CM_ + detOf(e, self.eCls[e]);
        if (self.eBlock[e]) bridge = 1;
        verts.push(nxt);
        if (forced[nxt] || guard++ > 5000) break;
        let ne = -1;
        for (let k = cStart[nxt]; k < cStart[nxt + 1]; k++) if (cEdge[k] !== e) { ne = cEdge[k]; break; }
        if (ne < 0 || visited[ne]) break;
        cur = nxt; e = ne;
      }
      links.push({ verts: verts, lenM: lenM, cls: self.eCls[e0], name: self.eName[e0], bridge: bridge });
    }
    for (let v = 0; v < V; v++) {
      if (!forced[v]) continue;
      for (let k = cStart[v]; k < cStart[v + 1]; k++) if (!visited[cEdge[k]]) walkChain(v, cEdge[k]);
    }
    for (const e of carE) if (!visited[e]) { const uv = this.edgeVerts(e); forced[uv[0]] = 1; walkChain(uv[0], e); }

    // 节点编号
    const vertNode = new Int32Array(V).fill(-1);
    const nodeVert = [];
    const nodeOf = function (v) { if (vertNode[v] < 0) { vertNode[v] = nodeVert.length; nodeVert.push(v); } return vertNode[v]; };
    for (const L of links) { L.a = nodeOf(L.verts[0]); L.b = nodeOf(L.verts[L.verts.length - 1]); }
    const nN = nodeVert.length, nA = links.length * 2;
    const arcFrom = new Int32Array(nA), arcTo = new Int32Array(nA), arcLen = new Float32Array(nA), arcCap = new Float32Array(nA), arcT0 = new Float32Array(nA);
    const outDeg = new Int32Array(nN + 1);
    for (let k = 0; k < links.length; k++) {
      const L = links[k];
      L.id = k;
      L.key = Math.min(L.verts[0], L.verts[L.verts.length - 1]) + '_' + Math.max(L.verts[0], L.verts[L.verts.length - 1]) + '_' + L.verts.length;
      const cap = CFG.road.cap[L.cls] * (L.bridge ? 0.75 : 1);
      const t0 = L.lenM / (CFG.road.speed[L.cls] * 1000 / 60);
      arcFrom[2 * k] = L.a; arcTo[2 * k] = L.b; arcFrom[2 * k + 1] = L.b; arcTo[2 * k + 1] = L.a;
      arcLen[2 * k] = arcLen[2 * k + 1] = L.lenM;
      arcCap[2 * k] = arcCap[2 * k + 1] = cap;
      arcT0[2 * k] = arcT0[2 * k + 1] = Math.max(0.05, t0);
      outDeg[L.a]++; outDeg[L.b]++;
      // 几何
      let pts = L.verts.map(function (v) { return [vx[v], vy[v]]; });
      // 贴合真实道路线形（车辆沿真实道路行驶）；无法贴合的格网连接线只参与模拟、不显示车辆
      const real = L.name ? this.snapToRoad(L.name, pts) : null;
      if (real) { pts = real; L.real = true; }
      else if (L.cls >= 3 && pts.length > 2) pts = U.chaikin(pts, 2);
      L.pts = pts; L.cum = U.cumLen(pts);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      L.bbox = [x0, y0, x1, y1];
    }
    const outStart = new Int32Array(nN + 1);
    for (let n = 0; n < nN; n++) outStart[n + 1] = outStart[n] + outDeg[n];
    const outArc = new Int32Array(nA);
    const of = new Int32Array(nN);
    for (let a = 0; a < nA; a++) { const f = arcFrom[a]; outArc[outStart[f] + of[f]++] = a; }
    const zoneConn = zoneCand.map(function (pick) {
      return pick.map(function (p) {
        const m = p[1] * CM_;
        return { node: vertNode[p[0]], t: m / 250 + 1.0, km: m / 1000 };
      }).filter(function (c) { return c.node >= 0; });
    });
    this.car = { nN: nN, nA: nA, nodeVert: nodeVert, vertNode: vertNode, arcFrom: arcFrom, arcTo: arcTo, arcLen: arcLen, arcCap: arcCap, arcT0: arcT0, outStart: outStart, outArc: outArc, links: links, zoneConn: zoneConn };

    // 主干道旁的格（用于新区沿路开发）
    this.nearArt = new Uint8Array(this.N);
    for (let e = 0; e < nTot; e++) {
      if (this.eCls[e] < 3) continue;
      const uv = this.edgeVerts(e);
      for (const v of uv) {
        const i = v % VW, j = (v / VW) | 0;
        for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
          const ci = i + di, cj = j + dj;
          if (ci >= 0 && cj >= 0 && ci < this.W && cj < this.H) this.nearArt[cj * this.W + ci] = 1;
        }
      }
    }
    const inputs = { rules: rules, ways: this.roadWays, vx: Float64Array.from(vx), vy: Float64Array.from(vy), cls: new Uint8Array(nTot), name: new Int32Array(nTot), block: new Uint8Array(nTot), det: new Float32Array(nTot) };
    for (let e = 0; e < nTot; e++) {
      const c = this.eCls[e];
      if (!carOn(e, c)) continue;
      inputs.cls[e] = c; inputs.name[e] = this.eName[e]; inputs.block[e] = this.eBlock[e]; inputs.det[e] = detOf(e, c);
    }
    this._carInputs = inputs;
    this.roadVersion++;
  };

  // 把格网路段投影到所属真实道路上，取两端投影点之间的真实折线
  function projPoly(p, x, y) {
    let best = { d: 1e9, k: 0, t: 0, s: 0 }, acc = 0;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], ay = p[k + 1], dx = p[k + 2] - ax, dy = p[k + 3] - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
      let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const qx = ax + dx * t - x, qy = ay + dy * t - y, d = Math.sqrt(qx * qx + qy * qy);
      if (d < best.d) best = { d: d, k: k / 2, t: t, s: acc + L * t, x: ax + dx * t, y: ay + dy * t };
      acc += L;
    }
    return best;
  }
  City.prototype.snapToRoad = function (name, pts) {
    const g = this.roadGroups[name - 1]; if (!g) return null;
    const a = pts[0], b = pts[pts.length - 1];
    let latLen = 0; for (let k = 1; k < pts.length; k++) latLen += U.dist(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
    let best = null, bd = 1.5;
    for (const p of g.ways) {
      const A = projPoly(p, a[0], a[1]); if (A.d > 0.8) continue;
      const B = projPoly(p, b[0], b[1]); if (B.d > 0.8) continue;
      const len = Math.abs(B.s - A.s);
      if (len < latLen * 0.35 || len > latLen * 2.5 + 0.5) continue;
      if (A.d + B.d < bd) { bd = A.d + B.d; best = [p, A, B]; }
    }
    if (!best) return null;
    const p = best[0], A = best[1], B = best[2], out = [[A.x, A.y]];
    if (A.s <= B.s) { for (let k = A.k + 1; k <= B.k; k++) out.push([p[2 * k], p[2 * k + 1]]); }
    else { for (let k = A.k; k > B.k; k--) out.push([p[2 * k], p[2 * k + 1]]); }
    out.push([B.x, B.y]);
    return out.length >= 2 ? out : null;
  };

  // ---------------- 地价（经营模式派生量） ----------------
  // P = P0 · 物价指数 · (1 + poiGain·POI) · (1 + accessGain·可达性) · (1 + jobGain·岗位密度)
  // POI 来自 facility.js 的设施表：按组权重、场地半径做窗口累加（不遍历全图，按设施外扩 2.5R）。
  // 可达性用站点步行距离（acc.cellWalk，米）。只在经营模式调用；不存档，也不参与既有模式的任何计算。
  City.prototype.buildLandPrice = function (year, acc) {
    const L = CFG.land, N = this.N, W = this.W, H = this.H;
    if (!L) return null;
    const poi = new Float32Array(N);
    const fac = (CM.Fac && CM.Fac.list) ? CM.Fac.list() : [];
    const gw = L.poiGroup || {};
    for (const f of fac) {
      if (!CM.Fac.active(f, year, this)) continue;
      // 上盖商业按形态给 POI 强度（站内铺位几乎不抬地价，综合体显著拉动）
      const w = f.poiW != null ? f.poiW : (gw[f.T.group] != null ? gw[f.T.group] : 0.4);
      if (!(w > 0)) continue;
      const S = Math.max(1.2, (f.r || 0.8) * L.poiRadius);
      const R = S * 2.5, r2 = R * R;
      const i0 = Math.max(0, Math.floor(f.x - R)), i1 = Math.min(W - 1, Math.ceil(f.x + R));
      const j0 = Math.max(0, Math.floor(f.y - R)), j1 = Math.min(H - 1, Math.ceil(f.y + R));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = i + 0.5 - f.x, dy = j + 0.5 - f.y, d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          poi[j * W + i] += w * Math.exp(-d2 / (S * S));
        }
      }
    }
    const ind = U.priceIndex(year, CFG.cost.inflation, CFG.econBase || 1990);
    const walk = acc && acc.cellWalk ? acc.cellWalk : null;
    const P = new Float32Array(N);
    // 相对乘子（不含基准与物价指数）：拆迁计价要用 1990 年价，所以单独存一份
    const MUL = new Float32Array(N);
    // 站点步行可达性乘子：供「容积率联动」派生开发强度（修地铁 → 允许加密）
    const ACC = new Float32Array(N);
    // 按交通小区（1 km²）聚合，供片区详情展示：平均地价 + 三项分项指数
    const ZW = (W / CFG.ZONE) | 0, ZH = (H / CFG.ZONE) | 0, ZN = ZW * ZH;
    const zP = new Float64Array(ZN), zPoi = new Float64Array(ZN), zAcc = new Float64Array(ZN), zDen = new Float64Array(ZN), zN = new Uint16Array(ZN);
    let sum = 0, n = 0, mx = 0;
    const vals = [];
    for (let c = 0; c < N; c++) {
      if (this.landFrac[c] < 0.5 || this.lu[c] === LU.WATER) continue;
      const poiMul = 1 + L.poiGain * poi[c];
      let accMul = 1;
      // 可达项优先用「T 分钟内可达岗位」的乘子（经营模式每月算一次，见 Model.computeLandAccess）；
      // 没有时退回「离站步行距离」。前者反映的是通勤便利，后者只是离站近。
      if (this._accMulArr) accMul = this._accMulArr[c] || 1;
      else if (walk) { const wm = Math.min(walk[c] || 0, 4000); accMul = 1 + L.accessGain * Math.exp(-wm / L.accessScale); }
      const dens = Math.min(L.densCap, (this.pop[c] + 1.5 * this.jobs[c]) / L.densRef);
      const denMul = (1 + L.densGain * Math.pow(dens, L.densPow)) * (1 + L.jobGain * Math.min(3, this.jobs[c] / L.jobRef));
      // 基础乘子 → 按本图梯度系数拉伸（gradK=1 时不改变）
      let mul = poiMul * accMul * denMul;
      const gk = L.gradK || 1;
      if (gk !== 1) mul = 1 + (mul - 1) * gk;
      if (mul > L.maxMul) mul = L.maxMul;
      const v = L.base * ind * mul;
      P[c] = v; MUL[c] = mul; ACC[c] = accMul; sum += v; n++; if (v > mx) mx = v;
      vals.push(v);
      const z = this.zoneOf(c);
      zP[z] += v; zPoi[z] += poiMul; zAcc[z] += accMul; zDen[z] += denMul; zN[z]++;
    }
    this.landZone = { price: zP, poi: zPoi, acc: zAcc, dens: zDen, n: zN };
    vals.sort(function (a, b) { return a - b; });
    this.landPrice = P;
    this.landMul = MUL;
    this.landAcc = ACC;
    this.landStat = {
      year: year, cells: n, mean: n ? sum / n : 0, max: mx,
      p10: n ? vals[Math.floor(n * 0.1)] : 0,
      p50: n ? vals[Math.floor(n * 0.5)] : 0,
      p90: n ? vals[Math.floor(n * 0.9)] : 0,
      gradient: n ? vals[Math.floor(n * 0.9)] / Math.max(1, vals[Math.floor(n * 0.1)]) : 0,
    };
    return this.landStat;
  };

  // 拆迁补偿（每格，万元，1990 年价）：市价 × clearFactor × 格面积；调用方仍按物价指数折算。
  // 没有地价（自由建造 / 经营挑战）时回落到既有固定口径，旧模式的数值完全不变。
  // 与"地下线不买地"的规则配合：地下区间 demolishFactor 为 0，地面/高架才需要为地付钱。
  City.prototype.clearPerCell = function (c) {
    const L = CFG.land;
    if (!this.landMul || !L || !L.clearFactor) return CFG.cost.demolishPerCell;
    const m = this.landMul[c];
    if (!(m > 0)) return 0;
    const v = L.base * m * L.clearFactor * CELL_KM2 * 1e6 / 10000;
    const cap = (L.clearCapTunnel || 0) * (CFG.cost.trackPerKm || {}).underground;
    return cap > 0 ? Math.min(v, cap) : v;
  };

  // ---------------- 建筑高度 ----------------
  City.prototype.heightFor = function (c, year) {
    const L = this.lu[c];
    const pd = this.pop[c] / CELL_KM2, jd = this.jobs[c] / CELL_KM2;
    const hsh = U.hash2(c, 7, this.seed);
    let h = 0, cap = 400;
    const era = year < 1995 ? 0 : (year < 2005 ? 1 : 2);
    switch (L) {
      case LU.RES: h = 6 + 0.0011 * pd + 0.0004 * jd; cap = [21, 75, 150][era]; break;
      case LU.MIX: h = 8 + 0.0009 * (pd + jd); cap = [25, 90, 170][era]; break;
      case LU.COM: h = 10 + 0.0016 * jd + 0.0005 * pd; cap = [48, 180, 380][era]; break;
      case LU.IND: h = 7 + 0.00025 * jd; cap = 26; break;
      case LU.INST: h = 10 + 0.0003 * (pd + jd); cap = 45; break;
      case LU.RURAL: h = (pd + jd) > 300 ? 5 : 0; cap = 8; break;
      default: return 0;
    }
    return Math.min(cap, h) * (0.8 + 0.4 * hsh);
  };

  // ---------------- 区域 ----------------
  City.prototype.regionAt = function (x, y) { const c = this.cellAt(x, y); return c < 0 ? null : this.regions[this.region[c]]; };
  City.prototype.openRegion = function (k, y, m) {
    if (this.regionOpen[k]) return false;
    this.regionOpen[k] = 1; this.regionOpenDate[k] = [y, m];
    for (let c = 0; c < this.N; c++) if (this.region[c] === k) this.dirty.add(c);
    this.version++;
    return true;
  };
  City.prototype.closeAirport = function () {
    let n = 0;
    for (let c = 0; c < this.N; c++) {
      if (this.lu[c] === LU.AIRPORT) { this.lu[c] = LU.RURAL; this.dirty.add(c); n++; }
    }
    if (n) this.version++;
  };

  City.prototype.totals = function () {
    let p = 0, j = 0;
    for (let c = 0; c < this.N; c++) { p += this.pop[c]; j += this.jobs[c]; }
    return { pop: p, jobs: j };
  };

  // ---------------- 城市发展（每月） ----------------
  // ctx: { year, monthIndex, zoneAccess (Float32Array 0..1), cellWalk (Float32Array m), coverage, econ }
  // econ（城市经济，可空）：popGrowth 人口增速系数、jobs 就业水平系数、com 商业发展系数。只调整增速与就业水平，
  // 长期人口仍回到本城的人口曲线；地铁覆盖对人口的吸引（boost）不经过经济系数，避免重复计算
  City.prototype.growMonth = function (ctx) {
    const N = this.N, W = this.W, year = ctx.year;
    const tot = this.totals();
    const E = ctx.econ || null, egp = E ? E.popGrowth : 1, ejf = E ? E.jobs : 1, ecom = E ? E.com : 1;
    const boost = 1 + CFG.growth.metroBoostMax * U.clamp((ctx.coverage || 0) / 0.5, 0, 1);
    const target = U.interp(CFG.growth.popCurve, year + 1 / 12) * boost;
    const targetNow = U.interp(CFG.growth.popCurve, year) * boost;
    let dP = (target - targetNow) * egp + 0.04 * (targetNow - tot.pop);
    dP = Math.max(dP, -0.002 * tot.pop);
    const tJ = target * U.interp(CFG.growth.jobsRatio, year + 1 / 12) * ejf;
    let dJ = (tJ - tot.jobs) * 0.12 + Math.max(0, dP) * U.interp(CFG.growth.jobsRatio, year) * 0.3;
    dJ = Math.max(dJ, -0.002 * tot.jobs);
    const eraMul = year < 2000 ? 0.8 : (year < 2010 ? 0.8 + 0.2 * (year - 2000) / 10 : Math.min(1.15, 1 + 0.15 * (year - 2010) / 20));
    const wR = new Float32Array(N), wJ = new Float32Array(N), capR = new Float32Array(N), capJ = new Float32Array(N);
    let sR = 0, sJ = 0;
    const mi = ctx.monthIndex;
    // 可达项口径：'walk' 用步行到站距离三档（现状）；'jobAccess' 用「45 分钟内可达岗位数」的相对档位。
    // 后者才是「人往通勤方便的地方去」——它对「远但快」的走廊给高分，而不是只奖励离站近。
    const GR = CM.GROWTH_ACCESS || {};
    const jaOn = !!(ctx.jobAccess && GR.from === 'jobAccess');
    const ja = jaOn ? ctx.jobAccess : null;
    const jb = GR.bands || [1.5, 1, 0.6];
    let jaMean = 1;
    if (jaOn) {
      let sum = 0, n = 0;
      for (let z = 0; z < ja.length; z++) if (ja[z] > 0) { sum += ja[z]; n++; }
      if (n > 0 && sum > 0) jaMean = sum / n;
    }
    // 增长归因（A8）：把本月的分项留下来给片区页解释「为什么这里长人（或不长）」。
    // 只读快照，不参与计算、不存档；why 里记的是这一格没参与增长的原因。
    const G = {
      mi: mi, year: year, dPop: 0, dJobs: 0,
      rem: new Float32Array(N), acc: new Float32Array(N), st: new Float32Array(N), nb: new Float32Array(N),
      far: new Float32Array(N), cap: new Float32Array(N), grew: new Float32Array(N), why: new Uint8Array(N),
    };
    for (let c = 0; c < N; c++) {
      const L = this.lu[c];
      if (L === LU.WATER || L === LU.HILL || L === LU.PARK || L === LU.AIRPORT || L === LU.LANDMARK) { G.why[c] = 1; continue; }
      if (!this.regionOpen[this.region[c]]) { G.why[c] = 2; continue; }
      const lf = this.landFrac[c] * (1 - this.taken[c]);
      if (lf <= 0.05) { G.why[c] = 3; continue; }
      const P = L === LU.RURAL ? this.plan[c] : L;
      // 容积率联动（仅经营模式）：站点步行可达的区位允许更高强度的开发（现实中即 TOD 放宽容积率）。
      // 没有地价系统（自由建造 / 经营挑战）时 landAcc 为空，farK 恒为 1，容量与既有模式完全一致。
      const Ld = CFG.land;
      let farK = 1;
      // 可达项：优先用「通勤时间可达性」（ctx.accFar，经营模式每月按 T 分钟内可达岗位算出），
      // 否则退回「离站步行可达性」（this.landAcc，由 buildLandPrice 派生）。
      const accSrc = ctx.accFar ? ctx.accFar[c] : (this.landAcc ? this.landAcc[c] : 0);
      if (accSrc && Ld && Ld.farGain > 0) {
        // 2% 门限：没有站点时 exp(−∞) 会留 0.002 量级的浮点残差，不能让它给全图普涨
        if (accSrc > 1.02) farK = 1 + Ld.farGain * Math.min(1, (accSrc - 1) / (Ld.accessGain || 0.7));
        // 地价惩罚：同等可达性下，地价越高于中位，越盖不动（拆迁、审批、地租）
        if (ctx.priceK) farK *= ctx.priceK[c];
      }
      let cr = resCap(P) * eraMul * lf * farK, cj = jobCap(P, this.regions[this.region[c]].plan) * eraMul * lf * farK;
      // 既有数据的核心区人口本来就高于 resCap 口径（老城密度远超新区基准），这些格子会因剩余容量为负而
      // 永远停止增长。TOD 加密的意义正是把它们重新松开，所以站点周边按现有人口兜底。
      if (farK > 1) { if (cr < this.pop[c]) cr = this.pop[c]; if (cj < this.jobs[c]) cj = this.jobs[c]; }
      // 上盖带来的额外容量：住宅部分计入人口容量（会产生出行），商业部分计入岗位容量
      capR[c] = cr + (this.devPop ? this.devPop[c] : 0);
      capJ[c] = cj + (this.devJobs ? this.devJobs[c] : 0);
      const i = c % W, j = (c / W) | 0;
      let nb = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < W && jj < this.H && this.street[jj * W + ii]) nb++;
      }
      nb /= 8;
      const walk = ctx.cellWalk ? ctx.cellWalk[c] : Infinity;
      let st = walk < 500 ? 1 : (walk < 850 ? 0.55 : (walk < 1125 ? 0.22 : 0));
      if (jaOn) {
        const r = ja[this.zoneOf(c)] / jaMean;
        st = r >= jb[0] ? 1 : (r >= jb[1] ? 0.55 : (r >= jb[2] ? 0.22 : 0));
      }
      const acc = ctx.zoneAccess ? ctx.zoneAccess[this.zoneOf(c)] : 0.3;
      let seed = 1;
      if (!this.street[c]) {
        if (nb < 0.2 && st === 0 && !this.nearArt[c]) { G.why[c] = 4; continue; }
        seed = 0.35 + (this.nearArt[c] ? 0.3 : 0);
      }
      const rnd = 0.6 + 0.8 * U.hash2(c, mi, this.seed + 31);
      const remR = cr - this.pop[c], remJ = cj - this.jobs[c];
      if (remR <= 0) G.why[c] = 5;   // 已饱和：容量用尽，修地铁放宽容积率才会重新松开
      G.rem[c] = remR > 0 ? remR : 0; G.acc[c] = acc; G.st[c] = st; G.nb[c] = nb; G.far[c] = farK; G.cap[c] = cr;
      if (remR > 0) { wR[c] = remR * (0.25 + acc) * (1 + 1.6 * st) * (0.3 + nb) * rnd * seed; sR += wR[c]; }
      if (remJ > 0) {
        const comBoost = (P === LU.COM || P === LU.MIX) ? 2.0 * ecom : 1;
        wJ[c] = remJ * (0.2 + acc * 1.2) * (1 + 1.6 * st * comBoost) * (0.3 + nb) * rnd * seed; sJ += wJ[c];
      }
    }
    const changed = [];
    const add = (arr, cap, w, s, d) => {
      if (d > 0 && s > 0) {
        let left = d;
        for (let pass = 0; pass < 2 && left > 1; pass++) {
          const k = left / s; let used = 0, s2 = 0;
          for (let c = 0; c < N; c++) {
            if (w[c] <= 0) continue;
            const room = cap[c] - arr[c];
            const inc = Math.min(room, w[c] * k, Math.max(60, cap[c] * 0.05));
            if (inc > 0) { arr[c] += inc; used += inc; changed.push(c); }
            if (cap[c] - arr[c] > 1) s2 += w[c]; else w[c] = 0;
          }
          left -= used; s = s2;
          if (s <= 0) break;
        }
      } else if (d < 0) {
        let tot2 = 0; for (let c = 0; c < N; c++) tot2 += arr[c];
        const f = 1 + d / Math.max(1, tot2);
        for (let c = 0; c < N; c++) arr[c] *= f;
      }
    };
    const pop0 = Float32Array.from(this.pop);
    add(this.pop, capR, wR, sR, dP);
    add(this.jobs, capJ, wJ, sJ, dJ);
    for (let c = 0; c < N; c++) G.grew[c] = this.pop[c] - pop0[c];
    G.dPop = dP; G.dJobs = dJ;
    this.growth = G;
    let newUrban = 0, streetsChanged = false;
    const seen = new Set();
    // 工地（只用于画面上的塔吊，不参与模拟、不存档）：新城市化或明显加高的街区，记录开工月份
    const sites = this.sites || (this.sites = new Map());
    for (const [c, m0] of sites) if (mi - m0 > 24) sites.delete(c);
    for (const c of changed) {
      if (seen.has(c)) continue; seen.add(c);
      if (!this.street[c] && this.pop[c] + this.jobs[c] > 160) {
        this.street[c] = 1; this.urbanYear[c] = Math.floor(year);
        if (this.lu[c] === LU.RURAL) this.lu[c] = this.plan[c] === LU.PARK ? LU.RES : this.plan[c];
        newUrban++; streetsChanged = true; this.dirty.add(c); sites.set(c, mi);
      }
      const nh = this.heightFor(c, year);
      if (nh > this.bh[c] * 1.12 + 1) { if (nh - this.bh[c] >= 6) sites.set(c, mi); this.bh[c] = nh; this.dirty.add(c); }
    }
    if (streetsChanged) { this.updateStreets(); }
    if (changed.length) this.version++;
    return { dPop: dP, dJobs: dJ, newUrban: newUrban, streetsChanged: streetsChanged };
  };
  function resCap(L) {
    switch (L) { case LU.RES: return 3000; case LU.MIX: return 2200; case LU.COM: return 600; case LU.IND: return 160; case LU.INST: return 700; default: return 300; }
  }
  function jobCap(L, plan) {
    switch (L) {
      case LU.COM: return plan === 'cbd' ? 12500 : 8000;
      case LU.MIX: return 3500; case LU.IND: return 1900; case LU.INST: return 1600; case LU.RES: return 450; default: return 150;
    }
  }

  // 地铁设施拆迁：按比例减少用地
  City.prototype.demolish = function (c, frac) {
    if (c < 0 || frac <= 0) return;
    const f = U.clamp(frac, 0, 1 - this.taken[c]);
    if (f <= 0) return;
    const keep = 1 - f / Math.max(0.05, 1 - this.taken[c]);
    this.pop[c] *= keep; this.jobs[c] *= keep;
    this.taken[c] += f;
    this.dirty.add(c);
    this.version++;
  };

  // ---------------- 存档 ----------------
  City.prototype.serialize = function () {
    return {
      seed: this.seed,
      pop: U.packTyped(this.pop, 'f32'), jobs: U.packTyped(this.jobs, 'f32'), bh: U.packTyped(this.bh, 'f32'),
      taken: U.packTyped(this.taken, 'f32'), lu: U.packTyped(this.lu, 'u8'), street: U.packTyped(this.street, 'u8'),
      urbanYear: U.packTyped(this.urbanYear, 'u16'),
      regionOpen: Array.from(this.regionOpen), regionOpenDate: this.regionOpenDate,
      landmarkOn: Array.from(this.landmarkOn),
    };
  };
  City.prototype.restore = function (s, year) {
    const N = this.N;
    const chk = function (a, n) { if (a.length !== n) throw new Error('城市数据尺寸不符'); return a; };
    this.pop = chk(U.unpackTyped(s.pop), N); this.jobs = chk(U.unpackTyped(s.jobs), N); this.bh = chk(U.unpackTyped(s.bh), N);
    this.taken = chk(U.unpackTyped(s.taken), N); this.lu = chk(U.unpackTyped(s.lu), N); this.street = chk(U.unpackTyped(s.street), N);
    this.urbanYear = chk(U.unpackTyped(s.urbanYear), N);
    this.regionOpen = Uint8Array.from(s.regionOpen); this.regionOpenDate = s.regionOpenDate;
    this.landmarkOn = new Uint8Array(D.landmarks.length);
    this.protectedId.fill(0);
    const on = s.landmarkOn || [];
    for (let k = 0; k < D.landmarks.length; k++) {
      if (!on[k]) continue;
      this.landmarkOn[k] = 1;
      for (const c of this.landmarkCells(D.landmarks[k])) if (this.lu[c] === LU.LANDMARK || (D.landmarks[k].kind === 'campus' && this.lu[c] !== LU.WATER)) this.protectedId[c] = k + 1;
    }
    this.applyReclaim(year, true);   // 历史海岸线恢复到存档年份（用地已从存档恢复）
    this.eArt.fill(0); this.eName.fill(0); this.roadsBuilt.fill(0);
    this.applyRoads(year);
    this.updateStreets();
    this.buildGraphs();
    this.version++;
    for (let c = 0; c < N; c++) this.dirty.add(c);
  };
})(window.CM);
