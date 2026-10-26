# gz2 —— 广州大图（未发布，已停放）

240×192 格 / 60×48 km / 2000 年 / 600 万人的广州，用 Geofabrik 的 `china-latest.osm.pbf`
切出来的一整张图。数据与代码都已验证可用（smoke、validate、ground-check 全过），但**这一版不随包发布**，
所以生成物被挪到这里，`js/` 里没有它们，`dist` 里也不会出现。

## 内容

| 文件 | 说明 |
| --- | --- |
| `source.json` | 地图源码（`scripts/map-source.mjs` 的唯一真源，和六张小图一致） |
| `parked/geo_gz2.js` | 投影后的地理数据（2.95 MB，由 `gen-geo.mjs` 生成） |
| `parked/data_gz2.js` | 场景数据（片区、地标、人口中心、历史事件） |

## 启用步骤

1. 把 `parked/geo_gz2.js`、`parked/data_gz2.js` 移回 `js/`；
2. `js/manifest.js` 里取消 `{ id: 'gz2', … }` 那一行的注释；
3. `index.html` 里恢复 `<script src="js/geo_gz2.js">` 与 `<script src="js/data_gz2.js">`（顺序：geo → data）；
4. `scripts/*.mjs` 的资源清单里加回这两个文件（`grep -l "js/data_gz.js" scripts/*.mjs` 可列出全部 14 个）；
5. 跑 `node scripts/build.mjs && node scripts/ground-check.mjs && node scripts/validate-map.mjs --map gz2`。

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
