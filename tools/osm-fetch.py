"""把 OSM 数据拉成本地 GeoJSON 素材（新地图的原始输入）。

为什么不用 QuickOSM：它走的是同一个 Overpass 端点，但一次一个图层、失败就弹框，
没法断点续传。这里按图块切分、逐块重试、结果落盘缓存，跑一半断了可以接着跑。

Overpass 这个公共实例经常「所有 worker 都忙」，返回的是它自己的 502（不是网络不通），
所以退避重试是正常路径，不是兜底。

用法：
    python tools/osm-fetch.py --probe            单块试跑，打印耗时与体积
    python tools/osm-fetch.py --bbox 22.90,113.10,23.35,113.71 --tiles 4x3
    python tools/osm-fetch.py --merge            把已下载的图块合成一份 per-layer 的 GeoJSON
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "maps", "_raw")
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
UA = "city-and-metro-mapbuild/1.0 (offline game map authoring)"

# 图层选择器：与 scripts/gen-geo.mjs 的输入契约对齐（layer 名在 map_tags 里给出）
SELECTORS = [
    'way["highway"]',
    'way["railway"~"^(rail|subway|light_rail|monorail|narrow_gauge|construction)$"]',
    'way["natural"="water"]',
    'relation["natural"="water"]',
    'way["waterway"~"^(river|canal|stream|riverbank)$"]',
    'relation["waterway"="riverbank"]',
    'way["leisure"~"^(park|garden|nature_reserve)$"]',
    'way["landuse"~"^(forest|wood|grass|recreation_ground|meadow|farmland|reservoir)$"]',
    'relation["landuse"="forest"]',
    'way["natural"~"^(wood|scrub|wetland|beach|sand)$"]',
    'way["boundary"="administrative"]',
    'relation["boundary"="administrative"]["admin_level"~"^(6|7|8|9)$"]',
    'node["place"~"^(city|town|suburb|village|neighbourhood|quarter)$"]',
]

QUERY = """[out:json][timeout:{timeout}];
(
{body}
);
out geom;"""


def build_query(bbox, timeout=300):
    b = ",".join("%.6f" % v for v in bbox)  # south,west,north,east
    body = "\n".join('  %s(%s);' % (s, b) for s in SELECTORS)
    return QUERY.format(timeout=timeout, body=body)


def post(query, timeout=320, tries=8, debug=True):
    """POST 到 Overpass，指数退避重试；返回解析后的 JSON。"""
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 直连，绕开编辑器代理
    last = None
    for i in range(tries):
        t0 = time.time()
        try:
            req = urllib.request.Request(ENDPOINTS[i % len(ENDPOINTS)], data=body,
                                         headers={"User-Agent": UA})
            raw = opener.open(req, timeout=timeout).read()
            if debug:
                print("    ok in %.1fs, %.1f MB" % (time.time() - t0, len(raw) / 1048576.0))
            return json.loads(raw)
        except Exception as exc:  # noqa: BLE001 - 任何失败都按「稍后再试」处理
            last = exc
            wait = min(2 ** (i + 1), 40)
            if debug:
                print("    retry %d/%d: %s: %s (sleep %ds)"
                      % (i + 1, tries, type(exc).__name__, str(exc)[:70], wait))
            time.sleep(wait)
    raise RuntimeError("Overpass 连续 %d 次失败：%s" % (tries, last))


def tile_grid(bbox, cols, rows):
    """把 bbox 切成 cols×rows 块，返回 [(name, (s,w,n,e))]。"""
    s, w, n, e = bbox
    dy, dx = (n - s) / rows, (e - w) / cols
    out = []
    for r in range(rows):
        for c in range(cols):
            tb = (s + r * dy, w + c * dx, s + (r + 1) * dy, w + (c + 1) * dx)
            out.append(("%d_%d" % (r, c), tuple(round(v, 6) for v in tb)))
    return out


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", help="south,west,north,east")
    ap.add_argument("--tiles", default="4x3")
    ap.add_argument("--probe", action="store_true", help="只跑第一块，看耗时与体积")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args(argv[1:])

    if args.merge:
        return merge(args.out)
    if not args.bbox:
        ap.error("需要 --bbox 或 --merge")

    bbox = tuple(float(v) for v in args.bbox.split(","))
    cols, rows = (int(v) for v in args.tiles.lower().split("x"))
    os.makedirs(args.out, exist_ok=True)
    tiles = tile_grid(bbox, cols, rows)[:1] if args.probe else tile_grid(bbox, cols, rows)
    print("图块 %d 个，范围 %s" % (len(tiles), bbox))
    for name, tb in tiles:
        dest = os.path.join(args.out, "tile-%s.json" % name)
        if os.path.exists(dest) and not args.probe:
            print("  [%s] 已有缓存 %.1f MB" % (name, os.path.getsize(dest) / 1048576.0))
            continue
        print("  [%s] %s" % (name, tb))
        data = post(build_query(tb))
        with open(dest, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        print("    -> %d elements" % len(data.get("elements", [])))
    return 0


def tag_layer(tags):
    """把 OSM 标签映射到 gen-geo 的 layer。返回 None 表示不要。"""
    if "highway" in tags:
        return "road"
    if "railway" in tags:
        return "rail"
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") == "reservoir":
        return "water"
    if "waterway" in tags:
        return "waterway"
    if tags.get("leisure") in ("park", "garden") or tags.get("leisure") == "nature_reserve":
        return "park" if tags.get("leisure") != "nature_reserve" else "reserve"
    if tags.get("landuse") in ("forest", "wood") or tags.get("natural") in ("wood", "scrub", "wetland"):
        return "wood"
    if tags.get("landuse") in ("grass", "recreation_ground", "meadow", "farmland"):
        return "park"
    if tags.get("boundary") == "administrative":
        return "admin"
    if tags.get("place"):
        return "place"
    return None


def merge(out_dir):
    """把图块合成 per-layer 的 GeoJSON（WGS84，坐标为经纬度）。"""
    layers = {}
    files = sorted(f for f in os.listdir(out_dir) if f.startswith("tile-") and f.endswith(".json"))
    if not files:
        print("没有可合并的图块")
        return 1
    for fn in files:
        with open(os.path.join(out_dir, fn), encoding="utf-8") as fh:
            data = json.load(fh)
        for el in data.get("elements", []):
            tags = el.get("tags") or {}
            layer = tag_layer(tags)
            if not layer:
                continue
            if el["type"] == "node":
                if layer != "place":
                    continue
                geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
            elif el["type"] == "way":
                pts = [[p["lon"], p["lat"]] for p in el.get("geometry") or [] if p]
                if len(pts) < 2:
                    continue
                closed = pts[0] == pts[-1]
                kind = "Polygon" if closed and layer in ("water", "park", "wood", "reserve", "admin") else "LineString"
                geom = {"type": kind, "coordinates": [pts] if kind == "Polygon" else pts}
            else:
                continue  # 关系几何留给第二轮处理
            props = dict(tags)
            props["layer"] = layer
            props["osm_id"] = "%s/%s" % (el["type"], el["id"])
            layers.setdefault(layer, []).append({"type": "Feature", "geometry": geom, "properties": props})
    for layer, feats in sorted(layers.items()):
        dest = os.path.join(out_dir, "layer-%s.geojson" % layer)
        with open(dest, "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "features": feats}, fh, ensure_ascii=False)
        print("%-10s %6d 要素  %.1f MB" % (layer, len(feats), os.path.getsize(dest) / 1048576.0))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
