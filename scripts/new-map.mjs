// 新地图的第一公里：把「中心经纬度 + 尺寸」算成 bbox 与投影参数，并把后续命令打印好。
//
//   node scripts/new-map.mjs --id sh2 --name 上海 --lat 31.2165 --lon 121.535 --w 240 --h 192
//
// 只读、只打印，不改任何文件 —— 它替你做的是那步最容易错的余弦换算：
// 地图是等距长方形（250 m 一格），给定的宽高（km）在经度方向要按 cos(lat) 放大。
// 算完照抄到 tools/osm-cut.py 与 scripts/gen-geo.mjs 的 --proj，两边必须逐位一致。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const id = arg('id', null);
if (!id) {
  console.error('用法：node scripts/new-map.mjs --id <id> --name <城市> --lat <中心纬度> --lon <中心经度> [--w 240] [--h 192] [--cell 250]');
  process.exit(1);
}
const name = arg('name', id);
const lat = Number(arg('lat', NaN)), lon = Number(arg('lon', NaN));
const W = Number(arg('w', 240)), H = Number(arg('h', 192)), cellM = Number(arg('cell', 250));
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error('需要 --lat 与 --lon（窗口中心点的经纬度，小数度）');
  process.exit(1);
}
if (W % 4 || H % 4) {
  console.error('W / H 必须是 4 的倍数（交通小区边长 4 格）');
  process.exit(1);
}

const KM_PER_DEG_LAT = 110.9;                       // 纬度方向，近似常数
const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
const widthKm = (W * cellM) / 1000, heightKm = (H * cellM) / 1000;
const dLon = widthKm / kmPerDegLon, dLat = heightKm / KM_PER_DEG_LAT;
const west = lon - dLon / 2, east = lon + dLon / 2;
const south = lat - dLat / 2, north = lat + dLat / 2;
const kx = +(W / dLon).toFixed(2), ky = +(H / dLat).toFixed(2);
const f = (v, n = 4) => v.toFixed(n);
const bbox = `${f(south)},${f(west)},${f(north)},${f(east)}`;
const proj = `${f(west, 2)},${f(north, 3)},${kx},${ky}`;

const u = id.toUpperCase();
console.log(`图 ${id} · ${name} · ${W}×${H} 格 = ${widthKm}×${heightKm} km · ${cellM} m/格`);
console.log(`中心 ${f(lat)}, ${f(lon)} · 经度 ${f(kmPerDegLon, 2)} km/度 · 纬度 ${KM_PER_DEG_LAT} km/度`);
console.log('');
console.log(`bbox（南,西,北,东）  ${bbox}`);
console.log(`proj（lon0,lat0,kx,ky）${proj}`);
console.log('');
console.log('后续命令（proj 必须两处一致）：');
console.log('');
console.log(`  python tools/osm-cut.py --bbox ${bbox} --out maps/_raw/${id} --proj ${proj}`);
console.log(`  node scripts/gen-geo.mjs --from maps/_raw/${id}/features.geojson --map ${id} --w ${W} --h ${H} \\`);
console.log(`    --proj ${proj} --out js/geo_${id}.js`);
console.log(`  node scripts/validate-map.mjs --map ${id}`);
console.log('');
console.log('然后（手工，见 地图制作流程.md §4/§5）：');
console.log(`  1. 写 maps/${id}/source.json（meta / data / cfg；cfg 的 W/H 填 ${W}/${H}）`);
console.log(`  2. node scripts/map-source.mjs build ${id} --in-place`);
console.log(`  3. js/manifest.js 加 { id: '${id}', geo: '${id}', data: '${id}', climate: 'mild' }`);
console.log(`  4. index.html 加 <script src="js/geo_${id}.js"> 与 <script src="js/data_${id}.js">（geo 在前）`);
console.log(`  5. scripts/*.mjs 的 15 个资源清单各加这两个文件（改完 node --check）`);
console.log(`  6. node scripts/build.mjs && node scripts/map-source.mjs check`);
console.log(`  7. node scripts/smoke.mjs --maps=${id} --months=2`);
console.log(`  8. node tools/month-breakdown.mjs ${id} --months=3`);
console.log(`  9. node tools/preview-map.mjs ${id} tools/_${id}.ppm`);
console.log('');
console.log(`提示：${u} 的地名核对 —— 拿 5 个已知点手算 x=(lon−${f(west, 2)})×${kx}、y=(${f(north, 3)}−lat)×${ky}。`);
