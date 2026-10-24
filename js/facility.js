'use strict';
// 城市设施（v1.9）：重要设施（铁路客运站、机场、大学、医院、商圈、商务区、景点、公园、体育场馆、会展中心）
// 按真实位置、启用/停用年份与规模单独参与出行需求（sim.js 中作为独立的出行目的地节点）；
// 普通设施（中小学、社区商业、诊所、街区公园等）不逐个建模，按交通小区的用地、人口与岗位汇总（sim.js buildZones）。
// 数据来源：位置与年份见各地图数据文件 facilities（史实参考 / 虚构），规模均为估算；模拟到访量为游戏结果。
(function (CM) {
  const U = CM.U, D = CM.DATA;

  // p：吸引的出行目的及比例；we：周末相对该目的平均水平的吸引倍数；L：距离衰减长度相对 distDecayHO 的倍数；r：默认场地半径（格）
  const TYPES = {
    rail: { name: '铁路客运站', icon: 'train', p: { hb: 1 }, hub: true, we: 1, L: 0, r: 0.6, group: '交通枢纽' },
    air: { name: '机场', icon: 'plane', p: { hb: 1 }, hub: true, we: 1, L: 0, r: 1.2, group: '交通枢纽' },
    uni: { name: '大学', icon: 'school', p: { sc: 1 }, we: 3, L: 1.8, r: 1.0, group: '教育' },
    hosp: { name: '医院', icon: 'hospital', p: { md: 1 }, we: 1, L: 1.8, r: 0.5, group: '医疗' },
    shop: { name: '商圈', icon: 'bag', p: { sh: 0.8, lz: 0.2 }, we: 1.1, L: 1.5, r: 1.0, group: '商业' },
    cbd: { name: '商务区', icon: 'building', p: { sh: 1 }, we: 0.35, L: 1.6, r: 1.4, group: '商业' },
    scenic: { name: '景点', icon: 'camera', p: { lz: 1 }, we: 1.25, L: 2.6, r: 0.8, group: '旅游休闲' },
    park: { name: '公园', icon: 'tree', p: { lz: 1 }, we: 1.15, L: 1.4, r: 1.0, group: '旅游休闲' },
    stadium: { name: '体育场馆', icon: 'stadium', p: { lz: 1 }, we: 1.3, L: 2.4, r: 0.6, group: '旅游休闲' },
    venue: { name: '会展中心', icon: 'expo', p: { sh: 0.6, lz: 0.4 }, we: 0.6, L: 2.4, r: 0.8, group: '商业' },
    // 玩家在车站上盖开发的商场：由 Game 在开发变化时同步进 Fac.dynamic。
    // 只影响**购物与休闲**目的，不碰通勤（工作地点不会因为商场出现而改变）。
    // 吸引量按商业面积占「全市购物中心形态面积」的份额给出（见 sim.js buildDemandGen），
    // 所以增加的是"这一带作为目的地的吸引力"，出行总量不变，变化的是去向与交通方式。
    mall: { name: '上盖商场', icon: 'bag', p: { sh: 0.55, lz: 0.45 }, we: 1.2, L: 1.4, r: 0.5, group: '商业' },
  };
  const Fac = { TYPES: TYPES };
  CM.Fac = Fac;

  const yrOf = function (v) { return v == null ? null : (Array.isArray(v) ? v[0] + ((v[1] || 1) - 1) / 12 : v); };
  const curve = function (v) { return typeof v === 'number' ? [[0, v]] : v; };

  // 当前地图的设施表（按地图数据缓存）。lm：引用地标（位置、场地与落成年份取自地标）
  // 玩家开发的上盖商场（动态设施）。由 Game 同步；版本号变化时让列表缓存失效，
  // 从而触发 sim.js 重建设施节点与需求表，OD 会按新的吸引力重新分配。
  Fac.dynamic = [];
  Fac.dynVersion = 0;
  Fac.setDynamic = function (arr) { Fac.dynamic = arr || []; Fac.dynVersion++; };

  Fac.list = function () {
    if (D._facSrc === D.facilities && D._fac && D._facVer === Fac.dynVersion) return D._fac;
    const out = [];
    const lms = D.landmarks || [];
    (D.facilities || []).forEach(function (s, i) {
      const T = TYPES[s.t]; if (!T) return;
      const f = { k: out.length, id: s.id || ('f' + i), name: s.n, t: s.t, T: T, x: 0, y: 0, r: s.r != null ? s.r : T.r, lmK: -1,
        open: null, close: yrOf(s.y1), w: s.w != null ? curve(s.w) : null, pax: s.pax || null, p: s.p || T.p, note: s.note || '', src: s.src || null };
      if (s.lm) {
        const k = lms.findIndex(function (l) { return l.id === s.lm; });
        if (k < 0) return;
        f.lmK = k; f.x = lms[k].x; f.y = lms[k].y;
        f.open = s.y0 != null ? yrOf(s.y0) : lms[k].year;
      } else if (s.at) { f.x = s.at[0]; f.y = s.at[1]; f.open = s.y0 != null ? yrOf(s.y0) : -1e9; }
      else return;
      if (f.open == null) f.open = -1e9;
      out.push(f);
    });
    for (const d of Fac.dynamic) { d.k = out.length; out.push(d); }
    D._fac = out; D._facSrc = D.facilities; D._facVer = Fac.dynVersion;
    return out;
  };
  Fac.byId = function (id) { const L = Fac.list(); for (const f of L) if (f.id === id) return f; return null; };
  // 是否在运营：启用年份之后、停用年份之前；引用地标的须地标已落成（填海等场地成陆后），其余须所在格为陆地
  Fac.active = function (f, yr, city) {
    if (yr < f.open || (f.close != null && yr >= f.close)) return false;
    if (f.lmK >= 0) return !!(city.landmarkOn && city.landmarkOn[f.lmK]);
    const c = city.cellAt(f.x, f.y);
    return c >= 0 && city.landFrac[c] >= 0.3;
  };
  // 枢纽：接驳出行（汽车 + 地铁，到达与离开合计，人次/日，工作日）；其他：占全市该目的出行吸引的比例（周期规模，估算）
  Fac.pax = function (f, yr) { return f.pax ? U.interp(f.pax, yr) * 1e4 : 0; };
  Fac.share = function (f, yr) { return f.w ? U.interp(f.w, yr) : 0; };
  // 场地格：地标场地或以设施为中心、半径 r 的格（只取陆地）
  Fac.siteCells = function (f, city) {
    const out = [];
    if (f.lmK >= 0) { for (const c of city.landmarkCells(D.landmarks[f.lmK])) if (city.landFrac[c] >= 0.3) out.push(c); }
    else {
      const R = Math.max(0.5, f.r);
      for (let j = Math.floor(f.y - R); j <= Math.floor(f.y + R); j++) for (let i = Math.floor(f.x - R); i <= Math.floor(f.x + R); i++) {
        if (i < 0 || j < 0 || i >= city.W || j >= city.H) continue;
        if (U.dist(i + 0.5, j + 0.5, f.x, f.y) > R + 0.2) continue;
        const c = j * city.W + i; if (city.landFrac[c] >= 0.3) out.push(c);
      }
    }
    const c0 = city.cellAt(f.x, f.y);
    if (!out.length && c0 >= 0) out.push(c0);
    return out;
  };
  // 规模说明（参考规模，估算）
  Fac.sizeText = function (f, yr) {
    if (f.T.hub) return '约 ' + U.fmtNum(Fac.pax(f, yr) / 1e4, 1) + ' 万人次/日的市内接驳出行（工作日，估算）';
    const keys = Object.keys(f.p), nm = CM.CFG.trips.name;
    return '约占全市' + keys.map(function (k) { return nm[k]; }).join('、') + '出行吸引的 ' + U.fmtPct(Fac.share(f, yr), 1) + '（估算）';
  };
  Fac.purposeText = function (f) { const nm = CM.CFG.trips.name; return Object.keys(f.p).map(function (k) { return nm[k]; }).join('、'); };
  // 数据来源标签：[标签, 样式]
  Fac.sources = function (f) {
    if (D.fictional) return [['虚构设定', 'info'], ['规模：估算', 'est']];
    const s = f.src || {};
    return [[s.pos || '位置：真实地理', 'hist'], [s.year || (f.lmK >= 0 ? '年份：地标落成（史实）' : '年份：史实参考'), 'hist'], ['规模：估算', 'est']];
  };
})(window.CM);
