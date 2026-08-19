import { asEpochMillis } from '@latticekit/core';
import { DepthSorter, createCamera, tileBounds } from '@latticekit/iso';
import type { Rect } from '@latticekit/iso';
import { DAY, NIGHT, beginFrame, createCanvas2dSurface, createLightField, createPalette, endFrame, extendStops, isoBox, isoCylinder, isoPatch, isoTile, levelsToPx, renderFrame } from '@latticekit/draw';
import type { Passes, Pen } from '@latticekit/draw';
import { browserFrames, createLoop } from '@latticekit/loop';
import { browserStorage, createStore, installFlushTriggers, migrations, scheduleFrom } from '@latticekit/persist';
import type { Recognize } from '@latticekit/persist';

interface Save { readonly version: 1; readonly apples: number; readonly trees: number; readonly age: number; readonly evenings: number; readonly lastMs: number }
const fresh = (): Save => ({ version:1, apples:24, trees:18, age:1, evenings:0, lastMs:Date.now() });
const recognize: Recognize<Save> = (value) => {
  const v = value as Partial<Save>;
  for (const k of ['apples','trees','age','evenings','lastMs'] as const) if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) throw new RangeError(`save.${k} must be finite`);
  return { version:1, apples:v.apples!, trees:v.trees!, age:v.age!, evenings:v.evenings!, lastMs:v.lastMs! };
};
const store = createStore({ key:'evenfall-orchard:save', chain:migrations(1,recognize).seal(), adapter:browserStorage(), fresh, now:()=>asEpochMillis(Date.now()) });
let state = store.open().state;
const DAY_MS = 60_000;
const awayDays = Math.max(0, Math.floor((Date.now()-state.lastMs)/DAY_MS));
if (awayDays) state = { ...state, age:Math.min(12,state.age+awayDays), evenings:state.evenings+awayDays, lastMs:Date.now() };

const host = document.getElementById('app') ?? document.body;
const canvas = document.createElement('canvas'); host.append(canvas);
const surface = createCanvas2dSurface(canvas);
const DAY_ORCHARD = extendStops(DAY,{ leaf:0x5c8f43ff,leafDark:0x38643aff,trunk:0x8a5a36ff,fruit:0xe65335ff,soil:0x947044ff,path:0xd9bd82ff });
const NIGHT_ORCHARD = extendStops(NIGHT,{ leaf:0x234d3aff,leafDark:0x18362dff,trunk:0x45352fff,fruit:0xb83f35ff,soil:0x4b4437ff,path:0x6a654fff });
const palette = createPalette(DAY_ORCHARD);
const light = createLightField(surface,{scale:.6,falloff:1,bloom:.25});
const order = new DepthSorter(500);
const world:Rect={minX:0,minY:0,maxX:0,maxY:0}; tileBounds(0,0,120,120,levelsToPx(5),world);
const opening:Rect={minX:0,minY:0,maxX:0,maxY:0}; tileBounds(39,36,42,42,levelsToPx(5),opening);
const camera=createCamera(Math.max(1,innerWidth),Math.max(1,innerHeight),{bounds:world,minZoom:.35,keepVisible:.5});
const loop=createLoop({clock:{now:()=>performance.now()},frames:browserFrames()});

type Tree={gx:number;gy:number;size:number;owned:boolean;seed:number};
const trees:Tree[]=[];
for(let gy=8;gy<112;gy+=4) for(let gx=8;gx<112;gx+=4){ const seed=(gx*71+gy*137)%997; if(seed%5!==0) trees.push({gx:gx+(seed%7)/16,gy:gy+((seed>>2)%7)/16,size:.7+(seed%5)*.08,owned:gx>=38&&gx<78&&gy>=34&&gy<78,seed}); }

const hud=document.createElement('div'); hud.className='hud'; hud.innerHTML=`<div class="top"><div class="brand"><h1>Evenfall Orchard</h1><p id="season">Morning light · the fruit is swelling</p></div><div class="stats"><div class="pill"><small>APPLES</small><span id="apples"></span></div><div class="pill"><small>TREES</small><span id="trees"></span></div><div class="pill"><small>GROWTH</small><span id="age"></span></div></div></div><div class="bottom"><div class="card"><strong id="forecast"></strong><p>Each evening, harvest what is ripe or leave it on the bough for a larger crop tomorrow.</p></div><button id="plant">Plant tree · 12 apples</button></div>`; host.append(hud);
const evening=document.createElement('div'); evening.className='evening'; evening.innerHTML=`<div class="dialog"><div class="moon">☾</div><h2>Evening settles in</h2><p id="choiceText"></p><div class="choices"><button id="harvest">Harvest tonight</button><button id="grow">Let it grow</button></div></div>`; host.append(evening);
const toast=document.createElement('div');toast.className='toast';host.append(toast);
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let lastDay=Math.floor(Date.now()/DAY_MS), toastTimer=0;
function say(text:string){toast.textContent=text;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>toast.classList.remove('show'),2200)}
function yieldNow(){return Math.floor(state.trees*(1+state.age*.58));}
function saveNow(){state={...state,lastMs:Date.now()};store.save(state)}
function openEvening(){ $('choiceText').textContent=`The branches hold about ${yieldNow()} apples. Harvest now, or let them deepen through another day?`; evening.classList.add('open'); }
$('harvest').addEventListener('click',()=>{const n=yieldNow();state={...state,apples:state.apples+n,age:1,evenings:state.evenings+1};evening.classList.remove('open');saveNow();say(`Harvested ${n} apples`)});
$('grow').addEventListener('click',()=>{state={...state,age:Math.min(12,state.age+1),evenings:state.evenings+1};evening.classList.remove('open');saveNow();say('The fruit will be sweeter tomorrow')});
$('plant').addEventListener('click',()=>{if(state.apples<12)return;state={...state,apples:state.apples-12,trees:state.trees+1};saveNow();say('A young tree joins the rows')});

function drawTree(pen:Pen,t:Tree,index:number){
  const ownedIndex=index%48; const planted=t.owned&&ownedIndex<state.trees;
  const scale=planted?t.size:.58; const sway=Math.sin(pen.t*1.1+t.seed)*.035;
  isoCylinder(pen,t.gx,t.gy,.12,{color:'trunk',h:1.18*scale});
  isoCylinder(pen,t.gx+sway,t.gy-sway,.55*scale,{color:index%3?'leaf':'leafDark',h:1.1*scale,z:.85*scale,outline:true});
  isoCylinder(pen,t.gx-.26*scale,t.gy+.1,.38*scale,{color:'leaf',h:.72*scale,z:1.2*scale,outline:false});
  if(planted&&state.age>1){const fruit=Math.min(4,Math.floor(state.age/2));for(let i=0;i<fruit;i++)isoCylinder(pen,t.gx+((i%2)-.5)*.34,t.gy+(i<2?-.2:.2),.055,{color:'fruit',h:.08,z:1.25+i*.12,outline:false});}
}
const passes:Passes={maxHeightPx:levelsToPx(5),terrain(pen,visible){for(let gy=visible.gy0;gy<visible.gy1;gy++)for(let gx=visible.gx0;gx<visible.gx1;gx++){const inOrchard=gx>=35&&gx<82&&gy>=31&&gy<82;isoTile(pen,gx,gy,inOrchard?'soil':'ground');if(inOrchard&&((gx>=57&&gx<=59)||(gy>=55&&gy<=57)))isoPatch(pen,gx,gy,1,1,.003,'path');}},solids(pen,sorted){for(let i=0;i<sorted.count;i++){const idx=sorted.indexAt(i);const tree=trees[idx];if(tree)drawTree(pen,tree,idx);}}};
function fit(){const w=Math.max(1,innerWidth),h=Math.max(1,innerHeight);surface.resize(w,h,surface.pixelRatio);camera.resize(w,h);camera.fitBounds(opening,20)} addEventListener('resize',fit);visualViewport?.addEventListener('resize',fit);fit();
loop.onUpdate(()=>{
  const now=Date.now(),day=Math.floor(now/DAY_MS); if(day!==lastDay&&!evening.classList.contains('open')){lastDay=day;openEvening()}
  const phase=(now%DAY_MS)/DAY_MS; const sun=.5+.5*Math.cos((phase-.2)*Math.PI*2); palette.lerp(NIGHT_ORCHARD,DAY_ORCHARD,.18+.82*sun);
  $('apples').textContent=Math.floor(state.apples).toString();$('trees').textContent=state.trees.toString();$('age').textContent=`day ${state.age}`;$('forecast').textContent=`Tonight's harvest: about ${yieldNow()} apples`;$('plant').toggleAttribute('disabled',state.apples<12);$('season').textContent=phase>.72?'Dusk is coming · choose carefully':phase<.18?'Dawn mist · a new day begins':'Warm daylight · the fruit is swelling';
});
loop.onRender((_a,time)=>{const phase=(Date.now()%DAY_MS)/DAY_MS;const sun=.5+.5*Math.cos((phase-.2)*Math.PI*2);const pen=beginFrame({surface,camera,palette,t:time,clear:'sky',light});light.begin(pen,1-(.18+.82*sun),'night');order.clear();for(let i=0;i<trees.length;i++){const t=trees[i]!;order.add(t.gx-.6,t.gy-.6,1.2,1.2,levelsToPx(3));}renderFrame(pen,passes,order);endFrame(pen)});
const auto=store.autosave(()=>({...state,lastMs:Date.now()}),{schedule:scheduleFrom(loop.real)});const removeFlush=installFlushTriggers(auto,{visibility:document,page:window});
if(awayDays>0)say(`While you were away, the orchard grew for ${awayDays} ${awayDays===1?'day':'days'}`);
(globalThis as Record<string,unknown>).__lattice={loop,order,camera,state:()=>state,openEvening};
function dispose(){loop.stop();auto.stop();removeFlush();store.close({flush:true,get:()=>({...state,lastMs:Date.now()})});light.dispose();removeEventListener('resize',fit);visualViewport?.removeEventListener('resize',fit);canvas.remove();hud.remove();evening.remove();toast.remove()}
if(import.meta.hot)import.meta.hot.dispose(dispose);loop.start();
