// 设施到访量体检：跑一个月后，打印每个设施的工作日到访与其中乘地铁的比例。
// 用法：node tools/fac-visits.mjs [mapId]
//
// 为什么需要它：设施的吸引量只认 w（占全市该目的吸引的份额），数据里一不小心写成
// pax（万人次/日）就会整片读成 0 —— 界面上表现为「POI 人流 0」，而日报里看不出异常。
// 这个探针只看数，一眼就能发现是 0 还是量级不对（对照 gz：中山大学≈1,000、同济≈3,500）。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const root='C:/dev/city-and-metro'; const MAP=process.argv[2]||'wlmq'; const NOOP=()=>{};
globalThis.window=globalThis; globalThis.self=globalThis;
const mkEl=()=>({style:{setProperty:NOOP},getContext:()=>new Proxy({},{get:()=>NOOP}),addEventListener:NOOP,appendChild:(c)=>c,setAttribute:NOOP,classList:{add:NOOP,remove:NOOP},querySelectorAll:()=>[]});
globalThis.document={createElement:mkEl,createElementNS:mkEl,body:mkEl(),documentElement:mkEl(),querySelector:()=>null,getElementById:mkEl,addEventListener:NOOP};
globalThis.addEventListener=NOOP; globalThis.matchMedia=()=>({matches:false,addEventListener:NOOP});
globalThis.localStorage={getItem:()=>null,setItem:NOOP,removeItem:NOOP}; globalThis.requestAnimationFrame=()=>0;
globalThis.Path2D=class{addPath(){}rect(){}moveTo(){}lineTo(){}arc(){}};
const L=(f)=>vm.runInThisContext(fs.readFileSync(f,'utf8'),{filename:f});
const FILES=['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js','js/geo_'+MAP+'.js','js/data_'+MAP+'.js','js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js'];
for(const f of FILES) if(fs.existsSync(path.join(root,f))) L(path.join(root,f));
const CM=globalThis.CM; CM.useMap(MAP);
const g=CM.Game.create({map:MAP,preset:'normal',name:'x'});
g.model.solveNow(2);
for(let d=0;d<20;d++){ g.endDay(); if(g.clock.m!==1) break; }
const it=g.monthGen(); for(let r=it.next();!r.done;r=it.next()){}
const m=g.model, fd=m.facData('wd');
console.log(MAP,'F=',m.fn.F,'facDaily?',!!m.facDaily,'ready?',fd?fd.ready:null,'key ok?',fd?fd.key===m.fn.key:null);
if(fd){
  let sum=0; for(let k=0;k<fd.F;k++) sum+=fd.inn[k];
  console.log('  全天到访合计', Math.round(sum));
  const arr=[]; for(let k=0;k<fd.F;k++) arr.push([m.fn.list[k].name, Math.round(fd.inn[k]), Math.round(fd.innM[k]), m.fn.list[k].t]);
  arr.sort((a,b)=>b[1]-a[1]);
  console.log('  前 8 个：'); arr.slice(0,8).forEach(a=>console.log('   ',String(a[1]).padStart(8),'地铁',String(a[2]).padStart(7),a[3].padEnd(8),a[0]));
  console.log('  后 4 个：'); arr.slice(-4).forEach(a=>console.log('   ',String(a[1]).padStart(8),'地铁',String(a[2]).padStart(7),a[3].padEnd(8),a[0]));
}
