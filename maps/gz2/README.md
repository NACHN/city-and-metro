# gz2 —— 广州大图（v2.6.0 起随包发布）

240×192 格 / 60×48 km / 2000 年 / 600 万人的广州，用 Geofabrik 的 `china-latest.osm.pbf`
切出来的一整张图。同一个 `gz` 的地理放大四倍，用来跑长线网与压力测试。

## 内容

| 文件 | 说明 |
| --- | --- |
| `source.json` | 地图源码（`scripts/map-source.mjs` 的唯一真源，和其他六张图一致） |
| `../../js/geo_gz2.js` | 投影后的地理数据（2.95 MB，由 `gen-geo.mjs` 生成） |
| `../../js/data_gz2.js` | 场景数据（片区、地标、人口中心、历史事件） |

生成物和其余地图一样放在 `js/`，本目录只留源码。`js/manifest.js` 的 `MAP_MANIFEST` 里排在广州小图之后，
`index.html` 与 `scripts/*.mjs` 的资源清单都包含这两个文件。

## 验收

```bash
node scripts/build.mjs                          # 57 文件 / 7 图 / 0 警告
node scripts/map-source.mjs check               # 7/7
node scripts/validate-map.mjs                   # 7/7
node scripts/ground-check.mjs                   # 七图底图可绘制
node scripts/smoke.mjs --maps=gz2 --months=2    # 三模式，指纹 9ad533a67baacf4c
node tools/month-breakdown.mjs gz2 --months=4   # 建局 26 s，月步进 4.7–5.3 s
```

已知差异：地价梯度 1.87×（小图 gz 为 3.32×）。四倍面积把核心与外围的密度差摊平了，TOD 的溢价空间偏小，
尚未标定。

## 重新生成（需要原始 OSM）

```bash
python tools/osm-download.py                       # socks5 并行分片拉 china-latest.osm.pbf（1.5 GB）
python tools/osm-cut.py --bbox 22.90,113.08,23.34,113.68 --out maps/_raw/gz2 --proj 113.08,23.34,409.6,443
node scripts/gen-geo.mjs --from maps/_raw/gz2/features.geojson --map gz2 --w 240 --h 192 \
  --proj 113.08,23.34,409.6,443 --out js/geo_gz2.js
node scripts/map-source.mjs export --map gz2
node tools/preview-map.mjs gz2 out.ppm           # 不启浏览器的底图预览
```

`maps/_raw/` 是原始数据与切图产物，已在 `.gitignore` 里，不入库。
