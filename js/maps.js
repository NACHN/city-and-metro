'use strict';
// 地图登记与切换：六张地图（含广州）一视同仁，都由各自的数据文件 CM.registerMap 登记；
// 登记顺序与气候见 manifest.js。新增地图不再需要修改本文件。
// 各模块在加载时引用同一个 CM.DATA 对象，切换地图时替换它的内容，同时替换 CM.GEO（地理数据源）与网格尺寸、起始日期、人口曲线等参数。
(function (CM) {
  const CFG = CM.CFG, U = CM.U;
  CM.DATA = CM.DATA || {};   // 保持对象身份：各模块加载时捕获的就是这个对象，后续只换内容
  // 随地图切换的配置项：格网、起始日期、人口增长、货币与价格基年、建设与运营成本、票价、财政、城市经济、出行选择与道路参数
  const CFG_KEYS = CM.MAP_CFG_KEYS;   // 唯一来源在 config.js（编辑器与校验器共用）
  CM.CFG_KEYS = CFG_KEYS;
  // 基线配置：config.js 的默认值。任何地图未覆盖的键都取这里（不再称「广州样本」）
  const DEFAULT_CFG = {};
  for (const k of CFG_KEYS) DEFAULT_CFG[k] = k === 'START' ? Object.assign({}, CFG.START) : CFG[k];
  // 出行选择参数按「发展阶段对应年份」平移并按本城货币缩放：devOffset 为曲线年份减本城年份，money 为本城货币相对基线的倍数
  const shift = function (curve, off, k) { return curve.map(function (p) { return [p[0] - off, p[1] * (k || 1)]; }); };
  CM.deriveChoice = function (off, money) {
    const ch = DEFAULT_CFG.choice;
    return {
      choice: Object.assign({}, ch, { vot: shift(ch.vot, off, money), carCostPerKm: shift(ch.carCostPerKm, off, money), parking: shift(ch.parking, off, money), occupancy: shift(ch.occupancy, off), hoRate: shift(ch.hoRate, off), workerRate: shift(ch.workerRate, off), distDecayHW: shift(ch.distDecayHW, off), distDecayHO: shift(ch.distDecayHO, off),
        purposeShare: { sc: shift(ch.purposeShare.sc, off), md: shift(ch.purposeShare.md, off), lz: shift(ch.purposeShare.lz, off) } }),
      road: Object.assign({}, DEFAULT_CFG.road, { capGrowth: shift(DEFAULT_CFG.road.capGrowth, off) }),
    };
  };
  const MAPS = {};
  // 所有地图（含广州）由数据文件登记到 CM.MAP_LIST；未写的配置项沿用基线，macro 仅真实城市启用
  for (const m of CM.MAP_LIST || []) {
    const cfg = Object.assign({}, DEFAULT_CFG);
    if (m.econ) Object.assign(cfg, CM.deriveChoice(m.econ.devOffset || 0, m.econ.money || 1));
    Object.assign(cfg, m.cfg);
    // 城市经济：真实城市启用；没有专门参数的真实地图使用通用参数（'auto'），虚构地图（教程等）不启用
    cfg.macro = m.kind === 'real' ? (cfg.macro || 'auto') : null;
    m.cfg = cfg;
    // 支持哪些模式由能力算出来（见 config.js 的 CM.MODES[*].needs）：新增地图不用再往 source.json 里抄一份
    // 模式清单。数据文件里历史遗留的 modes 字段被忽略，要例外就写 noModes。
    m.modes = CM.modesForMap(m);
    MAPS[m.id] = m;
  }
  // 清单里声明但未注册的地图（资源缺失、script 标签遗漏或顺序错误）明确告警，避免出现「图在列表里、进去是空的」
  for (const e of CM.MAP_MANIFEST || []) if (!MAPS[e.id]) console.warn('地图 ' + e.id + ' 已在清单中声明，但数据文件没有完成登记');

  // 地图数据指纹：格网、要素数量与名称表（用于存档识别与诊断；内容修订须同时提高 mapVersion）
  for (const id in MAPS) {
    const m = MAPS[id], G = m.geo;
    m.mapVersion = m.mapVersion || 1;
    m.fp = U.fnv([id, m.cfg.W, m.cfg.H, (G.water || []).length, (G.roads || []).length, (G.names || []).length, (m.data.regions || []).map(function (r) { return r.id; }).join(',')].join('|'));
  }
  CM.MAPS = MAPS;
  // 选择列表由易到难；同难度内的先后由 manifest.js 的清单声明，未登记的图按登记顺序接在同档末尾。
  const mapOrder = (CM.MAP_ORDER_IDS || []).slice();
  for (const id of Object.keys(MAPS)) if (mapOrder.indexOf(id) < 0) mapOrder.push(id);
  const mapRank = new Map(mapOrder.map(function (id, i) { return [id, i]; }));
  CM.MAP_ORDER = mapOrder.filter(function (id) { return MAPS[id]; }).sort(function (a, b) {
    return (MAPS[a].difficulty || 2) - (MAPS[b].difficulty || 2) || mapRank.get(a) - mapRank.get(b);
  });
  CM.mapId = 'gz';
  CM.useMap = function (id) {
    const m = MAPS[id] || MAPS.gz;
    if (CM.mapId === m.id && CM.GEO === m.geo) return m;
    CM.mapId = m.id;
    for (const k of Object.keys(CM.DATA)) delete CM.DATA[k];
    Object.assign(CM.DATA, m.data);
    CM.GEO = m.geo;
    for (const k of CFG_KEYS) CFG[k] = k === 'START' ? Object.assign({}, m.cfg.START) : m.cfg[k];
    if (CM.Geo) CM.Geo.init();
    if (CM.Metro && CM.Metro.clearCaches) CM.Metro.clearCaches();
    return m;
  };
  CM.curMap = function () { return MAPS[CM.mapId] || MAPS.gz; };

  // 地图缩略图：水系、主要道路与铁路（不切换当前地图，直接解码该地图的数据），按主题配色，结果缓存
  const thumbs = {};
  CM.mapThumb = function (id, theme) {
    const key = id + ':' + theme;
    if (thumbs[key]) return thumbs[key];
    const m = MAPS[id]; if (!m) return null;
    const G = m.geo, dec = CM.Geo.dec, Wc = m.cfg.W, Hc = m.cfg.H;
    const S = Math.min(640 / Wc, 400 / Hc), cv = document.createElement('canvas');
    cv.width = Math.round(Wc * S); cv.height = Math.round(Hc * S);
    const c = cv.getContext('2d'), dark = theme === 'dark';
    c.fillStyle = dark ? '#1b2533' : '#eef3f0'; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(S, 0, 0, S, 0, 0);
    const poly = function (rows, col) {
      c.fillStyle = col; c.beginPath();
      for (const row of rows) for (let k = 1; k < row.length; k++) { if (typeof row[k] !== 'string') continue; const p = dec(row[k], 1); c.moveTo(p[0], p[1]); for (let q = 2; q < p.length; q += 2) c.lineTo(p[q], p[q + 1]); }
      c.fill('evenodd');
    };
    poly(G.woods || [], dark ? '#22362f' : '#dbe9dc');
    poly(G.reserves || [], dark ? '#2a4238' : '#c9dfcc');
    poly(G.parks || [], dark ? '#264034' : '#cfe6cf');
    poly((G.water || []).filter(function (r) { return typeof r[1] !== 'number'; }), dark ? '#2b4f78' : '#a9cdeb');
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const r of G.water || []) if (typeof r[1] === 'number') { const p = dec(r[2]); c.strokeStyle = dark ? '#2b4f78' : '#a9cdeb'; c.lineWidth = Math.max(r[1], 0.25); c.beginPath(); c.moveTo(p[0], p[1]); for (let q = 2; q < p.length; q += 2) c.lineTo(p[q], p[q + 1]); c.stroke(); }
    for (const r of G.rail || []) { if (r[1] & 2) continue; const p = dec(r[2]); c.strokeStyle = dark ? '#5b6676' : '#9aa3ae'; c.lineWidth = 0.18; c.beginPath(); c.moveTo(p[0], p[1]); for (let q = 2; q < p.length; q += 2) c.lineTo(p[q], p[q + 1]); c.stroke(); }
    for (const cls of [3, 4]) for (const r of G.roads || []) {
      if (r[1] !== cls || (r[2] & 6)) continue;
      const p = dec(r[3]); c.strokeStyle = dark ? (cls === 4 ? '#b8964a' : '#6f7b8c') : (cls === 4 ? '#f0b54a' : '#c4ccd6'); c.lineWidth = cls === 4 ? 0.45 : 0.3;
      c.beginPath(); c.moveTo(p[0], p[1]); for (let q = 2; q < p.length; q += 2) c.lineTo(p[q], p[q + 1]); c.stroke();
    }
    thumbs[key] = cv.toDataURL('image/png');
    return thumbs[key];
  };
})(window.CM);
