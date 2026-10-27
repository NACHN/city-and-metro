// 这个坐标落在哪个片区：写 streets 清单时用来核对「这条街叫什么、归哪片」。
// 用法：node tools/which-region.mjs "火车西站,87.452,43.888" ["五一大道,87.36,43.90" ...]
// 参数是「名字,经度,纬度」，一次可以给多个；落在所有 level-8 边界之外会报「落外围」。
import fs from 'fs';
global.window = global; global.CM = {};
eval(fs.readFileSync('js/geo_wlmq.js', 'utf8'));
const g = CM.GEOS.wlmq, P = 64;
const LON0 = 87.27, LAT0 = 44.003, KX = 321.17, KY = 443.6;
function dec(s) {
  const o = []; let i = 0, x = 0, y = 0;
  while (i < s.length) {
    let r = 0, sh = 0, b;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    x += (r & 1) ? ~(r >> 1) : (r >> 1);
    r = 0; sh = 0;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    y += (r & 1) ? ~(r >> 1) : (r >> 1);
    o.push(x / P, y / P);
  }
  return o;
}
const polys = [];
for (const f of g.admin) {
  if (f[0] !== 8) continue;
  const rings = []; for (let k = 2; k < f.length; k++) rings.push(dec(f[k].slice(1)));
  polys.push({ n: g.names[f[1]], rings });
}
function pip(pt, p) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}
const pts = process.argv.slice(2);
for (const s of pts) {
  const [n, lon, lat] = s.split(',');
  const x = (lon - LON0) * KX, y = (LAT0 - lat) * KY;
  const hit = polys.filter((o) => o.rings.some((r) => pip([x, y], r))).map((o) => o.n);
  console.log(String(n).padEnd(12), '格(' + x.toFixed(0) + ',' + y.toFixed(0) + ')', '→', hit.length ? [...new Set(hit)].join(' + ') : '（无，落外围）');
}
