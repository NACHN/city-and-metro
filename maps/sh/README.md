# sh —— 上海大图（v2.7.0 起随包发布）

240×192 格 / 60×48 km / 1990 年 / 约 940 万人的上海，从 Geofabrik 的 `china-latest.osm.pbf` 切出来的一整张图。
与广州大图同一尺度（2880 个小区），开局是浦西一城两市：过江只有两条隧道，浦东还没长起来。

## 范围

```
bbox  31.0000,121.2200,31.4330,121.8507      # 南,西,北,东
proj  121.22,31.433,380.53,443.39            # lon0,lat0,格/经度,格/纬度（250 m 一格）
```

西到虹桥与松江新城东缘，东到浦东国际机场，北到吴淞口与嘉定，南到莘庄与惠南。
覆盖黄浦、静安、徐汇、长宁、普陀、闸北、虹口、杨浦、浦东、宝山、嘉定、闵行、松江与奉贤北部。

## 内容

| 文件 | 说明 |
| --- | --- |
| `source.json` | 地图源码（`scripts/map-source.mjs` 的唯一真源，和其余七张图一致） |
| `../../js/geo_sh.js` | 投影后的地理数据（2.7 MB，由 `gen-geo.mjs` 生成） |
| `../../js/data_sh.js` | 场景数据（片区、地标、人口中心、历史事件与任务） |

## 数据要点

- **35 个片区**：按 OSM 的街道/镇边界分组（`streets` 匹配），带开放年份 —— 核心 12 区 1990 年就在，
  浦东各开发区 1993–2010，嘉定/松江/南汇的外围镇街 1995–2010。
- **28 个人口中心 / 34 个地标 / 37 处设施**：地标按落成年份出现（东方明珠 1994、金茂 1999、上海中心 2015、
  迪士尼 2016），火车站与机场带客流曲线。
- **道路与桥梁年份**：沪嘉 1988、内环高架 1994、延安高架 1999、外环 2002、中环 2006；
  越江设施从打浦路隧道（1971）、延安东路隧道（1989）到南浦（1991）、杨浦（1993）、卢浦（2003）与一批隧道。
  未列出的道路随所在片区开放。
- **13 条史实事件 + 7 条历史参考任务**：1 / 2 / 3 / 4 号线、8 号线与世博、10 号线与虹桥枢纽、11 号线与嘉定。
- 人口曲线取地图范围口径：1990 年 940 万 → 2020 年 2010 万（不是全市 2490 万，崇明与金山不在这张图里）。

## 已知差异

1. **起步就是堵的**：1990 年只有 3,781 个路网节点、两条越江隧道，市区密度又比广州高，
   实测车均速 14.4 km/h、拥堵 1.94（gz 1990 是 1.04）。这是史实方向，但对玩家偏硬。
2. **地价梯度 1.69×**（gz 3.32×）：与广州大图同一个毛病 —— 面积放大后核心与外围的密度差被摊平，
   TOD 溢价偏小。尚未标定。

## 验收

```bash
node scripts/build.mjs                        # 59 文件 / 8 图 / 0 警告
node scripts/map-source.mjs check             # 8/8
node scripts/validate-map.mjs                 # 8/8
node scripts/ground-check.mjs                 # 八图底图可绘制
node scripts/smoke.mjs --maps=sh --months=2   # 三模式，指纹 ca758850f9ab3bfd
node tools/month-breakdown.mjs sh --months=3  # 建局 4.3 s，月步进 1.8 s
node tools/preview-map.mjs sh out.ppm         # 底图预览（PPM）
```

## 重新生成

```bash
python tools/osm-cut.py --bbox 31.0000,121.2200,31.4330,121.8507 --out maps/_raw/sh \
  --proj 121.22,31.433,380.53,443.39          # 约 17 min，内存里只存 id 集合
node scripts/gen-geo.mjs --from maps/_raw/sh/features.geojson --map sh --w 240 --h 192 \
  --proj 121.22,31.433,380.53,443.39 --out js/geo_sh.js
python tools/_sh-source.py                    # 经纬度表 → maps/sh/source.json
node scripts/map-source.mjs build sh --in-place
node tools/preview-map.mjs sh out.ppm
```

`maps/_raw/` 是原始数据与切图产物，已在 `.gitignore` 里，不入库。
