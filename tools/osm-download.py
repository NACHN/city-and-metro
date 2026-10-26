"""并行分片下载 Geofabrik 的 OSM 提取文件（走本地 socks5）。

单连接在这条线路上只有 ~0.6 MB/s，四个并发就上到 ~2.7 MB/s，所以按分片并行拉。
每片单独落盘、单独续传：断了重跑同一命令即可，已完成的分片不会重下。

用法：
    python tools/osm-download.py                       # 默认拉 china-latest.osm.pbf
    python tools/osm-download.py --url <pbf> --out <file> --parts 8
"""

import argparse
import hashlib
import json
import os
import socket
import sys
import threading
import time
import urllib.request

import socks  # PySocks

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "maps", "_raw")
DEFAULT_URL = "https://download.geofabrik.de/asia/china-latest.osm.pbf"
SOCKS = ("127.0.0.1", 10808)
UA = "city-and-metro-mapbuild/1.0"

_lock = threading.Lock()
_done = {}
# 环境里还挂着 HTTP_PROXY，urllib 默认会走它（然后 CONNECT 隧道超时）。
# 这里把代理全关掉：出口由下面替换掉的 socks socket 负责。
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _install_socks():
    socks.set_default_proxy(socks.SOCKS5, SOCKS[0], SOCKS[1], rdns=True)
    socket.socket = socks.socksocket


def head(url):
    """返回 (最终 URL, 总字节数)。跟随 307 到具体的日期文件。"""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    r = _opener.open(req, timeout=60)
    return r.geturl(), int(r.headers["Content-Length"])


def _fetch_range(url, start, end, dest, label):
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    want = end - start + 1
    if have >= want:
        with _lock:
            _done[label] = want
        return
    lo = start + have
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=%d-%d" % (lo, end)})
    with _opener.open(req, timeout=120) as r, open(dest, "ab") as fh:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            with _lock:
                _done[label] = _done.get(label, have) + len(chunk)


def download(url, out, parts=8):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    final_url, total = head(url)
    print("源：%s\n总大小：%.0f MB，分 %d 片" % (final_url, total / 1048576.0, parts))
    per = total // parts
    jobs = []
    for i in range(parts):
        s = i * per
        e = total - 1 if i == parts - 1 else s + per - 1
        jobs.append((i, s, e, out + ".part%d" % i))
        _done[i] = os.path.getsize(jobs[-1][3]) if os.path.exists(jobs[-1][3]) else 0

    threads = []
    for i, s, e, dest in jobs:
        t = threading.Thread(target=_fetch_range, args=(final_url, s, e, dest, i), daemon=True)
        t.start()
        threads.append(t)

    t0 = time.time()
    while any(t.is_alive() for t in threads):
        time.sleep(2)
        with _lock:
            got = sum(_done.values())
        el = time.time() - t0
        print("\r  %.0f/%.0f MB  %.1f MB/s" % (got / 1048576.0, total / 1048576.0,
                                              got / 1048576.0 / max(el, 0.001)), end="", flush=True)
    for t in threads:
        t.join()
    print()

    for i, s, e, dest in jobs:
        if os.path.getsize(dest) != e - s + 1:
            raise RuntimeError("分片 %d 长度不对：%d != %d" % (i, os.path.getsize(dest), e - s + 1))
    with open(out, "wb") as fh:
        for _, _, _, dest in jobs:
            with open(dest, "rb") as src:
                while True:
                    buf = src.read(1 << 22)
                    if not buf:
                        break
                    fh.write(buf)
    for _, _, _, dest in jobs:
        os.remove(dest)
    print("合并完成：%s (%.0f MB)" % (out, os.path.getsize(out) / 1048576.0))
    return final_url


def check_md5(final_url, path):
    """Geofabrik 每个文件旁边有 .md5，下载完顺手核一遍。"""
    try:
        r = _opener.open(urllib.request.Request(final_url + ".md5",
                          headers={"User-Agent": UA}), timeout=40)
        want = r.read().decode().split()[0].strip().lower()
    except Exception as exc:  # noqa: BLE001
        print("拿不到 md5（%s），跳过校验" % exc)
        return True
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for buf in iter(lambda: fh.read(1 << 22), b""):
            h.update(buf)
    got = h.hexdigest()
    print("md5 %s %s" % ("✓" if got == want else "✗", got))
    return got == want


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default=os.path.join(RAW, "china.osm.pbf"))
    ap.add_argument("--parts", type=int, default=8)
    args = ap.parse_args(argv[1:])
    _install_socks()
    final = download(args.url, args.out, args.parts)
    ok = check_md5(final, args.out)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
