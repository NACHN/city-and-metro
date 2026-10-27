'use strict';
// 地图注册表：集中声明地图的登记顺序、气候，以及「地区 → 风格键」的唯一映射。
// 新增一张地图只需四步：
//   ① 准备 geo_<id>.js 与 data_<id>.js 两个资源；
//   ② 数据文件末尾调用 CM.registerMap({ id, geo, data, cfg, ... })（参照广州、香港的写法）；
//   ③ 在本文件的 MAP_MANIFEST 里加一行；
//   ④ 在 index.html 引入这两个资源（顺序：geo_<id> → data_<id> → maps.js）。
// 不需要再修改 maps.js / render.js / agents.js —— 地区风格与气候都由这里派生。
(function (CM) {
  // 地区 → 建筑配色与车型构成的风格键。render.js 与 agents.js 共用这一份（此前各自复制了一份）。
  // 地区名称本身仍由各图数据声明（唯一来源），这里只放名称到风格键的映射；未知地区回退到内地风格。
  CM.REGION_STYLE = { '中国内地': 'cn', '中国香港': 'hk', '中国台湾': 'tw', '日本': 'jp' };

  // 清单顺序＝地图选择列表在「同难度」内的先后；难度本身仍由各图数据声明（difficulty 1–4）。
  // climate：cold = 冬季出现深色衣着等季节表现（东京、杭州）；mild = 无。
  // geo / data 为资源名（js/geo_<geo>.js、js/data_<data>.js），供构建期校验使用；geo 为 null 表示几何由数据文件内生成（虚构地图）。
  CM.MAP_MANIFEST = [
    { id: 'tutorial', geo: null, data: 'tutorial', climate: 'mild' },
    { id: 'gz', geo: 'gz', data: 'gz', climate: 'mild' },
    // 广州大图（gz2，240×192 / 60×48 km）：2.6.0 起随包发布，排在小图之后
    { id: 'gz2', geo: 'gz2', data: 'gz2', climate: 'mild' },
    // 上海大图（sh，240×192 / 60×48 km）：1990 年起，跨江与浦东开发
    { id: 'sh', geo: 'sh', data: 'sh', climate: 'mild' },
    { id: 'hz', geo: 'hz', data: 'hz', climate: 'cold' },
    { id: 'hk', geo: 'hk', data: 'hk', climate: 'mild' },
    { id: 'tp', geo: 'tp', data: 'tp', climate: 'mild' },
    { id: 'tk', geo: 'tk', data: 'tk', climate: 'cold' },
  ];
  CM.MAP_ORDER_IDS = CM.MAP_MANIFEST.map(function (e) { return e.id; });

  CM.mapManifest = function (id) {
    for (const e of CM.MAP_MANIFEST) if (e.id === id) return e;
    return null;
  };

  CM.Regions = {
    // 地区名 → 风格键（cn / hk / tw / jp）
    key: function (region) { return CM.REGION_STYLE[region] || 'cn'; },
    // 当前地图的风格键
    current: function () { const m = CM.curMap ? CM.curMap() : null; return CM.Regions.key(m && m.region); },
    // 当前地图的气候（'cold' / 'mild'）
    climate: function () { const e = CM.mapManifest(CM.mapId); return (e && e.climate) || 'mild'; },
    cold: function () { return CM.Regions.climate() === 'cold'; },
  };

  // 地图数据文件调用它完成登记。缺少 geo / data 时立刻报错，避免出现「图在列表里但进不去」的空图。
  CM.registerMap = function (m) {
    if (!m || !m.id) throw new Error('registerMap：地图缺少 id');
    if (!m.geo) throw new Error('registerMap：地图 ' + m.id + ' 缺少 geo（检查 geo_<id>.js 的加载顺序）');
    if (!m.data) throw new Error('registerMap：地图 ' + m.id + ' 缺少 data');
    if (!CM.mapManifest(m.id)) console.warn('地图 ' + m.id + ' 未在 CM.MAP_MANIFEST 中登记：将排在地图列表末尾，且气候按 mild 处理');
    (CM.MAP_LIST = CM.MAP_LIST || []).push(m);
    return m;
  };
})(window.CM);
