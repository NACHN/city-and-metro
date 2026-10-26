"""预览：把地图 GeoJSON 画成一张 PNG，用来肉眼核对水域 / 路网 / 片区是否合理。

只画三层：水（蓝）、公园林地（绿）、道路按等级（灰 → 黄）。4 px 一格，240×192 的图就是 960×768。

    python tools/map-preview.py maps/_raw/gz2/features.geojson --bbox 22.90,113.08,23.34,113.68 \
        --out tools/_preview_gz2.png
"""

import argparse
import json

from PIL import Image, ImageDraw

LON0, LAT0 = 113.08, 23.34
KX, KY = 409.6, 443.0
W, H = 240, 192

ROAD_STYLE = [(1, (150, 150, 150), 1), (2, (120, 110, 90), 1), (3, (200, 160, 60), 2), (4, (230, 120, 40), 3)]


def px(lon, lat, s):
    return ((lon - LON0) * KX * s, (LAT0 - lat) * KY * s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("geojson")
    ap.add_argument("--out", default="tools/_preview.png")
    ap.add_argument("--scale", type=int, default=4)
    args = ap.parse_args()
    s = args.scale
    img = Image.new("RGB", (W * s, H * s), (246, 246, 242))
    dr = ImageDraw.Draw(img)
    data = json.load(open(args.geojson, encoding="utf-8"))
    feats = data["features"]

    # 先水，再绿地，最后路
    for f in feats:
        p, g = f["properties"], f["geometry"]
        if p["layer"] != "water" or g["type"] not in ("Polygon", "MultiPolygon"):
            continue
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            for i, ring in enumerate(poly):
                dr.polygon([px(*c, s) for c in ring], fill=(160, 200, 230) if i == 0 else (246, 246, 242))
    for f in feats:
        p, g = f["properties"], f["geometry"]
        if p["layer"] not in ("park", "wood") or g["type"] not in ("Polygon", "MultiPolygon"):
            continue
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            dr.polygon([px(*c, s) for c in poly[0]], fill=(206, 228, 200))
    # 水系折线（河宽按格）
    for f in feats:
        p, g = f["properties"], f["geometry"]
        if p["layer"] != "waterway" or g["type"] != "LineString":
            continue
        w = max(1, int(round(p.get("width", 1) * s)))
        dr.line([px(*c, s) for c in g["coordinates"]], fill=(150, 192, 224), width=w)
    for cls, col, wd in ROAD_STYLE:
        for f in feats:
            p, g = f["properties"], f["geometry"]
            if p["layer"] != "road" or p.get("class") != cls or g["type"] != "LineString":
                continue
            dr.line([px(*c, s) for c in g["coordinates"]], fill=col, width=wd)
    for f in feats:
        p, g = f["properties"], f["geometry"]
        if p["layer"] != "rail" or g["type"] != "LineString":
            continue
        dr.line([px(*c, s) for c in g["coordinates"]], fill=(80, 80, 80), width=1)
    img.save(args.out)
    print("->", args.out, img.size)


if __name__ == "__main__":
    main()
