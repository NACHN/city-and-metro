import { cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };
const output = path.resolve(root, 'dist');
const entries = ['index.html', 'css', 'img', 'js', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'licenses'];

// Publish game assets and required legal notices; exclude planning docs and local files.
if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
  throw new Error('Refusing to rebuild a directory outside the project dist folder.');
}
for (const entry of entries) {
  const source = path.join(root, entry);
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Cannot publish a symbolic link: ${entry}`);
}
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const entry of entries) {
  await cp(path.join(root, entry), path.join(output, entry), { recursive: true });
}

// This game has no client-side URL router; unknown paths should return a real 404.
await writeFile(path.join(output, '404.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面不存在 · 城市与地铁</title><h1>页面不存在</h1><p><a href="/">返回游戏</a></p></html>\n');

// Files have stable names, so browsers should revalidate before using a cached release.
await writeFile(path.join(output, '_headers'), [
  '/*',
  '  Cache-Control: public, max-age=0, must-revalidate',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '',
].join('\n'));

const html = await readFile(path.join(output, 'index.html'), 'utf8');
const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
for (const reference of references) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) continue;
  const asset = path.resolve(output, reference.split(/[?#]/)[0]);
  const relative = path.relative(output, asset);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Asset reference leaves deployment directory: ${reference}`);
  }
  await stat(asset);
}

// 地图清单一致性：清单里声明的每张图，都必须有对应的 geo / data 资源、被 index.html 引入，
// 并在数据文件里调用 CM.registerMap。漏一个 script 标签或漏一次登记，构建直接失败，不留到运行期。
const vm = await import('node:vm');
if (!references.includes('js/manifest.js')) throw new Error('index.html 没有引入 js/manifest.js（地图登记与地区风格键依赖它）');
if (references.indexOf('js/manifest.js') > references.indexOf('js/data_gz.js')) throw new Error('js/manifest.js 必须在各数据文件之前引入');
const manifestBox = { window: { CM: {} } };
vm.createContext(manifestBox);
vm.runInContext(await readFile(path.join(output, 'js', 'manifest.js'), 'utf8'), manifestBox, { filename: 'js/manifest.js' });
const manifest = manifestBox.window.CM.MAP_MANIFEST || [];
if (!manifest.length) throw new Error('js/manifest.js 没有声明 MAP_MANIFEST');
const seen = new Set();
for (const entry of manifest) {
  if (!entry.id || seen.has(entry.id)) throw new Error(`地图清单存在空 id 或重复 id：${entry.id}`);
  seen.add(entry.id);
  const assets = [];
  if (entry.geo) assets.push(`js/geo_${entry.geo}.js`);
  assets.push(`js/data_${entry.data}.js`);
  for (const file of assets) {
    if (!references.includes(file)) throw new Error(`地图 ${entry.id} 的 ${file} 没有在 index.html 中引入`);
    await stat(path.join(output, file));
  }
  const dataSource = await readFile(path.join(output, `js/data_${entry.data}.js`), 'utf8');
  if (!dataSource.includes('CM.registerMap(')) throw new Error(`地图 ${entry.id} 的数据文件没有调用 CM.registerMap`);
}

let count = 0;
let bytes = 0;
async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`Symbolic link in deployment: ${absolute}`);
    if (item.isDirectory()) { await inspect(absolute); continue; }
    if (item.name.endsWith('.md') || item.name.startsWith('.')) {
      throw new Error(`Private or unexpected file in deployment: ${absolute}`);
    }
    const info = await stat(absolute);
    if (info.size > 25 * 1024 * 1024) {
      throw new Error(`Asset exceeds Cloudflare Pages file size limit: ${absolute}`);
    }
    count++;
    bytes += info.size;
  }
}
await inspect(output);

// 地图数据校验：元数据、配置覆盖、场景数据、地理边界与存档指纹（详见 scripts/validate-map.mjs）。
// 校验对象是即将发布的 dist，因此漏改脚本、数据写错、坐标越界都会在这里拦下来，而不是上线后才发现。
const { validateMaps } = await import('./validate-map.mjs');
const mapReport = await validateMaps(output);
if (mapReport.errors.length) {
  const lines = mapReport.errors.slice(0, 20).map(e => `- [${e.map}] ${e.msg}`);
  if (mapReport.errors.length > 20) lines.push(`- 另有 ${mapReport.errors.length - 20} 个错误，运行 node scripts/validate-map.mjs 查看全部`);
  throw new Error('地图数据校验失败：\n' + lines.join('\n'));
}

// source 漂移检查：maps/<id>/source.json 与 js/data_<id>.js 必须等价。
// 两者是同一份数据的两种形态，任何一边被单独改动都会在这里暴露，避免「改了 source 忘了重新生成」。
if (await exists(path.join(root, 'maps'))) {
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'map-source.mjs'), 'check'], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error('maps/<id>/source.json 与 js/data_<id>.js 不一致：\n' + ((res.stdout || '') + (res.stderr || '')).trim() +
      '\n（改完 source 后运行 node scripts/map-source.mjs build <id> --in-place；只想看差异运行 check）');
  }
}

console.log(JSON.stringify({
  output: 'dist', files: count, bytes, htmlReferencesChecked: references.length,
  maps: mapReport.checked.length, mapWarnings: mapReport.warnings.length,
}));

