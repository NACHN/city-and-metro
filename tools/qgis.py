"""Minimal client for the QGIS MCP plugin's socket server.

The plugin (``qgis_mcp_plugin``) listens on 127.0.0.1:9876 and speaks a very
small protocol: a 4-byte big-endian length prefix followed by a JSON object.
Requests are ``{"type": "<command>", "params": {...}}``; replies are
``{"status": "success", "result": ...}`` or ``{"status": "error", "message": ...}``.

Talking to the socket directly (instead of wiring an MCP server into the editor)
keeps the map pipeline reproducible: ``scripts/map-*.mjs``-style exports can pull
geometry out of a running QGIS without any editor-side configuration.

Usage:
    python tools/qgis.py ping
    python tools/qgis.py layers
    python tools/qgis.py cmd get_layer_extent --params '{"layer_id": "..."}'
"""

import json
import socket
import struct
import sys

HOST = "127.0.0.1"
PORT = 9876
HEADER = struct.Struct(">I")


def _recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connection closed by QGIS (plugin disabled?)")
        buf += chunk
    return buf


def request(cmd_type, params=None, timeout=600.0, host=HOST, port=PORT):
    """Send one command, return the ``result`` payload (raises on error)."""
    payload = json.dumps({"type": cmd_type, "params": params or {}}).encode("utf-8")
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(HEADER.pack(len(payload)) + payload)
        (length,) = HEADER.unpack(_recv_exact(sock, HEADER.size))
        reply = json.loads(_recv_exact(sock, length).decode("utf-8"))
    if reply.get("status") != "success":
        raise RuntimeError(reply.get("message") or json.dumps(reply, ensure_ascii=False))
    return reply.get("result")


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip())
        return 2
    cmd = argv[1]
    params = {}
    if "--params" in argv:
        params = json.loads(argv[argv.index("--params") + 1])
    if cmd == "ping":
        print(json.dumps(request("ping"), ensure_ascii=False))
        return 0
    if cmd == "layers":
        res = request("get_layers")
        # get_layers returns a list of dicts (id/name/type/…)
        for lyr in res if isinstance(res, list) else res.get("layers", []):
            print("%-40s %-28s %s" % (lyr.get("id", "")[:40], lyr.get("name", "")[:28], lyr.get("type", "")))
        return 0
    if cmd == "exec":
        # 在 QGIS 的 Python 里跑一个脚本文件：地图数据要靠 QGIS 自己的网络出口下载，
        # 编辑器这一侧的代理拿不到 Overpass。
        if len(argv) < 3:
            print("用法：qgis.py exec <script.py> [--timeout 秒]")
            return 2
        with open(argv[2], "r", encoding="utf-8") as fh:
            code = fh.read()
        budget = 600
        if "--timeout" in argv:
            budget = float(argv[argv.index("--timeout") + 1])
        res = request("execute_code", {"code": code, "timeout": budget}, timeout=budget + 60)
        out = (res or {}).get("stdout") or ""
        err = (res or {}).get("stderr") or ""
        if out:
            print(out.rstrip())
        if err:
            print("--- stderr ---\n" + err.rstrip(), file=sys.stderr)
        if res and res.get("error"):
            print("--- error ---\n" + str(res.get("error")), file=sys.stderr)
            return 1
        return 0
    if cmd == "cmd":
        cmd_type = argv[2] if len(argv) > 2 and not argv[2].startswith("--") else ""
        if not cmd_type:
            print("用法：qgis.py cmd <command> [--params JSON]")
            return 2
        print(json.dumps(request(cmd_type, params), ensure_ascii=False, indent=2))
        return 0
    print(json.dumps(request(cmd, params), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
