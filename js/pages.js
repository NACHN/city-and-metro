'use strict';
// 详情页面：建设预测、车站、线路、道路、片区、指标、日期、财政、任务、存档、帮助
(function (CM) {
  const U = CM.U, CFG = CM.CFG, D = CM.DATA, M = CM.Metro;
  const h = U.h, ic = CM.icon;
  const UI = CM.UI;
  UI.sgnPeople = function (d) { return Math.abs(d) < 0.5 ? '±0' : (d > 0 ? '+' : '−') + U.fmtPeople(Math.abs(d)); };
  UI.prototype.predictionBlock = function () {
    const g = this.g(), self = this, d = g.draft;
    const box = h('div', { class: 'sec open' });
    box.appendChild(h('div', { class: 'sec-h', style: { cursor: 'default' } }, '效果预测', h('span', { class: 'sum' }, '仅供参考')));
    const inner = h('div', { class: 'inner', style: { padding: '0 2px 10px' } });
    box.appendChild(inner);
    if (!d) return box;
    const p = d.pred;
    const runBtn = function (label) { return h('button', { class: 'btn sm', onclick: function () { g.requestPrediction(); } }, label); };
    if (p.state === 'idle') {
      inner.append(h('div', { class: 'note' }, '在草案静止约 1 秒后自动计算，或手动开始。预测基于当前城市状态比较建线前后的出行选择与道路交通。'), h('div', { style: { marginTop: '6px' } }, runBtn('计算效果预测')));
      return box;
    }
    if (p.state === 'running') {
      const bar = h('i', { style: { width: '5%' } });
      inner.append(h('div', { class: 'row small muted', style: { marginBottom: '6px' } }, h('span', { class: 'spinner', style: { width: '14px', height: '14px', borderWidth: '2px' } }), '预测计算中（不扣费，不改变正式客流）…'), h('div', { class: 'progress' }, bar));
      this.live.push(function () { const st = g.model.predState; bar.style.width = Math.round(U.clamp(st ? st.progress : 0.05, 0.05, 1) * 100) + '%'; });
      return box;
    }
    const res = p.state === 'done' ? p.result : (p.last || null);
    if (p.state === 'stale') inner.append(h('div', { class: 'callout warn' }, p.msg || '草案已修改，预测需要重新计算'), h('div', { style: { margin: '4px 0 8px' } }, runBtn('重新计算')));
    if (!res) return box;
    const dim = p.state === 'stale';
    const wrap = h('div', { style: { opacity: dim ? 0.5 : 1 } });
    inner.appendChild(wrap);
    if (!res.valid) { wrap.appendChild(h('div', { class: 'callout warn' }, '无法形成有效预测：' + (res.reason || '草案中没有有效的地铁行程。'))); }
    else {
      const B = res.base, Dr = res.draft;
      const dlt = function (a, b, d0, unit, betterUp) { const x = b - a; if (Math.abs(x) < Math.pow(10, -d0) / 2) return ['±0' + (unit || ''), 'muted']; return [U.fmtSigned(x, d0, unit || ''), (x > 0) === betterUp ? 'good' : 'bad']; };
      const g1 = h('div', { class: 'stat-grid' });
      let x;
      x = dlt(B.metro, Dr.metro, 0, '', true); g1.appendChild(this.stat('日均地铁客运量（周平均）', U.fmtPeople(Dr.metro) + ' 人次', '较当前 ' + U.fmtSigned((Dr.metro - B.metro) / 1e4, 1, ' 万'), x[1]));
      x = dlt(B.metroShare * 100, Dr.metroShare * 100, 1, ' 个百分点', true); g1.appendChild(this.stat('地铁分担率', U.fmtPct(Dr.metroShare), x[0], x[1]));
      x = dlt(B.commute, Dr.commute, 1, ' 分钟', false); g1.appendChild(this.stat('平均通勤时间', U.fmtNum(Dr.commute, 1) + ' 分钟', x[0], x[1]));
      x = dlt(B.cong, Dr.cong, 3, '', false); g1.appendChild(this.stat('道路拥堵指数（全日）', Dr.cong.toFixed(3), x[0], x[1]));
      x = dlt(B.car, Dr.car, 0, '', false); g1.appendChild(this.stat('汽车出行（人次/日）', U.fmtPeople(Dr.car), '转移 ' + U.fmtPeople(Math.max(0, B.car - Dr.car)) + ' 人次', x[1]));
      x = dlt(B.fare, Dr.fare, 0, '', true); g1.appendChild(this.stat('票务收入（日）', U.fmtMoney(Dr.fare / 10000), U.fmtSigned((Dr.fare - B.fare) / 10000, 1, ' ' + CFG.money.wan), x[1]));
      wrap.appendChild(g1);
      // 工作日与周末对比（v1.9）
      if (res.wk && res.we) {
        const arrow = function (a, b, fmt, up) { const d = b - a, cls = Math.abs(d) < 1e-9 ? 'muted' : ((d > 0) === up ? 'good' : 'bad'); return h('td', null, fmt(a) + ' → ', h('b', { class: cls }, fmt(b))); };
        const pct = function (v) { return U.fmtPct(v, 1); }, ppl = function (v) { return U.fmtPeople(v); }, f3 = function (v) { return v.toFixed(3); };
        const t = h('table', { class: 'tbl' }, h('tr', null, h('th', null, ''), h('th', null, '工作日'), h('th', null, '周末')),
          h('tr', null, h('td', null, '地铁客运量'), arrow(res.wk.base.metro, res.wk.draft.metro, ppl, true), arrow(res.we.base.metro, res.we.draft.metro, ppl, true)),
          h('tr', null, h('td', null, '地铁分担率'), arrow(res.wk.base.metroShare, res.wk.draft.metroShare, pct, true), arrow(res.we.base.metroShare, res.we.draft.metroShare, pct, true)),
          h('tr', null, h('td', null, '道路拥堵指数'), arrow(res.wk.base.cong, res.wk.draft.cong, f3, false), arrow(res.we.base.cong, res.we.draft.cong, f3, false)));
        const ind = res.induced || { wd: 0, we: 0, wd0: 0, we0: 0 };
        wrap.appendChild(this.sec('pr-days', '工作日与周末', '典型的一天', function () {
          return h('div', null, t, h('div', { class: 'note', style: { marginTop: '6px' } }, '工作日通勤、上学集中在早晚高峰；周末购物与旅游休闲出行更多、高峰平缓。草案改善可达性后新增的购物、休闲出行（有上限）：工作日约 ' + U.fmtPeople(Math.max(0, ind.wd - ind.wd0)) + ' 人次、周末约 ' + U.fmtPeople(Math.max(0, ind.we - ind.we0)) + ' 人次（已计入客运量）。'));
        }, true));
      }
      // 出行目的（地铁出行，人次/日）
      if (res.purpose) {
        const TR = CFG.trips;
        const t = h('table', { class: 'tbl' }, h('tr', null, h('th', null, '目的'), h('th', null, '工作日'), h('th', null, '周末')));
        for (const r of res.purpose) {
          if (r.wd1 < 1 && r.we1 < 1 && r.wd0 < 1) continue;
          const cell = function (a, b) { const d = b - a; return h('td', null, U.fmtPeople(b), h('small', { class: d > 0.5 ? 'good' : (d < -0.5 ? 'bad' : 'muted') }, ' ' + UI.sgnPeople(d))); };
          t.appendChild(h('tr', null, h('td', null, h('span', { class: 'dot', style: { background: TR.color[r.key], marginRight: '6px' } }), TR.name[r.key]), cell(r.wd0, r.wd1), cell(r.we0, r.we1)));
        }
        wrap.appendChild(this.sec('pr-purp', '地铁出行的目的（人次/日）', '草案 · 较当前', function () { return h('div', null, t, h('div', { class: 'note', style: { marginTop: '6px' } }, '通勤与上学看工作日，购物与旅游休闲看周末；枢纽接驳为往返火车站、机场的旅客。')); }, true));
      }
      // 重点设施预计客流贡献（乘地铁到达与离开，人次/日）
      if (res.fac && res.fac.length) {
        wrap.appendChild(this.sec('pr-fac', '重点设施的地铁客流', res.fac.length + ' 处变化', function () {
          const bx = h('div');
          const t = h('table', { class: 'tbl' }, h('tr', null, h('th', null, '设施'), h('th', null, '工作日'), h('th', null, '周末')));
          for (const r of res.fac.slice(0, 8)) {
            const f = CM.Fac.byId(r.id), cell = function (a, b) { const d = b - a; return h('td', null, h('b', { class: d > 0 ? 'good' : (d < 0 ? 'bad' : 'muted') }, UI.sgnPeople(d)), h('small', { class: 'muted' }, ' 共 ' + U.fmtPeople(b))); };
            t.appendChild(h('tr', { class: 'clickable', onclick: function () { self.select({ kind: 'facility', id: r.id }); } }, h('td', null, f ? ic(f.T.icon) : null, ' ', r.name), cell(r.wd0, r.wd1), cell(r.we0, r.we1)));
          }
          bx.appendChild(t);
          bx.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '乘地铁到达与离开设施的人次（日）。车站、机场的旅客量不会因修地铁而增加，变化来自改乘地铁的接驳出行。'));
          return bx;
        }, true));
      }
      if (res.lines.length) {
        wrap.appendChild(this.sec('pr-lines', '相关线路客流（日上车人次）', '', function () {
          const t = h('table', { class: 'tbl' }, h('tr', null, h('th', null, '线路'), h('th', null, '当前'), h('th', null, '草案')));
          for (const l of res.lines) t.appendChild(h('tr', null, h('td', null, h('span', { class: 'swatch', style: { background: l.color, marginRight: '6px' } }), l.name), h('td', null, U.fmtPeople(l.before)), h('td', null, U.fmtPeople(l.after))));
          return t;
        }, true));
      }
      wrap.appendChild(this.sec('pr-roads', '道路影响（工作日早高峰饱和度）', res.roads.length ? res.roads.length + ' 条变化' : '变化不明显', function () {
        const bx = h('div');
        if (!res.roads.length) bx.appendChild(h('div', { class: 'note' }, '早高峰主要道路饱和度变化不明显。新增地铁不保证道路拥堵一定改善。'));
        for (const r of res.roads) bx.appendChild(h('div', { class: 'chg small' }, h('span', null, r.name), h('span', { class: 'num ' + (r.delta < 0 ? 'good' : 'bad') }, r.vc0.toFixed(2) + ' → ' + r.vc1.toFixed(2))));
        if (res.roadsWorse.length) { bx.appendChild(h('div', { class: 'small bad', style: { marginTop: '6px' } }, '可能加重的道路：')); for (const r of res.roadsWorse) bx.appendChild(h('div', { class: 'chg small' }, h('span', null, r.name), h('span', { class: 'num bad' }, r.vc0.toFixed(2) + ' → ' + r.vc1.toFixed(2)))); }
        return bx;
      }, true));
    }
    const c = res.conditions;
    const fare = '全网统一票价 ' + c.fare.flat + ' ' + CFG.money.unit + '/次';
    wrap.appendChild(this.sec('pr-cond', '预测条件与说明', '', function () {
      return h('div', { class: 'note' }, '比较对象：当前正式网络 vs 草案网络；城市状态：' + c.y + '年' + c.m + '月（相同人口、岗位、设施与出行需求）；时间范围：典型工作日与典型周末各一天（早高峰、平峰、晚高峰、夜间），日均为周平均（5 个工作日 + 2 个周末日）；票价：' + fare + '；运力：系统按预测客流自动调整。预测仅供参考，不扣费、不改变正式客流；投运后的实际结果由模拟产生，并在车站与线路详情中单独显示。');
    }));
    return box;
  };

  // ======================== 页面：车站 ========================
  // 控件每次都读取最新草案（草案变化后页面自动刷新）；已建状态与草案状态分别说明
  // ---------------- 车站面板的小部件 ----------------
  // 半圆仪表：圆弧在左、开口朝右；pathLength=100 让 dasharray 直接写百分比
  function stArc(cx, cy, r) { return 'M ' + cx + ' ' + (cy - r) + ' A ' + r + ' ' + r + ' 0 0 0 ' + cx + ' ' + (cy + r); }
  // rings: [{ v, color, tip }]，tip 是悬停时给内部提示组件看的文字
  function stGauge(rings) {
    const cx = 36, cy = 41;
    let out = '<svg class="st-gauge" width="48" height="82" viewBox="0 0 48 82">';
    rings.forEach(function (g, i) {
      const r = 33 - i * 8, d = stArc(cx, cy, r), v = Math.max(0, Math.min(1, g.v || 0));
      const tip = String(g.tip || '').replace(/"/g, '&quot;');
      out += '<path d="' + d + '" pathLength="100" stroke="var(--line-strong)" stroke-width="6"></path>';
      out += '<path d="' + d + '" pathLength="100" stroke="' + g.color + '" stroke-width="6" stroke-dasharray="' +
        (v * 100).toFixed(1) + ' 100"></path>';
      // 命中环：比可见弧粗一倍，细线也好指到
      out += '<path class="hit" d="' + d + '" data-tip="' + tip + '" data-tip-now></path>';
    });
    return out + '</svg>';
  }
  // 迷你折线：viewBox 固定、vector-effect 保住线宽，随容器拉伸
  function stSpark(a, b, ca, cb) {
    const n = a.length, lo = Math.min.apply(null, a.concat(b)), hi = Math.max.apply(null, a.concat(b));
    const span = (hi - lo) || 1, X = function (i) { return 2 + 96 * i / Math.max(1, n - 1); };
    const Y = function (v) { return 34 - 30 * (v - lo) / span; };
    const line = function (arr) { return arr.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' '); };
    return '<svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + line(b) + '" fill="none" stroke="' + cb + '" stroke-width="1.4" stroke-dasharray="3 2.5" vector-effect="non-scaling-stroke"></path>' +
      '<path d="' + line(a) + '" fill="none" stroke="' + ca + '" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>' +
      '</svg>';
  }
  // 车站步行覆盖：15 分钟与 3 km 两个口径的人口（沿道路，和「步行覆盖」块同源）
  UI.prototype.stationCover = function (s, k) {
    const g = this.g(), acc = g.model.net && g.model.net.acc, tree = acc && acc.trees && acc.trees[k];
    if (!tree) return { p15: 0, p3: 0 };
    const vm = new Map();
    for (let q = 0; q < tree.verts.length; q++) vm.set(tree.verts[q], tree.dist[q]);
    const city = g.city, VW = city.VW, ci = Math.floor(s.x), cj = Math.floor(s.y);
    const lim = acc.stLimit ? acc.stLimit[k] : CFG.walk.maxAccessM;
    const rw = Math.ceil(Math.max(lim, 3000) / CFG.CELL_M) + 1;
    let p15 = 0, p3 = 0;
    for (let j = Math.max(0, cj - rw); j <= Math.min(city.H - 1, cj + rw); j++) {
      for (let i = Math.max(0, ci - rw); i <= Math.min(city.W - 1, ci + rw); i++) {
        const c = j * city.W + i, p = city.pop[c];
        if (!(p > 0)) continue;
        const v0 = j * VW + i;
        let m = Infinity;
        const vs = [v0, v0 + 1, v0 + VW, v0 + VW + 1];
        for (let q = 0; q < 4; q++) { const dd = vm.get(vs[q]); if (dd !== undefined && dd < m) m = dd; }
        if (!isFinite(m)) continue;
        m += CFG.walk.cellExtraM;
        if (m <= 15 * CFG.walk.mPerMin) p15 += p;
        if (m <= 3000) p3 += p;
      }
    }
    return { p15: p15, p3: p3 };
  };

  // 一条接驳线为车站「新增」的覆盖人口：端点步行圈内、且不在车站自己步行圈里的居住人口。
  // 面板上的估算（欧氏距离）；模型里接驳的影响走 M.busEqM（车程 + 候车），不是这个数。
  UI.prototype.busCover = function (st, b) {
    const B = CFG.bus;
    if (!B) return 0;
    const city = this.g().city, reach = B.walkReachM || 400;
    const lim = M.exitAccessM(st.exitLv | 0);
    const rw = Math.ceil(reach / CFG.CELL_M) + 1;
    const ci = Math.floor(b.x), cj = Math.floor(b.y);
    let p = 0;
    for (let j = Math.max(0, cj - rw); j <= Math.min(city.H - 1, cj + rw); j++) {
      for (let i = Math.max(0, ci - rw); i <= Math.min(city.W - 1, ci + rw); i++) {
        const pop = city.pop[j * city.W + i];
        if (!(pop > 0)) continue;
        const dx = b.x - (i + 0.5), dy = b.y - (j + 0.5);
        if (Math.sqrt(dx * dx + dy * dy) * CFG.CELL_M > reach) continue;
        const ex = st.x - (i + 0.5), ey = st.y - (j + 0.5);
        if (Math.sqrt(ex * ex + ey * ey) * CFG.CELL_M <= lim) continue;
        p += pop;
      }
    }
    return p;
  };

  UI.prototype.page_station = function (id) {
    const g = this.g(), self = this;
    const net = g.draft ? g.draft.net : g.net;
    const s = net.stations[id];
    if (!s) return null;
    const latest = function () { return (g.draft ? g.draft.net : g.net).stations[id]; };
    const official = g.net.stations[id];
    const desc = function (x) { return CFG.metro.sizeName[x.size] + ' · ' + CFG.metro.typeName[x.type]; };
    const lines = M.stationLines(net, id).map(function (l) { return net.lines[l]; }).filter(Boolean);
    const el = h('div');

    /* ---------------- 头部：只剩线路与规模；站名在页面标题，操作在标题栏 ---------------- */
    const head = h('div', { class: 'st-head' });
    const chips = h('div', { class: 'st-chips' });
    if (lines.length) {
      for (const l of lines) chips.appendChild(h('span', { class: 'tag', style: { background: l.color + '22', color: l.color } }, '● ' + l.name));
    } else chips.appendChild(h('span', { class: 'tag' }, '未接入线路'));
    if (lines.length > 1) chips.appendChild(h('span', { class: 'tag' }, '⇄ 换乘站'));
    chips.appendChild(h('span', { class: 'tag' }, desc(s)));
    if (!official) chips.appendChild(h('span', { class: 'tag' }, '草案中（未建成）'));
    head.appendChild(chips);
    el.appendChild(head);

    if (official && (official.size !== s.size || official.type !== s.type || official.name !== s.name || U.dist(official.x, official.y, s.x, s.y) > 0.004)) {
      const moved = U.dist(official.x, official.y, s.x, s.y) * CFG.CELL_M;
      el.appendChild(h('div', { class: 'draft-diff' }, h('span', { class: 'dd-k' }, '已建'), h('span', null, official.name + ' · ' + desc(official)), h('span', { class: 'dd-arrow' }, '→'), h('span', { class: 'dd-k draft' }, '草案'), h('span', null, s.name + ' · ' + desc(s) + (moved > 1 ? ' · 移动 ' + Math.round(moved) + ' m' : ''))));
    }

    const C = g.model.net ? g.model.net.C : null;
    const k = C && official ? C.sIndex.get(id) : undefined;
    const serviced = k !== undefined && !!C.serviced[k];
    const sd = serviced ? g.model.stDaily : null;
    const stRow = C && k !== undefined ? C.stations[k] : null;
    const capH = stRow ? CFG.metro.stationCap[stRow.size] : 0;

    /* ================= 经济：左收支、右地价 ================= */
    if (g.econ.caps.land && official) {
      const oi = g.econ.opsIndex(g.clock.y);
      const opsM = CFG.ops.stationDaily[official.size] * oi * 30;          // 万元/月
      const pr = official.prop || g.propertyOf(official);
      const propNet = pr ? (pr.rent - pr.maint) : 0;
      const net = propNet - opsM;
      const sumTxt = '本月 ' + (net >= 0 ? '+' : '−') + U.fmtMoney(Math.abs(net));
      el.appendChild(this.sec('st-econ', '经济', sumTxt, function () {
        const box = h('div');
        // 收支（整宽）：大数字 + 组成 + 12 个月折线
        box.appendChild(h('div', { class: 'st-net ' + (net >= 0 ? 'good' : 'bad') }, (net >= 0 ? '+' : '−') + U.fmtMoney(Math.abs(net)), h('i', null, '万元 / 月')));
        box.appendChild(h('div', { class: 'st-net-sub' },
          '运营成本 ' + U.fmtMoney(opsM) + ' · 物业净 ' + (propNet > 0.01 ? U.fmtMoney(propNet) : '—')));
        const hist = official.hist || [];
        if (hist.length >= 3) {
          const a = hist.map(function (x) { return x[3] || 0; });          // 物业净
          const b = hist.map(function (x) { return x[2] || 0; });          // 运营成本
          box.appendChild(h('div', { class: 'st-spark', html: stSpark(a, b, 'var(--good)', 'var(--bad)') }));
          box.appendChild(h('div', { class: 'note', style: { marginTop: '3px' } }, '近 ' + hist.length + ' 个月 · 实线物业净、虚线运营成本（万元）'));
        } else {
          box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, (official.dev | 0)
            ? '收支趋势从下个月开始累积（每个自然月记一次）。'
            : '还没有物业收入：这是纯粹的车站运营支出。上盖开发后才会出现收入项。'));
        }
        // 物业与地价：3 × 2 小格，值一律单行（不再被挤成两行）
        const V = CFG.valueCapture, city = g.city;
        const c = city.cellAt(official.x, official.y);
        const lp = c >= 0 && city.landPrice ? city.landPrice[c] : 0;
        const p50 = city.landStat ? city.landStat.p50 : 0;
        const land = h('div', { class: 'st-land' });
        const cell = function (k, v, cls) {
          return h('div', { class: 'cell' },
            h('div', { class: 'k' }, k),
            h('div', { class: 'v' + (cls ? ' ' + cls : '') }, v));
        };
        land.appendChild(cell('上盖', (official.dev | 0) ? (CFG.property.levelName[official.dev] || '已开发') : '未开发'));
        land.appendChild(cell('本站地价', lp > 0 ? U.fmtMoney(lp) + '/㎡' : '—'));
        land.appendChild(cell('全城中位', p50 > 0 ? U.fmtMoney(p50) + '/㎡' : '—'));
        land.appendChild(cell('相对全城', p50 > 0 && lp > 0 ? (lp / p50).toFixed(2) + '×' : '—', p50 > 0 && lp / p50 > 1.5 ? 'good' : ''));
        land.appendChild(cell((V.radiusM || 300) + ' m 内总额', g.stationLandSum(official) > 0 ? U.fmtMoney(g.stationLandSum(official)) : '—'));
        land.appendChild(cell('上年增值分成', (official.capGain || 0) > 0.01 ? '+' + U.fmtMoney(official.capGain) : '—'));
        box.appendChild(land);
        return box;
      }, true, 'coin'));
    }

    /* ================= 乘客：客流 / 换乘 / 设施 / 接驳 ================= */
    if (serviced) {
      const inn = sd.inn[k], out = sd.out[k], xf = sd.xfer[k];
      const sumPax = '日 ' + U.fmtPeople(inn) + ' 进站' + (xf > 0 ? ' · 换乘 ' + U.fmtPeople(xf) : '');
      el.appendChild(this.sec('st-pax', '乘客', sumPax, function () {
        const box = h('div');
        // —— 客流：24 小时柱 + 半圆 + 流向 ——
        const cov = self.stationCover(s, k);
        const xferPct = inn > 0 ? xf / inn : 0;
        const peak = Math.max(sd.peak[k] || 0, 1);
        const sat = capH > 0 ? peak / capH : 0;
        const gEl = h('div', { class: 'st-flowwrap' });
        const left = h('div', { class: 'l' });
        const bars = h('div', { class: 'st-bars' });
        const hours = [];
        for (let hr = 0; hr < 24; hr++) {
          const W = g.model.weights(hr * 60 + 30);
          hours.push(g.model.stFlowAt(k, W, 'stIn') + g.model.stFlowAt(k, W, 'stOut'));
        }
        const mx = Math.max.apply(null, hours.length ? hours : [1]) || 1;
        const barEls = [];
        for (let hr = 0; hr < 24; hr++) {
          const bar = h('i', {
            class: hours[hr] >= mx * 0.9 ? 'pk' : '',
            style: { height: Math.max(2, Math.round(hours[hr] / mx * 100)) + '%' },
            'data-tip': hr + ' 时 · ' + U.fmtInt(hours[hr]) + ' 人次/时',
            'data-tip-now': true,
          });
          barEls.push(bar); bars.appendChild(bar);
        }
        left.appendChild(bars);
        left.appendChild(h('div', { class: 'st-barlab' }, h('span', null, '0 时'), h('span', null, '6'), h('span', null, '12'), h('span', null, '18'), h('span', null, '23 时')));
        gEl.appendChild(left);
        // 右：半圆 + 覆盖人口 + 三行图例
        const right = h('div', { class: 'r' });
        const gaugeBox = h('div', { html: stGauge([
          { v: cov.p3 > 0 ? cov.p15 / cov.p3 : 0, color: 'var(--teal, #2a9d8f)',
            tip: '15 分钟步行覆盖 ' + U.fmtPeople(cov.p15) + ' / 3 km 内 ' + U.fmtPeople(cov.p3) + '（' + U.fmtPct(cov.p3 > 0 ? cov.p15 / cov.p3 : 0, 0) + '）' },
          { v: xferPct, color: 'var(--accent)',
            tip: '换乘占比 ' + U.fmtPct(xferPct, 0) + '：换乘 ' + U.fmtPeople(xf) + ' / 进站 ' + U.fmtPeople(inn) },
          { v: sat, color: 'var(--warn)',
            tip: '站台饱和度 ' + sat.toFixed(2) + '：高峰 ' + U.fmtPeople(peak) + ' / 车站容量 ' + U.fmtPeople(capH) },
        ]) });
        right.appendChild(gaugeBox);
        const gd = h('div', { class: 'st-gdata' });
        gd.appendChild(h('div', { class: 'big' }, (cov.p15 / 1e4).toFixed(1), h('i', null, '万')));
        gd.appendChild(h('div', { class: 'cap' }, '15 分钟步行覆盖'));
        const gl = h('div', { class: 'st-glegend' });
        gl.appendChild(h('span', null, h('i', { style: { background: 'var(--teal, #2a9d8f)' } }), '覆盖', h('b', null, U.fmtPct(cov.p3 > 0 ? cov.p15 / cov.p3 : 0, 0))));
        gl.appendChild(h('span', null, h('i', { style: { background: 'var(--accent)' } }), '换乘', h('b', null, U.fmtPct(xferPct, 0))));
        gl.appendChild(h('span', null, h('i', { style: { background: 'var(--warn)' } }), '饱和', h('b', null, sat.toFixed(2))));
        gd.appendChild(gl);
        right.appendChild(gd);
        gEl.appendChild(right);
        box.appendChild(gEl);
        // 流向：进站 → 换乘 → 出站
        const flow = h('div', { class: 'st-flowrow' });
        const cell = function (v, label, mid, tip) {
          return h('span', { class: 'c' + (mid ? ' mid' : '') }, h('b', null, U.fmtPeople(v)), h('small', null, label), h('span', { class: 'tipspot', 'data-tip': tip }));
        };
        flow.appendChild(cell(inn, '进站', false, '闸机进站人次（不含站内换乘）'));
        flow.appendChild(h('span', { class: 'ar' }, '→'));
        flow.appendChild(cell(xf, '换乘', true, '在本站由一条线换到另一条线的人次'));
        flow.appendChild(h('span', { class: 'ar' }, '→'));
        flow.appendChild(cell(out, '出站', false, '闸机出站人次；出站通常略多于进站，因为换乘客流只出不进'));
        box.appendChild(flow);
        // 实时更新：模型收敛时数字与柱高一起动
        self.live.push(function () {
          const m = g.model;
          if (!m.stDaily || m.net.C !== C || k >= m.stDaily.inn.length) return;
          const d = m.stDaily;
          flow.children[0].querySelector('b').textContent = U.fmtPeople(d.inn[k]);
          flow.children[2].querySelector('b').textContent = U.fmtPeople(d.xfer[k]);
          flow.children[4].querySelector('b').textContent = U.fmtPeople(d.out[k]);
        });

        // —— 换乘信息（一行） ——
        const xrow = h('div', { class: 'st-row' }, h('span', { class: 'lbl' }, '换乘信息'));
        const xtags = h('span', { class: 'tags' });
        for (const l of lines) xtags.appendChild(h('span', { class: 'st-tag line', style: { color: l.color, background: l.color + '18' } }, l.name));
        const acc = g.model.net.acc;
        const xs = acc.transfers.filter(function (t) { return t.a === k; });
        for (const t of xs) {
          const o = C.stations[t.b];
          xtags.appendChild(h('span', {
            class: 'st-tag walk click', 'data-tip': '点击查看「' + o.name + '」',
            onclick: function () { self.select({ kind: 'station', id: o.id }); },
          }, '步行 ' + Math.round(t.m) + ' m · ' + o.name));
        }
        if (!lines.length && !xs.length) xtags.appendChild(h('span', { class: 'st-tag none' }, '暂无'));
        xrow.appendChild(xtags);
        box.appendChild(xrow);

        // —— 附近的重要设施（一行） ——
        const mdl = g.model, accF = mdl.net.acc, facNear = [];
        if (mdl.fn && accF.NZ === mdl.fn.NZ) mdl.fn.list.forEach(function (f, q) {
          const zl = accF.zl[mdl.Z + q];
          const e = zl && zl.find(function (x) { return x.s === k; });
          if (e) facNear.push({ f: f, w: e.w });
        });
        facNear.sort(function (a, c2) { return a.w - c2.w; });
        const frow = h('div', { class: 'st-row' }, h('span', { class: 'lbl' }, '附近设施'));
        const ftags = h('span', { class: 'tags' });
        facNear.slice(0, 6).forEach(function (it) {
          const km = Math.max(1, Math.round(it.w));
          const cls = it.f.T.group === '商业' ? 'shop' : (it.f.T.group === '旅游休闲' ? 'park' : '');
          ftags.appendChild(h('span', {
            class: 'st-tag ' + cls + ' click', 'data-tip': it.f.name + ' · ' + it.f.T.name,
            onclick: function () { self.select({ kind: 'facility', id: it.f.id }); },
          }, km + ' 分钟 · ' + it.f.name));
        });
        if (!facNear.length) ftags.appendChild(h('span', { class: 'st-tag none' }, '步行 15 分钟内无重要设施'));
        frow.appendChild(ftags);
        box.appendChild(frow);

        // —— 接驳巴士（按线路卡片） ——
        const B = CFG.bus, busList = (official && official.bus) || [];
        const brow = h('div', { class: 'st-row', style: { alignItems: 'flex-start' } }, h('span', { class: 'lbl', style: { paddingTop: '4px' } }, '接驳巴士'));
        const bw = h('div', { style: { flex: '1', minWidth: '0' } });
        if (!official || !(official.busHub | 0)) {
          bw.appendChild(h('span', { class: 'st-tag none' }, '暂无（先在「改建」里建接驳站）'));
        } else if (!busList.length) {
          bw.appendChild(h('span', { class: 'st-tag none' }, '接驳站已建 · 未开线'));
        } else {
          const list = h('div', { class: 'st-buslist' });
          const sorted = busList.slice().sort(function (a, c2) { return (M.busNo(a) || 99) - (M.busNo(c2) || 99); });
          const perCar = B.capacityPerVehicle || 2700;
          const walkPop = Math.max(0, cov.p15);       // 车站自己步行圈内的人口（接驳覆盖不含这部分）
          sorted.forEach(function (x, idx) {
            const n = M.busNo(x) || (idx + 1), col = M.busColor(n), nv = Math.max(1, x.cars | 0);
            const hw = M.busCycleMin(x.lenM) / nv;
            const costM = nv * B.opsPerVehicleYear / 12;
            const nm = x.name || self.busTermName(x.x, x.y) || '接驳端点';
            // 实载：这条线带来的覆盖人口，按「本站人均进站率」折成人次/日
            const cover = self.busCover(official, x);
            const pool = cover + walkPop;
            const riders = pool > 0 ? (sd.inn[k] || 0) * cover / pool : 0;
            const capT = nv * perCar;
            const util = capT > 0 ? riders / capT : 0;
            const lcls = util >= 0.9 ? ' hot' : (util < 0.35 ? ' idle' : '');
            const ltip = '估算接驳客流 ' + U.fmtInt(riders) + ' / 运力 ' + U.fmtInt(capT) + ' 人次/日（' +
              Math.round(util * 100) + '%）\n覆盖 ' + U.fmtInt(cover) + ' 人（端点 ' + Math.round(B.walkReachM) +
              ' m 内、车站步行圈外）· 每辆 ' + U.fmtInt(perCar) + ' 人次/日';
            const card = h('div', {
              class: 'st-buscard',
              onmouseenter: function () { self.busHi = { st: id, line: x.id }; this.classList.add('hi'); },
              onmouseleave: function () { self.busHi = null; this.classList.remove('hi'); },
            },
              h('span', { class: 'no', style: { background: col } }, String(n)),
              h('div', { class: 'bc' },
                h('div', { class: 'bc1' },
                  h('span', { class: 'nm', 'data-tip': nm }, nm),
                  h('span', { class: 'cost' }, '−' + U.fmtMoney(costM) + '/月')),
                h('div', { class: 'bc2' },
                  h('span', null, '间隔 ' + hw.toFixed(1) + ' 分'),
                  h('span', { class: 'sep' }, '·'),
                  h('span', { class: 'load' + lcls, 'data-tip': ltip }, U.fmtInt(riders) + ' / ' + U.fmtInt(capT)),
                  h('span', { class: 'u' }, '人次'))),
              h('span', { class: 'step' },
                h('button', { 'data-tip': '减一辆（间隔变长）', onclick: function () { self.busCars(id, x.id, -1); } }, '−'),
                h('b', null, nv),
                h('button', { 'data-tip': '加一辆（间隔变短）', onclick: function () { self.busCars(id, x.id, 1); } }, '+')),
              h('button', { class: 'x', 'data-tip': '停运这条线', onclick: function () { self.busClose(id, x.id); } }, '✕'));
            list.appendChild(card);
          });
          bw.appendChild(list);
          bw.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '合计 ' + U.fmtMoney(busList.reduce(function (a, c2) { return a + (c2.cars | 0); }, 0) * B.opsPerVehicleYear / 12) + '/月 · 实载为估算值，按本站人均进站率折算'));
        }
        if (official && (official.busHub | 0) && busList.length < (B.maxPerStation || 4)) {
          bw.appendChild(h('button', { class: 'st-busadd', style: { marginTop: '6px' }, onclick: function () { self.busPick(id); } }, '+ 接驳线'));
        }
        brow.appendChild(bw);
        box.appendChild(brow);
        return box;
      }, true, 'people'));
    } else if (official && k !== undefined) {
      el.appendChild(this.callout('warn', 'warn', '该车站尚未接入运营线路，不提供服务：不计入地铁覆盖，也不产生客流和票款。把它连接到线路并确认建设后生效。'));
      el.appendChild(this.sec('st-cover', '潜在步行覆盖（接入线路后）', '', function () { return self.coverBlock(s, k, true); }, true));
    } else if (official) {
      el.appendChild(h('div', { class: 'note' }, '客流数据计算中…'));
    } else {
      el.appendChild(h('div', { class: 'callout info' }, '这是草案中的新车站，确认建设后立即投入运营并产生客流数据。'));
    }

    /* ================= 改建：所有会改变城市的操作（左侧面板） ================= */
    const buildBody = function () {
      const b = h('div');
      // —— 车站本身 ——
      b.appendChild(h('div', { class: 'st-sub' }, '车站本身'));
      const nameIn = h('input', { type: 'text', value: s.name, maxlength: 16 });
      const rename = function () { const v = nameIn.value.trim(), c = latest(); if (!v || !c || v === c.name) return; g.edit(function (n) { n.stations[id].name = v; }); self.toast('已在草案中更名为「' + v + '」', 'info'); };
      nameIn.addEventListener('keydown', function (e) { if (e.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); rename(); } });
      b.appendChild(h('div', { class: 'field' }, h('label', null, '站名'), h('div', { class: 'row' }, nameIn, h('button', { class: 'btn sm', onclick: rename }, '更名'))));
      const mc = CFG.metro, yy = g.clock.y, ORD = ['S', 'M', 'L'];
      const costOf = function (sz) { return M.stationCost(s.type, sz, yy); };
      const capTxt = function (v) { return v >= 10000 ? (v / 10000) + ' 万人次/时' : U.fmtInt(v) + ' 人次/时'; };
      const sizeNote = function () {
        // 只留「容量 · 编组 · 费用」三件事，运营成本在右侧「经济」里已有，这里不再重复
        const head = capTxt(mc.stationCap[s.size]) + ' · ' + mc.carsBySize[s.size] + ' 节编组';
        let cost;
        if (!official) cost = '建设 ' + U.fmtMoney(costOf(s.size));
        else if (official.type !== s.type) cost = '改建 ' + U.fmtMoney(costOf(s.size));
        else {
          const d = ORD.indexOf(s.size) - ORD.indexOf(official.size);
          cost = d === 0 ? '已建规模' : (d > 0 ? '升级 ' + U.fmtMoney((costOf(s.size) - costOf(official.size)) * CFG.cost.upgradeFactor) : '缩减 · 不退款');
        }
        return head + ' · ' + cost;
      };
      const sizeSeg = h('div', { class: 'seg-ctl' });
      for (const sz of ORD) sizeSeg.appendChild(h('button', {
        class: s.size === sz ? 'on' : '',
        onclick: function () { const c = latest(); if (c && c.size !== sz) g.edit(function (n) { n.stations[id].size = sz; }); },
      }, mc.sizeName[sz]));
      b.appendChild(h('div', { class: 'field' }, h('label', null, '车站规模'), sizeSeg));
      b.appendChild(h('div', { class: 'note' }, sizeNote()));
      const tc = h('div', { class: 'seg-ctl' });
      for (const t of ['underground', 'surface', 'elevated']) tc.appendChild(h('button', {
        class: s.type === t ? 'on' : '',
        onclick: function () { const c = latest(); if (c && c.type !== t) g.edit(function (n) { n.stations[id].type = t; }); },
      }, CFG.metro.typeName[t], official && official.type === t && s.type !== t ? h('small', null, '（已建）') : null));
      b.appendChild(h('div', { class: 'field' }, h('label', null, '车站形式'), tc));
      if (official) b.appendChild(h('div', { class: 'note' }, '改建按新建计费；选回已建形式即撤销改建。'));

      // —— 车站配套 ——
      if (g.econ.caps.land && CFG.stationFacility && official) {
        const SF = CFG.stationFacility, Met = CM.Metro, ci = g.econ.costIndex(g.clock.y);
        const exLv = official.exitLv | 0, prLv = official.prLv | 0;
        const capex = Met.facCapex(official);
        const maintY = capex * (SF.maint || 0) * g.econ.opsIndex(g.clock.y);
        b.appendChild(h('div', { class: 'st-sub', style: { marginTop: '14px' } }, '车站配套'));
        b.appendChild(h('div', { class: 'kv' },
          h('div', { class: 'k' }, '出入口'), h('div', { class: 'v' }, (SF.exit.name[exLv] || '无') + ' · 步行半径 ' + Met.exitAccessM(exLv) + ' m')));
        const exRow = h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'wrap' } });
        for (let lv = 1; lv <= 3; lv++) {
          const done = lv <= exLv, add = (Met.exitCost(lv) - Met.exitCost(exLv)) * ci;
          exRow.appendChild(h('button', { class: 'btn sm' + (done ? ' ghost' : ''), disabled: done ? true : null, onclick: function () { self.stFacility(id, 'exit', lv); } },
            done ? '已建成' : (SF.exit.name[lv] + ' · ' + SF.exit.accessM[lv] + ' m · ' + U.fmtMoney(add))));
        }
        b.appendChild(exRow);
        b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '每加一级步行半径 +225 m，覆盖面积 +44% / +78% / +115%。'));
        if (g.clock.y >= (SF.pr.openYear || 0)) {
          b.appendChild(h('div', { class: 'kv', style: { marginTop: '10px' } }, h('div', { class: 'k' }, 'P+R 停车场'), h('div', { class: 'v' }, prLv ? SF.pr.name[prLv] : '无')));
          const prRow = h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'wrap' } });
          for (let lv = 1; lv <= 3; lv++) {
            const done = lv <= prLv, add = (Met.prCost(lv) - Met.prCost(prLv)) * ci;
            const land = Met.prLandCost(g.city, official, lv) - Met.prLandCost(g.city, official, prLv);
            prRow.appendChild(h('button', { class: 'btn sm' + (done ? ' ghost' : ''), onclick: function () { if (!done) self.stFacility(id, 'pr', lv); } },
              done ? '已建成' : (SF.pr.name[lv] + ' · ' + U.fmtMoney(add) + (land > 1 ? ' + 用地 ' + U.fmtMoney(land) : ''))));
          }
          b.appendChild(prRow);
          b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, 'P+R 把开车来的人接进站：站口 ' + SF.pr.reachM + ' m 内的步行段按 ' + Math.round(SF.pr.walkMul * 100) + '% 折算。要占地，按本站地价的 ' + Math.round(Met.stationUse() * 100) + '% 补——核心区会比外围贵好几倍。'));
        } else {
          b.appendChild(h('div', { class: 'note', style: { marginTop: '8px' } }, 'P+R 停车场（开车到站换乘）' + (SF.pr.openYear || 2005) + ' 年才开放。'));
        }
        if (capex > 0) b.appendChild(h('div', { class: 'kv', style: { marginTop: '10px' } }, h('div', { class: 'k' }, '配套原值'), h('div', { class: 'v' }, U.fmtMoney(capex * ci) + ' · 维护 ' + U.fmtMoney(maintY) + '/年')));
      }

      // —— 上盖开发 ——
      if (g.econ.caps.land && official) {
        const P = CFG.property, lv = official.dev | 0;
        b.appendChild(h('div', { class: 'st-sub', style: { marginTop: '14px' } }, '上盖开发'));
        b.appendChild(h('div', { class: 'kv' }, h('div', { class: 'k' }, '当前'), h('div', { class: 'v' }, P.levelName[lv] || '未开发')));
        const pr = official.prop || g.propertyOf(official);
        if (lv && pr) {
          const pay = function (y) {
            if (!isFinite(y) || !(y > 0)) return '不会回本';
            return y.toFixed(1) + ' 年' + (y <= 8 ? ' · 很值得' : (y <= 15 ? ' · 值得做' : (y <= 25 ? ' · 勉强' : ' · 不划算')));
          };
          b.appendChild(self.kv([
            ['建筑面积', U.fmtInt(pr.area) + ' ㎡'],
            ['月净额', U.fmtMoney(pr.rent - pr.maint)],
            ['建安投资', U.fmtMoney(pr.capex)],
            ['回收期', pay(pr.payback)],
            ['商业客流', pr.visitsReady ? U.fmtPeople(pr.visits) + ' 人次/年' : '计算中…'],
          ]));
          // 面积构成与出租率放小字：一行写不下，硬塞会挤成两行
          b.appendChild(h('div', { class: 'note', style: { marginTop: '5px' } },
            '商业 ' + U.fmtInt(pr.comArea) + ' ㎡ · 住宅 ' + U.fmtInt(pr.resArea) + ' ㎡ · 出租率 ' + U.fmtPct(pr.held, 0)));
        }
        if (!g.draft) {
          const row = h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'wrap' } });
          const capCost = function (v) { return (P.areaBySize[official.size] || 0) * (P.levels[v] || 0) * ((P.levelCost && P.levelCost[v]) || P.buildCost || 0); };
          [0, 1, 2, 3].forEach(function (to) {
            if (to === lv) return;
            const cost = Math.max(0, capCost(to) - capCost(lv)) * g.econ.costIndex(g.clock.y) / 1e4;
            row.appendChild(h('button', { class: 'btn sm' + (to < lv ? ' ghost danger' : ''), onclick: function () { self.devStation(id, to); } },
              to === 0 ? '取消开发（不退款）' : (P.levelName[to] + ' · ' + U.fmtMoney(cost))));
          });
          if (row.children.length) b.appendChild(row);
        }
      }

      // —— 接驳站 ——
      if (g.econ.caps.land && CFG.bus && official) {
        const B = CFG.bus, hub = official.busHub | 0;
        b.appendChild(h('div', { class: 'st-sub', style: { marginTop: '14px' } }, '接驳站'));
        const busList = official.bus || [];
        if (!hub) {
          b.appendChild(h('div', { class: 'note' }, '接驳站是候车亭、站牌与首末站车位。建成后才能在「乘客」里开线——用来覆盖步行到不了的盲区：站间断口、景区内部、被铁路或快速路切断的街区。'));
          b.appendChild(h('div', { class: 'row', style: { marginTop: '6px' } },
            h('button', { class: 'btn sm', onclick: function () { self.busHub(id); } }, '建接驳站 · ' + U.fmtMoney(B.hubCost * g.econ.costIndex(g.clock.y)))));
        } else {
          b.appendChild(h('div', { class: 'kv' }, h('div', { class: 'k' }, '状态'), h('div', { class: 'v' }, '已建 · ' + busList.length + ' 条线')));
          b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '配车与停运在「乘客」里按线路调整——建站是建设，调车是运营。'));
          const cands = self.busCandidates(official);
          if (busList.length < (B.maxPerStation || 4) && cands.length) {
            b.appendChild(h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'wrap' } },
              h('button', { class: 'btn sm primary', onclick: function () { self.busPick(id); } }, '在地图上选终点'),
              h('span', { class: 'tiny muted' }, '悬停即看距离、配车与端点盲区')));
          } else if (busList.length >= (B.maxPerStation || 4)) {
            b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '已开满 ' + (B.maxPerStation || 4) + ' 条，要开新线得先停运一条。'));
          }
        }
      }

      // —— 绘线 / 移动 / 拆除 ——
      b.appendChild(h('div', { class: 'st-sub', style: { marginTop: '14px' } }, '线网与位置'));
      const acts = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } });
      for (const l of lines) {
        const tp = M.lineTopo(net, l.id);
        if (tp.topo === 'loop' || tp.topo === 'invalid' || !tp.adj || !tp.adj.get(id)) continue;
        const deg = tp.adj.get(id).length;
        acts.appendChild(h('button', { class: 'btn sm', onclick: function () { self.startDraw(id, l.id, deg >= 2); } },
          h('span', { class: 'dot', style: { background: l.color } }), deg >= 2 ? '绘制 ' + l.name + ' 支线' : '延长 ' + l.name));
      }
      acts.appendChild(h('button', { class: 'btn sm', onclick: function () { self.startDraw(id, 'new'); } }, '新建线路'));
      b.appendChild(acts);
      b.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn sm', onclick: function () { self.tools.setTool('edit'); self.select({ kind: 'station', id: id }); } }, '移动车站'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn sm danger', onclick: function () { self.demolish({ kind: 'station', id: id }); } }, '拆除')));
      const imp = self.demolishImpact({ kind: 'station', id: id });
      if (imp && imp.lines.length) b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '拆除影响：' + imp.lines.join('；')));
      b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '所有修改先进入建设草案，确认后生效。'));
      return b;
    };

    return {
      // 标题：站名已经带「站」字时不重复（广州东站 ≠ 广州东站站）
      title: /站$/.test(s.name) ? s.name : s.name + '站', el: el, highlightLine: null,
      // 定位按钮进标题栏，不再占正文一行
      locate: [s.x, s.y, 28],
      side: { title: s.name + ' · 改建', icon: 'hammer', cls: 'b-gold', el: buildBody() },
      actions: [
        {
          iconOf: function () { return self.isFav('stations', id) ? 'starOn' : 'star'; },
          state: function () { return self.isFav('stations', id); },
          tipOf: function () { return self.isFav('stations', id) ? '取消收藏' : '收藏（在搜索中置顶）'; },
          act: function () { self.toggleFav('stations', id); },
        },
        {
          icon: 'hammer', label: '改建',
          state: function () { return !!self.building; },
          tipOf: function () { return self.building ? '收起建设面板' : '建设面板：规模、形式、配套、上盖、接驳站'; },
          act: function () { self.toggleBuild(); },
        },
      ],
    };
  };
  // 步行覆盖（沿实际道路）；potential：未通车站接入线路后的潜在覆盖
  UI.prototype.coverBlock = function (s, k, potential) {
    const g = this.g(), acc = g.model.net.acc, tree = acc.trees[k];
    if (!tree) return h('div', { class: 'callout warn' }, '车站周边暂无可步行到达的道路，暂无覆盖。');
    const vm = new Map(); for (let q = 0; q < tree.verts.length; q++) vm.set(tree.verts[q], tree.dist[q]);
    const city = g.city, VW = city.VW, ci = Math.floor(s.x), cj = Math.floor(s.y);
    // 分档随时间按本站的进出站半径走：出入口升级后多出一档，玩家能看见「多走的这部分换来了多少人」
    const lim = acc.stLimit ? acc.stLimit[k] : CFG.walk.maxAccessM;
    const th = [5, 10, 15];
    if (lim > CFG.walk.maxAccessM + 1) th.push(Math.round(lim / CFG.walk.mPerMin));
    const sums = th.map(function () { return 0; }), jobs = th.map(function () { return 0; });
    const rw = Math.ceil(lim / CFG.CELL_M) + 1;
    for (let j = Math.max(0, cj - rw); j <= Math.min(city.H - 1, cj + rw); j++) for (let i = Math.max(0, ci - rw); i <= Math.min(city.W - 1, ci + rw); i++) {
      const v0 = j * VW + i;
      let m = Infinity; for (const v of [v0, v0 + 1, v0 + VW, v0 + VW + 1]) { const dd = vm.get(v); if (dd !== undefined && dd < m) m = dd; }
      m += CFG.walk.cellExtraM;
      const c = j * city.W + i;
      for (let q = 0; q < th.length; q++) if (m <= th[q] * CFG.walk.mPerMin) { sums[q] += city.pop[c]; jobs[q] += city.jobs[c]; }
    }
    return h('div', null, this.kv(th.map(function (v, q) {
      return ['步行 ' + v + ' 分钟内' + (q === 3 ? '（出入口升级）' : ''), U.fmtPeople(sums[q]) + ' 人 · ' + U.fmtPeople(jobs[q]) + ' 岗位'];
    })),
      h('div', { class: 'note', style: { marginTop: '6px' } }, (potential ? '仅为预览：车站未通车前不计入任何覆盖统计。' : '') + '按实际道路步行距离计算（含街道到建筑的平均距离），河流、断路与没有道口或地道的地面铁路会阻隔。'));
  };
  // 拥挤诊断：区分车站容量不足与列车运力不足，给出对应的处理入口
  UI.prototype.crowdBlock = function (id, k) {
    const g = this.g(), self = this, model = g.model, mnet = model.net, C = mnet.C, sd = model.dailyStale ? null : (model.stDailyWk || model.stDaily), mc = CFG.metro;
    if (!sd || k >= sd.peak.length) return null;
    const st = C.stations[k], cap = mc.stationCap[st.size], stR = sd.peak[k] / cap;
    const ord = ['S', 'M', 'L'], next = function (sz) { return ord[Math.min(2, ord.indexOf(sz) + 1)]; };
    const trains = [];
    for (const r of C.stationRoutes[k]) {
      const rt = C.routes[r], re = mnet.rideEdge[r], n = rt.stIdx.length;
      let worst = null;
      for (const p of [0, 2]) {
        const P = model.ctxs.wd.per[p], capH = P.freq[r] * rt.cap;   // 工作日早晚高峰
        if (!(capH > 0)) continue;
        for (let q = 0; q < re.length; q++) {
          const leg = q >> 1, a = rt.stIdx[leg], b = rt.stIdx[(leg + 1) % n];
          if (a !== k && b !== k) continue;
          const lf = P.load[re[q]] / capH;
          if (!worst || lf > worst.lf) worst = { lf: lf, load: P.load[re[q]], capH: capH, leg: leg, a: a, b: b, p: p, freq: P.freq[r] };
        }
      }
      if (worst && worst.lf > 1) trains.push({ rt: rt, w: worst });
    }
    if (stR <= 0.8 && !trains.length) return null;
    const box = h('div', { class: 'diag' }, h('div', { class: 'diag-h' }, CM.icon('warn'), '拥挤诊断'));
    const item = function (level, title, text, actions) { box.appendChild(h('div', { class: 'diag-item lv-' + level }, h('b', null, title), h('div', { class: 'small' }, text), actions.filter(Boolean).length ? h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px', marginTop: '6px' } }, actions.filter(Boolean)) : null)); };
    const divert = h('button', { class: 'btn sm ghost', onclick: function () { self.showDiversion(st); } }, '查看可分流方向');
    if (stR > 0.8) {
      const up = st.size !== 'L' ? h('button', { class: 'btn sm primary', onclick: function () { g.edit(function (n) { if (n.stations[id]) n.stations[id].size = next(st.size); }); self.toast('已在草案中把「' + st.name + '」升级为' + mc.sizeName[next(st.size)] + '车站', 'info'); } }, '升级为' + mc.sizeName[next(st.size)] + '车站') : null;
      item(stR > 1 ? 'bad' : 'warn', stR > 1 ? '车站容量不足' : '车站接近饱和', '工作日高峰小时进出站与换乘约 ' + U.fmtInt(sd.peak[k]) + ' 人次，' + mc.sizeName[st.size] + '车站能力 ' + U.fmtInt(cap) + ' 人次/时（' + U.fmtPct(stR, 0) + '）。' + (stR > 1 ? '乘客在闸机、楼梯与换乘通道排队，进出站变慢。' : '') + (st.size === 'L' ? '已是大型车站，只能通过新线路分流。' : ''), [up, divert]);
    }
    for (const t of trains) {
      const rt = t.rt, w = t.w, A = C.stations[w.a], B = C.stations[w.b];
      const minCars = rt.cars, limiting = rt.stIds.filter(function (sid) { return mc.carsBySize[C.stations[C.sIndex.get(sid)].size] === minCars; });
      const atMax = w.freq >= mc.fMax - 0.5;
      const helpsHere = limiting.indexOf(id) >= 0;
      const segRef = rt.segRefs[w.leg];
      const locate = h('button', { class: 'btn sm', onclick: function () { self.flyTo((A.x + B.x) / 2, (A.y + B.y) / 2, Math.max(self.R.cam.zoom, 20)); if (segRef) self.select({ kind: 'seg', id: segRef.id }); } }, '定位瓶颈区间');
      const lengthen = minCars < 8 ? h('button', { class: 'btn sm primary', onclick: function () {
        g.edit(function (n) { for (const sid of limiting) if (n.stations[sid]) n.stations[sid].size = next(n.stations[sid].size); });
        self.toast('已在草案中升级 ' + limiting.length + ' 座车站，' + rt.line.name + ' 可加长到 ' + mc.carsBySize[next(C.stations[C.sIndex.get(limiting[0])].size)] + ' 节编组', 'info');
      } }, '加长编组：升级 ' + limiting.length + ' 座' + mc.sizeName[C.stations[C.sIndex.get(limiting[0])].size] + '车站') : null;
      item('bad', '列车运力不足 · ' + rt.label, A.name + '—' + B.name + ' 区间工作日' + (w.p === 0 ? '早' : '晚') + '高峰断面约 ' + U.fmtInt(w.load) + ' 人/时，超过运力 ' + U.fmtInt(w.capH) + ' 人/时（' + U.fmtNum(w.freq, 1) + ' 列/时' + (atMax ? '，已达发车上限' : '') + '，' + minCars + ' 节编组）。' +
        (minCars < 8 ? '编组受沿线最小车站限制，' + (helpsHere ? '本站是限制编组的车站之一，需与其余 ' + (limiting.length - 1) + ' 座同时升级。' : '只升级本站不能解决，需要升级限制编组的车站。') : '已是最长编组，只能修建平行线路分流。'), [locate, lengthen, divert]);
    }
    return box;
  };
  // 可分流方向：打开出行方向图层（只看地铁）并定位到车站
  UI.prototype.showDiversion = function (st) {
    this.R.layerOpt.flow = 'metro';
    this.setLayer('flow');
    this.flyTo(st.x, st.y, Math.min(this.R.cam.zoom, 16));
    this.toast('出行方向图层：经过「' + st.name + '」一带的粗蓝色流向，是修建平行线路分流的候选方向', 'info');
  };
  // 从车站开始绘线：延长线路、绘制支线或新建线路
  UI.prototype.startDraw = function (sid, lid, branch) {
    const g = this.g(), T = this.tools, net = g.draft ? g.draft.net : g.net, s = net.stations[sid];
    if (!s) return;
    T.setTool('line');
    T.lineChoice = lid; T.chain = sid; T.bends = [];
    T.lineLock = true;
    this.renderToolOpts();
    const ln = lid !== 'new' ? net.lines[lid] : null;
    this.toast(ln ? (branch ? '从「' + s.name + '」绘制 ' + ln.name + ' 支线' : '从「' + s.name + '」延长 ' + ln.name) + '：点击车站或空地连线，右键结束' : '从「' + s.name + '」开始新建线路：点击车站或空地连线', 'info');
  };

  // ======================== 页面：线路 ========================
  // 单条线路的经营总账（票款 / 运营 / 上盖 / 投资）。线路详情与财务概览共用同一份计算，
  // 避免两处口径漂移。没有线网、没有客流统计或线路仍在草案中时返回 null。
  UI.prototype.lineAccount = function (lid) {
    const g = this.g(), mnet = g.model && g.model.net, line = g.net.lines[lid];
    if (!mnet || !mnet.C || !line) return null;
    const C = mnet.C, idx = [];
    for (let i = 0; i < C.routes.length; i++) if (C.routes[i].lineId === lid) idx.push(i);
    if (!idx.length) return null;
    const daily = g.model.dailyStale ? null : g.model.stDaily;
    if (!daily || !daily.routeBoard) return null;
    let board = 0, allBoard = 0;
    for (let i = 0; i < daily.routeBoard.length; i++) allBoard += daily.routeBoard[i];
    for (const i of idx) board += daily.routeBoard[i];
    const oi = g.econ.opsIndex(g.clock.y);
    let ckm = 0, lenM = 0;
    for (const i of idx) {
      const rt = C.routes[i];
      for (let p = 0; p < 4; p++) ckm += g.model.live.per[p].freq[i] * 2 * rt.lenM / 1000 * rt.cars * (p === 3 ? 5 : g.model.pHours[p]);
      if (rt.lenM > lenM) lenM = rt.lenM;
    }
    const fareV = (g.model.fare && g.model.fare.flat) || CFG.fareDefault.flat || 2;
    const yearFare = board * fareV * 365 / 1e4;                                   // 万元/年（按上车人次近似）
    const yearOps = ckm * CFG.ops.carKmCost * oi * 365;                           // 万元/年（carKmCost 单位即万元/车厢公里）
    const tp = M.lineTopo(g.net, lid);
    let propYear = 0, sites = 0;
    for (const sid of tp.stations) {
      const st = g.net.stations[sid];
      if (!st || !(st.dev | 0)) continue;
      const pr = g.propertyOf(st);
      if (!pr) continue;
      propYear += pr.netFull * 12; sites++;
    }
    return {
      lid: lid, name: line.name, color: line.color, board: board, allBoard: allBoard,
      yearFare: yearFare, yearOps: yearOps, propYear: propYear, sites: sites,
      cash: yearFare - yearOps + propYear, lenM: lenM, stations: tp.stations.length,
      capex: lenM / 1000 * (CFG.cost.trackPerKm[line.type] || 30000),                // 万元（估，不含拆迁与车站差别）
    };
  };

  UI.prototype.page_line = function (key) {
    const g = this.g(), self = this;
    const parts = String(key).split('|'), lid = parts[0], segId = parts[1];
    const net = g.draft ? g.draft.net : g.net;
    const line = net.lines[lid];
    if (!line) return null;
    const el = h('div');
    const tp = M.lineTopo(net, lid);
    const segs = M.lineSegs(net, lid);
    let len = 0; for (const s of segs) len += M.segGeom(net, s, g.city).lenM;
    el.appendChild(h('div', { class: 'row', style: { marginBottom: '8px', flexWrap: 'wrap' } }, h('span', { class: 'swatch', style: { background: line.color, width: '22px', height: '8px' } }), h('span', { class: 'tag' }, M.TOPO_NAME[tp.topo]), h('span', { class: 'tag' }, U.fmtKm(len)), h('span', { class: 'tag' }, tp.stations.length + ' 站'), !g.net.lines[lid] ? h('span', { class: 'tag info' }, '草案中') : null, h('span', { class: 'grow' }), this.favBtn('lines', lid)));
    if (tp.topo === 'path' || tp.topo === 'branch') el.appendChild(h('div', { class: 'note', style: { marginBottom: '6px' } }, '拖动地图上线路端点的「+」手柄可直接延长；在车站详情中可从中间站绘制支线。'));
    if (tp.topo === 'invalid') el.appendChild(h('div', { class: 'callout bad' }, tp.reason));
    // 运营
    const mnet = g.model.net;
    const routes = mnet ? mnet.C.routes.map(function (r, i) { return [r, i]; }).filter(function (a) { return a[0].lineId === lid; }) : [];
    if (routes.length && g.net.lines[lid]) {
      const W = function () { return g.model.weights(g.clock.minute); };
      const daily = g.model.dailyStale ? null : g.model.stDaily;
      let board = 0; if (daily) for (const r of routes) board += daily.routeBoard[r[1]];
      const grid = h('div', { class: 'stat-grid' });
      let bw = 0, be = 0; if (daily && g.model.stDailyWk && g.model.stDailyWe) for (const r of routes) { bw += g.model.stDailyWk.routeBoard[r[1]]; be += g.model.stDailyWe.routeBoard[r[1]]; }
      grid.append(this.stat('日客运量（上车，周平均）', daily ? U.fmtPeople(board) + ' 人次' : '计算中…', daily ? '工作日 ' + U.fmtPeople(bw) + ' · 周末 ' + U.fmtPeople(be) : ''));
      const oi = g.econ.opsIndex(g.clock.y);
      let ckm = 0;
      for (const r of routes) for (let p = 0; p < 4; p++) ckm += g.model.live.per[p].freq[r[1]] * 2 * r[0].lenM / 1000 * r[0].cars * (p === 3 ? 5 : g.model.pHours[p]);
      grid.append(this.stat('日运营费用（' + (g.model.dayType === 'we' ? '周末' : '工作日') + '）', U.fmtMoney(ckm * CFG.ops.carKmCost * oi), '列车 ' + U.fmtInt(ckm) + ' 车厢公里'));
      // 选型与线形参照（A5）：全程时分与旅行速度。站距一拉长，旅速就上去，但覆盖会掉——
      // 这两个数放在一起才好判断，单看里程没有意义。
      const rt0 = routes[0][0], mc0 = CFG.metro, nSt0 = rt0.stIdx.length;
      const rideMin = rt0.runSec / 60 + mc0.dwell / 60 * Math.max(0, nSt0 - 1);
      grid.append(this.stat('全程时分' + (routes.length > 1 ? '（' + rt0.label + '）' : ''), rideMin.toFixed(0) + ' 分钟',
        '旅行速度 ' + (rt0.lenM / 1000 / (rideMin / 60)).toFixed(1) + ' km/h · 平均站间 ' + U.fmtKm(rt0.lenM / Math.max(1, nSt0 - 1))));
      el.appendChild(grid);
      // 线路总账（经营模式）：票款、运营与沿线上盖放在同一张表里，一眼看出这条线养不养得活
      const acc = g.econ.caps.land ? this.lineAccount(lid) : null;
      if (acc) {
        el.appendChild(this.sec('ln-acct', '线路总账', acc.cash < 0 ? '需补贴' : '有盈余', function () {
          const b = h('div');
          b.appendChild(self.kv([
            ['日客运量', U.fmtPeople(acc.board) + ' 人次' + (acc.allBoard > 0 ? '（占全网 ' + U.fmtPct(acc.board / acc.allBoard, 0) + '）' : '')],
            ['年票款', '+ ' + U.fmtMoney(acc.yearFare)],
            ['年运营成本', '− ' + U.fmtMoney(acc.yearOps)],
            ['沿线上盖年净', (acc.propYear >= 0 ? '+ ' : '− ') + U.fmtMoney(Math.abs(acc.propYear)) + (acc.sites ? '（' + acc.sites + ' 处）' : '（未开发）')],
            ['年现金流', (acc.cash < 0 ? '− ' + U.fmtMoney(-acc.cash) : '+ ' + U.fmtMoney(acc.cash))],
            ['建设投资', U.fmtMoney(acc.capex) + '（估）'],
            ['结论', acc.cash < 0 ? '每年需补贴 ' + U.fmtMoney(-acc.cash) : '按当前现金流，' + Math.max(1, Math.round(acc.capex / acc.cash)) + ' 年收回投资'],
          ]));
          b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '票款按上车人次估算；运营成本按车厢公里；上盖按满租口径的年净额计入。地铁投资通常要几十年才能靠自身现金流收回，上盖的作用是缩小缺口，而不是让它变成暴利生意。'));
          return b;
        }, true));
      }
      for (const it of routes) {
        const r = it[0], ri = it[1];
        el.appendChild(this.sec('ln-r-' + r.label, r.label, '', function () {
          const b = h('div');
          const rows = h('div');
          const upd = function () {
            const w = W(); const f = g.model.freqAt(ri, w);
            const re = mnet.rideEdge[ri];
            let mx = 0; for (let q = 0; q < re.length; q++) mx = Math.max(mx, g.model.edgeLoadAt(re[q], w));
            const capH = f * r.cap;
            // 配车：全日各时段所需列车的最大值，以及本时段的依据（站数、站距、客流）
            let fleet = 0; for (let p = 0; p < 4; p++) fleet = Math.max(fleet, Math.ceil(r.cycleSec * g.model.live.per[p].freq[ri] / 3600));
            const ns = r.stIdx.length, sp = r.lenM / 1000 / Math.max(1, r.loop ? ns : ns - 1);
            const floor = CM.Model.serviceFloor(r, w.p0), byLoad = mx / (r.cap * CFG.metro.targetLF);
            rows.innerHTML = '';
            rows.appendChild(self.kv([
              ['当前发车', f > 0 ? U.fmtNum(f, 1) + ' 列/小时（间隔 ' + U.fmtNum(60 / f, 1) + ' 分钟）' : '停运（06:00–24:00 运营）'],
              ['运行列车', f > 0 ? Math.ceil(r.cycleSec / (3600 / f)) + ' 列（周转 ' + Math.round(r.cycleSec / 60) + ' 分钟）' : '—'],
              ['配属列车', fleet + ' 列（全日各时段所需的最大值）'],
              ['配车依据', ns + ' 站 · 平均站距 ' + U.fmtNum(sp, 1) + ' km → 最低 ' + U.fmtNum(floor, 1) + ' 列/时；客流需要 ' + U.fmtNum(byLoad, 1) + ' 列/时' + (byLoad > floor ? '（按客流）' : '（按服务水平）')],
              ['列车编组', r.cars + ' 节（受沿线最小车站限制），定员 ' + U.fmtInt(r.cap) + ' 人'],
              ['单向运力', f > 0 ? U.fmtInt(capH) + ' 人/小时' : '—'],
              ['最大断面客流', U.fmtInt(mx) + ' 人/小时', capH > 0 && mx > capH ? 'bad' : ''],
              ['满载率', capH > 0 ? U.fmtPct(mx / capH, 0) : '—', capH > 0 && mx > capH ? 'bad' : ''],
            ]));
          };
          upd(); self.live.push(upd);
          b.appendChild(rows);
          b.appendChild(h('div', { class: 'small muted', style: { margin: '8px 0 2px' } }, '当前小时各区间断面客流（上行/下行）'));
          const chart = h('div');
          const drawChart = function () { chart.innerHTML = ''; chart.appendChild(self.loadChart(r, ri, W())); };
          drawChart(); self.live.push(function () { if (Math.random() < 0.25) drawChart(); });
          b.appendChild(chart);
          b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '列车数由系统自动调配：车站越多、站距越小的城区线基础班次越密，站距大的郊区线较疏，每条线路至少 2 列；客流超过时按最大断面客流加车（最小间隔 2 分钟）。达到上限后体现为拥挤，需要升级车站以加长编组或修建平行线路分流。'));
          return b;
        }, routes.length === 1));
      }
    } else if (!g.net.lines[lid]) {
      el.appendChild(h('div', { class: 'callout info' }, '这是草案中的新线路，确认建设后立即投入运营。'));
    }
    // 车站列表
    el.appendChild(this.sec('ln-st', '车站', tp.stations.length + ' 座', function () {
      const b = h('div');
      const order = tp.routes.length ? tp.routes[0].st.concat(tp.routes.slice(1).map(function (r) { return r.st.filter(function (s) { return tp.routes[0].st.indexOf(s) < 0; }); }).flat()) : tp.stations;
      for (const sid of order) { const s = net.stations[sid]; if (!s) continue; b.appendChild(h('div', { class: 'small clickable', style: { padding: '4px' }, onclick: function () { self.select({ kind: 'station', id: sid }); } }, '● ' + s.name + '  ', h('span', { class: 'faint' }, CFG.metro.sizeName[s.size]))); }
      return b;
    }));
    // 选中区段
    const seg = segId ? net.segments[segId] : null;
    if (seg) {
      const geo = M.segGeom(net, seg, g.city);
      el.appendChild(this.sec('ln-seg', '选中区段：' + net.stations[seg.a].name + '—' + net.stations[seg.b].name, '', function () {
        const b = h('div');
        b.appendChild(self.kv([['长度', U.fmtKm(geo.lenM)], ['建设方式', CFG.metro.typeName[seg.type]], geo.waterM > 1 ? ['跨江', (seg.type === 'underground' ? '越江隧道 ' : '跨江桥梁 ') + U.fmtKm(geo.waterM)] : null, geo.hillM > 1 ? ['山体隧道', U.fmtKm(geo.hillM)] : null, ['最小曲线半径', isFinite(geo.minRadiusM) ? Math.round(geo.minRadiusM) + ' m' : '直线']]));
        const tc = h('div', { class: 'seg-ctl', style: { marginTop: '8px' } });
        for (const t of ['underground', 'surface', 'elevated']) {
          const cost = M.trackCost(geo, t, g.clock.y);
          tc.appendChild(h('button', { class: seg.type === t ? 'on' : '', 'data-tip': '约 ' + U.fmtMoney(cost), onclick: function () { const c = (g.draft ? g.draft.net : g.net).segments[segId]; if (c && c.type !== t) g.edit(function (n) { n.segments[segId].type = t; }); } }, CFG.metro.typeName[t]));
        }
        b.appendChild(h('div', { class: 'field' }, h('label', null, '改变建设方式（按新建计费；跨江：地下=隧道，地面/高架=桥梁）'), tc));
        b.appendChild(h('div', { class: 'row', style: { marginTop: '6px' } },
          h('button', { class: 'btn sm', onclick: function () { self.tools.setTool('edit'); self.select({ kind: 'seg', id: segId }); } }, '调整线形'),
          h('button', { class: 'btn sm danger', onclick: function () { self.demolish({ kind: 'seg', id: segId }); } }, '拆除区段')));
        const imp = self.demolishImpact({ kind: 'seg', id: segId });
        if (imp && imp.lines.length) b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '拆除影响：' + imp.lines.join('；')));
        return b;
      }, true));
    }
    // 线路信息
    el.appendChild(this.sec('ln-edit', '线路名称与颜色', '', function () {
      const b = h('div');
      const nameIn = h('input', { type: 'text', value: line.name, maxlength: 14 });
      const colors = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px', margin: '6px 0' } });
      for (const c of D.lineColorsNice) colors.appendChild(h('button', { title: c, style: { width: '22px', height: '22px', borderRadius: '6px', border: c === line.color ? '2px solid #1f2630' : '1px solid #ddd', background: c, cursor: 'pointer' }, onclick: function () { g.edit(function (n) { n.lines[lid].color = c; }); } }));
      b.append(h('div', { class: 'field' }, h('label', null, '名称'), h('div', { class: 'row' }, nameIn, h('button', { class: 'btn sm', onclick: function () { const v = nameIn.value.trim(); if (v) g.edit(function (n) { n.lines[lid].name = v; }); } }, '保存'))), colors);
      b.appendChild(h('div', { class: 'row' },
        h('button', { class: 'btn sm danger', onclick: function () { g.edit(function (n) { for (const s of M.lineSegs(n, lid)) delete n.segments[s.id]; delete n.lines[lid]; }); self.select(null); self.toast('已在草案中拆除 ' + line.name + ' 全部轨道（车站保留，可单独拆除）', 'info'); } }, '拆除整条线路')));
      return b;
    }));
    // 批量修改：本线全部车站或轨道
    el.appendChild(this.sec('ln-batch', '批量修改', '', function () {
      return h('div', null, h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } },
        h('button', { class: 'btn sm', onclick: function () { self.setMulti({ stations: tp.stations.slice(), segs: [] }); } }, '选中本线全部车站（' + tp.stations.length + '）'),
        h('button', { class: 'btn sm', onclick: function () { self.setMulti({ stations: [], segs: segs.map(function (s) { return s.id; }) }); } }, '选中本线全部轨道（' + segs.length + '）')),
        h('div', { class: 'note', style: { marginTop: '6px' } }, '也可以在地图上按住 Ctrl（或 Shift）点击多座车站或多段轨道进行多选。'));
    }));
    return { title: line.name, el: el, highlightLine: lid };
  };
  UI.prototype.loadChart = function (r, ri, W) {
    const g = this.g(), mnet = g.model.net, re = mnet.rideEdge[ri];
    const n = r.segRefs.length;
    const up = [], dn = [];
    let mx = 1;
    for (let k = 0; k < n; k++) { const a = g.model.edgeLoadAt(re[2 * k], W), b = g.model.edgeLoadAt(re[2 * k + 1], W); up.push(a); dn.push(b); mx = Math.max(mx, a, b); }
    const f = g.model.freqAt(ri, W), cap = f * r.cap;
    if (cap > mx) mx = cap;
    const Wd = 300, H = 90, bw = Wd / Math.max(1, n);
    let svg = '<svg viewBox="0 0 ' + Wd + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none">';
    svg += '<line x1="0" y1="' + H / 2 + '" x2="' + Wd + '" y2="' + H / 2 + '" stroke="#ccd" stroke-width="1"/>';
    for (let k = 0; k < n; k++) {
      const hu = up[k] / mx * (H / 2 - 4), hd = dn[k] / mx * (H / 2 - 4);
      const cu = cap > 0 && up[k] > cap ? '#d63031' : r.color, cd = cap > 0 && dn[k] > cap ? '#d63031' : r.color;
      svg += '<rect x="' + (k * bw + 1) + '" y="' + (H / 2 - hu) + '" width="' + Math.max(1, bw - 2) + '" height="' + hu + '" fill="' + cu + '" opacity="0.85"/>';
      svg += '<rect x="' + (k * bw + 1) + '" y="' + H / 2 + '" width="' + Math.max(1, bw - 2) + '" height="' + hd + '" fill="' + cd + '" opacity="0.55"/>';
    }
    if (cap > 0) { const y1 = H / 2 - cap / mx * (H / 2 - 4), y2 = H / 2 + cap / mx * (H / 2 - 4); svg += '<line x1="0" y1="' + y1 + '" x2="' + Wd + '" y2="' + y1 + '" stroke="#d63031" stroke-dasharray="4 3" stroke-width="1"/><line x1="0" y1="' + y2 + '" x2="' + Wd + '" y2="' + y2 + '" stroke="#d63031" stroke-dasharray="4 3" stroke-width="1"/>'; }
    svg += '</svg>';
    const first = g.compiled.stations[r.stIdx[0]], last = g.compiled.stations[r.stIdx[r.stIdx.length - 1]];
    return h('div', null, h('div', { html: svg }), h('div', { class: 'row between tiny muted' }, h('span', null, first ? first.name : ''), h('span', null, '红色虚线 = 当前运力'), h('span', null, last ? last.name : '')));
  };

  // ======================== 页面：批量修改 ========================
  // 多选车站统一升级、多选轨道统一建设方式：先预览合计费用与新增冲突，再作为一步加入草案（可整批撤销）
  UI.prototype.page_multi = function () {
    const g = this.g(), self = this, mu = this.multi;
    if (!mu || (!mu.stations.size && !mu.segs.size)) return null;
    const net = g.draft ? g.draft.net : g.net, mc = CFG.metro, ord = ['S', 'M', 'L'];
    const st = Array.from(mu.stations).filter(function (id) { return net.stations[id]; });
    const sg = Array.from(mu.segs).filter(function (id) { return net.segments[id]; });
    const el = h('div');
    el.appendChild(h('div', { class: 'note' }, '已选 ' + st.length + ' 座车站、' + sg.length + ' 段轨道（地图上以蓝色标出）。按住 Ctrl 或 Shift 点击地图可继续添加或移除。'));
    const chips = h('div', { class: 'chips' });
    const chip = function (label, color, onRemove) { return h('span', { class: 'chip' }, color ? h('span', { class: 'dot', style: { background: color } }) : null, label, h('button', { class: 'chip-x', 'data-tip': '移出多选', onclick: onRemove }, '×')); };
    for (const id of st) chips.appendChild(chip(net.stations[id].name, null, function () { self.toggleMulti('station', id); }));
    for (const id of sg) { const s = net.segments[id], L = net.lines[s.line]; chips.appendChild(chip((L ? L.name + ' ' : '') + net.stations[s.a].name + '—' + net.stations[s.b].name, L ? L.color : null, function () { self.toggleMulti('seg', id); })); }
    el.appendChild(chips);
    // 混合属性
    const count = function (arr, key, names) { const m = {}; for (const x of arr) m[x[key]] = (m[x[key]] || 0) + 1; return Object.keys(m).map(function (k) { return names[k] + ' ' + m[k]; }).join(' · '); };
    if (st.length) el.appendChild(h('div', { class: 'small', style: { marginTop: '8px' } }, '车站规模：' + count(st.map(function (id) { return net.stations[id]; }), 'size', mc.sizeName)));
    if (sg.length) el.appendChild(h('div', { class: 'small' }, '轨道建设方式：' + count(sg.map(function (id) { return net.segments[id]; }), 'type', mc.typeName)));
    const pv = h('div');
    const preview = function (label, fn, nChanged) {
      pv.innerHTML = '';
      if (!nChanged) { pv.appendChild(h('div', { class: 'callout info' }, label + '：所选对象均已满足，无需修改。')); return; }
      const clone = M.clone(net); fn(clone);
      const ev0 = g.draft ? g.draftEval() : { total: 0, conflicts: [] };
      const ev1 = M.evaluate(clone, g.net, g.city, g.clock.y);
      const fresh = ev1.conflicts.filter(function (c) { return !ev0.conflicts.some(function (o) { return o.msg === c.msg; }); });
      const box = h('div', { class: 'batch-pv' }, h('b', null, label + '（' + nChanged + ' 项）'),
        self.kv([['本次批量费用', U.fmtMoney(Math.max(0, ev1.total - ev0.total))], ['草案合计', U.fmtMoney(ev1.total)], ['新增冲突', fresh.length ? fresh.length + ' 处' : '无', fresh.length ? 'bad' : 'good']]));
      for (const c of fresh.slice(0, 6)) box.appendChild(h('div', { class: 'small bad', style: { padding: '2px 0' } }, '· ' + c.msg));
      box.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'grow' }),
        h('button', { class: 'btn sm', onclick: function () { pv.innerHTML = ''; } }, '取消'),
        h('button', { class: 'btn sm primary', onclick: function () { const r = g.edit(fn); if (r && r.error) { self.toast(r.error, 'bad'); return; } self.toast('已把「' + label + '」加入草案（可一次撤销）', 'good'); } }, '加入草案')));
      pv.appendChild(box);
    };
    if (st.length) {
      el.appendChild(h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', null, '统一车站规模（只升级，较大的车站保持不变）'),
        h('div', { class: 'seg-ctl' }, ord.slice(1).map(function (sz) {
          const n = st.filter(function (id) { return ord.indexOf(net.stations[id].size) < ord.indexOf(sz); }).length;
          return h('button', { onclick: function () { preview('统一升级为' + mc.sizeName[sz] + '车站', function (nn) { for (const id of st) { const s = nn.stations[id]; if (s && ord.indexOf(s.size) < ord.indexOf(sz)) s.size = sz; } }, n); } }, '至少' + mc.sizeName[sz] + '（' + n + '）');
        }))));
    }
    if (sg.length) {
      el.appendChild(h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', null, '统一轨道建设方式（按新建计费）'),
        h('div', { class: 'seg-ctl' }, ['underground', 'surface', 'elevated'].map(function (t) {
          const n = sg.filter(function (id) { return net.segments[id].type !== t; }).length;
          return h('button', { onclick: function () { preview('统一改为' + mc.typeName[t], function (nn) { for (const id of sg) if (nn.segments[id]) nn.segments[id].type = t; }, n); } }, mc.typeName[t] + '（' + n + '）');
        }))));
    }
    el.appendChild(pv);
    el.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm ghost', onclick: function () { self.clearMulti(); } }, '清空多选')));
    return { title: '批量修改', el: el };
  };

  // ======================== 页面：道路 / 片区 ========================
  UI.prototype.page_road = function (id) {
    const g = this.g(), model = g.model, road = model.road, L = road.links[id];
    if (!L) return null;
    const self = this;
    const el = h('div');
    const name = g.city.roadNames[L.name] || (L.cls === 2 ? '次干道' : '道路');
    const clsName = ['', '支路', '次干道', '主干道', '快速路'][L.cls];
    el.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } }, h('span', { class: 'tag' }, clsName), L.bridge ? h('span', { class: 'tag info' }, '桥梁/隧道') : null, h('span', { class: 'tag' }, U.fmtKm(L.lenM))));
    const grid = h('div', { class: 'stat-grid' });
    const s0 = this.stat('方向 A 流量', '—'), s1 = this.stat('方向 B 流量', '—');
    grid.append(s0, s1);
    el.appendChild(grid);
    const upd = function () {
      const W = model.weights(g.clock.minute);
      for (let d = 0; d < 2; d++) {
        const a = 2 * L.id + d, v = model.arcVolAt(a, W), x = v / model.cap(a), r = model.arcRatioAt(a, W);
        (d ? s1 : s0).setV(U.fmtInt(v) + ' 辆/时', '饱和度 ' + x.toFixed(2) + ' · 车速 ' + Math.round(CFG.road.speed[L.cls] / Math.min(8, r)) + ' km/h', x > 1 ? 'bad' : (x > 0.8 ? 'warn' : 'muted'));
      }
    };
    upd(); this.live.push(upd);
    el.appendChild(this.kv([['单向通行能力', U.fmtInt(model.cap(2 * L.id)) + ' 辆/小时'], ['自由流速度', CFG.road.speed[L.cls] + ' km/h']]));
    el.appendChild(h('div', { class: 'small muted', style: { margin: '10px 0 2px' } }, '全天饱和度变化（' + (model.dayType === 'we' ? '今天为周末' : '今天为工作日') + '，两方向较大者）'));
    const vals = [];
    for (let hr = 0; hr < 24; hr++) { const W = model.weights(hr * 60 + 30); vals.push(Math.max(model.arcVolAt(2 * L.id, W), model.arcVolAt(2 * L.id + 1, W)) / model.cap(2 * L.id)); }
    el.appendChild(this.spark(vals, { color: '#e8642c', ref: 1, labels: ['0 时', '12 时', '24 时'] }));
    el.appendChild(h('div', { class: 'note', style: { marginTop: '8px' } }, '饱和度 = 小时流量 ÷ 通行能力。道路由系统建设与发展；地铁可吸引汽车出行转移，从而改变道路流量。'));
    return { title: name, el: el };
  };
  UI.prototype.page_zone = function (z) {
    const g = this.g(), model = g.model, self = this;
    const el = h('div');
    const acc = model.net ? model.net.acc : null;
    const P = model.ctxs.wd.per[0];
    el.appendChild(this.kv([
      ['范围', '约 1 km × 1 km 交通小区'],
      ['常住人口', U.fmtPeople(model.zPop[z])], ['就业岗位', U.fmtPeople(model.zJobs[z])],
      ['地铁覆盖（步行 15 分钟）', acc ? U.fmtPct(acc.zCov[z]) : '0%'],
      ['工作日早高峰出发地铁占比', P.zTrips[z] > 0 ? U.fmtPct(P.zMetro[z] / P.zTrips[z]) : '—'],
      ['工作日早高峰道路拥堵指数', g.zoneCong(z, 'wd').toFixed(2)],
    ]));
    // 地价（经营模式）：平均地价 + 三项分项指数，回答"这里为什么贵"
    const lz = g.city.landZone, ls = g.city.landStat;
    if (g.econ.caps.land && lz && ls && lz.n[z]) {
      const zn = lz.n[z], avg = lz.price[z] / zn;
      const money = function (v) { return v >= 10000 ? (v / 10000).toFixed(2) + ' 万元/㎡' : (v >= 1000 ? (v / 1000).toFixed(1) + ' 千元/㎡' : Math.round(v) + ' 元/㎡'); };
      const rel = avg / Math.max(1, ls.p50);
      el.appendChild(this.sec('z-land', '地价', rel >= 1.25 ? '明显偏高' : (rel >= 1.05 ? '偏高' : (rel <= 0.8 ? '偏低' : '接近全城')), function () {
        const box = h('div');
        box.appendChild(self.kv([
          ['平均地价', money(avg)],
          ['全城中位', money(ls.p50)],
          ['相对全城', rel.toFixed(2) + '×'],
          ['分项指数', 'POI ×' + (lz.poi[z] / zn).toFixed(2) + ' · 可达 ×' + (lz.acc[z] / zn).toFixed(2) + ' · 密度 ×' + (lz.dens[z] / zn).toFixed(2)],
        ]));
        box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '地价 = 基准 × POI × 站点可达性 × 密度，每月随城市与线网更新。核心区地价高，拆迁与线路改造也更贵。'));
        return box;
      }, true));
    }
    // 增长归因（A8）：这一片为什么长人、为什么不长。
    // 数据来自 City.growMonth 每月留下的分项快照——增长权重 = 剩余容量 × 可达项 × 临街项 × 随机项，
    // 容积率决定容量上限（修地铁把上限抬高，所以地铁从「可达」和「容量」两条路进入）。
    const gr = g.city.growth;
    if (gr && gr.mi === g.ym()) {
      const city = g.city, N = city.N;
      const zw = function (c) { return city.zoneOf(c); };
      const stat = function (zz) {
        const o = { all: 0, part: 0, built: 0, sat: 0, closed: 0, noroad: 0, unusable: 0, rem: 0, acc: 0, nb: 0, far: 0, grew: 0, pop: 0, cap: 0 };
        for (let c = 0; c < N; c++) {
          if (zz >= 0 && zw(c) !== zz) continue;
          o.all++;
          const w = gr.why[c];
          if (w === 1 || w === 3) o.unusable++;
          else if (w === 2) o.closed++;
          else if (w === 4) o.noroad++;
          else if (w === 5) o.sat++;
          else o.part++;
          if (w === 0 || w === 5) { o.built++; o.far += gr.far[c]; o.cap += gr.cap[c]; }
          if (w === 0) { o.rem += gr.rem[c]; o.acc += 0.25 + gr.acc[c]; o.nb += 0.3 + gr.nb[c]; }
          o.grew += gr.grew[c]; o.pop += city.pop[c];
        }
        return o;
      };
      const mine = stat(z), all = stat(-1);
      const avg = function (o, k) { return o.part > 0 ? o[k] / o.part : NaN; };
      const rel = function (k) { const a = avg(mine, k), b = avg(all, k); return (isFinite(a) && b > 0) ? a / b : NaN; };
      // 没有可用空地时这些乘子没有意义，显示「—」而不是 0.00
      const fx = function (v) { return isFinite(v) ? '×' + v.toFixed(2) + '（全城 1.00）' : '—（无可用空地）'; };
      const pct = function (v) { return Math.abs(v) > 0 && Math.abs(v) < 0.005 ? '<1%' : U.fmtPct(v, 0); };
      const farAvg = function (o) { return o.built > 0 ? o.far / o.built : 1; };
      const share = all.grew !== 0 ? mine.grew / all.grew : 0;
      const occ = mine.cap > 0 ? Math.min(1, mine.pop / mine.cap) : 1;
      const sumTxt = mine.grew >= 0 ? '+' + U.fmtPeople(mine.grew) + ' 人' : '−' + U.fmtPeople(-mine.grew) + ' 人';
      el.appendChild(this.sec('z-grow', '增长归因', sumTxt + ' · 本月', function () {
        const box = h('div');
        box.appendChild(self.kv([
          ['本月新增人口', (mine.grew >= 0 ? '+' : '−') + U.fmtPeople(Math.abs(mine.grew)) + '（占全市 ' + pct(share) + '）'],
          ['可建格数', mine.built + ' / ' + mine.all + ' 格'],
          ['剩余容量', U.fmtPeople(mine.rem) + ' 人 · 已用 ' + U.fmtPct(occ, 0)],
          ['可达项', fx(rel('acc'))],
          ['临街项', fx(rel('nb'))],
          ['容积率乘子', '×' + farAvg(mine).toFixed(2) + (farAvg(mine) > 1.02 ? '（地铁放宽容积率）' : '')],
        ]));
        // 短板先说：饱和与未开放是「不长」的两个主要原因，和权重高低无关
        let tip = '';
        if (occ >= 0.95 && mine.built > 0) tip = '这片已经饱和：容量用尽，再修地铁到这里也长不动——只有加密（分区调整）或外溢到相邻片区。';
        else if (mine.closed > mine.built) tip = '主要限制是区域未开放：先让全市人口达到门槛，这片才开始长。';
        else if (mine.noroad > 0 && mine.noroad >= mine.part) tip = '多数格子没有临街道路，增长需要先有街区与道路。';
        else if (isFinite(rel('acc'))) { const r = rel('acc'), s2 = rel('nb'); tip = r > s2 ? '增长主要由地铁可达性拉动（可达项高于临街项）。' : '增长主要由临街与既有街区拉动（临街项高于可达项），地铁在这里还没形成优势。'; }
        else tip = '这片没有可用的空地（用地不可建或已被占满），增长只能发生在相邻片区。';
        // 不长的那几类格子单列一行：这是「为什么长不动」的直接答案
        const why = [];
        if (mine.sat) why.push('已饱和 ' + mine.sat);
        if (mine.closed) why.push('区域未开放 ' + mine.closed);
        if (mine.noroad) why.push('没有临街道路 ' + mine.noroad);
        if (mine.unusable) why.push('用地不可建 ' + mine.unusable);
        if (why.length) box.appendChild(h('div', { class: 'tiny muted', style: { marginTop: '5px' } }, '不参与增长：' + why.join(' · ')));
        box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, tip));
        box.appendChild(h('div', { class: 'note', style: { marginTop: '4px' } }, '增长权重 = 剩余容量 × 可达项 × 临街项 × 随机项；容积率决定容量上限（站点旁最高 ' + (1 + (CFG.land ? CFG.land.farGain : 0)) + ' 倍），所以地铁从「可达」和「容量」两条路同时抬高增长。'));
        return box;
      }, false, 'people'));
    }
    // 普通设施（按片区汇总）吸引的出行：分目的，工作日与周末（模拟结果）
    if (model.facData('wd') && model.facData('we')) {
      const Z = model.Z, a = model.facDaily.wd, b = model.facDaily.we, TR = CFG.trips;
      const t = h('table', { class: 'tbl' }, h('tr', null, h('th', null, '出行目的'), h('th', null, '工作日'), h('th', null, '周末'), h('th', null, '乘地铁（工作日）')));
      let any = false;
      ['hw', 'sc', 'sh', 'md', 'lz'].forEach(function (k) {
        const qi = TR.keys.indexOf(k), v1 = a.dest[qi * Z + z], v2 = b.dest[qi * Z + z], m1 = a.destM[qi * Z + z];
        if (v1 < 1 && v2 < 1) return; any = true;
        t.appendChild(h('tr', null, h('td', null, h('span', { class: 'dot', style: { background: TR.color[k], marginRight: '6px' } }), TR.name[k]), h('td', null, U.fmtPeople(v1)), h('td', null, U.fmtPeople(v2)), h('td', null, v1 > 0 ? U.fmtPct(m1 / v1, 0) : '—')));
      });
      if (any) el.appendChild(this.sec('z-att', '片区吸引的出行（普通设施汇总）', '人次/日', function () { return h('div', null, t, h('div', { class: 'note', style: { marginTop: '6px' } }, '按片区的用地、人口与岗位汇总中小学、社区商业、诊所、街区公园等普通设施；重要设施单独计算，不重复计入。数值为模拟结果（汽车 + 地铁出行，不含步行）。')); }, true));
      const here = model.fn.list.filter(function (f, k) { return model.fn.hostZ[Z + k] === z; });
      if (here.length) el.appendChild(this.sec('z-fac', '片区内的重要设施', here.length + ' 处', function () {
        const bx = h('div');
        for (const f of here) bx.appendChild(h('div', { class: 'chg small clickable', onclick: function () { self.select({ kind: 'facility', id: f.id }); } }, h('span', null, ic(f.T.icon), ' ', f.name), h('span', { class: 'muted' }, f.T.name)));
        return bx;
      }, true));
    }
    const x = model.zCx[z], y = model.zCy[z];
    const rg = g.city.regionAt(x, y);
    if (rg) {
      const ri = g.city.regions.indexOf(rg), open = g.city.regionOpen[ri];
      // 开放门槛摆出来（A12）：玩家不用自己反推「还要多少人 / 还要几年」。
      let need = '';
      if (!open) {
        const pop = g.city.totals().pop;
        if (rg.open != null) need = ' · 参考 ' + rg.open + ' 年开放';
        if (rg.pop) need += ' · 人口达到 ' + U.fmtPeople(rg.pop) + ' 可提前开放' + (pop < rg.pop ? '（还差 ' + U.fmtPeople(rg.pop - pop) + ' 人）' : '（已达标，等待下次城市发展）');
      }
      el.appendChild(h('div', { class: 'note', style: { marginTop: '8px' } }, '所属区域：' + rg.name + (open ? '（已开放）' : '（尚未开放，' + U.regionLock(rg) + need + '）')));
    }
    el.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm ghost', onclick: function () { self.locateZone(z); } }, '定位')));
    return { title: g.zoneName(z), el: el };
  };

  // ======================== 页面：重要设施（v1.9） ========================
  // 规模、工作日与周末到访、出行目的、附近地铁站与接驳；区分史实资料、估算与模拟结果
  UI.prototype.page_facility = function (id) {
    const g = this.g(), model = g.model, self = this, Fac = CM.Fac, TR = CFG.trips;
    const f = Fac.byId(id); if (!f) return null;
    const el = h('div');
    const yr = g.year(), k = model.facIndex(id), active = k >= 0;
    const status = active ? '运营中' : (yr < f.open ? Math.floor(f.open) + ' 年启用' : (f.close != null && yr >= f.close ? '已停用（' + Math.floor(f.close) + ' 年）' : '暂未运营'));
    el.appendChild(h('div', { class: 'row', style: { flexWrap: 'wrap', marginBottom: '8px' } },
      h('span', { class: 'tag' }, ic(f.T.icon), ' ', f.T.name), h('span', { class: 'tag' }, Fac.purposeText(f)), h('span', { class: 'tag ' + (active ? 'good' : 'warn') }, status),
      Fac.sources(f).map(function (s) { return h('span', { class: 'tag ' + s[1] }, s[0]); })));
    el.appendChild(this.kv([
      ['参考规模（估算）', Fac.sizeText(f, yr)],
      ['启用', f.open > -1e8 ? (f.lmK >= 0 ? D.landmarks[f.lmK].year + ' 年（地标落成）' : Math.floor(f.open) + ' 年') : '开局前已有'],
      f.close != null ? ['停用', Math.floor(f.close) + ' 年 ' + Math.round((f.close % 1) * 12 + 1) + ' 月'] : null,
    ]));
    if (f.note) el.appendChild(h('div', { class: 'note', style: { margin: '4px 0 8px' } }, f.note));
    if (!active) {
      el.appendChild(this.callout('info', 'info', '设施' + status + '，目前不参与出行计算。'));
    } else {
      const hub = !!f.T.hub;
      // 到访量（模拟结果）：工作日 / 周末 / 周平均
      const grid = h('div', { class: 'stat-grid' });
      const sW = this.stat(hub ? '工作日接驳出行' : '工作日到访', '—'), sE = this.stat(hub ? '周末接驳出行' : '周末到访', '—'), sA = this.stat('周平均', '—'), sM = this.stat('乘地铁比例（周平均）', '—');
      grid.append(sW, sE, sA, sM);
      el.appendChild(grid);
      const vol = function (s) { return s ? (hub ? s.inn + s.out : s.inn) : 0; }, met = function (s) { return s ? (hub ? s.innM + s.outM : s.innM) : 0; };
      const upd = function () {
        const a = model.facStats(id, 'wd'), b = model.facStats(id, 'we'), c = model.facStats(id, 'avg');
        if (!a || !b || !c) return;
        sW.setV(U.fmtPeople(vol(a)) + ' 人次', '地铁 ' + U.fmtPct(vol(a) > 0 ? met(a) / vol(a) : 0, 0), 'muted');
        sE.setV(U.fmtPeople(vol(b)) + ' 人次', '地铁 ' + U.fmtPct(vol(b) > 0 ? met(b) / vol(b) : 0, 0), 'muted');
        sA.setV(U.fmtPeople(vol(c)) + ' 人次', '5 个工作日 + 2 个周末日', 'muted');
        const sh = vol(c) > 0 ? met(c) / vol(c) : 0;
        sM.setV(U.fmtPct(sh, 0), '汽车（含公交、出租） ' + U.fmtPct(1 - sh, 0), sh >= 0.3 ? 'good' : (sh < 0.1 ? 'bad' : 'muted'));
      };
      upd(); this.live.push(upd);
      // 出行目的
      el.appendChild(this.sec('f-purp', '出行目的（' + (hub ? '去往车站 / 机场' : '到达') + '，人次/日）', '工作日 · 周末', function () {
        const a = model.facStats(id, 'wd'), b = model.facStats(id, 'we'), t = h('table', { class: 'tbl' }, h('tr', null, h('th', null, '目的'), h('th', null, '工作日'), h('th', null, '周末')));
        if (a && b) for (const q of TR.keys) { if (a.purp[q] < 1 && b.purp[q] < 1) continue; t.appendChild(h('tr', null, h('td', null, h('span', { class: 'dot', style: { background: TR.color[q], marginRight: '6px' } }), TR.name[q]), h('td', null, U.fmtPeople(a.purp[q])), h('td', null, U.fmtPeople(b.purp[q])))); }
        return h('div', null, t, h('div', { class: 'note', style: { marginTop: '6px' } }, hub ? '接驳出行：旅客往返车站或机场的市内出行（汽车 + 地铁），到达与离开各计一次；铁路与航班本身不在模拟范围内，旅客量为外部给定的估算，不会因修地铁而凭空增加。' : '只含汽车与地铁出行（步行到访不计）。修通地铁后，商圈、景点等设施的到访可能适度增加（有上限），通勤、上学、就医不会因此增加。'));
      }, true));
      // 附近地铁站与接驳
      el.appendChild(this.sec('f-acc', '附近地铁站与接驳', '', function () {
        const bx = h('div'), acc = model.net ? model.net.acc : null, node = model.Z + k;
        const list = acc && acc.NZ === model.fn.NZ ? acc.zl[node] : null;
        if (acc && acc.NZ === model.fn.NZ) bx.appendChild(self.kv([['场地步行 15 分钟内可达车站', U.fmtPct(acc.zCov[node], 0) + ' 的场地'], ['平均步行时间', acc.zCov[node] > 0 ? U.fmtNum(acc.zWalk[node], 1) + ' 分钟' : '—']]));
        if (!list || !list.length) bx.appendChild(h('div', { class: 'callout warn' }, '步行 15 分钟内没有运营中的地铁站。在附近设站并接入线网后，' + (hub ? '旅客' : '到访者') + '才能乘地铁前往。'));
        else for (const e of list) {
          const s = model.net.C.stations[e.s]; if (!s) continue;
          const lines = Array.from(model.net.C.stationLines[e.s] || []).map(function (lid) { return g.net.lines[lid]; }).filter(Boolean);
          bx.appendChild(h('div', { class: 'chg small clickable', onclick: function () { self.select({ kind: 'station', id: s.id }); } }, h('span', null, lines.map(function (L) { return h('span', { class: 'dot', style: { background: L.color, marginRight: '4px' } }); }), s.name), h('span', { class: 'num' }, '步行约 ' + Math.max(1, Math.round(e.w)) + ' 分钟')));
        }
        return bx;
      }, true));
    }
    el.appendChild(this.sec('f-src', '数据说明', '', function () {
      return h('div', { class: 'note' }, D.fictional ? '虚构城市的设施：位置、年份与规模均为游戏设定。' : '位置与启用、停用年份为史实参考（位置为近似）；参考规模为估算，用于确定设施在全市同类出行中的吸引力；到访量、目的构成与乘地铁比例为模拟结果（汽车 + 地铁出行，不含步行），会随城市发展、道路拥堵与地铁网络变化。');
    }));
    el.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn sm ghost', onclick: function () { self.locatePoint(f.x, f.y, f.name, Math.max(0.8, f.r), 3); } }, '定位'),
      active ? h('button', { class: 'btn sm ghost', onclick: function () { self.openPage('zone', model.fn.hostZ[model.Z + k]); } }, '所在片区') : null));
    return { title: f.name, el: el };
  };

  // ======================== 页面：指标 ========================
  UI.prototype.page_metric = function (key) {
    const g = this.g(), d = g.model.daily || {}, self = this;
    const el = h('div');
    const hist = g.history;
    const defs = {
      pop: { title: '人口', val: function () { return U.fmtPeople(g.city.totals().pop); }, series: function (r) { return r.pop; }, def: '地图范围内的常住人口。', scope: '统计范围：全图（约 ' + U.fmtNum(CFG.W * CFG.CELL_M / 1000, 0) + ' km × ' + U.fmtNum(CFG.H * CFG.CELL_M / 1000, 0) + ' km）；更新：每月城市发展结算；' + (CM.DATA.fictional ? '虚构城市，人口按模拟规则发展。' : CFG.growth.histEnd + ' 年前为参考统计的估算，之后为模拟。'), factors: ['历史人口增长参考曲线', '区域开放（时间与人口共同决定）', '地铁覆盖率提高可吸引更多人口（最多约 +6%）', '城市经济景气：繁荣时人口增长加快、新区可提前开放，衰退时放缓（真实城市）', '各街区的可达性、地铁车站邻近度与规划用地'] },
      share: { title: '地铁分担率', val: function () { return U.fmtPct(d.metroShare || 0); }, series: function (r) { return r.share; }, pct: true, def: '采用地铁的完整出行次数 ÷（汽车 + 地铁完整出行总次数）。换乘不重复计为新出行。', scope: '时间窗口：周平均日（5 个工作日 + 2 个周末日加权，各时段汇总）；首版仅模拟汽车与地铁两种方式。v1.9 之前的月度记录为典型工作日口径。', factors: ['起终点步行接驳时间（沿道路计算）', '候车时间（由发车间隔决定）与换乘次数', '车厢拥挤与车站拥挤', '票价与居民时间价值', '汽车出行时间（道路拥堵）与停车费用'] },
      cong: { title: '道路拥堵指数', val: function () { return (d.cong || 1).toFixed(2) + '（全日） / ' + (d.congAM || 1).toFixed(2) + '（早高峰）'; }, series: function (r) { return r.cong; }, def: '道路实际行驶时间 ÷ 自由流行驶时间，按车公里加权汇总。1.0 表示畅通，1.5 以上明显拥堵。', scope: '统计范围：全图主要道路；顶栏显示当前游戏时刻（按当天是工作日或周末）的数值，此处全日为周平均日、早高峰为工作日。', factors: ['人口与出行需求增长', '汽车拥有水平（随年代上升）', '地铁对汽车出行的吸引（不按固定比例下降）', '道路与桥梁的系统建设'] },
      commute: { title: '平均通勤时间', val: function () { return U.fmtNum((g.model.dailyWk || d).commute || 0, 1) + ' 分钟'; }, series: function (r) { return r.commute; }, def: '家—工作出行的门到门平均时间。', scope: '包含步行接驳、候车、乘车、换乘、停车取车；统计口径：工作日（通勤以工作日为准）。', factors: ['道路拥堵', '地铁线路的直达性与换乘便利', '居住与就业分布（城市扩张会拉长通勤）'] },
      sat: { title: '居民满意度', val: function () { return Math.round(g.econ.sat) + ' / 100'; }, series: function (r) { return r.sat; }, def: '综合交通服务、票价与任务结果的满意度评分（0–100）。', scope: '每月更新，每月向目标值靠近 25%；影响政府拨款系数（经营挑战）。', factors: [] },
    };
    const def = defs[key];
    if (!def) return null;
    el.appendChild(h('div', { style: { fontSize: '22px', fontWeight: 700, margin: '4px 0 8px' } }, this.liveText(def.val)));
    if (key === 'share' && d.ready) {
      const dw = g.model.dailyWk || d, de = g.model.dailyWe || d;
      el.appendChild(this.kv([['日均出行（汽车+地铁，周平均）', U.fmtPeople(d.trips) + ' 人次'], ['其中地铁', U.fmtPeople(d.metro) + ' 人次'], ['工作日 / 周末分担率', U.fmtPct(dw.metroShare || 0) + ' / ' + U.fmtPct(de.metroShare || 0)], ['工作日 / 周末地铁客运量', U.fmtPeople(dw.metro || 0) + ' / ' + U.fmtPeople(de.metro || 0) + ' 人次'], ['步行 15 分钟可达地铁的人口', U.fmtPct(d.coverage)], ['平均票价', d.metro > 0 ? U.fmtNum(d.avgFare, 2) + ' ' + CFG.money.unit : '—']]));
    }
    if (key === 'cong') {
      const W = g.model.weights(g.clock.minute);
      el.appendChild(this.kv([['当前时刻', g.model.cityCongAt(W).toFixed(2)], ['汽车行驶里程（日）', U.fmtPeople(d.vkt) + ' 车公里']]));
    }
    if (key === 'sat' && g.econ.satFactors) {
      const sf = g.econ.satFactors;
      const t = h('div');
      t.appendChild(h('div', { class: 'chg small' }, h('span', null, '基准'), h('span', { class: 'num' }, '+' + sf.base)));
      for (const f of sf.factors) t.appendChild(h('div', { class: 'chg small' }, h('span', null, f.label), h('span', { class: 'num ' + (f.v >= 0 ? 'good' : 'bad') }, U.fmtSigned(f.v, 1))));
      t.appendChild(h('div', { class: 'chg small' }, h('b', null, '目标值'), h('b', { class: 'num' }, Math.round(sf.target))));
      el.appendChild(this.sec('m-satf', '构成因素（上月）', '', function () { return t; }, true));
    }
    el.appendChild(h('div', { class: 'note', style: { margin: '2px 0 6px' } }, def.def));
    el.appendChild(this.sec('m-about', '统计口径与影响因素', '', function () { const b = h('div', { class: 'note' }, def.scope); for (const f of def.factors) b.appendChild(h('div', { class: 'small', style: { padding: '2px 0', color: 'var(--text)' } }, '· ' + f)); return b; }, false, 'info'));
    if (hist.length > 1) {
      el.appendChild(this.sec('m-trend', '变化趋势', '近 ' + Math.min(120, hist.length) + ' 个月', function () {
        const arr = hist.slice(-120);
        return h('div', null, self.spark(arr.map(def.series), { color: '#1e6fd9', labels: [arr[0].y + '年' + arr[0].m + '月', '', arr[arr.length - 1].y + '年' + arr[arr.length - 1].m + '月'] }));
      }, true));
    }
    return { title: def.title, el: el };
  };
  UI.prototype.spark = function (vals, o) {
    o = o || {};
    const W = 300, H = 56;
    let mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (o.ref !== undefined) { mn = Math.min(mn, 0); mx = Math.max(mx, o.ref * 1.1); }
    if (mx - mn < 1e-9) { mx = mn + 1; }
    const pts = vals.map(function (v, i) { return (i / Math.max(1, vals.length - 1) * W).toFixed(1) + ',' + (H - 4 - (v - mn) / (mx - mn) * (H - 8)).toFixed(1); }).join(' ');
    let svg = '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    if (o.ref !== undefined) { const y = H - 4 - (o.ref - mn) / (mx - mn) * (H - 8); svg += '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#d63031" stroke-dasharray="4 3" stroke-width="1"/>'; }
    svg += '<polyline points="' + pts + '" fill="none" stroke="' + (o.color || '#1e6fd9') + '" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
    const box = h('div', { html: svg });
    if (o.labels) box.appendChild(h('div', { class: 'row between tiny muted' }, o.labels.map(function (l) { return h('span', null, l); })));
    return box;
  };

  // ======================== 页面：日期与城市 ========================
  UI.prototype.page_date = function () {
    const g = this.g(), self = this, city = g.city;
    const el = h('div');
    el.appendChild(h('div', { style: { fontSize: '18px', fontWeight: 700 } }, this.liveText(function () { return g.clock.y + '年' + g.clock.m + '月' + g.clock.d + '日 ' + U.fmtClock(g.clock.minute); })));
    el.appendChild(h('div', { class: 'row', style: { margin: '6px 0 10px' } }, h('span', { class: 'tag' }, g.stageName()), g.clock.y > CFG.growth.histEnd ? h('span', { class: 'tag sim' }, '模拟未来') : h('span', { class: 'tag hist' }, '参考历史'),
      this.liveText(function () { return UI.weekdayName(g.clock); }, 'tag'),
      this.liveText(function () { return CFG.periods[g.model.hourPeriod[Math.floor(g.clock.minute / 60) % 24]].name; }, 'tag info')));
    el.appendChild(this.sec('dt-time', '时间与时段', '', function () {
      return h('div', { class: 'note' }, '1× 速度下游戏中一天约 ' + Math.round(CFG.time.secPerHour * 24) + ' 秒。时段：早高峰 7–9 时、日间平峰、晚高峰 17–19 时、夜间；地铁运营 06:00–24:00。工作日与周末（周六、周日）分别模拟：画面上的车流、客流与拥堵按当天的类型显示，票款逐日按当天结算；满意度与日均客流按周平均（5 个工作日 + 2 个周末日）计算，节假日按普通日处理。暂停时可以建设、预测和调整票价。跳月 / 跳年会逐日结算票款与运营费用，并处理每月的拨款、城市发展、区域开放与任务；真实城市每年 1 月结算上一年的城市经济。');
    }));
    // 城市发展的关键节点见统计面板的「里程碑」（区域开放与逐条发展记录不在这里重复列出）
    const ms = CM.Milestones ? CM.Milestones.state(g).list.filter(function (r) { return r.id !== 'start'; }) : [];
    const last = ms[ms.length - 1];
    el.appendChild(h('button', { class: 'ms-link', onclick: function () { self.openStats('milestones'); } },
      h('span', { class: 'ms-medal sm' }, CM.icon('book', 18)),
      h('div', { class: 'grow' }, h('b', null, '城市纪事 · ' + ms.length + ' 个里程碑'), h('small', null, last ? '最近：' + last.title + '（' + last.y + '年' + last.m + '月）' : '首条地铁开通、人口与客流跨越关口等关键节点会记录在这里')),
      CM.icon('chev', 16)));
    if (g.macro && CM.Macro) {
      const mv = CM.Macro.view(g);
      el.appendChild(h('button', { class: 'ms-link alt', onclick: function () { self.openTop('econ'); } },
        h('span', { class: 'ms-medal sm alt' }, CM.icon('trend', 18)),
        h('div', { class: 'grow' }, h('b', null, '城市经济 · ' + mv.env.label), h('small', null, (mv.last ? mv.last.y + ' 年 GDP ' + UI.fmtBig(mv.last.nom) + (mv.last.growth != null ? '，实际增长 ' + UI.pctS(mv.last.growth) : '') : '本年 GDP 预测 ' + UI.fmtBig(mv.fc.nom)) + ' · ' + mv.trendLabel)),
        CM.icon('chev', 16)));
    }
    if (D.briefing) el.appendChild(h('button', { class: 'ms-link alt', onclick: function () { self.showBriefing(); } },
      h('span', { class: 'ms-medal sm alt' }, CM.icon('briefing', 18)),
      h('div', { class: 'grow' }, h('b', null, '开局简报'), h('small', null, CFG.START.y + ' 年这座城市的交通格局与你的起点')),
      CM.icon('chev', 16)));
    el.appendChild(this.sec('dt-data', '数据来源与真实性', '', function () { return self.dataNote(); }));
    return { title: '日期与城市发展', el: el };
  };
  // 数据来源与真实性：由各地图的场景数据提供（[标签, 样式, 说明]），没有时给出通用说明
  UI.prototype.dataNote = function () {
    let rows = (D.dataNote || [['模拟', 'sim', '城市与交通数据为游戏模拟结果。']]).slice();
    // 交通模型（v1.9）：设施、出行目的与工作日/周末的资料来源，插在末尾的免责说明之前
    const tm = D.fictional ? [['交通模型', 'info', '重要设施的位置、年份与规模为游戏设定；出行分为通勤、上学、购物、医疗、旅游休闲与枢纽接驳，工作日与周末分别模拟（比例与倍数为估算）。']] :
      [['设施（史实）', 'hist', '重要设施（铁路客运站、地图范围内的机场、大学、医院、商圈、商务区、景点、公园、体育场馆、会展中心）的位置与启用、停用年份，以及本地的双休日实行年份，为史实参考（位置为近似）。'],
        ['设施（估算）', 'est', '设施规模（车站与机场的接驳出行量、各设施占全市同类出行的比例）、出行目的构成、周末出行倍数、各时段分布与地铁带来的新增出行上限均为估算；普通设施（中小学、社区商业、诊所等）按片区用地汇总。'],
        ['设施（模拟）', 'sim', '各设施与片区的到访量、目的构成、乘地铁比例，以及工作日、周末与周平均的客流和票款为游戏模拟结果。普通铁路与航班本身不模拟。']];
    const tail = rows.length && !rows[rows.length - 1][0] ? rows.pop() : null;
    rows = rows.concat(tm); if (tail) rows.push(tail);
    return h('div', { class: 'note' }, rows.map(function (r, i) {
      return h('div', { style: { marginTop: i ? '6px' : '0' } }, r[0] ? h('span', { class: 'tag ' + (r[1] || '') }, r[0]) : null, (r[0] ? ' ' : '') + r[2]);
    }));
  };
  // ======================== 页面：财政与经济 ========================
  // 分页：概览（资金、本月收支、经济摘要、下月拨款、票价）· 经济（GDP、增长来源、交通影响、经济事件、历年数据）·
  // 财政（地方财政收入、拨款依据、收支明细、流水、失败条件）· 融资（利率报价、发债、债务与偿债预测）
  const pctS = function (x, d) { return x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : (x < 0 ? '−' : '±')) + Math.abs(x * 100).toFixed(d == null ? 1 : d) + '%'; };
  const ppS = function (x, d) { return x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : (x < 0 ? '−' : '±')) + Math.abs(x * 100).toFixed(d == null ? 2 : d) + ' 个百分点'; };
  UI.pctS = pctS;
  // 金额（含万亿）：内部单位为「万 + 本城货币」
  UI.fmtBig = function (wan) {
    if (!isFinite(wan)) return '—';
    const mo = CFG.money, a = Math.abs(wan);
    if (a >= 1e8) return (wan < 0 ? '−' : '') + (a / 1e8).toFixed(a >= 1e9 ? 1 : 2) + ' 万' + mo.yi;
    return U.fmtMoney(wan, a >= 1e6 ? 0 : 1);
  };
  UI.prototype.pageTabs = function (tabs, cur, onPick) {
    const bar = h('div', { class: 'ptabs', role: 'tablist' });
    for (const t of tabs) bar.appendChild(h('button', { class: t[0] === cur ? 'on' : '', role: 'tab', 'aria-selected': t[0] === cur ? 'true' : 'false', 'data-silent': '1', onclick: function () { if (t[0] !== cur) { snd2('soft'); onPick(t[0]); } } }, CM.icon(t[2], 15), h('span', null, t[1])));
    return bar;
  };
  const snd2 = function (n) { if (CM.Sound) CM.Sound.play(n); };
  UI.prototype.page_finance = function (id) {
    const g = this.g(), E = g.econ, self = this, free = E.isFree();
    const mv = CM.Macro && g.macro ? CM.Macro.view(g) : null;
    const tabs = [['ov', '概览', 'chart']];
    if (mv) tabs.push(['econ', '经济', 'trend']);
    tabs.push(['fisc', '财政', 'bank']);
    if (!free && E.canBorrow()) tabs.push(['debt', '融资', 'wallet']);
    let tab = id || this.finTab || 'ov';
    if (!tabs.some(function (t) { return t[0] === tab; })) tab = 'ov';
    this.finTab = tab;
    const el = h('div', { class: 'fin-page' });
    el.appendChild(this.pageTabs(tabs, tab, function (t) {
      self.finTab = t;
      const top = self.stack[self.stack.length - 1]; if (top && top.kind === 'finance') top.id = t;
      self.renderPage(false); self.rBody.scrollTop = 0;
    }));
    const body = h('div', { class: 'fin-body page-enter' });
    el.appendChild(body);
    if (tab === 'econ') this.finEcon(body, mv);
    else if (tab === 'fisc') this.finFiscal(body, mv);
    else if (tab === 'debt') this.finDebt(body);
    else this.finOverview(body, mv);
    if (g.macroError) body.appendChild(this.callout('warn', 'warn', g.macroError));
    return { title: '财政与经济', el: el };
  };
  const goFin = function (self, t) { self.finTab = t; self.openPage('finance', t, { replaceTop: self.topIs(['finance']), root: !self.topIs(['finance']) }); };

  // 线路经营（经营模式）：全网合计 + 分线路排名。数据来自 lineAccount，与线路详情页同源。
  // 要回答的是「哪条线在亏」「上盖补了多少」——这是玩家每天都会问的两个问题。
  UI.prototype.finLines = function (el) {
    const g = this.g(), self = this;
    if (!g.econ.caps.land) return;
    if (!g.model || !g.model.net || !g.model.net.C) return;
    const rows = [];
    for (const id in g.net.lines) { const a = self.lineAccount(id); if (a && a.board > 0) rows.push(a); }
    if (!rows.length) return;
    const sum = { yearFare: 0, yearOps: 0, propYear: 0, cash: 0 };
    for (const r of rows) { sum.yearFare += r.yearFare; sum.yearOps += r.yearOps; sum.propYear += r.propYear; sum.cash += r.cash; }
    const cover = sum.yearOps > 0 ? sum.propYear / sum.yearOps : 0;
    const bad = rows.filter(function (r) { return r.cash < 0; }).length;
    rows.sort(function (a, b) { return a.cash - b.cash; });
    el.appendChild(this.sec('fi-lines', '线路经营',
      '物业覆盖 ' + U.fmtPct(cover, 0) + ' · ' + (bad ? bad + ' 条需补贴' : '全部有盈余'), function () {
        const b = h('div');
        b.appendChild(self.kv([
          ['年票款', '+ ' + U.fmtMoney(sum.yearFare)],
          ['年运营成本', '− ' + U.fmtMoney(sum.yearOps)],
          ['沿线上盖年净', '+ ' + U.fmtMoney(sum.propYear)],
          ['年现金流', (sum.cash < 0 ? '− ' + U.fmtMoney(-sum.cash) : '+ ' + U.fmtMoney(sum.cash)), sum.cash < 0 ? 'bad' : 'good'],
          ['物业对运营的覆盖', U.fmtPct(cover, 0)],
          ['近 12 个月实际', (function () {
            // 用月度账本给已发生的覆盖率：瞬时的 lineAccount 是满租口径，账本口径才含爬坡与建设时点，
            // 两者并排，玩家能看出「现在」与「过去一年」的差别
            const led = (g.econ.ledger || []).slice(-12);
            let lp = 0, lo = 0;
            for (const r of led) { lp += r.property || 0; lo += r.ops || 0; }
            if (led.length < 3 || lo <= 0) return '账本不足 3 个月';
            return U.fmtMoney(lp) + ' / ' + U.fmtMoney(lo) + '（' + U.fmtPct(lp / lo, 0) + '）';
          })()],
        ]));
        b.appendChild(h('div', { class: 'note', style: { margin: '8px 0 4px' } }, '分线路（按年现金流排序，最亏的在前）'));
        const list = h('div', { class: 'kv' });
        for (const r of rows) {
          list.append(
            h('div', { class: 'k' }, h('span', { class: 'swatch', style: { background: r.color } }), ' ' + r.name + (r.sites ? '（' + r.sites + ' 处上盖）' : '')),
            h('div', { class: 'v' + (r.cash < 0 ? ' bad' : ' good') },
              U.fmtMoney(r.yearFare) + ' − ' + U.fmtMoney(r.yearOps) + (r.propYear > 0.01 ? ' + ' + U.fmtMoney(r.propYear) : '') + ' = ' + (r.cash < 0 ? '−' : '+') + U.fmtMoney(Math.abs(r.cash))));
        }
        b.appendChild(list);
        b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '票款按上车人次估算，运营按车厢公里，上盖按满租口径。物业覆盖 = 上盖年净 ÷ 年运营成本：1990 年前后地价低，这个比例会很低；随着城市地价上涨，同样面积的上盖会越来越养得起运营。'));
        return b;
      }, bad > 0, 'chart'));
  };

  // ---------- 概览 ----------
  UI.prototype.finOverview = function (el, mv) {
    const g = this.g(), E = g.econ, self = this, free = E.isFree(), EPS = CM.Economy.MONEY_EPS;
    // 资金：一般资金 / 专项 / 债务（自由建造为不限）
    if (free) el.appendChild(h('div', { class: 'fin-free' }, h('span', { class: 'badge b-teal' }, CM.icon('sparkle')), h('div', null, h('b', null, '自由建造 · 资金不限'), h('small', null, '建设不受资金限制，没有拨款、债务与经营失败；票款、运营成本与城市经济照常计算，供参考。'))));
    else {
      const grid = h('div', { class: 'fin-cards' });
      const sF = this.stat('流动资金', '—', '', '', 'coin'), sC = this.stat('建设专项', '—', '', '', 'hammer'), sD = this.stat('债务余额', '—', '', '', 'wallet');
      grid.append(sF, sC, sD);
      el.appendChild(grid);
      const upd = function () {
        sF.setV(U.fmtMoney(E.funds), E.funds < 0 ? '负余额' : '运营、利息与还本', E.funds < 0 ? 'bad' : 'muted');
        sC.setV(U.fmtMoney(E.capex), '只能用于建设');
        const live = E.bonds.filter(function (b) { return !b.done; }).length;
        sD.setV(U.fmtMoney(E.debtTotal()), E.overdue > EPS ? '含逾期 ' + U.fmtMoney(E.overdue) : (live ? live + ' 笔未到期' : '暂无债务'), E.overdue > EPS ? 'bad' : 'muted');
      };
      upd(); this.live.push(upd);
      for (const w of E.warnings()) el.appendChild(this.callout(w.level === 'danger' ? 'bad' : 'warn', 'warn', w.text));
      if (E.overdue > EPS) el.appendChild(this.callout('bad', 'warn', '存在逾期债务 ' + U.fmtMoney(E.overdue) + '（已 ' + E.overdueMonths + ' 个月）：每月收取逾期费用，' + (E.overdueMonths >= 6 ? '已暂停全部债券发行' : '城投债已暂停发行') + '。流动资金有余额时会自动偿还。'));
    }
    // 本月收支：一行一项，收入绿色、支出橙色
    const mbox = h('div', { class: 'fin-month' });
    const row = function (icon, label, v, cls) { return h('div', { class: 'fm-row ' + cls }, CM.icon(icon, 15), h('span', { class: 'grow' }, label), h('b', { class: 'num' }, v)); };
    const drawMonth = function () {
      const c = E.cur;
      const inSum = (c.fare || 0) + (c.property || 0) + (c.capture || 0) + (c.reward || 0) + Math.max(0, (c.grant || 0) - (c.grantCapex || 0));
      let bld = 0; for (const k of CM.Economy.BUILD_KINDS) bld += c[k] || 0;
      const outSum = (c.ops || 0) + (c.propMaint || 0) + (c.busOps || 0) + (c.facMaint || 0) + bld + (c.interest || 0) + (c.principal || 0) + (c.penalty || 0);
      const net = inSum - outSum;
      const sub = Math.max(0, (c.grant || 0) - (c.grantCapex || 0));
      // 原生 replaceChildren 会把 null 写成文字，只传实际存在的节点
      mbox.replaceChildren.apply(mbox, [
        h('div', { class: 'fm-h' }, h('b', null, '本月收支'), h('span', { class: 'tiny muted' }, g.clock.y + '年' + g.clock.m + '月 · 已结算 ' + c.days + ' 天')),
        free || sub <= 0.01 ? null : row('bank', (c.grantCapex || 0) > 0.5 ? '运营补贴' : '政府拨款', '+' + U.fmtMoney(sub), 'in'),
        (c.grantCapex || 0) > 0.5 ? row('hammer', '建设批次（转入专项资金，不计入收支）', '+' + U.fmtMoney(c.grantCapex), 'mute') : null,
        row('ticket', '票款', '+' + U.fmtMoney(c.fare), 'in'),
        (c.property || 0) > 0.01 ? row('home', '上盖物业租金', '+' + U.fmtMoney(c.property), 'in') : null,
        (c.capture || 0) > 0.01 ? row('coin', 'TOD 增值分成', '+' + U.fmtMoney(c.capture), 'in') : null,
        free || !c.reward ? null : row('gift', '任务奖励', '+' + U.fmtMoney(c.reward), 'in'),
        row('train', '运营成本', '−' + U.fmtMoney(c.ops), 'out'),
        (c.propMaint || 0) > 0.01 ? row('home', '物业维护', '−' + U.fmtMoney(c.propMaint), 'out') : null,
        (c.busOps || 0) > 0.01 ? row('bus', '接驳巴士运营', '−' + U.fmtMoney(c.busOps), 'out') : null,
        (c.facMaint || 0) > 0.01 ? row('metro', '车站配套维护', '−' + U.fmtMoney(c.facMaint), 'out') : null,
        bld > 0.5 ? row('hammer', '建设支出', '−' + U.fmtMoney(bld), 'out') : null,
        free || !((c.interest || 0) + (c.principal || 0) + (c.penalty || 0)) ? null : row('wallet', '偿债', '−' + U.fmtMoney((c.interest || 0) + (c.principal || 0) + (c.penalty || 0)), 'debt'),
        h('div', { class: 'fm-sum' },
          h('span', null, '收入 ' + U.fmtMoney(inSum)),
          h('span', null, '支出 ' + U.fmtMoney(outSum)),
          h('b', { class: net >= 0 ? 'good' : 'bad' }, '净额 ' + (net >= 0 ? '+' : '−') + U.fmtMoney(Math.abs(net)))),
        h('button', { class: 'linkbtn', onclick: function () { goFin(self, 'fisc'); } }, '收支明细与资金流水', CM.icon('chev', 14))].filter(Boolean));
    };
    drawMonth(); mbox._d = E.cur.days; this.live.push(function () { if (E.cur.days !== mbox._d) { mbox._d = E.cur.days; drawMonth(); } });
    el.appendChild(mbox);
    // 城市经济摘要
    if (mv) el.appendChild(this.econCard(mv, function () { goFin(self, 'econ'); }));
    // 下月拨款（经营挑战）
    if (!free) {
      const ny = g.clock.m === 12 ? g.clock.y + 1 : g.clock.y, nm = g.clock.m % 12 + 1;
      if (E.batchOn && E.batchOn()) {
        // 批次模式没有「下月固定拨款」，这里显示的是「下一批建设资金」与「本月运营补贴」
        const B = E.batchCfg(), yrs = B.years || 4, y0 = CFG.START.y;
        const cyc = ((g.clock.y - y0) % yrs + yrs) % yrs;
        const nb = g.clock.y - cyc + yrs;
        const amt = E.annualQuota(nb) * yrs * (B.buildFactor || 1) * (0.6 + 0.8 * E.sat / 100);
        const subM = Math.max(0, (E.cur.grant || 0) - (E.cur.grantCapex || 0));
        el.appendChild(h('div', { class: 'fin-grant clickable', onclick: function () { goFin(self, 'fisc'); } },
          h('div', { class: 'fg-h' }, CM.icon('bank', 16), h('b', null, '下一批建设资金'), h('span', { class: 'grow' }), h('b', { class: 'num' }, nb + ' 年 · ' + U.fmtMoney(amt)), CM.icon('chev', 14)),
          h('div', { class: 'tiny muted', style: { marginTop: '2px' } }, '运营补贴（' + E.subsidyName() + ' · 承担运营成本的 ' + U.fmtPct(E.subsidyRate(), 0) + '）：本月 ' + U.fmtMoney(subM) + '，按客流逐日结算')));
      } else {
        el.appendChild(h('div', { class: 'fin-grant clickable', onclick: function () { goFin(self, 'fisc'); } },
          h('div', { class: 'fg-h' }, CM.icon('bank', 16), h('b', null, '下月拨款预计'), h('span', { class: 'grow' }), h('b', { class: 'num' }, U.fmtMoney(E.grantFor(ny, nm))), CM.icon('chev', 14)),
          this.grantChain(ny, nm, true)));
      }
    }
    this.finLines(el);
    el.appendChild(this.sec('fi-fare', '票价', UI.fmtFare(E.fare.flat), function () { return self.fareEditor(); }, true, 'ticket'));
  };
  // 经济摘要卡：最近一年的 GDP 与增速、经济环境、交通对经济的影响
  UI.prototype.econCard = function (mv, onOpen) {
    const L = mv.last, fc = mv.fc;
    const val = L ? UI.fmtBig(L.nom) : UI.fmtBig(fc.nom);
    const sub = L ? L.y + ' 年地图范围 GDP' + (L.part ? '（接入当年，' + L.n + ' 个月）' : '') : fc.y + ' 年地图范围 GDP（预测）';
    const gr = L && L.growth != null ? L.growth : fc.growth;
    return h('div', { class: 'econ-card' + (onOpen ? ' clickable' : ''), onclick: onOpen || null },
      h('div', { class: 'ec-top' }, h('span', { class: 'badge b-violet' }, CM.icon('trend')), h('div', { class: 'grow' }, h('small', null, sub), h('b', { class: 'num' }, val)),
        h('span', { class: 'env-chip ' + mv.env.cls }, CM.icon('pulse', 13), mv.env.label), onOpen ? CM.icon('chev', 14) : null),
      h('div', { class: 'ec-row' },
        h('div', null, h('small', null, L && L.growth != null ? '实际增长' : fc.y + ' 年预测增长'), h('b', { class: gr == null ? 'muted' : (gr >= 0 ? 'good' : 'bad') }, pctS(gr))),
        h('div', null, h('small', null, '价格涨幅'), h('b', null, pctS(L ? L.infl : fc.infl))),
        h('div', null, h('small', null, '交通对经济'), h('b', { class: mv.te.eff >= 1 ? 'good' : 'bad' }, pctS(mv.te.eff - 1)))),
      mv.shocks.length ? h('div', { class: 'ec-shock' }, CM.icon('bolt', 13), h('span', null, mv.shocks.slice(0, 2).map(function (s) { return s.ev.title.replace(/^模拟：/, ''); }).join('、') + (mv.shocks.length > 2 ? ' 等 ' + mv.shocks.length + ' 项' : '') + ' 正在影响经济')) : null);
  };
  // 拨款依据：基础额度 × 财力系数 × 满意度系数 × 任务修正 = 拨款
  UI.prototype.grantChain = function (y, m, compact) {
    const E = this.g().econ;
    const box = h('div', { class: 'gchain' + (compact ? ' compact' : '') });
    const step = function (label, v, cls) { box.appendChild(h('div', { class: 'gc-step ' + (cls || '') }, h('small', null, label), h('b', { class: 'num' }, v))); };
    step('基础额度', U.fmtMoney(E.grantQuota(y, m)));
    for (const f of E.grantFactors(y, m)) step(f.kind === 'fisc' ? '财力' : (f.kind === 'sub' ? '补贴率' : (f.kind === 'sat' ? '满意度' : '任务')), (f.kind === 'sub' ? U.fmtPct(f.f, 0) : '×' + f.f.toFixed(2)), f.f >= 1.005 ? 'up' : (f.f <= 0.995 ? 'down' : ''));
    return box;
  };

  // ---------- 经济 ----------
  UI.prototype.finEcon = function (el, mv) {
    const g = this.g(), self = this, c = mv.cfg, st = mv.st, L = mv.last, fc = mv.fc, base = CFG.econBase || CFG.START.y;
    el.appendChild(this.econCard(mv, null));
    if (g.macroNote) el.appendChild(this.callout('info', 'info', g.macroNote));
    // 经济环境与外部形势
    el.appendChild(h('div', { class: 'econ-env' },
      h('div', null, h('small', null, '经济环境'), h('b', { class: mv.env.cls }, mv.env.label), h('span', { class: 'tiny muted' }, '本年较上年 ' + pctS(mv.mom))),
      h('div', null, h('small', null, '增长阶段'), h('b', null, mv.trendLabel), h('span', { class: 'tiny muted' }, '生产率趋势 ' + pctS(mv.trend))),
      h('div', null, h('small', null, mv.sim ? '模拟周期' : '资料范围'), h('b', null, mv.sim ? '已进入' : '至 ' + mv.histEnd + ' 年'), h('span', { class: 'tiny muted' }, mv.sim ? '按存档生成，非史实' : '之后为模拟周期'))));
    // 本年预测
    el.appendChild(h('div', { class: 'econ-fc' }, h('span', { class: 'tag fc' }, '预测'),
      h('span', { class: 'grow small' }, fc.y + ' 年 GDP 约 ' + UI.fmtBig(fc.nom) + (fc.growth != null ? '，实际增长约 ' + pctS(fc.growth) : '') + '（已过 ' + fc.months + ' 个月；不含尚未发生的事件）')));
    // 增长来源
    if (L && L.c) {
      el.appendChild(this.sec('ec-src', '增长来源（' + L.y + ' 年）', '实际 ' + pctS(L.growth), function () {
        const list = [['people', '就业岗位', L.c.jobs, '地图内就业变化（已扣除周期波动）'], ['factory', '生产率趋势', L.c.prod, '本城所处发展阶段的趋势增长'], ['metro', '交通效率', L.c.te, '通勤、拥堵与地铁可达性的变化'], ['pulse', '经济周期', L.c.cyc, '景气波动'], ['bolt', '经济事件', L.c.shock, '历史或模拟事件的冲击与恢复']];
        let mx = 0.005; for (const x of list) mx = Math.max(mx, Math.abs(x[2]));
        const box = h('div', { class: 'dbars' });
        for (const x of list) {
          const w = Math.min(50, Math.abs(x[2]) / mx * 50);
          box.appendChild(h('div', { class: 'dbar', 'data-tip': x[3] }, h('span', { class: 'dl' }, CM.icon(x[0], 14), x[1]),
            h('span', { class: 'dt' }, h('i', { class: x[2] >= 0 ? 'pos' : 'neg', style: { width: w + '%', left: x[2] >= 0 ? '50%' : (50 - w) + '%' } })),
            h('b', { class: 'num ' + (x[2] >= 0 ? 'good' : 'bad') }, pctS(x[2]))));
        }
        box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '各项相乘得到实际增长（价格变化不计入实际增长）。名义 GDP 增长 ' + pctS(L.nomGrowth) + '，其中价格涨幅 ' + pctS(L.infl) + '。'));
        return box;
      }, true, 'chart'));
    }
    // 交通与经济
    el.appendChild(this.sec('ec-te', '交通对经济的影响', pctS(mv.te.eff - 1), function () {
      const p = mv.te.parts, s = mv.te.sample, b = mv.te.base;
      const box = h('div');
      box.appendChild(self.kv([
        ['可达性（覆盖与地铁分担）', pctS(p.acc, 2), p.acc >= 0 ? 'good' : 'bad'],
        ['平均通勤时间' + (s && b.comm ? '（' + U.fmtNum(b.comm, 1) + ' → ' + U.fmtNum(s.comm, 1) + ' 分钟）' : ''), pctS(p.comm, 2), p.comm >= 0 ? 'good' : 'bad'],
        ['道路拥堵' + (s ? '（' + b.cong.toFixed(2) + ' → ' + s.cong.toFixed(2) + '）' : ''), pctS(p.cong, 2), p.cong >= 0 ? 'good' : 'bad'],
        ['当前交通效率', pctS(mv.te.now - 1, 2), mv.te.now >= 1 ? 'good' : 'bad'],
        ['已计入 GDP 的效率', pctS(mv.te.eff - 1, 2), mv.te.eff >= 1 ? 'good' : 'bad'],
      ]));
      box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '与' + (st.origin === 'legacy' ? '接入时（' + st.since[0] + '年' + st.since[1] + '月）' : '开局时') + '相比。通勤与拥堵变差会全部拖累经济；它们的改善按地铁分担率的提高计入（道路自然扩容带来的改善不算地铁的贡献）。交通效率按全年平均逐步计入生产率（约 −6% 至 +8%），不能保证建了地铁就一定增长，也不能抵消外部危机；较好的交通能让负面冲击小一些（最多约 −20%）。车站覆盖带来的人口吸引在城市发展中单独计算，不重复计入。'));
      return box;
    }, false, 'metro'));
    // 经济事件
    el.appendChild(this.sec('ec-ev', '经济事件', mv.shocks.length ? mv.shocks.length + ' 项影响中' : '暂无', function () {
      const box = h('div');
      if (!mv.shocks.length) box.appendChild(h('div', { class: 'note' }, '目前没有正在影响本城经济的事件。' + (mv.sim ? '模拟阶段偶尔会出现模拟的景气或衰退事件。' : '历史经济事件按真实年月发生。')));
      for (const x of mv.shocks) {
        const ev = x.ev, f = x.f, neg = Math.min.apply(null, ev.lv) < 0;
        box.appendChild(h('div', { class: 'ev-card ' + (neg ? 'neg' : 'pos') },
          h('div', { class: 'row' }, h('span', { class: 'tag ' + (ev.tag === '模拟' ? 'sim' : 'hist') }, ev.tag === '模拟' ? '模拟' : '史实'), h('span', { class: 'tag' }, ev.scope || CM.Macro.kindName(ev.kind)), h('b', { class: 'grow' }, ev.title.replace(/^模拟：/, '')), h('span', { class: 'tiny muted' }, ev.y + '.' + ev.m)),
          h('div', { class: 'small', style: { margin: '4px 0' } }, ev.desc),
          h('div', { class: 'ev-fx' }, h('span', null, '今年 ', h('b', { class: x.now >= 0 ? 'good' : 'bad' }, pctS(x.now))), h('span', null, '明年 ', h('b', { class: x.next >= 0 ? 'good' : 'bad' }, pctS(x.next))),
            h('span', { class: 'tiny muted' }, f.pre ? '接入前已发生' : '强度 ×' + f.k.toFixed(2) + '（结构 ×' + f.sm.toFixed(2) + (f.scale !== 1 ? ' · 本地 ×' + f.scale.toFixed(2) : '') + (f.resil ? ' · 交通韧性 −' + Math.round(f.resil * 20) + '%' : '') + (f.stress ? ' · 财政压力 +' + Math.round(f.stress * 25) + '%' : '') + '）'))));
      }
      box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '事件的影响按本城的产业结构（外贸、金融、工业、旅游消费、房地产）计算；负面事件发生时，较好的交通与稳健的财政能减轻冲击。强度在发生时确定，之后不再改变，同一事件只生效一次。'));
      return box;
    }, mv.shocks.length > 0, 'bolt'));
    // 城市发展的反应
    if (mv.factors) {
      const F = mv.factors;
      el.appendChild(this.sec('ec-city', '对城市发展的影响', F.dev >= 0.005 ? '促进' : (F.dev <= -0.005 ? '放缓' : '中性'), function () {
        return h('div', null, self.kv([['人口增速', '×' + F.popGrowth.toFixed(2), F.popGrowth >= 1 ? 'good' : 'bad'], ['就业岗位水平', '×' + F.jobs.toFixed(3), F.jobs >= 1 ? 'good' : 'bad'], ['商业办公发展', '×' + F.com.toFixed(2), F.com >= 1 ? 'good' : 'bad']]),
          h('div', { class: 'note', style: { marginTop: '6px' } }, '每月城市发展时生效：繁荣时人口增长加快、就业与商业扩张，新区可提前一年开放；衰退时增长放缓。长期人口仍回到本城的历史与模拟人口曲线。'));
      }, false, 'building'));
    }
    // 历年数据
    el.appendChild(this.sec('ec-table', '历年数据', st.rec.length + ' 年', function () {
      const ref = c.ref;
      const t = h('table', { class: 'tbl econ-tbl' }, h('tr', null, h('th', null, '年份'), h('th', null, 'GDP'), h('th', null, '实际增长'), h('th', null, '价格'), ref ? h('th', null, '参考') : null));
      const refCell = function (Y) { const r = CM.Macro.refAt(c, Y); if (!r) return h('td', { class: 'muted' }, '—'); return h('td', { class: 'ref', 'data-tip': ref.label + (r.kind === 'period' ? '（' + r.from + '–' + r.to + ' 年平均）' : '') }, (r.kind === 'year' ? '' : '≈') + (r.v * 100).toFixed(1) + '%'); };
      t.appendChild(h('tr', { class: 'fc' }, h('td', null, fc.y, h('span', { class: 'tag fc' }, '预测')), h('td', null, UI.fmtBig(fc.nom)), h('td', null, pctS(fc.growth)), h('td', null, pctS(fc.infl)), ref ? refCell(fc.y) : null));
      for (const r of st.rec.slice().reverse()) {
        t.appendChild(h('tr', null, h('td', null, r.y, r.part ? h('span', { class: 'tag' }, r.n + ' 月') : null, r.sim ? h('span', { class: 'tag sim' }, '模拟') : null), h('td', null, UI.fmtBig(r.nom)), h('td', { class: r.growth == null ? 'muted' : (r.growth >= 0 ? '' : 'bad') }, pctS(r.growth)), h('td', null, pctS(r.infl)), ref ? refCell(r.y) : null));
      }
      const box = h('div', null, h('div', { class: 'tbl-wrap' }, t));
      if (!st.rec.length) box.appendChild(h('div', { class: 'note' }, '第一个完整年度在明年 1 月结算后显示。'));
      box.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm', onclick: function () { self.openStats('econ'); } }, CM.icon('chart', 15), '查看经济图表')));
      return box;
    }, true, 'calYear'));
    // 数据说明
    el.appendChild(this.sec('ec-note', '数据口径与来源', '', function () {
      const rows = [
        ['游戏结果', '', '每年 1 月按本局实际的岗位、交通、经济周期与事件结算的地图范围 GDP（名义值按当年价格，实际增长按 ' + base + ' 年价格计算，价格变化不计入实际增长）。'],
        ['预测', 'fc', '当年尚未结束时的估算，只包含已经发生的事件。'],
        ['模型估算', 'est', '开局 GDP、生产率趋势、价格涨幅与财政比重为参考公开统计的估算参数。' + (c.area ? '统计范围：' + c.area + '。' : '') + (c.note || '')],
        ['史实参考', 'hist', ref() ],
        ['模拟', 'sim', mv.histEnd + ' 年之后的经济周期与模拟事件由存档种子生成，不代表真实历史或预测。'],
      ];
      function ref() { return c.ref ? c.ref.label + '：' + c.ref.src + '。为全国或地区口径，不是地图范围数据，只作背景对照。' : '本地图没有可用的史实参考数据。'; }
      const box = h('div', { class: 'note' });
      rows.forEach(function (r, i) { box.appendChild(h('div', { style: { marginTop: i ? '6px' : '0' } }, h('span', { class: 'tag ' + r[1] }, r[0]), ' ' + r[2])); });
      if (st.origin === 'legacy') box.appendChild(h('div', { style: { marginTop: '6px' } }, '本进度自 ' + st.since[0] + '年' + st.since[1] + '月 起接入城市经济，此前的经济数据没有记录，也不补造。'));
      return box;
    }, false, 'info'));
  };

  // ---------- 财政 ----------
  UI.prototype.finFiscal = function (el, mv) {
    const g = this.g(), E = g.econ, self = this, free = E.isFree();
    const L = mv && mv.last;
    if (mv) {
      const F = mv.fisc || {};
      const rr = L ? L.rev / Math.max(1, L.nom) : null;
      const card = h('div', { class: 'fisc-card' },
        h('div', { class: 'ec-top' }, h('span', { class: 'badge b-gold' }, CM.icon('bank')), h('div', { class: 'grow' }, h('small', null, L ? L.y + ' 年地方财政收入（地图范围）' : '地方财政收入'), h('b', { class: 'num' }, L ? UI.fmtBig(L.rev) : '待结算')),
          L ? h('span', { class: 'env-chip ' + (L.fRaw >= 1 ? 'good' : 'warn') }, '为预期的 ' + Math.round(L.fRaw * 100) + '%') : null),
        h('div', { class: 'ec-row' },
          h('div', null, h('small', null, '占 GDP'), h('b', null, rr ? (rr * 100).toFixed(1) + '%' : '—')),
          h('div', null, h('small', null, (F.y || g.clock.y) + ' 年财力系数'), h('b', { class: (F.f || 1) >= 1 ? 'good' : 'warn' }, '×' + (F.f || 1).toFixed(2))),
          h('div', null, h('small', null, '地铁资金占比'), h('b', null, !free && L ? ((E.batchOn && E.batchOn() ? E.annualQuota(g.clock.y) : E.grantQuota(g.clock.y, g.clock.m) * (F.f || 1) * 12) / Math.max(1, L.rev) * 100).toFixed(1) + '%' : '—'))));
      el.appendChild(card);
      el.appendChild(h('div', { class: 'note', style: { margin: '4px 2px 8px' } }, 'GDP 不等于财政收入：地方财政收入约为地图范围 GDP 的一定比例，随经济周期的波动更大；其中只有一部分安排给地铁。每年 1 月按上一年的实际财政收入与预期之比确定当年的财力系数（平滑后限定在 ×0.70–1.30），全年不变。' + (L ? '' : '第一个完整年度结算后开始生效。')));
    }
    if (!free) {
      const ny = g.clock.m === 12 ? g.clock.y + 1 : g.clock.y, nm = g.clock.m % 12 + 1;
      // 建设批次（经营模式）：建设资金每 4 年一个盘子，运营靠「运营成本 × 补贴率」逐日结算。
      // 两笔钱各管各的：批次只看城市财政，补贴只看你有没有把客流做起来。
      if (E.batchOn && E.batchOn()) {
        const B = E.batchCfg(), yrs = B.years || 4, y0 = CFG.START.y;
        const cyc = ((g.clock.y - y0) % yrs + yrs) % yrs;
        const curBatch = g.clock.y - cyc, nextBatch = curBatch + yrs;
        const curAmt = E.isBatchYear(g.clock.y) ? E.batchFor(g.clock.y) : 0;
        const nextAmt = E.annualQuota(nextBatch) * yrs * (B.buildFactor || 1) * (0.6 + 0.8 * E.sat / 100);
        const rev = (L && L.rev) || 0;
        const c0 = E.cur, opsM = c0.ops || 0, fareM = c0.fare || 0, subM = c0.subsidy || 0;
        const cover = opsM > 0.5 ? (fareM + subM) / opsM : 0;
        const riders = (g.model.daily && g.model.daily.metro) || 0;
        const perCost = riders > 0 ? opsM * 1e4 / (30 * riders) : 0;
        const tuning = (g.ym() - U.ymIndex(CFG.START.y, CFG.START.m)) < (B.subsidySwitchMonths || 12);
        el.appendChild(this.sec('fi-batch', '建设批次与补贴', E.isBatchYear(g.clock.y) ? '本年发放 ' + U.fmtMoney(curAmt) : '下一批 ' + nextBatch + ' 年 · ' + U.fmtMoney(nextAmt), function () {
          const b = h('div');
          b.appendChild(self.kv([
            ['批次周期', '每 ' + yrs + ' 年一批（本批 ' + curBatch + '–' + (curBatch + yrs - 1) + ' 年）'],
            ['本批建设资金', curAmt > 0 ? U.fmtMoney(curAmt) : (nextBatch + ' 年 1 月发放'),
              curAmt > 0 ? 'good' : ''],
            ['建设专项余额', U.fmtMoney(E.capex) + '（只能建设与拆迁，可跨批滚存）'],
            ['补贴力度', E.subsidyName() + ' · 承担运营成本的 ' + U.fmtPct(E.subsidyRate(), 0)],
            ['本月运营', '成本 ' + U.fmtMoney(opsM) + ' · 票款 ' + U.fmtMoney(fareM) + ' · 补贴 ' + U.fmtMoney(subM)],
            ['客均成本 / 客均票款', CFG.money.sym + perCost.toFixed(1) + ' / ' + CFG.money.sym + g.econ.fare.flat.toFixed(1),
              cover >= 1 ? 'good' : (cover >= 0.8 ? 'warn' : 'bad')],
            ['本月覆盖', U.fmtPct(cover, 0), cover >= 1 ? 'good' : (cover >= 0.8 ? 'warn' : 'bad')],
            ['下一批预计', nextBatch + ' 年 1 月 · ' + U.fmtMoney(nextAmt)],
            ['盘子占财政收入', rev > 0 ? U.fmtPct(E.annualQuota(g.clock.y) / rev, 1) : '—'],
          ]));
          // 难度只在开局可选：补贴率是选择，不是随时能调的后门
          if (tuning) {
            const row = h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } });
            for (const k of ['easy', 'standard', 'realistic']) {
              row.appendChild(h('button', { class: 'btn sm' + (E.subsidyLevel === k ? ' primary' : ''), onclick: function () { self.setSubsidy(k); } },
                (B.subsidyName[k] || k) + ' ' + U.fmtPct(B.subsidyRate[k], 0)));
            }
            b.appendChild(row);
          }
          b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '建设资金一次给一个盘子，直接进建设专项资金：只能用于建设与拆迁，不能补运营、不能付息，跨批滚存。运营补贴按「当日运营成本 × 补贴率 × 满意度系数」逐日结算——客均成本高的年代补得多，城市成熟后自然回落，所以难度曲线是城市自己长出来的。' + (tuning ? '补贴力度只能在开局 ' + (B.subsidySwitchMonths || 12) + ' 个月内调整。' : '')));
          return b;
        }, true, 'bank'));
      }
      // 批次模式没有「月度固定拨款」，拨款阶梯那一块不适用
      if (!(E.batchOn && E.batchOn())) el.appendChild(this.sec('fi-grant', '地铁拨款依据', '下月 ' + U.fmtMoney(E.grantFor(ny, nm)), function () {
        const b = h('div');
        b.appendChild(self.grantChain(ny, nm, false));
        b.appendChild(h('div', { class: 'chg small', style: { marginTop: '6px' } }, h('b', null, '下月（' + ny + '年' + nm + '月）拨款'), h('b', { class: 'num' }, U.fmtMoney(E.grantFor(ny, nm)))));
        for (const f of E.grantFactors(ny, nm)) if (f.kind === 'task') b.appendChild(h('div', { class: 'tiny muted' }, '· ' + f.label + ' ×' + f.f.toFixed(2)));
        b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '基础额度按城市与年代设定；财力系数来自城市经济（上一年地方财政收入）；满意度系数 ×0.6–1.4；任务未完成时在 ' + CFG.economy.failGrantMonths + ' 个月内 ×' + CFG.economy.failGrantFactor + '（多项叠加最低按 ×0.6）。拨款每月初发放一次，不会重复发放或补发。'));
        return b;
      }, true, 'bank'));
    }
    el.appendChild(this.sec('fi-month', '收支明细', g.clock.y + '年' + g.clock.m + '月', function () { return self.ledgerBlock(); }, free, 'coin'));
    if (!free) el.appendChild(this.sec('fi-flow', '资金流水', '最近 ' + Math.min(40, E.flow.length) + ' 笔', function () { return self.flowBlock(); }, false, 'tasks'));
    if (!free) {
      el.appendChild(this.sec('fi-rule', '经营失败条件', E.negMonths || E.lowSatMonths ? '有预警' : '正常', function () {
        const b = h('div');
        const lim = CFG.economy.debtLimit * E.costIndex(g.clock.y);
        b.appendChild(self.kv([['连续负余额', E.negMonths + ' / ' + CFG.economy.negMonthsLimit + ' 个月', E.negMonths ? 'warn' : ''], ['负债下限', U.fmtMoney(lim)], ['满意度低于 ' + CFG.economy.satFail, E.lowSatMonths + ' / ' + CFG.economy.satFailMonths + ' 个月', E.lowSatMonths ? 'warn' : '']]));
        b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '允许短期亏损；长期负余额、低于负债下限或满意度长期过低会导致挑战失败。经济衰退会减少下一年的拨款，但不会直接导致失败。'));
        return b;
      }, false, 'info'));
    }
  };

  // ---------- 融资 ----------
  UI.prototype.finDebt = function (el) {
    const g = this.g(), E = g.econ, self = this, y = g.clock.y, D0 = CM.Economy.BOND_DEF;
    // 利率报价
    const q = h('div', { class: 'quote-card' });
    q.appendChild(h('div', { class: 'fg-h' }, CM.icon('percent', 16), h('b', null, '新发行利率报价'), h('span', { class: 'grow' }), h('span', { class: 'tiny muted' }, y + '年' + g.clock.m + '月')));
    const grid = h('div', { class: 'quote-grid' });
    grid.appendChild(h('div', { class: 'qh' }));
    grid.append(h('div', { class: 'qh' }, '3 年期'), h('div', { class: 'qh' }, '6 年期'));
    for (const k of ['local', 'ct']) {
      const block = E.bondBlock(k);
      grid.append(h('div', { class: 'qk' }, D0[k].name), h('div', { class: 'qv' + (block ? ' off' : '') }, (E.bondRate(k, y, 3) * 100).toFixed(2) + '%'), h('div', { class: 'qv' + (block ? ' off' : '') }, (E.bondRate(k, y, 6) * 100).toFixed(2) + '%'));
    }
    q.appendChild(grid);
    const parts = E.bondQuote('local', y, 3).parts;
    const pl = h('div', { class: 'qparts' });
    for (const p of parts) pl.appendChild(h('div', { class: 'chg small' }, h('span', null, p.label), h('span', { class: 'num ' + (p.k === 'base' ? '' : (p.v > 0.00005 ? 'bad' : (p.v < -0.00005 ? 'good' : 'muted'))) }, p.k === 'base' ? (p.v * 100).toFixed(2) + '%' : ppS(p.v))));
    q.appendChild(this.sec('fi-qparts', '地方债 3 年期的报价构成', '', function () {
      const b = h('div', null, pl);
      const sub = (parts.find(function (p) { return p.k === 'fis'; }) || {}).sub;
      if (sub) b.appendChild(h('div', { class: 'tiny muted', style: { marginTop: '4px' } }, '负债率（未偿本金 ÷ 全年地铁基础额度）' + sub.load.toFixed(2) + ' · 负债 ' + ppS(sub.debt) + ' · 财力 ' + ppS(sub.fiscF) + (sub.overdue ? ' · 逾期 ' + ppS(sub.overdue) : '') + (sub.neg ? ' · 负余额 ' + ppS(sub.neg) : '')));
      b.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '报价随年代的市场利率、经济环境与本市财政状况变化：财政稳健时融资成本较低，负债偏高、财力不足或出现逾期时较高；城投债对财政状况更敏感。已发行债券在发行时锁定利率，按原合同付息，不受之后的报价变化影响。'));
      return b;
    }, false, 'info'));
    el.appendChild(q);
    el.appendChild(this.sec('fi-bond', '债券融资', U.fmtMoney(E.principalDebt()) + ' 未偿本金', function () { return self.bondBlock(); }, true, 'wallet'));
    el.appendChild(this.sec('fi-debt', '债务详情与偿债预测', E.bonds.filter(function (b) { return !b.done; }).length + ' 笔未到期', function () { return self.debtBlock(); }, false, 'calYear'));
  };
  // ---------- 财政：月度账本（科目分开：财政收入、融资到账、建设支出、运营成本、利息、本金偿还、逾期费用） ----------
  const BK = CM.Economy.BUILD_KINDS;
  const buildOf = function (r) { let s = 0; for (const k of BK) s += r[k] || 0; return s; };
  const incomeOf = function (r) { return (r.grant || 0) + (r.fare || 0) + (r.reward || 0); };
  const opsOf = function (r) { return (r.ops || 0) + (r.propMaint || 0) + (r.busOps || 0) + (r.facMaint || 0); };
  const serviceOf = function (r) { return (r.interest || 0) + (r.principal || 0) + (r.penalty || 0); };
  UI.prototype.ledgerBlock = function () {
    const g = this.g(), E = g.econ, c = E.cur, free = E.isFree(), oi = E.opsIndex(g.clock.y), M = function (v) { return U.fmtMoney(v || 0); };
    let st = 0; for (const s of g.compiled.stations) st += CFG.ops.stationDaily[s.size] * oi;
    const box = h('div');
    const group = function (title, rows, cls) { box.appendChild(h('div', { class: 'fl-g ' + (cls || '') }, h('div', { class: 'fl-h' }, title), this.kv(rows))); }.bind(this);
    if (!free) box.appendChild(this.kv([['期初流动资金', M(c.start)], ['期初建设专项', M(c.capexStart)]]));
    group('财政收入', [['政府拨款', '+ ' + M(c.grant)], ['票款', '+ ' + M(c.fare)], (c.property || 0) > 0.01 ? ['物业租金', '+ ' + M(c.property)] : null, (c.capture || 0) > 0.01 ? ['TOD 增值分成', '+ ' + M(c.capture)] : null, ['任务奖励', '+ ' + M(c.reward)]], 'in');
    if (!free) group('融资到账（不计入收入）', [['债券募集 → 建设专项资金', '+ ' + M(c.bond)]], 'fin');
    group('建设支出', [['建设与拆迁', '− ' + M(buildOf(c))], !free ? ['其中由专项资金支付', M(c.capexUse)] : null], 'out');
    group('运营成本', [['列车运行与车站', '− ' + M(c.ops)], (c.propMaint || 0) > 0.01 ? ['物业维护', '− ' + M(c.propMaint)] : null,
      (c.busOps || 0) > 0.01 ? ['接驳巴士运营', '− ' + M(c.busOps)] : null,
      (c.facMaint || 0) > 0.01 ? ['车站配套维护', '− ' + M(c.facMaint)] : null], 'out');
    if (!free) group('偿债', [['利息', '− ' + M(c.interest)], ['本金偿还', '− ' + M(c.principal)], ['逾期费用', '− ' + M(c.penalty)]], 'debt');
    box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '每日运营成本约 ' + U.fmtMoney(((g.model.daily && g.model.daily.carKm) || 0) * CFG.ops.carKmCost * oi + st) + '（列车运行 + ' + g.compiled.stations.length + ' 座车站），票款与运营成本逐日结算；利息与本金在每月初拨款之后支付。'));
    if (E.ledger.length) {
      const t = h('table', { class: 'tbl', style: { marginTop: '8px' } }, h('tr', null, h('th', null, '月份'), h('th', null, '财政收入'), !free ? h('th', null, '融资') : null, h('th', null, '建设'), h('th', null, '运营'), !free ? h('th', null, '偿债') : null, h('th', null, '期末')));
      for (const r of E.ledger.slice(-12).reverse()) t.appendChild(h('tr', null, h('td', null, r.y + '.' + r.m), h('td', null, U.fmtYi(incomeOf(r), 2)), !free ? h('td', null, r.bond ? U.fmtYi(r.bond, 2) : '—') : null, h('td', null, U.fmtYi(buildOf(r), 2)), h('td', null, U.fmtYi(opsOf(r), 2)), !free ? h('td', null, serviceOf(r) ? U.fmtYi(serviceOf(r), 2) : '—') : null, h('td', { class: r.end < 0 ? 'bad' : '' }, free ? '—' : U.fmtYi(r.end, 1))));
      box.append(h('div', { class: 'tiny muted', style: { marginTop: '8px' } }, '最近 12 个月（' + CFG.money.yi + '；期末为一般资金）'), h('div', { class: 'tbl-wrap' }, t));
    }
    return box;
  };
  // ---------- 财政：债券融资概况与发行入口 ----------
  UI.prototype.bondBlock = function () {
    const self = this, g = this.g(), E = g.econ, y = g.clock.y, D0 = CM.Economy.BOND_DEF;
    const box = h('div');
    for (const k of ['local', 'ct']) {
      const out = E.principalDebt(k), cap = E.bondCap(k, y), quota = E.bondQuota(k, y), used = E.issuedIn(k, y), room = E.bondRoom(k, y), block = E.bondBlock(k);
      box.appendChild(h('div', { class: 'bond-row' },
        h('div', { class: 'row between' }, h('b', null, D0[k].name), h('span', { class: 'tiny muted' }, '3 年期 ' + (E.bondRate(k, y, 3) * 100).toFixed(2) + '% · 6 年期 ' + (E.bondRate(k, y, 6) * 100).toFixed(2) + '%')),
        h('div', { class: 'bond-bar', 'data-tip': '未偿本金 ' + U.fmtMoney(out) + ' / 上限 ' + U.fmtMoney(cap) }, h('i', { style: { width: Math.min(100, out / Math.max(1, cap) * 100).toFixed(1) + '%' } })),
        h('div', { class: 'row between tiny' }, h('span', { class: 'muted' }, '未偿本金 ' + U.fmtMoney(out) + ' / 上限 ' + U.fmtMoney(cap)), h('span', { class: block ? 'bad' : 'muted' }, block ? '暂停发行' : '本年还可发行 ' + U.fmtMoney(room) + '（年度额度 ' + U.fmtMoney(quota) + '，已发 ' + U.fmtMoney(used) + '）'))));
    }
    box.appendChild(h('div', { class: 'row', style: { marginTop: '10px', gap: '8px' } },
      h('button', { class: 'btn primary sm', disabled: E.bondBlock('local') && E.bondBlock('ct') ? true : null, onclick: function () { self.showBondIssue(); } }, CM.icon('plus'), '发行债券'),
      h('span', { class: 'tiny muted grow' }, '募集资金进入建设专项资金，只能用于地铁建设及改扩建；每年付息、到期一次还本。')));
    return box;
  };
  // ---------- 财政：债务详情与未来偿债预测 ----------
  UI.prototype.debtBlock = function () {
    const g = this.g(), E = g.econ, D0 = CM.Economy.BOND_DEF, box = h('div');
    const live = E.bonds.filter(function (b) { return !b.done; }), overdue = E.bonds.filter(function (b) { return b.done && !E.bondSettled(b); }), done = E.bonds.filter(function (b) { return E.bondSettled(b); });
    if (!live.length) box.appendChild(h('div', { class: 'note' }, '目前没有未到期的债券。'));
    for (const b of live.concat(overdue)) {
      const k = b.paidYears + 1, t = b.ym0 + 12 * k, ny = Math.floor(t / 12), nm = t % 12 + 1, due = b.amount * b.rate + (k >= b.term ? b.amount : 0);
      box.appendChild(h('div', { class: 'debt-card', 'data-tip': b.quote ? '发行时报价：' + b.quote.map(function (p) { return p[0] + ' ' + (p[1] * 100).toFixed(2) + '%'; }).join('；') : null },
        h('div', { class: 'row between' }, h('b', null, D0[b.kind].name + ' · ' + U.fmtMoney(b.amount)), h('span', { class: 'tag' + (b.done ? ' bad' : '') }, b.done ? '已到期 · 本息未还清' : b.term + ' 年期 · 合同利率 ' + (b.rate * 100).toFixed(2) + '%')),
        h('div', { class: 'tiny muted' }, b.issued[0] + '年' + b.issued[1] + '月发行 · ' + (b.issued[0] + b.term) + '年' + b.issued[1] + '月到期 · 实付利息 ' + U.fmtMoney(b.interestPaid) + '（已结算 ' + b.paidYears + ' / ' + b.term + ' 期）'),
        b.done ? null : h('div', { class: 'small', style: { marginTop: '3px' } }, '下次还款：' + ny + '年' + nm + '月 ' + U.fmtMoney(due) + (k >= b.term ? '（含到期本金）' : '（利息）')),
        (b.interestArrears || 0) + (b.principalArrears || 0) > CM.Economy.MONEY_EPS ? h('div', { class: 'small bad', style: { marginTop: '3px' } }, '逾期利息 ' + U.fmtMoney(b.interestArrears || 0) + ' · 逾期本金 ' + U.fmtMoney(b.principalArrears || 0)) : null));
    }
    if (done.length) box.appendChild(h('div', { class: 'tiny muted', style: { margin: '6px 0' } }, '已还清 ' + done.length + ' 笔，共 ' + U.fmtMoney(done.reduce(function (s, b) { return s + b.amount; }, 0))));
    if (E.overdue > CM.Economy.MONEY_EPS) { const P = E.odParts(); box.appendChild(this.kv([['逾期合计', U.fmtMoney(E.overdue), 'bad'], ['其中利息 / 本金 / 费用', U.fmtMoney(P.interest) + ' / ' + U.fmtMoney(P.principal) + ' / ' + U.fmtMoney(P.penalty)], ['已逾期', E.overdueMonths + ' 个月']])); }
    const fc = E.debtForecast(g.clock.y, g.clock.m, 7);
    const t = h('table', { class: 'tbl', style: { marginTop: '8px' } }, h('tr', null, h('th', null, '年份'), h('th', null, '利息'), h('th', null, '到期本金'), h('th', null, '合计')));
    let any = false;
    for (const r of fc) { const s = r.interest + r.principal; if (s > CM.Economy.MONEY_EPS) any = true; t.appendChild(h('tr', null, h('td', null, r.y + (r.y === g.clock.y ? '（剩余月份）' : '')), h('td', null, r.interest > CM.Economy.MONEY_EPS ? U.fmtMoney(r.interest) : '—'), h('td', null, r.principal > CM.Economy.MONEY_EPS ? U.fmtMoney(r.principal) : '—'), h('td', null, s > CM.Economy.MONEY_EPS ? U.fmtMoney(s) : '—'))); }
    box.appendChild(h('div', { class: 'fl-h', style: { marginTop: '10px' } }, '未来偿债预测'));
    if (any) box.appendChild(h('div', { class: 'tbl-wrap' }, t));
    else box.appendChild(h('div', { class: 'note' }, E.overdue > CM.Economy.MONEY_EPS ? '未来几年没有新的计划内到期本息；现有逾期仍需偿还，详见上方欠款明细。' : '未来几年没有需要偿还的本息。'));
    box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '利息与本金只从一般资金支付（建设专项资金不能用于偿债）。一般资金不足时差额记为逾期：每月收取逾期费用（1%，逾期满 6 个月 1.5%，满 12 个月 2%），并限制继续发债；一般资金有余额时自动还清。逾期本身不会直接导致挑战失败。'));
    return box;
  };
  // ---------- 财政：资金流水 ----------
  UI.prototype.flowBlock = function () {
    const E = this.g().econ, box = h('div');
    if (!E.flow.length) { box.appendChild(h('div', { class: 'note' }, '还没有资金流水。')); return box; }
    const list = h('div', { class: 'flow-list' });
    for (const f of E.flow.slice(-40).reverse()) {
      list.appendChild(h('div', { class: 'flow-row' },
        h('span', { class: 'flow-d' }, f.y + '.' + f.m + '.' + f.d),
        h('span', { class: 'flow-n' }, f.note, f.acct === 'capex' ? h('span', { class: 'tag fin' }, '专项') : null),
        h('span', { class: 'flow-a ' + (f.amount >= 0 ? 'good' : (f.kind === 'overdue' ? 'bad' : '')) }, (f.amount >= 0 ? '+' : '−') + U.fmtMoney(Math.abs(f.amount)))));
    }
    box.appendChild(list);
    box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '标「专项」的是建设专项资金账户；其余为一般资金。票款与运营成本按月汇总。'));
    return box;
  };
  // ---------- 发行债券 ----------
  UI.prototype.showBondIssue = function () {
    const self = this, g = this.g();
    if (!g || g.pending || g.jumping) { this.toast('正在结算，请稍候再发行债券', 'info'); return; }
    // 固定确认前的日期和条款，避免模拟跨年后实际利率、额度与还款日期偏离预览。
    this.setSpeed(0);
    const E = g.econ, y = g.clock.y, D0 = CM.Economy.BOND_DEF;
    let kind = !E.bondBlock('local') && E.bondRoom('local', y) > 0 ? 'local' : 'ct', term = 3, amount = 0;
    const cards = h('div', { class: 'bond-kinds' });
    const slider = h('input', { type: 'range', min: 0, max: 1, step: 1, value: 0, 'aria-label': '发行金额' });
    const amt = h('div', { class: 'fare-v' });
    const pv = h('div');
    const ok = h('button', { class: 'btn primary', onclick: function () {
      const r = g.issueBond(kind, term, amount);
      if (!r.ok) { self.toast(r.error, 'bad'); return; }
      CM.Sound && CM.Sound.play('coin');
      self.toast('已发行' + D0[kind].name + ' ' + U.fmtMoney(r.bond.amount) + '，资金进入建设专项资金', 'good');
      self.closeScreen(); self.markUnsaved(); self.finTab = 'debt'; self.openPage('finance', 'debt', { root: true });
    } }, CM.icon('check'), '确认发行');
    const termCtl = h('div', { class: 'seg-ctl' });
    const draw = function () {
      cards.innerHTML = '';
      for (const k of ['local', 'ct']) {
        const block = E.bondBlock(k), room = E.bondRoom(k, y);
        cards.appendChild(h('button', { class: 'bond-kind' + (kind === k ? ' on' : ''), disabled: block || room <= 0 ? true : null, 'data-silent': '1', onclick: function () { if (kind !== k) { kind = k; CM.Sound && CM.Sound.play('soft'); draw(); } } },
          h('b', null, D0[k].name), h('small', null, D0[k].desc),
          h('span', { class: 'bk-rate' }, (E.bondRate(k, y, term) * 100).toFixed(2) + '%', h('small', null, ' 年利率（' + term + ' 年期）')),
          h('small', { class: block ? 'bad' : 'muted' }, block || ('本年还可发行 ' + U.fmtMoney(room)))));
      }
      termCtl.innerHTML = '';
      for (const t of [3, 6]) termCtl.appendChild(h('button', { class: term === t ? 'on' : '', 'data-silent': '1', onclick: function () { if (term !== t) { term = t; CM.Sound && CM.Sound.play('soft'); draw(); } } }, t + ' 年期'));
      const room = E.bondBlock(kind) ? 0 : E.bondRoom(kind, y), step = Math.max(1, Math.round(room / 100));
      slider.max = String(Math.max(0, Math.floor(room / step) * step)); slider.step = String(step);
      if (amount > +slider.max || amount <= 0) amount = Math.min(+slider.max, Math.max(step, Math.round(room / 2 / step) * step));
      slider.value = String(amount); slider.disabled = room <= 0;
      show();
    };
    const show = function () {
      const q = E.bondQuote(kind, y, term), rate = q.rate, it = amount * rate;
      amt.textContent = U.fmtMoney(amount);
      pv.innerHTML = '';
      pv.appendChild(self.kv([['年利率（发行时锁定）', (rate * 100).toFixed(2) + '%'], ['每年利息', U.fmtMoney(it)], ['利息合计（' + term + ' 年）', U.fmtMoney(it * term)],
        ['首次付息', (g.clock.y + 1) + '年' + g.clock.m + '月'], ['到期还本', (g.clock.y + term) + '年' + g.clock.m + '月 ' + U.fmtMoney(amount)], ['发行后建设专项资金', U.fmtMoney(E.capex + amount)]]));
      // 借多少才合适（A11）：把「每年利息 ÷ 全年拨款」摆出来。这是判断「还不还得起」的两个数，
      // 玩家不必再去翻账本自己算一次。
      let oldInt = 0;
      for (const b of E.bonds) if (!b.done) oldInt += b.amount * b.rate;
      // 批次模式下还款只能靠「运营现金流」：票款 + 物业租金 + 运营补贴。
      // 拿年盘子去比没有意义——那是建设专项资金，一分都不能还债。
      const batch = E.batchOn && E.batchOn();
      let opCash = 0;
      if (batch) {
        const L2 = E.ledger.slice(-12);
        for (const r2 of L2) opCash += (r2.fare || 0) + (r2.property || 0) + (r2.subsidy || 0);
        if (L2.length) opCash = opCash / L2.length * 12;
      }
      const base = Math.max(1, batch ? opCash : E.grantFor(y, g.clock.m) * 12), intYr = oldInt + it, ratio = intYr / base;
      pv.appendChild(self.kv([
        ['每年利息（含既有债务）', U.fmtMoney(intYr)],
        [batch ? '占年运营现金流' : '占全年拨款', U.fmtPct(ratio, 0), ratio > 0.5 ? 'bad' : (ratio > 0.3 ? 'warn' : '')],
        [batch ? '年运营现金流（票款 + 物业 + 补贴）' : '全年拨款', U.fmtMoney(base)],
      ]));
      pv.appendChild(h('div', { class: 'note', style: { marginTop: '4px' } }, ratio > 0.5 ? '利息已超过年运营现金流的一半：还债只能挤占运营，风险很高。' : (ratio > 0.3 ? '利息约占运营现金流的三到五成，需要运营继续改善。' : '利息在运营现金流可以承受的范围内。') + (batch ? '（建设专项资金不能用于还债。）' : '')));
      pv.appendChild(h('div', { class: 'qline' }, q.parts.map(function (p, i) { return h('span', { class: p.k === 'base' ? '' : (p.v > 0.00005 ? 'bad' : (p.v < -0.00005 ? 'good' : 'muted')) }, (i ? (p.v < 0 ? ' − ' : ' + ') : '') + p.label.replace(/（.*）/, '') + ' ' + (Math.abs(p.v) * 100).toFixed(2) + '%'); })));
      ok.disabled = !(amount > 0);
    };
    slider.addEventListener('input', function () { amount = +slider.value; show(); });
    draw();
    const card = h('div', { class: 'card bond-dlg' },
      h('div', { class: 'card-head' }, h('span', { class: 'badge b-gold' }, CM.icon('wallet')), h('div', { class: 'grow' }, h('h2', null, '发行债券'), h('div', { class: 'tiny muted' }, '募集资金只能用于地铁建设及改扩建')), h('button', { class: 'iconbtn', 'data-tip': '关闭', 'data-key': 'Esc', onclick: function () { self.closeScreen(); } }, CM.icon('close'))),
      cards,
      h('div', { class: 'field' }, h('label', null, '期限'), termCtl),
      h('div', { class: 'field' }, h('label', null, '发行金额'), h('div', { class: 'fare-top' }, amt), h('div', { class: 'fare-slider' }, h('span', { class: 'tiny muted' }, '0'), slider, h('span', { class: 'tiny muted' }, '本年额度'))),
      pv,
      h('div', { class: 'note', style: { marginTop: '8px' } }, '借款不算财政收入：募集资金进入建设专项资金，确认建设时优先使用；利息与本金从一般资金支付。一般资金不足时转为逾期，会产生逾期费用并限制继续发债，但不会因一次逾期直接失败。'),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: function () { self.closeScreen(); } }, '取消'), ok));
    this.openScreen(card, function () { self.closeScreen(); });
  };
  // 票价：全网统一票价，单个滑块。拖动时更新金额与影响估算，松手后应用并重新计算客流
  UI.fmtFare = function (v) { return CFG.money.sym + (v % 1 ? (v * 10 % 1 ? v.toFixed(2) : v.toFixed(1)) : String(v)) + '/次'; };
  UI.prototype.fareEditor = function () {
    const g = this.g(), E = g.econ, self = this, R = CFG.fareRange;
    const box = h('div', { class: 'fare-ed' });
    const val = h('div', { class: 'fare-v' });
    const slider = h('input', { type: 'range', min: R.min, max: R.max, step: R.step, value: E.fare.flat, 'aria-label': '全网统一票价' });
    const effect = h('div');
    const vot = U.interp(CFG.choice.vot, g.clock.y);
    // 票价试算：拖动时给的是真实模型跑出来的客流与票款，不是线性外推。
    // 曲线按「当前票价」那一点校准，所以当前值一定与界面上的实际数值一致。
    const curveBox = h('div');
    const curveNote = h('div', { class: 'note', style: { marginTop: '6px' } });
    let curve = null, curveTimer = 0;
    // 在已扫出的曲线里插值，滑块步进小于扫描点时也能给出连续结果
    const curveAt = function (v) {
      if (!curve || !curve.length) return null;
      const last = curve[curve.length - 1];
      if (v <= curve[0].fare) return curve[0];
      if (v >= last.fare) return last;
      for (let i = 1; i < curve.length; i++) {
        const a = curve[i - 1], b = curve[i];
        if (v <= b.fare) {
          const t = (v - a.fare) / ((b.fare - a.fare) || 1);
          return { fare: v, metro: a.metro + (b.metro - a.metro) * t, revenue: a.revenue + (b.revenue - a.revenue) * t };
        }
      }
      return last;
    };
    const renderCurve = function () {
      curveBox.innerHTML = '';
      if (!curve) return;
      let best = curve[0];
      for (const r of curve) if (r.revenue > best.revenue) best = r;
      const cur = E.fare.flat;
      const el = h('div', { class: 'kv' });
      for (const r of curve) {
        const on = Math.abs(r.fare - cur) < 1e-6, opt = r === best && curve.length > 2;
        el.append(
          h('div', { class: 'k' }, UI.fmtFare(r.fare) + (on ? ' · 当前' : '')),
          h('div', { class: 'v' + (opt && !on ? ' good' : '') },
            U.fmtPeople(r.metro) + ' 人次 · ' + U.fmtMoney(r.revenue / 1e4) + (opt ? ' · 票款最高' : '')));
      }
      curveBox.appendChild(el);
      curveNote.textContent = '用真实出行模型试算：票价变化会改变「坐地铁还是开车」的选择，所以客流与票款不是线性关系。试算在后台完成，不改动当前设置。';
    };
    const startCurve = function () {
      const net = g.model && g.model.net;
      const d = g.model && g.model.daily;
      if (!net || !net.R || !d || !(d.metro > 0)) {
        curveNote.textContent = '还没有地铁客流，暂时无法试算票价对客流的影响。修出线路并通车后会给出对照。';
        return;
      }
      const cur = E.fare.flat, vals = [cur];
      for (let k = 0; k < 5; k++) vals.push(R.min + (R.max - R.min) * k / 4);
      const uniq = [];
      for (const v of vals.map(function (x) { return Math.round(x / R.step) * R.step; }).sort(function (a, b) { return a - b; })) {
        if (!uniq.length || Math.abs(uniq[uniq.length - 1] - v) > 1e-9) uniq.push(v);
      }
      curveNote.textContent = '正在用出行模型试算各票价下的客流…（约数秒）';
      g.model.predictFare(uniq, function (rows) {
        if (!rows || !rows.length || !rows.some(function (r) { return r.metro > 0; })) {
          curveNote.textContent = '试算未完成（出行模型尚未收敛），稍后重新打开本面板可再试。';
          return;
        }
        let at = rows[0];
        for (const r of rows) if (Math.abs(r.fare - cur) < Math.abs(at.fare - cur)) at = r;
        // 校准到界面上的真实数值：有限次迭代会留下千分级的系统偏差，用它把整条曲线拉齐
        const k = at && at.metro > 0 ? (g.model.daily.metro / at.metro) : 1;
        curve = rows.map(function (r) { return { fare: r.fare, metro: r.metro * k, revenue: r.revenue * k }; });
        if (!box.isConnected) return;   // 面板已关闭，留着结果没有意义
        if (curveBox.isConnected) { renderCurve(); show(+slider.value); }
        else curveNote.textContent = '试算已完成，展开本区块查看各票价下的客流与票款。';
      });
    };
    const show = function (v) {
      val.textContent = UI.fmtFare(v);
      const d = g.model.daily || {}, riders = d.metro || 0;
      const sat = CM.Economy.fareSatEffect(v, g.clock.y);
      effect.innerHTML = '';
      const rows = [['当前日票务收入', riders > 0 ? U.fmtMoney((d.fare || 0) / 10000) + '（' + U.fmtPeople(riders) + ' 人次）' : '暂无客流']];
      const at = v !== E.fare.flat ? curveAt(v) : null;
      if (at && riders > 0) {
        const dm = at.metro / riders - 1, dv = at.revenue / Math.max(1, d.fare) - 1;
        rows.push(['改后日客流', U.fmtPeople(at.metro) + ' 人次（' + U.fmtSigned(dm * 100, 1, '%') + '）', dm < -0.15 ? 'bad' : (dm < -0.02 ? 'warn' : 'good')]);
        rows.push(['改后日票款', U.fmtMoney(at.revenue / 1e4) + '（' + U.fmtSigned(dv * 100, 1, '%') + '）', dv > 0.005 ? 'good' : (dv < -0.005 ? 'warn' : '')]);
      }
      rows.push(['满意度影响', sat < -0.05 ? U.fmtSigned(sat, 1) + ' 分（票价负担，上限 −9）' : '无负担（票价不超过时间价值的 35%）', sat < -4 ? 'bad' : (sat < -0.05 ? 'warn' : 'good')]);
      effect.appendChild(self.kv(rows));
    };
    slider.addEventListener('input', function () { show(+slider.value); });
    slider.addEventListener('change', function () {
      const v = +slider.value;
      if (v === E.fare.flat) return;
      E.fare = { mode: 'flat', flat: v }; g.model.fare = E.fare; g.model.sinceChange = 0; g.touch();
      g.invalidatePrediction('票价已修改，建设预测需要按新票价重新计算');
      g.logEvent({ tag: '经营', title: '调整票价', desc: '全网统一票价 ' + v + ' ' + CFG.money.unit + '/次' });
      self.toast('票价已调整为 ' + UI.fmtFare(v) + '，居民出行选择正在重新计算', 'good');
      self.markUnsaved();
      // 试算曲线以旧票价为基准，改价后作废；等模型重算完再按新票价重扫一次
      curve = null; curveBox.innerHTML = ''; g.model.cancelPredict();
      curveNote.textContent = '票价已改动，正在等待客流重新计算，随后会按新票价重新试算…';
      if (curveTimer) clearTimeout(curveTimer);
      curveTimer = setTimeout(startCurve, 2500);
      show(v);
    });
    show(E.fare.flat);
    box.append(h('div', { class: 'fare-top' }, val, h('span', { class: 'tiny muted' }, '全网统一 · 换乘不另收费')),
      h('div', { class: 'fare-slider' }, h('span', { class: 'tiny muted' }, CFG.money.sym + R.min), slider, h('span', { class: 'tiny muted' }, CFG.money.sym + R.max)),
      this.sec('fi-fare-fx', '票务收入与满意度影响', '', function () {
        return h('div', null, effect, h('div', { class: 'note', style: { marginTop: '6px' } }, '票价越高，乘车意愿越低、票务收入与满意度负担越高。' + g.clock.y + ' 年居民时间价值约 ' + vot.toFixed(1) + ' ' + CFG.money.unit + '/小时（估算）。松手后居民出行选择将在数秒内重新计算。'));
      }, false, 'info'),
      this.sec('fi-fare-cv', '票价试算', '', function () {
        if (curve) renderCurve();
        return h('div', null, curveBox, curveNote);
      }, true, 'chart'));
    startCurve();
    return box;
  };

  // ======================== 页面：任务 ========================
  // 分页：进行中 / 已完成 / 未完成。进行中的任务按剩余时间排序；每张卡片：类型图标、进度环、目标与当前值、
  // 连接任务的站点清单、连续月数、期限条（越临近越醒目）、奖励与未完成后果、定位入口
  const TASK_TYPE = {
    connect: ['route', '连通线路'], coverage: ['target', '地铁覆盖'], zoneCong: ['car', '缓解拥堵'], zoneCov: ['map', '片区覆盖'],
    stationCrowd: ['people', '车站拥挤'], ridership: ['train', '客流增长'], recovery: ['coin', '运营收支'], facShare: ['pin', '设施接驳'], facBus: ['bus', '接驳覆盖'],
  };
  UI.prototype.taskRing = function (v, cls) {
    const p = U.clamp(v || 0, 0, 1), C = 2 * Math.PI * 17;
    return h('span', { class: 'tk-ring ' + (cls || ''), html: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" class="bg"/><circle cx="20" cy="20" r="17" class="fg" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + (C * (1 - p)).toFixed(2) + '"/></svg><b>' + Math.round(p * 100) + '<small>%</small></b>' });
  };
  UI.prototype.page_tasks = function (id) {
    const g = this.g(), T = g.tasks, self = this, ch = g.econ.caps.rewards, E = CFG.economy;
    const ym = g.ym();
    const tab = id || this.taskTab || 'active';
    this.taskTab = tab;
    const el = h('div', { class: 'tk-page' });
    el.appendChild(this.pageTabs([['active', '进行中 ' + T.active.length, 'flag'], ['done', '已完成 ' + T.done.length, 'check'], ['failed', '未完成 ' + T.failed.length, 'error']], tab, function (t) {
      self.taskTab = t; const top = self.stack[self.stack.length - 1]; if (top && top.kind === 'tasks') top.id = t; self.renderPage(false); self.rBody.scrollTop = 0;
    }));
    const body = h('div', { class: 'page-enter' });
    el.appendChild(body);
    const kindTag = function (t) { return t.kind === 'hist' ? h('span', { class: 'tag hist' }, '历史参考') : (t.cityId ? h('span', { class: 'tag est' }, '本城动态') : h('span', { class: 'tag info' }, '动态任务')); };
    const typeOf = function (t) { return TASK_TYPE[t.type] || ['flag', '任务']; };
    const card = function (t) {
      const ev = t.progress || T.evaluate(t, g);
      const dl = U.ymIndex(t.deadline[0], t.deadline[1]), st0 = t.issuedAt ? U.ymIndex(t.issuedAt[0], t.issuedAt[1]) : dl - 24;
      const left = dl - ym, span = Math.max(1, dl - st0), used = U.clamp((ym - st0) / span, 0, 1);
      const urg = left <= 3 ? 'hot' : (left <= 12 ? 'warm' : '');
      const ty = typeOf(t);
      const c = h('div', { class: 'tk-card ' + urg + (ev.ok ? ' ok' : '') });
      c.appendChild(h('div', { class: 'tk-top' },
        h('span', { class: 'badge ' + (t.kind === 'hist' ? 'b-orange' : 'b-violet') }, CM.icon(ty[0])),
        h('div', { class: 'grow' }, h('div', { class: 'tk-meta' }, kindTag(t), h('span', { class: 'tiny muted' }, ty[1])), h('b', { class: 'tk-title' }, t.title)),
        this.taskRing(ev.value, ev.ok ? 'ok' : '')));
      c.appendChild(h('div', { class: 'tk-desc' }, t.desc));
      // 目标与当前值；连接任务列出每个站点区域是否已有车站
      if (t.type === 'connect' && t.anchors) {
        const C0 = g.compiled, hit = t.anchors.map(function (a) { return C0.stations.some(function (s, i) { return C0.serviced[i] && U.dist(s.x, s.y, a.x, a.y) <= a.r; }); });
        c.appendChild(h('div', { class: 'tk-anchors' }, t.anchors.map(function (a, i) {
          return h('button', { class: 'tk-anchor' + (hit[i] ? ' on' : ''), 'data-tip': '在地图上定位「' + a.name + '」（半径约 ' + Math.round(a.r * CFG.CELL_M) + ' m）', onclick: function () { self.locatePoint(a.x, a.y, a.name, a.r || 2); } }, CM.icon(hit[i] ? 'check' : 'locate', 13), a.name);
        })));
        c.appendChild(h('div', { class: 'tk-goal' }, CM.icon('target', 14), h('span', null, ev.ok ? '已全部连通' : (hit.every(Boolean) ? '各处都有车站，但还没有连成同一网络' : '还差 ' + hit.filter(function (x) { return !x; }).length + ' 处没有运营车站'))));
      } else c.appendChild(h('div', { class: 'tk-goal' }, CM.icon('target', 14), h('span', null, ev.text)));
      // 统计口径（v1.9）：工作日 / 周末 / 周平均等
      const basis = CM.Tasks.basisOf ? CM.Tasks.basisOf(t) : null;
      if (basis && basis !== 'net') c.appendChild(h('div', { class: 'tk-basis tiny muted' }, CM.icon('calMonth', 12), '统计口径：' + CM.Tasks.BASIS[basis] + (t.type === 'ridership' && t.basis === 'wd' ? '（任务发布时的口径）' : '')));
      if (t.graced) c.appendChild(h('div', { class: 'tk-basis tiny muted' }, CM.icon('shield', 12), t.graced));
      if (t.sustain) {
        const dots = h('span', { class: 'tk-dots' });
        for (let k = 0; k < t.sustain; k++) dots.appendChild(h('i', { class: k < (t.streak || 0) ? 'on' : '' }));
        c.appendChild(h('div', { class: 'tk-sustain' }, '需连续满足 ' + t.sustain + ' 个月', dots, h('span', { class: 'tiny muted' }, '已 ' + (t.streak || 0) + ' 个月')));
      }
      // 期限条
      c.appendChild(h('div', { class: 'tk-time' },
        h('div', { class: 'tk-tbar' }, h('i', { style: { width: (used * 100).toFixed(1) + '%' } })),
        h('div', { class: 'tk-tl' }, CM.icon('hourglass', 13), h('b', null, left > 0 ? '剩 ' + left + ' 个月' : '本月到期'), h('span', { class: 'muted' }, '截止 ' + t.deadline[0] + '年' + t.deadline[1] + '月 · 每月初评估'))));
      // 奖励与后果
      if (ch) c.appendChild(h('div', { class: 'tk-stakes' },
        h('span', { class: 'tk-chip good' }, CM.icon('gift', 13), '奖励 ' + U.fmtMoney(t.reward)), h('span', { class: 'tk-chip good' }, CM.icon('smile', 13), '满意度 +4（6 个月）'),
        h('span', { class: 'tk-chip bad', 'data-tip': '到期未完成：未来 ' + E.failGrantMonths + ' 个月（含当月）拨款 ×' + E.failGrantFactor + '，满意度 ' + E.failSat }, CM.icon('warn', 13), '未完成：拨款 ×' + E.failGrantFactor + '（' + E.failGrantMonths + ' 个月）')));
      // 定位
      const locs = [];
      if (t.zone !== undefined) locs.push(h('button', { class: 'btn sm ghost', onclick: function () { self.locateZone(t.zone); } }, CM.icon('locate', 14), '定位片区'));
      if (t.station) { const s = g.net.stations[t.station]; if (s) locs.push(h('button', { class: 'btn sm ghost', onclick: function () { self.select({ kind: 'station', id: t.station }); self.flyTo(s.x, s.y, Math.max(self.R.cam.zoom, 22)); } }, CM.icon('station', 14), s.name)); }
      if (t.fac) { const f = CM.Fac.byId(t.fac); if (f) locs.push(h('button', { class: 'btn sm ghost', onclick: function () { self.select({ kind: 'facility', id: f.id }); self.locatePoint(f.x, f.y, f.name, Math.max(0.8, f.r), 3); } }, CM.icon(f.T.icon, 14), f.name)); }
      if (t.type === 'coverage') locs.push(h('button', { class: 'btn sm ghost', onclick: function () { self.setLayer('cover'); } }, CM.icon('lyCover', 14), '查看覆盖图层'));
      if (t.type === 'zoneCong') locs.push(h('button', { class: 'btn sm ghost', onclick: function () { self.setLayer('cong'); } }, CM.icon('lyCong', 14), '拥堵图层'));
      if (locs.length) c.appendChild(h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '4px', marginTop: '6px' } }, locs));
      return c;
    }.bind(this);
    const closedRow = function (t) {
      const ok = t.status === 'done', ty = typeOf(t);
      return h('div', { class: 'tk-row ' + (ok ? 'ok' : 'fail') }, h('span', { class: 'tk-res' }, CM.icon(ok ? 'check' : 'close', 14)),
        h('div', { class: 'grow' }, h('div', { class: 'tk-meta' }, kindTag(t), h('span', { class: 'tiny muted' }, ty[1])), h('b', null, t.title),
          h('div', { class: 'tiny muted' }, (ok ? '完成于 ' : '到期于 ') + t.closedAt[0] + '年' + t.closedAt[1] + '月' + (ch ? (ok ? ' · 获得奖励 ' + U.fmtMoney(t.reward) : ' · 拨款 ×' + E.failGrantFactor + '（' + E.failGrantMonths + ' 个月）') : ''))));
    };
    if (tab === 'active') {
      if (!ch) body.appendChild(this.callout('info', 'info', '自由建造模式：任务仅供参考，没有奖励，未完成也不会有后果。'));
      const list = T.active.slice().sort(function (a, b) { return U.ymIndex(a.deadline[0], a.deadline[1]) - U.ymIndex(b.deadline[0], b.deadline[1]); });
      if (!list.length) body.appendChild(h('div', { class: 'tk-empty' }, CM.icon('flag', 26), h('b', null, '暂无进行中的任务'), h('span', null, (D.histTasks && D.histTasks.length ? '历史参考任务按年份发布；' : '') + (D.noDynTasks ? '本地图不生成动态任务。' : '动态任务根据拥堵、覆盖、车站拥挤与客流情况，开局一年后约每 6 个月生成。'))));
      for (const t of list) body.appendChild(card(t));
      // 即将发布的历史任务（只显示年份与标题，不提前给出目标）
      const next = (D.histTasks || []).filter(function (x) { return !T.issued[x.id] && U.ymIndex(x.appear[0], x.appear[1]) > ym; }).slice(0, 3);
      if (next.length) body.appendChild(h('div', { class: 'tk-next' }, h('div', { class: 'fl-h' }, '即将发布的历史任务'), next.map(function (x) { return h('div', { class: 'tiny' }, h('b', null, x.appear[0] + '年' + x.appear[1] + '月'), ' · ' + x.title); })));
    } else {
      const arr = (tab === 'done' ? T.done : T.failed).slice().reverse();
      if (!arr.length) body.appendChild(h('div', { class: 'tk-empty' }, CM.icon(tab === 'done' ? 'trophy' : 'flag', 26), h('b', null, tab === 'done' ? '还没有完成的任务' : '没有未完成的任务'), h('span', null, tab === 'done' ? '完成任务可获得奖励拨款与满意度。' : '到期未达成的任务会列在这里。')));
      for (const t of arr) body.appendChild(closedRow(t));
    }
    body.appendChild(this.sec('tk-rule', '任务说明', '', function () { return h('div', { class: 'note' }, (D.taskNote || '历史参考任务参考本城的发展需求，但不要求按真实线路走向建设，只需满足目标描述。') + '动态任务根据当前拥堵、覆盖、车站拥挤与客流情况生成。进度每月初评估；单个任务失败不会直接结束游戏。'); }, false, 'info'));
    return { title: '任务', el: el };
  };

  // ======================== 页面：存档 ========================
  UI.prototype.page_saves = function () {
    const g = this.g(), self = this;
    const el = h('div');
    const s = this.save;
    const saved = this.isSaved();
    el.appendChild(h('div', { class: 'callout ' + (s.state === 'error' ? 'bad' : (saved ? 'good' : 'info')) }, s.state === 'error' ? '最近一次保存失败：' + s.msg + '。建议立即「导出当前进度」作为备份。' : this.saveStatusText() + (s.at ? '，保存于 ' + new Date(s.at).toLocaleString('zh-CN') : '') + (saved ? '' : '。')));
    el.appendChild(this.kv([['进度名称', g.name], ['游戏模式', CM.modeName(g.mode)], ['游戏日期', g.clock.y + '年' + g.clock.m + '月' + g.clock.d + '日']]));
    el.appendChild(h('div', { class: 'row', style: { margin: '10px 0', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm primary', onclick: function () { self.manualSave(); } }, '手动保存'),
      h('button', { class: 'btn sm', onclick: function () { try { CM.Save.exportGame(g); self.toast('已导出存档文件', 'good'); } catch (e) { self.toast('导出失败：' + e.message, 'bad'); } } }, '导出当前进度'),
      h('button', { class: 'btn sm', onclick: function () { self.showSaveManager(true); } }, '存档管理')));
    const games = CM.Save.list();
    const mine = games.find(function (x) { return x.gameId === g.id; });
    el.appendChild(this.sec('sv-list', '本进度的存档', mine ? mine.slots.length + ' 个' : '0 个', function () {
      const b = h('div');
      if (!mine) { b.appendChild(h('div', { class: 'note' }, '尚无存档。')); return b; }
      for (const sl of mine.slots) b.appendChild(self.slotRow(sl, true));
      return b;
    }, true));
    el.appendChild(this.sec('sv-note', '关于本地保存', '', function () {
      return h('div', { class: 'note' }, '游戏无需账号，进度保存在当前浏览器的本地存储（' + CM.Save.backend() + '）中：每月自动保存，并在建设完成后保存；自动存档在两个位置轮换写入。本地保存不会跨设备同步；清除浏览器数据会删除存档。更换电脑或浏览器时，请导出存档文件，再在新设备上导入。全部存档约 ' + (CM.Save.usage() / 1024 / 1024).toFixed(1) + ' MB。');
    }));
    return { title: '存档', el: el };
  };
  UI.prototype.slotRow = function (sl, inGame) {
    const self = this;
    const d = sl.date || [0, 0, 0];
    return h('div', { class: 'slot' },
      h('div', { class: 'info' }, h('div', { class: 't' }, sl.label + (sl.kind === 'auto' ? '' : '')), h('div', { class: 'tiny muted' }, '游戏日期 ' + d[0] + '年' + d[1] + '月' + d[2] + '日 · ' + CM.modeName(sl.mode) + ' · ' + sl.stations + ' 站 · 保存于 ' + new Date(sl.savedAt).toLocaleString('zh-CN'))),
      h('button', { class: 'btn sm', onclick: function () { self.loadSlot(sl.slotId); } }, '载入'),
      h('button', { class: 'btn sm ghost', title: '导出为文件', onclick: function () { CM.Save.exportSlot(sl.slotId).catch(function (e) { self.toast('导出失败：' + e.message, 'bad'); }); } }, '导出'),
      inGame && sl.kind === 'manual' && sl.gameId === (self.g() && self.g().id) ? h('button', { class: 'btn sm ghost', title: '用当前进度覆盖此存档', onclick: function () { self.confirm('覆盖存档？', '将用当前进度覆盖「' + sl.label + '」（' + d[0] + '年' + d[1] + '月）。', '覆盖', function () { self.manualSave(sl.slotId, sl.label); }); } }, '覆盖') : null,
      h('button', { class: 'btn sm ghost danger', onclick: function () { self.confirm('删除存档？', '「' + sl.label + '」将被永久删除，无法恢复。', '删除', function () { CM.Save.remove(sl.slotId); self.toast('已删除存档', 'info'); self.rerenderPage(); if (self.screenRefresh) self.screenRefresh(); }, true); } }, '删除'));
  };

  // ======================== 页面：帮助 ========================
  UI.prototype.page_help = function () {
    const el = h('div');
    const rows = [['鼠标左键拖动 / WASD / 方向键', '平移地图'], ['滚轮 / + −', '缩放'], ['V / B / L / E / X', '选择 / 建站 / 绘线 / 修改 / 拆除'], ['Shift + 点击（绘线）', '添加转弯点'], ['右键 / Enter（绘线）', '结束本次绘线（下次从线路端点开始会自动延长该线路）'], ['1–9（线路选择框）', '起点同时是多条线路的端点时，选择要延长的线路'], ['Backspace', '撤销转弯点或草案上一步'], ['Ctrl+Z / Ctrl+Y（或 Ctrl+Shift+Z）', '撤销 / 重做草案'], ['Ctrl + Enter', '确认建设草案'], ['Ctrl / Shift + 点击（选择、修改）', '多选车站或轨道，批量修改'], ['拖动线路端点的「+」', '直接延长所选线路'], ['空格', '暂停 / 继续（进入游戏时默认暂停）'], ['1 / 2 / 3', '1× / 3× / 8× 速度'], ['T / U', '切换 2D·2.5D / 地下视图'], ['G', '城市统计'], ['K', '线路示意图（可平滑缩放、导出 PNG）'], ['点击行驶中的列车', '跟随这列车；H 隐藏 / 显示界面，Esc 或拖动地图退出'], ['/', '搜索车站、线路、道路、区域与地名'], ['N', '切换浅色 / 深色模式'], ['M', '开关音效'], ['F', '显示全图'], ['Esc', '结束绘线 → 退出工具 → 收起面板']];
    const t = h('table', { class: 'tbl' });
    for (const r of rows) t.appendChild(h('tr', null, h('td', null, h('kbd', null, r[0])), h('td', { style: { textAlign: 'left' } }, r[1])));
    el.appendChild(t);
    el.appendChild(h('h3', null, '玩法提示'));
    el.appendChild(h('div', { class: 'note' }, '界面：左上为日期与时间控制（暂停、速度、+1 月、+1 年）；右上为关键指标（资金、经济增长、人口、分担率、拥堵、满意度）与搜索、任务、统计、设置、菜单；左侧切换视图与图层；底部为建设工具；左下为缩放。点击指标打开对应详情：资金与经济增长共用「财政与经济」面板。'));
    el.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '1. 打开「人口密度」「道路拥堵」「出行方向」图层，找到出行集中的走廊。2. 用「绘线」连接主要起终点，车站间距 0.8–1.5 km 较常见。3. 查看右侧费用与效果预测，无冲突后确认建设，线路立即投入运营。4. 观察车站客流与道路变化，再升级车站、延长线路或建设换乘。绕行严重、换乘不便、过度拥挤或票价过高的线路吸引力有限。'));
    el.appendChild(h('h3', null, '设施、出行目的与工作日 / 周末'));
    el.appendChild(h('div', { class: 'note' }, '居民出行分为通勤、上学、购物、医疗、旅游休闲与交通枢纽接驳六类。火车站、机场、大学、医院、商圈、景点、公园、体育场馆等重要设施按真实位置与年代单独计算，点击地图上的设施（或在「设施出行需求」图层中点击圆点）可查看到访量、出行目的与附近车站；普通设施按片区汇总。工作日通勤、上学集中在早晚高峰，周末购物与休闲更多。火车站与机场的旅客量是给定的，修地铁只改变他们的接驳方式。'));
    el.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, '图层分三组：城市（人口密度、住宅与就业、设施出行需求）、交通（道路拥堵、出行方向）、地铁（地铁覆盖、车站客流、地铁服务缺口）。「地铁服务缺口」显示出行多但步行 15 分钟内没有车站、或已有地铁但高峰超载的地方。地面铁路在没有道口、地道或天桥的地方阻隔步行；地铁地面线不能与铁路平交，地下或高架跨越铁路会增加费用。'));
    el.appendChild(h('h3', null, '经营与融资'));
    el.appendChild(this.econGuide());
    return { title: '操作说明', el: el };
  };
  UI.prototype.page_data = function () { return { title: '数据说明', el: h('div', null, this.dataNote()) }; };
})(window.CM);
