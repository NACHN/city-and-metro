// 把 geo_<id>.js 解码后的道路折线导出成 JSON，给 tools/geom-check.py 做原始数据对比。
//   node tools/_dump-roads.mjs gz2 > maps/_raw/gz2/_game_roads.json
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] || 'gz2';
const sb = { console: { log() {}, warn() {}, error() {} } };
sb.window = sb; vm.createContext(sb);
const parked = path.join(root, 'maps', id, 'parked', 'geo_' + id + '.js');
for (const f of ['js/util.js', 'js/config.js', 'js/geo.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
}
const geoFile = fs.existsSync(path.join(root, 'js/geo_' + id + '.js')) ? path.join(root, 'js/geo_' + id + '.js') : parked;
vm.runInContext(fs.readFileSync(geoFile, 'utf8'), sb, { filename: geoFile });
const CM = sb.CM;
CM.CFG.W = 240; CM.CFG.H = 192;
CM.GEO = CM.GEOS[id];
CM.Geo.init();
// 只保留窗口内的折线：x 60–130、y 75–110（与 geom-check.py 的 WIN 一致）
const out = [];
for (const r of CM.Geo.roads) {
  const p = r.p, keep = [];
  let hit = false;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i], y = p[i + 1];
    keep.push(+x.toFixed(3), +y.toFixed(3));
    if (x > 58 && x < 132 && y > 73 && y < 112) hit = true;
  }
  if (hit) out.push({ n: r.name, c: r.cls, p: keep });
}
process.stdout.write(JSON.stringify(out));
