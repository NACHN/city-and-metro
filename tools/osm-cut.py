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
    "secondary": 2, "secondary_link": 2, "tertiary": 2, "tertiary_link": 2,
    "residential": 1, "unclassified": 1, "living_street": 1, "road": 1,
}
# 250 m 一格下没意义的道路：厂区/小区内部车道、停车位通道、机耕道。数量巨大（广州图上 1.7 万条），
# 既画不出来也改变不了拓扑，直接丢掉。
ROAD_DROP = {"service", "track", "driveway", "parking_aisle", "raceway", "busway"}
# 步行网：决定 15 分钟步行接驳能不能走（geo.streets）
STREET_KINDS = {"footway", "path", "pedestrian", "steps", "cycleway", "bridleway", "corridor"}
RAIL_KINDS = {"rail", "subway", "light_rail", "monorail", "narrow_gauge", "tram"}
# 水系折线的默认宽度（格）。对照广州小图：真实折线多在 0.04–0.09 格（10–22 m）——
# 大江大河在 OSM 里是 natural=water 多边形，折线只负责窄河涌，所以这里不能按「河宽 600 m」给。
WATERWAY_DEFAULT_WIDTH = {"river": 0.09, "canal": 0.07, "stream": 0.04, "ditch": 0.02, "drain": 0.02}

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
        if hw in ROAD_DROP:
            return None
        if hw in STREET_KINDS:
            return {"layer": "street"}
        return None
    rail = tags.get("railway")
    if rail in RAIL_KINDS:
        return {"layer": "rail"}
    if tags.get("natural") == "coastline":
        # 海岸线不是水面，是一条「水在左侧」的线。以前没有这个分支，整条丢，
        # 于是上海的长江口、杭州湾、南汇东滩这些靠海岸线界定的海面全都不存在。
        return {"layer": "coastline"}
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in WATER_LANDUSE:
        return {"layer": "water"}
    ww = tags.get("waterway")
    if ww in WATERWAY_DEFAULT_WIDTH:
        w = None
        raw = tags.get("width")
        if raw:
            try:
                w = float(str(raw).replace("m", "").strip()) / 250.0
            except ValueError:
                w = None
        if w is None:
            # OSM 里珠江下游的分汊（白坭水道、虎门水道、黄埔水道…）大多是 waterway=river 的**线**，
            # 没有 width 标签，但打着 ship/boat 通航标记 —— 按通航等级给宽度，才不至于把珠江画成发丝。
            if tags.get("ship") == "yes":
                w = 2.4      # 600 m，可通海轮的主航道
            elif tags.get("boat") == "yes":
                w = 0.8      # 200 m，可通内河船
            else:
                w = WATERWAY_DEFAULT_WIDTH[ww]
        w = min(max(w, 0.02), 12.0)   # 上限 3 km，避免单个错标把整张图淹掉
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

class IdScan(osmium.SimpleHandler):
    """第 1 趟：只收集 id，不写文件。

    为什么不能边扫边写：跨边界的水面是一个 relation，外环由几十段路拼成。
    以前「路只要有一个节点在框内就收、节点只收框内的」—— 框外那半圈路整条丢掉，
    框内的路被截断到边界，环永远合不拢，join_rings 返回空，整块水面静默消失。
    狮子洋就是这么丢的：38 段成员只剩 12 段。
    """

    def __init__(self, bbox):
        super().__init__()
        self.s, self.w_, self.n, self.e = bbox
        self.node_ids = set()
        self.way_ids = set()
        self.rel_ids = set()
        self.member_ways = set()
        self.count = {"node": 0, "way": 0, "relation": 0}

    def inside(self, loc):
        return self.s <= loc.lat <= self.n and self.w_ <= loc.lon <= self.e

    def node(self, n):
        if self.inside(n.location):
            self.node_ids.add(n.id)
            self.count["node"] += 1

    def way(self, w):
        if any(n.ref in self.node_ids for n in w.nodes):
            self.way_ids.add(w.id)
            self.count["way"] += 1

    def relation(self, r):
        mem = [m.ref for m in r.members if m.type == "w"]
        if any(m in self.way_ids for m in mem):
            self.rel_ids.add(r.id)
            # 只对「面状关系」补全成员：公交/地铁 route 关系有上百段成员，补全了也没人用
            if r.tags.get("type") in ("multipolygon", "boundary"):
                self.member_ways.update(mem)
            self.count["relation"] += 1


class WayRefScan(osmium.SimpleHandler):
    """第 2 趟：把要保留的关系的成员路的全部节点 id 捞出来。"""

    def __init__(self, want):
        super().__init__()
        self.want = want
        self.nodes = set()

    def way(self, w):
        if w.id in self.want:
            self.nodes.update(n.ref for n in w.nodes)


class Writer(osmium.SimpleHandler):
    """第 3 趟：写。节点必须排在路前面，所以只能最后一遍。"""

    def __init__(self, writer, node_ids, way_ids, rel_ids):
        super().__init__()
        self.writer = writer
        self.node_ids = node_ids
        self.way_ids = way_ids
        self.rel_ids = rel_ids
        self.count = {"node": 0, "way": 0, "relation": 0}

    def node(self, n):
        if n.id in self.node_ids:
            self.writer.add_node(n)
            self.count["node"] += 1

    def way(self, w):
        if w.id in self.way_ids:
            self.writer.add_way(w)
            self.count["way"] += 1

    def relation(self, r):
        if r.id in self.rel_ids:
            self.writer.add_relation(r)
            self.count["relation"] += 1


def cut(pbf, bbox, dest):
    scan = IdScan(bbox)
    scan.apply_file(pbf)
    # 关系成员路整条保留（哪怕全在框外），否则跨边界的水面环合不拢
    keep_ways = set(scan.way_ids) | scan.member_ways
    extra = scan.member_ways - scan.way_ids
    need_nodes = set()
    if extra:
        wc = WayRefScan(scan.member_ways)
        wc.apply_file(pbf)
        need_nodes = wc.nodes - scan.node_ids
    writer = osmium.SimpleWriter(dest)
    try:
        wr = Writer(writer, scan.node_ids | need_nodes, keep_ways, scan.rel_ids)
        wr.apply_file(pbf)
    finally:
        writer.close()
    print("裁剪：%s -> %s（节点 %d+%d，路 %d+%d，关系 %d）"
          % (pbf, dest, scan.count["node"], len(need_nodes),
             scan.count["way"], len(extra), scan.count["relation"]))
    return wr.count
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

# 分级容差（格）。250 m 一格、1/64 格编码的前提下：
#   主干道/快速路 0.025（6 m，约 1.5 倍编码精度）—— 内环、快速路的弯道放大了也要是弧，不能是折线；
#   次干道 0.08（20 m）· 支路 0.12（30 m）—— 远景才看；
#   水面岸线 0.10（25 m）—— 珠江岸线是玩家最容易看出"棱角"的地方；
#   公园林地 0.25（60 m）—— 本来就成片。
TOL_BY_ROAD_CLASS = {4: 0.025, 3: 0.025, 2: 0.08, 1: 0.12}
TOL_LAYER = {"water": 0.08, "waterway": 0.08, "park": 0.25, "wood": 0.25, "reserve": 0.25, "admin": 0.10, "street": 0.20}

# 投影：OSM 是经纬度，容差是「格」。**简化必须在格坐标里做**——
# 早期版本直接对经纬度跑 RDP，0.025 就变成了 0.025° ≈ 2.8 km，
# 于是每条路都被压成两个点（笔直的弦），内环路的弯道全成了折线。
PROJ = {"lon0": 113.08, "lat0": 23.34, "kx": 409.6, "ky": 443.0}


def to_cells(pts):
    p = PROJ
    return [((q[0] - p["lon0"]) * p["kx"], (p["lat0"] - q[1]) * p["ky"]) for q in pts]


def to_lonlat(xy):
    p = PROJ
    return [[round(p["lon0"] + q[0] / p["kx"], 6), round(p["lat0"] - q[1] / p["ky"], 6)] for q in xy]


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


def join_rings(lines, close_open=False):
    """把 relation 的 outer/inner 线段接成闭合环。端点完全重合才算接上（OSM 里同一节点坐标一致）。

    `close_open`：接不上的开口链要不要把首尾直接连起来当成环。街区/行政边界这类关系
    常常有一部分在框外，成员路根本不在裁剪出来的小 pbf 里，接不上就整块丢掉 —— 结果
    是贴在边缘的镇（安亭、佘山、大团……）没有边界，格子掉进「外围地区」。真实的多边形
    本来就该被框线切断，用首尾连线补上比丢掉更接近事实（缺口都在框边一带）。
    水面不开这个开关：开口的水面连起来会凭空合出一片湖。
    """
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
        elif close_open and len(cur) >= 4:
            rings.append(cur + [cur[0]])
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
        self.water_raw = []                     # (名字, [环, ...])：原始坐标，合并完再简化
        self.coast_raw = []                     # 海岸线折线（经纬度），用来拼海面
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
        if layer == "road":
            tol = TOL_BY_ROAD_CLASS.get(cls.get("class"), SIMPLIFY_TOL)
        else:
            tol = TOL_LAYER.get(layer, SIMPLIFY_TOL)
        if layer == "coastline":
            self.coast_raw.append(pts)
            return
        if layer in ("road", "rail", "street", "waterway"):
            geom = {"type": "LineString", "coordinates": to_lonlat(simplify(to_cells(pts), tol))}
        else:
            closed = pts[0] == pts[-1] and len(pts) >= 4
            if not closed:
                return
            if layer == "water":
                # 水面先记原始环，等全部收齐再统一合并，合并之后才简化。
                # 逐片简化会在共边上留缝，缝一多整条河就碎成点；原始环共边是同一批 OSM 节点，合并才严丝合缝。
                self.water_raw.append((tags.get("name") or tags.get("name:zh") or "", [[pts]]))
                return
            xy = to_cells(pts)
            ring = simplify_ring(xy, tol)
            if len(ring) < 4:   # 小多边形（矩形湖面等）简化后会退化成两条线，退回原环
                ring = xy
            geom = {"type": "Polygon", "coordinates": [to_lonlat(ring)]}
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


def coast_sea(chains, bbox, samples):
    """用海岸线拼海面。

    OSM 的 coastline 是折线，本身不是面。把海岸线 + bbox 四条边一起 polygonize，
    得到若干个"面"，再逐个判断它是陆还是海。

    判断不用"水在左侧"那条规则 —— 实测有相当一部分线段方向是反的，
    结果把整块陆地也标成了海（上海那张图 5 个面全中，水面变成 2,888 km² = 整个框）。
    改用更硬的证据：**面里有道路的就是陆地**。海面不会有路，崇明这种有村道的岛也不会被误判。
    """
    from shapely.geometry import LineString, Point, box as sbox
    from shapely.ops import unary_union, polygonize
    s_, w_, n_, e_ = bbox
    rect = sbox(w_, s_, e_, n_)
    lines_ = []
    for c in chains:
        if len(c) < 2:
            continue
        try:
            ln = LineString(c).intersection(rect)
        except Exception:
            continue
        if ln.is_empty:
            continue
        lines_.append(ln)
    if not lines_:
        print("海岸线：0 条落在框内")
        return []
    faces = list(polygonize(unary_union(lines_ + [rect.exterior])))
    if not faces:
        print("海岸线：%d 段，拼不出闭合面" % len(lines_))
        return []
    out = []
    land = 0
    for f in faces:
        b = f.bounds
        hits = 0
        for px, py in samples:
            if px < b[0] or px > b[2] or py < b[1] or py > b[3]:
                continue
            if f.contains(Point(px, py)):
                hits += 1
                if hits >= 3:
                    break
        if hits >= 3:
            land += 1
            continue
        out.append([list(f.exterior.coords)] + [list(r.coords) for r in f.interiors])
    print("海岸线：%d 段 -> %d 个面，陆地 %d 个，海面 %d 个" % (len(lines_), len(faces), land, len(out)))
    return out



def load_water_extra(path, bbox=None, default_name=""):
    """读一份 WKT 水域（水利/测绘专题数据），返回 [(名字, [多边形, ...]), ...]，多边形 = [外环, 内环...]。

    记录的名字写在它上面一行 `# 名称：X`（没有就用 `default_name`）—— 一个文件里往往
    既有河道又有海域，各自的名字决定了合并之后那片水叫什么。

    OSM 在城市河道上普遍只画中心线或零碎水面，专题数据里的水面是完整的多边形，
    正好补这个洞。文件可以是每行一条记录，前面带制表符分隔的字段（导出成 CSV 的样子），
    只需要 WKT 那一段。

    专题面常常整条河一起给（上海那张「长江」只有 19% 落在框内，框内还断成两截）。
    必须在注入前先裁到框内：`gen-geo` 的 `clipRing` 是 Sutherland–Hodgman，对断开的多块
    会沿着框边把它们桥接成一个环，实测面积多出 26%（0.0314 → 0.0396 度²，多出来的
    约 86 km² 全是陆地）。裁到框内之后 `clipRing` 就是空操作，桥接不会发生。
    裁出来的边与框线重合，`union_water` 的 30 m 焊接会把它收进去 0.12 格，看不见。
    `bbox` = (south, west, north, east)。
    """
    from shapely import wkt as swkt
    from shapely.geometry import box as sbox
    out = []
    clipped = None
    if bbox:
        clipped = sbox(bbox[1], bbox[0], bbox[3], bbox[2])
    rec_name = default_name
    pending = None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            mk = line.find("# 名称：")
            if mk < 0:
                mk = line.find("# 名称:")
            if mk >= 0:
                pending = line[mk:].split("：")[-1].split(":")[-1].strip()
                continue
            k = line.find("MultiPolygon")
            if k < 0:
                k = line.find("Polygon")
            if k < 0:
                continue
            frag = line[k:]
            depth = 0
            end = None
            for j, ch in enumerate(frag):
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        end = j + 1
                        break
            if not end:
                continue
            try:
                g = swkt.loads(frag[:end])
            except Exception as exc:
                print("  WKT 解析失败：%s" % exc)
                continue
            rings_here = []
            polys = list(g.geoms) if g.geom_type.startswith("Multi") else [g]
            for p in polys:
                if p.geom_type != "Polygon" or p.is_empty or p.area <= 0:
                    continue
                if clipped is not None:
                    if not p.intersects(clipped):
                        continue
                    p = p.intersection(clipped)
                    if p.is_empty or p.area <= 0:
                        continue
                    polys2 = list(p.geoms) if p.geom_type.startswith("Multi") else [p]
                else:
                    polys2 = [p]
                for q in polys2:
                    if q.geom_type != "Polygon" or q.is_empty or q.area <= 0:
                        continue
                    rings_here.append([list(q.exterior.coords)] + [list(r.coords) for r in q.interiors])
            if rings_here:
                out.append((rec_name if pending is None else pending, rings_here))
                pending = None
    print("外加水面：%s -> %d 个多边形（%d 条记录：%s）" % (
        path, sum(len(v) for _, v in out), len(out),
        "、".join((nm or "无名") for nm, _ in out) or "无"))
    return out



def union_water(raw):
    """把水面原始环合并成一片片，然后才简化。

    raw = [(名字, [多边形, ...])]，多边形 = [外环, 内环...]，都是经纬度点列。
    为什么必须"先合并再简化"：OSM 里一条河常被切成几十个彼此贴着的 natural=water way，
    共边是同一批节点。先合并，缝根本不存在；先简化再合并，每条边各简化各的，
    缝几十米宽，怎么合都合不上（实测 4,842 片只合掉 36 片）。
    """
    from shapely.geometry import Polygon, mapping
    from shapely.ops import unary_union
    from shapely import make_valid
    if not raw:
        return []
    geoms = []
    named = []
    for name, polys in raw:
        for rings in polys:
            try:
                g = Polygon(rings[0], rings[1:])
            except Exception:
                continue
            if not g.is_valid:
                g = make_valid(g)
            if g.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            if g.is_empty or g.area <= 0:
                continue
            geoms.append(g)
            if name:
                named.append((name, g.representative_point(), g.area, g.bounds))
    if not geoms:
        return []
    # 只焊接真贴着的片：这一段相邻水面片之间的缝中位 7.6 m、p10 3.6 m，
    # 焊 5 m 能把一条河的碎片接上；焊 60 m 会把番禺的鱼塘连成整片（实测水面涨到 1,066 km²）。
    d = 0.12 / float(PROJ["kx"])   # 30 m：把同一条河的碎片焊上（相邻片缝中位 7.6 m、p90 50 m）：把同一条河的碎片焊上（相邻片缝中位 7.6 m、p10 3.6 m）
    if d > 0:
        merged = unary_union([g.buffer(d, quad_segs=1) for g in geoms]).buffer(-d, quad_segs=1)
    else:
        merged = unary_union(geoms)
    parts = list(merged.geoms) if merged.geom_type.startswith("Multi") else [merged]
    tol = 0.08 / float(PROJ["kx"])
    out = []
    for part in parts:
        if part.is_empty or part.area <= 0:
            continue
        p = part.simplify(tol, preserve_topology=True)
        if p.is_empty or p.area <= 0:
            p = part
        bx0, by0, bx1, by1 = p.bounds
        best, besta = "", -1.0
        for nm, pt, a, bb in named:
            if bb[0] > bx1 or bb[2] < bx0 or bb[1] > by1 or bb[3] < by0:
                continue
            if a > besta and p.contains(pt):
                best, besta = nm, a
        out.append({"type": "Feature",
                    "properties": {"layer": "water", "name": best, "osm_id": "union", "kind": "water"},
                    "geometry": mapping(p)})
    print("水面合并：%d 片 -> %d 片（有名字的 %d 个）" % (len(geoms), len(out), len(named)))
    return out


def collect(area_pbf, dest_geojson, bbox=None, sea=False, extra=None, extra_name=""):
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
    lost = []
    for cls, tags, members in col.rels:
        _close = cls["layer"] != "water"
        outers = join_rings([col.way_geom[r] for role, r in members if role != "inner" and r in col.way_geom], _close)
        inners = join_rings([col.way_geom[r] for role, r in members if role == "inner" and r in col.way_geom], _close)
        if not outers:
            # 拼不成闭合环就等于整块丢掉 —— 这件事必须喊出来，不能静默
            nm = tags.get('name', '') or tags.get('name:zh', '')
            lost.append((nm or '无名', cls['layer'], len(members),
                         sum(1 for _r, _m in members if _m not in col.way_geom)))
            continue
        if cls["layer"] == "water":
            # 与 way 同样处理：外环 + 落在它里面的内环（岛屿），原始坐标记下来
            raw = []
            for o in outers:
                holes = [h for h in inners if point_in_ring(h[0], o)]
                raw.append([[list(p) for p in o]] + [[list(p) for p in h] for h in holes])
            col.water_raw.append((tags.get("name") or tags.get("name:zh") or "", raw))
            continue
        polys = []
        tol_r = TOL_LAYER.get(cls["layer"], SIMPLIFY_TOL)
        for o in outers:
            oxy = to_cells(o)
            so = simplify_ring(oxy, tol_r)
            if len(so) < 4:
                so = oxy
            holes = []
            for h in inners:
                if not point_in_ring(h[0], o):
                    continue
                hxy = to_cells(h)
                sh = simplify_ring(hxy, tol_r)
                holes.append(sh if len(sh) >= 4 else hxy)
            polys.append([to_lonlat(so)] + [to_lonlat(h) for h in holes])
        geom = ({"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1
                else {"type": "MultiPolygon", "coordinates": polys})
        props = {"layer": cls["layer"], "name": tags.get("name", "") or tags.get("name:zh", ""),
                 "osm_id": "relation"}
        props.update({k: v for k, v in cls.items() if k != "layer"})
        col.features.append({"type": "Feature", "geometry": geom, "properties": props})
        col.stats[cls["layer"] + "(relation)"] = col.stats.get(cls["layer"] + "(relation)", 0) + 1
        poly += 1

    if sea and bbox and col.coast_raw:
        samples = []
        for _f in col.features[::200]:
            _g = _f["geometry"]
            if _f["properties"].get("layer") not in ("road", "rail", "street"):
                continue
            if _g["type"] != "LineString" or not _g["coordinates"]:
                continue
            _c = _g["coordinates"]
            samples.append(_c[0])
            samples.append(_c[len(_c) // 2])

        sea = coast_sea(col.coast_raw, bbox, samples)
        if sea:
            col.water_raw.append(("", sea))
    if extra:
        # 逐条带上名字：合并后的水面按「代表点落在哪个具名水面里」取名，无名的大片会被
        # 旁边那条小河的名字认领（上海那张 398 km² 的长江口一度被标成「川杨河」）。
        for _nm, _polys in load_water_extra(extra, bbox, extra_name):
            col.water_raw.append((_nm, _polys))
    col.features = union_water(col.water_raw) + col.features
    with open(dest_geojson, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": col.features}, fh, ensure_ascii=False)
    print("要素 %d（其中关系多边形 %d），缺坐标点 %d" % (len(col.features), poly, col.missing_loc))
    if lost:
        print("  ! 关系多边形 %d 个拼不成闭合环，整块丢掉：" % len(lost))
        for nm, layer, cnt, miss in lost[:10]:
            print("      %-14s %-6s 成员 %3d 段，缺 %3d 段" % (nm, layer, cnt, miss))
    print("层：" + " · ".join("%s %d" % (k, v) for k, v in sorted(col.stats.items())))
    print("-> %s (%.1f MB)" % (dest_geojson, os.path.getsize(dest_geojson) / 1048576.0))
    return col.stats


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", default=os.path.join(ROOT, "maps", "_raw", "china.osm.pbf"))
    ap.add_argument("--bbox", required=True, help="south,west,north,east")
    ap.add_argument("--out", required=True)
    ap.add_argument("--proj", default="113.08,23.34,409.6,443", help="lon0,lat0,kx,ky（必须与 gen-geo 一致）")
    ap.add_argument("--stats-only", action="store_true")
    ap.add_argument("--sea", action="store_true", help="用 coastline 拼海面（实验性，默认关）")
    ap.add_argument("--water-extra", default=None, help="额外的 WKT 水域文件，补进水面")
    ap.add_argument("--water-extra-name", default="", help="上面那份水域的名字（写进地图标注）")
    args = ap.parse_args(argv[1:])
    lon0, lat0, kx, ky = (float(v) for v in args.proj.split(","))
    PROJ.update({"lon0": lon0, "lat0": lat0, "kx": kx, "ky": ky})
    bbox = tuple(float(v) for v in args.bbox.split(","))
    os.makedirs(args.out, exist_ok=True)
    area = os.path.join(args.out, "area.osm.pbf")
    if not os.path.exists(area):
        cut(args.pbf, bbox, area)
    else:
        print("复用已有裁剪结果 %s" % area)
    if args.stats_only:
        return 0
    collect(area, os.path.join(args.out, "features.geojson"), bbox, args.sea,
            args.water_extra, args.water_extra_name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
