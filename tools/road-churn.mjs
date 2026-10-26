import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const root='C:/dev/city-and-metro'; const NOOP=()=>{};
globalThis.window=globalThis; globalThis.self=globalThis;
const mk=()=>({style:{setProperty:NOOP},getContext:()=>new Proxy({},{get:()=>NOOP}),addEventListener:NOOP,appendChild:(c)=>c,setAttribute:NOOP,classList:{add:NOOP,remove:NOOP},querySelectorAll:()=>[]});
globalThis.document={createElement:mk,createElementNS:mk,body:mk(),documentElement:mk(),querySelector:()=>null,getElementById:mk,addEventListener:NOOP};
globalThis.addEventListener=NOOP; globalThis.matchMedia=()=>({matches:false,addEventListener:NOOP});
globalThis.localStorage={getItem:()=>null,setItem:NOOP,removeItem:NOOP}; globalThis.requestAnimationFrame=()=>0;
globalThis.Path2D=class{addPath(){}rect(){}moveTo(){}lineTo(){}arc(){}};
const parked=(rel)=>{const p=path.join(root,'maps',process.env.MAP||'gz2','parked',path.basename(rel));return fs.existsSync(path.join(root,rel))?path.join(root,rel):p;};
const MAP=process.env.MAP||'gz2';
process.env.MAP=MAP;
const L=(f)=>vm.runInThisContext(fs.readFileSync(f,'utf8'),{filename:f});
for(const f of ['js/util.js','js/config.js','js/manifest.js','js/news.js','js/geo_gz.js','js/geo.js','js/data_gz.js','js/data_tutorial.js','js/geo_hz.js','js/data_hz.js','js/geo_hk.js','js/data_hk.js','js/geo_tk.js','js/data_tk.js','js/geo_tp.js','js/data_tp.js']) L(path.join(root,f));
L(parked('js/geo_'+MAP+'.js')); L(parked('js/data_'+MAP+'.js'));
for(const f of ['js/maps.js','js/facility.js','js/city.js','js/metro.js','js/sim.js','js/economy.js','js/macro.js','js/game.js','js/milestones.js']) L(path.join(root,f));
const CM=globalThis.CM; CM.useMap(MAP);
const g=CM.Game.create({map:MAP,preset:'normal',name:'c'});
// 不求解，只看路网每月怎么变（路是 monthGen 里建的）
let prev=null;
console.log('月   nA     新增弧  消失弧  端点变化弧   t0/容量变化   完全可复用?');
for(let i=0;i<15;i++){
  let crossed=false; while(!crossed) crossed=g.endDay();
  const gen=g.monthGen(); for(let r=gen.next();!r.done;r=gen.next()){}
  const road=g.city.car, links=road.links;
  const cur=new Map(); for(const L2 of links) cur.set(L2.key, L2);
  if(prev){
    let added=0, gone=0, flip=0, prop=0;
    for(const k of cur.keys()) if(!prev.has(k)) added++;
    for(const [k,o] of prev){ const n=cur.get(k); if(!n){gone++;continue;}
      if(o.v0!==n.verts[0]) flip++;
      else if(o.cap!==n.cap||o.t0!==n.t0) prop++; }
    console.log(`${String(i+1).padStart(2)} ${String(g.city.car.nA).padStart(6)} ${String(added).padStart(7)} ${String(gone).padStart(7)} ${String(flip).padStart(10)} ${String(prop).padStart(12)}   ${gone===0?'是':'否'}`);
  } else {
    console.log(` 1 ${String(g.city.car.nA).padStart(6)}       —       —          —            —   —`);
  }
  prev=new Map(); for(const L2 of links) prev.set(L2.key,{v0:L2.verts[0],cap:L2.cap,t0:L2.t0});
}
