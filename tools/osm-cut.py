"""china.osm.pbf → 某个 bbox 的 GeoJSON 素材（喂给 scripts/gen-geo.mjs）。

两步：
  1) 按 bbox 裁一份小的 .osm.pbf（节点 / 路 / 关系三个回调一趟走完，内存只存 id 集合）；
  2) 在小文件上分类打标，输出 gen-geo 契约要求的 properties：
     layer / name / class / flags / width / level / year。

为什么不用 osmium-tool：官方没有 Windows 二进制，pyosmium 已经有现成轮子。
为什么不用 Overpass：那是逐块排队，整省一次切下来本地跑是分钟级。

用法：
    python tools/osm-cut.py --bbox 22.92,113.10,23.34,113.70 --out maps/_raw/gz2
    python tools/osm-cut.py --bbox ... --out ... --stats-only
"""

import argparse
import json
import math
import os
import sys

import osmium

sys.setrecursionlimit(20000)   # RDP 在最坏情况下递归深度与顶点数同阶

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- 标签 → gen-geo 图层 / 等级 ------------------------------------------
# 快速路 4 / 主干道 3 / 次干道 2 / 支路 1（与 js/city.js 的道路等级一致）
ROAD_CLASS = {
    "motorway": 4, "motorway_link": 4, "trunk": 4, "trunk_link": 4,
    "primary": 3, "primary_link": 3,
    "secondary": 2, "secondary_link": 2,
    "tertiary": 1, "tertiary_link": 1, "residential": 1, "unclassified": 1,
    "living_street": 1, "service": 1, "road": 1,
}
# 步行网：决定 15 分钟步行接驳能不能走（geo.streets）
STREET_KINDS = {"footway", "path", "pedestrian", "steps", "cycleway", "bridleway", "corridor"}
RAIL_KINDS = {"rail", "subway", "light_rail", "monorail", "narrow_gauge", "tram"}
# 水系折线的默认宽度（格）。对照广州小图：真实折线多在 0.05–0.09 格（12–22 m）——
# 大江大河在 OSM 里是 natural=water 多边形，折线只负责窄河涌，所以这里不能按「河宽 600 m」给。
WATERWAY_DEFAULT_WIDTH = {"river": 0.09, "canal": 0.07, "stream": 0.05, "ditch": 0.03, "drain": 0.03}

PARK_KINDS = ("park", "garden", "playground", "recreation_ground", "common")
WOOD_LANDUSE = ("forest", "wood", "scrub", "meadow", "orchard")
WATER_LANDUSE = ("reservoir", "basin")


def road_flags(tags):
    """道路结构位：1 桥 / 2 隧道 / 4 匝道（与 js/city.js 的位运算一致）。"""
    f = 0
    if tags.get("bridge") and tags.get("bridge") != "no":
        f |= 1
    if tags.get("tunnel") and tags.get("tunnel") != "no":
        f |= 2
    if tags.get("highway", "").endswith("_link") or tags.get("junction") == "roundabout":
        f |= 4
    return f


def rail_flags(tags):
    """铁路位：2 地下 / 16 高速。"""
    f = 0
    if tags.get("tunnel") and tags.get("tunnel") != "no":
        f |= 2
    if tags.get("highspeed") in ("yes", "designated") or tags.get("railway") == "highspeed":
        f |= 16
    return f


def year_of(tags):
    raw = tags.get("start_date") or tags.get("opening_date") or ""
    for tok in "".join(c if c.isdigit() else " " for c in raw).split():
        if len(tok) == 4:
            y = int(tok)
            if 1850 <= y <= 2100:
                return y
    return None


def classify(tags):
    """返回 dict(layer=..., **props) 或 None。"""
    hw = tags.get("highway")
    if hw:
        if hw in ROAD_CLASS:
            return {"layer": "road", "class": ROAD_CLASS[hw]}
        if hw in STREET_KINDS:
            return {"layer": "street"}
        return None
    rail = tags.get("railway")
    if rail in RAIL_KINDS:
        return {"layer": "rail"}
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in WATER_LANDUSE:
        return {"layer": "water"}
    ww = tags.get("waterway")
    if ww in WATERWAY_DEFAULT_WIDTH:
        w = tags.get("width")
        try:
            w = float(str(w).replace("m", "").strip()) / 250.0 if w else None
        except ValueError:
            w = None
        w = min(max(w or WATERWAY_DEFAULT_WIDTH[ww], 0.02), 1.2)   # 标签给的宽度也夹住，避免单个错标把整张图淹掉
        return {"layer": "waterway", "width": round(w, 3)}
    if tags.get("leisure") in PARK_KINDS:
        return {"layer": "park"}
    if tags.get("landuse") == "recreation_ground":
        return {"layer": "park"}
    if tags.get("leisure") == "nature_reserve" or tags.get("boundary") == "protected_area":
        return {"layer": "reserve"}
    if tags.get("landuse") in WOOD_LANDUSE or tags.get("natural") in ("wood", "scrub"):
        return {"layer": "wood"}
    if tags.get("boundary") == "administrative":
        lvl = tags.get("admin_level")
        if lvl and lvl.isdigit() and 6 <= int(lvl) <= 9:
            return {"layer": "admin", "level": int(lvl)}
        return None
    return None


# ---- 第一步：裁 bbox -------------------------------------------------------

class Cutter(osmium.SimpleHandler):
    """一趟走完三个回调：PBF 中节点、路、关系的顺序天然满足依赖。"""

    def __init__(self, bbox, writer):
        super().__init__()
        self.s, self.w_, self.n, self.e = bbox
        self.writer = writer
        self.node_ids = set()
        self.way_ids = set()
        self.count = {"node": 0, "way": 0, "relation": 0}

    def inside(self, loc):
        return self.s <= loc.lat <= self.n and self.w_ <= loc.lon <= self.e

    def node(self, n):
        if self.inside(n.location):
            self.node_ids.add(n.id)
            self.writer.add_node(n)
            self.count["node"] += 1
            if self.count["node"] % 2000000 == 0:
                print("  已收 %d 万节点…" % (self.count["node"] // 10000), flush=True)

    def way(self, w):
        if any(n.ref in self.node_ids for n in w.nodes):
            self.way_ids.add(w.id)
            self.writer.add_way(w)
            self.count["way"] += 1

    def relation(self, r):
        if any(m.type == "w" and m.ref in self.way_ids for m in r.members):
            self.writer.add_relation(r)
            self.count["relation"] += 1


def cut(pbf, bbox, dest):
    writer = osmium.SimpleWriter(dest)
    cutter = Cutter(bbox, writer)
    try:
        cutter.apply_file(pbf)
    finally:
        writer.close()
    print("裁剪：%s -> %s（%s）" % (pbf, dest, cutter.count))
    return cutter.count


# ---- 第二步：分类出 GeoJSON ----------------------------------------------

def ring_area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return a / 2.0


# ---- 几何简化 --------------------------------------------------------------
# 编码精度是 1/64 格（3.9 m），但 250 m 一格的地图上，顶点密到 20 m 一个纯属浪费：
# geo 文件体积几乎等于顶点数，而玩家看不到差别。0.18 格 ≈ 45 m 的容差足够。
SIMPLIFY_TOL = 0.18


def _dp(pts, lo, hi, tol, keep):
    """Ramer–Douglas–Peucker，只记录保留的下标。"""
    ax, ay = pts[lo]
    bx, by = pts[hi]
    dx, dy = bx - ax, by - ay
    den = dx * dx + dy * dy
    far, idx = -1.0, -1
    for i in range(lo + 1, hi):
        px, py = pts[i]
        if den == 0:
            d = math.hypot(px - ax, py - ay)
        else:
            t = ((px - ax) * dx + (py - ay) * dy) / den
            t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if d > far:
            far, idx = d, i
    if far > tol and idx > 0:
        _dp(pts, lo, idx, tol, keep)
        keep[idx] = True
        _dp(pts, idx, hi, tol, keep)


def simplify(pts, tol=SIMPLIFY_TOL):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    _dp(pts, 0, len(pts) - 1, tol, keep)
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(ring, tol=SIMPLIFY_TOL):
    """闭合环：拆成两段分别简化，保证首尾仍是同一个点。"""
    if len(ring) < 5:
        return ring
    closed = ring[0] == ring[-1]
    body = ring[:-1] if closed else ring[:]
    if not body:
        return ring
    mid = len(body) // 2
    a = simplify(body[:mid + 1], tol)
    b = simplify(body[mid:] + [body[0]], tol)
    out = a[:-1] + b
    if closed and out[0] != out[-1]:
        out.append(out[0])
    return out


def join_rings(lines):
    """把 relation 的 outer/inner 线段接成闭合环。端点完全重合才算接上（OSM 里同一节点坐标一致）。"""
    lines = [list(l) for l in lines if len(l) >= 2]
    rings = []
    while lines:
        cur = lines.pop()
        grew = True
        while grew and cur[0] != cur[-1]:
            grew = False
            for i, other in enumerate(lines):
                if other[0] == cur[-1]:
                    cur = cur + other[1:]
                elif other[-1] == cur[-1]:
                    cur = cur + other[::-1][1:]
                elif other[-1] == cur[0]:
                    cur = other + cur[1:]
                elif other[0] == cur[0]:
                    cur = other[::-1] + cur[1:]
                else:
                    continue
                lines.pop(i)
                grew = True
                break
        if len(cur) >= 4 and cur[0] == cur[-1]:
            rings.append(cur)
    return rings


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


class Collector(osmium.SimpleHandler):
    """在小文件上分类；关系多边形用成员路的坐标现拼（不依赖 area 索引，内存可控）。"""

    def __init__(self, wanted_way_ids=None):
        super().__init__()
        self.features = []
        self.wanted = wanted_way_ids or set()   # 需要留坐标的关系成员路
        self.way_geom = {}
        self.rels = []                          # (tags, [(role, way_id)])
        self.stats = {}
        self.missing_loc = 0

    def _tags(self, tags):
        return {t.k: t.v for t in tags}

    def node(self, n):
        tags = self._tags(n.tags)
        # 地名表既要给地图标注用，也是 data 文件里 at('北京路', …) 这类锚点的定位依据。
        # 广州小图的地名表就包含地铁站与铁路站（北京路、陈家祠、体育西路都是站名），
        # 所以这里不能只收 place=*，否则引用这些名字的锚点会全部退回手写坐标。
        if not tags.get("name"):
            return
        if (tags.get("place") or tags.get("railway") in ("station", "halt", "tram_stop", "stop")
                or tags.get("public_transport") == "station"):
            self._add({"layer": "place"}, tags, {"type": "Point", "coordinates": [n.location.lon, n.location.lat]})

    def way(self, w):
        tags = self._tags(w.tags)
        cls = classify(tags)
        keep_geo = w.id in self.wanted
        if not cls and not keep_geo:
            return
        try:
            pts = [[n.lon, n.lat] for n in w.nodes if n.location.valid()]
        except Exception:  # noqa: BLE001 - 跨边界的路会缺节点坐标，丢掉那一段即可
            pts = []
            for n in w.nodes:
                try:
                    pts.append([n.location.lon, n.location.lat])
                except Exception:  # noqa: BLE001
                    self.missing_loc += 1
        if len(pts) < 2:
            return
        if keep_geo:
            self.way_geom[w.id] = pts
        if not cls:
            return
        layer = cls["layer"]
        if layer in ("road", "rail", "street", "waterway"):
            geom = {"type": "LineString", "coordinates": simplify(pts)}
        else:
            closed = pts[0] == pts[-1] and len(pts) >= 4
            if not closed:
                return
            ring = simplify_ring(pts)
            if len(ring) < 4:   # 小多边形（矩形湖面等）简化后会退化成两条线，退回原环
                ring = pts
            geom = {"type": "Polygon", "coordinates": [ring]}
        self._add(cls, tags, geom)

    def relation(self, r):
        tags = self._tags(r.tags)
        cls = classify(tags)
        if not cls or cls["layer"] in ("road", "street", "rail", "waterway", "place"):
            return
        self.rels.append((cls, tags, [(m.role, m.ref) for m in r.members if m.type == "w"]))

    def _add(self, cls, tags, geom):
        props = {"layer": cls["layer"], "name": tags.get("name", ""), "osm_id": ""}
        props.update({k: v for k, v in cls.items() if k != "layer"})
        # 原始类型留一份：调试与后续按类型裁剪（体积）时都要用
        props["kind"] = (tags.get("highway") or tags.get("railway") or tags.get("waterway")
                         or tags.get("leisure") or tags.get("landuse") or tags.get("natural") or "")
        hw = tags.get("highway", "")
        if cls["layer"] == "road":
            props["flags"] = road_flags(tags)
            props["name"] = tags.get("name") or tags.get("name:zh") or ""
        elif cls["layer"] == "rail":
            props["flags"] = rail_flags(tags)
            y = year_of(tags)
            if y:
                props["year"] = y
        if tags.get("name:zh"):
            props["name"] = tags["name:zh"]
        self.features.append({"type": "Feature", "geometry": geom, "properties": props})
        self.stats[cls["layer"]] = self.stats.get(cls["layer"], 0) + 1


def collect(area_pbf, dest_geojson):
    # 第一趟只为了知道「哪些路是关系多边形的成员」
    wanted = set()

    class Want(osmium.SimpleHandler):
        def relation(self, r):
            cls = classify({t.k: t.v for t in r.tags})
            if cls and cls["layer"] in ("water", "park", "wood", "reserve", "admin"):
                for m in r.members:
                    if m.type == "w":
                        wanted.add(m.ref)

    Want().apply_file(area_pbf, locations=False)
    print("关系成员路 %d 条" % len(wanted))

    col = Collector(wanted)
    col.apply_file(area_pbf, locations=True)

    # 关系多边形：先用成员路坐标拼环，再按外环面积排序、内环归到包含它的外环里
    poly = 0
    for cls, tags, members in col.rels:
        outers = join_rings([col.way_geom[r] for role, r in members if role != "inner" and r in col.way_geom])
        inners = join_rings([col.way_geom[r] for role, r in members if role == "inner" and r in col.way_geom])
        if not outers:
            continue
        polys = []
        for o in outers:
            so = simplify_ring(o)
            if len(so) < 4:
                so = o
            holes = []
            for h in inners:
                if not point_in_ring(h[0], o):
                    continue
                sh = simplify_ring(h)
                holes.append(sh if len(sh) >= 4 else h)
            polys.append([so] + holes)
        geom = ({"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1
                else {"type": "MultiPolygon", "coordinates": polys})
        props = {"layer": cls["layer"], "name": tags.get("name", "") or tags.get("name:zh", ""),
                 "osm_id": "relation"}
        props.update({k: v for k, v in cls.items() if k != "layer"})
        col.features.append({"type": "Feature", "geometry": geom, "properties": props})
        col.stats[cls["layer"] + "(relation)"] = col.stats.get(cls["layer"] + "(relation)", 0) + 1
        poly += 1

    with open(dest_geojson, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": col.features}, fh, ensure_ascii=False)
    print("要素 %d（其中关系多边形 %d），缺坐标点 %d" % (len(col.features), poly, col.missing_loc))
    print("层：" + " · ".join("%s %d" % (k, v) for k, v in sorted(col.stats.items())))
    print("-> %s (%.1f MB)" % (dest_geojson, os.path.getsize(dest_geojson) / 1048576.0))
    return col.stats


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", default=os.path.join(ROOT, "maps", "_raw", "china.osm.pbf"))
    ap.add_argument("--bbox", required=True, help="south,west,north,east")
    ap.add_argument("--out", required=True)
    ap.add_argument("--stats-only", action="store_true")
    args = ap.parse_args(argv[1:])
    bbox = tuple(float(v) for v in args.bbox.split(","))
    os.makedirs(args.out, exist_ok=True)
    area = os.path.join(args.out, "area.osm.pbf")
    if not os.path.exists(area):
        cut(args.pbf, bbox, area)
    else:
        print("复用已有裁剪结果 %s" % area)
    if args.stats_only:
        return 0
    collect(area, os.path.join(args.out, "features.geojson"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
