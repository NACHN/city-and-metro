// 把 V8 的 .cpuprofile 汇总成「按函数自耗时」排行。
//   node --cpu-prof --cpu-prof-dir=/tmp/prof tools/perf.mjs gz2
//   node tools/prof-summary.mjs /tmp/prof
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '/tmp/prof';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cpuprofile'));
if (!files.length) { console.log('没有 .cpuprofile：' + dir); process.exit(1); }

const self = new Map(), total = new Map();
for (const f of files) {
  const prof = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const nameOf = (n) => {
    const cf = n.callFrame || {};
    const url = (cf.url || '').replace(/^.*[\\/]/, '');
    return (cf.functionName || '(anonymous)') + ' @ ' + url + ':' + ((cf.lineNumber || 0) + 1);
  };
  // 自耗时：把 timeDelta 记到最内层帧上；父调用链用来算整棵子树
  for (let i = 0; i < prof.samples.length; i++) {
    const id = prof.samples[i], dt = prof.timeDeltas[i] / 1000;
    const n = byId.get(id);
    if (!n) continue;
    const k = nameOf(n);
    self.set(k, (self.get(k) || 0) + dt);
    const seen = new Set();
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const key = nameOf(byId.get(cur) || {});
      if (seen.has(key)) continue;
      seen.add(key);
      total.set(key, (total.get(key) || 0) + dt);
    }
  }
}
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
const sum = [...self.values()].reduce((a, b) => a + b, 0);
console.log('采样总时长 ' + (sum / 1000).toFixed(2) + ' s\n');
console.log('自耗时（含子调用合计另列）');
for (const [k, v] of rows) {
  console.log('  ' + (v / 1000).toFixed(2).padStart(7) + ' s  ' + (100 * v / sum).toFixed(1).padStart(5) + '%   ' +
    k + '   [' + ((total.get(k) || 0) / 1000).toFixed(2) + ' s 含子]');
}
