'use strict';
// 交通模拟：小区与重要设施的分目的出行需求（重力模型）→ 步行接驳与地铁路径 → 汽车/地铁方式选择（Logit）→ 道路分配与拥堵（BPR + MSA）
// 地铁运力按客流自动调整；所有计算分时段进行，并以时间切片方式运行，保证画面流畅。
// v1.9：出行分为通勤、上学、购物、医疗、旅游休闲与交通枢纽接驳六类；重要设施作为独立的目的地节点（自有位置与步行接驳），
// 普通设施按小区用地汇总；工作日与周末分别求解（两套各 4 个时段），实时交通按当天类型显示，日均指标按 5:2 加权。
(function (CM) {
  const U = CM.U, CFG = CM.CFG, M = CM.Metro;
  const NP = 4;
  const INF = 1e30;
  const PK = ['hw', 'sc', 'sh', 'md', 'lz', 'hb'], NPK = 6;
  const HW = 0, SH = 2, LZ = 4, HB = 5;
  const DT = ['wd', 'we'];

  // 收敛判据的容差。以前要求「逐位相等」：MSA 每轮用 0.4 的权重把流量往新解推，
  // 浮点值几乎不可能完全重合 —— 大图（2880 小区）上跑 40 秒、30 个时段都凑不出一个稳定轮，
  // 后台求解于是永不停止。改为相对变化小于 EPS 即视为稳定（行业惯例是相对间隙 1e-3~1e-2）。
  const EPS = 0.01;
  // 懒分配：车行时间变化小于 0.5% 就沿用上一轮的最短路（多数月份都满足），最多连懒 3 轮
  const LAZY_EPS = 0.01, LAZY_FRAC = 0.02, LAZY_MAX = 3;
  const eq = function (a, b) { return Math.abs(a - b) <= EPS * (Math.abs(b) + 1); };
  // 地铁相关的统计量：夜间时段只运营到 24 时（按 0.9 折算）
  const METRO_KEYS = new Set(['metro', 'fare', 'metroPkm', 'metroTime', 'mHW', 'mSC', 'mSH', 'mMD', 'mLZ', 'mHB', 'indM']);
  const TKEY = ['tHW', 'tSC', 'tSH', 'tMD', 'tLZ', 'tHB'], MKEY = ['mHW', 'mSC', 'mSH', 'mMD', 'mLZ', 'mHB'];
  CM.TRIP_KEYS = PK;

  // Keep the hot shortest-path loop outside the yielding orchestration. This is
  // the same binary heap, relaxation order and numeric precision as before.
  function roadTree(road, rd, time, origin, work, heap) {
    const dist = work.dist, dkm = work.dkm, pred = work.pred, order = work.order, tolA = work.tolA;
    const start = rd.start, node = rd.nodes, initial = rd.times, km = rd.km;
    // 路径惰性容差：只有比当前路径短出「这段路自己该有的容差」，才换父弧。
    // 容差按**路段长度**给（分钟/公里），沿路径累加。路网是已知的，路口到路口的长度就在 arcKm 里，
    // 所以「一段 10 km 的路多走 3 分钟」和「一段 250 m 的路多走 0.08 分钟」是同一件事 ——
    // 这就是 1 km 走 15 分钟与 10 km 走 15 分钟意义不同的地方：同样多 1 分钟，短路段是「慢了」，
    // 长路段只是「路上多耗了一点」。老做法每跳给固定分钟数，等于让容差取决于地图把路切成多少个路口
    // （加密一处路口，那一段的容差就翻倍），跟路程本身没关系。
    const tolKm = (CFG.road && CFG.road.routeTolKm) || 0;
    const tol0 = (CFG.road && CFG.road.routeTol) || 0;
    const outStart = road.outStart, outArc = road.outArc, arcTo = road.arcTo, arcKm = rd.arcKm;
    dist.fill(INF); tolA.fill(0); heap.clear();
    // Each directed arc can relax once after its source is settled. Reserve the
    // queue once, then keep its size local to avoid millions of property writes.
    // 定长数组 + fill() 会得到 holey-double，V8 每次读写都要查 hole；用定长 typed array 更快且数值完全一致
    const keys = work.heapK || (work.heapK = new Float64Array(road.nA + 4));
    const values = work.heapV || (work.heapV = new Int32Array(road.nA + 4));
    let count = 0;
    for (let k = start[origin]; k < start[origin + 1]; k++) {
      const v = node[k], t = initial[k];
      if (t < dist[v]) {
        dist[v] = t; dkm[v] = km[k]; pred[v] = -1;
        tolA[v] = tol0 + tolKm * km[k];
        let i = count++;
        while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= t) break; keys[i] = keys[p]; values[i] = values[p]; i = p; }
        keys[i] = t; values[i] = v;
      }
    }
    let no = 0;
    while (count) {
      const u = values[0], du = keys[0], n = --count;
      heap.lastKey = du;
      if (n > 0) {
        const key = keys[n], val = values[n];
        let i = 0;
        for (;;) {
          const left = i * 2 + 1; if (left >= n) break;
          const right = left + 1, child = right < n && keys[right] < keys[left] ? right : left;
          if (keys[child] >= key) break;
          keys[i] = keys[child]; values[i] = values[child]; i = child;
        }
        keys[i] = key; values[i] = val;
      }
      if (du > dist[u]) continue;
      order[no++] = u;
      for (let k = outStart[u]; k < outStart[u + 1]; k++) {
        const a = outArc[k], v = arcTo[a], nd = du + time[a];
        // 这一跳的容差 = 基础容差 + 长度 × 每分钟每公里；累加到父节点的容差上。
        const dv = dist[v], ta = tolA[u] + tol0 + tolKm * arcKm[a];
        if (nd < dv - ta) {
          dist[v] = nd; dkm[v] = dkm[u] + arcKm[a]; pred[v] = a; tolA[v] = ta;
          let i = count++;
          while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= nd) break; keys[i] = keys[p]; values[i] = values[p]; i = p; }
          keys[i] = nd; values[i] = v;
        }
      }
    }
    return no;
  }

  // 单个起点：最短路树、汽车行程时间（skim）与汽车流量回溯到路段（与此前在求解循环中内联的计算完全相同）；
  // 返回本起点的行程时间是否与上次完全相同（chk 为 false 时不比较）
  function carOrigin(cw, o, chk, group, sink) {
    const road = cw.road, rd = cw.rd, work = cw.work, Z = cw.Z, skT = cw.skT, skK = cw.skK, carDem = cw.carDem;
    const dist = work.dist, dkm = work.dkm, pred = work.pred, order = work.order, accN = work.accN, aux = work.aux, arcFrom = road.arcFrom;
    const connStart = rd.start, connNode = rd.nodes, connTime = rd.times, connKm = rd.km, zones = rd.zones;
    const no = roadTree(road, rd, cw.time, o, work, cw.heap);
    const row = o * Z;
    // group：cycle 0 里 8 个时段的车行时间逐位相同，树也是同一棵。这里把树打包存下来
    // （node 与入弧各占 16 位）、把每个目的地的接驳点存下来，后面的时段直接复用。
    const bnArr = group ? group.bn : null;
    if (group) {
      const base = o * group.nN, tree = group.tree;
      for (let q = 0; q < no; q++) { const n = order[q]; tree[base + q] = n | ((pred[n] + 1) << 16); }
      group.cnt[o] = no;
    }
    // 跨月缓存：只存弧号（按回溯顺序），节点号可以由弧号反推，所以不必存
    if (sink) {
      const a = new Int16Array(no);
      for (let q = 0; q < no; q++) a[no - 1 - q] = pred[order[q]];
      sink[o] = { no: no, arcs: a };
    }
    let same = chk;
    for (let zi = 0; zi < zones.length; zi++) {
      const d = zones[zi];
      if (d === o) continue;
      let best = INF, bk = 0, bn = -1;
      for (let k = connStart[d]; k < connStart[d + 1]; k++) { const node = connNode[k], v = dist[node] + connTime[k]; if (v < best) { best = v; bk = dkm[node] + connKm[k]; bn = node; } }
      if (bn < 0 || best >= INF) continue;
      const oldT = same ? skT[row + d] : 0, oldK = same ? skK[row + d] : 0;
      skT[row + d] = best; skK[row + d] = bk;
      if (bnArr) bnArr[row + d] = bn;
      if (same && (oldT !== skT[row + d] || oldK !== skK[row + d])) same = false;
      const dem = carDem[row + d];
      if (dem > 0) accN[bn] += dem;
    }
    for (let q = no - 1; q >= 0; q--) {
      const n = order[q], a = accN[n];
      if (a > 0) { const e = pred[n]; if (e >= 0) { aux[e] += a; accN[arcFrom[e]] += a; } accN[n] = 0; }
    }
    return same;
  }

  // 复用参考时段的最短路树：skim 直接照抄（同一棵树、同一组连接边，算出来逐位相同），
  // 只按本时段的需求做接驳点注入与树上回溯。遍历顺序与原实现一致（目的地按小区序号升序、
  // 回溯按 settle 逆序），所以 aux 的累加顺序也一致 —— 结果与重新建树逐位相同。
  function carOriginReuse(cw, group, o, sink) {
    const road = cw.road, Z = cw.Z, carDem = cw.carDem, aux = cw.work.aux, accN = cw.work.accN;
    const row = o * Z;
    cw.skT.set(group.refT.subarray(row, row + Z), row);
    cw.skK.set(group.refK.subarray(row, row + Z), row);
    const bnArr = group.bn, tree = group.tree, arcFrom = road.arcFrom;
    for (let d = 0; d < Z; d++) {
      const b = bnArr[row + d];
      if (b < 0) continue;
      const dem = carDem[row + d];
      if (dem > 0) accN[b] += dem;
    }
    const base = o * group.nN, cnt = group.cnt[o];
    if (sink) {
      // 这一个 cycle 里 8 个时段共用同一棵树，所以 8 个时段都记同一份（跨月缓存首次填充就靠它）
      const a = new Int16Array(cnt);
      for (let q = 0; q < cnt; q++) a[cnt - 1 - q] = ((tree[base + q] >>> 16) - 1);
      sink[o] = { no: cnt, arcs: a };
    }
    for (let q = cnt - 1; q >= 0; q--) {
      const packed = tree[base + q], n = packed & 0xffff, e = (packed >>> 16) - 1;
      const a = accN[n];
      if (a > 0) { if (e >= 0) { aux[e] += a; accN[arcFrom[e]] += a; } accN[n] = 0; }
    }
  }

  // 跨月复用：树来自上个月（可能已按顶点对重映射过）。距离用**当前**的车行时间沿旧路径累加，
  // 所以 skim 反映的是当前拥堵，只有「路径怎么走」沿用上个月。被标成 -2 的失效子树连同后代
  // 一起缺席（父节点 dist = Infinity 会自然传染），其余部分照常注入与回溯。
  function carOriginReplay(cw, tr, o, chk) {
    const road = cw.road, rd = cw.rd, work = cw.work, Z = cw.Z, skT = cw.skT, skK = cw.skK, carDem = cw.carDem;
    const time = cw.time;
    const dist = work.dist, dkm = work.dkm, accN = work.accN, aux = work.aux;
    const arcFrom = road.arcFrom, arcTo = road.arcTo, arcKm = rd.arcKm;
    const connStart = rd.start, connNode = rd.nodes, connTime = rd.times, connKm = rd.km, zones = rd.zones;
    const A = tr.arcs, no = tr.no;
    dist.fill(INF);
    for (let k = connStart[o]; k < connStart[o + 1]; k++) {
      const v = connNode[k], t = connTime[k];
      if (t < dist[v]) { dist[v] = t; dkm[v] = connKm[k]; }
    }
    // 存的是回溯顺序（深→浅），反过来遍历就是 settle 正序：父节点一定先算好。
    // 这是拓扑性质，换成新的时间也成立，所以 dist 与重新建树逐位相同（同一组弧、同一组时间）。
    for (let i = no - 1; i >= 0; i--) {
      const e = A[i];
      if (e < 0) continue;
      const n = arcTo[e], p = arcFrom[e];
      dist[n] = dist[p] + time[e];
      dkm[n] = dkm[p] + arcKm[e];
    }
    const row = o * Z;
    let same = chk;
    for (let zi = 0; zi < zones.length; zi++) {
      const d = zones[zi];
      if (d === o) continue;
      let best = INF, bk = 0, bn = -1;
      for (let k = connStart[d]; k < connStart[d + 1]; k++) {
        const nd = connNode[k], v = dist[nd] + connTime[k];
        if (v < best) { best = v; bk = dkm[nd] + connKm[k]; bn = nd; }
      }
      if (bn < 0 || best >= INF) continue;
      const oldT = same ? skT[row + d] : 0, oldK = same ? skK[row + d] : 0;
      skT[row + d] = best; skK[row + d] = bk;
      if (same && (oldT !== best || oldK !== bk)) same = false;
      const dem = carDem[row + d];
      if (dem > 0) accN[bn] += dem;
    }
    for (let i = 0; i < no; i++) {
      const e = A[i];
      if (e < 0) continue;
      const n = arcTo[e], a = accN[n];
      if (a > 0) { aux[e] += a; accN[arcFrom[e]] += a; accN[n] = 0; }
    }
    // 根（pred = -1 的种子）也要清账，否则会漏到下一个起点
    for (let k = connStart[o]; k < connStart[o + 1]; k++) accN[connNode[k]] = 0;
    return same;
  }

  // 单个起点的方式选择与统计：对起点 i 的每条需求记录，先算去程（i → j）再算返程（j → i）。
  // 汽车广义成本、最优接驳车站对（同一迭代内缓存胜出的组合）、Logit 地铁选择、新增购物 / 休闲出行（有上限），
  // 并按顺序累加全网统计（S、分目的 pT / pM）、小区与设施的吸引统计、期望线与汽车需求。
  // 需要的数组一次性读入局部变量；运算与累加顺序固定，结果与逐次调用完全相同
  function odOrigin(K, i) {
    const Z = K.Z, NZ = K.NZ, N = K.N, B = K.B;
    const odStart = K.odStart, odDest = K.odDest, t0 = K.t0, t1 = K.t1, t2 = K.t2, t3 = K.t3, t4 = K.t4, t5 = K.t5;
    const co = K.co, cr = K.cr, cO = K.cO, cR = K.cR, facW = K.facW, facWe = K.facWe, odOk = K.odOk;
    const hostZ = K.hostZ, nx = K.nx, ny = K.ny, skT = K.skT, skK = K.skK, kmPerCell = K.kmPerCell;
    const cpk = K.cpk, park = K.park, vot = K.vot, carAccess = K.carAccess, walkW = K.walkW, occ = K.occ, theta = K.theta, fareFlat = K.fareFlat;
    const acc = K.acc, accOk = K.accOk, zCov = acc ? acc.zCov : null, zl = acc ? acc.zl : null, choices = K.choices;
    const gtS = K.gtS, tmS = K.tmS, kmS = K.kmS, DS = K.DS, perMin = K.perMin, capSh = K.capSh, capLz = K.capLz;
    const carDem = K.carDem, hasCar = K.hasCar, S = K.S, pT = K.pT, pM = K.pM;
    const zTrips = K.zTrips, zMetro = K.zMetro, zAccess = K.zAccess, zJ = K.zJ, blocks = K.blocks, desTot = K.desTot, desMetro = K.desMetro;
    const zDest = K.zDest, zDestM = K.zDestM, fIn = K.fIn, fInM = K.fInM, fOut = K.fOut, fOutM = K.fOutM, fP = K.fP;
    for (let k = odStart[i]; k < odStart[i + 1]; k++) {
      const j = odDest[k];
      if (j >= Z && !odOk) continue;
      const fw = j >= Z && facW ? facWe[j - Z] : 1;
      let F1 = 0, F2 = 0, v;
      v = t0[k]; if (v) { const a = v * co[0] * fw, b = v * cr[0] * fw; cO[0] = a; cR[0] = b; F1 += a; F2 += b; } else { cO[0] = 0; cR[0] = 0; }
      v = t1[k]; if (v) { const a = v * co[1] * fw, b = v * cr[1] * fw; cO[1] = a; cR[1] = b; F1 += a; F2 += b; } else { cO[1] = 0; cR[1] = 0; }
      v = t2[k]; if (v) { const a = v * co[2] * fw, b = v * cr[2] * fw; cO[2] = a; cR[2] = b; F1 += a; F2 += b; } else { cO[2] = 0; cR[2] = 0; }
      v = t3[k]; if (v) { const a = v * co[3] * fw, b = v * cr[3] * fw; cO[3] = a; cR[3] = b; F1 += a; F2 += b; } else { cO[3] = 0; cR[3] = 0; }
      v = t4[k]; if (v) { const a = v * co[4] * fw, b = v * cr[4] * fw; cO[4] = a; cR[4] = b; F1 += a; F2 += b; } else { cO[4] = 0; cR[4] = 0; }
      v = t5[k]; if (v) { const a = v * co[5] * fw, b = v * cr[5] * fw; cO[5] = a; cR[5] = b; F1 += a; F2 += b; } else { cO[5] = 0; cR[5] = 0; }
      for (let dir = 0; dir < 2; dir++) {
        const isOut = dir === 0, o = isOut ? i : j, d = isOut ? j : i, F0 = isOut ? F1 : F2, comp = isOut ? cO : cR;
        if (F0 <= 0) continue;
        const ho = hostZ[o], hd = hostZ[d];
        let ct = skT[ho * Z + hd], ck = skK[ho * Z + hd];
        if (!(ct > 0) || ct >= INF) { const straight = U.dist(nx[o], ny[o], nx[d], ny[d]) * kmPerCell * 1.3; ct = straight / 16 * 60 + 3; ck = straight; }
        const carMoney = ck * cpk + park;
        const gtCar = ct + carAccess + carMoney / vot * 60;
        let mTime = 0, fare = 0, mKm = 0, bs = -1, bt = -1, q = 0, pMc = 0;
        let gtBest = gtCar, ind = 0, indSh = 0, indLz = 0;
        if (acc && (accOk || (o < Z && d < Z))) {
          const fo = zCov[o] || 0, fd = zCov[d] || 0;
          const lo = zl[o], ld = zl[d];
          if (fo > 0 && fd > 0 && lo && ld) {
            let best = INF, bw = 0;
            const pair = o * NZ + d, cached = choices[pair];
            let winner = -1;
            if (cached >= 0) {
              const A = lo[cached >> 2], Bq = ld[cached & 3];
              bs = A.s; bt = Bq.s; bw = A.w + Bq.w;
              best = walkW * bw + gtS[bs * N + bt];
            } else if (cached === -2) for (let a = 0; a < lo.length; a++) {
              const A = lo[a], row = A.s * N;
              for (let b = 0; b < ld.length; b++) {
                const Bq = ld[b];
                if (A.s === Bq.s) continue;
                const g = gtS[row + Bq.s];
                if (g >= INF) continue;
                const w = walkW * (A.w + Bq.w) + g;
                if (w < best) { best = w; bs = A.s; bt = Bq.s; bw = A.w + Bq.w; winner = (a << 2) | b; }
              }
            }
            if (cached === -2) choices[pair] = winner;
            if (bs >= 0) {
              mKm = kmS[bs * N + bt];
              fare = fareFlat;
              const gtM = best + fare / vot * 60;
              pMc = 1 / (1 + Math.exp(theta * (gtM - gtCar)));
              q = fo * fd * pMc;
              mTime = bw + tmS[bs * N + bt];
              if (gtM < gtBest) gtBest = gtM;
              // 地铁改善可达性带来的新增购物、休闲出行（Logit 组合效用的改善，按覆盖比例折算；有上限）
              if (comp[SH] > 0 || comp[LZ] > 0) {
                const x = theta * (gtCar - gtM);
                const gain = fo * fd * (x > 30 ? x : Math.log1p(Math.exp(x))) / theta;
                const r = gain * perMin;
                indSh = comp[SH] * Math.min(capSh, r); indLz = comp[LZ] * Math.min(capLz, r); ind = indSh + indLz;
              }
            }
          }
        }
        const metroB = F0 * q, indM = ind * pMc;
        const F = F0 + ind, metro = metroB + indM;
        if (metro > 0) DS[bs * N + bt] += metro;
        const car = F - metro;
        if (car > 0) { carDem[ho * Z + hd] += car / occ; hasCar[ho] = 1; }
        S[0] += F; S[1] += metro; S[2] += car;
        const tCar = ct + carAccess * 0.5;
        S[3] += car * tCar + metro * mTime;
        S[4] += car * tCar; S[5] += metro * mTime;
        S[6] += metro * fare; S[7] += metro * mKm; S[8] += car * ck; S[9] += car / occ * ck;
        const cw = comp[HW] / F0;
        if (cw > 0) { S[10] += comp[HW]; S[11] += ((F0 - metroB) * tCar + metroB * mTime) * cw; }
        for (let p = 0; p < NPK; p++) { const c = comp[p]; if (c) { pT[p] += c; pM[p] += c * q; } }
        if (ind > 0) { pT[SH] += indSh; pT[LZ] += indLz; pM[SH] += indSh * pMc; pM[LZ] += indLz * pMc; S[12] += ind; S[13] += indM; }
        zTrips[ho] += F; zMetro[ho] += metro;
        if (o < Z && d < Z) zAccess[o] += zJ[d] * Math.exp(-gtBest / 30);
        const key = blocks[ho] * B + blocks[hd];
        desTot[key] += F; desMetro[key] += metro;
        // 吸引统计：去程按目的地计（小区按目的，重要设施单独计）；设施的返程（离开设施）单独计
        if (isOut) {
          if (d < Z) {
            for (let p = 0; p < NPK; p++) { const c = comp[p]; if (c) { zDest[p * Z + d] += c; zDestM[p * Z + d] += c * q; } }
            if (ind > 0) { zDest[SH * Z + d] += indSh; zDest[LZ * Z + d] += indLz; zDestM[SH * Z + d] += indSh * pMc; zDestM[LZ * Z + d] += indLz * pMc; }
          } else {
            const f = d - Z;
            fIn[f] += F; fInM[f] += metro;
            for (let p = 0; p < NPK; p++) if (comp[p]) fP[f * NPK + p] += comp[p];
            if (ind > 0) { fP[f * NPK + SH] += indSh; fP[f * NPK + LZ] += indLz; }
          }
        } else if (o >= Z) { const f = o - Z; fOut[f] += F; fOutM[f] += metro; }
      }
    }
  }

  // 地铁网络中从车站 s 出发的最短路树（广义成本），记录到各站的广义时间、实际时间与乘车里程，以及加载客流用的前驱与访问顺序
  function metroTree(net, cost, tAct, s, work, store, heap, tpen) {
    const N = net.N, nn = net.nNodes, outStart = net.outStart, outEdge = net.outEdge, eTo = net.eTo, eKm = net.eKm;
    const gt = store.gt, tm = store.tm, km = store.km, pred = store.pred, order = store.order, nOrd = store.nOrd;
    const dist = work.dist, dtm = work.dtm, dkm = work.dkm;
    dist.fill(INF);
    heap.clear();
    dist[s] = 0; dtm[s] = 0; dkm[s] = 0;
    const pb = s * nn;
    pred[pb + s] = -1;
    heap.push(0, s);
    let no = 0;
    while (heap.n) {
      const u = heap.pop(), du = heap.lastKey;
      if (du > dist[u]) continue;
      order[pb + no++] = u;
      for (let k = outStart[u]; k < outStart[u + 1]; k++) {
        const e = outEdge[k], v = eTo[e], nd = du + cost[e];
        if (nd < dist[v]) { dist[v] = nd; dtm[v] = dtm[u] + tAct[e]; dkm[v] = dkm[u] + eKm[e]; pred[pb + v] = e; heap.push(nd, v); }
      }
    }
    nOrd[s] = no;
    const ob = s * N;
    for (let t = 0; t < N; t++) {
      // 至少包含一段实际乘车（乘车里程 > 0）；只靠站外步行连通的路径不算地铁行程
      if (dist[t] >= INF || t === s || !(dkm[t] > 0)) { gt[ob + t] = INF; continue; }
      gt[ob + t] = dist[t] - tpen; tm[ob + t] = dtm[t]; km[ob + t] = dkm[t];
    }
  }
  // 从车站 s 出发的客流沿最短路树回溯到各区间（与此前内联的计算相同）；返回该站是否有客流
  function metroLoadFrom(net, store, s, work) {
    const N = net.N, nn = net.nNodes, D = store.D, order = store.order, pred = store.pred, eFrom = net.eFrom;
    const load = work.load, accN = work.accN, stIn = work.stIn, stOut = work.stOut;
    const row = s * N;
    let any = false;
    for (let tt = 0; tt < N; tt++) { const v = D[row + tt]; if (v > 0) { accN[tt] += v; stIn[s] += v; stOut[tt] += v; any = true; } }
    if (!any) return false;
    const pb = s * nn;
    for (let q = store.nOrd[s] - 1; q > 0; q--) {
      const n = order[pb + q];
      const a = accN[n];
      if (a > 0) { const e = pred[pb + n]; if (e >= 0) { load[e] += a; accN[eFrom[e]] += a; } accN[n] = 0; }
    }
    accN[s] = 0;
    return true;
  }
  // 需求表的输出缓冲区：目的地编号与六个目的的往返次数
  function odBuffer(cap) { return { cap: cap, dest: new Int32Array(cap), t: [0, 1, 2, 3, 4, 5].map(function () { return new Float32Array(cap); }) }; }
  function odGrow(b, n, cap) {
    const nb = odBuffer(cap);
    nb.dest.set(b.dest.subarray(0, n)); for (let q = 0; q < 6; q++) nb.t[q].set(b.t[q].subarray(0, n));
    return nb;
  }
  // 单个起点的分目的出行分布（生产约束重力模型）：小区按各目的的吸引与距离衰减，重要设施作为独立目的地；
  // 候选目的地取综合份额最高的 240 个小区与份额足够的设施，各目的在候选中按比例分配；最后加上枢纽接驳
  // 广义时间（分钟）：取小汽车与地铁中较优的那个。需求生成阶段用它代替直线距离，
  // 这样「40 km 的快线通勤」不会被判得比「12 km 的堵车」更远——睡城 OD 才有可能被生成。
  // 小汽车：优先用上一轮早高峰的 skim 行；缺失（首次求解、还没有网络）时按自由流估，与 odOrigin 的兜底一致。
  // 地铁：优先用小区接驳表 zl（每端最多 4 个站）与站间广义时间 gt；没有 skim 时按线路平均速度估。
  // o/d 可以是小区（0…Z−1）或重要设施（Z…Z+F−1），与 zl 的下标一致。
  function impMinutes(imp, o, d, distKm) {
    let t = distKm > 0 ? distKm * 1.3 / 16 * 60 + 3 : 0;
    if (imp.skT && o < imp.Z && d < imp.Z) {
      const v = imp.skT[o * imp.Z + d];
      if (v > 0 && v < 1e8) t = v;
    }
    const lo = imp.zl ? imp.zl[o] : null, ld = imp.zl ? imp.zl[d] : null;
    if (lo && ld && imp.gt && imp.N > 0) {
      let best = Infinity;
      for (let a = 0; a < lo.length; a++) {
        const A = lo[a], row = A.s * imp.N;
        for (let b = 0; b < ld.length; b++) {
          const B = ld[b];
          if (A.s === B.s) continue;
          const g = imp.gt[row + B.s];
          if (!(g < 1e8)) continue;
          const v = imp.walkW * (A.w + B.w) + g;
          if (v < best) best = v;
        }
      }
      if (best < Infinity) t = Math.min(t, best);
    } else if (imp.zCov && imp.zCov[o] > 0 && imp.zCov[d] > 0) {
      const acc = (imp.zWalk[o] || 0) + (imp.zWalk[d] || 0);
      t = Math.min(t, imp.walkW * acc + distKm / imp.railKmh * 60 + imp.wait);
    }
    return t;
  }

  function demandOrigin(D, i) {
    const Z = D.Z, F = D.F, A = D.A, Ls = D.Ls, fA = D.fA, fL = D.fL, rate = D.rate, rw = D.rw, zJobs = D.zJobs, zAsum = D.zAsum;
    const zCx = D.zCx, zCy = D.zCy, nx = D.nx, ny = D.ny, hostZ = D.hostZ, kmPerCell = D.kmPerCell;
    const facBus = D.facBus;
    const w = D.w, wf = D.wf, scores = D.scores, s = D.s, kk = D.kk, cand = D.cand, candF = D.candF, tot = D.tot, o = D.out;
    const dest = o.dest, c0 = o.t[0], c1 = o.t[1], c2 = o.t[2], c3 = o.t[3], c4 = o.t[4], c5 = o.t[5];
    const w0 = w[0], w1 = w[1], w2 = w[2], w3 = w[3], w4 = w[4], A0 = A[0], A1 = A[1], A2 = A[2], A3 = A[3], A4 = A[4];
    const imp = D.imp || null, TSc = imp ? D.Ts : null;
    const L0 = imp ? TSc[0] : Ls[0], L1 = imp ? TSc[1] : Ls[1], L2 = imp ? TSc[2] : Ls[2], L3 = imp ? TSc[3] : Ls[3], L4 = imp ? TSc[4] : Ls[4];
    let n = D.n;
    const P = D.zPop[i];
    if (P >= 20) {
      s.fill(0);
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
      const xi = zCx[i], yi = zCy[i];
      for (let j = 0; j < Z; j++) {
        if (j === i || (zJobs[j] < 5 && zAsum[j] < 5)) { w0[j] = 0; w1[j] = 0; w2[j] = 0; w3[j] = 0; w4[j] = 0; continue; }
        const dx = xi - zCx[j], dy = yi - zCy[j], dkm = Math.sqrt(dx * dx + dy * dy) * kmPerCell;
        const d = imp ? impMinutes(imp, i, j, dkm) : dkm;
        // 时间口径下超过 maxMin 的目的地直接不进入需求表（这才是「按时间截断」，而不是按直线距离砍）
        if (imp && !(d <= imp.maxMin)) { w0[j] = 0; w1[j] = 0; w2[j] = 0; w3[j] = 0; w4[j] = 0; continue; }
        let v;
        v = A0[j] > 0 ? A0[j] * Math.exp(-d / L0) : 0; w0[j] = v; s0 += v;
        v = A1[j] > 0 ? A1[j] * Math.exp(-d / L1) : 0; w1[j] = v; s1 += v;
        v = A2[j] > 0 ? A2[j] * Math.exp(-d / L2) : 0; w2[j] = v; s2 += v;
        v = A3[j] > 0 ? A3[j] * Math.exp(-d / L3) : 0; w3[j] = v; s3 += v;
        v = A4[j] > 0 ? A4[j] * Math.exp(-d / L4) : 0; w4[j] = v; s4 += v;
      }
      s[0] = s0; s[1] = s1; s[2] = s2; s[3] = s3; s[4] = s4;
      for (let k = 0; k < F; k++) {
        if (!fL[k] || hostZ[Z + k] === i) { for (let p = 1; p < 5; p++) wf[p][k] = 0; continue; }
        const dx = xi - nx[Z + k], dy = yi - ny[Z + k];
        let d = Math.sqrt(dx * dx + dy * dy) * kmPerCell;
        if (imp) d = impMinutes(imp, i, Z + k, d);
        // 接驳端点附近的小区，到设施的等效距离按「接驳 + 端点步行」算，比直线更近时替换。
        // 上盖商场就在站上（端点→设施 = 0），景区设施则是端点开到门口后再走几步。
        if (facBus) { const bv = facBus[k * Z + i]; if (bv < d) d = bv; }
        const e = Math.exp(-d / fL[k]);
        for (let p = 1; p < 5; p++) { const v = fA[p][k] * e; wf[p][k] = v; s[p] += v; }
      }
      let nc = 0, nf = 0;
      for (let j = 0; j < Z; j++) {
        let sh = 0;
        if (s[0] > 0) sh += rw[0] * w0[j] / s[0];
        if (s[1] > 0) sh += rw[1] * w1[j] / s[1];
        if (s[2] > 0) sh += rw[2] * w2[j] / s[2];
        if (s[3] > 0) sh += rw[3] * w3[j] / s[3];
        if (s[4] > 0) sh += rw[4] * w4[j] / s[4];
        if (sh > 0.0015) { scores[j] = sh; cand[nc++] = j; }
      }
      const cs = cand.subarray(0, nc);
      cs.sort(function (a, b) { return scores[b] - scores[a]; });
      if (nc > 240) nc = 240;
      for (let k = 0; k < F; k++) {
        let sh = 0; for (let p = 1; p < 5; p++) if (s[p] > 0) sh += rw[p] * wf[p][k] / s[p];
        if (sh > 0.0003) candF[nf++] = k;
      }
      kk.fill(0);
      for (let q = 0; q < nc; q++) { const j = cand[q]; kk[0] += w0[j]; kk[1] += w1[j]; kk[2] += w2[j]; kk[3] += w3[j]; kk[4] += w4[j]; }
      for (let q = 0; q < nf; q++) { const k = candF[q]; for (let p = 1; p < 5; p++) kk[p] += wf[p][k]; }
      const r0 = P * rate[0], r1 = P * rate[1], r2 = P * rate[2], r3 = P * rate[3], r4 = P * rate[4];
      for (let q = 0; q < nc; q++) {
        const j = cand[q];
        dest[n] = j;
        let v;
        v = kk[0] > 0 ? r0 * w0[j] / kk[0] : 0; c0[n] = v; tot[0] += v;
        v = kk[1] > 0 ? r1 * w1[j] / kk[1] : 0; c1[n] = v; tot[1] += v;
        v = kk[2] > 0 ? r2 * w2[j] / kk[2] : 0; c2[n] = v; tot[2] += v;
        v = kk[3] > 0 ? r3 * w3[j] / kk[3] : 0; c3[n] = v; tot[3] += v;
        v = kk[4] > 0 ? r4 * w4[j] / kk[4] : 0; c4[n] = v; tot[4] += v;
        c5[n] = 0; n++;
      }
      for (let q = 0; q < nf; q++) {
        const k = candF[q];
        dest[n] = Z + k; c0[n] = 0;
        let v;
        v = kk[1] > 0 ? r1 * wf[1][k] / kk[1] : 0; c1[n] = v; tot[1] += v;
        v = kk[2] > 0 ? r2 * wf[2][k] / kk[2] : 0; c2[n] = v; tot[2] += v;
        v = kk[3] > 0 ? r3 * wf[3][k] / kk[3] : 0; c3[n] = v; tot[3] += v;
        v = kk[4] > 0 ? r4 * wf[4][k] / kk[4] : 0; c4[n] = v; tot[4] += v;
        c5[n] = 0; n++;
      }
    }
    // 枢纽接驳：城市（小区 i）↔ 车站 / 机场
    for (let h = 0; h < D.hubs.length; h++) {
      const v = D.hubTours[h][i]; if (!(v > 0)) continue;
      dest[n] = Z + D.hubs[h]; c0[n] = 0; c1[n] = 0; c2[n] = 0; c3[n] = 0; c4[n] = 0; c5[n] = v; tot[5] += v; n++;
    }
    D.n = n;
  }

  // 日期 → 日类型（周六、周日为周末；节假日不单独模拟）
  Model.dayType = function (y, m, d) { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return w === 0 || w === 6 ? 'we' : 'wd'; };
  Model.DT_NAME = { wd: '工作日', we: '周末', avg: '周平均' };

  function Model(city) {
    this.city = city;
    this.ZW = CFG.W / CFG.ZONE; this.ZH = CFG.H / CFG.ZONE; this.Z = this.ZW * this.ZH;
    this.BW = Math.ceil(this.ZW / 2); this.BH = Math.ceil(this.ZH / 2); this.B = this.BW * this.BH;
    const norm = function (prof) { const s = prof.reduce(function (a, b) { return a + b; }, 0); return prof.map(function (v) { return v / s; }); };
    this.profiles = { wd: norm(CFG.hourProfile.slice()), we: norm((CFG.hourProfileWe || CFG.hourProfile).slice()) };
    this.hourPeriod = new Int8Array(24);
    this.pHours = []; this.pMeans = { wd: [], we: [] };
    const self = this;
    CFG.periods.forEach(function (pd, p) {
      pd.hours.forEach(function (h) { self.hourPeriod[h] = p; });
      self.pHours.push(pd.hours.length);
      for (const dt of DT) self.pMeans[dt].push(pd.hours.reduce(function (a, h) { return a + self.profiles[dt][h]; }, 0) / pd.hours.length);
    });
    this.dayType = 'wd'; this.profile = this.profiles.wd; this.pMean = this.pMeans.wd;
    this.year = CFG.START.y;
    this.fare = Object.assign({}, CFG.fareDefault);
    this.heap = new U.Heap(8192);
    this.zoneCells = [];
    const Z = CFG.ZONE;
    for (let z = 0; z < this.Z; z++) {
      const zi = z % this.ZW, zj = (z / this.ZW) | 0, arr = [];
      for (let j = zj * Z; j < zj * Z + Z; j++) for (let i = zi * Z; i < zi * Z + Z; i++) arr.push(j * CFG.W + i);
      this.zoneCells.push(Int32Array.from(arr));
    }
    this.zPop = new Float32Array(this.Z); this.zJobs = new Float32Array(this.Z); this.zAttr = new Float32Array(this.Z);
    this.zA = new Float32Array(4 * this.Z); this.zHub = new Float32Array(this.Z);
    this.zCx = new Float32Array(this.Z); this.zCy = new Float32Array(this.Z);
    this.road = city.car; this.roadVer = city.roadVersion;
    this.prepareRoad();
    this.arcZone = null; this.computeArcZones();
    this.fn = null;
    this.buildZones(); this.buildDemand();
    this.net = null;
    this.ctxs = { wd: this.newCtx(NP, 'wd'), we: this.newCtx(NP, 'we') };
    this.live = this.ctxs.wd;
    this.gen = null; this.predJob = null;
    this.liveBuf = {}; this.predBuf = {};
    this.cycles = 0; this.sinceChange = 0; this.version = 0;
    this.daily = null;
  }
  CM.Model = Model;

  Model.prototype.wake = function () {
    this.settled = false; this.quietCycles = 0; this.gen = null; this.solveCycles = 0;
    this.prebuilding = false;   // 进行中的月末预建随 gen 一起丢弃，缓存会保持 fresh = false
    // 输入变了：所有时段都不再「稳定」，否则下一轮会被当成无需重算而跳过
    this.invalidateStable();
  };
  Model.prototype.invalidateStable = function () {
    if (!this.ctxs) return;
    for (const dt of DT) { const cx = this.ctxs[dt]; if (cx && cx.per) for (const P of cx.per) P.stable = false; }
  };
  Model.prototype.setYear = function (y) { if (this.year !== y) this.wake(); this.year = y; this.capF = U.interp(CFG.road.capGrowth, y); };
  // 当天的日类型：实时画面（车流、客流、拥堵）与当天的票款使用对应的求解结果；两套结果都在后台保持收敛
  Model.prototype.setDayType = function (dt) {
    dt = dt === 'we' ? 'we' : 'wd';
    if (dt === this.dayType) return;
    this.dayType = dt; this.live = this.ctxs[dt]; this.profile = this.profiles[dt]; this.pMean = this.pMeans[dt];
    this.dailyNow = dt === 'we' ? this.dailyWe : this.dailyWk;
    this.version++;
  };
  Model.prototype.dailyFor = function (dt) { return dt === 'we' ? this.dailyWe : (dt === 'wd' ? this.dailyWk : this.daily); };
  // 当前通行能力（含系统道路改造增长）
  Model.prototype.cap = function (a) { return this.road.arcCap[a] * (this.capF || 1); };
  Model.prototype.params = function () {
    const c = CFG.choice, y = this.year;
    return {
      vot: U.interp(c.vot, y), cpk: U.interp(c.carCostPerKm, y), park: U.interp(c.parking, y), occ: U.interp(c.occupancy, y),
      theta: c.theta, walkW: c.walkW, waitW: c.waitW, tpen: c.transferPen, opn: c.outTransferPen, carAccess: c.carAccess,
    };
  };
  // 全网统一票价：与乘车里程无关，换乘不另收费
  Model.prototype.fareFor = function () { return this.fare.flat; };

  // ---------------- 重要设施节点 ----------------
  // 运营中的重要设施作为独立的目的地节点（编号 Z + k）：位置、场地格与步行接驳单独计算；道路行程按所在小区计算
  Model.prototype.buildFacNodes = function () {
    const city = this.city, Z = this.Z, Fac = CM.Fac;
    const all = Fac ? Fac.list() : [];
    const list = all.filter(function (f) { return Fac.active(f, this.year, city); }, this);
    const F = list.length, NZ = Z + F;
    const hostZ = new Int32Array(NZ), nx = new Float32Array(NZ), ny = new Float32Array(NZ);
    for (let z = 0; z < Z; z++) hostZ[z] = z;
    const cells = [], cellFac = new Map(), excl = new Uint8Array(city.N), we = new Float32Array(F);
    list.forEach(function (f, k) {
      const c0 = city.cellAt(f.x, f.y);
      hostZ[Z + k] = c0 >= 0 ? city.zoneOf(c0) : 0; nx[Z + k] = f.x; ny[Z + k] = f.y;
      const cs = Fac.siteCells(f, city); cells.push(Int32Array.from(cs));
      for (const c of cs) { let a = cellFac.get(c); if (!a) { a = []; cellFac.set(c, a); } a.push(k); if (f.lmK >= 0) excl[c] = 1; }
      we[k] = f.T.we || 1;
    });
    const key = list.map(function (f) { return f.id; }).join(',');
    if (this.fn && this.fn.key !== key) this.facDaily = null;
    this.fn = { F: F, NZ: NZ, list: list, ids: list.map(function (f) { return f.id; }), key: key, hostZ: hostZ, nx: nx, ny: ny, cells: cells, cellFac: cellFac, excl: excl, we: we };
    return this.fn;
  };
  Model.prototype.facIndex = function (id) { return this.fn ? this.fn.ids.indexOf(id) : -1; };

  // ---------------- 小区与需求 ----------------
  // 小区汇总：人口、岗位；普通设施的分目的吸引量（上学、购物、医疗、休闲，按用地与人口估算）；枢纽接驳的城市端权重。
  // 地标类重要设施的场地格不计入小区吸引（由设施节点单独吸引），避免重复计算
  Model.prototype.buildZones = function () {
    const city = this.city, LU = CM.LU, Z = this.Z;
    const fn = this.buildFacNodes(), excl = fn.excl;
    const A = this.zA, hub = this.zHub;
    for (let z = 0; z < Z; z++) {
      let p = 0, j = 0, a = 0, sx = 0, sy = 0, sw = 0, aSc = 0, aSh = 0, aMd = 0, aLz = 0, h = 0;
      for (const c of this.zoneCells[z]) {
        const pc = city.pop[c], jc = city.jobs[c];
        p += pc; j += jc;
        const L = city.lu[c], com = L === LU.COM || L === LU.MIX;
        a += jc * (com ? 1.0 : (L === LU.INST ? 0.8 : 0.35)) + pc * 0.22;
        h += pc + jc * (com ? 0.6 : 0.2);
        if (!excl[c]) {
          aSc += pc * 0.25 + (L === LU.INST ? jc * 1.2 : 0);
          aSh += jc * (com ? 1 : (L === LU.RES ? 0.5 : (L === LU.IND ? 0.1 : 0.3))) + pc * 0.05;
          aMd += (L === LU.INST ? jc * 0.5 : 0) + (com ? jc * 0.05 : 0) + pc * 0.03;
          aLz += (city.isPark[c] || L === LU.PARK ? 400 * city.landFrac[c] : 0) + (L === LU.HILL ? 60 * city.landFrac[c] : 0) + (com ? jc * 0.25 : 0) + pc * 0.12 + (L === LU.LANDMARK ? 200 : 0);
        }
        const w = pc + jc;
        sx += w * ((c % CFG.W) + 0.5); sy += w * (((c / CFG.W) | 0) + 0.5); sw += w;
      }
      this.zPop[z] = p; this.zJobs[z] = j; this.zAttr[z] = a;
      A[z] = aSc; A[Z + z] = aSh; A[2 * Z + z] = aMd; A[3 * Z + z] = aLz; hub[z] = h;
      const zi = z % this.ZW, zj = (z / this.ZW) | 0;
      this.zCx[z] = sw > 1 ? sx / sw : zi * CFG.ZONE + CFG.ZONE / 2;
      this.zCy[z] = sw > 1 ? sy / sw : zj * CFG.ZONE + CFG.ZONE / 2;
      fn.nx[z] = this.zCx[z]; fn.ny[z] = this.zCy[z];
    }
  };
  Model.prototype.buildDemand = function () {
    const g = this.buildDemandGen();
    while (!g.next().done) { /* run */ }
  };
  // 每人每日的出行率（来回各一次计为一次往返）：通勤、上学、购物、医疗、休闲
  Model.prototype.tripRates = function (y) {
    const c = CFG.choice, ps = c.purposeShare;
    const wr = U.interp(c.workerRate, y), hr = U.interp(c.hoRate, y);
    const sc = U.interp(ps.sc, y), md = U.interp(ps.md, y), lz = U.interp(ps.lz, y), sh = Math.max(0.05, 1 - sc - md - lz);
    return [wr, hr * sc, hr * sh, hr * md, hr * lz];
  };
  // 周末各目的出行相对工作日的倍数：双休日制度下取 CFG.trips.weekend；周六仍上班、上课的年代（CFG.workWeek）
  // 周六的通勤约为工作日的 95%、上学约 90%，周日不变，周末两天平均
  Model.prototype.weekendMult = function (y) {
    const T = CFG.trips.weekend, ww = CFG.workWeek || {};
    const sat = ww.sat ? U.clamp(U.interp(ww.sat, y), 0, 1) : 0, sch = ww.school ? U.clamp(U.interp(ww.school, y), 0, 1) : 0;
    const out = PK.map(function (k) { return T[k]; });
    out[HW] = T.hw + (0.95 - T.hw) * sat * 0.5;
    out[1] = T.sc + (0.9 - T.sc) * sch * 0.5;
    return out;
  };
  // 全市「购物中心形态」的零售面积（㎡）：商业岗位按有效零售面积折算，加上所有上盖商场的商业面积。
  // 商场的吸引 = 本店商业面积 ÷ 全市供给。分母包含所有上盖，所以多盖一个，每家份额都会下降——
  // 摊薄来自面积份额，不需要竞争系数。街区商铺、超市、餐饮不构成同面积竞争，所以不按岗位全面积计。
  Model.prototype.mallSupply = function () {
    const FN = this.fn, Z = this.Z; if (!FN) return null;
    const m2 = (CFG.property.market && CFG.property.market.m2PerJob) || 1;
    let jobs = 0;
    for (let z = 0; z < Z; z++) jobs += this.zJobs[z];
    let own = 0;
    for (let k = 0; k < FN.F; k++) { const f = FN.list[k]; if (f.t === 'mall') own += f.comArea || 0; }
    return { supply: Math.max(1, jobs * m2 + own), jobs: jobs, own: own, m2: m2 };
  };

  // 时间切片版本：每 16 个起点让出一次；结果在最后一次性替换 this.od
  // 生产约束的重力模型：各目的的出行总量只由居住人口与出行率决定，设施只改变去向（不凭空增加出行）；
  // 枢纽接驳由设施给定（外生的铁路与航空旅客），按人口与岗位分布到全市
  Model.prototype.buildDemandGen = function* () {
    const Z = this.Z, y = this.year, c = CFG.choice, T = CFG.trips, Fac = CM.Fac;
    const fn = this.fn, F = fn.F, NZ = fn.NZ;
    const L1 = U.interp(c.distDecayHW, y), L2 = U.interp(c.distDecayHO, y);
    const rate = this.tripRates(y);
    const Ls = [L1, L2 * T.decay.sc, L2 * T.decay.sh, L2 * T.decay.md, L2 * T.decay.lz];
    const kmPerCell = CFG.CELL_M / 1000 * 1.2;
    // 各目的的小区吸引（工作 = 岗位）；重要设施按参考比例取得吸引量，并从所在小区扣除（地标类设施的场地已在 buildZones 中排除）
    const A = [this.zJobs, new Float64Array(Z), new Float64Array(Z), new Float64Array(Z), new Float64Array(Z)];
    const sumA = [0, 0, 0, 0, 0];
    for (let p = 1; p < 5; p++) for (let z = 0; z < Z; z++) { A[p][z] = this.zA[(p - 1) * Z + z]; sumA[p] += A[p][z]; }
    const fA = [null, new Float64Array(F), new Float64Array(F), new Float64Array(F), new Float64Array(F)];
    const MS = this.mallSupply();
    const maxShare = (CFG.property.market && CFG.property.market.maxMallShare) || 0.35;
    // 上盖商场的份额 = 它的商业面积 ÷ 全市购物中心形态面积。
    // 注意用 filter 之后的索引 k，不能用 f.k（Fac.list 的全局序号，设施停用后会错位）。
    const mallShare = function (k) {
      if (!MS) return 0;
      const a = fn.list[k].comArea || 0;
      return MS.supply > 0 ? Math.min(maxShare, a / MS.supply) : 0;
    };
    const fL = new Float64Array(F), hubs = [];
    for (let k = 0; k < F; k++) {
      const f = fn.list[k];
      if (f.T.hub) { hubs.push(k); continue; }
      fL[k] = L2 * (f.L || f.T.L);   // 上盖商场按规模覆盖吸引范围（社区型近、市级型远）
      const isMall = f.t === 'mall', s = Fac.share(f, y);
      const mShare = isMall ? mallShare(k) : 0;
      for (let p = 1; p < 5; p++) {
        const fr = f.p[PK[p]] || 0; if (!fr) continue;
        // 上盖商场只改变购物与休闲的去向：工作地点不会因为商场出现而改变，通勤 OD 不动
        if (isMall && p !== SH && p !== LZ) continue;
        const a = isMall ? mShare * fr * sumA[p] : s * fr * sumA[p];
        fA[p][k] = a;
        // 上盖商场不从小区吸引里扣除：它的份额已经限定"能分到全市多少"，
        // 若再从单个小区扣，会直接触发 30% 下限，把整片本地商业抹掉（实测会让地铁客流凭空下降 8%）
        if (f.lmK < 0 && !isMall) { const hz = fn.hostZ[Z + k]; A[p][hz] = Math.max(A[p][hz] * 0.3, A[p][hz] - a); }
      }
    }
    // 枢纽接驳：城市一端按人口与岗位（含商务、酒店）分布，距离衰减较弱
    const Lh = L1 * T.decay.hub, hubTours = hubs.map(function (k) {
      const f = fn.list[k], out = new Float64Array(Z), tot = Fac.pax(f, y) / 2;
      let s = 0;
      for (let z = 0; z < Z; z++) {
        if (this.zHub[z] <= 0 || z === fn.hostZ[Z + k]) continue;
        const d = U.dist(f.x, f.y, this.zCx[z], this.zCy[z]) * kmPerCell;
        out[z] = this.zHub[z] * Math.exp(-d / Lh); s += out[z];
      }
      if (s > 0) for (let z = 0; z < Z; z++) out[z] *= tot / s;
      return out;
    }, this);
    const rsum = rate[0] + rate[1] + rate[2] + rate[3] + rate[4];
    const zAsum = new Float64Array(Z);
    for (let z = 0; z < Z; z++) zAsum[z] = A[1][z] + A[2][z] + A[3][z] + A[4][z];
    // 接驳巴士把「这一站能服务到哪里」延伸到端点，站上的商场与附近的设施都跟着受益。
    // facBus[k * Z + z] = 小区 z 接驳到端点、再步行到设施 k 的等效距离（km）；没有接驳可达时为 1e9。
    // 只改「谁能方便到达」，不改设施的吸引量——总量仍守恒。
    const facBus = new Float32Array(F * Z).fill(1e9);
    if (CFG.bus && this.net) {
      const B = CFG.bus, mpm = CFG.walk.mPerMin;
      for (const sid in this.net.stations) {
        const st = this.net.stations[sid];
        if (!st.bus || !st.bus.length) continue;
        for (const b of st.bus) {
          const eqKm = (M.busEqM(b) + CFG.walk.cellExtraM) / 1000;
          // 端点能服务的设施：步行 500 m 内（上盖商场就在站上，距离为 0）
          const facs = [];
          for (let k = 0; k < F; k++) {
            const dd = Math.hypot(fn.nx[Z + k] - b.x, fn.ny[Z + k] - b.y) * CFG.CELL_M;
            if (dd <= 500) facs.push({ k: k, km: dd / 1000 });
          }
          if (!facs.length) continue;
          for (let z = 0; z < Z; z++) {
            const dx = this.zCx[z] - b.x, dy = this.zCy[z] - b.y;
            if (Math.sqrt(dx * dx + dy * dy) * CFG.CELL_M > B.walkReachM + 150) continue;
            for (const f of facs) {
              const v = eqKm + f.km;
              if (v < facBus[f.k * Z + z]) facBus[f.k * Z + z] = v;
            }
          }
        }
      }
    }
    // 输出写入复用的类型数组（两套交替使用：新的需求表算完前，旧表保持不变）
    this._odBufs = this._odBufs || [null, null];
    const cur = this.od && this.od.dest ? this.od.dest.buffer : null;
    this._odFlip = this._odBufs[0] && this._odBufs[0].dest.buffer === cur ? 1 : 0;   // 用当前需求表没有引用的那一套
    let ob = this._odBufs[this._odFlip];
    const per = 240 + F + hubs.length;
    if (!ob || ob.cap < Z * 120) ob = this._odBufs[this._odFlip] = odBuffer(Z * 160);
    // 阻抗口径（CFG.choice.impedance）：'time' 时用广义时间代替直线距离做衰减，并顺带按时间截断。
    // 时间口径不在每次求解里重算，而是在需求表重建时取「上一轮早高峰」的 skim —— 需求表只在城市/线网变化时重建，
    // 所以这个滞后是自然的（先有网络，再有基于它的通勤分布）。
    const C0 = CFG.choice, impOn = C0.impedance === 'time';
    let imp = null, Ts = Ls;
    if (impOn) {
      const accI = this.net && this.net.acc;
      const wdP = this.ctxs && this.ctxs.wd && this.ctxs.wd.per ? this.ctxs.wd.per[1] : null;
      const skim = this.liveBuf && this.liveBuf.skim;
      const refKmh = C0.impedanceRefKmh || 22;
      imp = {
        Z: Z, walkW: C0.walkW || 1,
        skT: wdP && wdP.skimT ? wdP.skimT : null,
        zl: accI ? accI.zl : null, zCov: accI ? accI.zCov : null, zWalk: accI ? accI.zWalk : null,
        gt: skim && skim.gt ? skim.gt : null,
        N: this.net && this.net.C ? this.net.C.stations.length : 0,
        railKmh: C0.impedanceRailKmh || 40, wait: C0.impedanceWaitMin || 5, maxMin: C0.impedanceMaxMin || 90,
      };
      Ts = Ls.map(function (v) { return v / refKmh * 60; });   // km 尺度 → 分钟尺度（标定不变）
    }
    const D = { Z: Z, F: F, A: A, Ls: Ls, imp: imp, Ts: Ts, fA: fA, fL: fL, rate: rate, rw: rate.map(function (r) { return r / rsum; }), zPop: this.zPop, zJobs: this.zJobs, zAsum: zAsum,
      zCx: this.zCx, zCy: this.zCy, nx: fn.nx, ny: fn.ny, hostZ: fn.hostZ, kmPerCell: kmPerCell, hubs: hubs, hubTours: hubTours,
      facBus: facBus,
      w: [new Float64Array(Z), new Float64Array(Z), new Float64Array(Z), new Float64Array(Z), new Float64Array(Z)],
      wf: [null, new Float64Array(F), new Float64Array(F), new Float64Array(F), new Float64Array(F)],
      scores: new Float64Array(Z), s: new Float64Array(5), kk: new Float64Array(5), cand: new Int32Array(Z), candF: new Int32Array(Math.max(1, F)),
      out: ob, n: 0, tot: new Float64Array(NPK) };
    const start = new Int32Array(Z + 1);
    for (let i = 0; i < Z; i++) {
      if (i > 0 && (i & 15) === 0) yield;
      if (D.out.cap - D.n < per) D.out = this._odBufs[this._odFlip] = odGrow(D.out, D.n, Math.max(D.out.cap * 2, D.n + per * 64));
      demandOrigin(D, i);
      start[i + 1] = D.n;
    }
    const n = D.n, o = D.out;
    this.od = { start: start, dest: o.dest.subarray(0, n), t: o.t.map(function (a) { return a.subarray(0, n); }), tot: D.tot, F: F, NZ: NZ, key: fn.key };
    this.version++;
  };
  // 分步版本（月度处理中使用，避免单帧长时间停顿）。进行期间暂停实时求解与预测（见 step），
  // 使其不会读到新旧混合的小区/需求/路网状态；计算结果与一次性执行相同。
  Model.prototype.refreshCityGen = function* (C) {
    this.refreshing = true;
    try {
      this.buildZones();
      yield* this.buildDemandGen();
      if (this.city.roadVersion !== this.roadVer) { this.syncRoad(); yield; }
      if (this.net || C) this.setNetwork(C || this.net.C, true); // 步行网络与覆盖随城市变化重算
      this.gen = null;
    } finally {
      this.refreshing = false;
    }
  };

  // ---------------- 道路网络同步 ----------------
  Model.prototype.computeArcZones = function () {
    const road = this.road, city = this.city;
    const az = new Int16Array(road.nA);
    for (const L of road.links) {
      const m = L.pts[Math.floor(L.pts.length / 2)];
      const c = city.cellAt(m[0], m[1]);
      const z = c < 0 ? 0 : city.zoneOf(c);
      az[2 * L.id] = z; az[2 * L.id + 1] = z;
    }
    this.arcZone = az;
  };
  // Immutable road topology in a compact layout; keep connection order and Float64 costs.
  Model.prototype.prepareRoad = function () {
    const road = this.road, start = new Int32Array(this.Z + 1), zones = [], nodes = [], times = [], km = [];
    for (let z = 0; z < this.Z; z++) {
      const list = road.zoneConn[z] || [];
      if (list.length) zones.push(z);
      for (const c of list) { nodes.push(c.node); times.push(c.t); km.push(c.km); }
      start[z + 1] = nodes.length;
    }
    this.roadData = { start: start, zones: Int32Array.from(zones), nodes: Int32Array.from(nodes), times: Float64Array.from(times), km: Float64Array.from(km), arcKm: Float64Array.from(road.arcLen, function (v) { return v / 1000; }), uniqueKeys: new Set(road.links.map(function (L) { return L.key; })).size === road.links.length };
  };
  Model.prototype.syncRoad = function () {
    this.wake();
    const old = this.road, nw = this.city.car;
    // Preserve legacy state remapping even for identical graphs with duplicate link keys.
    if (old === nw && this.roadData.uniqueKeys) { this.roadVer = this.city.roadVersion; this.syncTreeCache(old, nw); this.version++; return; }
    const map = new Map();
    old.links.forEach(function (L) { map.set(L.key, L); });
    const remap = function (arr, fillFn) {
      const out = new Float32Array(nw.nA);
      for (const L of nw.links) {
        const o = map.get(L.key);
        for (let d = 0; d < 2; d++) {
          const a = 2 * L.id + d;
          if (o) {
            const sameDir = o.verts[0] === L.verts[0];
            out[a] = arr[2 * o.id + (sameDir ? d : 1 - d)];
          } else out[a] = fillFn(a);
        }
      }
      return out;
    };
    for (const dt of DT) {
      for (const P of this.ctxs[dt].per) {
        if (!P) continue;
        P.arcVol = remap(P.arcVol, function () { return 0; });
        P.arcTime = remap(P.arcTime, function (a) { return nw.arcT0[a]; });
      }
    }
    this.road = nw; this.roadVer = this.city.roadVersion;
    this.syncTreeCache(old, nw);   // 路网换了：旧树的弧号要按顶点对重映射（失效子树标 -2）
    this.prepareRoad();
    this.computeArcZones();
    this.version++;
  };

  // ---------------- 地铁网络与步行接驳 ----------------
  // 小区与重要设施节点的接驳表：可步行到达的车站（最多 4 个）、覆盖比例与平均步行时间
  Model.prototype.computeAccess = function (C) {
    const city = this.city, walk = city.walk, VW = city.VW, N = C.stations.length;
    const maxM = CFG.walk.maxAccessM, xferM = CFG.walk.transferMaxM, extra = CFG.walk.cellExtraM, mpm = CFG.walk.mPerMin;
    const SF = CFG.stationFacility;
    const nC = city.N, Z = this.Z, fn = this.fn, F = fn ? fn.F : 0, NZ = Z + F;
    // 车站级的进出站半径：出入口每加一级都把「愿意走多远进站」抬高一段。
    // 只有出入口升级过的车站才会大于 maxM，所以没有这条线的存档与模式结果逐字节不变。
    const stLimit = new Float32Array(N);
    for (let k = 0; k < N; k++) stLimit[k] = M.exitAccessM(C.stations[k].exitLv | 0);
    const cellWalk = new Float32Array(nC).fill(Infinity), cellStation = new Int32Array(nC).fill(-1);
    // 每一格对应的「判定半径」：谁覆盖了它，就用谁的门槛。否则升级了出入口的车站
    // 覆盖到的 1.3 km 处会被全网的 1,125 m 门槛判成未覆盖。
    const cellLim = new Float32Array(nC).fill(maxM);
    const dist = this._wdist || (this._wdist = new Float64Array(city.V).fill(INF));
    if (dist.length !== city.V) { this._wdist = new Float64Array(city.V).fill(INF); }
    const D_ = this._wdist;
    const pred = this._wpred || (this._wpred = new Int32Array(city.V));
    const touched = [];
    const heap = this.heap;
    const zMap = new Map(), fMap = new Map();
    const cellFac = fn ? fn.cellFac : null;
    const trees = [], accessible = new Uint8Array(N), catchPop = new Float32Array(N), transfers = [];
    const treeRules = maxM + ':' + xferM + ':' + CFG.CELL_M + ':' + ((SF && SF.exit && SF.exit.accessM.join(',')) || '')
      + ':' + ((SF && SF.pr && [SF.pr.reachM, SF.pr.walkMul].join(',')) || '');
    if (this._treeWalk !== walk || this._treeRules !== treeRules) { this._treeWalk = walk; this._treeRules = treeRules; this._walkTrees = new Map(); }
    const treeCache = this._walkTrees;
    for (let k = 0; k < N; k++) {
      const st = C.stations[k];
      trees.push(null);
      const c0 = city.cellAt(st.x, st.y);
      if (c0 < 0) continue;
      const ci = c0 % city.W, cj = (c0 / city.W) | 0;
      // 这一站的服务半径与搜索范围都跟着出入口走：原来固定 ±6 格（1.5 km）会把 1,650 m 的
      // 升级直接吃掉，所以窗口按本站半径算，并给「换乘」口径留出余量。
      const smax = stLimit[k];
      const limit = Math.max(smax, xferM) + 200;
      const win = Math.ceil(smax / CFG.CELL_M) + 1;
      const prOn = !!(SF && SF.pr && (st.prLv | 0) > 0);
      heap.clear(); touched.length = 0;
      // 步行树缓存必须带上本站半径，否则会在两个出入口等级不同的车站之间互相命中（T10）
      const treeKey = st.x + ':' + st.y + ':' + smax;
      const cachedTree = treeCache.get(treeKey);
      if (cachedTree) {
        trees[k] = cachedTree.tree; accessible[k] = 1;
        for (let q = 0; q < cachedTree.tree.verts.length; q++) { const v = cachedTree.tree.verts[q]; touched.push(v); D_[v] = cachedTree.exact[q]; }
      } else {
        const corners = [cj * VW + ci, cj * VW + ci + 1, (cj + 1) * VW + ci, (cj + 1) * VW + ci + 1];
        for (const v of corners) {
          if (walk.deg[v] === 0) continue;
          const d0 = U.dist(st.x, st.y, city.vx[v], city.vy[v]) * CFG.CELL_M;
          if (d0 < D_[v]) { if (D_[v] >= INF) touched.push(v); D_[v] = d0; pred[v] = -1; heap.push(d0, v); }
        }
        if (!heap.n) continue;
        accessible[k] = 1;
        while (heap.n) {
          const u = heap.pop(), du = heap.lastKey;
          if (du > D_[u]) continue;
          for (let e = walk.start[u]; e < walk.start[u + 1]; e++) {
            const v = walk.to[e], nd = du + walk.len[e];
            if (nd < D_[v] && nd <= limit) {
              if (D_[v] >= INF) touched.push(v);
              D_[v] = nd; pred[v] = u; heap.push(nd, v);
            }
          }
        }
        // 行人路径树（未通车站也保留，用于详情中的“接入线路后的潜在覆盖”）
        const tv = Int32Array.from(touched), td = new Float32Array(tv.length), tp = new Int32Array(tv.length);
        for (let q = 0; q < tv.length; q++) { td[q] = D_[tv[q]]; tp[q] = pred[tv[q]]; }
        trees[k] = { verts: tv, dist: td, pred: tp };
        const exact = new Float64Array(tv.length);
        for (let q = 0; q < tv.length; q++) exact[q] = D_[tv[q]];
        if (treeCache.size >= 512) treeCache.clear();
        treeCache.set(treeKey, { tree: trees[k], exact: exact });
      }
      // 只有接入运营线路的车站提供服务：未通车站不计覆盖、不参与接驳与站外换乘
      if (C.serviced && !C.serviced[k]) { for (const v of touched) D_[v] = INF; continue; }
      // 覆盖格
      for (let j = Math.max(0, cj - win); j <= Math.min(city.H - 1, cj + win); j++) {
        for (let i = Math.max(0, ci - win); i <= Math.min(city.W - 1, ci + win); i++) {
          const v0 = j * VW + i;
          let cd = Math.min(D_[v0], D_[v0 + 1], D_[v0 + VW], D_[v0 + VW + 1]) + extra;
          // P+R：开车到站，站口 800 m 内的最后一段步行按 0.85 折减（换乘总时间也含停车与取车，这里只折步行）
          if (prOn && cd <= SF.pr.reachM) cd *= (SF.pr.walkMul || 1);
          if (cd > smax) continue;
          const c = j * city.W + i;
          if (cd < cellWalk[c]) { cellWalk[c] = cd; cellStation[c] = k; cellLim[c] = smax; }
          // 重要设施的场地格：按格计（设施本身可能没有居住人口）
          const fl = cellFac && cellFac.get(c);
          if (fl) for (const f of fl) { let m = fMap.get(f); if (!m) { m = new Map(); fMap.set(f, m); } const e = m.get(k) || [0, 0]; e[0] += 1; e[1] += cd; m.set(k, e); }
          const w = city.pop[c] + city.jobs[c];
          if (w <= 0) continue;
          if (cd <= 750) catchPop[k] += city.pop[c];
          const z = city.zoneOf(c);
          let m = zMap.get(z); if (!m) { m = new Map(); zMap.set(z, m); }
          const e = m.get(k) || [0, 0]; e[0] += w; e[1] += w * cd; m.set(k, e);
        }
      }
      // 接驳巴士：站点 → 端点 → 端点步行圈，按「等效步行距离」并入这一站的服务范围。
      // 只扩展接驳口径（cellWalk / 小区与设施接驳表），不产生新的出行需求——总量仍由人口决定。
      // 没有 bus 字段的存档与模式完全不走这段，所以既有数值不受影响。
      if (CFG.bus && st.bus && st.bus.length) {
        const B = CFG.bus;
        const bd = (this._busDist && this._busDist.length === city.V) ? this._busDist : (this._busDist = new Float64Array(city.V).fill(INF));
        const btouched = [];
        for (const b of st.bus) {
          const cb = city.cellAt(b.x, b.y);
          if (cb < 0) continue;
          const eqM = M.busEqM(b);   // 车程 + 候车，折成等效步行米
          const bi = cb % city.W, bj = (cb / city.W) | 0;
          heap.clear(); btouched.length = 0;
          for (const v of [bj * VW + bi, bj * VW + bi + 1, (bj + 1) * VW + bi, (bj + 1) * VW + bi + 1]) {
            if (walk.deg[v] === 0) continue;
            const d0 = U.dist(b.x, b.y, city.vx[v], city.vy[v]) * CFG.CELL_M;
            if (d0 < bd[v]) { if (bd[v] >= INF) btouched.push(v); bd[v] = d0; heap.push(d0, v); }
          }
          if (heap.n) {
            while (heap.n) {
              const u = heap.pop(), du = heap.lastKey;
              if (du > bd[u]) continue;
              for (let e = walk.start[u]; e < walk.start[u + 1]; e++) {
                const v = walk.to[e], nd = du + walk.len[e];
                if (nd < bd[v] && nd <= B.walkReachM) { if (bd[v] >= INF) btouched.push(v); bd[v] = nd; heap.push(nd, v); }
              }
            }
          }
          for (let j = Math.max(0, bj - 2); j <= Math.min(city.H - 1, bj + 2); j++) {
            for (let i = Math.max(0, bi - 2); i <= Math.min(city.W - 1, bi + 2); i++) {
              const v0 = j * VW + i;
              const wd = Math.min(bd[v0], bd[v0 + 1], bd[v0 + VW], bd[v0 + VW + 1]);
              if (wd >= INF) continue;
              // 接驳覆盖按「可达」处理：等效距离饱和到步行阈值。
              // 现实的接驳体验（10 分钟车程 + 5 分钟候车 + 步行）确实比步行慢，
              // 但它提供的是「原来根本到不了」的选项，所以要计入覆盖而不是被 15 分钟门槛挡掉。
              // 真正限制范围的是 maxLenM（单条最长），不是这里的阈值。
              let cd = eqM + wd + extra;
              if (cd > smax) cd = smax;
              const c = j * city.W + i;
              if (cd < cellWalk[c]) { cellWalk[c] = cd; cellStation[c] = k; cellLim[c] = smax; }
              const fl = cellFac && cellFac.get(c);
              if (fl) for (const f of fl) { let m = fMap.get(f); if (!m) { m = new Map(); fMap.set(f, m); } const e = m.get(k) || [0, 0]; e[0] += 1; e[1] += cd; m.set(k, e); }
              const w = city.pop[c] + city.jobs[c];
              if (w <= 0) continue;
              const z = city.zoneOf(c);
              let m = zMap.get(z); if (!m) { m = new Map(); zMap.set(z, m); }
              const e = m.get(k) || [0, 0]; e[0] += w; e[1] += w * cd; m.set(k, e);
            }
          }
          for (const v of btouched) bd[v] = INF;
        }
      }
      // 站外换乘
      for (let m2 = 0; m2 < N; m2++) {
        if (m2 === k || (C.serviced && !C.serviced[m2])) continue;
        const s2 = C.stations[m2];
        if (U.dist(st.x, st.y, s2.x, s2.y) * CFG.CELL_M > xferM + 150) continue;
        const c2 = city.cellAt(s2.x, s2.y); if (c2 < 0) continue;
        const i2 = c2 % city.W, j2 = (c2 / city.W) | 0;
        let best = INF;
        for (const v of [j2 * VW + i2, j2 * VW + i2 + 1, (j2 + 1) * VW + i2, (j2 + 1) * VW + i2 + 1]) {
          if (D_[v] >= INF) continue;
          const dd = D_[v] + U.dist(s2.x, s2.y, city.vx[v], city.vy[v]) * CFG.CELL_M;
          if (dd < best) best = dd;
        }
        if (best <= xferM) transfers.push({ a: k, b: m2, m: best });
      }
      for (const v of touched) D_[v] = INF;
    }
    // 小区接驳表（下标 0…Z−1 为小区，Z…Z+F−1 为重要设施）
    const zl = new Array(NZ).fill(null), zCov = new Float32Array(NZ), zWalk = new Float32Array(NZ);
    for (let z = 0; z < Z; z++) {
      let tot = 0, cov = 0, wsum = 0;
      for (const c of this.zoneCells[z]) {
        const w = city.pop[c] + city.jobs[c];
        tot += w;
        if (cellWalk[c] <= cellLim[c]) { cov += w; wsum += w * cellWalk[c]; }
      }
      zCov[z] = tot > 0 ? cov / tot : 0;
      zWalk[z] = cov > 0 ? wsum / cov / mpm : 0;
      const m = zMap.get(z);
      if (m && zCov[z] > 0) {
        const arr = [];
        m.forEach(function (e, s) { arr.push({ s: s, w: e[1] / e[0] / mpm, share: e[0] / Math.max(1, tot) }); });
        arr.sort(function (a, b) { return a.w - b.w; });
        zl[z] = arr.slice(0, 4);
      }
    }
    for (let k = 0; k < F; k++) {
      const cs = fn.cells[k], n = Math.max(1, cs.length);
      let cov = 0, wsum = 0;
      for (const c of cs) if (cellWalk[c] <= cellLim[c]) { cov++; wsum += cellWalk[c]; }
      zCov[Z + k] = cov / n; zWalk[Z + k] = cov > 0 ? wsum / cov / mpm : 0;
      const m = fMap.get(k);
      if (m && cov > 0) {
        const arr = [];
        m.forEach(function (e, s) { arr.push({ s: s, w: e[1] / e[0] / mpm, share: e[0] / n }); });
        arr.sort(function (a, b) { return a.w - b.w; });
        zl[Z + k] = arr.slice(0, 4);
      }
    }
    // 人口覆盖率
    let pc = 0, pt = 0;
    for (let c = 0; c < nC; c++) { pt += city.pop[c]; if (cellWalk[c] <= cellLim[c]) pc += city.pop[c]; }
    return { cellWalk: cellWalk, cellStation: cellStation, cellLim: cellLim, stLimit: stLimit, zl: zl, zCov: zCov, zWalk: zWalk, trees: trees, accessible: accessible, catchPop: catchPop, transfers: transfers, coverage: pt > 0 ? pc / pt : 0, NZ: NZ, facKey: fn ? fn.key : '' };
  };

  // 「可到达的工作机会」：小区 i 在 capMin 分钟内（取小汽车与地铁中较优）能到达的岗位数。
  // 这是「人往通勤方便的地方去」需要的量——比「离最近车站多远」更接近真实区位价值。
  // 每月算一次（城市增长用），O(Z²) 但不进求解循环；小汽车时间已经 ≤ capMin 时不必再看地铁。
  // only: 'both'（默认，小汽车与地铁取较优）| 'transit'（只算地铁 + 接驳，不算开车）
  Model.prototype.computeJobAccess = function (capMin, only) {
    const Z = this.Z, out = new Float32Array(Z);
    const acc = this.net && this.net.acc;
    const P = this.ctxs && this.ctxs.wd && this.ctxs.wd.per ? this.ctxs.wd.per[1] : null;
    const car = P ? P.skimT : null;
    const skim = this.liveBuf && this.liveBuf.skim;
    const gt = skim && skim.gt ? skim.gt : null;
    const N = this.net && this.net.C ? this.net.C.stations.length : 0;
    const walkW = (CFG.choice && CFG.choice.walkW) || 1;
    const zl = acc ? acc.zl : null;
    for (let i = 0; i < Z; i++) {
      let s = this.zJobs[i];
      const lo = zl ? zl[i] : null;
      for (let j = 0; j < Z; j++) {
        if (i === j || this.zJobs[j] <= 0) continue;
        let t = Infinity;
        if (car && only !== 'transit') { const v = car[i * Z + j]; if (v > 0 && v < 1e8) t = v; }
        if (t > capMin && lo && gt && zl && zl[j] && N > 0) {
          // 只有在小汽车已经超时的情况下才试地铁，省掉绝大多数的 4×4 组合
          const ld = zl[j];
          for (let a = 0; a < lo.length; a++) {
            const A = lo[a], row = A.s * N;
            for (let b = 0; b < ld.length; b++) {
              const B = ld[b];
              if (A.s === B.s) continue;
              const g = gt[row + B.s];
              if (!(g < 1e8)) continue;
              const v = walkW * (A.w + B.w) + g;
              if (v < t) t = v;
            }
          }
        }
        if (t <= capMin) s += this.zJobs[j];
      }
      out[i] = s;
    }
    return out;
  };

  // 「通勤可达性」乘子（每格）：T 分钟内可达岗位数 ÷ 全市最大，开方后线性映射到 [1, 1+accessGain]。
  // 地价的可达项与容积率的可达项共用这一个量，保证「价格反映的东西」和「容积率奖励的东西」是同一件事。
  // 每月算一次（O(Z²)），不进求解循环。
  Model.prototype.computeLandAccess = function (winMin) {
    const Z = this.Z, city = this.city;
    const j = this.computeJobAccess(winMin || 30);
    let mx = 0;
    for (let z = 0; z < Z; z++) if (j[z] > mx) mx = j[z];
    const gain = (CFG.land && CFG.land.accessGain) || 0.7;
    const out = new Float32Array(city.N);
    for (let c = 0; c < city.N; c++) {
      const r = mx > 0 ? Math.sqrt(j[city.zoneOf(c)] / mx) : 0;
      out[c] = 1 + gain * r;
    }
    this.landAccessMul = out;
    return out;
  };

  Model.prototype.buildMetro = function (C) {
    const N = C.stations.length, R = C.routes.length, mc = CFG.metro;
    const acc = this.computeAccess(C);
    const platBase = new Int32Array(R);
    let nNodes = N;
    for (let r = 0; r < R; r++) { platBase[r] = nNodes; nNodes += C.routes[r].stIdx.length; }
    const E = { from: [], to: [], type: [], route: [], leg: [], dir: [], st: [], km: [], t0: [], wm: [] };
    const push = function (f, t, ty, r, leg, dir, st, km, t0, wm) {
      E.from.push(f); E.to.push(t); E.type.push(ty); E.route.push(r); E.leg.push(leg); E.dir.push(dir); E.st.push(st); E.km.push(km); E.t0.push(t0); E.wm.push(wm);
      return E.from.length - 1;
    };
    const rideEdge = [], boardEdge = [];
    for (let r = 0; r < R; r++) {
      const rt = C.routes[r], n = rt.stIdx.length;
      const be = new Int32Array(n);
      for (let k = 0; k < n; k++) {
        be[k] = push(rt.stIdx[k], platBase[r] + k, 0, r, k, 0, rt.stIdx[k], 0, 0, 0);
        push(platBase[r] + k, rt.stIdx[k], 1, r, k, 0, rt.stIdx[k], 0, 0, 0);
      }
      const nLegs = rt.legSec.length;
      const re = new Int32Array(nLegs * 2);
      for (let k = 0; k < nLegs; k++) {
        const a = platBase[r] + k, b = platBase[r] + ((k + 1) % n);
        const t0 = rt.legSec[k] / 60 + mc.dwell / 60, km = rt.legLenM[k] / 1000;
        re[2 * k] = push(a, b, 2, r, k, 0, -1, km, t0, 0);
        re[2 * k + 1] = push(b, a, 2, r, k, 1, -1, km, t0, 0);
      }
      rideEdge.push(re); boardEdge.push(be);
    }
    for (const tr of acc.transfers) push(tr.a, tr.b, 3, -1, -1, 0, tr.b, 0, tr.m / CFG.walk.mPerMin, tr.m);
    const nE = E.from.length;
    const net = {
      C: C, N: N, R: R, nNodes: nNodes, nE: nE, platBase: platBase, acc: acc, rideEdge: rideEdge, boardEdge: boardEdge,
      eFrom: Int32Array.from(E.from), eTo: Int32Array.from(E.to), eType: Uint8Array.from(E.type), eRoute: Int32Array.from(E.route),
      eLeg: Int32Array.from(E.leg), eDir: Uint8Array.from(E.dir), eSt: Int32Array.from(E.st), eKm: Float32Array.from(E.km), eT0: Float32Array.from(E.t0), eWm: Float32Array.from(E.wm),
      routeKey: C.routes.map(function (r) { return r.lineId + ':' + r.stIds.join(','); }),
    };
    const deg = new Int32Array(nNodes + 1);
    for (let e = 0; e < nE; e++) deg[net.eFrom[e]]++;
    const os = new Int32Array(nNodes + 1);
    for (let n = 0; n < nNodes; n++) os[n + 1] = os[n] + deg[n];
    const oe = new Int32Array(nE), f = new Int32Array(nNodes);
    for (let e = 0; e < nE; e++) { const a = net.eFrom[e]; oe[os[a] + f[a]++] = e; }
    net.outStart = os; net.outEdge = oe;
    return net;
  };

  // ---------------- 运算上下文 ----------------
  Model.prototype.newCtx = function (nPer, dt) {
    const ctx = { per: [], nPer: nPer, dt: dt || 'wd' };
    for (let p = 0; p < nPer; p++) { const P = this.makePer(this.net); P.dt = ctx.dt; ctx.per.push(P); }
    return ctx;
  };
  // 分目的、设施与小区吸引的统计数组（设施数量变化时重新分配）
  Model.prototype.allocStatArrays = function (P) {
    const Z = this.Z, F = this.fn ? this.fn.F : 0;
    if (!P.zDest || P.zDest.length !== NPK * Z) { P.zDest = new Float32Array(NPK * Z); P.zDestM = new Float32Array(NPK * Z); }
    if (!P.fIn || P.fIn.length !== F) { P.fIn = new Float32Array(F); P.fInM = new Float32Array(F); P.fOut = new Float32Array(F); P.fOutM = new Float32Array(F); P.fP = new Float32Array(NPK * F); }
  };
  Model.prototype.makePer = function (net) {
    const Z = this.Z, nA = this.road.nA;
    const P = {
      arcVol: new Float32Array(nA), arcTime: Float32Array.from(this.road.arcT0),
      skimT: new Float32Array(Z * Z), skimK: new Float32Array(Z * Z),
      desTot: new Float32Array(this.B * this.B), desMetro: new Float32Array(this.B * this.B),
      zTrips: new Float32Array(Z), zMetro: new Float32Array(Z), zAccess: new Float32Array(Z),
      stats: null, iters: 0,
    };
    this.allocStatArrays(P);
    this.initMetroPer(P, net, -1);
    return P;
  };
  Model.prototype.initMetroPer = function (P, net, p, old, oldNet) {
    const N = net ? net.N : 0, R = net ? net.R : 0, nE = net ? net.nE : 0;
    P.freq = new Float32Array(R); P.crowd = new Float32Array(nE).fill(1); P.load = new Float32Array(nE);
    P.stDelay = new Float32Array(N); P.stIn = new Float32Array(N); P.stOut = new Float32Array(N); P.stXfer = new Float32Array(N); P.stBoard = new Float32Array(N);
    for (let r = 0; r < R; r++) P.freq[r] = Model.serviceFloor(net.C.routes[r], p < 0 ? 1 : p);
    if (old && oldNet && net) {
      const keyIdx = new Map(); oldNet.routeKey.forEach(function (k, i) { keyIdx.set(k, i); });
      for (let r = 0; r < R; r++) {
        const o = keyIdx.get(net.routeKey[r]);
        if (o === undefined) continue;
        P.freq[r] = old.freq[o];
        const re = net.rideEdge[r], ore = oldNet.rideEdge[o];
        for (let q = 0; q < re.length && q < ore.length; q++) { P.load[re[q]] = old.load[ore[q]]; P.crowd[re[q]] = old.crowd[ore[q]]; }
        const be = net.boardEdge[r], obe = oldNet.boardEdge[o];
        for (let q = 0; q < be.length && q < obe.length; q++) P.load[be[q]] = old.load[obe[q]];
      }
      const sIdx = new Map(); oldNet.C.stations.forEach(function (s, i) { sIdx.set(s.id, i); });
      net.C.stations.forEach(function (s, i) {
        const o = sIdx.get(s.id); if (o === undefined) return;
        P.stIn[i] = old.stIn[o]; P.stOut[i] = old.stOut[o]; P.stXfer[i] = old.stXfer[o]; P.stBoard[i] = old.stBoard[o]; P.stDelay[i] = old.stDelay[o];
      });
    }
  };
  // 设置正式运营网络
  Model.prototype.setNetwork = function (C, keepState) {
    this.wake();
    const oldNet = this.net;
    const net = this.buildMetro(C);
    if (oldNet && (oldNet.N !== net.N || oldNet.nE !== net.nE || oldNet.nNodes !== net.nNodes)) { this.liveBuf = {}; this.predBuf = {}; }
    for (const dt of DT) for (let p = 0; p < this.ctxs[dt].per.length; p++) {
      const P = this.ctxs[dt].per[p], old = { freq: P.freq, load: P.load, crowd: P.crowd, stIn: P.stIn, stOut: P.stOut, stXfer: P.stXfer, stBoard: P.stBoard, stDelay: P.stDelay };
      this.initMetroPer(P, net, p, old, oldNet);
    }
    this.net = net;
    this.gen = null;
    // 车站日客流（stDaily）按旧网络统计，到下一次 computeDaily 前与新网络的车站编号不对应
    if (!keepState || !this.stDaily || this.stDaily.inn.length !== net.N) this.dailyStale = true;
    if (!keepState) this.sinceChange = 0;
    this.invalidateStable();   // 线网变了，逐位稳定的时段也要重算
    this.version++;
  };

  // ---------------- 单时段迭代 ----------------
  Model.prototype.metroSkim = function* (net, P, p, prm, store) {
    const N = net.N, nn = net.nNodes, nE = net.nE;
    let work = store.work;
    if (!work || work.cost.length !== nE || work.dist.length !== nn) work = store.work = { cost: new Float32Array(nE), tAct: new Float32Array(nE), dist: new Float64Array(nn), dtm: new Float32Array(nn), dkm: new Float32Array(nn) };
    const cost = work.cost, tAct = work.tAct;
    cost.fill(0); tAct.fill(0);
    for (let e = 0; e < nE; e++) {
      const ty = net.eType[e];
      if (ty === 0) {
        const f = Math.max(0.5, P.freq[net.eRoute[e]]);
        const w = 60 / (2 * f);
        cost[e] = prm.waitW * w + prm.tpen + P.stDelay[net.eSt[e]];
        tAct[e] = w + P.stDelay[net.eSt[e]] * 0.5;
      } else if (ty === 2) {
        cost[e] = net.eT0[e] * P.crowd[e]; tAct[e] = net.eT0[e];
      } else if (ty === 3) {
        cost[e] = prm.walkW * net.eT0[e] + prm.opn; tAct[e] = net.eT0[e];
      }
    }
    for (let s = 0; s < N; s++) {
      metroTree(net, cost, tAct, s, work, store, this.heap, prm.tpen);
      if ((s & 3) === 3) yield;
    }
  };

  Model.prototype.allocSkimStore = function (net, buf) {
    const N = net.N, nn = net.nNodes;
    const st = buf.skim;
    if (st && st.N === N && st.nn === nn) return st;
    buf.skim = { N: N, nn: nn, gt: new Float32Array(N * N), tm: new Float32Array(N * N), km: new Float32Array(N * N), pred: new Int32Array(N * nn), order: new Int32Array(N * nn), nOrd: new Int32Array(N), D: new Float32Array(N * N) };
    return buf.skim;
  };

  // 一个时段的一次完整迭代（buf 为该求解流程独占的临时缓冲区）。P.dt 为日类型（工作日 / 周末）
  Model.prototype.iterate = function* (net, P, p, opts) {
    opts = opts || {};
    // 懒更新：上一轮这个时段已经在容差内达到不动点、且输入没变（wake 会清掉 stable），
    // 那么整段 pass 是输入的纯函数 —— 重算只会得到同一组数，直接跳过。
    if (P.stable && !opts.fullSkim) { P.iters++; return; }
    const buf = opts.buf || this.liveBuf;
    const prm = this.params();
    const Z = this.Z, od = this.od, fn = this.fn, F = fn.F, NZ = fn.NZ;
    const hostZ = fn.hostZ, nx = fn.nx, ny = fn.ny, facWe = fn.we;
    const N = net ? net.N : 0;
    const T = CFG.trips, dt = P.dt === 'we' ? 'we' : 'wd', SPL = T.split[dt], hrs = this.pHours[p];
    // 各目的本时段的系数：日类型倍数 × 时段占比 ÷ 小时数（去程 co、返程 cr）
    const co = new Float64Array(NPK), cr = new Float64Array(NPK), WM = dt === 'we' ? this.weekendMult(this.year) : null;
    for (let q = 0; q < NPK; q++) { const m = WM ? WM[q] : 1; co[q] = m * SPL[PK[q]].o[p] / hrs; cr[q] = m * SPL[PK[q]].r[p] / hrs; }
    const facW = dt === 'we';
    const IND = T.induced;
    this.allocStatArrays(P);
    let store = null;
    const hasMetro = net && net.R > 0;
    let stable = P.iters > 0;
    if (hasMetro) { store = this.allocSkimStore(net, buf); yield* this.metroSkim(net, P, p, prm, store); store.D.fill(0); }
    // ---- 方式选择 ----
    if (!buf.carDem || buf.carDem.length !== Z * Z) buf.carDem = new Float32Array(Z * Z);
    if (!buf.hasCar || buf.hasCar.length !== Z) buf.hasCar = new Uint8Array(Z);
    const carDem = buf.carDem, hasCar = buf.hasCar;
    carDem.fill(0);
    hasCar.fill(0);
    const st = { trips: 0, metro: 0, car: 0, timeSum: 0, commTrips: 0, commTime: 0, fare: 0, metroPkm: 0, vkt: 0, carPkm: 0, congNum: 0, congDen: 0, crowdPkm: 0, metroTime: 0, carTime: 0,
      tHW: 0, tSC: 0, tSH: 0, tMD: 0, tLZ: 0, tHB: 0, mHW: 0, mSC: 0, mSH: 0, mMD: 0, mLZ: 0, mHB: 0, ind: 0, indM: 0 };
    const pT = new Float64Array(NPK), pM = new Float64Array(NPK);
    const skT = P.skimT, skK = P.skimK;
    const acc = hasMetro ? net.acc : null;
    const accOk = acc && acc.NZ === NZ && acc.facKey === fn.key;   // 接驳表与设施节点一致（城市刷新与网络同步之间的过渡状态下只用小区部分）
    const kmPerCell = CFG.CELL_M / 1000;
    P.desTot.fill(0); P.desMetro.fill(0); P.zTrips.fill(0); P.zMetro.fill(0); P.zAccess.fill(0);
    P.zDest.fill(0); P.zDestM.fill(0); P.fIn.fill(0); P.fInM.fill(0); P.fOut.fill(0); P.fOutM.fill(0); P.fP.fill(0);
    const BW = this.BW, ZW = this.ZW;
    if (!this.zoneBlock) this.zoneBlock = Int32Array.from({ length: Z }, function (_, z) { return (((z / ZW) | 0) >> 1) * BW + ((z % ZW) >> 1); });
    const blocks = this.zoneBlock;
    // The same directed OD can appear in several purpose flows. Cache only the winning
    // access-pair indices within this iteration, never rounded costs or stale results.
    if (hasMetro && (!buf.choice || buf.choice.length !== NZ * NZ)) buf.choice = new Int8Array(NZ * NZ);
    const choices = hasMetro ? buf.choice : null;
    if (choices) choices.fill(-2);
    const t = od.t;
    // 方式选择的输入与统计数组（每次迭代一次性组装，见 odOrigin）
    const S = new Float64Array(14);
    const K = { Z: Z, NZ: NZ, N: N, B: this.B, odStart: od.start, odDest: od.dest, t0: t[0], t1: t[1], t2: t[2], t3: t[3], t4: t[4], t5: t[5],
      co: co, cr: cr, cO: new Float64Array(NPK), cR: new Float64Array(NPK), facW: facW, facWe: facWe, odOk: od.F === F && od.key === fn.key,
      hostZ: hostZ, nx: nx, ny: ny, skT: skT, skK: skK, kmPerCell: kmPerCell,
      // fareFlat 允许被单次迭代覆盖（票价试算用）：这样试算不动 model.fare，不会污染主循环的状态
      cpk: prm.cpk, park: prm.park, vot: prm.vot, carAccess: prm.carAccess, walkW: prm.walkW, occ: prm.occ, theta: prm.theta,
      fareFlat: opts.fareFlat != null ? opts.fareFlat : this.fareFor(0),
      acc: acc, accOk: !!accOk, choices: choices, gtS: store ? store.gt : null, tmS: store ? store.tm : null, kmS: store ? store.km : null, DS: store ? store.D : null,
      perMin: IND.perMin, capSh: IND.cap.sh, capLz: IND.cap.lz,
      carDem: carDem, hasCar: hasCar, S: S, pT: pT, pM: pM, zTrips: P.zTrips, zMetro: P.zMetro, zAccess: P.zAccess, zJ: this.zJobs, blocks: blocks, desTot: P.desTot, desMetro: P.desMetro,
      zDest: P.zDest, zDestM: P.zDestM, fIn: P.fIn, fInM: P.fInM, fOut: P.fOut, fOutM: P.fOutM, fP: P.fP };
    let cnt = 0;
    for (let i = 0; i < Z; i++) {
      odOrigin(K, i);
      if ((++cnt & 7) === 0) yield;
    }
    st.trips = S[0]; st.metro = S[1]; st.car = S[2]; st.timeSum = S[3]; st.carTime = S[4]; st.metroTime = S[5]; st.fare = S[6]; st.metroPkm = S[7]; st.carPkm = S[8]; st.vkt = S[9];
    st.commTrips = S[10]; st.commTime = S[11]; st.ind = S[12]; st.indM = S[13];
    for (let k = 0; k < NPK; k++) { st[TKEY[k]] = pT[k]; st[MKEY[k]] = pM[k]; }
    // ---- 地铁客流加载与自动运营 ----
    if (hasMetro) {
      const nn = net.nNodes, nE = net.nE;
      let work = buf.metroLoad;
      if (!work || work.load.length !== nE || work.accN.length !== nn || work.stIn.length !== N) work = buf.metroLoad = { load: new Float32Array(nE), accN: new Float64Array(nn), stIn: new Float32Array(N), stOut: new Float32Array(N), stBoard: new Float32Array(N), walkIn: new Float32Array(N) };
      const load = work.load, accN = work.accN, stIn = work.stIn, stOut = work.stOut;
      load.fill(0); accN.fill(0); stIn.fill(0); stOut.fill(0);
      for (let s = 0; s < N; s++) {
        if (!metroLoadFrom(net, store, s, work)) continue;
        if ((s & 7) === 7) yield;
      }
      const lam = opts.metroLam || 0.5;
      for (let e = 0; e < nE; e++) { const old = P.load[e]; P.load[e] = old * (1 - lam) + load[e] * lam; if (!eq(old, P.load[e])) stable = false; }
      const stBoard = work.stBoard, walkIn = work.walkIn;
      stBoard.fill(0); walkIn.fill(0);
      for (let e = 0; e < nE; e++) {
        const ty = net.eType[e];
        if (ty === 0) stBoard[net.eSt[e]] += P.load[e];
        else if (ty === 3) walkIn[net.eSt[e]] += P.load[e];
      }
      const mc = CFG.metro;
      for (let s = 0; s < N; s++) {
        const oldIn = P.stIn[s], oldOut = P.stOut[s], oldDelay = P.stDelay[s];
        P.stIn[s] = P.stIn[s] * (1 - lam) + stIn[s] * lam;
        P.stOut[s] = P.stOut[s] * (1 - lam) + stOut[s] * lam;
        P.stBoard[s] = stBoard[s];
        P.stXfer[s] = Math.max(0, stBoard[s] - P.stIn[s] - walkIn[s]);
        const cap = mc.stationCap[net.C.stations[s].size];
        const ratio = (P.stIn[s] + P.stOut[s] + P.stXfer[s]) / cap;
        const dl = U.clamp((ratio - 0.8) * 10, 0, 12);
        P.stDelay[s] = P.stDelay[s] * 0.5 + dl * 0.5;
        if (!eq(oldIn, P.stIn[s]) || !eq(oldOut, P.stOut[s]) || !eq(oldDelay, P.stDelay[s])) stable = false;
      }
      // 自动配车：发车频率取「线路最低服务水平」（按站数、站距）与「最大断面客流所需」中的较大者
      for (let r = 0; r < net.R; r++) {
        const rt = net.C.routes[r], re = net.rideEdge[r];
        let mx = 0;
        for (let q = 0; q < re.length; q++) if (P.load[re[q]] > mx) mx = P.load[re[q]];
        const need = U.clamp(Math.max(mx / (rt.cap * mc.targetLF), Model.serviceFloor(rt, p)), 1, mc.fMax);
        const oldFreq = P.freq[r]; P.freq[r] = oldFreq * 0.55 + need * 0.45;
        if (!eq(oldFreq, P.freq[r])) stable = false;
        for (let q = 0; q < re.length; q++) {
          const e = re[q];
          const LF = P.load[e] / Math.max(1, P.freq[r] * rt.cap);
          let cf = 1;
          if (LF > 0.6) cf = 1 + 0.25 * Math.min(1, (LF - 0.6) / 0.4);
          if (LF > 1) cf = 1.25 + 1.6 * (LF - 1);
          const oldCrowd = P.crowd[e]; P.crowd[e] = Math.min(3.5, oldCrowd * 0.5 + cf * 0.5);
          if (!eq(oldCrowd, P.crowd[e])) stable = false;
          if (LF > 1) st.crowdPkm += P.load[e] * net.eKm[e];
        }
      }
    }
    // ---- 汽车分配 ----
    const road = this.road, nN = road.nN, nA = road.nA;
    let work = buf.roadWork;
    if (!work || work.aux.length !== nA || work.dist.length !== nN) work = buf.roadWork = { aux: new Float32Array(nA), dist: new Float64Array(nN), dkm: new Float32Array(nN), pred: new Int32Array(nN), order: new Int32Array(nN), accN: new Float64Array(nN), tolA: new Float32Array(nN) };
    const aux = work.aux;
    aux.fill(0); work.accN.fill(0);
    const rd = this.roadData, connStart = rd.start;
    const zPop = this.zPop, fullSkim = !!opts.fullSkim, iters = P.iters;
    const cw = { road: road, rd: rd, time: P.arcTime, work: work, heap: this.heap, skT: skT, skK: skK, carDem: carDem, Z: Z };
    // 懒更新判定：最短路只取决于车行时间。自上次全量分配以来，如果各路段时间的最大相对变化
    // 小于 LAZY_EPS、且连续懒分配没超过上限，那么绝大多数起点的最短路树根本没变 ——
    // 沿用上一轮的树、skim 与流量，只重算方式选择与客流。（配合每 N 轮强制一次全量，避免长期漂移）
    if (!opts.lazyCar && !fullSkim && P.timeFull && P.arcTime && (P.lazyStreak || 0) < LAZY_MAX) {
      let moved = 0;
      // 「这条路变了没有」的判据：车行时间的变化是否已经超过这条路上的人肯为它改道的量。
      // 按百分比判等于是「相对速度变了 1% 就算变」：250 m 的路 1% 只有 1 秒，10 km 的路 1% 是 20 秒，
      // 而两条路对路径选择的份量是一样的（都只是「一段路」）。所以门槛也按长度给：
      // 变化超过 lazyTolKm × 弧长，才算这一段真的变了。lazyTolKm = 0 时退回老的百分比口径。
      const lzKm = (CFG.road && CFG.road.lazyTolKm) || 0;
      const arcKm = rd.arcKm;
      for (let a = 0; a < nA; a++) {
        const dtm = Math.abs(P.arcTime[a] - P.timeFull[a]);
        if (lzKm > 0 ? dtm > lzKm * arcKm[a] : dtm / (P.timeFull[a] || 1) > LAZY_EPS) moved++;
      }
      // 用「变动路段占比」而不是最大值：MSA 迭代里总有个别低流量路段的相对变化很大，
      // 按最大值判定几乎永远不会懒，按占比才反映「绝大多数最短路没动」这个事实。
      if (moved <= nA * LAZY_FRAC) opts = Object.assign({}, opts, { lazyCar: true });
    }
    // 懒更新：快进过月时路网与拥堵时间都没变，最短路树、skim 与流量都可以沿用上一轮，
    // 只重算方式选择与地铁客流（约 10% 的开销）。流量沿用后，下面的拥堵统计仍按新需求重算。
    const group = opts.group || null;
    const replay = opts.replay || null, capture = opts.capture || null;
    if (!opts.lazyCar) for (let o = 0; o < Z; o++) {
      const c0 = connStart[o], c1 = connStart[o + 1];
      if (c0 === c1) continue;
      if (!hasCar[o] && !(fullSkim && zPop[o] > 0) && iters > 0) continue;
      const tr = replay ? replay[o] : null;
      if (tr) { if (!carOriginReplay(cw, tr, o, stable)) stable = false; }
      else if (group && group.ref) carOriginReuse(cw, group, o, capture);
      else if (!carOrigin(cw, o, stable, group, capture)) stable = false;
      if ((o & 1) === 1) yield;
    }
    if (group && !group.ref) { group.ref = P; group.refT = P.skimT; group.refK = P.skimK; } else if (P.arcVol) {
      // 沿用的流量直接当作本轮分配结果（aux 不再参与）。这里**不要**把 stable 置 false：
      // 懒分配的语义就是「输入没变、输出必然不变」，那就是稳定的。早前为了防止「懒过一次
      // 就永久冻结」加了 stable = false，结果「连续两轮稳定」永远不成立，只能靠轮数上限硬刹，
      // 后 2-3 轮纯粹空转（实测 32 次求解里 24 次是懒、0 次跳过）。有地铁的时段由地铁自己的
      // eq() 检查继续把 stable 拉回来，所以删掉它不会让地铁少收敛。
    }
    const lam = P.iters === 0 ? 1 : (opts.lam || CFG.road.msa);
    const A = CFG.road.bprA, capF = this.capF || 1;
    for (let a = 0; a < nA; a++) {
      const oldVol = P.arcVol[a], oldTime = P.arcTime[a];
      const v = opts.lazyCar ? oldVol : oldVol * (1 - lam) + aux[a] * lam;
      P.arcVol[a] = v;
      const x = v / (road.arcCap[a] * capF);
      P.arcTime[a] = road.arcT0[a] * Math.min(8, 1 + A * x * x * x * x);
      if (!eq(oldVol, P.arcVol[a]) || !eq(oldTime, P.arcTime[a])) stable = false;
      st.congNum += v * road.arcLen[a] * (P.arcTime[a] / road.arcT0[a]);
      st.congDen += v * road.arcLen[a];
    }
    P.iters++;
    if (opts.lazyCar) P.lazyStreak = (P.lazyStreak || 0) + 1;
    else if (!fullSkim) { P.timeFull = Float32Array.from(P.arcTime); P.lazyStreak = 0; }
    // 收敛判据要用**平滑前**的原始值：平滑是给显示用的低通（每轮把差距压到 0.6 倍），
    // 拿平滑值去比会让「差 0.2% 以内」多等十几轮 —— 大图上正是它让求解永远不收敛。
    if (stable && P.rawStats) for (const k in st) if (!eq(st[k], P.rawStats[k])) { stable = false; break; }
    P.rawStats = st;
    // 统计平滑（显示更平稳）
    if (P.stats && !opts.noSmooth) {
      const o = P.stats, out = {};
      for (const k in st) out[k] = o[k] !== undefined ? o[k] * 0.4 + st[k] * 0.6 : st[k];
      P.stats = out;
    } else P.stats = st;
    P.facKey = fn.key;   // 数组下标只属于本次迭代使用的设施表，不能按新的设施顺序解读。
    P.stable = stable;
  };

  // ---------------- 实时求解循环 ----------------
  // 工作日与周末两套结果都保持收敛：先算当天的日类型，再算另一类；两套都到达精确不动点后停止
  Model.prototype.liveLoop = function* () {
    for (;;) {
      const order = this.dayType === 'we' ? ['we', 'wd'] : ['wd', 'we'];
      for (const dt of order) {
        const ctx = this.ctxs[dt];
        for (let p = 0; p < NP; p++) {
          // 缓存只在「这个月的第一个 cycle」决策一次。注意不能拿 fullSkim 当判据：
          // refreshCityGen 里是 setNetwork(..., true)，sinceChange 不归零，月首那一轮并不是 fullSkim。
          const firstCycle = this.solveCycles === 0;
          let rep = null, cap = null;
          if (firstCycle) {
            rep = this.treeReplayFor(dt, p);
            if (!rep) cap = this.treeCaptureFor(dt, p);
          }
          yield* this.iterate(this.net, ctx.per[p], p, { fullSkim: this.sinceChange < 1, replay: rep, capture: cap });
          this.computeDaily();
        }
      }
      this.cycles++; this.sinceChange++; this.solveCycles = (this.solveCycles || 0) + 1;
      const allStable = DT.every(function (dt) { return this.ctxs[dt].per.every(function (P) { return P.stable; }); }, this);
      this.quietCycles = allStable ? (this.quietCycles || 0) + 1 : 0;
      // 停在「连续两轮相对变化都在 1% 以内」；另外给一个轮数上限 ——
      // 大图上 MSA 要十几轮才真正收敛，交互式不能让后台一直转下去。
      const cap = (CFG.perf && CFG.perf.maxSolveCycles) || 4;
      if (this.quietCycles >= 2 || this.solveCycles >= cap) {
        this.settled = true;
        this.settledAt = { year: this.year, fare: this.fare.flat, city: this.city.version, road: this.city.roadVersion, net: this.net, od: this.od };
        // 收敛完就把树按**最终弧时**重建一遍，下个月初直接命中（gap = 0）。后台分片跑。
        yield* this.prebuildGen();
        yield;
      }
    }
  };
  Model.prototype.step = function (budget) {
    if (this.refreshing) return;
    const t0 = performance.now();
    if (this.predJob) {
      const pj = this.predJob;
      while (performance.now() - t0 < budget * 2.2) {
        const r = pj.gen.next();
        if (r.done) { this.predJob = null; pj.done(r.value); break; }
      }
      return;
    }
    if (this.settled && !this.prebuilding) {
      const at = this.settledAt;
      if (at.year === this.year && at.fare === this.fare.flat && at.city === this.city.version && at.road === this.city.roadVersion && at.net === this.net && at.od === this.od) return;
      this.wake();
    }
    if (!this.gen) this.gen = this.liveLoop();
    while ((!this.settled || this.prebuilding) && performance.now() - t0 < budget) this.gen.next();
  };
  // 快速收敛（读档、跳月等场合），同步执行；dts 为要求解的日类型（默认工作日与周末）
  Model.prototype.solveNow = function (cycles, dts, opts) {
    const g = this.solveGen(cycles, dts, opts);
    for (let r = g.next(); !r.done; r = g.next()) { /* run */ }
  };
  // 一次载入的第一个 cycle：8 个时段（2 日型 × 4 时段）的车行时间全都还是自由流、逐位相同，
  // 于是 2880 个起点 × 8 个时段的 23,040 棵树其实是 2,880 棵。这里先检查「时间真的逐位相同」，
  // 再把第一个时段的树与接驳点缓存下来，后面 7 个时段只做注入与回溯。
  // 缓存约 起点数 × 节点数 × 4B + 小区数² × 2B（大图 88 MB），只在这一个 cycle 内存在。
  Model.prototype.freeGroupFor = function (dts) {
    const perf = CFG.perf || {};
    if (perf.freeCycle === false) return null;
    const Z = this.Z, nN = this.road.nN, nA = this.road.nA;
    if (nN > 65535 || nA > 32766) return null;      // 树按 16 位打包，超出就退回逐时段建树
    const per = [];
    for (const dt of dts) for (const P of this.ctxs[dt].per) per.push(P);
    if (per.length < 2) return null;
    for (const P of per) if (P.iters !== 0) return null;   // 只有全新的时段表才可能逐位相同
    const ref = per[0].arcTime, n = ref.length;
    for (const P of per) {
      if (P.arcTime.length !== n) return null;
      for (let i = 0; i < n; i++) if (P.arcTime[i] !== ref[i]) return null;
    }
    const bytes = Z * nN * 4 + Z * Z * 2;
    if (bytes > (perf.freeCycleMaxMB || 220) * 1e6) return null;
    let G = this.freeGroup;
    if (!G || G.Z !== Z || G.nN !== nN) {
      G = this.freeGroup = { Z: Z, nN: nN, tree: new Int32Array(Z * nN), cnt: new Int32Array(Z), bn: new Int16Array(Z * Z) };
    } else G.cnt.fill(0);
    G.bn.fill(-1);
    G.ref = null; G.refT = null; G.refK = null;
    return G;
  };
  Model.prototype.dropFreeGroup = function () { this.freeGroup = null; };

  // ---------------- 跨月最短路树缓存 ----------------
  // 上个月每个起点的树按弧号序列存下来（2 B/点），下个月第一个 cycle 直接重放。
  // 逐位一致的依据：同一组弧 + 同一组时间算出来的 dist 是确定的；重放时的遍历顺序
  // （目的地升序注入、回溯按 settle 逆序）与原实现完全一致，所以 aux 的浮点累加顺序也不变。
  // 唯一的近似来自「路径是上个月的」：上个月到现在的 arcTime 变了，最短路可能已经不同。
  Model.prototype.treeCacheBudget = function () {
    const perf = CFG.perf || {};
    if (perf.treeCache === false) return 0;
    return (perf.treeCacheMaxMB || 320) * 1e6;
  };
  // 取某个时段的缓存在哪；没有就按需建（返回 Array(Z)，元素为 {no, arcs} 或 null）
  Model.prototype.treeCaptureFor = function (dt, p) {
    const perf = CFG.perf || {};
    if (perf.treeCache === false) return null;
    if (!this.treeCacheBudget()) return null;
    const Z = this.Z, nN = this.road.nN, nA = this.road.nA;
    if (nN > 65000 || nA > 32000) return null;   // 弧号按 Int16 存，超出就退回逐时段建树
    let c = this.treeCache;
    if (!c) {
      // 上界估算：起点数 × 节点数 × 2 B × 8 个时段。超预算就整个不做（不半途分配再回收）
      if (Z * nN * 2 * 8 > this.treeCacheBudget()) return null;
      c = this.treeCache = {
        per: Object.create(null), nA: nA, age: 0,
        nodeVert: Int32Array.from(this.road.nodeVert),
        arcFrom: Int32Array.from(this.road.arcFrom),
        arcTo: Int32Array.from(this.road.arcTo),
        arcLen: Float32Array.from(this.road.arcLen),
      };
    }
    const key = dt + '|' + p;
    if (!c.per[key]) c.per[key] = new Array(Z).fill(null);
    return c.per[key];
  };
  Model.prototype.treeReplayFor = function (dt, p) {
    const c = this.treeCache;
    // 只认「月末预建已经跑完」的缓存：那时候的树是用**当前**弧时建的，
    // 下个月初沿用就是逐位精确的（实测 gap = 0.00%，见 tools/tree-lazy-probe.mjs）。
    // 预建被打断（玩家提前推进）时 c.fresh 是 false，这里返回 null，月初退回全量重建 ——
    // 也就是原来的行为，不会引入误差。
    if (!c || !c.fresh) return null;
    const list = c.per[dt + '|' + p];
    return list || null;
  };

  // 月末预建：收敛后用**最终弧时**把 8 个时段的树全部重建一遍。
  // 为什么必须在这里做：月初第一轮的时间就是「上月末收敛值」，而现在缓存的树是
  // 「上个月月初」建的，中间隔了一整个 MSA 收敛周期 —— wd-0/wd-2 的 gap 会到 6.8%~14.8%。
  // 在月末建，下个月初的输入与建树时的输入逐位相同，gap 归零。
  Model.prototype.prebuildGen = function* () {
    const perf = CFG.perf || {};
    if (perf.treeCache === false || perf.prebuild === false) return;
    if (!this.treeCacheBudget()) return;
    const nN = this.road.nN, nA = this.road.nA, Z = this.Z;
    if (nN > 65000 || nA > 32000) return;
    let c = this.treeCache;
    if (!c) {
      if (Z * nN * 2 * 8 > this.treeCacheBudget()) return;
      c = this.treeCache = { per: Object.create(null), nA: nA, age: 0 };
    }
    // 建树专用缓冲：不借用 iterate 的工作区，预建被丢弃时不会污染下一轮重放
    const w = this._pbWork && this._pbWork.dist.length === nN ? this._pbWork : (this._pbWork = {
      dist: new Float64Array(nN), dkm: new Float32Array(nN),
      pred: new Int32Array(nN), order: new Int32Array(nN),
      accN: new Float64Array(nN), aux: new Float64Array(nA), tolA: new Float32Array(nN),
      heapK: new Float64Array(nA + 4), heapV: new Int32Array(nA + 4),
    });
    const road = this.road, rd = this.roadData;
    c.fresh = false;
    this.prebuilding = true;
    try {
      for (const dt of DT) {
        for (let p = 0; p < NP; p++) {
          const P = this.ctxs[dt].per[p];
          if (!P) continue;
          const time = P.arcTime;
          const list = new Array(Z).fill(null);
          for (let o = 0; o < Z; o++) {
            if (rd.start[o] === rd.start[o + 1]) continue;
            const no = roadTree(road, rd, time, o, w, this.heap);
            const a = new Int16Array(no), ord = w.order, pr = w.pred;
            for (let i = 0; i < no; i++) a[i] = pr[ord[no - 1 - i]];
            list[o] = { no: no, arcs: a };
            if ((o & 7) === 7) yield;
          }
          c.per[dt + '|' + p] = list;
          c.nA = nA;
          c.nodeVert = Int32Array.from(road.nodeVert);
          c.arcFrom = Int32Array.from(road.arcFrom);
          c.arcTo = Int32Array.from(road.arcTo);
          c.arcLen = Float32Array.from(road.arcLen);
          yield;
        }
      }
      c.fresh = true;          // 全部完成才认；中断时保持 false
    } finally {
      this.prebuilding = false;
    }
  };
  // 路网换了：旧树的弧号还认不认得出。
  // 先试「旧弧号原样仍然成立」（新路只在末尾追加时就是这种情况，比较前缀即可）；
  // 不行就按**顶点对**重映射 —— 顶点号来自城市网格，跨月稳定，而 link.key 里含折点数，
  // 一条路被延伸或拆分就会变，按 key 比会把「路还在、只是编号变了」误判成消失。
  // 映射不到的弧标记 -2：只废掉它下面那一根子树，整棵树其余部分继续用。
  // 弧身份键：顶点对 + 弧长（米）。顶点号来自城市网格，跨月稳定；弧长用来区分平行弧。
  function arcKey(from, to, len) { return from + ',' + to + ',' + Math.round(len); }

  Model.prototype.syncTreeCache = function (oldRoad, newRoad) {
    const c = this.treeCache;
    if (!c) return;
    const nOld = c.nA, nNew = newRoad.nA;
    let same = nNew >= nOld;
    if (same) {
      for (let a = 0; a < nOld; a++) {
        if (c.arcFrom[a] !== newRoad.arcFrom[a] || c.arcTo[a] !== newRoad.arcTo[a]) { same = false; break; }
      }
    }
    let lost = 0;
    let lut = null;
    if (!same) {
      // 顶点对不够：立交、跨线桥会让同一对端点之间有两条弧（广州大图 176 对）。
      // 只按顶点对建索引，后一条会覆盖前一条，旧树的弧号就会被翻到错误的平行弧上
      // （高架桥当成地面道路），距离随之算错。加上弧长才能唯一确定 —— 路还是那条路，
      // 长度跨月稳定。
      const byPair = new Map();
      for (let a = 0; a < nNew; a++) byPair.set(arcKey(newRoad.arcFrom[a], newRoad.arcTo[a], newRoad.arcLen[a]), a);
      lut = new Int32Array(nOld).fill(-2);
      for (let a = 0; a < nOld; a++) {
        const vf = c.nodeVert[c.arcFrom[a]], vt = c.nodeVert[c.arcTo[a]];
        const nf = newRoad.vertNode[vf], nt = newRoad.vertNode[vt];
        if (nf < 0 || nt < 0) { lost++; continue; }
        const hit = byPair.get(arcKey(nf, nt, c.arcLen[a]));
        if (hit === undefined) { lost++; continue; }
        lut[a] = hit;
      }
    }
    // 这个月路网动了多少：判「旧树还可不可信」的依据。动得太多就直接丢掉缓存，
    // 这个月本来也要重建（重建时 treeCaptureFor 会重新建一份），省下重写的开销。
    const churn = lost + Math.max(0, nNew - nOld);
    const churnMax = Math.max(12, nOld * 0.002);
    if (churn > churnMax) { this.treeCache = null; return; }
    if (lut) {
      let blocked = 0, entries = 0;
      for (const key in c.per) {
        const list = c.per[key];
        for (let o = 0; o < list.length; o++) {
          const tr = list[o];
          if (!tr) continue;
          const src = tr.arcs, a = new Int16Array(src.length);
          for (let i = 0; i < src.length; i++) {
            const e = src[i];
            entries++;
            if (e < 0) { a[i] = -1; continue; }
            const ne = lut[e];
            if (ne < 0) { a[i] = -2; blocked++; } else a[i] = ne;
          }
          tr.arcs = a;
        }
      }
      c.lastRemap = { lost: lost, blocked: blocked, entries: entries };
    }
    c.churn = churn;
    c.nA = nNew;
    c.nodeVert = Int32Array.from(newRoad.nodeVert);
    c.arcFrom = Int32Array.from(newRoad.arcFrom);
    c.arcTo = Int32Array.from(newRoad.arcTo);
  };
  Model.prototype.solveGen = function* (cycles, dts, opts) {
    this.wake();
    dts = dts || DT;
    opts = opts || {};
    let group = null;
    for (let c = 0; c < cycles; c++) {
      if (c === 0 && !opts.noGroup) group = this.freeGroupFor(dts);
      for (const dt of dts) for (let p = 0; p < NP; p++) {
        const P = this.ctxs[dt].per[p];
        // 第一个 cycle 是唯一的全量分配：有可用缓存就整段重放，否则重建并顺手存下来
        let rep = null, cap = null;
        if (c === 0 && !opts.lazyCar && opts.noCache !== true) {
          rep = this.treeReplayFor(dt, p);
          if (!rep) cap = this.treeCaptureFor(dt, p);
        }
        yield* this.iterate(this.net, P, p, Object.assign({ fullSkim: c === 0 }, opts, group ? { group: group } : null, { replay: rep, capture: cap }));
      }
      if (group) { this.dropFreeGroup(); group = null; }
    }
    this.computeDaily();
    this.gen = null;
  };

  // ---------------- 汇总指标 ----------------
  Model.prototype.aggregate = function (perList, net) {
    const D = { trips: 0, metro: 0, car: 0, timeSum: 0, commTrips: 0, commTime: 0, fare: 0, metroPkm: 0, vkt: 0, carPkm: 0, congNum: 0, congDen: 0, crowdPkm: 0, carKm: 0, metroTime: 0, carTime: 0 };
    let ok = true;
    for (let p = 0; p < NP; p++) {
      const P = perList[p];
      if (!P || !P.stats) { ok = false; continue; }
      const h = this.pHours[p], s = P.stats;
      const mf = p === 3 ? 0.9 : 1;
      for (const k in s) D[k] = (D[k] || 0) + s[k] * h * (METRO_KEYS.has(k) ? mf : 1);
      if (net && net.R) {
        for (let r = 0; r < net.R; r++) {
          const rt = net.C.routes[r];
          const svcH = p === 3 ? 5 : h;
          D.carKm += P.freq[r] * 2 * (rt.lenM / 1000) * rt.cars * svcH;
        }
      }
    }
    D.ready = ok;
    return this.finishDaily(D, perList[0] && perList[0].stats, net);
  };
  Model.prototype.finishDaily = function (D, am, net) {
    D.metroShare = D.trips > 0 ? D.metro / D.trips : 0;
    D.avgTime = D.trips > 0 ? D.timeSum / D.trips : 0;
    D.commute = D.commTrips > 0 ? D.commTime / D.commTrips : 0;
    D.cong = D.congDen > 0 ? D.congNum / D.congDen : 1;
    if (am !== undefined) D.congAM = am && am.congDen > 0 ? am.congNum / am.congDen : D.cong;
    D.crowdShare = D.metroPkm > 0 ? D.crowdPkm / D.metroPkm : 0;
    D.avgFare = D.metro > 0 ? D.fare / D.metro : 0;
    D.coverage = net ? net.acc.coverage : 0;
    return D;
  };
  // 周平均日：5 个工作日 + 2 个周末日加权（可加总的量按权重相加，比例重新计算）
  Model.prototype.weekAvg = function (a, b, net) {
    const W = CFG.trips.weekWeights, D = {};
    for (const k in a) if (typeof a[k] === 'number' && typeof b[k] === 'number') D[k] = a[k] * W.wd + b[k] * W.we;
    this.finishDaily(D, undefined, net);
    D.congAM = a.congAM;   // 早高峰拥堵：工作日
    D.ready = !!(a.ready && b.ready);
    D.dt = 'avg';
    return D;
  };
  // 按车站汇总日客流
  Model.prototype.stationDaily = function (per, net) {
    const N = net.N;
    const sIn = new Float32Array(N), sOut = new Float32Array(N), sX = new Float32Array(N), peak = new Float32Array(N);
    const rBoard = new Float32Array(net.R);
    for (let p = 0; p < NP; p++) {
      const P = per[p], h = this.pHours[p] * (p === 3 ? 0.9 : 1);
      if (!P.stIn || P.stIn.length !== N) continue;
      for (let s = 0; s < N; s++) {
        sIn[s] += P.stIn[s] * h; sOut[s] += P.stOut[s] * h; sX[s] += P.stXfer[s] * h;
        const f = P.stIn[s] + P.stOut[s] + P.stXfer[s];
        if (f > peak[s]) peak[s] = f;
      }
      for (let r = 0; r < net.R; r++) { const be = net.boardEdge[r]; for (let q = 0; q < be.length; q++) rBoard[r] += P.load[be[q]] * h; }
    }
    return { inn: sIn, out: sOut, xfer: sX, peak: peak, routeBoard: rBoard };
  };
  // 重要设施与小区吸引的日汇总（设施：到达 inn / 离开 out 及其中乘地铁的部分、分目的到达；小区：分目的吸引与地铁部分、出发总量）
  Model.prototype.attractDaily = function (per) {
    const Z = this.Z, F = this.fn.F;
    const o = { inn: new Float32Array(F), innM: new Float32Array(F), out: new Float32Array(F), outM: new Float32Array(F), purp: new Float32Array(NPK * F),
      dest: new Float32Array(NPK * Z), destM: new Float32Array(NPK * Z), trips: new Float32Array(Z), metro: new Float32Array(Z), F: F, key: this.fn.key, ready: true };
    for (let p = 0; p < NP; p++) {
      const P = per[p], h = this.pHours[p], hm = h * (p === 3 ? 0.9 : 1);
      if (!P.stats || !P.fIn || P.fIn.length !== F || P.facKey !== o.key) { o.ready = false; continue; }
      for (let k = 0; k < F; k++) { o.inn[k] += P.fIn[k] * h; o.innM[k] += P.fInM[k] * hm; o.out[k] += P.fOut[k] * h; o.outM[k] += P.fOutM[k] * hm; }
      for (let k = 0; k < NPK * F; k++) o.purp[k] += P.fP[k] * h;
      for (let k = 0; k < NPK * Z; k++) { o.dest[k] += P.zDest[k] * h; o.destM[k] += P.zDestM[k] * hm; }
      for (let z = 0; z < Z; z++) { o.trips[z] += P.zTrips[z] * h; o.metro[z] += P.zMetro[z] * hm; }
    }
    return o;
  };
  Model.prototype.computeDaily = function () {
    const net = this.net;
    const dW = this.aggregate(this.ctxs.wd.per, net), dE = this.aggregate(this.ctxs.we.per, net);
    dW.dt = 'wd'; dE.dt = 'we';
    this.dailyWk = dW; this.dailyWe = dE;
    this.daily = this.weekAvg(dW, dE, net);
    this.dailyNow = this.dayType === 'we' ? dE : dW;
    if (net) {
      const a = this.stationDaily(this.ctxs.wd.per, net), b = this.stationDaily(this.ctxs.we.per, net), W = CFG.trips.weekWeights;
      const mix = function (x, y) { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] * W.wd + y[i] * W.we; return o; };
      const peak = new Float32Array(net.N); for (let i = 0; i < net.N; i++) peak[i] = Math.max(a.peak[i], b.peak[i]);
      this.stDailyWk = a; this.stDailyWe = b;
      this.stDaily = { inn: mix(a.inn, b.inn), out: mix(a.out, b.out), xfer: mix(a.xfer, b.xfer), peak: peak, routeBoard: mix(a.routeBoard, b.routeBoard) };
      this.dailyStale = false;
    }
    this.facDaily = { wd: this.attractDaily(this.ctxs.wd.per), we: this.attractDaily(this.ctxs.we.per) };
    // 小区可达性（用于城市发展）：工作日早高峰
    const za = this.ctxs.wd.per[0].zAccess;
    let mx = 0; for (let z = 0; z < this.Z; z++) if (za[z] > mx) mx = za[z];
    this.zoneAccessNorm = new Float32Array(this.Z);
    if (mx > 0) for (let z = 0; z < this.Z; z++) this.zoneAccessNorm[z] = Math.sqrt(za[z] / mx);
    this.version++;
  };
  // 设施启停期间只提供与当前设施表对应且四时段均已完成的数据。
  Model.prototype.facData = function (dt) {
    const o = this.facDaily && this.facDaily[dt === 'we' ? 'we' : 'wd'];
    return o && o.ready && o.key === this.fn.key ? o : null;
  };
  // 重要设施的日统计（dt：wd / we / avg）
  Model.prototype.facStats = function (id, dt) {
    const k = this.facIndex(id); if (k < 0 || !this.facDaily) return null;
    const one = function (o) {
      if (!o || o.F <= k) return null;
      const purp = {}; for (let q = 0; q < NPK; q++) purp[PK[q]] = o.purp[k * NPK + q];
      return { inn: o.inn[k], innM: o.innM[k], out: o.out[k], outM: o.outM[k], purp: purp };
    };
    if (dt === 'wd' || dt === 'we') return one(this.facData(dt));
    const a = one(this.facData('wd')), b = one(this.facData('we')), W = CFG.trips.weekWeights;
    if (!a || !b) return null;
    const purp = {}; for (const q of PK) purp[q] = a.purp[q] * W.wd + b.purp[q] * W.we;
    return { inn: a.inn * W.wd + b.inn * W.we, innM: a.innM * W.wd + b.innM * W.we, out: a.out * W.wd + b.out * W.we, outM: a.outM * W.wd + b.outM * W.we, purp: purp };
  };

  // ---------------- 画面用：时刻插值 ----------------
  Model.prototype.profileAt = function (minute) {
    const h = minute / 60 - 0.5;
    const h0 = Math.floor(h), t = h - h0;
    const a = this.profile[(h0 + 24) % 24], b = this.profile[(h0 + 25) % 24];
    return a + (b - a) * t;
  };
  Model.prototype.weights = function (minute) {
    const m = ((minute % 1440) + 1440) % 1440;
    const hr = Math.floor(m / 60);
    const p0 = this.hourPeriod[hr];
    const frac = (m % 60) / 60;
    let p1 = p0, w1 = 0;
    if (frac > 0.75) { const pn = this.hourPeriod[(hr + 1) % 24]; if (pn !== p0) { p1 = pn; w1 = (frac - 0.75) / 0.5; } }
    else if (frac < 0.25) { const pp = this.hourPeriod[(hr + 23) % 24]; if (pp !== p0) { p1 = pp; w1 = (0.25 - frac) / 0.5; } }
    const prof = this.profileAt(m);
    const w0 = 1 - w1;
    return { p0: p0, w0: w0, s0: prof / this.pMean[p0], p1: p1, w1: w1, s1: prof / this.pMean[p1], svc: (m >= 360 || m < 5) ? 1 : 0, prof: prof };
  };
  Model.prototype.arcVolAt = function (a, W) {
    const P0 = this.live.per[W.p0], P1 = this.live.per[W.p1];
    return P0.arcVol[a] * W.w0 * W.s0 + P1.arcVol[a] * W.w1 * W.s1;
  };
  Model.prototype.arcRatioAt = function (a, W) {
    const v = this.arcVolAt(a, W), x = v / this.cap(a);
    return Math.min(8, 1 + CFG.road.bprA * x * x * x * x);
  };
  Model.prototype.cityCongAt = function (W) {
    const road = this.road; let num = 0, den = 0;
    const capF = this.capF || 1;
    for (let a = 0; a < road.nA; a++) {
      const v = this.arcVolAt(a, W); if (v <= 0) continue;
      const x = v / (road.arcCap[a] * capF);
      num += v * road.arcLen[a] * Math.min(8, 1 + CFG.road.bprA * x * x * x * x); den += v * road.arcLen[a];
    }
    return den > 0 ? num / den : 1;
  };
  // 线路最低服务水平（列/小时）：车站越多、站距越小的城区线越密，站距大的郊区线较疏；非环线保证至少 2 列车在线运行
  Model.serviceFloor = function (rt, p) {
    const mc = CFG.metro;
    if (!rt) return mc.fMin[p];
    const ns = rt.stIdx.length, sp = rt.lenM / 1000 / Math.max(1, rt.loop ? ns : ns - 1);
    const fs = U.clamp(1.5 - 0.35 * sp, 0.7, 1.3);          // 平均站距 1 km → 1.15；2.3 km 以上 → 0.7
    const fn = U.clamp(0.82 + ns / 45, 0.85, 1.3);          // 8 站 → 1.0；22 站以上 → 1.3
    let f = mc.fMin[p] * fs * fn;
    if (!rt.loop && rt.cycleSec > 0) f = Math.max(f, 2 * 3600 / rt.cycleSec);
    return Math.min(f, mc.fMax);
  };
  Model.prototype.freqAt = function (r, W) {
    if (!this.net || !W.svc) return 0;
    return this.live.per[W.p0].freq[r] * W.w0 + this.live.per[W.p1].freq[r] * W.w1;
  };
  Model.prototype.stFlowAt = function (s, W, kind) {
    const P0 = this.live.per[W.p0], P1 = this.live.per[W.p1];
    const k = kind || 'stIn';
    return (P0[k][s] * W.w0 * W.s0 + P1[k][s] * W.w1 * W.s1) * W.svc;
  };
  Model.prototype.edgeLoadAt = function (e, W) {
    const P0 = this.live.per[W.p0], P1 = this.live.per[W.p1];
    return (P0.load[e] * W.w0 * W.s0 + P1.load[e] * W.w1 * W.s1) * W.svc;
  };

  // ---------------- 建设前预测 ----------------
  // 基于同一城市状态与票价，比较当前网络与草案网络（均从当前运行状态热启动，迭代次数相同）；工作日与周末分别计算
  // ---------------- 票价试算 ----------------
  // 票价只作用于方式选择（odOrigin 里的 pMc），但方式改变会反过来影响接驳与频次，
  // 所以要给出可信的「改票价后客流与票款」，只能真的重跑一遍分配。
  // 这里在独立缓冲上跑，不动 this.fare 与主循环状态；分帧执行，不阻塞界面。
  Model.prototype.predictFare = function (fareVals, done) {
    const self = this, net = this.net;
    const gen = (function* () {
      const out = [];
      const total = Math.max(1, fareVals.length * DT.length * NP * 2);
      let prog = 0;
      for (const fv of fareVals) {
        const per = [];
        for (const dt of DT) {
          const perDt = [];
          for (let p = 0; p < NP; p++) {
            const L = self.ctxs[dt].per[p];
            if (!L || !L.stats) { perDt.push(null); continue; }
            const P = {
              arcVol: Float32Array.from(L.arcVol), arcTime: Float32Array.from(L.arcTime), skimT: Float32Array.from(L.skimT), skimK: Float32Array.from(L.skimK),
              desTot: new Float32Array(self.B * self.B), desMetro: new Float32Array(self.B * self.B), zTrips: new Float32Array(self.Z), zMetro: new Float32Array(self.Z), zAccess: new Float32Array(self.Z),
              stats: null, iters: Math.max(1, L.iters), dt: dt,
            };
            self.allocStatArrays(P);
            self.initMetroPer(P, net, p, L, self.net);
            const its = p === 3 ? 1 : 2;
            for (let it = 0; it < its; it++) {
              yield* self.iterate(net, P, p, { noSmooth: true, metroLam: it === 0 ? 0.7 : 0.6, buf: self.predBuf, fareFlat: fv });
              prog++;
            }
            perDt.push(P);
          }
          per.push(perDt);
        }
        const dW = self.aggregate(per[0], net), dE = self.aggregate(per[1], net);
        const d = self.weekAvg(dW, dE, net);
        out.push({ fare: fv, metro: d.metro || 0, trips: d.trips || 0, revenue: d.fare || 0, share: d.metroShare || 0 });
        yield;
      }
      return out;
    })();
    this.predJob = { gen: gen, done: done };
    return gen;
  };

  Model.prototype.predict = function (draftC, affectedLineIds, done) {
    const self = this;
    const gen = (function* () {
      const result = { conditions: { year: self.year, fare: Object.assign({}, self.fare) }, progress: 0 };
      self.predState = result;
      const baseNet = self.net, draftNet = self.buildMetro(draftC);
      yield;
      const runFor = function* (net, dt, prog) {
        const per = [];
        for (let p = 0; p < NP; p++) {
          const L = self.ctxs[dt].per[p];
          const P = {
            arcVol: Float32Array.from(L.arcVol), arcTime: Float32Array.from(L.arcTime), skimT: Float32Array.from(L.skimT), skimK: Float32Array.from(L.skimK),
            desTot: new Float32Array(self.B * self.B), desMetro: new Float32Array(self.B * self.B), zTrips: new Float32Array(self.Z), zMetro: new Float32Array(self.Z), zAccess: new Float32Array(self.Z),
            stats: null, iters: Math.max(1, L.iters), dt: dt,
          };
          self.allocStatArrays(P);
          self.initMetroPer(P, net, p, L, self.net);
          const its = p === 3 ? 1 : 2;
          for (let it = 0; it < its; it++) {
            yield* self.iterate(net, P, p, { noSmooth: true, metroLam: it === 0 ? 0.7 : 0.6, buf: self.predBuf });
            result.progress = prog + (p * 2 + it + 1) / 32;
          }
          // 仅保留结果所需
          per.push({ stats: P.stats, freq: P.freq, load: P.load, stIn: P.stIn, stOut: P.stOut, stXfer: P.stXfer, arcVol: p === 0 ? P.arcVol : null, arcTime: p === 0 ? P.arcTime : null,
            fIn: P.fIn, fInM: P.fInM, fOut: P.fOut, fOutM: P.fOutM, fP: P.fP, zDest: P.zDest, zDestM: P.zDestM, zTrips: P.zTrips, zMetro: P.zMetro });
        }
        return per;
      };
      result.progress = 0;
      const base = baseNet ? { wd: yield* runFor(baseNet, 'wd', 0), we: yield* runFor(baseNet, 'we', 0.25) } : null;
      const draft = { wd: yield* runFor(draftNet, 'wd', 0.5), we: yield* runFor(draftNet, 'we', 0.75) };
      const empty = function () { return self.aggregate([0, 1, 2, 3].map(function () { return null; }), null); };
      const B = base ? { wd: self.aggregate(base.wd, baseNet), we: self.aggregate(base.we, baseNet) } : { wd: empty(), we: empty() };
      const Dr = { wd: self.aggregate(draft.wd, draftNet), we: self.aggregate(draft.we, draftNet) };
      result.base = self.weekAvg(B.wd, B.we, baseNet); result.draft = self.weekAvg(Dr.wd, Dr.we, draftNet);
      result.wk = { base: B.wd, draft: Dr.wd }; result.we = { base: B.we, draft: Dr.we };
      // 出行目的：地铁出行（人次/日），工作日与周末
      result.purpose = PK.map(function (k, q) { return { key: k, wd0: B.wd[MKEY[q]] || 0, wd1: Dr.wd[MKEY[q]] || 0, we0: B.we[MKEY[q]] || 0, we1: Dr.we[MKEY[q]] || 0, tot: Dr.wd[TKEY[q]] || 0 }; });
      result.induced = { wd: Dr.wd.indM || 0, we: Dr.we.indM || 0, wd0: B.wd.indM || 0, we0: B.we.indM || 0 };
      // 重要设施：乘地铁到达与离开（人次/日）的变化
      const facM = function (per) {
        const F = self.fn.F, out = new Float32Array(F), all = new Float32Array(F);
        if (!per) return { m: out, all: all };
        for (let p = 0; p < NP; p++) { const P = per[p], h = self.pHours[p], hm = h * (p === 3 ? 0.9 : 1); if (!P.fIn || P.fIn.length !== F) continue; for (let k = 0; k < F; k++) { out[k] += (P.fInM[k] + P.fOutM[k]) * hm; all[k] += (P.fIn[k] + P.fOut[k]) * h; } }
        return { m: out, all: all };
      };
      const fb = { wd: facM(base && base.wd), we: facM(base && base.we) }, fd = { wd: facM(draft.wd), we: facM(draft.we) };
      result.fac = [];
      self.fn.list.forEach(function (f, k) {
        const dw = fd.wd.m[k] - fb.wd.m[k], de = fd.we.m[k] - fb.we.m[k];
        if (Math.abs(dw) < 50 && Math.abs(de) < 50) return;
        result.fac.push({ id: f.id, name: f.name, t: f.t, wd0: fb.wd.m[k], wd1: fd.wd.m[k], we0: fb.we.m[k], we1: fd.we.m[k], allWd: fd.wd.all[k], allWe: fd.we.all[k] });
      });
      result.fac.sort(function (a, b) { return Math.max(Math.abs(b.wd1 - b.wd0), Math.abs(b.we1 - b.we0)) - Math.max(Math.abs(a.wd1 - a.wd0), Math.abs(a.we1 - a.we0)); });
      // 新线客流：受影响线路的日上车人次（周平均）
      const W = CFG.trips.weekWeights;
      const lineBoard = function (perSet, net) {
        const m = new Map();
        if (!perSet || !net) return m;
        for (const dt of DT) {
          const per = perSet[dt], wt = W[dt];
          for (let p = 0; p < NP; p++) {
            const h = self.pHours[p] * (p === 3 ? 0.9 : 1);
            for (let r = 0; r < net.R; r++) {
              const lid = net.C.routes[r].lineId;
              let s = 0; const be = net.boardEdge[r];
              for (let q = 0; q < be.length; q++) s += per[p].load[be[q]];
              m.set(lid, (m.get(lid) || 0) + s * h * wt);
            }
          }
        }
        return m;
      };
      const lb0 = lineBoard(base, baseNet), lb1 = lineBoard(draft, draftNet);
      result.lines = [];
      for (const lid of affectedLineIds) {
        const ln = draftC.net.lines[lid];
        result.lines.push({ id: lid, name: ln ? ln.name : '（已拆除）', color: ln ? ln.color : '#999', before: lb0.get(lid) || 0, after: lb1.get(lid) || 0 });
      }
      // 道路变化：工作日早高峰按道路名汇总
      if (base) {
        const road = self.road, byName = new Map();
        const v0 = base.wd[0].arcVol, v1 = draft.wd[0].arcVol;
        for (const L of road.links) {
          if (!L.name || L.cls < 3) continue;
          for (let d = 0; d < 2; d++) {
            const a = 2 * L.id + d;
            const e = byName.get(L.name) || { n0: 0, n1: 0, d0: 0, d1: 0, vkt0: 0 };
            const x0 = v0[a] / self.cap(a), x1 = v1[a] / self.cap(a);
            e.n0 += v0[a] * L.lenM * x0; e.d0 += v0[a] * L.lenM; e.n1 += v1[a] * L.lenM * x1; e.d1 += v1[a] * L.lenM; e.vkt0 += v0[a] * L.lenM;
            byName.set(L.name, e);
          }
        }
        const roads = [];
        byName.forEach(function (e, nid) {
          if (e.d0 <= 0 || !self.city.roadNames[nid]) return;
          const vc0 = e.n0 / e.d0, vc1 = e.d1 > 0 ? e.n1 / e.d1 : 0;
          roads.push({ name: self.city.roadNames[nid], vc0: vc0, vc1: vc1, delta: vc1 - vc0, w: e.vkt0 });
        });
        roads.sort(function (a, b) { return a.delta - b.delta; });
        result.roads = roads.filter(function (r) { return Math.abs(r.delta) > 0.004; }).slice(0, 5);
        result.roadsWorse = roads.filter(function (r) { return r.delta > 0.004; }).sort(function (a, b) { return b.delta - a.delta; }).slice(0, 3);
      } else { result.roads = []; result.roadsWorse = []; }
      // 有效性
      result.valid = draftNet.R > 0 && result.draft.metro > 1;
      if (!result.valid) {
        if (draftNet.R === 0) result.reason = '草案中没有形成可运营的线路（至少需要两座车站和一段轨道）。';
        else {
          let acc = 0; for (let s = 0; s < draftNet.N; s++) acc += draftNet.acc.accessible[s];
          result.reason = acc === 0 ? '车站周边暂无可步行到达的道路，无法形成有效地铁行程。' : '车站覆盖范围内的出行需求很少，暂未形成有效地铁行程。';
        }
      }
      result.progress = 1;
      return result;
    })();
    this.predJob = { gen: gen, done: done };
    return gen;
  };
  Model.prototype.cancelPredict = function () { this.predJob = null; };
})(window.CM);
