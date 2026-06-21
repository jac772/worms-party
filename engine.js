"use strict";
/* =========================================================================
   WORMS ENGINE  (shared by index.html [offline vs AI] and host.html [party])
   - Generalised to N teams (2-4). Each team is a human controller or an AI bot.
   - Host-authoritative: this engine runs the whole sim; phones are thin
     controllers that call the ctrl* entry points over the network.
   Conventions: canvas Y grows down. "up" = -vy. gravity adds to vy.
   One unit system: pixels per fixed step (DT = 1/60). One terrain mask.
   ========================================================================= */
window.WG = (function () {

/* ----------------------------- CONSTANTS ------------------------------- */
const W = 1280, H = 720;
const DT = 1/60;
const GRAVITY     = 0.35;
const WIND_ACCEL  = 0.18;
const TERMINAL_VY = 16;
const WORM_R      = 9;
const WALK_SPEED  = 1.6;
const STEP_UP     = 11;
const STEP_DOWN   = 16;
const JUMP_VY     = -7.2, JUMP_VX = 3.4;
const FALL_THRESHOLD = 8, FALL_K = 1.7, FALL_MAX = 45;
const CHARGE_TIME = 1.1;
const TURN_TIME   = 40;
const SEA_LEVEL   = H - 36;
const SUDDEN_DEATH_ROUNDS = 12;
const MAX_SIM_STEPS = 900;
const SETTLE_SAFETY = 9;

const D2R = Math.PI/180;
const clamp = (v,a,b)=> v<a?a : v>b?b : v;
const clamp01 = v => clamp(v,0,1);
function gauss(){ let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

const Phase = { MENU:'MENU', AIMING:'AIMING', CHARGING:'CHARGING',
  RETREATING:'RETREATING', SETTLING:'SETTLING', AI_THINK:'AI_THINK', GAMEOVER:'GAMEOVER' };

const AI_DIFF = {
  easy:   { angleStep:9,   pSteps:6,  ignoreWind:true,  angleErr:0.12,  powerErr:0.13, refine:false },
  medium: { angleStep:5,   pSteps:9,  ignoreWind:false, angleErr:0.045, powerErr:0.06, refine:false },
  hard:   { angleStep:2.5, pSteps:13, ignoreWind:false, angleErr:0.012, powerErr:0.02, refine:true }
};

const TEAM_PRESETS = [
  { name:'BLUE',   color:'#4ea1ff', dark:'#1e4f8c' },
  { name:'RED',    color:'#ff6b5e', dark:'#9c3026' },
  { name:'GREEN',  color:'#5fd36a', dark:'#2c7a34' },
  { name:'YELLOW', color:'#ffce4d', dark:'#9a7714' }
];

/* ----------------------------- STATE ----------------------------------- */
let canvas, ctx, terrainCanvas, tctx;
let mask;                  // Uint8Array, 1 = solid
let game = null;
let shake = 0;
let heldMove = 0;          // -1/0/1 walk for active human team
let localInput = false;
let running = false;

const callbacks = { onWin:null, onTurnChange:null, onFire:null };

/* ----------------------------- TERRAIN --------------------------------- */
function generateTerrain(){
  tctx.clearRect(0,0,W,H);
  const p1=Math.random()*6.283, p2=Math.random()*6.283, p3=Math.random()*6.283;
  const baseY = H*0.42;
  const heights = new Float32Array(W);
  for(let x=0;x<W;x++){
    heights[x] = baseY + 82*Math.sin(x*0.0060 + p1)
                       + 34*Math.sin(x*0.0130 + p2)
                       + 14*Math.sin(x*0.0300 + p3);
  }
  const g = tctx.createLinearGradient(0, baseY-130, 0, H);
  g.addColorStop(0,'#8a6239'); g.addColorStop(0.18,'#6e4d2c'); g.addColorStop(1,'#3a2817');
  tctx.fillStyle = g; tctx.fillRect(0,0,W,H);
  tctx.fillStyle = 'rgba(0,0,0,0.10)';
  for(let i=0;i<2600;i++){ const x=Math.random()*W, y=baseY-60+Math.random()*(H-baseY+60);
    tctx.fillRect(x|0,y|0,2,2); }
  tctx.globalCompositeOperation = 'destination-out';
  tctx.fillStyle = '#000';
  tctx.beginPath(); tctx.moveTo(0,0); tctx.lineTo(0,heights[0]);
  for(let x=1;x<W;x++) tctx.lineTo(x,heights[x]);
  tctx.lineTo(W,0); tctx.closePath(); tctx.fill();
  tctx.globalCompositeOperation = 'source-over';
  for(let x=0;x<W;x++){ const h=heights[x];
    tctx.fillStyle='#5fbf4f'; tctx.fillRect(x,h,1,5);
    tctx.fillStyle='#3f9a36'; tctx.fillRect(x,h+5,1,3); }
  syncMaskFull();
  return heights;
}
function syncMaskFull(){
  const data = tctx.getImageData(0,0,W,H).data;
  for(let i=0,a=3;i<mask.length;i++,a+=4) mask[i] = data[a]>8 ? 1 : 0;
}
function isSolid(x,y){ x|=0; y|=0;
  if(x<0||x>=W||y<0||y>=H) return false;
  return mask[y*W+x]===1; }
function carveCrater(cx,cy,R){
  tctx.save(); tctx.globalCompositeOperation='destination-out'; tctx.fillStyle='#000';
  tctx.beginPath(); tctx.arc(cx,cy,R,0,6.2832); tctx.fill(); tctx.restore();
  tctx.save(); tctx.globalCompositeOperation='source-atop'; tctx.fillStyle='rgba(20,12,6,0.5)';
  tctx.beginPath(); tctx.arc(cx,cy,R+7,0,6.2832); tctx.arc(cx,cy,R,0,6.2832,true);
  tctx.fill('evenodd'); tctx.restore();
  const x0=Math.max(0,(cx-R)|0),x1=Math.min(W,(cx+R+1)|0);
  const y0=Math.max(0,(cy-R)|0),y1=Math.min(H,(cy+R+1)|0);
  const R2=R*R;
  for(let y=y0;y<y1;y++){ const row=y*W;
    for(let x=x0;x<x1;x++){ const dx=x-cx,dy=y-cy; if(dx*dx+dy*dy<=R2) mask[row+x]=0; } }
}

/* ----------------------------- PHYSICS / WORMS ------------------------- */
function solidUnderFeet(x,y){ const fy=(y+WORM_R)|0;
  return isSolid((x-4)|0,fy)||isSolid(x|0,fy)||isSolid((x+4)|0,fy); }
function headSolidAt(x,y){ const hy=(y-WORM_R)|0;
  return isSolid((x-3)|0,hy)||isSolid(x|0,hy)||isSolid((x+3)|0,hy); }
function bodyBlocked(x,y){
  for(let dy=-WORM_R+3;dy<=WORM_R-1;dy+=3)
    if(isSolid((x-4)|0,(y+dy)|0)||isSolid((x+4)|0,(y+dy)|0)) return true;
  return false;
}
function updateWorm(w){
  if(w.dead) return;
  if(w.grounded){ if(solidUnderFeet(w.x,w.y)) return; w.grounded=false; }
  w.vy += GRAVITY; if(w.vy>TERMINAL_VY) w.vy=TERMINAL_VY; w.vx *= 0.985;
  const steps=Math.max(1,Math.ceil(Math.max(Math.abs(w.vx),Math.abs(w.vy))));
  const sx=w.vx/steps, sy=w.vy/steps;
  for(let i=0;i<steps;i++){
    if(sx!==0){ const nx=w.x+sx; if(!bodyBlocked(nx,w.y)) w.x=nx; else w.vx=0; }
    const ny=w.y+sy;
    if(sy>0){
      if(!solidUnderFeet(w.x,ny)){ w.y=ny; }
      else { let yy=ny; while(yy>0&&solidUnderFeet(w.x,yy-1)) yy-=1; w.y=yy;
             onLand(w,w.vy); w.vy=0; w.vx=0; w.grounded=true; break; }
    } else if(sy<0){ if(!headSolidAt(w.x,ny)) w.y=ny; else w.vy=0; }
    if(w.y>H+80) break;
  }
}
function onLand(w,impactVy){
  if(impactVy>FALL_THRESHOLD){
    const dmg=Math.min(FALL_MAX,Math.round((impactVy-FALL_THRESHOLD)*FALL_K));
    if(dmg>0) damageWorm(w,dmg);
  }
}
function damageWorm(w,dmg){
  w.hp-=dmg;
  if(w===game.activeWorm) w.tookDamageThisTurn=true;
  spawnFloatText(w.x,w.y-WORM_R-6,'-'+dmg,'#ff5a4d');
}
function tryWalk(w,dir){
  let moved=0;
  while(moved<WALK_SPEED){
    const nx=w.x+dir;
    if(nx<WORM_R||nx>W-WORM_R) break;
    const fy=w.y+WORM_R; let surf=null;
    for(let dy=-STEP_UP;dy<=STEP_DOWN;dy++){ const ty=(fy+dy)|0;
      if(isSolid(nx|0,ty)&&!isSolid(nx|0,ty-1)){ surf=ty; break; } }
    if(surf===null){
      if(bodyBlocked(nx,w.y)) break;
      w.x=nx; w.grounded=false; w.vx=dir*1.2; w.vy=0.2; break;
    } else { const newY=surf-WORM_R; if(headSolidAt(nx,newY)) break; w.x=nx; w.y=newY; }
    moved++;
  }
  w.facing=dir;
}

/* ----------------------------- PROJECTILES ----------------------------- */
function makeProjectile(x,y,vx,vy,cfg,owner){
  return { x,y,vx,vy,cfg,owner, fuse:cfg.fuseMs, life:0, exploded:false,
           radius:cfg.radius||3, trail:[], spin:Math.random()*6.28 };
}
function distPointToSeg(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
  if(l2===0) return Math.hypot(px-ax,py-ay);
  let t=((px-ax)*dx+(py-ay)*dy)/l2; t=clamp01(t);
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function stepProjectile(p,wind,worms){
  p.vy+=GRAVITY; if(p.cfg.affectedByWind) p.vx+=wind*WIND_ACCEL;
  const dist=Math.hypot(p.vx,p.vy);
  const sub=Math.max(1,Math.ceil(dist/(p.radius*0.6)));
  const dx=p.vx/sub, dy=p.vy/sub;
  for(let i=0;i<sub;i++){
    p.x+=dx; p.y+=dy;
    if(worms){ for(const w of worms){ if(w.dead) continue;
      if(w===p.owner&&p.life<0.18) continue;
      if(Math.hypot(p.x-w.x,p.y-w.y)<=WORM_R+p.radius) return {hit:'worm',worm:w,x:p.x,y:p.y}; } }
    if(p.y>=game.waterLine) return {hit:'water',x:p.x,y:p.y};
    if(isSolid(p.x,p.y)) return {hit:'terrain',x:p.x,y:p.y};
  }
  return {hit:null};
}
function explode(cx,cy,cfg){
  carveCrater(cx,cy,cfg.explosionRadius);
  for(const w of game.worms){ if(w.dead) continue;
    const dx=w.x-cx,dy=w.y-cy,d=Math.hypot(dx,dy);
    if(d>=cfg.explosionRadius) continue;
    const t=1-d/cfg.explosionRadius;
    const dmg=Math.max(0,Math.round(cfg.baseDamage*t)); if(dmg>0) damageWorm(w,dmg);
    const inv=d>0.001?1/d:0, k=cfg.knockback*t;
    w.vx+=dx*inv*k; w.vy+=dy*inv*k-k*0.35; w.grounded=false;
  }
  spawnExplosionFX(cx,cy,cfg.explosionRadius);
  shake=Math.min(22,shake+cfg.explosionRadius*0.32);
}
function detonate(p){
  if(p.exploded) return; p.exploded=true; explode(p.x,p.y,p.cfg);
  if(p.cfg.special&&p.cfg.special.type==='split'){
    const s=p.cfg.special;
    for(let i=0;i<s.count;i++){
      const ang=(-90+(Math.random()-0.5)*s.spreadDeg)*D2R;
      const spd=s.minSpeed+Math.random()*(s.maxSpeed-s.minSpeed);
      game.projectiles.push(makeProjectile(p.x,p.y-2,Math.cos(ang)*spd,-Math.abs(Math.sin(ang)*spd),s.bomblet,p.owner));
    }
  }
}
function updateProjectiles(){
  for(let i=game.projectiles.length-1;i>=0;i--){
    const p=game.projectiles[i];
    if(!isFinite(p.x)||!isFinite(p.y)){ game.projectiles.splice(i,1); continue; }
    p.life+=DT; p.trail.push(p.x,p.y); if(p.trail.length>16) p.trail.splice(0,2);
    const res=stepProjectile(p,game.wind,game.worms);
    let done=false;
    if(res.hit==='worm'){ detonate(p); done=true; }
    else if(res.hit==='water'){ spawnSplash(res.x); done=true; }
    else if(res.hit==='terrain'){
      if(p.cfg.bounces){
        const n=surfaceNormal(res.x,res.y), dot=p.vx*n.nx+p.vy*n.ny;
        p.vx=(p.vx-2*dot*n.nx)*p.cfg.bounciness; p.vy=(p.vy-2*dot*n.ny)*p.cfg.bounciness; p.vx*=0.82;
        let g=0; while(isSolid(p.x,p.y)&&g<10){ p.x+=n.nx*2; p.y+=n.ny*2; g++; }
        if(Math.hypot(p.vx,p.vy)<1.2){ p.vx=0; p.vy=0; }
      } else if(p.cfg.detonateOnContact){ detonate(p); done=true; }
      else { let yy=p.y; while(yy>0&&isSolid(p.x,yy)) yy-=1; p.y=yy; p.vx=0; p.vy=0; }
    }
    if(!done&&p.cfg.fuseMs!=null){ p.fuse-=DT*1000; if(p.fuse<=0){ detonate(p); done=true; } }
    if(!done&&p.life>10){ detonate(p); done=true; }
    if(done||p.exploded) game.projectiles.splice(i,1);
  }
}
function surfaceNormal(x,y){
  const s=(px,py)=>isSolid(px,py)?1:0;
  let nx=(s(x-3,y)+s(x-3,y-3)+s(x-3,y+3))-(s(x+3,y)+s(x+3,y-3)+s(x+3,y+3));
  let ny=(s(x,y-3)+s(x-3,y-3)+s(x+3,y-3))-(s(x,y+3)+s(x-3,y+3)+s(x+3,y+3));
  const l=Math.hypot(nx,ny); if(l<0.001) return {nx:0,ny:-1};
  return {nx:nx/l,ny:ny/l};
}

/* ----------------------------- WEAPONS --------------------------------- */
const WEAPONS = [
  { id:'bazooka', name:'Bazooka', key:'1', aim:'chargedAngle', maxSpeed:23,
    affectedByWind:true, affectedByGravity:true, bounces:false, detonateOnContact:true, fuseMs:null,
    radius:3, explosionRadius:42, baseDamage:45, knockback:9, ammo:Infinity, retreatMs:0, aiUse:true, color:'#d7d2c8' },
  { id:'grenade', name:'Grenade', key:'2', aim:'chargedAngle', maxSpeed:20,
    affectedByWind:false, affectedByGravity:true, bounces:true, bounciness:0.55, fuseMs:3000,
    radius:4, explosionRadius:48, baseDamage:50, knockback:11, ammo:8, retreatMs:'fuse', aiUse:true, color:'#5fae44' },
  { id:'cluster', name:'Cluster', key:'3', aim:'chargedAngle', maxSpeed:20,
    affectedByWind:true, affectedByGravity:true, bounces:true, bounciness:0.3, fuseMs:2500,
    radius:4, explosionRadius:26, baseDamage:26, knockback:6, ammo:3, retreatMs:'fuse', aiUse:false, color:'#b07cd6',
    special:{ type:'split', count:5, spreadDeg:80, minSpeed:5, maxSpeed:9,
      bomblet:{ id:'bomblet', radius:3, affectedByWind:true, affectedByGravity:true, bounces:false,
        detonateOnContact:true, fuseMs:null, explosionRadius:20, baseDamage:16, knockback:5, color:'#b07cd6' } } },
  { id:'shotgun', name:'Shotgun', key:'4', aim:'instant', hitscan:true, range:520,
    affectedByWind:false, affectedByGravity:false, explosionRadius:14, baseDamage:26, knockback:7,
    ammo:Infinity, retreatMs:0, aiUse:true, color:'#c9a23a' },
  { id:'dynamite', name:'Dynamite', key:'5', aim:'drop', spawnAtFeet:true,
    affectedByWind:false, affectedByGravity:true, bounces:false, fuseMs:4000,
    radius:5, explosionRadius:62, baseDamage:78, knockback:15, ammo:2, retreatMs:'fuse', aiUse:false, color:'#d6443a' },
  { id:'airstrike', name:'Air Strike', key:'6', aim:'targetPoint', offMap:true,
    affectedByWind:true, affectedByGravity:true, bounces:false, detonateOnContact:true, fuseMs:null,
    radius:4, explosionRadius:34, baseDamage:30, knockback:7, ammo:2, retreatMs:0, aiUse:false, color:'#8fb3d9',
    special:{ type:'salvo', count:5, spacing:34, spawnY:-30, dropSpeed:3 } }
];
const WBYID = {}; WEAPONS.forEach(w=>WBYID[w.id]=w);

function currentWeapon(){ return WBYID[game.selectedWeapon]; }
function teamAmmo(team,id){ const a=game.ammo[team][id]; return a===undefined?Infinity:a; }
function hasAmmo(team,id){ return teamAmmo(team,id)>0; }
function consumeAmmo(team,id){ const w=WBYID[id]; if(w.ammo!==Infinity) game.ammo[team][id]--; }
function muzzlePos(w,angle){ const off=WORM_R+8; return {x:w.x+Math.cos(angle)*off, y:w.y-Math.sin(angle)*off}; }

function fireWeapon(power,targetX,targetY){
  const w=game.activeWorm, wpn=currentWeapon();
  if(!w||!hasAmmo(w.team,wpn.id)) return false;
  const angle=w.angle;
  if(wpn.aim==='instant'){ fireHitscan(w,angle,wpn); }
  else if(wpn.aim==='drop'){ game.projectiles.push(makeProjectile(w.x,w.y,0,0.1,wpn,w)); }
  else if(wpn.aim==='targetPoint'){
    const tx=(targetX!=null)?targetX:w.x, s=wpn.special;
    for(let i=0;i<s.count;i++){ const px=tx+(i-(s.count-1)/2)*s.spacing;
      game.projectiles.push(makeProjectile(px,s.spawnY,0,s.dropSpeed,wpn,w)); }
  } else {
    const spd=Math.max(4,power*wpn.maxSpeed), m=muzzlePos(w,angle);
    game.projectiles.push(makeProjectile(m.x,m.y,Math.cos(angle)*spd,-Math.sin(angle)*spd,wpn,w));
    spawnMuzzleFlash(m.x,m.y,angle);
  }
  consumeAmmo(w.team,wpn.id);
  game.charge=0; game.hasFired=true;
  if(callbacks.onFire) callbacks.onFire(w.team, wpn.id);
  enterPostFire(wpn);
  return true;
}
function fireHitscan(w,angle,wpn){
  const dirx=Math.cos(angle), diry=-Math.sin(angle);
  let hx=w.x+dirx*(WORM_R+2), hy=w.y+diry*(WORM_R+2), hit=null;
  spawnMuzzleFlash(hx,hy,angle);
  for(let d=0;d<wpn.range;d+=2){
    hx+=dirx*2; hy+=diry*2; if(hx<0||hx>W||hy<0||hy>H) break;
    let struck=false;
    for(const t of game.worms){ if(t.dead||t===w) continue;
      if(Math.hypot(hx-t.x,hy-t.y)<=WORM_R+2){ hit={x:hx,y:hy}; damageWorm(t,wpn.baseDamage);
        const inv=1/(Math.hypot(t.x-w.x,t.y-w.y)||1); t.vx+=(t.x-w.x)*inv*wpn.knockback; t.vy-=2; t.grounded=false; struck=true; break; } }
    if(struck) break;
    if(isSolid(hx,hy)){ hit={x:hx,y:hy}; break; }
  }
  game.tracers.push({ x1:w.x+dirx*(WORM_R+2), y1:w.y+diry*(WORM_R+2), x2:hit?hit.x:hx, y2:hit?hit.y:hy, t:0.18 });
  if(hit){ carveCrater(hit.x,hit.y,wpn.explosionRadius); spawnExplosionFX(hit.x,hit.y,wpn.explosionRadius*0.7); shake=Math.min(14,shake+6); }
}
function retreatSeconds(wpn){ if(wpn.retreatMs==='fuse') return (wpn.fuseMs||0)/1000+0.4; return (wpn.retreatMs||0)/1000; }
function enterPostFire(wpn){
  const w=game.activeWorm, retreat=retreatSeconds(wpn);
  if(!game.teams[w.team].isAI && retreat>0 && !w.tookDamageThisTurn && !w.dead){
    game.phase=Phase.RETREATING; game.retreatTimer=retreat;
  } else { game.phase=Phase.SETTLING; game.settleTimer=0; }
}

/* ----------------------------- AI -------------------------------------- */
function aliveEnemies(team){ return game.worms.filter(w=>!w.dead&&w.team!==team); }
function lineOfSight(a,b){ const d=Math.hypot(b.x-a.x,b.y-a.y), n=Math.ceil(d/3);
  for(let i=1;i<n;i++){ const t=i/n; if(isSolid(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t)) return false; } return true; }
function simulateShot(start,angle,power,wpn,wind,target){
  const m={x:start.x+Math.cos(angle)*(WORM_R+8), y:start.y-Math.sin(angle)*(WORM_R+8)};
  const spd=Math.max(4,power*wpn.maxSpeed);
  const p=makeProjectile(m.x,m.y,Math.cos(angle)*spd,-Math.sin(angle)*spd,wpn,null);
  let minD=Math.hypot(p.x-target.x,p.y-target.y), prevx=p.x, prevy=p.y;
  for(let s=0;s<MAX_SIM_STEPS;s++){
    const res=stepProjectile(p,wind,null);
    const d=distPointToSeg(target.x,target.y,prevx,prevy,p.x,p.y); if(d<minD) minD=d;
    prevx=p.x; prevy=p.y; if(res.hit) break;
    if(p.x<-80||p.x>W+80||p.y>H+80) break;
  }
  return minD;
}
function aimAt(start,target,wpn,wind,diff){
  const searchWind=diff.ignoreWind?0:wind;
  let best={score:Infinity,angle:Math.PI/4,power:1};
  for(let aDeg=12;aDeg<=168;aDeg+=diff.angleStep){ const ang=aDeg*D2R;
    for(let pi=2;pi<=diff.pSteps;pi++){ const power=pi/diff.pSteps;
      const sc=simulateShot(start,ang,power,wpn,searchWind,target); if(sc<best.score) best={score:sc,angle:ang,power}; } }
  if(diff.refine){ const a0=best.angle,p0=best.power;
    for(let da=-diff.angleStep;da<=diff.angleStep;da+=diff.angleStep/4)
      for(let dp=-0.08;dp<=0.08;dp+=0.02){ const ang=a0+da*D2R,power=clamp01(p0+dp); if(power<0.15) continue;
        const sc=simulateShot(start,ang,power,wpn,searchWind,target); if(sc<best.score) best={score:sc,angle:ang,power}; } }
  return { angle:best.angle+gauss()*diff.angleErr, power:clamp(best.power*(1+gauss()*diff.powerErr),0.18,1), miss:best.score };
}
function aiPlan(worm){
  const diff=AI_DIFF[game.teams[worm.team].difficulty||'medium'];
  const enemies=aliveEnemies(worm.team); if(enemies.length===0) return null;
  let best=null;
  for(const t of enemies) for(const wpn of WEAPONS){
    if(!wpn.aiUse||wpn.aim!=='chargedAngle') continue;
    if(!hasAmmo(worm.team,wpn.id)) continue;
    const aim=aimAt(worm,t,wpn,game.wind,diff), bias=(wpn.id==='bazooka'?0:6), score=aim.miss+bias;
    if(!best||score<best.score) best={score,target:t,weaponId:wpn.id,angle:aim.angle,power:aim.power};
  }
  for(const t of enemies){ const d=Math.hypot(t.x-worm.x,t.y-worm.y);
    if(d<WBYID.shotgun.range*0.9 && lineOfSight({x:worm.x,y:worm.y-WORM_R},{x:t.x,y:t.y-WORM_R})){
      if(!best||best.score>WORM_R*1.6) best={score:0,target:t,weaponId:'shotgun',angle:Math.atan2(worm.y-t.y,t.x-worm.x),power:1};
      break; } }
  return best;
}
function updateAI(){
  const w=game.activeWorm; if(!w||w.dead){ endTurnToSettle(); return; }
  if(!game.ai){ const plan=aiPlan(w); if(!plan){ endTurnToSettle(); return; }
    w.angle=plan.angle; w.facing=Math.cos(plan.angle)>=0?1:-1; game.selectedWeapon=plan.weaponId;
    game.ai={plan,state:'think',timer:0.7,charge:0,life:0}; return; }
  const ai=game.ai; ai.life+=DT;
  if(ai.life>6){ fireWeapon(isFinite(ai.plan.power)?ai.plan.power:0.6); game.ai=null; return; }
  if(ai.state==='think'){ ai.timer-=DT;
    if(ai.timer<=0){ const wpn=WBYID[ai.plan.weaponId];
      if(wpn.aim==='chargedAngle') ai.state='charge'; else { fireWeapon(1); game.ai=null; } } }
  else if(ai.state==='charge'){ ai.charge+=DT/CHARGE_TIME; game.charge=Math.min(ai.charge,ai.plan.power);
    if(ai.charge>=ai.plan.power){ fireWeapon(ai.plan.power); game.ai=null; } }
}

/* ----------------------------- TURN FSM -------------------------------- */
function teamWorms(t){ return game.worms.filter(w=>w.team===t); }
function teamAlive(t){ return teamWorms(t).some(w=>!w.dead); }
function nextAliveTeam(from){ const N=game.teams.length;
  for(let i=1;i<=N;i++){ const t=(from+i)%N; if(teamAlive(t)) return t; } return from; }

function startTurn(team){
  const N=game.teams.length;
  game.activeTeam=team;
  game.turnNo=(game.turnNo||0)+1;
  const rounds=Math.floor((game.turnNo-1)/N);
  if(rounds>=SUDDEN_DEATH_ROUNDS && !game.suddenDeath){
    game.suddenDeath=true; for(const w of game.worms) if(!w.dead) w.hp=Math.min(w.hp,1);
  }
  if(game.suddenDeath) game.waterLine=Math.max(H*0.5, game.waterLine-7);
  const list=teamWorms(team);
  for(let n=0;n<list.length;n++){ game.cursor[team]=(game.cursor[team]+1)%list.length;
    if(!list[game.cursor[team]].dead) break; }
  game.activeWorm=list[game.cursor[team]];
  game.activeWorm.tookDamageThisTurn=false;
  game.wind=(Math.random()*2-1); game.charge=0; game.turnTimer=TURN_TIME; game.hasFired=false; heldMove=0;
  if(!hasAmmo(team,game.selectedWeapon)) game.selectedWeapon='bazooka';
  if(game.teams[team].isAI){ game.phase=Phase.AI_THINK; game.ai=null; } else { game.phase=Phase.AIMING; }
  if(callbacks.onTurnChange) callbacks.onTurnChange(team);
}
function wormsAtRest(){
  if(game.projectiles.length>0) return false;
  for(const w of game.worms){ if(w.dead) continue;
    if(w.y>H+50||w.x<-20||w.x>W+20) continue;
    if(!w.grounded||Math.abs(w.vx)>0.4||Math.abs(w.vy)>0.4) return false; }
  return true;
}
function resolveDeaths(){
  for(const w of game.worms){ if(w.dead) continue;
    if(w.hp<=0){ w.hp=0; killWorm(w); continue; }
    if(w.y>=game.waterLine||w.x<-4||w.x>W+4||w.y>H+40) killWorm(w); }
}
function killWorm(w){ if(w.dead) return; w.dead=true; w.hp=0; spawnExplosionFX(w.x,w.y,26); }
function checkWin(){
  const alive=game.teams.map((_,i)=>i).filter(i=>teamAlive(i));
  if(alive.length===0) return 'draw';
  if(alive.length===1) return alive[0];
  return null;
}
function endTurnToSettle(){ game.phase=Phase.SETTLING; game.settleTimer=0; }
function advanceTurn(){
  resolveDeaths(); const winner=checkWin();
  if(winner!==null){ game.winner=winner; game.phase=Phase.GAMEOVER; if(callbacks.onWin) callbacks.onWin(winner); return; }
  startTurn(nextAliveTeam(game.activeTeam));
}

/* ----------------------------- UPDATE ---------------------------------- */
function update(){
  if(game.phase===Phase.MENU||game.phase===Phase.GAMEOVER) return;
  // continuous walk for the active human team (held button / keyboard)
  if((game.phase===Phase.AIMING||game.phase===Phase.RETREATING) && game.activeWorm && !game.teams[game.activeTeam].isAI){
    if(heldMove) tryWalk(game.activeWorm,heldMove);
  }
  updateProjectiles();
  for(const w of game.worms) updateWorm(w);
  for(let i=game.tracers.length-1;i>=0;i--){ game.tracers[i].t-=DT; if(game.tracers[i].t<=0) game.tracers.splice(i,1); }
  updateParticles();
  if(shake>0) shake=Math.max(0,shake-0.6);
  switch(game.phase){
    case Phase.AIMING:
      if(!game.activeWorm){ endTurnToSettle(); break; }
      game.turnTimer-=DT;
      if(game.activeWorm.dead||game.activeWorm.tookDamageThisTurn||game.turnTimer<=0) endTurnToSettle();
      break;
    case Phase.CHARGING:
      game.turnTimer-=DT; game.charge=Math.min(1,game.charge+DT/CHARGE_TIME);
      if(game.charge>=1) fireWeapon(1); else if(game.turnTimer<=0){ game.charge=0; endTurnToSettle(); }
      break;
    case Phase.RETREATING:
      game.retreatTimer-=DT;
      if(game.activeWorm.dead) endTurnToSettle();
      else if(game.retreatTimer<=0&&wormsAtRest()) endTurnToSettle();
      break;
    case Phase.SETTLING:
      game.settleTimer+=DT;
      if(wormsAtRest()||game.settleTimer>SETTLE_SAFETY) advanceTurn();
      break;
    case Phase.AI_THINK: updateAI(); break;
  }
}

/* ----------------------------- RENDER ---------------------------------- */
function rr(c,x,y,w,h,r){ c.beginPath();
  c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }

function render(){
  ctx.save();
  if(shake>0) ctx.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);
  drawSky(); ctx.drawImage(terrainCanvas,0,0); drawWater();
  for(const w of game.worms) drawWorm(w);
  drawActiveMarker(); drawProjectiles(); drawTracers(); drawParticles();
  ctx.restore();
  if(game.teams) drawHUD();
}
function drawSky(){
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#1b3b6b'); g.addColorStop(0.5,'#274d80'); g.addColorStop(1,'#3a6a9c');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(20,40,70,0.5)'; ctx.beginPath(); ctx.moveTo(0,H*0.55);
  for(let x=0;x<=W;x+=40) ctx.lineTo(x,H*0.5+Math.sin(x*0.004+1)*40); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.fill();
  ctx.fillStyle='rgba(15,30,55,0.5)'; ctx.beginPath(); ctx.moveTo(0,H*0.62);
  for(let x=0;x<=W;x+=40) ctx.lineTo(x,H*0.6+Math.sin(x*0.006+3)*32); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.fill();
}
function drawWater(){
  const t=performance.now()/1000, top=game.waterLine;
  ctx.fillStyle='rgba(40,110,180,0.55)'; ctx.beginPath(); ctx.moveTo(0,top);
  for(let x=0;x<=W;x+=20) ctx.lineTo(x,top+Math.sin(x*0.03+t*2)*3); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(120,190,240,0.5)'; ctx.beginPath(); ctx.moveTo(0,top);
  for(let x=0;x<=W;x+=20) ctx.lineTo(x,top+Math.sin(x*0.03+t*2)*3);
  ctx.lineTo(W,top+3); for(let x=W;x>=0;x-=20) ctx.lineTo(x,top+3+Math.sin(x*0.03+t*2)*3); ctx.fill();
}
function aimPhase(){ return game.phase===Phase.AIMING||game.phase===Phase.CHARGING||game.phase===Phase.RETREATING||game.phase===Phase.AI_THINK; }

function drawWorm(w){
  if(w.dead) return;
  const team=game.teams[w.team];
  // held weapon BEHIND body for items on far side, but simplest: draw weapon for active worm over body
  ctx.save();
  ctx.fillStyle=team.color; ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(w.x,w.y,WORM_R,0,6.2832); ctx.fill(); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(w.x-2,w.y-2,WORM_R*0.5,0,6.2832); ctx.fill();
  ctx.fillStyle='#fff'; const ex=w.x+w.facing*2.5;
  ctx.beginPath(); ctx.arc(ex-2,w.y-2,2.1,0,6.2832); ctx.arc(ex+2,w.y-2,2.1,0,6.2832); ctx.fill();
  ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(ex-2+w.facing,w.y-2,1,0,6.2832); ctx.arc(ex+2+w.facing,w.y-2,1,0,6.2832); ctx.fill();
  ctx.restore();
  if(w===game.activeWorm && aimPhase()) drawHeldWeapon(w,currentWeapon());
  // health bar
  const bw=30,bx=w.x-bw/2,by=w.y-WORM_R-13;
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(bx-1,by-1,bw+2,6);
  ctx.fillStyle=w.hp>50?'#5fd35f':w.hp>25?'#e8c23a':'#e8503a'; ctx.fillRect(bx,by,bw*clamp01(w.hp/w.maxHp),4);
  ctx.fillStyle=team.color; ctx.font='bold 10px Trebuchet MS'; ctx.textAlign='center'; ctx.fillText(Math.max(0,w.hp),w.x,by-3);
}

/* ---- realistic held weapons (drawn at the worm, oriented to aim) ---- */
function drawHeldWeapon(w,wpn){
  if(!wpn) return;
  const id=wpn.id;
  ctx.save(); ctx.translate(w.x,w.y);
  if(id==='bazooka'||id==='cluster'||id==='shotgun'){
    ctx.rotate(-w.angle);
    if(Math.cos(w.angle)<0) ctx.scale(1,-1);   // keep weapon upright when aiming left
    if(id==='bazooka'){
      ctx.fillStyle='#41603e'; rr(ctx,3,-4,26,9,3); ctx.fill();
      ctx.fillStyle='#33502f'; ctx.fillRect(3,-4,6,9);
      ctx.fillStyle='#1d2a1b'; rr(ctx,27,-5,5,11,2); ctx.fill();   // muzzle
      ctx.fillStyle='#b33'; ctx.fillRect(9,-3,3,7);                 // warning stripe
      ctx.fillStyle='#222'; rr(ctx,14,-8,6,3,1); ctx.fill();        // scope
      ctx.fillStyle='#2a2a2a'; ctx.fillRect(11,4,4,4);              // grip
    } else if(id==='cluster'){
      ctx.fillStyle='#5a4a6a'; rr(ctx,3,-6,20,12,5); ctx.fill();
      ctx.fillStyle='#7a6a8a'; ctx.fillRect(7,-6,2,12); ctx.fillRect(13,-6,2,12);
      ctx.fillStyle='#33263f'; rr(ctx,22,-5,5,10,2); ctx.fill();
    } else if(id==='shotgun'){
      ctx.fillStyle='#5b3a1f'; rr(ctx,0,-1,10,7,2); ctx.fill();     // stock
      ctx.fillStyle='#c9ccd1'; ctx.fillRect(8,-4,22,3);             // barrels
      ctx.fillStyle='#9aa0a6'; ctx.fillRect(8,-1,22,3);
      ctx.fillStyle='#2a2a2a'; ctx.fillRect(9,5,4,4);               // trigger
    }
  } else if(id==='grenade'){
    const hx=Math.cos(w.angle)*(WORM_R+3), hy=-Math.sin(w.angle)*(WORM_R+3);
    drawGrenadeIcon(hx,hy,5,0);
  } else if(id==='dynamite'){
    ctx.translate(w.facing*(WORM_R-1),-1); drawDynamiteIcon(0,0,1.0,w.facing);
  } else if(id==='airstrike'){
    const fx=w.facing*(WORM_R-2);
    ctx.fillStyle='#22303f'; rr(ctx,fx-3,-7,7,10,1.5); ctx.fill();   // radio
    ctx.fillStyle='#3a4d63'; ctx.fillRect(fx-2,-5,5,2);
    ctx.strokeStyle='#9aa0a6'; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(fx,-7); ctx.lineTo(fx+3,-14); ctx.stroke();
    const blink=(performance.now()%600)<300;
    ctx.fillStyle=blink?'#ff5a4d':'#5a1a16'; ctx.beginPath(); ctx.arc(fx+3,-14,1.8,0,6.28); ctx.fill();
  }
  ctx.restore();
}
function drawGrenadeIcon(x,y,r,rot){
  ctx.save(); ctx.translate(x,y); if(rot) ctx.rotate(rot);
  ctx.fillStyle='#4f9a3e'; ctx.beginPath(); ctx.ellipse(0,1,r,r*1.15,0,0,6.28); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.25)'; ctx.lineWidth=1;
  for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.moveTo(-r,i*r*0.55); ctx.lineTo(r,i*r*0.55); ctx.stroke(); }
  ctx.fillStyle='#6b6b6b'; ctx.fillRect(-r*0.5,-r*1.1,r,r*0.5);     // cap
  ctx.strokeStyle='#888'; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(r*0.4,-r*0.9); ctx.lineTo(r*1.1,-r*0.4); ctx.stroke(); // lever
  ctx.restore();
}
function drawDynamiteIcon(x,y,s,facing){
  ctx.save(); ctx.translate(x,y); ctx.scale(s,s);
  for(let i=-1;i<=1;i++){ ctx.fillStyle=i===0?'#e0483c':'#c43a2f';
    ctx.fillRect(i*4-2,-7,4,14); ctx.fillStyle='rgba(0,0,0,0.15)'; ctx.fillRect(i*4-2,-7,1,14); }
  ctx.fillStyle='#3a2a1a'; ctx.fillRect(-7,-2,14,3);                // tape
  ctx.strokeStyle='#777'; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(2,-7); ctx.quadraticCurveTo(7,-12,4,-15); ctx.stroke();
  const spark=(performance.now()%200)<100;
  ctx.fillStyle=spark?'#ffd24a':'#ff7a2e'; ctx.beginPath(); ctx.arc(4,-15,2,0,6.28); ctx.fill();
  ctx.restore();
}

function drawActiveMarker(){
  if(!game.activeWorm||game.activeWorm.dead||!aimPhase()) return;
  const w=game.activeWorm, t=performance.now()/400;
  const yy=w.y-WORM_R-28+Math.sin(t)*3;
  ctx.fillStyle='#ffd166'; ctx.beginPath(); ctx.moveTo(w.x,yy+10); ctx.lineTo(w.x-7,yy); ctx.lineTo(w.x+7,yy); ctx.fill();
  const wpn=currentWeapon();
  if(wpn.aim!=='drop'){
    if(wpn.aim==='targetPoint' && localInput && !game.teams[w.team].isAI){
      ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(mouse.x,mouse.y,14,0,6.2832); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mouse.x-20,mouse.y); ctx.lineTo(mouse.x+20,mouse.y);
      ctx.moveTo(mouse.x,mouse.y-20); ctx.lineTo(mouse.x,mouse.y+20); ctx.stroke();
    } else if(wpn.aim!=='targetPoint'){
      const cx=w.x+Math.cos(w.angle)*52, cy=w.y-Math.sin(w.angle)*52;
      ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=1; ctx.setLineDash([3,4]);
      ctx.beginPath(); ctx.moveTo(w.x,w.y); ctx.lineTo(cx,cy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(cx,cy,3.5,0,6.2832); ctx.fill();
    }
  }
  if(game.phase===Phase.CHARGING||(game.phase===Phase.AI_THINK&&game.charge>0)){
    const pw=46,px=w.x-pw/2,py=w.y-WORM_R-42;
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(px-1,py-1,pw+2,8);
    ctx.fillStyle=game.charge<0.5?'#5fd35f':game.charge<0.8?'#e8c23a':'#e8503a'; ctx.fillRect(px,py,pw*game.charge,6);
  }
}

/* ---- realistic projectile sprites ---- */
function drawProjectiles(){
  for(const p of game.projectiles){
    ctx.strokeStyle='rgba(255,220,150,0.35)'; ctx.lineWidth=2; ctx.beginPath();
    for(let i=0;i<p.trail.length;i+=2){ if(i===0) ctx.moveTo(p.trail[i],p.trail[i+1]); else ctx.lineTo(p.trail[i],p.trail[i+1]); }
    ctx.stroke();
    ctx.save(); ctx.translate(p.x,p.y);
    const ang=Math.atan2(p.vy,p.vx), id=p.cfg.id;
    if(id==='bazooka'||id==='airstrike'){
      ctx.rotate(ang);
      const flick=2+Math.random()*4;
      ctx.fillStyle='#ffd24a'; ctx.beginPath(); ctx.moveTo(-7,0); ctx.lineTo(-7-flick,-2.5); ctx.lineTo(-7-flick*1.6,0); ctx.lineTo(-7-flick,2.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#ff7a2e'; ctx.beginPath(); ctx.moveTo(-6,0); ctx.lineTo(-6-flick*0.7,-1.6); ctx.lineTo(-6-flick,0); ctx.lineTo(-6-flick*0.7,1.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle=id==='airstrike'?'#5b6b7a':'#c9ccceff'; ctx.fillStyle=id==='airstrike'?'#5b6b7a':'#cfcabf';
      rr(ctx,-7,-3,12,6,2); ctx.fill();
      ctx.fillStyle='#e0483c'; ctx.beginPath(); ctx.moveTo(5,-3); ctx.lineTo(10,0); ctx.lineTo(5,3); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#3a3f45'; ctx.beginPath(); ctx.moveTo(-7,-3); ctx.lineTo(-10,-5); ctx.lineTo(-6,-3); ctx.closePath();
        ctx.moveTo(-7,3); ctx.lineTo(-10,5); ctx.lineTo(-6,3); ctx.closePath(); ctx.fill();
    } else if(id==='grenade'){
      drawGrenadeIcon(0,0,5,p.life*6);
    } else if(id==='cluster'){
      ctx.rotate(p.spin+p.life*5);
      ctx.fillStyle='#4a3a5a'; ctx.beginPath(); ctx.arc(0,0,5,0,6.28); ctx.fill();
      ctx.fillStyle='#6a5a7a'; for(let a=0;a<6;a++){ const an=a/6*6.28; ctx.fillRect(Math.cos(an)*4-1,Math.sin(an)*4-1,2,2); }
      const blink=(performance.now()%400)<200; ctx.fillStyle=blink?'#ff5a4d':'#5a1a16'; ctx.beginPath(); ctx.arc(0,0,1.6,0,6.28); ctx.fill();
    } else if(id==='bomblet'){
      ctx.fillStyle='#4a3a5a'; ctx.beginPath(); ctx.arc(0,0,3.2,0,6.28); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(-1,-1,1.2,0,6.28); ctx.fill();
    } else if(id==='dynamite'){
      drawDynamiteIcon(0,0,0.9,1);
    } else {
      ctx.fillStyle=p.cfg.color||'#ddd'; ctx.beginPath(); ctx.arc(0,0,p.radius+1.5,0,6.28); ctx.fill();
    }
    ctx.restore();
  }
}
function drawTracers(){
  for(const t of game.tracers){ ctx.strokeStyle=`rgba(255,230,120,${clamp01(t.t/0.18)})`; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(t.x1,t.y1); ctx.lineTo(t.x2,t.y2); ctx.stroke(); }
}

/* ---- particles ---- */
function spawnExplosionFX(x,y,r){
  const n=Math.min(40,8+r);
  for(let i=0;i<n;i++){ const a=Math.random()*6.2832, sp=Math.random()*r*0.12+1;
    game.particles.push({ x,y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-1, life:0.5+Math.random()*0.4, max:0.9,
      r:2+Math.random()*3, col:Math.random()<0.5?'#ff7a2e':'#ffd24a' }); }
  game.particles.push({ x,y, vx:0,vy:0, life:0.18,max:0.18, r:r, col:'#fff', flash:true });
}
function spawnMuzzleFlash(x,y,angle){
  for(let i=0;i<6;i++){ const a=-angle+(Math.random()-0.5)*0.6, sp=Math.random()*3+1;
    game.particles.push({ x,y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0.22,max:0.22, r:1.5+Math.random()*2, col:'#ffd24a' }); }
}
function spawnSplash(x){
  for(let i=0;i<14;i++){ const a=-Math.PI/2+(Math.random()-0.5)*1.4, sp=Math.random()*4+2;
    game.particles.push({ x, y:game.waterLine, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0.6,max:0.6, r:2+Math.random()*2, col:'#bfe4ff' }); }
}
function spawnFloatText(x,y,txt,col){ game.particles.push({ x,y, vx:0,vy:-0.5, life:1.0,max:1.0, txt, col, text:true }); }
function updateParticles(){
  for(let i=game.particles.length-1;i>=0;i--){ const p=game.particles[i]; p.life-=DT;
    if(!p.flash&&!p.text){ p.vy+=0.12; p.x+=p.vx; p.y+=p.vy; } if(p.text) p.y+=p.vy;
    if(p.life<=0) game.particles.splice(i,1); }
}
function drawParticles(){
  for(const p of game.particles){ const a=clamp01(p.life/p.max);
    if(p.flash){ ctx.fillStyle=`rgba(255,255,255,${a*0.6})`; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*(1.2-a*0.4),0,6.2832); ctx.fill(); continue; }
    if(p.text){ ctx.globalAlpha=a; ctx.fillStyle=p.col; ctx.font='bold 14px Trebuchet MS'; ctx.textAlign='center'; ctx.fillText(p.txt,p.x,p.y); ctx.globalAlpha=1; continue; }
    ctx.fillStyle=p.col; ctx.globalAlpha=a; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.2832); ctx.fill(); ctx.globalAlpha=1; }
}

/* ----------------------------- HUD ------------------------------------- */
function teamHP(t){ return teamWorms(t).reduce((s,w)=>s+Math.max(0,w.hp),0); }
function teamMaxHP(t){ return teamWorms(t).length*100; }
function drawHUD(){
  const N=game.teams.length;
  const cardW=Math.min(230,(W-40)/N - 10), gap=10, total=N*cardW+(N-1)*gap;
  let x=(W-total)/2;
  for(let t=0;t<N;t++){ drawTeamCard(t,x,12,cardW); x+=cardW+gap; }
  // wind + timer panel (centre, just below cards)
  const cx=W/2, py=66;
  ctx.fillStyle='rgba(0,0,0,0.45)'; rr(ctx,cx-130,py,260,52,8); ctx.fill();
  const tt=game.phase===Phase.RETREATING?game.retreatTimer:game.turnTimer;
  const label=game.phase===Phase.RETREATING?'RETREAT':game.phase===Phase.AI_THINK?'BOT…':'TIME';
  ctx.textAlign='left'; ctx.fillStyle=(tt<=5&&game.phase!==Phase.AI_THINK)?'#ff5a4d':'#cfe0f7'; ctx.font='bold 24px Trebuchet MS';
  ctx.fillText(Math.max(0,Math.ceil(tt)),cx-118,py+34);
  ctx.fillStyle='#8fa6c9'; ctx.font='10px Trebuchet MS'; ctx.fillText(label,cx-118,py+46);
  // wind gauge
  ctx.textAlign='center'; ctx.fillStyle='#8fa6c9'; ctx.font='9px Trebuchet MS'; ctx.fillText('WIND',cx+40,py+14);
  const wx=cx+40, wy=py+30, mag=game.wind;
  ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(wx-55,wy); ctx.lineTo(wx+55,wy); ctx.stroke();
  ctx.strokeStyle=Math.abs(mag)<0.05?'#666':'#7fd0ff'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(wx,wy); ctx.lineTo(wx+mag*50,wy); ctx.stroke();
  if(Math.abs(mag)>=0.05){ const dir=Math.sign(mag),ex=wx+mag*50; ctx.fillStyle='#7fd0ff';
    ctx.beginPath(); ctx.moveTo(ex,wy); ctx.lineTo(ex-dir*7,wy-4); ctx.lineTo(ex-dir*7,wy+4); ctx.fill(); }
  // turn banner
  ctx.textAlign='center'; ctx.font='bold 14px Trebuchet MS'; ctx.fillStyle=game.teams[game.activeTeam].color;
  ctx.fillText(game.teams[game.activeTeam].name+"'S TURN",cx,py+50+20);
  if(game.suddenDeath){ ctx.fillStyle='#ff5a4d'; ctx.font='bold 12px Trebuchet MS'; ctx.fillText('⚠ SUDDEN DEATH — water rising',cx,py+50+38); }
  drawWeaponBar();
}
function drawTeamCard(t,x,y,w){
  const h=44, team=game.teams[t], active=(t===game.activeTeam);
  ctx.fillStyle=active?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.4)'; rr(ctx,x,y,w,h,8); ctx.fill();
  if(active){ ctx.strokeStyle=team.color; ctx.lineWidth=2; rr(ctx,x,y,w,h,8); ctx.stroke(); }
  ctx.fillStyle=team.color; ctx.font='bold 14px Trebuchet MS'; ctx.textAlign='left';
  const aliveN=teamWorms(t).filter(wm=>!wm.dead).length;
  let nm=team.name; if(nm.length>14) nm=nm.slice(0,13)+'…';
  ctx.fillText(nm+'  ('+aliveN+')',x+12,y+19);
  const bx=x+12,by=y+26,bw=w-24;
  ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fillRect(bx,by,bw,9);
  ctx.fillStyle=team.color; const mx=teamMaxHP(t), ratio=mx>0?teamHP(t)/mx:0; ctx.fillRect(bx,by,bw*clamp01(ratio),9);
  ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,9);
}
let weaponBarRects=[];
function drawWeaponBar(){
  weaponBarRects=[];
  const slot=88,gap=8,total=WEAPONS.length*slot+(WEAPONS.length-1)*gap;
  let x=(W-total)/2,y=H-58;
  for(const wpn of WEAPONS){
    const sel=wpn.id===game.selectedWeapon, ammo=teamAmmo(game.activeTeam,wpn.id), out=ammo<=0;
    ctx.fillStyle=sel?'rgba(255,209,102,0.22)':'rgba(0,0,0,0.45)'; rr(ctx,x,y,slot,46,7); ctx.fill();
    ctx.strokeStyle=sel?'#ffd166':(out?'#5a2b2b':'#33486e'); ctx.lineWidth=sel?2.5:1.5; rr(ctx,x,y,slot,46,7); ctx.stroke();
    drawWeaponGlyph(wpn.id,x+15,y+16,out);
    ctx.fillStyle=out?'#777':'#e8eef7'; ctx.font='bold 11px Trebuchet MS'; ctx.textAlign='left'; ctx.fillText(wpn.name,x+28,y+15);
    ctx.fillStyle='#8fa6c9'; ctx.font='10px Trebuchet MS'; ctx.fillText('['+wpn.key+']',x+28,y+28);
    ctx.textAlign='right'; ctx.fillStyle=out?'#e8503a':'#cfe0f7'; ctx.font='bold 11px Trebuchet MS'; ctx.fillText(ammo===Infinity?'∞':ammo,x+slot-8,y+40);
    ctx.textAlign='left'; weaponBarRects.push({id:wpn.id,x,y,w:slot,h:46}); x+=slot+gap;
  }
}
function drawWeaponGlyph(id,cx,cy,out){
  ctx.save(); ctx.translate(cx,cy);
  if(out){ ctx.globalAlpha=0.4; }
  if(id==='bazooka'){ ctx.fillStyle='#41603e'; rr(ctx,-7,-3,13,6,2); ctx.fill(); ctx.fillStyle='#1d2a1b'; ctx.fillRect(6,-3,2,6); ctx.fillStyle='#ff7a2e'; ctx.beginPath(); ctx.moveTo(-7,-3); ctx.lineTo(-10,0); ctx.lineTo(-7,3); ctx.fill(); }
  else if(id==='grenade'){ drawGrenadeIcon(0,0,5,0); }
  else if(id==='cluster'){ ctx.fillStyle='#6a5a7a'; ctx.beginPath(); ctx.arc(0,0,5,0,6.28); ctx.fill(); for(let a=0;a<6;a++){ const an=a/6*6.28; ctx.fillRect(Math.cos(an)*4-1,Math.sin(an)*4-1,2,2);} }
  else if(id==='shotgun'){ ctx.fillStyle='#5b3a1f'; ctx.fillRect(-7,-1,4,5); ctx.fillStyle='#c9ccd1'; ctx.fillRect(-4,-2,11,3); }
  else if(id==='dynamite'){ drawDynamiteIcon(0,1,0.7,1); }
  else if(id==='airstrike'){ ctx.fillStyle='#5b6b7a'; rr(ctx,-6,-2,12,5,2); ctx.fill(); ctx.fillStyle='#e0483c'; ctx.beginPath(); ctx.moveTo(6,-2); ctx.lineTo(9,0.5); ctx.lineTo(6,3); ctx.fill(); }
  ctx.globalAlpha=1; ctx.restore();
}

/* ----------------------------- LOOP ------------------------------------ */
let acc=0,last=0;
function frame(now){
  if(!running) return;
  if(!last) last=now;
  let ft=(now-last)/1000; last=now; if(ft>0.25) ft=0.25; acc+=ft;
  let guard=0; while(acc>=DT&&guard<6){ update(); acc-=DT; guard++; } if(guard>=6) acc=0;
  if(game) render();
  requestAnimationFrame(frame);
}

/* ----------------------------- SETUP ----------------------------------- */
function placeWorms(heights,N,wpt){
  const worms=[]; let id=0; const slots=N*wpt, margin=110, span=W-margin*2;
  for(let i=0;i<slots;i++){
    let x=margin+span*(i/(slots-1))+(Math.random()-0.5)*40; x=clamp(x,60,W-60);
    const surf=heights[Math.round(clamp(x,0,W-1))];
    const team=i%N;
    worms.push({ id:id++, team, x, y:surf-WORM_R-1, vx:0, vy:0, hp:100, maxHp:100,
      facing: x < W/2 ? 1 : -1, angle:Math.PI/4, grounded:true, dead:false, tookDamageThisTurn:false });
  }
  return worms;
}
function newGame(opts){
  opts=opts||{};
  const defs = opts.teams || [
    { name:'YOU', color:TEAM_PRESETS[0].color, isAI:false },
    { name:'CPU', color:TEAM_PRESETS[1].color, isAI:true, difficulty:opts.difficulty||'medium' }
  ];
  const wpt=opts.wormsPerTeam||4;
  const heights=generateTerrain();
  const N=defs.length;
  game={ phase:Phase.AIMING,
    teams:defs.map((t,i)=>({ id:i, name:t.name||TEAM_PRESETS[i].name, color:t.color||TEAM_PRESETS[i].color,
      dark:t.dark||TEAM_PRESETS[i%4].dark, isAI:!!t.isAI, difficulty:t.difficulty||'medium', controllerId:t.controllerId||null })),
    worms:placeWorms(heights,N,wpt), activeTeam:0, activeWorm:null,
    cursor:new Array(N).fill(-1), ammo:Array.from({length:N},()=>({})),
    wind:0, selectedWeapon:'bazooka', charge:0, turnTimer:TURN_TIME, retreatTimer:0, settleTimer:0,
    hasFired:false, projectiles:[], particles:[], tracers:[], waterLine:SEA_LEVEL, turnNo:0,
    suddenDeath:false, winner:null, ai:null };
  for(let t=0;t<N;t++) for(const wpn of WEAPONS) if(wpn.ammo!==Infinity) game.ammo[t][wpn.id]=wpn.ammo;
  startTurn(0);
  return game;
}

/* ----------------------------- INPUT (control entry points) ------------ */
function selectWeapon(id){ if(!hasAmmo(game.activeTeam,id)) return; game.selectedWeapon=id;
  if(game.phase===Phase.CHARGING){ game.phase=Phase.AIMING; game.charge=0; } }
function cycleWeapon(dir){ let i=WEAPONS.findIndex(w=>w.id===game.selectedWeapon);
  for(let n=0;n<WEAPONS.length;n++){ i=(i+dir+WEAPONS.length)%WEAPONS.length;
    if(hasAmmo(game.activeTeam,WEAPONS[i].id)){ selectWeapon(WEAPONS[i].id); return; } } }
function canAct(teamIndex){ return game && game.activeWorm && game.activeTeam===teamIndex
  && !game.teams[teamIndex].isAI && (game.phase===Phase.AIMING||game.phase===Phase.RETREATING); }

// Network/local control surface (teamIndex = the controlling team)
function ctrlSetAim(teamIndex,angle){ if(canAct(teamIndex)){ const w=game.activeWorm;
  w.angle=clamp(angle,-0.5,Math.PI+0.5); w.facing=Math.cos(w.angle)>=0?1:-1; } }
function ctrlMove(teamIndex,dir){ if(game.activeTeam===teamIndex) heldMove=(dir|0); }
function ctrlJump(teamIndex){ if(canAct(teamIndex)&&game.activeWorm.grounded){ const w=game.activeWorm; w.vy=JUMP_VY; w.vx=w.facing*JUMP_VX; w.grounded=false; } }
function ctrlWeapon(teamIndex,id){ if(game.activeTeam===teamIndex && (game.phase===Phase.AIMING||game.phase===Phase.RETREATING)) selectWeapon(id); }
function ctrlFire(teamIndex,power,targetX){
  if(game.activeTeam!==teamIndex||game.phase!==Phase.AIMING) return false;
  const wpn=currentWeapon(); if(!hasAmmo(teamIndex,wpn.id)) return false;
  if(wpn.aim==='targetPoint') return fireWeapon(1,(targetX!=null?targetX:game.activeWorm.x));
  if(wpn.aim==='instant'||wpn.aim==='drop') return fireWeapon(1);
  return fireWeapon(clamp01(power!=null?power:0.5));
}
// A controller left: hand its team to the AI so the game never deadlocks.
function makeTeamBot(teamIndex,diff){
  if(!game||!game.teams[teamIndex]) return;
  const t=game.teams[teamIndex]; t.isAI=true; t.difficulty=diff||t.difficulty||'medium'; t.controllerId=null;
  if(game.activeTeam===teamIndex && (game.phase===Phase.AIMING||game.phase===Phase.CHARGING)){
    game.charge=0; game.ai=null; game.phase=Phase.AI_THINK;   // let the bot take over this turn (not yet fired)
  }
}
// A waiting player took over a team: relabel it.
function setTeamController(teamIndex,name,controllerId){
  if(!game||!game.teams[teamIndex]) return;
  if(name) game.teams[teamIndex].name=name;
  game.teams[teamIndex].isAI=false;
  if(controllerId!=null) game.teams[teamIndex].controllerId=controllerId;
}

// compact status for a controller phone
function statusFor(teamIndex){
  if(!game) return null;
  const team=game.teams[teamIndex];
  const yourTurn=game.activeTeam===teamIndex && !team.isAI &&
    (game.phase===Phase.AIMING||game.phase===Phase.RETREATING);
  return { phase:game.phase, yourTurn, retreat:game.phase===Phase.RETREATING,
    activeTeam:game.activeTeam, activeName:game.teams[game.activeTeam]?game.teams[game.activeTeam].name:'',
    activeColor:game.teams[game.activeTeam]?game.teams[game.activeTeam].color:'#fff',
    weapon:game.selectedWeapon, wind:Math.round(game.wind*100)/100,
    timer:Math.max(0,Math.ceil(game.phase===Phase.RETREATING?game.retreatTimer:game.turnTimer)),
    ammo:game.ammo[teamIndex], color:team.color, name:team.name,
    alive:teamWorms(teamIndex).filter(w=>!w.dead).length, winner:game.winner,
    suddenDeath:!!game.suddenDeath };
}

/* ----------------------------- LOCAL INPUT (keyboard/mouse) ------------ */
const keys={}, mouse={x:W/2,y:H/2,down:false};
function enableLocalInput(){
  localInput=true;
  function toCanvas(e){ const r=canvas.getBoundingClientRect();
    mouse.x=(e.clientX-r.left)/r.width*W; mouse.y=(e.clientY-r.top)/r.height*H; }
  canvas.addEventListener('mousemove',e=>{ toCanvas(e);
    if(canAct(game.activeTeam)&&currentWeapon().aim!=='drop'&&currentWeapon().aim!=='targetPoint')
      ctrlSetAim(game.activeTeam,Math.atan2(game.activeWorm.y-mouse.y,mouse.x-game.activeWorm.x)); });
  canvas.addEventListener('mousedown',e=>{ if(e.button!==0) return; toCanvas(e);
    if(barClick(mouse.x,mouse.y)) return; if(!canAct(game.activeTeam)) return; mouse.down=true; beginLocalFire(); });
  window.addEventListener('mouseup',e=>{ if(e.button!==0) return; mouse.down=false; endLocalFire(); });
  window.addEventListener('keydown',e=>{ if(!game||game.phase===Phase.MENU) return;
    const k=e.key.toLowerCase(); keys[k]=true;
    if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
    const byKey=WEAPONS.find(w=>w.key===e.key); if(byKey&&canAct(game.activeTeam)){ selectWeapon(byKey.id); return; }
    if(k==='q'&&canAct(game.activeTeam)){ cycleWeapon(-1); return; }
    if(k==='e'&&canAct(game.activeTeam)){ cycleWeapon(1); return; }
    if(k==='j'){ ctrlJump(game.activeTeam); return; }
    if((k===' '||k==='enter')&&canAct(game.activeTeam)){ if(!e.repeat) beginLocalFire(); return; }
    if(k==='arrowleft'||k==='a') heldMove=-1; if(k==='arrowright'||k==='d') heldMove=1;
  });
  window.addEventListener('keyup',e=>{ const k=e.key.toLowerCase(); keys[k]=false;
    if((k===' '||k==='enter')) endLocalFire();
    if(k==='arrowleft'||k==='a'||k==='arrowright'||k==='d'){ if(!keys['arrowleft']&&!keys['a']&&!keys['arrowright']&&!keys['d']) heldMove=0; }
  });
  // keyboard aim (held) handled in a small ticker via render loop hook
  setInterval(()=>{ if(!game||!canAct(game.activeTeam)) return; const w=game.activeWorm;
    if(keys['arrowup']||keys['w']) ctrlSetAim(game.activeTeam,Math.min(Math.PI-0.05,w.angle+0.03));
    if(keys['arrowdown']||keys['s']) ctrlSetAim(game.activeTeam,Math.max(-0.35,w.angle-0.03)); },16);
}
function beginLocalFire(){ if(game.phase!==Phase.AIMING) return; const wpn=currentWeapon(); if(!hasAmmo(game.activeTeam,wpn.id)) return;
  if(wpn.aim==='chargedAngle'){ game.phase=Phase.CHARGING; game.charge=0; }
  else if(wpn.aim==='instant'||wpn.aim==='drop') fireWeapon(1);
  else if(wpn.aim==='targetPoint') fireWeapon(1,mouse.x); }
function endLocalFire(){ if(game.phase===Phase.CHARGING) fireWeapon(game.charge); }
function barClick(mx,my){ if(game.phase!==Phase.AIMING&&game.phase!==Phase.RETREATING) return false;
  for(const r of weaponBarRects){ if(mx>=r.x&&mx<=r.x+r.w&&my>=r.y&&my<=r.y+r.h){ if(hasAmmo(game.activeTeam,r.id)) selectWeapon(r.id); return true; } } return false; }

/* ----------------------------- PUBLIC API ------------------------------ */
function init(canvasEl){
  canvas=canvasEl; ctx=canvas.getContext('2d');
  terrainCanvas=document.createElement('canvas'); terrainCanvas.width=W; terrainCanvas.height=H;
  tctx=terrainCanvas.getContext('2d',{willReadFrequently:true});
  mask=new Uint8Array(W*H);
}
function start(){ if(running) return; running=true; last=0; acc=0; requestAnimationFrame(frame); }
function stop(){ running=false; }

return {
  W, H, Phase, WEAPONS, WBYID, AI_DIFF, TEAM_PRESETS,
  init, start, stop, newGame, update, render,
  enableLocalInput, ctrlSetAim, ctrlMove, ctrlJump, ctrlWeapon, ctrlFire, statusFor,
  makeTeamBot, setTeamController,
  cycleWeapon, selectWeapon,
  get game(){ return game; },
  on(name,fn){ if(name in callbacks) callbacks[name]=fn; },
  worldToTeamPoint(px){ return clamp(px,0,W); }
};
})();
