# gz2 —— 广州大图（v2.6.0 起随包发布）

240×192 格 / 60×48 km / 2000 年 / 600 万人的广州，用 Geofabrik 的 `china-latest.osm.pbf`
切出来的一整张图。同一个 `gz` 的地理放大四倍，用来跑长线网与压力测试。

## 内容

| 文件 | 说明 |
| --- | --- |
| `source.json` | 地图源码（`scripts/map-source.mjs` 的唯一真源，和其他六张图一致） |
| `water_extra.wkt` | 水利专题面：两条 `狮子洋` 记录（主水面 + 北端补口），见下 |
| `../../js/geo_gz2.js` | 投影后的地理数据（2.95 MB，由 `gen-geo.mjs` 生成） |
| `../../js/data_gz2.js` | 场景数据（片区、地标、人口中心、历史事件） |

生成物和其余地图一样放在 `js/`，本目录只留源码。`js/manifest.js` 的 `MAP_MANIFEST` 里排在广州小图之后，
`index.html` 与 `scripts/*.mjs` 的资源清单都包含这两个文件。

## 验收

```bash
node scripts/build.mjs                          # 61 文件 / 9 图 / 0 警告
node scripts/map-source.mjs check               # 9/9
node scripts/validate-map.mjs --map gz2         # 几何 456,396 点，最大越界 5.0 格（那是 gen-geo 的 5 格余量）
node tools/map-check.mjs gz2                    # 开局可设站 27,915 格，历史任务 0 死局
node scripts/smoke.mjs --maps=gz2 --months=2    # 三模式 96274aff25912683 / b9be785ab1a6cf51 / 6b1872154e22a400
node tools/region-cells.mjs gz2                 # 32 个片区，0 个空片区
node tools/month-breakdown.mjs gz2 --months=4   # 建局 26 s，月步进 4.7–5.3 s
```

已知差异：地价梯度 1.91×（小图 gz 为 3.32×）。四倍面积把核心与外围的密度差摊平了，TOD 的溢价空间偏小，
尚未标定。

## 水面

OSM 在珠江下游只有中心线（`白坭水道`、`虎门水道`、`黄埔水道` 这些多半是 `waterway=river` 的线），
切出来狮子洋是零碎水面。`water_extra.wkt` 里两条 `狮子洋` 专题面（第二条是北端 113.50/23.05 那个补口，
2.7 km²）注进水面，实测水面 194 km²（引擎栅格口径，3,101 格）。

- 狮子洋那条 OSM 关系有 26/38 段成员在框外，接不成闭环 —— 现在用「整块接不上才首尾补环」兜住，
  缺口都在框边一带，补出来的就是被框线切断的多边形。日志里会列出所有靠补环闭合的关系，扫一眼就知道
  缺口在不在图内。
- 重切顺带修掉两块坏掉的区界：`南海区`（原来是个 0 km² 的空环）现在 359.5 km²，`顺德区` 从虚胖的
  216 km² 收到 104 km²，合起来正好是佛山片区的 464 km² / 7,416 格。

## 重新生成（需要原始 OSM）

```bash
python tools/osm-download.py                       # socks5 并行分片拉 china-latest.osm.pbf（1.5 GB）
python tools/osm-cut.py --bbox 22.90,113.08,23.34,113.68 --out maps/_raw/gz2 --proj 113.08,23.34,409.6,443 \
  --water-extra maps/gz2/water_extra.wkt      # 约 45 s（复用 area.osm.pbf；首次含裁剪约 17 min）
node scripts/gen-geo.mjs --from maps/_raw/gz2/features.geojson --map gz2 --w 240 --h 192 \
  --proj 113.08,23.34,409.6,443 --out js/geo_gz2.js
node scripts/map-source.mjs export --map gz2
node tools/preview-map.mjs gz2 out.ppm           # 不启浏览器的底图预览
```

`maps/_raw/` 是原始数据与切图产物，已在 `.gitignore` 里，不入库。
