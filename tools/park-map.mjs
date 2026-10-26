// 停放 / 启用一张大图（生成物在 js/ 与 maps/<id>/parked/ 之间搬，并同步清单、index.html 与探针清单）。
//
//   node tools/park-map.mjs enable gz2     # 把大图接回来：可构建、可在浏览器里试
//   node tools/park-map.mjs disable gz2    # 收回去：js/ 里不再有它，dist 也不会打包
//   node tools/park-map.mjs status gz2
//
// 做完记得跑 build；探针脚本（scripts/*.mjs）里的资源清单也会一起改，保证 smoke / page-check 能跑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, id = 'gz2'] = process.argv.slice(2);
const parkDir = path.join(root, 'maps', id, 'parked');
const files = ['geo_' + id + '.js', 'data_' + id + '.js'];
const tags = files.map((f) => '  <script src="js/' + f + '"></script>\n').join('');
const listEntry = files.map((f) => "'js/" + f + "'").join(', ');

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);

function isEnabled() {
  return files.every((f) => fs.existsSync(path.join(root, 'js', f)));
}

function setManifest(on) {
  const p = 'js/manifest.js';
  let s = read(p);
  const live = new RegExp("^\\s*\\{ id: '" + id + "'", 'm');
  const parked = new RegExp('^\\s*// (\\{ id: \'' + id + '\'.*)$', 'm');
  if (on) {
    if (live.test(s)) return;
    if (!parked.test(s)) throw new Error('manifest.js 里找不到 ' + id + ' 的登记行');
    s = s.replace(parked, '    $1');
  } else {
    if (!live.test(s)) return;
    s = s.replace(live, "    // $&");
  }
  write(p, s);
}

function setHtml(on) {
  const p = 'index.html';
  let s = read(p);
  if (on) {
    if (s.includes('js/' + files[0])) return;
    // index.html 是 CRLF，锚点要按行尾宽松匹配
    const anchor = /(\s*<script src="js\/data_gz\.js"><\/script>\r?\n)/;
    if (!anchor.test(s)) throw new Error('index.html 里找不到插入点');
    const nl = s.includes('\r\n') ? '\r\n' : '\n';
    s = s.replace(anchor, (m) => m + tags.replace(/\n/g, nl));
  } else {
    s = s.split(tags).join('').split(tags.replace(/\n/g, '\r\n')).join('');
  }
  write(p, s);
}

function setProbes(on) {
  const dir = path.join(root, 'scripts');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const p = path.join(dir, f);
    let s = fs.readFileSync(p, 'utf8');
    if (!s.includes("'js/util.js'")) continue;   // 只改「资源清单」型脚本，别碰 build.mjs 这类检查器
    const before = s;
    if (on) {
      if (s.includes(listEntry)) continue;
      s = s.replace(/'js\/data_gz\.js',?/, (m) => m.replace(/,$/, '') + ', ' + listEntry + ',');
      s = s.replace(/,\s*,/g, ',');
    } else {
      s = s.split(", " + listEntry).join('').split(listEntry + ", ").join('');
    }
    if (s !== before) fs.writeFileSync(p, s);
  }
}

function moveToPark() {
  fs.mkdirSync(parkDir, { recursive: true });
  for (const f of files) {
    const src = path.join(root, 'js', f);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(parkDir, f));
  }
}
function moveToJs() {
  for (const f of files) {
    const src = path.join(parkDir, f);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(root, 'js', f));
  }
}

if (cmd === 'status') {
  console.log(id + '：' + (isEnabled() ? '已启用（js/ 里有生成物）' : '停放中（maps/' + id + '/parked/）'));
} else if (cmd === 'enable') {
  const inJs = files.every((f) => fs.existsSync(path.join(root, 'js', f)));
  const inPark = files.every((f) => fs.existsSync(path.join(parkDir, f)));
  if (!inJs && !inPark) throw new Error('既不在 js/ 也不在 maps/' + id + '/parked/');
  if (!inJs) moveToJs();
  setManifest(true); setHtml(true); setProbes(true);
  console.log('已启用 ' + id + '：下一步 node scripts/build.mjs');
} else if (cmd === 'disable') {
  moveToPark(); setManifest(false); setHtml(false); setProbes(false);
  console.log('已停放 ' + id + '：js/ 与 dist 里不会再有它');
} else {
  console.log('用法：node tools/park-map.mjs enable|disable|status ' + id);
}
