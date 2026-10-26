"""线形核对：原始 OSM 折线 vs 游戏 geo_<id>.js 解码出来的折线（按道路名配对）。

    node tools/_dump-roads.mjs gz2 > maps/_raw/gz2/_game_roads.json
    python tools/geom-check.py

输出每个名字的最大偏离（格 / 米）、顶点数对比，以及一张放大叠加图（红=原始，蓝=游戏）。
"""

import json
import math
import sys

import osmium
from PIL import Image, ImageDraw

LON0, LAT0, KX, KY = 113.08, 23.34, 409.6, 443.0
WIN = (60, 130, 75, 110)      # x0, x1, y0, y1（格），叠加图范围
CLS = {"motorway": 4, "trunk": 4, "primary": 3, "secondary": 2, "tertiary": 2,
       "residential": 1, "unclassified": 1, "living_street": 1}


def proj(lon, lat):
    return ((lon - LON0) * KX, (LAT0 - lat) * KY)


def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dy * dy
    t = 0 if L == 0 else ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L
    t = max(0.0, min(1.0, t))
    return math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1])


def one_way(a, b):
    """a 的每个点到 b 折线的最短距离，取最大。"""
    worst = 0.0
    for q in a:
        best = 1e9
        for i in range(len(b) - 1):
            d = seg_dist(q, b[i], b[i + 1])
            if d < best:
                best = d
        worst = max(worst, best)
    return worst


class Raw(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.by_name = {}

    def way(self, w):
        t = {x.k: x.v for x in w.tags}
        cls = CLS.get(t.get("highway", ""))
        name = t.get("name", "")
        if not cls or not name:
            return
        pts = []
        try:
            for n in w.nodes:
                if n.location.valid():
                    pts.append(proj(n.location.lon, n.location.lat))
        except Exception:  # noqa: BLE001
            return
        if len(pts) >= 2:
            self.by_name.setdefault(name, []).append(pts)


def main():
    game = json.load(open("maps/_raw/gz2/_game_roads.json", encoding="utf-8"))
    raw = Raw()
    raw.apply_file("maps/_raw/gz2/area.osm.pbf", locations=True)

    rows = []
    for g in game:
        name = g["n"]
        src = raw.by_name.get(name)
        if not src:
            rows.append((name, g["c"], len(g["p"]) // 2, 0, None))
            continue
        pts = [(g["p"][i], g["p"][i + 1]) for i in range(0, len(g["p"]), 2)]
        # 原始折线可能被切成多段：取与之最接近的那一段做逐点距离
        d = min(one_way(pts, s) for s in src if len(s) > 1)
        d2 = min(one_way(s, pts) for s in src if len(s) > 1)
        rows.append((name, g["c"], len(g["p"]) // 2, sum(len(s) for s in src), max(d, d2)))

    named = [r for r in rows if r[4] is not None]
    named.sort(key=lambda r: -r[4])
    print("配对 %d / %d 条（游戏侧带名字且有原始折线）" % (len(named), len(rows)))
    print("最大偏离（格 / 米）：")
    for r in named[:12]:
        print("  %-14s 等级%d 游戏%2d 点 原始%3d 点  偏离 %.2f 格 / %.0f m"
              % (r[0][:14], r[1], r[2], r[3], r[4], r[4] * 250))
    if named:
        import statistics
        med = statistics.median([r[4] for r in named])
        print("中位偏离 %.2f 格（%.0f m）· 90 分位 %.2f 格"
              % (med, med * 250, sorted(r[4] for r in named)[int(len(named) * 0.9)]))

    # 放大叠加图
    S = 8
    W = (WIN[1] - WIN[0]) * S
    H = (WIN[3] - WIN[2]) * S
    img = Image.new("RGB", (W, H), (255, 255, 255))
    dr = ImageDraw.Draw(img)

    def px(p):
        return ((p[0] - WIN[0]) * S, (p[1] - WIN[2]) * S)

    def vis(p):
        return WIN[0] - 1 <= p[0] <= WIN[1] + 1 and WIN[2] - 1 <= p[1] <= WIN[3] + 1

    for name, segs in raw.by_name.items():
        for s in segs:
            if not any(vis(q) for q in s):
                continue
            dr.line([px(q) for q in s], fill=(235, 140, 140), width=2)
    for g in game:
        pts = [(g["p"][i], g["p"][i + 1]) for i in range(0, len(g["p"]), 2)]
        dr.line([px(q) for q in pts], fill=(70, 100, 225), width=1)
    img.save("tools/_geom_gz2.png")
    print("-> tools/_geom_gz2.png")


if __name__ == "__main__":
    sys.exit(main())
