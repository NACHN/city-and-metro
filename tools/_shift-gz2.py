"""一次性脚本：把 data_gz.js 变成 data_gz2.js 的骨架。

新图的投影原点左移北移，所以老图里写死的坐标要整体平移；名字定位（at/ll/pa）
本身跟着新投影走，不用改。跑完再手工改元数据、区域与人口。

    python tools/_shift-gz2.py
"""

import re

SRC = "js/data_gz.js"
DST = "js/data_gz2.js"

# gz: lon0=113.20, lat0=23.215  →  gz2: lon0=113.08, lat0=23.34 ; kx/ky 不变
DX = round((113.20 - 113.08) * 409.6, 2)   # 49.15 格
DY = round((23.34 - 23.215) * 443.0, 2)    # 55.38 格


def main():
    s = open(SRC, encoding="utf-8").read()

    s = s.replace("CM.GEOS && CM.GEOS.gz", "CM.GEOS && CM.GEOS.gz2")
    s = s.replace("{ lon0: 113.2, lat0: 23.215, kx: 409.6, ky: 443 }",
                  "{ lon0: 113.08, lat0: 23.34, kx: 409.6, ky: 443 }")

    pairs = [0]

    def shift(m):
        pairs[0] += 1
        x = round(float(m.group(1)) + DX, 2)
        y = round(float(m.group(2)) + DY, 2)
        return "x: %.2f, y: %.2f" % (x, y)

    s = re.sub(r"x: (-?\d+(?:\.\d+)?), y: (-?\d+(?:\.\d+)?)", shift, s)
    s = s.replace("cam: { cx: 30, cy: 41, zoom: 18 }",
                  "cam: { cx: %.0f, cy: %.0f, zoom: 17 }" % (30 + DX, 41 + DY))
    open(DST, "w", encoding="utf-8").write(s)
    print("写出 %s：平移 %d 处坐标，DX=%.2f DY=%.2f" % (DST, pairs[0], DX, DY))


if __name__ == "__main__":
    main()
