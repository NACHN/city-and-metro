// 地价分布体检：均值 / 中位 / p10 / p90 / 最大 / 核心-外围梯度。
// 用法：node tools/land-stat.mjs [mapId] [years=0]
// 为什么需要它：地价的绝对水平由 base × 物价指数 × 密度/POI 乘子决定，
// 只看中位数看不出「核心几格爆表」，而这正是拆迁成本失控的来源。
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const root='C:/dev/city-and-metro';
const MAP=process.argv[2]||'wlmq';
const ADD=+(process.argv[3]||0);
const NOOP=()=>{};
globalThis.window=globalThis; globalThis.self=globalThis;
const mkEl=()=>({style:{setProperty:NOOP},getContext:()=>new Proxy({},{get:()=>NOOP}),addEventListener:NOOP,appendChild:(c)=>c,setAttribute:NOOP,classList:{add:NOOP,remove:NOOP},querySelectorAll:()=>[]});
globalThis.document={createElement:mkEl,createElementNS:mkEl,body:mkEl(),documentElement:mkEl(),querySelector:()=>null,getElementById:mkEl,addEventListener:NOOP};
globalThis.addEventListener=NOOP; globalThis.matchMedia=()=>({matches:false,addEventListener:NOOP});
globalThis.localStorage={getItem:()=>null,setItem:NOOP,removeItem:NOOP}; globalThis.requestAnimationFrame=()=>0;
globalThis.Path2D=class{addPath(){}rect(){}moveTo(){}lineTo(){}arc(){}};
const L=(f)=>vm.runInThisContext(fs.readFileSync(f,'utf8'),{filename:f});
for(const f of ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js',
  'js/geo_'+MAP+'.js','js/data_'+MAP+'.js','js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js',
  'js/economy.js','js/macro.js','js/game.js','js/milestones.js']) if(fs.existsSync(path.join(root,f))) L(path.join(root,f));
const CM=globalThis.CM;
CM.useMap(MAP);
const g=CM.Game.create({map:MAP,mode:'tycoon',name:'ls'});
g.model.solveNow(2);
const show=()=>{const s=g.city.landStat; if(!s){console.log('  无地价（该模式没有地价系统）');return;}
  console.log('  '+g.clock.y+'-'+String(g.clock.m).padStart(2,'0')
    +' 均值 '+Math.round(s.mean)+' · 中位 '+Math.round(s.p50)+' · p10 '+Math.round(s.p10)
    +' · p90 '+Math.round(s.p90)+' · 最大 '+Math.round(s.max)+' · 梯度 '+s.gradient.toFixed(2)+'×');};
console.log('['+MAP+'] 地价（元/㎡ 量级，含物价指数）');
show();
for(let i=0;i<ADD;i++){ const y0=g.clock.y; let d=0;
  while(g.clock.y===y0){ g.endDay(); if(++d>400) break; }
  const it=g.monthGen(); for(const r of it){} show(); }
