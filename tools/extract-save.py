#!/usr/bin/env python3
"""从浏览器本地存储里取出《城市与地铁》的存档 JSON（仅本机、仅开发用）。

背景：游戏的存档在 IndexedDB（库名 city-metro）。用 file:// 打开时，Firefox 会把较大的值
单独存成 storage/default/file++++<路径>/idb/<hash>.files/<n>；这些文件是 Snappy framing
格式（0xFF 0x06 0x00 0x00 "sNaPpY" + 若干 chunk），解帧后是结构化克隆，其中那段 JSON 是 UTF-16LE。

用法：
    python tools/extract-save.py "<profile>/storage/default/file++++.../idb" out.json
    （不给 out.json 时只打印每个存档的概要）

注意：只读取本机的浏览器数据；不要提交生成的存档文件（含个人信息）。
"""
import glob
import json
import os
import sys


def uncompress(data):
    """Snappy 块格式解压（足够处理我们的数据）。"""
    i = 0
    shift = 0
    n = 0
    while True:
        b = data[i]
        i += 1
        n |= (b & 0x7f) << shift
        if not (b & 0x80):
            break
        shift += 7
    out = bytearray()
    while i < len(data):
        tag = data[i]
        i += 1
        t = tag & 3
        if t == 0:
            ln = tag >> 2
            if ln < 60:
                ln += 1
            else:
                extra = ln - 59
                ln = int.from_bytes(data[i:i + extra], 'little') + 1
                i += extra
            out += data[i:i + ln]
            i += ln
        else:
            if t == 1:
                ln = 4 + ((tag >> 2) & 0x7)
                off = ((tag >> 5) << 8) | data[i]
                i += 1
            elif t == 2:
                ln = 1 + (tag >> 2)
                off = int.from_bytes(data[i:i + 2], 'little')
                i += 2
            else:
                ln = 1 + (tag >> 2)
                off = int.from_bytes(data[i:i + 4], 'little')
                i += 4
            start = len(out) - off
            for k in range(ln):
                out.append(out[start + k])
    return bytes(out)


def unframe(raw):
    """Snappy framing：跳过 stream identifier，按 chunk 拼接。"""
    if raw[4:10] != b'sNaPpY':
        raise ValueError('不是 snappy framing')
    i, out = 10, bytearray()
    while i + 4 <= len(raw):
        t = raw[i]
        ln = int.from_bytes(raw[i + 1:i + 4], 'little')
        i += 4
        if ln == 0:
            break
        payload = raw[i:i + ln]
        i += ln
        if t == 0x00:          # 压缩块（前 4 字节是 CRC）
            out += uncompress(payload[4:])
        elif t == 0x01:        # 未压缩块（前 4 字节是 CRC）
            out += payload[4:]
        elif t == 0xff:        # 再次出现的 stream identifier
            continue
        else:
            break
    return bytes(out)


def extract(raw):
    """解出 {format, version, gameVersion, savedAt, checksum, body}。"""
    d = unframe(raw)
    mark = b'{\x00"\x00f\x00o\x00r\x00m\x00a\x00t\x00'      # {"format 的 UTF-16LE
    i = d.find(mark)
    if i < 0:
        return None
    txt = d[i:].decode('utf-16le', 'ignore')
    depth, instr, esc = 0, False, False
    for k, ch in enumerate(txt):
        if instr:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return json.loads(txt[:k + 1])
    return None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    idb = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else None
    saves = []
    for f in glob.glob(os.path.join(idb, '*.files', '*')):
        if not os.path.isfile(f):
            continue
        try:
            o = extract(open(f, 'rb').read())
        except Exception:
            continue
        if not o or o.get('format') != 'city-metro-save':
            continue
        body = json.loads(o['body'])
        saves.append((o.get('savedAt') or 0, body, f))
    if not saves:
        print('没有找到存档（路径对吗？）')
        return 1
    saves.sort(key=lambda x: x[0])
    for t, b, f in saves:
        m = b.get('meta') or {}
        c = b.get('clock') or {}
        net = b.get('net') or {}
        print('%s | %s %s | %s-%s | 站 %d 线 %d | %s' % (
            os.path.basename(f), m.get('map'), m.get('mode'), c.get('y'), c.get('m'),
            len(net.get('stations') or {}), len(net.get('lines') or {}), m.get('name')))
    if out_path:
        json.dump(saves[-1][1], open(out_path, 'w', encoding='utf8'), ensure_ascii=False)
        print('已写入 ' + out_path + '（最新一局）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
