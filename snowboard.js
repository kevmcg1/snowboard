/* =========================================================================
   A SNOWBOARDING GAME — a 3D snowboarding game
   Sections: 1 math/noise  2 course  3 terrain mesh  4 world  5 rider
             6 physics     7 camera  8 fx  9 audio 10 ui 11 loop
   ========================================================================= */
'use strict';
const V3 = THREE.Vector3;
const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
const lerp  = (a,b,t)=> a+(b-a)*t;
const damp  = (a,b,rate,dt)=> lerp(a,b,1-Math.exp(-rate*dt));
const TAU = Math.PI*2;
const $ = id => document.getElementById(id);

/* The simulation runs in metres/second; every number shown to the player is
   imperial. These are the only two places the conversion happens. */
const FT = 3.28084;          // metres -> feet
const MPH = 2.2369363;       // m/s    -> miles per hour
const BASE_ALT_FT = 9200;    // summit elevation, feet
const ft  = m  => Math.round(m*FT);
const mph = ms => Math.round(ms*MPH);
const angDiff = (a,b)=> ((a-b+Math.PI*3) % TAU) - Math.PI;

/* ---------------- 1. deterministic noise ---------------- */
function fract(x){ return x - Math.floor(x); }
function hash2(i,j){ return fract(Math.sin(i*127.1 + j*311.7) * 43758.5453123); }
function fade(t){ return t*t*(3-2*t); }
function vnoise(x,z){
  const i=Math.floor(x), j=Math.floor(z);
  const fx=fade(x-i), fz=fade(z-j);
  const a=hash2(i,j), b=hash2(i+1,j), c=hash2(i,j+1), d=hash2(i+1,j+1);
  return lerp(lerp(a,b,fx), lerp(c,d,fx), fz);
}
function fbm(x,z,oct){
  let s=0,amp=1,f=1,norm=0;
  for(let o=0;o<oct;o++){ s += amp*(vnoise(x*f,z*f)*2-1); norm+=amp; amp*=0.5; f*=2.13; }
  return s/norm;
}
function mulberry32(a){
  return function(){
    a|=0; a = a+0x6D2B79F5|0;
    let t = Math.imul(a^a>>>15, 1|a);
    t = t + Math.imul(t^t>>>7, 61|t) ^ t;
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  };
}

/* ---------------- 2. course definition ---------------- */
/* COURSE is filled in from the chosen map before anything is generated. */
const COURSE = { length: 4300, finishZ: 4180, halfWidth: 112, meshHalf: 167 };

/* Each map is a whole mountain: its own pitch, width, tree line, jump count and
   time of day. `grade` is tan(slope angle); the terrain detail added on top is
   always kept shallower than it so the fall line never points uphill. */
const MAPS = {
  bowl: {
    name:'Powder Bowl', blurb:'Wide, forgiving rollers. Room to open it up.',
    feel:'Nice and mellow', color:'#63d3ff', icon:'bowl',
    seed:10240, length:3800, halfWidth:124, grade:0.32, wobble:0.08,
    kickers:18, trees:0.5, rocks:0.5, mogul:0.6, sky:'day'
  },
  timber: {
    name:'Timberline', blurb:'Tight glades and mogul fields between the pines.',
    feel:'Bumpy and busy', color:'#4ddb90', icon:'tree',
    seed:77012, length:4300, halfWidth:104, grade:0.38, wobble:0.10,
    kickers:24, trees:1.35, rocks:1.0, mogul:1.3, sky:'day'
  },
  couloir: {
    name:'The Couloir', blurb:'Steep, narrow and unforgiving. Rock either side.',
    feel:'Seriously steep', color:'#ff6b6b', icon:'chute',
    seed:31337, length:4000, halfWidth:74, grade:0.50, wobble:0.14,
    kickers:26, trees:1.5, rocks:1.8, mogul:1.2, sky:'day'
  },
  glacier: {
    name:'Glacier Run', blurb:'Long, icy and fast, with a jump line all the way down.',
    feel:'Long and fast', color:'#a98bff', icon:'ice',
    seed:90210, length:5200, halfWidth:132, grade:0.43, wobble:0.06,
    kickers:34, trees:0.3, rocks:0.6, mogul:0.35, sky:'day'
  },
  dusk: {
    name:'Last Light', blurb:'Golden hour on the ridge. Long shadows, low sun.',
    feel:'Sunset cruise', color:'#ffb648', icon:'sun',
    seed:20260905, length:4300, halfWidth:110, grade:0.40, wobble:0.12,
    kickers:26, trees:1.0, rocks:1.0, mogul:1.0, sky:'dusk'
  }
};

/* Little line-art glyphs for the map picker, one per mountain. */
const MAP_ICONS = {
  bowl:  '<path d="M2 7c0 7 4 11 10 11s10-4 10-11" /><path d="M2 7h20" />',
  tree:  '<path d="M12 2 5 12h4l-4 7h14l-4-7h4z" /><path d="M12 19v3" />',
  chute: '<path d="M6 2 2 22" /><path d="M18 2l4 20" /><path d="M9 8h6" /><path d="M8 15h8" />',
  ice:   '<path d="M12 2v20M4 6l16 12M20 6L4 18" />',
  sun:   '<circle cx="12" cy="13" r="5" /><path d="M12 2v3M3 13H1M23 13h-2M4.9 5.9 3.5 4.5M19.1 5.9l1.4-1.4M1 21h22" />'
};

/* Sky/light palettes a map can select. */
const SKIES = {
  day: {
    top:[0.129,0.373,0.667], mid:[0.545,0.784,0.941], bot:[0.886,0.937,0.976],
    sunDir:[-0.45,0.42,-0.78], glow:[1.0,0.94,0.82], glowAmt:0.55,
    sun:0xfff2d6, sunI:1.45, hemiSky:0xdcecff, hemiGnd:0x8fa8c0, hemiI:0.55,
    amb:0xa9c4e0, ambI:0.16, fog:0xe2eff9, fogNear:170,
    peakHue:0.585, peakSat:0.20, snowTint:[1,1,1], sunPos:[-120,110,-95]
  },
  dusk: {
    top:[0.078,0.114,0.290], mid:[0.478,0.396,0.588], bot:[0.976,0.706,0.451],
    sunDir:[0.62,0.16,-0.77], glow:[1.0,0.72,0.40], glowAmt:1.25,
    sun:0xffb26b, sunI:1.55, hemiSky:0xffcfa0, hemiGnd:0x3f4a68, hemiI:0.42,
    amb:0x6f83ab, ambI:0.24, fog:0xf9b473, fogNear:140,
    peakHue:0.075, peakSat:0.26, snowTint:[1.03,0.93,0.88], sunPos:[130,64,-90]
  }
};

const CFG = {
  gravity: 22,
  frictionSnow: 0.052,     // base friction coefficient
  dragUpright: 0.0139,     // quadratic drag (air + snow displacement)
  dragTuck:    0.0080,
  dragAir:     0.0016,
  dragPowder:  0.055,      // off-piste
  gripBase: 5.0,           // lateral velocity bleed 1/s
  gripCarve: 12.5,
  gripBrake: 22.0,
  brakeDecel: 11.0,
  steerRate: 2.35,
  steerFalloff: 0.048,
  airYaw: 5.2,
  airPitch: 3.6,
  assistWindow: 0.75,      // seconds before touchdown that the board squares up
  groundAlign: 1.9,        // how hard a free-riding board tracks its own travel
  ollie: 9.6,
  maxCharge: 0.9,
  boostAccel: 3.0,         // forward push while a trick boost is burning
  crashAngle: 68 * Math.PI/180,
  treeR: 1.75,
  rockR: 1.45
};

// world data, rebuilt per run
const world = {
  seed: 1337, map: MAPS.timber, sky: SKIES.day,
  kickers: [], kickBuckets: new Map(),
  trees: [], rocks: [], gates: [], props: new Map()
};

function bucketOf(z){ return Math.floor(z/120); }

function buildCourse(seed, map){
  const rnd = mulberry32(seed);
  const diff = map;
  world.seed = seed; world.map = map; world.sky = SKIES[map.sky] || SKIES.day;
  COURSE.length    = map.length;
  COURSE.finishZ   = map.length - 120;
  COURSE.halfWidth = map.halfWidth;
  COURSE.meshHalf  = map.halfWidth + 55;
  /* The mountain runs out into a lake in the valley floor. The shoreline starts
     well past the finish line, so the run always ends on snow — you stop, the
     water is scenery you coast toward and never reach. */
  COURSE.shoreZ = COURSE.finishZ + 210;
  // Water sits only a little below the finish elevation. Drop it much further
  // and the run-out becomes a convex brow you cannot see over — the lake ends
  // up hidden behind the very slope that leads to it.
  const dEnd = map.grade*COURSE.finishZ
             - (map.wobble/0.0012)*Math.cos(0.0012*COURSE.finishZ)
             + (map.wobble/0.0012);
  COURSE.lakeY = -dEnd - 26;
  world.kickers = []; world.kickBuckets = new Map();
  world.trees = []; world.rocks = []; world.gates = []; world.props = new Map();

  // --- kickers (jumps built into the terrain height field) ---
  const n = diff.kickers;
  for(let i=0;i<n;i++){
    const z = 320 + (i+rnd()*0.6)*( (COURSE.length-580)/n );
    const x = (rnd()*2-1) * COURSE.halfWidth * 0.55;
    // A kicker is described by how steep its lip is, not by raw height, so every
    // jump launches at a sane angle regardless of size.
    const big = rnd();
    const h = 2.4 + big*2.3;                 // lip height above the slope
    // lip angle is measured against the local fall line, so every jump pops
    const rise = slopeGrade(z) + 0.26 + rnd()*0.18;
    const k = {
      x, z,
      w: 11 + rnd()*8,                       // lateral half-width — wide enough to hit
      h,
      rise,
      len: 2.45*h/rise,                      // run-up length that yields `rise`
      tail: 5 + rnd()*4,                     // back-side drop
      built: rnd() < 0.42                    // every so often, a proper built ramp
    };
    world.kickers.push(k);
    const b0=bucketOf(k.z-k.len-8), b1=bucketOf(k.z+k.tail+8);
    for(let b=b0;b<=b1;b++){
      if(!world.kickBuckets.has(b)) world.kickBuckets.set(b,[]);
      world.kickBuckets.get(b).push(k);
    }
  }

  // --- gates (slalom) --- everything below is sized off the piste width
  const hw = COURSE.halfWidth;
  for(let z=420; z<COURSE.finishZ-120; z+=175+rnd()*90){
    const x = raceLine(z) + (rnd()*2-1)*hw*0.18;
    world.gates.push({x, z, w:5.6, passed:false});
  }

  // --- trees: dense at the edges, scattered glades in the middle ---
  const tCount = Math.floor(1500 * diff.trees * (COURSE.length/4300));
  for(let i=0;i<tCount;i++){
    let x, z = 120 + rnd()*(COURSE.length-160);
    const edge = rnd();
    if(edge < 0.84){ // treeline, just outside the markers and back into the woods
      x = (rnd()<0.5?-1:1) * (hw*0.70 + rnd()*hw*0.75);
    } else {         // glade — kept clear of the central lane
      x = (rnd()<0.5?-1:1) * (hw*0.27 + rnd()*hw*0.42);
    }
    if(nearKicker(x,z,20) || nearGate(x,z,10)) continue;
    world.trees.push({x, z, s: 0.75 + rnd()*0.85, r: rnd()*TAU});
  }
  // --- rocks ---
  const rCount = Math.floor(340 * diff.rocks * (COURSE.length/4300));
  for(let i=0;i<rCount;i++){
    const z = 200 + rnd()*(COURSE.length-260);
    const x = (rnd()<0.5?-1:1) * (hw*0.16 + rnd()*hw*0.80);
    if(nearKicker(x,z,18) || nearGate(x,z,9)) continue;
    world.rocks.push({x, z, s: 0.7+rnd()*1.5, r: rnd()*TAU, ry: rnd()*TAU});
  }
  // spatial buckets for collision
  const put=(arr,type)=>arr.forEach((o,i)=>{
    const b = bucketOf(o.z);
    if(!world.props.has(b)) world.props.set(b,[]);
    world.props.get(b).push({o,type});
  });
  put(world.trees,'tree'); put(world.rocks,'rock');
}
function nearKicker(x,z,pad){
  const list = world.kickBuckets.get(bucketOf(z));
  if(!list) return false;
  for(const k of list){
    if(Math.abs(x-k.x) < k.w+pad && z > k.z-k.len-pad && z < k.z+k.tail+pad+14) return true;
  }
  return false;
}
function nearGate(x,z,pad){
  for(const g of world.gates){ if(Math.abs(g.z-z)<pad+4 && Math.abs(g.x-x)<g.w+pad) return true; }
  return false;
}

/* The ideal line down this course — gates sit on it and the rivals chase it. */
function raceLine(z){ return Math.sin(z*0.0042)*COURSE.halfWidth*0.46; }

/* ---------------- terrain height field ----------------
   y is negative-going: the hill descends as z increases. */
function descent(z){
  const d = world.map;
  // integral of  grade(z) = d.grade + d.wobble*sin(0.0012 z)  -> always > 0
  return d.grade*z - (d.wobble/0.0012)*Math.cos(0.0012*z) + (d.wobble/0.0012);
}
function slopeGrade(z){ return world.map.grade + world.map.wobble*Math.sin(0.0012*z); }

function terrainH(x,z){
  let y = -descent(z);

  // valley cross-section: gentle bowl, then hard banks that keep you on course
  const ax = Math.abs(x);
  y += 0.0010*x*x;                              // gentle bowl: gravity nudges you back to the fall line
  const over = Math.max(0, ax - (COURSE.halfWidth - 20));
  y += (over*over)*0.007;                       // banked edges of the piste

  // rolling terrain (low frequency so its own slope stays well under `grade`)
  // x is stretched so rolls run down the fall line and cross-slope tilt stays mild
  y += fbm(x*0.0022, z*0.0055, 3) * 9.5;
  y += fbm(x*0.011,  z*0.026,  2) * 1.0;

  // mogul fields in bands
  const band = Math.max(0, Math.sin(z*0.0016 + 1.1));
  y += band * 0.45 * world.map.mogul * Math.sin(x*0.33) * Math.sin(z*0.30);

  // groomed corduroy ripple on the piste
  if(ax < COURSE.halfWidth) y += 0.045*Math.sin(x*1.5);

  /* The last stretch is a run-out: the grade eases off into a flat apron, then
     slides gently under the waterline. Kept shallow so the water stays in view
     the whole way down rather than hiding behind the slope. */
  const shore = COURSE.finishZ - 40;
  if(z > shore){
    const t = clamp((z - shore)/300, 0, 1);
    const s = t*t*(3-2*t);
    y = lerp(y, COURSE.lakeY - 6, s);
  }

  return y + kickerLift(x, z);
}

/* How much a kicker raises the snow at this point. Shared by the height field,
   the terrain shading (so jumps are visible against the white) and the built
   ramp meshes (so the structure sits exactly on the surface you ride). */
function kickerLift(x, z){
  const list = world.kickBuckets.get(bucketOf(z));
  if(!list) return 0;
  let lift = 0;
  for(let i=0;i<list.length;i++){
    const k = list[i];
    const dx = x-k.x;
    if(Math.abs(dx) > k.w*2.2) continue;
    const dz = z-k.z;
    let f = 0;
    if(dz > -k.len && dz <= 0){
      const t = (dz+k.len)/k.len;
      f = k.h * t*t*(0.55+0.45*t);            // concave ramp into a lip
    } else if(dz > 0 && dz < k.tail){
      f = k.h * (1 - dz/k.tail) * 0.55;       // short back-side
    }
    // a flat-topped falloff keeps the middle of the ramp genuinely flat, so you
    // launch the same whether you hit it dead centre or a little off
    if(f > 0){
      const u = Math.abs(dx)/k.w;
      const g = u < 0.55 ? 1 : Math.exp(-Math.pow((u-0.55)*2.0, 2));
      lift += f*g;
    }
  }
  return lift;
}

const _n1=new V3(), _n2=new V3();
function terrainN(x,z,out){
  const e = 0.65;
  const hL = terrainH(x-e,z), hR = terrainH(x+e,z);
  const hD = terrainH(x,z-e), hU = terrainH(x,z+e);
  out = out || new V3();
  out.set(-(hR-hL)/(2*e), 1, -(hU-hD)/(2*e)).normalize();
  return out;
}

/* ---------------- 3. renderer + scene ---------------- */
let renderer, scene, camera, sky, sun, sunTarget, mountains, snowfall, spray, terrainGroup, hemi, amb;
let QUALITY = 'high';

/* Push the selected map's palette into the sky, the lights and the fog. */
function applySky(){
  const s = world.sky || SKIES.day;
  const u = sky.material.uniforms;
  u.uTop.value.fromArray(s.top);
  u.uMid.value.fromArray(s.mid);
  u.uBot.value.fromArray(s.bot);
  u.uSunDir.value.fromArray(s.sunDir);
  u.uGlow.value.fromArray(s.glow);
  u.uGlowAmt.value = s.glowAmt;
  hemi.color.setHex(s.hemiSky); hemi.groundColor.setHex(s.hemiGnd); hemi.intensity = s.hemiI;
  amb.color.setHex(s.amb); amb.intensity = s.ambI;
  sun.color.setHex(s.sun); sun.intensity = s.sunI;
  scene.fog.color.setHex(s.fog);
  scene.fog.near = s.fogNear;
  renderer.setClearColor(s.fog, 1);
  buildDistantPeaks();
}

function initRenderer(){
  const canvas = $('scene');
  renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
  // 2x device pixel ratio quadruples the fill cost for very little visible gain
  // on a scene this flat-shaded; 1.5 is the sweet spot even on "High".
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // soft PCF costs ~4x for a blur nobody sees

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc4dcf0, 150, 660);

  camera = new THREE.PerspectiveCamera(62, innerWidth/innerHeight, 0.15, 6000);

  // sky dome — every colour is a uniform so a map can change the time of day
  const skyMat = new THREE.ShaderMaterial({
    uniforms:{
      uTop:{value:new THREE.Vector3()}, uMid:{value:new THREE.Vector3()}, uBot:{value:new THREE.Vector3()},
      uSunDir:{value:new THREE.Vector3()}, uGlow:{value:new THREE.Vector3()}, uGlowAmt:{value:0.55}
    },
    vertexShader:'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:[
      'varying vec3 vP;',
      'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot;',
      'uniform vec3 uSunDir; uniform vec3 uGlow; uniform float uGlowAmt;',
      'void main(){',
      '  float h = clamp(vP.y*0.5+0.5, 0.0, 1.0);',
      '  vec3 c = mix(uBot, uMid, smoothstep(0.34,0.56,h));',
      '  c = mix(c, uTop, smoothstep(0.55,0.98,h));',
      '  float d = max(dot(vP, normalize(uSunDir)), 0.0);',
      '  c += uGlow * (pow(d, 24.0)*uGlowAmt + pow(d, 4.0)*uGlowAmt*0.16);',
      '  gl_FragColor = vec4(c,1.0);',
      '}'
    ].join('\n'),
    side: THREE.BackSide, depthWrite:false, fog:false
  });
  sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 20), skyMat);
  scene.add(sky);

  hemi = new THREE.HemisphereLight(0xdcecff, 0x8fa8c0, 0.55); scene.add(hemi);
  amb = new THREE.AmbientLight(0xa9c4e0, 0.16); scene.add(amb);

  sun = new THREE.DirectionalLight(0xfff2d6, 1.45);
  sun.castShadow = true;
  // a tighter shadow box around the rider: fewer casters in the pass and
  // sharper shadows from the same 1024 map
  // wide enough that the trees, rocks, gates and ramps around you all cast,
  // with the map bumped to keep the edges from going mushy
  sun.shadow.mapSize.set(2048,2048);
  const sc = sun.shadow.camera;
  sc.near = 1; sc.far = 260; sc.left=-70; sc.right=70; sc.top=70; sc.bottom=-70;
  sun.shadow.bias = -0.0016;
  sunTarget = new THREE.Object3D();
  scene.add(sun); scene.add(sunTarget);
  sun.target = sunTarget;

  terrainGroup = new THREE.Group(); scene.add(terrainGroup);

  buildDistantPeaks();
  buildSnowfall();
  buildSpray();
  buildLandingMarker();
  addEventListener('resize', onResize);
}
function onResize(){
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function applyQuality(q){
  QUALITY = q;
  const px = q==='low' ? 0.7 : q==='med' ? 1 : Math.min(devicePixelRatio, 1.5);
  renderer.setPixelRatio(px);
  renderer.shadowMap.enabled = (q !== 'low');
  scene.fog.far = q==='low' ? 380 : q==='med' ? 480 : 560;
  if(snowfall) snowfall.visible = q!=='low';
  renderer.setSize(innerWidth, innerHeight);
}

/* distant ridgeline that follows the player so it never gets closer */
function buildDistantPeaks(){
  if(mountains){ scene.remove(mountains); disposeGroup(mountains); }
  const pal = world.sky || SKIES.day;
  mountains = new THREE.Group();
  const rnd = mulberry32(99);
  for(let i=0;i<30;i++){
    const a = (i/30)*TAU + rnd()*0.14;
    const dist = 2300 + rnd()*900;
    const h = 300 + rnd()*620;
    const r = 260 + rnd()*420;
    const geo = new THREE.ConeGeometry(r, h, 5 + Math.floor(rnd()*3), 1);
    // snow cap at the top, hazy rock at the base, so they read as mountains
    const far = (dist-2300)/900;
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count*3);
    const base = new THREE.Color().setHSL(pal.peakHue, pal.peakSat - far*0.06, 0.62 + far*0.14);
    const cap  = new THREE.Color().setHSL(pal.peakHue - 0.005, pal.peakSat*0.5, 0.93 - far*0.05);
    const cc = new THREE.Color();
    for(let v=0; v<pos.count; v++){
      const t = clamp((pos.getY(v)+h*0.5)/h, 0, 1);
      cc.copy(base).lerp(cap, clamp((t-0.45)/0.32, 0, 1));
      cols[v*3]=cc.r; cols[v*3+1]=cc.g; cols[v*3+2]=cc.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols,3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({vertexColors:true, fog:false}));
    m.position.set(Math.cos(a)*dist, h*0.5 - 330, Math.sin(a)*dist);
    m.rotation.y = rnd()*TAU;
    mountains.add(m);
  }
  scene.add(mountains);
}

/* Touchdown marker: a ring laid on the snow where the solver says you land,
   plus a chevron pointing the heading the assist will square you to. */
let landMark = null;
function buildLandingMarker(){
  landMark = new THREE.Group();
  // deep blue reads against snow; a pale ring simply disappears
  const ringMat = new THREE.MeshBasicMaterial({
    color:0x11618f, transparent:true, opacity:0.8, side:THREE.DoubleSide, depthWrite:false, fog:false
  });
  // rings are authored in XY, so lay each one flat onto the group's XZ plane
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.35, 2.95, 44), ringMat);
  const inner = new THREE.Mesh(new THREE.RingGeometry(0.30, 0.66, 22),
    new THREE.MeshBasicMaterial({color:0x0f9ad0, transparent:true, opacity:0.9, side:THREE.DoubleSide, depthWrite:false, fog:false}));
  ring.rotation.x = -Math.PI/2; inner.rotation.x = -Math.PI/2;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.9, 3),
    new THREE.MeshBasicMaterial({color:0x2fae5e, transparent:true, opacity:0.92, depthWrite:false, fog:false}));
  arrow.rotation.x = Math.PI/2;      // cone tip points along the group's +Z
  arrow.position.set(0, 0.22, 4.1);
  landMark.add(ring, inner, arrow);
  landMark.visible = false;
  landMark.matrixAutoUpdate = true;
  scene.add(landMark);
}
const _lm = new V3(), _lmq = new THREE.Quaternion(), _lmm = new THREE.Matrix4();
const _lx = new V3(), _ly = new V3(), _lz = new V3();
function updateLandingMarker(){
  if(!landMark) return;
  const show = landing.valid && !player.grounded && player.state === 'air' && landing.t > 0.12;
  landMark.visible = show;
  if(!show) return;
  landMark.position.set(landing.x, landing.y + 0.09, landing.z);
  terrainN(landing.x, landing.z, _ly);
  _lz.set(Math.sin(landing.yaw), 0, Math.cos(landing.yaw));
  _lx.crossVectors(_ly, _lz).normalize();
  _lz.crossVectors(_lx, _ly).normalize();
  _lmm.makeBasis(_lx, _ly, _lz);
  landMark.quaternion.setFromRotationMatrix(_lmm);
  const pulse = 1 + Math.sin(performance.now()*0.008)*0.06;
  const near = clamp(1 - landing.t/1.4, 0, 1);
  // hold a roughly constant on-screen size however far ahead the landing is
  const dist = camera.position.distanceTo(landMark.position);
  landMark.scale.setScalar(pulse * (0.75 + near*0.3) * clamp(dist/34, 0.85, 2.1));
  landMark.children[0].material.opacity = 0.62 + near*0.33;
}

/* ---------------- particle sprite ---------------- */
function discTexture(soft){
  const c = document.createElement('canvas'); c.width=c.height=64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32,32,0,32,32,32);
  grd.addColorStop(0,'rgba(255,255,255,1)');
  grd.addColorStop(soft?0.35:0.6,'rgba(255,255,255,'+(soft?0.75:0.9)+')');
  grd.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0,0,64,64);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

/* Flakes live in camera space. They are kept out of a cylinder around the
   camera — a flake at 30cm fills the screen with a white disc. */
const SNOW_MIN_R = 9, SNOW_MAX_R = 78;
function seedFlake(pos, i, y){
  const a = Math.random()*TAU;
  const r = SNOW_MIN_R + Math.sqrt(Math.random())*(SNOW_MAX_R-SNOW_MIN_R);
  pos[i*3]   = Math.cos(a)*r;
  pos[i*3+1] = y;
  pos[i*3+2] = Math.sin(a)*r;
}
function buildSnowfall(){
  const N = 800, pos = new Float32Array(N*3);
  for(let i=0;i<N;i++) seedFlake(pos, i, Math.random()*70 - 22);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  snowfall = new THREE.Points(g, new THREE.PointsMaterial({
    size:0.34, map:discTexture(true), transparent:true, opacity:0.7,
    depthWrite:false, sizeAttenuation:true, color:0xffffff, fog:false
  }));
  snowfall.frustumCulled = false;
  scene.add(snowfall);
}

/* snow spray kicked up by the board */
const SPRAY_N = 520;
const sprayState = { pos:null, vel:null, life:null, head:0, geo:null, attr:null, sizes:null };
function buildSpray(){
  const pos = new Float32Array(SPRAY_N*3);
  const sizes = new Float32Array(SPRAY_N);
  for(let i=0;i<SPRAY_N;i++){ pos[i*3+1] = -9999; sizes[i]=0.6; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  sprayState.pos = pos;
  sprayState.vel = new Float32Array(SPRAY_N*3);
  sprayState.life = new Float32Array(SPRAY_N);
  sprayState.geo = g;
  // many small grains read as spray; a few big ones read as beach balls
  spray = new THREE.Points(g, new THREE.PointsMaterial({
    size:0.2, map:discTexture(true), transparent:true, opacity:0.55,
    depthWrite:false, sizeAttenuation:true, color:0xf3fbff
  }));
  spray.frustumCulled = false;
  scene.add(spray);
}
function emitSpray(p, dir, amount, spread, speed){
  const n = Math.min(amount, 16);
  for(let i=0;i<n;i++){
    const idx = sprayState.head; sprayState.head = (sprayState.head+1)%SPRAY_N;
    const o = idx*3;
    sprayState.pos[o]   = p.x + (Math.random()*2-1)*0.75;
    sprayState.pos[o+1] = p.y + Math.random()*0.25;
    sprayState.pos[o+2] = p.z + (Math.random()*2-1)*0.75;
    sprayState.vel[o]   = dir.x*speed + (Math.random()*2-1)*spread;
    sprayState.vel[o+1] = 1.4 + Math.random()*2.6;
    sprayState.vel[o+2] = dir.z*speed + (Math.random()*2-1)*spread;
    sprayState.life[idx] = 0.55 + Math.random()*0.55;
  }
}
function updateSpray(dt){
  const P = sprayState.pos, VE = sprayState.vel, L = sprayState.life;
  for(let i=0;i<SPRAY_N;i++){
    if(L[i] <= 0) continue;
    L[i] -= dt;
    const o = i*3;
    if(L[i] <= 0){ P[o+1] = -9999; continue; }
    VE[o+1] -= 11*dt;
    VE[o] *= (1-2.4*dt); VE[o+2] *= (1-2.4*dt);
    P[o]   += VE[o]*dt;
    P[o+1] += VE[o+1]*dt;
    P[o+2] += VE[o+2]*dt;
  }
  sprayState.geo.attributes.position.needsUpdate = true;
}

/* ---------------- terrain mesh (chunked, prebuilt) ---------------- */
const CHUNK_Z = 250;
const chunks = [];
function chunkCount(){ return Math.ceil((COURSE.length+400)/CHUNK_Z); }

function buildChunk(ci){
  const z0 = ci*CHUNK_Z - 200;
  // the slope is smooth enough that this halves the triangle count for free
  const segZ = QUALITY==='low' ? 48 : 72;
  const segX = QUALITY==='low' ? 56 : 84;
  const w = COURSE.meshHalf*2;
  const nx = segX+1, nz = segZ+1;
  const pos = new Float32Array(nx*nz*3);
  const nor = new Float32Array(nx*nz*3);
  const col = new Float32Array(nx*nz*3);
  const nrm = new V3();
  const c = new THREE.Color();
  let p=0;
  for(let j=0;j<nz;j++){
    const z = z0 + (j/segZ)*CHUNK_Z;
    for(let i=0;i<nx;i++){
      const x = -COURSE.meshHalf + (i/segX)*w;
      const y = terrainH(x,z);
      pos[p]=x; pos[p+1]=y; pos[p+2]=z;
      terrainN(x,z,nrm);
      nor[p]=nrm.x; nor[p+1]=nrm.y; nor[p+2]=nrm.z;

      // shading: snow, wind-scoured ice on steeps, rock on the walls
      const steep = 1 - nrm.y;                     // 0 flat .. ~0.4 steep
      const ax = Math.abs(x);
      const rock = clamp((ax-96)/26, 0, 1) * clamp(steep*4.5, 0, 1);
      const ice  = clamp((steep-0.10)*4.0, 0, 1);
      // cross-slope tilt reads as cool shadow / warm highlight, which is what
      // actually makes a field of white legible
      const tilt = clamp(nrm.x*1.15 + nrm.z*0.35, -1, 1);
      const grain = vnoise(x*0.30, z*0.30)*0.055 + vnoise(x*0.045,z*0.045)*0.075 - 0.06;
      let r = 0.90 + grain + tilt*0.055;
      let g = 0.93 + grain + tilt*0.040;
      let b = 0.98 + grain*0.6 - tilt*0.020;
      r = lerp(r, 0.74, ice*0.5); g = lerp(g, 0.81, ice*0.45); b = lerp(b, 0.93, ice*0.2);
      r = lerp(r, 0.33, rock); g = lerp(g, 0.31, rock); b = lerp(b, 0.30, rock);
      if(ax < COURSE.halfWidth){ const cord = 0.028*Math.sin(x*1.5); r+=cord; g+=cord; b+=cord*0.6; }
      // shade the natural snow mounds so you can actually see a jump coming
      const lift = kickerLift(x, z);
      if(lift > 0.05){
        const s2 = clamp(lift/2.6, 0, 1);
        r = lerp(r, 0.72, s2*0.55); g = lerp(g, 0.80, s2*0.5); b = lerp(b, 0.94, s2*0.3);
      }
      const tint = (world.sky||SKIES.day).snowTint;
      c.setRGB(clamp(r*tint[0],0,1), clamp(g*tint[1],0,1), clamp(b*tint[2],0,1));
      col[p]=c.r; col[p+1]=c.g; col[p+2]=c.b;
      p+=3;
    }
  }
  const idx = new Uint32Array(segX*segZ*6);
  let q=0;
  for(let j=0;j<segZ;j++){
    for(let i=0;i<segX;i++){
      const a = j*nx+i, b2 = a+1, c2 = a+nx, d2 = c2+1;
      idx[q]=a; idx[q+1]=c2; idx[q+2]=b2;
      idx[q+3]=b2; idx[q+4]=c2; idx[q+5]=d2;
      q+=6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(nor,3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col,3));
  geo.setIndex(new THREE.BufferAttribute(idx,1));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshLambertMaterial({vertexColors:true});
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  terrainGroup.add(mesh);
  chunks.push(mesh);
}
function clearTerrain(){
  chunks.forEach(m=>{ m.geometry.dispose(); m.material.dispose(); terrainGroup.remove(m); });
  chunks.length = 0;
}

/* ---------------- props: trees, rocks, gates, finish ---------------- */
let propGroup = null;
const PROP_CHUNK = 220;        // metres of hill per scenery bucket
const propChunks = [];         // {group, z, casters} — culled by distance each frame
const PROP_VIEW = 430;         // how far down the hill scenery stays drawn
const PROP_SHADOW = 120;       // and how close its nearest edge has to be to cast

/* Hide scenery you cannot see, and stop distant scenery from feeding the shadow
   pass. Runs once a frame and costs a handful of comparisons. */
function cullProps(){
  const cz = camera.position.z;
  for(let i=0;i<propChunks.length;i++){
    const pc = propChunks[i];
    /* Measure to the nearest EDGE of the bucket, not its centre. A 220 m bucket
       whose middle is 113 m away still holds trees three metres from the
       camera, and judging it by the centre left them casting no shadow. */
    const d = Math.max(0, Math.abs(pc.z - cz) - pc.half);
    const vis = d < PROP_VIEW;
    if(pc.group.visible !== vis) pc.group.visible = vis;
    const cast = vis && d < PROP_SHADOW;
    if(pc.cast !== cast){
      pc.cast = cast;
      for(let j=0;j<pc.casters.length;j++) pc.casters[j].castShadow = cast;
    }
  }
}
function buildProps(){
  if(propGroup){ scene.remove(propGroup); disposeGroup(propGroup); }
  propGroup = new THREE.Group();
  scene.add(propGroup);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new V3(), P = new V3();

  // --- pine trees: trunk + two cones ---
  const trunkGeo = new THREE.CylinderGeometry(0.24,0.36,3.0,6);
  trunkGeo.translate(0,1.5,0);
  const lowGeo = new THREE.ConeGeometry(2.3, 5.2, 7);  lowGeo.translate(0,4.4,0);
  const topGeo = new THREE.ConeGeometry(1.5, 4.4, 7);  topGeo.translate(0,7.6,0);
  const trunkMat = new THREE.MeshLambertMaterial({color:0x4a3626});
  const leafMat  = new THREE.MeshLambertMaterial({color:0x1f4a34});
  const leafMat2 = new THREE.MeshLambertMaterial({color:0x27603f});
  // The upper cone runs y 5.4 -> 9.8 with a base radius of 1.5, so at y=8.05 the
  // tree is only 0.6 wide. The cap has to match that or it flares out like a hat.
  const snowGeo = new THREE.ConeGeometry(0.66, 1.85, 6); snowGeo.translate(0,8.94,0);
  // a second dusting sitting on the shoulder of the upper cone (radius 1.47 at y=5.5)
  const skirtGeo = new THREE.ConeGeometry(1.52, 1.5, 6); skirtGeo.translate(0,6.25,0);
  const snowMat  = new THREE.MeshLambertMaterial({color:0xf2f8ff});
  const skirtMat = new THREE.MeshLambertMaterial({color:0xeaf4ff});
  const rockGeo  = makeRockCluster(4041);
  const rockMat  = new THREE.MeshLambertMaterial({vertexColors:true});

  /* Scenery is bucketed by distance down the hill and each bucket gets its own
     instanced meshes. One InstancedMesh spanning the whole 4 km course can
     never be frustum culled, so every tree on the mountain was being drawn
     twice a frame — once for the camera, once for the shadow map. Bucketed, a
     cheap per-frame distance test hides everything you cannot see. */
  propChunks.length = 0;
  const byChunk = new Map();
  const bucket = (list, kind) => {
    for(const o of list){
      const ci = Math.floor(o.z / PROP_CHUNK);
      let e = byChunk.get(ci);
      if(!e){ e = {trees:[], rocks:[], z:(ci+0.5)*PROP_CHUNK}; byChunk.set(ci, e); }
      e[kind].push(o);
    }
  };
  bucket(world.trees, 'trees');
  bucket(world.rocks, 'rocks');

  const keys = Array.from(byChunk.keys()).sort((a,b)=>a-b);
  for(const ci of keys){
    const e = byChunk.get(ci);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const casters = [];

    if(e.trees.length){
      const T = e.trees.length;
      const parts = [
        new THREE.InstancedMesh(trunkGeo, trunkMat, T),
        new THREE.InstancedMesh(lowGeo,   leafMat,  T),
        new THREE.InstancedMesh(topGeo,   leafMat2, T),
        new THREE.InstancedMesh(snowGeo,  snowMat,  T),
        new THREE.InstancedMesh(skirtGeo, skirtMat, T)
      ];
      for(let i=0;i<T;i++){
        const t = e.trees[i];
        P.set(t.x, terrainH(t.x,t.z)-0.3, t.z);
        Q.setFromEuler(new THREE.Euler(0, t.r, 0));
        S.set(t.s, t.s*(0.85+t.s*0.2), t.s);
        M.compose(P,Q,S);
        for(const m of parts) m.setMatrixAt(i, M);
      }
      parts.forEach(m=>{
        m.instanceMatrix.needsUpdate = true;
        m.frustumCulled = false;              // the group's own test handles it
        m.receiveShadow = true;
        casters.push(m);
        g.add(m);
      });
    }

    if(e.rocks.length){
      const R = e.rocks.length;
      const iRock = new THREE.InstancedMesh(rockGeo, rockMat, R);
      for(let i=0;i<R;i++){
        const r = e.rocks[i];
        // sit the outcrop ON the snow rather than sunk into it, and never let
        // one be so small it reads as a texture blemish
        const s = Math.max(r.s, 0.95);
        P.set(r.x, terrainH(r.x,r.z) + s*0.12, r.z);
        // only spin about Y — tipping a pile of boulders looks wrong
        Q.setFromEuler(new THREE.Euler(0, r.ry, 0));
        S.set(s*1.15, s*1.05, s*1.10);
        M.compose(P,Q,S); iRock.setMatrixAt(i,M);
      }
      iRock.instanceMatrix.needsUpdate = true;
      iRock.frustumCulled = false;
      iRock.receiveShadow = true;
      g.add(iRock);
      casters.push(iRock);
    }

    propGroup.add(g);
    propChunks.push({ group:g, z:e.z, half:PROP_CHUNK*0.5, casters });
  }

  // --- slalom gates: pole + flag ---
  const poleGeo = new THREE.CylinderGeometry(0.09,0.09,2.6,5); poleGeo.translate(0,1.3,0);
  const G = world.gates.length;
  const iPoleL = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({color:0xd8dde5}), G);
  const iPoleR = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({color:0xd8dde5}), G);
  const flagGeo = new THREE.PlaneGeometry(1.5,0.95); flagGeo.translate(0.75,2.05,0);
  const flagMatL = new THREE.MeshLambertMaterial({color:0xff4d5e, side:THREE.DoubleSide});
  const flagMatR = new THREE.MeshLambertMaterial({color:0x2f7fff, side:THREE.DoubleSide});
  const iFlagL = new THREE.InstancedMesh(flagGeo, flagMatL, G);
  const iFlagR = new THREE.InstancedMesh(flagGeo, flagMatR, G);
  const I = new V3(1,1,1);
  for(let i=0;i<G;i++){
    const g = world.gates[i];
    Q.setFromEuler(new THREE.Euler(0,0,0));
    P.set(g.x-g.w, terrainH(g.x-g.w,g.z), g.z); M.compose(P,Q,I); iPoleL.setMatrixAt(i,M); iFlagL.setMatrixAt(i,M);
    P.set(g.x+g.w, terrainH(g.x+g.w,g.z), g.z);
    Q.setFromEuler(new THREE.Euler(0,Math.PI,0));
    M.compose(P,Q,I); iPoleR.setMatrixAt(i,M); iFlagR.setMatrixAt(i,M);
  }
  [iPoleL,iPoleR,iFlagL,iFlagR].forEach(m=>{ m.instanceMatrix.needsUpdate=true; m.castShadow=true; m.receiveShadow=true; propGroup.add(m); });
  world.gateMeshes = {iFlagL, iFlagR};

  // --- built ramps over the kickers marked as park features, culled like scenery ---
  for(const k of world.kickers){
    if(!k.built) continue;
    const rg = buildRamp(k);
    propGroup.add(rg);
    propChunks.push({ group:rg, z:k.z, half:k.len*0.5+4, casters:[rg.userData.caster] });
  }

  // --- the valley floor and the lake at the bottom of the run ---
  buildValley();

  // --- start gantry + finish banner ---
  propGroup.add(banner(0, 6, 'START', 0x2f7fff));
  propGroup.add(banner(0, COURSE.finishZ, 'FINISH', 0xff4d5e));

  // --- edge marker poles down the piste ---
  const mkGeo = new THREE.CylinderGeometry(0.13,0.13,3.2,5); mkGeo.translate(0,1.6,0);
  const cnt = Math.floor(COURSE.length/45)*2;
  const iMk = new THREE.InstancedMesh(mkGeo, new THREE.MeshLambertMaterial({color:0xff9a3c}), cnt);
  let k=0;
  for(let z=40; z<COURSE.length; z+=45){
    for(const s of [-1,1]){
      const x = s*COURSE.halfWidth;
      P.set(x, terrainH(x,z), z);
      Q.setFromEuler(new THREE.Euler(0,0,0));
      M.compose(P,Q,I);
      if(k<cnt) iMk.setMatrixAt(k++,M);
    }
  }
  iMk.count = k; iMk.instanceMatrix.needsUpdate = true;
  iMk.castShadow = true; iMk.receiveShadow = true;
  propGroup.add(iMk);
}

/* A rock is a little outcrop: five lumpy boulders of different sizes packed
   together and merged into one geometry, so it reads as a pile rather than a
   stray triangle. Built once and instanced everywhere. */
function makeRockCluster(seed){
  const rnd = mulberry32(seed);
  const pos = [], nor = [], col = [];
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3();
  const v = new V3(), n = new V3();
  const grey = new THREE.Color(0x6b6f77), snow = new THREE.Color(0xeef6ff);
  const c = new THREE.Color();
  // four boulders half-buried in each other, so the silhouette is a pile
  const LUMPS = [
    {p:[ 0.00,-0.05,  0.00], s:1.00},
    {p:[ 0.52,-0.26, -0.22], s:0.66},
    {p:[-0.46,-0.30,  0.20], s:0.72},
    {p:[ 0.08, 0.30,  0.30], s:0.50}
  ];
  for(const L of LUMPS){
    const g = new THREE.IcosahedronGeometry(0.58*L.s, 0);
    const a = g.attributes.position;
    // knock each boulder out of round so no two look alike
    for(let i=0;i<a.count;i++){
      a.setXYZ(i,
        a.getX(i)*(0.80+rnd()*0.40),
        a.getY(i)*(0.66+rnd()*0.34),
        a.getZ(i)*(0.80+rnd()*0.40));
    }
    g.computeVertexNormals();
    m.makeRotationFromEuler(new THREE.Euler(rnd()*TAU, rnd()*TAU, rnd()*TAU));
    m.setPosition(L.p[0], L.p[1], L.p[2]);
    nm.getNormalMatrix(m);
    const gp = g.attributes.position, gn = g.attributes.normal;
    for(let i=0;i<gp.count;i++){
      v.fromBufferAttribute(gp, i).applyMatrix4(m);
      n.fromBufferAttribute(gn, i).applyMatrix3(nm).normalize();
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      // snow settles on whatever faces the sky — baked in, so the whole
      // outcrop is still a single draw call
      c.copy(grey).lerp(snow, clamp((n.y - 0.20)/0.45, 0, 1));
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

/* The terrain mesh is only a couple of hundred metres wide, so beyond its edge
   you used to see straight through to the sky — a bright band under the distant
   peaks that made them look like they were floating. A single huge plane at
   valley level fills that in. Near the bottom of the run it is close enough to
   read as what it is: the lake the mountain drains into. */
let valleyFloor = null, lakeMesh = null;
function buildValley(){
  const len = COURSE.length + 3600;
  const midZ = COURSE.shoreZ + 1500;

  // snowfield floor, sitting a touch below the waterline
  const fGeo = new THREE.PlaneGeometry(7000, len);
  fGeo.rotateX(-Math.PI/2);
  valleyFloor = new THREE.Mesh(fGeo, new THREE.MeshLambertMaterial({color:0xdfeaf4}));
  valleyFloor.position.set(0, COURSE.lakeY - 1.2, midZ - len*0.5 + 1200);
  valleyFloor.matrixAutoUpdate = false; valleyFloor.updateMatrix();
  propGroup.add(valleyFloor);

  // the water itself, only where the valley actually holds it
  const lGeo = new THREE.PlaneGeometry(5200, 2600);
  lGeo.rotateX(-Math.PI/2);
  /* Deep and matte on purpose. A shiny water shader here catches the sun across
     the whole surface and washes the lake out to the same white as the snow —
     which is exactly how it disappeared the first time. */
  const pal = world.sky || SKIES.day;
  const water = new THREE.Color(pal === SKIES.dusk ? 0x2c2c50 : 0x2c6488);
  lakeMesh = new THREE.Mesh(lGeo, new THREE.MeshBasicMaterial({ color: water, fog: true }));
  lakeMesh.position.set(0, COURSE.lakeY, COURSE.shoreZ + 1150);
  lakeMesh.matrixAutoUpdate = false; lakeMesh.updateMatrix();
  propGroup.add(lakeMesh);
}

/* ---- built ramps ------------------------------------------------------- */

/* Push one flat-shaded quad (a→b→c→d, counter-clockwise seen from the front). */
const _qA = new V3(), _qB = new V3(), _qN = new V3();
function pushQuad(dst, a, b, c, d, col){
  _qA.subVectors(b, a); _qB.subVectors(d, a);
  _qN.crossVectors(_qA, _qB).normalize();
  const P = dst.pos, N = dst.nor, C = dst.col;
  for(const v of [a,b,c, a,c,d]){
    P.push(v.x, v.y, v.z);
    N.push(_qN.x, _qN.y, _qN.z);
    C.push(col.r, col.g, col.b);
  }
}

/* A built ramp is a closed solid, not a sheet: a packed-snow deck laid exactly
   on the physics surface, timber side walls that drop from the deck edge into
   the bare snow so there is no gap underneath, a plated takeoff lip and a face
   under it. Everything is one geometry with baked vertex colours, so a whole
   ramp is a single draw call. */
function buildRamp(k){
  const segZ = 22, segX = 14;                  // segX carries the corduroy banding
  const w = k.w*0.82;                          // wide enough to cover the snow mound
  const dst = { pos:[], nor:[], col:[] };
  // clearly darker than snow, or the takeoff vanishes into the hill at distance
  const deckSnow = new THREE.Color(0x8ea6bd);
  const deckHot  = new THREE.Color(0xb2c8db);
  const groove   = new THREE.Color(0x6b8299);   // corduroy grooves
  const edge     = new THREE.Color(0xe08a3a);   // painted deck border
  const timber   = new THREE.Color(0x6b4b2e);
  const timberLo = new THREE.Color(0x4a3320);
  const plank    = new THREE.Color(0x8a6540);
  const tape     = new THREE.Color(0xff9a3c);
  const under    = new THREE.Color(0x3a2b1c);
  const c = new THREE.Color();

  // ground level with the ramp's own lift removed, so walls meet real snow
  const bare = (x,z)=> terrainH(x,z) - kickerLift(x,z);
  const zAt  = t => k.z - k.len*(1-t) + 0.45*t;

  // ---- deck grid, laid on the surface the physics actually uses ----
  const rows = [];
  for(let j=0;j<=segZ;j++){
    const t = j/segZ, z = zAt(t), row = [];
    for(let i=0;i<=segX;i++){
      const x = k.x - w + (i/segX)*w*2;
      // a healthy lift off the snow; flush with it, the two surfaces z-fight and
      // the deck breaks up into a stippled mess
      row.push(new V3(x, terrainH(x,z) + 0.13, z));
    }
    rows.push(row);
  }
  for(let j=0;j<segZ;j++){
    const t = j/segZ;
    for(let i=0;i<segX;i++){
      const u = i/segX;
      if(t > 0.90)      c.copy(tape);          // plated takeoff edge
      else if(t > 0.86) c.copy(timber);
      else if(u < 0.055 || u > 0.945) c.copy(edge);   // painted border, full length
      else {
        /* Groomed corduroy down the deck. Without it the run-in is the same
           flat white as the hill and the ramp only appears once the lip does. */
        c.copy(deckSnow).lerp(deckHot, t*0.7);
        if(i % 2 === 0) c.lerp(groove, 0.5);
      }
      // wound so the face normal points UP — the other way round the whole deck
      // is back-facing and gets culled, which is why the ramp surface was missing
      pushQuad(dst, rows[j][i], rows[j+1][i], rows[j+1][i+1], rows[j][i+1], c);
    }
  }

  // ---- side walls: deck edge down into the snow ----
  for(const side of [0, segX]){
    const outward = side === 0 ? -1 : 1;
    for(let j=0;j<segZ;j++){
      const a = rows[j][side], b = rows[j+1][side];
      // never let the wall collapse to nothing: at the run-in the deck is almost
      // flush with the snow, and a zero-height wall is why the start of the ramp
      // used to be invisible
      const ga = new V3(a.x + outward*0.10, Math.min(bare(a.x, a.z), a.y - 0.42) - 0.10, a.z);
      const gb = new V3(b.x + outward*0.10, Math.min(bare(b.x, b.z), b.y - 0.42) - 0.10, b.z);
      // horizontal plank banding, darkening toward the base
      const band = (j % 3 === 0) ? plank : timber;
      c.copy(band).lerp(timberLo, 0.30);
      if(outward < 0) pushQuad(dst, ga, gb, b, a, c);
      else            pushQuad(dst, a, b, gb, ga, c);
    }
  }

  // ---- the lip: a plated face under the takeoff edge ----
  const lTop = rows[segZ][0], rTop = rows[segZ][segX];
  const lBot = new V3(lTop.x - 0.10, bare(lTop.x, lTop.z) - 0.30, lTop.z);
  const rBot = new V3(rTop.x + 0.10, bare(rTop.x, rTop.z) - 0.30, rTop.z);
  pushQuad(dst, lTop, lBot, rBot, rTop, timberLo);   // faces down the hill

  // ---- shadowed underside so the solid never reads as hollow ----
  const l0 = rows[0][0], r0 = rows[0][segX];
  const l0b = new V3(l0.x - 0.10, bare(l0.x, l0.z) - 0.30, l0.z);
  const r0b = new V3(r0.x + 0.10, bare(r0.x, r0.z) - 0.30, r0.z);
  pushQuad(dst, l0b, r0b, rBot, lBot, under);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(dst.pos,3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(dst.nor,3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(dst.col,3));
  geo.computeBoundingSphere();

  // polygon offset pushes the deck ahead of the snow in the depth test, which
  // stops the two co-planar surfaces from interleaving at distance
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4
  }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const g = new THREE.Group();
  g.add(mesh);
  g.userData.caster = mesh;
  return g;
}

function banner(x, z, text, color){
  const g = new THREE.Group();
  const h = 7.5, span = 26;
  const postGeo = new THREE.CylinderGeometry(0.3,0.35,h,8); postGeo.translate(0,h/2,0);
  const mat = new THREE.MeshLambertMaterial({color:0x2b3442});
  for(const s of [-1,1]){
    const p = new THREE.Mesh(postGeo, mat);
    p.position.set(x + s*span/2, terrainH(x+s*span/2, z), z);
    p.castShadow = true; g.add(p);
  }
  const cv = document.createElement('canvas'); cv.width=1024; cv.height=128;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#'+new THREE.Color(color).getHexString(); cx.fillRect(0,0,1024,128);
  cx.fillStyle = '#fff'; cx.font = 'bold 84px Inter, Segoe UI, sans-serif';
  cx.textAlign='center'; cx.textBaseline='middle';
  cx.fillText(text, 512, 70);
  const tex = new THREE.CanvasTexture(cv);
  const bm = new THREE.Mesh(new THREE.PlaneGeometry(span, 2.6),
    new THREE.MeshBasicMaterial({map:tex, side:THREE.DoubleSide}));
  bm.position.set(x, terrainH(x,z)+h-1.4, z);
  bm.rotation.y = Math.PI;
  bm.castShadow = true;
  g.add(bm);
  return g;
}

function disposeGroup(gr){
  gr.traverse(o=>{
    if(o.geometry) o.geometry.dispose();
    if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); }); }
  });
}

/* ---------------- 5. rider ---------------- */
let rider = null;    // the player's rig; rivals get their own from the same builder
/* Skeleton measurements, in metres. footY is where the boot sole meets the deck. */
const RIG = { hipY: 1.02, thigh: 0.44, shin: 0.44, footY: 0.20 };
function makeRider(jacket, deckColor, helmetColor){
  const g = new THREE.Group();
  const P = {};
  const mk = (geo,color,cast)=>{ const m=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({color})); m.castShadow=cast!==false; return m; };

  // board (long axis = local Z = forward)
  const board = new THREE.Group();
  const deck = mk(new THREE.BoxGeometry(0.30, 0.05, 1.55), 0x141821);
  deck.position.y = 0.07;
  const topSheet = mk(new THREE.BoxGeometry(0.305, 0.02, 1.50), deckColor);
  topSheet.position.y = 0.10;
  const nose = mk(new THREE.BoxGeometry(0.26,0.05,0.22), 0x141821);
  nose.position.set(0,0.115,0.80); nose.rotation.x = -0.42;
  const tail = mk(new THREE.BoxGeometry(0.26,0.05,0.22), 0x141821);
  tail.position.set(0,0.115,-0.80); tail.rotation.x = 0.42;
  board.add(deck, topSheet, nose, tail);
  for(const z of [0.28,-0.28]){
    const b = mk(new THREE.BoxGeometry(0.22,0.05,0.20), 0x2a3240);
    b.position.set(0,0.13,z); board.add(b);
  }
  P.board = board; g.add(board);

  /* Legs are a real two-bone chain: hip -> thigh -> knee -> shin -> boot.
     Crouching solves for the knee angle that puts the foot back on the board,
     so the rider folds at the knees instead of just getting shorter. */
  P.legs = new THREE.Group();
  P.hipJoints = [];
  for(const s of [1,-1]){
    const hipJoint = new THREE.Group();
    hipJoint.position.set(0, RIG.hipY, s*0.20);
    const thigh = mk(new THREE.CylinderGeometry(0.135,0.105,RIG.thigh,7), 0x38455c);
    thigh.position.y = -RIG.thigh/2;
    hipJoint.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -RIG.thigh;
    const kneeCap = mk(new THREE.SphereGeometry(0.105,8,6), 0x38455c);
    knee.add(kneeCap);
    const shin = mk(new THREE.CylinderGeometry(0.10,0.115,RIG.shin,7), 0x2f3a4d);
    shin.position.y = -RIG.shin/2;
    knee.add(shin);

    const ankle = new THREE.Group();
    ankle.position.y = -RIG.shin;
    const boot = mk(new THREE.BoxGeometry(0.21,0.19,0.32), 0x232a36);
    boot.position.set(0,-0.08,0.02);
    ankle.add(boot);
    knee.add(ankle);
    hipJoint.add(knee);

    hipJoint.userData = { knee, ankle, side: s };
    P.hipJoints.push(hipJoint);
    P.legs.add(hipJoint);
  }
  g.add(P.legs);

  // torso / head / arms hang off a hips group so we can crouch + twist
  P.hips = new THREE.Group(); P.hips.position.y = 1.14; g.add(P.hips);
  const torsoGeo = (typeof THREE.CapsuleGeometry === 'function')
    ? new THREE.CapsuleGeometry(0.24,0.42,4,8)
    : new THREE.CylinderGeometry(0.25,0.28,0.72,9);
  const torso = mk(torsoGeo, jacket);
  torso.position.y = 0.30; P.hips.add(torso);
  const vest = mk(new THREE.CylinderGeometry(0.27,0.29,0.30,10), 0x1b2431);
  vest.position.y = 0.14; P.hips.add(vest);
  const neck = mk(new THREE.CylinderGeometry(0.08,0.09,0.10,6), 0x1b2431);
  neck.position.y = 0.66; P.hips.add(neck);
  P.head = new THREE.Group(); P.head.position.y = 0.80; P.hips.add(P.head);
  const helmet = mk(new THREE.SphereGeometry(0.20,12,10), helmetColor);
  P.head.add(helmet);
  const goggles = mk(new THREE.BoxGeometry(0.36,0.13,0.10), 0x101820);
  goggles.position.set(0,0.02,0.17); P.head.add(goggles);
  const lens = mk(new THREE.BoxGeometry(0.30,0.09,0.03), 0x59d8ff);
  lens.position.set(0,0.02,0.225); P.head.add(lens);

  P.armL = new THREE.Group(); P.armR = new THREE.Group();
  const armGeo = new THREE.CylinderGeometry(0.075,0.065,0.62,6);
  armGeo.translate(0,-0.31,0);
  for(const [grp,s] of [[P.armL,1],[P.armR,-1]]){
    const upper = mk(armGeo, jacket);
    grp.add(upper);
    const glove = mk(new THREE.SphereGeometry(0.10,8,6), 0x1b2431);
    glove.position.y = -0.64; grp.add(glove);
    grp.position.set(0, 0.50, s*0.24);
    P.hips.add(grp);
  }

  scene.add(g);
  P.bodyMeshes = [torso, vest, neck, P.head];
  return { root:g, parts:P };
}

/* ---------------- 6. player state + physics ---------------- */
const player = {
  pos: new V3(), vel: new V3(), yaw: 0,
  grounded:true, normal:new V3(0,1,0),
  lean:0, crouch:0, charge:0, chargeHeld:false,
  airPitch:0, airRoll:0, spinAccum:0, flipAccum:0, airTime:0, airStart:0,
  grabbing:false, grabTime:0,
  state:'ride',            // ride | air | crash | finish
  crashT:0, impact:0, boost:0, boostPow:1, lastKick:null, invuln:0, sprayAcc:0, assist:0
};

const stats = {
  t:0, started:false, score:0, combo:0, tricks:0, gates:0, crashes:0,
  top:0, air:0, startY:0, best:0, finished:false, finishTime:0, place:1, raceBonus:0
};

const DROP_HEIGHT = 15;   // metres above the snow that every run starts from

function resetPlayer(){
  // everyone drops in from above the start gate rather than standing on it
  player.pos.set(0, 0, 0);
  player.pos.y = terrainH(0,0) + DROP_HEIGHT;
  player.vel.set(0,0,4.5);
  player.yaw = 0;
  player.grounded = false; player.dropping = true; player.normal.set(0,1,0);
  player.lean = 0; player.crouch = 0; player.charge = 0; player.chargeHeld=false;
  player.airPitch = 0; player.airRoll = 0; player.spinAccum=0; player.flipAccum=0;
  player.airTime = 0; player.grabbing=false; player.grabTime=0;
  player.state="air"; player.crashT=0; player.impact=0; player.boost=0; player.boostPow=1;
  player.lastKick=null; player.invuln=1.6;
  player.sprayAcc=0; player.assist=0; landing.valid=false;
  camYaw = 0;
  stats.t=0; stats.started=false; stats.score=0; stats.combo=0; stats.tricks=0;
  stats.gates=0; stats.crashes=0; stats.top=0; stats.air=0;
  // measure the drop from the snow at the gate, not from the drop-in height
  stats.startY = terrainH(0,0); stats.finished=false; stats.finishTime=0;
  stats.place=1; stats.raceBonus=0;
  world.gates.forEach(g=>g.passed=false);
  if(world.gateMeshes) resetGateColors();
  camYawOff = 0; camPitchOff = 0;
  camPos.set(0, player.pos.y+4, -12);
  camLook.copy(player.pos);
  resetRacers();
}

/* ---- landing prediction ----------------------------------------------
   Ballistic flight against a height field has no closed form, so solve it by
   fixed-point iteration: guess a flight time, look up the ground under where
   that puts you, re-solve the quadratic, repeat. Four passes is plenty and it
   converges in a couple of iterations on normal slopes. Fills `landing` with
   the touchdown point, the time until it, and the heading you should be
   pointing when you get there. */
/* ---- guaranteed launch --------------------------------------------------
   A ramp profile alone is not a promise: hit a lip a fraction off-centre, or a
   touch slow, and the height field can hand you back a bunny hop. So crossing
   the lip of a kicker actively throws the rider — the surface-normal velocity
   is raised to a floor that scales with how fast you came in and how square you
   hit it. Ride over a ramp at speed and you WILL leave the ground. */
function kickerAt(z, x){
  const list = world.kickBuckets.get(bucketOf(z));
  if(!list) return null;
  for(let i=0;i<list.length;i++){
    const k = list[i];
    if(Math.abs(x - k.x) < k.w && Math.abs(z - k.z) < 3) return k;
  }
  return null;
}
function applyLaunch(e, dt){
  if(!e.grounded) return false;
  const sp = e.vel.length();
  if(sp < 6) return false;
  const k = kickerAt(e.pos.z, e.pos.x);
  if(!k || k === e.lastKick) return false;
  // only fire as the lip is crossed, moving downhill
  if(e.pos.z + e.vel.z*dt < k.z) return false;
  e.lastKick = k;
  const centred = 1 - clamp(Math.abs(e.pos.x - k.x)/k.w, 0, 1);
  const floor = clamp(sp*0.30, 4.0, 11) * (0.55 + 0.45*centred) * (0.75 + k.h*0.09);
  const vn = e.vel.dot(e.normal);
  if(vn < floor) e.vel.addScaledVector(e.normal, floor - vn);
  e.pos.y += 0.05;
  return true;
}

const landing = { t:0, x:0, y:0, z:0, yaw:0, valid:false };
function predictLanding(){
  const p = player;
  const vx = p.vel.x, vy = p.vel.y, vz = p.vel.z, g = CFG.gravity;
  let t = 0.12;
  for(let i=0;i<4;i++){
    const hx = p.pos.x + vx*t, hz = p.pos.z + vz*t;
    const hLand = terrainH(hx, hz);
    const disc = vy*vy + 2*g*(p.pos.y - hLand);
    if(disc <= 0){ t = 0.02; break; }
    t = (vy + Math.sqrt(disc))/g;
    if(t < 0) t = 0.02;
    if(t > 6) { t = 6; break; }
  }
  landing.t = t;
  landing.x = p.pos.x + vx*t;
  landing.z = p.pos.z + vz*t;
  landing.y = terrainH(landing.x, landing.z);
  // land pointing where you are actually travelling, nudged toward the fall
  // line of the slope you are about to touch — that is a square landing
  const travel = Math.atan2(vx, vz);
  terrainN(landing.x, landing.z, _land);
  const fall = Math.atan2(_land.x, _land.z);
  landing.yaw = travel + angDiff(fall, travel)*0.35;
  landing.valid = true;
  return t;
}

const _fwd = new V3(), _side = new V3(), _tmp = new V3(), _g = new V3(), _land = new V3();
function stepPhysics(dt){
  const p = player, inp = input;
  const steerIn = (inp.left?1:0) - (inp.right?1:0);     // +1 = turn left
  const h = terrainH(p.pos.x, p.pos.z);
  terrainN(p.pos.x, p.pos.z, p.normal);
  const wasGrounded = p.grounded;
  p.grounded = (p.pos.y - h) < 0.12 && p.vel.y <= 2.0;

  const speed = p.vel.length();
  const offPiste = Math.abs(p.pos.x) > COURSE.halfWidth;
  if(p.invuln > 0) p.invuln -= dt;

  if(p.state === 'crash'){
    p.crashT -= dt;
    p.vel.multiplyScalar(1 - 3.2*dt);
    p.vel.y -= CFG.gravity*dt;
    p.pos.addScaledVector(p.vel, dt);
    const hh = terrainH(p.pos.x,p.pos.z);
    if(p.pos.y < hh){ p.pos.y = hh; p.vel.y = 0; }
    p.airRoll += dt*6.5; p.airPitch += dt*3.0;
    if(p.crashT <= 0){
      p.state = 'ride';
      p.airRoll = 0; p.airPitch = 0;
      // stand back up pointing down the fall line (and back toward the piste).
      // n = (-dh/dx, 1, -dh/dz), so (n.x, n.z) already points downhill.
      terrainN(p.pos.x, p.pos.z, p.normal);
      let fallYaw = Math.atan2(p.normal.x, p.normal.z);
      if(Math.abs(p.pos.x) > COURSE.halfWidth*0.75) fallYaw -= Math.sign(p.pos.x)*0.55;
      p.yaw = fallYaw;
      const sp = Math.max(p.vel.length()*0.6, 4);
      p.vel.set(Math.sin(p.yaw)*sp, 0, Math.cos(p.yaw)*sp);
      p.invuln = 1.1;          // brief grace so you don't re-hit the same tree
    }
    return;
  }

  // --- steering ---
  if(p.grounded){
    const rate = CFG.steerRate * settings.sens / (1 + speed*CFG.steerFalloff);
    p.yaw += steerIn * rate * dt;
    p.lean = damp(p.lean, steerIn * clamp(speed/26,0,1), 7, dt);
    p.assist = 0; landing.valid = false;
    // with no steering input the board tracks where it is going, so the rider
    // always ends up facing down the hill instead of sliding away sideways
    if(!steerIn && speed > 3 && !inp.brake){
      const travel = Math.atan2(p.vel.x, p.vel.z);
      p.yaw += angDiff(travel, p.yaw) * (1 - Math.exp(-CFG.groundAlign*dt));
    }
  } else {
    // airborne rotation
    p.yaw += steerIn * CFG.airYaw * settings.sens * dt;
    p.spinAccum += steerIn * CFG.airYaw * settings.sens * dt;
    // positive airPitch tips the rider forward over the nose, so W flips
    // forwards and S flips backwards
    const flipIn = (inp.fwd?1:0) - (inp.back?1:0);
    p.airPitch += flipIn * CFG.airPitch * dt;
    p.flipAccum += flipIn * CFG.airPitch * dt;
    p.lean = damp(p.lean, steerIn*0.6, 5, dt);
  }

  // board basis on the current surface
  const n = p.grounded ? p.normal : _tmp.set(0,1,0);
  _fwd.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  _side.crossVectors(n, _fwd).normalize();
  _fwd.crossVectors(_side, n).normalize();

  if(p.grounded){
    // land from a jump?
    if(!wasGrounded) onLanding();

    // gravity projected on the slope
    _g.set(0,-CFG.gravity,0);
    const gn = _g.dot(n);
    _tmp.copy(n).multiplyScalar(gn);
    _g.sub(_tmp);
    p.vel.addScaledVector(_g, dt);

    // decompose into edge (lateral) and glide (forward)
    let vf = p.vel.dot(_fwd);
    let vs = p.vel.dot(_side);

    const carving = Math.abs(steerIn) > 0.1;
    let grip = carving ? CFG.gripCarve : CFG.gripBase;
    if(inp.brake) grip = CFG.gripBrake;
    if(p.chargeHeld) grip *= 1.25;
    if(offPiste) grip *= 1.5;
    vs *= Math.exp(-grip*dt);

    // longitudinal: snow friction + aero drag
    const dirF = vf >= 0 ? 1 : -1;
    const mu = CFG.frictionSnow * (offPiste ? 2.2 : 1) * (inp.brake ? 3.0 : 1);
    const nForce = CFG.gravity * n.y;
    let dec = mu * nForce;
    const drag = (inp.tuck && !inp.brake ? CFG.dragTuck : CFG.dragUpright) + (offPiste?CFG.dragPowder*0.02:0);
    dec += drag * vf*vf;
    if(inp.brake) dec += CFG.brakeDecel;
    vf -= dirF * dec * dt;
    if(dirF > 0 && vf < 0) vf = 0;

    // carving scrub: hard turns bleed a little speed, tucking gains
    if(carving) vf -= Math.abs(steerIn) * speed * 0.055 * dt;
    if(inp.tuck && !inp.brake) vf += 1.6*dt;
    // landing a trick pays out as speed, and a combo pays out harder
    if(p.boost > 0){ vf += CFG.boostAccel*p.boostPow*dt; p.boost -= dt; }

    p.vel.copy(_fwd).multiplyScalar(vf).addScaledVector(_side, vs);

    // stick to the surface, keep a bit of pop over crests
    const vn = p.vel.dot(n);
    p.vel.addScaledVector(n, -vn);
    p.pos.y = h;

    // spray thrown off the edge (rate limited so it reads as a rooster tail)
    const sideAbs = Math.abs(vs);
    p.sprayAcc += dt;
    if((sideAbs > 1.0 || inp.brake) && p.sprayAcc > 0.016){
      p.sprayAcc = 0;
      const amt = clamp(Math.round(sideAbs*1.1 + (inp.brake?4:0)), 2, 10);
      _tmp.copy(_side).multiplyScalar(-Math.sign(vs));
      emitSpray(p.pos, _tmp, amt, 1.5, clamp(sideAbs*0.5,1,6));
    }

    // ollie charge / pop
    if(inp.jump){
      p.chargeHeld = true;
      p.charge = Math.min(CFG.maxCharge, p.charge + dt*1.55);
    } else if(p.chargeHeld){
      const power = (0.45 + 0.55*(p.charge/CFG.maxCharge));
      p.vel.addScaledVector(n, CFG.ollie*power);
      p.pos.y += 0.08;
      p.chargeHeld = false; p.charge = 0;
      startAir();
      sfxPop(power);
    }
    p.crouch = damp(p.crouch, (inp.tuck?1:0)*0.55 + (p.chargeHeld?p.charge/CFG.maxCharge:0)*0.9 + (inp.brake?0.35:0), 9, dt);

    // crossing a lip always sends you
    if(applyLaunch(p, dt)){ startAir(); sfxPop(0.7); }
  } else {
    // ------- airborne -------
    if(wasGrounded && p.state !== 'air') startAir();
    p.vel.y -= CFG.gravity*dt;
    const dragA = CFG.dragAir*(p.grabbing?0.8:1);
    _tmp.copy(p.vel).multiplyScalar(-dragA*p.vel.length()*dt);
    p.vel.add(_tmp);
    p.airTime += dt;
    p.crouch = damp(p.crouch, p.grabbing?0.95:0.35, 6, dt);
    if(inp.grab){ p.grabbing = true; p.grabTime += dt; } else p.grabbing = false;
    p.charge = 0; p.chargeHeld = false;

    /* ---- auto-land assist ----
       Look ahead to the touchdown point and, over the last stretch of the
       flight, rotate the board onto the landing heading and unwind the flip to
       the nearest whole rotation. The angular rate is exactly what is needed to
       arrive square in the time remaining, so however wild the spin was, the
       rider sets down facing down the hill. Trick scoring reads spinAccum,
       which the assist never touches — a 340 still lands and still counts. */
    const tLand = predictLanding();
    if(tLand < CFG.assistWindow){
      const blend = clamp((CFG.assistWindow - tLand)/CFG.assistWindow, 0, 1);
      const remain = Math.max(tLand, dt);
      p.yaw += angDiff(landing.yaw, p.yaw) * clamp(blend*blend*dt/remain, 0, 1);
      const settled = Math.round(p.airPitch/TAU)*TAU;
      p.airPitch += (settled - p.airPitch) * clamp(blend*blend*dt/remain, 0, 1);
      p.assist = blend;
    } else p.assist = 0;
  }

  // integrate
  p.pos.addScaledVector(p.vel, dt);

  // ground clamp. Impact is measured along the surface normal, so dropping onto
  // a steep landing is soft and dropping onto a flat runout hurts.
  const nh = terrainH(p.pos.x, p.pos.z);
  if(p.pos.y < nh){
    p.pos.y = nh;
    terrainN(p.pos.x,p.pos.z,p.normal);
    const vn = p.vel.dot(p.normal);
    if(!p.grounded) p.impact = Math.max(p.impact, -vn);
    if(vn < 0) p.vel.addScaledVector(p.normal, -vn);
  }

  // side walls
  if(Math.abs(p.pos.x) > COURSE.meshHalf-6){
    p.pos.x = Math.sign(p.pos.x)*(COURSE.meshHalf-6);
    p.vel.x *= -0.25;
  }
  // speed cap
  const sp = p.vel.length();
  if(sp > 62) p.vel.multiplyScalar(62/sp);

  checkCollisions();
  checkGates();

  stats.top = Math.max(stats.top, p.vel.length());
  if(!stats.finished && p.pos.z >= COURSE.finishZ) finishRun();
}

function startAir(){
  player.state = 'air';
  player.airTime = 0; player.spinAccum = 0; player.flipAccum = 0;
  player.grabTime = 0; player.airPitch = 0;
}

function onLanding(){
  const p = player;
  if(p.state !== 'air'){ p.impact=0; return; }
  p.state = 'ride';

  // the opening drop-in is not a trick and is never a bad landing
  if(p.dropping){
    p.dropping = false;
    p.impact = 0; p.airPitch = 0; p.spinAccum = 0; p.flipAccum = 0; p.airTime = 0;
    shake(0.32); sfxLand(14);
    _tmp.set(0,0,0); emitSpray(p.pos, _tmp, 16, 4, 5);
    showTrick('Dropping in', 0, 'good');
    return;
  }
  const air = p.airTime;
  const impact = p.impact; p.impact = 0;

  // landing quality: board direction vs travel direction, and pitch
  const travel = Math.atan2(p.vel.x, p.vel.z);
  let dyaw = Math.abs(((p.yaw - travel + Math.PI*3) % TAU) - Math.PI);
  const pitchOff = Math.abs(((p.airPitch + Math.PI) % TAU + TAU) % TAU - Math.PI);
  const badPitch = pitchOff > 0.85;
  const speed = p.vel.length();

  if(air < 0.18){ p.airPitch = 0; return; }   // little hops don't score

  /* The assist has already squared the board up, so a jump is never a wipeout.
     A heavy or sideways touchdown still costs you: it scrubs speed, breaks the
     combo and shakes the camera — you ride away, just not cleanly. */
  /* Ramps now throw you hard enough that a clean landing off the biggest lip
     registers ~22 of surface-normal impact. The cutoff sits above that, so it
     only fires for genuinely ugly drops, not for stomping a big jump. */
  const HARD_LANDING = 26;
  const sloppy = (dyaw > CFG.crashAngle*0.55 && speed > 9) || badPitch || impact > HARD_LANDING;
  if(sloppy){
    p.vel.multiplyScalar(0.72);
    stats.combo = 0;
    shake(0.30); sfxLand(Math.min(impact,20));
    _tmp.set(0,0,0); emitSpray(p.pos, _tmp, 12, 3.5, 5);
    showTrick(impact > HARD_LANDING ? 'Heavy landing' : 'Sketchy landing', 0, 'bad');
    p.airPitch = 0; p.spinAccum = 0; p.flipAccum = 0;
    return;
  }

  // score it
  const spins = Math.floor(Math.abs(p.spinAccum)/Math.PI + 0.16);
  const flips = Math.floor(Math.abs(p.flipAccum)/TAU + 0.12);
  let pts = Math.round(air*38) + Math.round(p.grabTime*45);
  let name = '';
  if(spins >= 1){
    const deg = spins*180;
    name = (p.spinAccum > 0 ? 'FRONTSIDE ' : 'BACKSIDE ') + deg;
    pts += spins*spins*70;
  }
  if(flips >= 1){
    name = (name?name+' + ':'') + (p.flipAccum>0 ? 'FRONTFLIP' : 'BACKFLIP') + (flips>1?' x'+flips:'');
    pts += flips*260;
  }
  if(p.grabTime > 0.28){
    const grabs = ['INDY','MELON','MUTE','STALEFISH','METHOD','NOSEGRAB'];
    const gname = grabs[Math.floor(Math.abs(p.pos.z*0.13)) % grabs.length];
    name = (name?name+' ':'') + gname;
  }
  if(!name) name = air > 1.1 ? 'BIG AIR' : 'AIR';
  if(dyaw < 0.22 && air > 0.7) { name += ' — STOMPED'; pts = Math.round(pts*1.25); }

  stats.combo = Math.min(stats.combo+1, 16);
  const mult = 1 + stats.combo*0.25;
  pts = Math.round(pts * mult);
  stats.score += pts; stats.tricks++; stats.air += air;

  /* Speed reward: a landed trick gives a short surge, and stacking tricks
     without crashing makes each surge stronger and longer. Riding the park
     line should genuinely beat straight-lining it. */
  p.boost = clamp(0.40 + air*0.35, 0, 1.4) * (1 + Math.min(stats.combo,8)*0.06);
  p.boostPow = 1 + Math.min(stats.combo, 8)*0.14;
  const bn = stats.combo > 1 ? ' · x'+stats.combo+' BOOST' : ' · BOOST';
  showTrick(name + bn, pts, 'good');
  sfxLand(Math.min(impact,20));
  shake(clamp(impact*0.012,0,0.35));
  _tmp.set(0,0,0);
  emitSpray(p.pos, _tmp, 14, 3.2, 4);
  p.airPitch = 0; p.spinAccum = 0; p.flipAccum = 0;
}

function crash(reason){
  const p = player;
  if(p.state === 'crash') return;
  p.state = 'crash'; p.crashT = 1.5;
  p.vel.multiplyScalar(0.32);
  stats.crashes++; stats.combo = 0;
  showTrick(reason, 0, 'bad');
  sfxCrash();
  shake(0.55); flash(0.35);
  _tmp.set(0,0,0);
  emitSpray(p.pos, _tmp, 14, 5, 6);
  p.airPitch = 0; p.spinAccum = 0; p.flipAccum = 0;
}

function checkCollisions(){
  const p = player;
  if(p.invuln > 0) return;
  const b = bucketOf(p.pos.z);
  for(let bi=b-1; bi<=b+1; bi++){
    const list = world.props.get(bi);
    if(!list) continue;
    for(let i=0;i<list.length;i++){
      const {o,type} = list[i];
      const dx = o.x - p.pos.x, dz = o.z - p.pos.z;
      const rad = (type==='tree'?CFG.treeR:CFG.rockR) * (0.6+o.s*0.55);
      if(dx*dx + dz*dz < rad*rad){
        const groundY = terrainH(o.x,o.z);
        const objTop = groundY + (type==='tree' ? 9*o.s : o.s*1.1);
        if(p.pos.y < objTop - 0.2){
          crash(type==='tree' ? 'HIT A TREE' : 'HIT A ROCK');
          p.vel.x -= dx*0.6; p.vel.z -= dz*0.6;
          return;
        }
      }
    }
  }
}

function checkGates(){
  const p = player;
  for(let i=0;i<world.gates.length;i++){
    const g = world.gates[i];
    if(g.passed) continue;
    if(p.pos.z > g.z){
      g.passed = true;
      if(Math.abs(p.pos.x - g.x) < g.w + 1.0){
        stats.gates++;
        const pts = 120 * (1 + stats.combo*0.15);
        stats.score += Math.round(pts);
        showTrick('GATE CLEAN', Math.round(pts), '');
        setGateColor(i, 0x9dff8f);
        sfxGate();
      } else {
        setGateColor(i, 0x63707f);
      }
    }
  }
}
function setGateColor(i, hex){
  const gm = world.gateMeshes; if(!gm) return;
  const c = new THREE.Color(hex);
  if(!gm.iFlagL.instanceColor){
    gm.iFlagL.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(world.gates.length*3).fill(1),3);
    gm.iFlagR.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(world.gates.length*3).fill(1),3);
  }
  gm.iFlagL.setColorAt(i,c); gm.iFlagR.setColorAt(i,c);
  gm.iFlagL.instanceColor.needsUpdate = true; gm.iFlagR.instanceColor.needsUpdate = true;
}
function resetGateColors(){
  const gm = world.gateMeshes;
  if(gm && gm.iFlagL.instanceColor){
    const c = new THREE.Color(0xffffff);
    for(let i=0;i<world.gates.length;i++){ gm.iFlagL.setColorAt(i,c); gm.iFlagR.setColorAt(i,c); }
    gm.iFlagL.instanceColor.needsUpdate = true; gm.iFlagR.instanceColor.needsUpdate = true;
  }
}

function finishRun(){
  stats.finished = true;
  stats.finishTime = stats.t;
  player.state = 'finish';
  stats.place = playerPlace();
  // freeze the whole field on the spot so the scene is still behind the results
  player.vel.set(0,0,0);
  player.boost = 0; player.crouch = 0; player.airPitch = 0; player.airRoll = 0;
  for(const r of racers){ r.vel.set(0,0,0); r.boost = 0; }
  const bonus = Math.max(0, Math.round(6000 - stats.t*22));
  // beating better riders is worth more
  const podium = racers.length ? Math.max(0, (racers.length + 1 - stats.place)) * 900 : 0;
  stats.raceBonus = podium;
  stats.score += bonus + podium;
  showEndScreen(bonus);
}

/* =====================================================================
   AI RIVALS
   Each rival runs the same slope physics as the player — gravity projected
   on the surface, edge grip, quadratic drag — but its inputs come from a
   controller instead of the keyboard. Skill changes four things: how hard it
   commits (push), how tightly it holds the racing line, how far ahead it sees
   obstacles, and how much random error it carries.
   ===================================================================== */
const SKILLS = {
  /* look = how far ahead it plans (m) · avoidGain = how hard it dodges
     gateAim = how much it detours to thread a checkpoint
     jumpAim = how much it hunts kickers, and how reliably it pops off the lip */
  rookie:  {name:'Rookie',  push:0.86, tuck:0.35, line:0.45, look:22, err:2.6,  react:1.5, avoidGain:0.55, gateAim:0.25, jumpAim:0.20, fan:5,  dragMul:1.00, scrub:1.00},
  amateur: {name:'Amateur', push:0.98, tuck:0.60, line:0.68, look:32, err:1.5,  react:2.2, avoidGain:0.80, gateAim:0.50, jumpAim:0.45, fan:5,  dragMul:1.00, scrub:1.00},
  pro:     {name:'Pro',     push:1.09, tuck:0.82, line:0.86, look:42, err:0.7,  react:3.0, avoidGain:1.00, gateAim:0.75, jumpAim:0.72, fan:6,  dragMul:0.97, scrub:0.90},
  /* Legend is meant to be beaten only by a near-perfect run: it never stops
     pushing, plans nearly twice as far ahead with a much finer steering fan,
     never misses a checkpoint it can reach, and takes a jump only when the
     flight actually gets it to the bottom sooner. */
  legend:  {name:'Legend',  push:1.20, tuck:1.00, line:1.00, look:78, err:0.0,  react:5.2, avoidGain:1.9, gateAim:1.00, jumpAim:1.00, fan:11, dragMul:0.90, scrub:0.45, perfect:true}
};
const RIVAL_LOOKS = [
  {name:'Vex',   jacket:0x2f7fff, deck:0xffd166, helmet:0x1b2431},
  {name:'Koa',   jacket:0x9d4edd, deck:0xa6ff9e, helmet:0xf2f4f8},
  {name:'Rune',  jacket:0x2fae5e, deck:0xff7b7b, helmet:0x243044},
  {name:'Sable', jacket:0xffd166, deck:0x7fe3ff, helmet:0x1b2431}
];
const racers = [];

function makeRacer(i, skill){
  const look = RIVAL_LOOKS[i % RIVAL_LOOKS.length];
  return {
    name: look.name, color: look.jacket, skill,
    rig: makeRider(look.jacket, look.deck, look.helmet),
    pos: new V3(), vel: new V3(), normal: new V3(0,1,0),
    yaw: 0, lean: 0, crouch: 0, airPitch: 0, airRoll: 0,
    grounded: true, grabbing: false, state: 'ride',
    lane: 0, lane0: 0, wobbleSeed: i*37.7, stumble: 0, stallT: 0,
    planT: 0, aimX: 0, threat: 0, aimGate: null, aimKick: null, poppedFor: null, immune: 0,
    gateIdx: 0, gates: 0, airT: 0, bigAir: 0, boost: 0, boostPow: 1, combo: 0, comboT: 0, lastKick: null,
    finished: false, finishTime: 0, place: 0
  };
}
function buildRacers(){
  clearRacers();
  const n = settings.rivals;
  if(!n) return;
  const skill = SKILLS[settings.skill] || SKILLS.pro;
  for(let i=0;i<n;i++) racers.push(makeRacer(i, skill));
  resetRacers();
}
function clearRacers(){
  racers.forEach(r=>{ scene.remove(r.rig.root); disposeGroup(r.rig.root); });
  racers.length = 0;
}
function resetRacers(){
  const n = racers.length;
  racers.forEach((r,i)=>{
    // fan out across the start gate, player in the middle
    const off = (i - (n-1)/2) * 5.5 + (i<n/2 ? -4 : 4);
    r.pos.set(off, 0, -3);
    // staggered heights so the field lands in a ragged line, not in lockstep
    r.pos.y = terrainH(r.pos.x, r.pos.z) + DROP_HEIGHT + (i%2 ? 2.5 : 0);
    r.vel.set(0,0,4.5);
    r.yaw = 0; r.lean = 0; r.crouch = 0; r.airPitch = 0; r.airRoll = 0;
    r.grounded = false; r.state = 'air'; r.dropping = true; r.stumble = 0; r.stallT = 0;
    r.lane = r.lane0 = off * 0.5;
    r.planT = 0; r.aimX = off*0.5; r.threat = 0; r.immune = 0;
    r.aimGate = null; r.aimKick = null; r.poppedFor = null;
    r.gateIdx = 0; r.gates = 0; r.airT = 0; r.bigAir = 0;
    r.boost = 0; r.boostPow = 1; r.combo = 0; r.comboT = 0; r.lastKick = null;
    r.finished = false; r.finishTime = 0; r.place = 0;
    r.rig.root.position.copy(r.pos);
  });
}

/* ---- the rival's route planner -------------------------------------------
   Runs ten times a second rather than every physics step. It picks what to aim
   at (the next gate, the lip of the next kicker, otherwise the racing line),
   then searches a fan of candidate paths and takes the one that threads the
   trees with the least deviation. That is what makes them look like they are
   reading the hill instead of bouncing off it. */
const _cand = [];                       // obstacles worth considering this plan
function nextGate(z, reach){
  let best = null;
  for(let i=0;i<world.gates.length;i++){
    const g = world.gates[i];
    const dz = g.z - z;
    if(dz > 4 && dz < reach && (!best || g.z < best.z)) best = g;
  }
  return best;
}
function nextKicker(z, reach, x){
  let best = null;
  for(let i=0;i<world.kickers.length;i++){
    const k = world.kickers[i];
    const dz = k.z - z;
    if(dz < 2 || dz > reach) continue;
    if(Math.abs(k.x - x) > 34) continue;         // not worth crossing the piste for
    if(!best || k.z < best.z) best = k;
  }
  return best;
}

/* Is sending this kicker actually faster than riding over it?
   Airborne you carry almost no drag, so flight is cheap distance — but the pop
   costs you the vertical component you convert on landing, and a jump you take
   badly off-line costs more. Compares the time to cover the same ground both
   ways and returns true only if the air wins. */
function jumpIsFaster(r, k){
  const v = r.vel.length();
  if(v < 8) return false;
  const s = r.skill;
  const centred = 1 - clamp(Math.abs(r.pos.x - k.x)/(k.w*1.2), 0, 1);
  if(centred < 0.3) return false;                 // too far off the ramp to commit

  const g = CFG.gravity;
  const slope = slopeGrade(k.z);
  const pop = CFG.ollie * (0.35 + 0.55*s.tuck*centred);
  // launch angle above horizontal: the ramp's own rise plus the pop
  const vUp = pop + v*Math.min(k.rise - slope, 0.5);
  const tAir = Math.max(0.15, 2*vUp/g + 2*v*slope/g);
  const dAir = v*tAir;                             // ground covered in flight
  // in the air drag is tiny; on the ground the tucked drag keeps biting
  const dragG = lerp(CFG.dragUpright, CFG.dragTuck, s.tuck)*s.dragMul;
  const vGroundAvg = v - dragG*v*v*tAir*0.5;
  const tGround = dAir / Math.max(vGroundAvg, 1);
  // landing scrubs the speed you were carrying into the slope...
  const landLoss = (vUp*0.35) / Math.max(v,1) * tAir;
  // ...but a stomped trick pays a boost out the other side, and a running
  // combo pays more, so a rider on a streak should keep hitting the park line
  const combo = Math.min((r.combo||0) + 1, 8);
  const boostT = clamp(0.40 + tAir*0.35, 0, 1.4) * (1 + combo*0.06);
  const boostGain = CFG.boostAccel*(1 + combo*0.14)*boostT / Math.max(v,1) * boostT * 0.5;
  return (tAir + landLoss - boostGain) < tGround;
}

function planRacer(r, speed){
  const s = r.skill;
  const look = clamp(s.look + speed*0.8, 22, 95);
  const z0 = r.pos.z, x0 = r.pos.x;

  // 1. base line: the ideal line plus this rider's lane and a slow wander
  const drift = Math.sin(z0*0.006 + r.wobbleSeed) * s.err * 3.2;
  let want = raceLine(z0)*s.line + r.lane + drift;

  /* 2. Waypoints. Thread the next checkpoint OR line up the next kicker —
     whichever comes first. Steering at both at once just splits the difference
     and misses both, which is exactly what it did before. */
  const g = nextGate(z0, look*1.9);
  const k = nextKicker(z0, look*1.5, x0);
  r.aimGate = g || null;

  // know about the kicker beneath us regardless, so we can pop off whatever we
  // happen to run over even when the gate is what we are steering for
  const prevKick = r.aimKick;
  r.aimKick = (k && Math.abs(k.x - x0) < k.w*2.2 + 12) ? k : null;
  if(r.aimKick && r.aimKick !== prevKick){
    // a perfect rider works out whether the air is quicker; everyone else just
    // sends it more often the better they are
    r.willPop = s.perfect ? jumpIsFaster(r, r.aimKick)
                          : Math.random() < s.jumpAim + 0.1;
  }

  let tx = null, tz = 0, tw = 0, reach = 1;
  if(g && (!k || g.z <= k.z + 14)){
    tx = g.x; tz = g.z; tw = s.gateAim; reach = look*1.9;
  } else if(k && s.jumpAim > 0.05 && Math.abs(k.x - want) < 26 && r.willPop !== false){
    tx = k.x; tz = k.z; tw = s.jumpAim; reach = look*1.5;
  }
  if(tx !== null){
    // commit early so there is room to get across, then hold the line
    const w = tw * clamp((1 - (tz - z0)/reach) * 1.7, 0, 1);
    want = lerp(want, tx, w);
  }
  // a perfect rider goes to the flag, full stop — no lane, no wander
  if(s.perfect && g) want = lerp(want, g.x, clamp(1 - (g.z-z0)/(look*1.4), 0, 1));
  want = clamp(want, -COURSE.halfWidth*0.94, COURSE.halfWidth*0.94);

  // 4. gather obstacles that could actually be in the way
  _cand.length = 0;
  const b0 = bucketOf(z0), b1 = bucketOf(z0 + look);
  for(let b=b0;b<=b1;b++){
    const list = world.props.get(b);
    if(!list) continue;
    for(let i=0;i<list.length;i++){
      const o = list[i].o;
      if(o.z <= z0+1 || o.z > z0+look) continue;
      if(Math.abs(o.x - x0) > (s.perfect ? 60 : 42)) continue;
      _cand.push(list[i]);
      if(_cand.length >= (s.perfect ? 90 : 40)) break;
    }
  }

  // 5. score a fan of aim points and take the cheapest. The fan is deliberately
  //    narrow: dodging a tree should cost a few metres of line, not thirty.
  const spread = 4 + speed*0.28;
  const N = s.fan;                       // better riders search a finer fan
  let bestX = want, bestCost = Infinity;
  for(let i=-N;i<=N;i++){
    const aim = want + (i/N)*spread*1.6;
    if(Math.abs(aim) > COURSE.halfWidth*0.99) continue;
    let cost = Math.abs(aim - want) * 2.2;                  // stay near the plan
    cost += Math.max(0, Math.abs(aim) - COURSE.halfWidth*0.8) * 3.0;  // stay on piste
    const dx = aim - x0;
    for(let j=0;j<_cand.length;j++){
      const o = _cand[j].o;
      const t = (o.z - z0)/look;
      const px = x0 + dx*t;                                 // where we would be
      const clear = Math.abs(o.x - px);
      const need = (_cand[j].type==='tree' ? 2.7 : 2.2) + o.s*1.5;
      if(clear < need) cost += (need - clear) * (1.6 - t) * 30 * s.avoidGain;
    }
    if(cost < bestCost){ bestCost = cost; bestX = aim; }
  }
  r.aimX = bestX;
  r.threat = bestCost;
}

const _rf = new V3(), _rs = new V3(), _rg = new V3(), _rt = new V3();
function stepRacer(r, dt){
  if(r.finished){ r.vel.multiplyScalar(1-1.4*dt); r.pos.addScaledVector(r.vel,dt); r.pos.y = terrainH(r.pos.x,r.pos.z); return; }
  const s = r.skill;
  const h = terrainH(r.pos.x, r.pos.z);
  terrainN(r.pos.x, r.pos.z, r.normal);
  r.grounded = (r.pos.y - h) < 0.12 && r.vel.y <= 2.0;
  const speed = r.vel.length();

  // ---- decide where to be ----
  r.lane = damp(r.lane, r.lane0, 0.4, dt);     // dodges relax back to your lane
  r.planT -= dt;
  // the sharper the rider, the more often it re-reads the hill
  if(r.planT <= 0){ planRacer(r, speed); r.planT = s.perfect ? 0.04 : 0.09; }
  const targetX = r.aimX;

  const fall = Math.atan2(r.normal.x, r.normal.z);
  const wantYaw = fall - clamp((r.pos.x - targetX)*0.028, -0.75, 0.75);
  const dYaw = angDiff(wantYaw, r.yaw);

  if(r.grounded){
    const steerRate = CFG.steerRate / (1 + speed*CFG.steerFalloff);
    const steerIn = clamp(dYaw*s.react, -1, 1);
    r.yaw += steerIn * steerRate * dt;
    r.lean = damp(r.lean, steerIn*clamp(speed/26,0,1), 7, dt);

    // gravity along the slope, scaled by how hard this rider commits
    const n = r.normal;
    _rf.set(Math.sin(r.yaw), 0, Math.cos(r.yaw));
    _rs.crossVectors(n, _rf).normalize();
    _rf.crossVectors(_rs, n).normalize();
    _rg.set(0,-CFG.gravity,0);
    _rt.copy(n).multiplyScalar(_rg.dot(n));
    _rg.sub(_rt).multiplyScalar(s.push);
    r.vel.addScaledVector(_rg, dt);

    let vf = r.vel.dot(_rf), vs = r.vel.dot(_rs);
    const carving = Math.abs(steerIn) > 0.25;
    vs *= Math.exp(-(carving ? CFG.gripCarve : CFG.gripBase)*dt);

    // tucks on the straights, stands up in the turns — a perfect rider never
    // stops tucking, however hard it is steering
    const tuck = s.perfect ? s.tuck : s.tuck * (1 - Math.min(1, Math.abs(steerIn)*1.4));
    const drag = lerp(CFG.dragUpright, CFG.dragTuck, tuck) * s.dragMul;
    const offPiste = Math.abs(r.pos.x) > COURSE.halfWidth;
    let dec = CFG.frictionSnow*(offPiste?2.2:1)*CFG.gravity*n.y + drag*vf*vf;
    if(r.stumble > 0){ dec += 9; r.stumble -= dt; }
    // rivals bank the same trick boost the player does
    if(r.boost > 0){ vf += CFG.boostAccel*r.boostPow*dt; r.boost -= dt; }
    // A top rider checks its speed when the only line left is a tight one —
    // losing a few mph beats putting a shoulder into a tree. Capped, and only
    // above a floor speed, so a permanently tight course can never stall it.
    if(s.perfect && r.threat > 25 && vf > 18){
      dec += Math.min((r.threat-25)*0.10, 7);
    }
    vf = Math.max(0, vf - dec*dt);
    // a clean rider bleeds far less speed through a turn than a scrubby one
    if(carving) vf -= Math.abs(steerIn)*speed*0.05*(1.3 - s.tuck)*s.scrub*dt;

    r.vel.copy(_rf).multiplyScalar(vf).addScaledVector(_rs, vs);
    r.vel.addScaledVector(n, -r.vel.dot(n));
    r.pos.y = h;
    r.state = 'ride'; r.airPitch = 0;
    if(r.dropping){                       // the opening drop is not a jump
      r.dropping = false; r.bigAir = 0; r.airT = 0;
      _rt.set(0,0,0); emitSpray(r.pos, _rt, 10, 3.5, 4);
    } else if(r.airT > 0.35){
      // stomped a jump: bank the boost and extend the combo
      r.combo = Math.min(r.combo + 1, 8);
      r.boost = clamp(0.40 + r.airT*0.35, 0, 1.4) * (1 + r.combo*0.06);
      r.boostPow = 1 + r.combo*0.14;
      r.comboT = 9;                       // holds while jumps keep coming
      r.airT = 0;
    }
    if(r.comboT > 0){ r.comboT -= dt; if(r.comboT <= 0) r.combo = 0; }

    /* ---- pop off the lip ----
       Crouch on the run-in, then push off within a stride of the lip. A better
       rider times it tighter and pushes harder, so the same jump sends them
       noticeably further down the landing. */
    const k = r.aimKick;
    let loading = 0;
    if(k && k !== r.poppedFor){
      const dz = k.z - r.pos.z;
      const centred = 1 - clamp(Math.abs(r.pos.x - k.x)/(k.w*1.4), 0, 1);
      loading = clamp(1 - dz/9, 0, 1) * centred;
      const window = 0.7 + s.err*0.8;          // sloppier riders pop early or late
      if(r.willPop && dz < window && dz > -1.6 && centred > 0.25){
        const power = 0.35 + 0.55*s.tuck*centred;
        r.vel.addScaledVector(n, CFG.ollie*power);
        r.pos.y += 0.06;
        r.poppedFor = k;
        r.crouch = 0;
      }
    }
    r.crouch = damp(r.crouch, 0.25 + tuck*0.5 + loading*0.5, 7, dt);
    applyLaunch(r, dt);            // rivals get thrown by the lip too
    if(Math.abs(vs) > 2.2 && Math.random() < dt*22){
      _rt.copy(_rs).multiplyScalar(-Math.sign(vs));
      emitSpray(r.pos, _rt, 2, 1.2, clamp(Math.abs(vs)*0.5,1,6));
    }
  } else {
    if(r.state !== 'air'){ r.state = 'air'; r.airT = 0; }
    r.airT += dt;
    r.vel.y -= CFG.gravity*dt;
    _rt.copy(r.vel).multiplyScalar(-CFG.dragAir*r.vel.length()*dt);
    r.vel.add(_rt);
    // a confident rider tucks and grabs; a nervous one flails
    r.crouch = damp(r.crouch, 0.35 + s.tuck*0.5, 5, dt);
    r.grabbing = r.airT > 0.35 && s.tuck > 0.5;
    if(r.airT > r.bigAir) r.bigAir = r.airT;
    // rivals square up for their landings too
    const travel = Math.atan2(r.vel.x, r.vel.z);
    r.yaw += angDiff(travel, r.yaw) * (1-Math.exp(-6*dt));
    r.lean = damp(r.lean, 0, 4, dt);
  }

  r.pos.addScaledVector(r.vel, dt);
  const nh = terrainH(r.pos.x, r.pos.z);
  if(r.pos.y < nh){
    r.pos.y = nh;
    terrainN(r.pos.x, r.pos.z, r.normal);
    const vn = r.vel.dot(r.normal);
    if(vn < 0) r.vel.addScaledVector(r.normal, -vn);
  }
  if(Math.abs(r.pos.x) > COURSE.meshHalf-6){
    r.pos.x = Math.sign(r.pos.x)*(COURSE.meshHalf-6); r.vel.x *= -0.25;
  }

  // clipped a tree: lose most of your speed, no wipeout animation. Shove the
  // rider clear of the trunk and give it a moment of grace, otherwise it can
  // sit inside a cluster re-colliding forever and never finish.
  if(r.immune > 0) r.immune -= dt;
  if(r.stumble <= 0 && r.immune <= 0){
    const b = bucketOf(r.pos.z);
    outer:
    for(let bi=b-1; bi<=b+1; bi++){
      const list = world.props.get(bi); if(!list) continue;
      for(let i=0;i<list.length;i++){
        const {o,type} = list[i];
        const dx=r.pos.x-o.x, dz=r.pos.z-o.z;
        const rad = (type==='tree'?CFG.treeR:CFG.rockR)*(0.6+o.s*0.55);
        const d2 = dx*dx+dz*dz;
        if(d2 < rad*rad){
          const d = Math.sqrt(d2) || 0.01;
          r.pos.x = o.x + (dx/d)*(rad+0.6);
          r.pos.z = o.z + (dz/d)*(rad+0.6);
          r.pos.y = terrainH(r.pos.x, r.pos.z);
          r.lane += Math.sign(dx || 1) * 4;
          r.vel.multiplyScalar(0.45);
          r.stumble = 1.0;
          r.immune = 1.1;
          break outer;
        }
      }
    }
  }

  // Anti-stall: if a rival has bogged down — crawling, not just slow — point it
  // straight down the fall line, clear the stumble and give it a shove. Set
  // generously (4 m/s) so a rider grinding through a cluster still gets freed.
  if(r.vel.lengthSq() < 16){
    r.stallT = (r.stallT||0) + dt;
    if(r.stallT > 1.5){
      r.yaw = Math.atan2(r.normal.x, r.normal.z);
      r.lane = r.lane0;
      r.vel.set(Math.sin(r.yaw)*7, 0, Math.cos(r.yaw)*7);
      r.stallT = 0; r.stumble = 0; r.immune = 1.4;
    }
  } else r.stallT = 0;

  // checkpoints cleared
  while(r.gateIdx < world.gates.length && world.gates[r.gateIdx].z < r.pos.z){
    const g = world.gates[r.gateIdx++];
    if(Math.abs(r.pos.x - g.x) < g.w + 1.0) r.gates++;
  }

  if(!r.finished && r.pos.z >= COURSE.finishZ){
    r.finished = true; r.finishTime = stats.t;
  }
}
function stepRacers(dt){ for(let i=0;i<racers.length;i++) stepRacer(racers[i], dt); }

/* Standings: anyone who has finished is ordered by time, everyone still riding
   by how far down the hill they are. */
const standings = [];
function updateStandings(){
  standings.length = 0;
  standings.push({name:'You', z:player.pos.z, finished:stats.finished, time:stats.finishTime, you:true, color:0xe2582f});
  for(const r of racers) standings.push({name:r.name, z:r.pos.z, finished:r.finished, time:r.finishTime, you:false, color:r.color});
  standings.sort((a,b)=>{
    if(a.finished && b.finished) return a.time - b.time;
    if(a.finished) return -1;
    if(b.finished) return 1;
    return b.z - a.z;
  });
  for(let i=0;i<standings.length;i++) standings[i].place = i+1;
  return standings;
}
function playerPlace(){
  const s = updateStandings();
  for(const e of s) if(e.you) return e.place;
  return 1;
}
const ORDINAL = ['','1st','2nd','3rd','4th','5th','6th'];

/* ---------------- rider pose ---------------- */
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _bx = new V3(), _by = new V3(), _bz = new V3();
const _qr = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _axZ = new V3(0,0,1), _axX = new V3(1,0,0);
/* Poses any rig from any entity that carries pos / yaw / normal / grounded /
   lean / crouch / airPitch / state. The player and every rival share it. */
function poseRig(rig, p, dt, isPlayer){
  const P = rig.parts;
  const n = p.grounded ? p.normal : _by.set(0,1,0).lerp(p.normal, 0.15).normalize();
  _bz.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  _bx.crossVectors(n, _bz).normalize();
  _bz.crossVectors(_bx, n).normalize();
  _by.copy(n);
  _m.makeBasis(_bx, _by, _bz);
  _q.setFromRotationMatrix(_m);

  const roll = -p.lean*0.42 + (p.state==='crash' ? p.airRoll : 0);
  _qr.setFromAxisAngle(_axZ, roll);
  _qp.setFromAxisAngle(_axX, p.airPitch);
  _q.multiply(_qp).multiply(_qr);

  rig.root.position.copy(p.pos);
  rig.root.quaternion.slerp(_q, 1-Math.exp(-22*dt));

  /* ---- lower body ----
     The hips drop with the crouch and the knees solve for it: with the foot
     pinned to the board, the thigh swings out by the angle whose cosine is half
     the remaining hip-to-ankle distance over the bone length, and the shin
     swings back by twice that. The bend happens in the lateral plane — a
     snowboarder's knees track out over the toe edge, not forward over the
     toes like a squat. */
  const cr = p.crouch;
  const hipY = RIG.hipY - cr*0.40;
  const reach = clamp(hipY - RIG.footY, 0.18, RIG.thigh + RIG.shin - 0.001);
  const kneeA = Math.acos(clamp(reach / (RIG.thigh + RIG.shin), -1, 1));
  // Both knees always drive out to the rider's left. In this rig the model
  // faces +Z with +Y up, which makes local +X the rider's left-hand side.
  const kneeSide = 1;
  for(let i=0;i<P.hipJoints.length;i++){
    const hj = P.hipJoints[i];
    const ud = hj.userData;
    hj.position.y = hipY;
    // both legs use the same solve so both boots stay planted on the deck
    hj.rotation.z = kneeSide * kneeA;                // knee tracks out to the side
    hj.rotation.x = -cr * 0.10;                      // a touch of forward load only
    ud.knee.rotation.z = -kneeSide * 2 * kneeA;
    ud.ankle.rotation.z = kneeSide * kneeA;          // sole stays flat on the deck
    ud.ankle.rotation.x = cr * 0.10;
  }
  // hips follow the legs down, and only lean forward enough to stay balanced
  P.hips.position.y = hipY + 0.12;
  P.hips.rotation.x = 0.10 + cr*0.30;
  P.hips.rotation.y = -p.lean*0.35;

  const grab = p.grabbing ? 1 : 0;
  const armSpread = p.grounded ? 0.55 + Math.abs(p.lean)*0.5 : 1.15;
  P.armL.rotation.z = lerp(-armSpread, -0.35, grab);
  P.armR.rotation.z = lerp(armSpread, 0.35, grab);
  P.armL.rotation.x = lerp(0.25 - p.lean*0.5, 1.5, grab);
  P.armR.rotation.x = lerp(0.25 + p.lean*0.5, 1.5, grab);
  P.head.rotation.y = p.lean*0.5;
  P.head.rotation.x = -0.12 - cr*0.2;

  /* In first person the head is the camera, so the torso always goes. On the
     ground you still see your legs and board underneath; the moment you leave
     the lip everything but the board is hidden, so a spin is just the board
     turning under you. */
  const fp = isPlayer && settings.cam === 'first';
  const fpAir = fp && !p.grounded;
  P.bodyMeshes.forEach(m=> m.visible = !fp);
  P.armL.visible = P.armR.visible = fp ? (!fpAir && p.grabbing) : true;
  P.legs.visible = !fpAir;
}
function poseRider(dt){
  poseRig(rider, player, dt, true);
  for(let i=0;i<racers.length;i++) poseRig(racers[i].rig, racers[i], dt, false);
}

/* ---------------- 7. camera ---------------- */
let camYawOff = 0, camPitchOff = 0, shakeAmt = 0, camFov = 62, camYaw = 0, camLead = 0;
const camPos = new V3(), camLook = new V3(), _cf = new V3(), _cs = new V3(), _ry = new V3();
function updateCamera(dt){
  const p = player;
  const speed = p.vel.length();
  const spd01 = clamp(speed/40,0,1);

  /* The chase camera tracks the board only while it is on the snow. Once you
     are airborne it holds the heading it had at take-off, so a 720 spins the
     rider in front of a steady camera instead of whipping the whole world
     around. First person does the opposite — see below. */
  if(p.grounded || p.state === 'crash'){
    camYaw += angDiff(p.yaw, camYaw) * (1 - Math.exp(-11*dt));
  } else if(landing.valid){
    // ease onto the heading you will actually land on, so touchdown is seamless
    camYaw += angDiff(landing.yaw, camYaw) * (1 - Math.exp(-1.6*dt));
  }
  // Swing the camera into the turn rather than trailing it round: steering
  // right pushes the view right, which is where you are actually going.
  const steerNow = (input.left?1:0) - (input.right?1:0);
  camLead = damp(camLead, p.grounded ? steerNow*0.42 : 0, 5, dt);
  _cf.set(Math.sin(camYaw + camLead + camYawOff), 0, Math.cos(camYaw + camLead + camYawOff)).normalize();

  if(settings.cam === 'third'){
    const dist = 8.2 + spd01*3.4;
    const height = 3.4 + spd01*0.8 + camPitchOff*4;
    const want = _tmp.copy(p.pos).addScaledVector(_cf, -dist);
    want.y = Math.max(want.y + height, terrainH(want.x, want.z) + 1.8);
    const k = p.state==='crash' ? 3.5 : 7.0;
    camPos.lerp(want, 1-Math.exp(-k*dt));
    // aim at the slope ahead, not at a point in mid-air, so the horizon sits still
    const ahead = _cs.copy(p.pos).addScaledVector(_cf, 16);
    ahead.y = Math.max(terrainH(ahead.x, ahead.z), p.pos.y - 14) + 3.4 + camPitchOff*6;
    camLook.lerp(ahead, 1-Math.exp(-9*dt));
    camera.position.copy(camPos);
    camera.up.set(0,1,0);
    camera.lookAt(camLook);
    camera.rotateZ(p.lean*0.06);
  } else {
    /* First person is head-locked: the camera inherits the rider's own
       orientation, so a spin, a flip or a lean carries the view with it. That
       is the opposite of the chase camera on purpose — in the helmet you want
       to feel the rotation, from behind you want a stable frame to watch it. */
    const eye = _tmp.set(0,0,0);
    if(p.grounded || p.state==='crash'){
      rider.parts.head.getWorldPosition(eye);
      eye.y += 0.06 + Math.sin(stats.t*22)*0.02*spd01;
    } else {
      // eyes sit above the deck and turn with it, rather than on the flailing head
      eye.copy(p.pos).addScaledVector(_ry.set(0,1,0).applyQuaternion(rider.root.quaternion), 1.62);
    }
    camera.position.copy(eye);
    camera.quaternion.copy(rider.root.quaternion);
    camera.rotateY(Math.PI + camYawOff);        // rider faces +Z, camera looks down -Z
    // on the ground the rider's frame is already slope-aligned, so a small tilt
    // is enough; in the air look further down to keep the board in shot
    camera.rotateX(-(p.grounded ? 0.30 : 0.62) + camPitchOff);
    if(p.state==='crash') camera.rotateZ(p.airRoll*0.4);
  }

  // speed FOV + shake
  const wantFov = (settings.cam==='first' ? 78 : 62) + spd01*16;
  camFov = damp(camFov, wantFov, 4, dt);
  if(shakeAmt > 0.001){
    camera.position.x += (Math.random()*2-1)*shakeAmt;
    camera.position.y += (Math.random()*2-1)*shakeAmt;
    camera.position.z += (Math.random()*2-1)*shakeAmt;
    shakeAmt = damp(shakeAmt, 0, 6, dt);
  }
  camera.fov = camFov; camera.updateProjectionMatrix();

  sky.position.copy(camera.position);
  mountains.position.set(camera.position.x, p.pos.y - 120, camera.position.z);
  snowfall.position.set(camera.position.x, camera.position.y, camera.position.z);
  const sp = (world.sky||SKIES.day).sunPos;
  sun.position.set(p.pos.x + sp[0], p.pos.y + sp[1], p.pos.z + sp[2]);
  sunTarget.position.copy(p.pos);
}
function shake(a){ shakeAmt = Math.min(shakeAmt + a, 0.9); }
function flash(a){
  const f = $('flash'); f.style.transition='none'; f.style.opacity = a;
  requestAnimationFrame(()=>{ f.style.transition='opacity .5s'; f.style.opacity = 0; });
}

/* ---------------- 9. audio ---------------- */
const audio = { ctx:null, on:true, wind:null, carve:null, windG:null, carveG:null, master:null };
function initAudio(){
  if(audio.ctx) return;
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC(); audio.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    audio.master = master;
    const len = ctx.sampleRate*2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i] = Math.random()*2-1;

    const w = ctx.createBufferSource(); w.buffer = buf; w.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type='lowpass'; wf.frequency.value=520;
    const wg = ctx.createGain(); wg.gain.value = 0;
    w.connect(wf).connect(wg).connect(master); w.start();
    audio.wind = w; audio.windG = wg; audio.windF = wf;

    const c = ctx.createBufferSource(); c.buffer = buf; c.loop = true;
    const cf = ctx.createBiquadFilter(); cf.type='bandpass'; cf.frequency.value=1800; cf.Q.value=0.8;
    const cg = ctx.createGain(); cg.gain.value = 0;
    c.connect(cf).connect(cg).connect(master); c.start();
    audio.carve = c; audio.carveG = cg; audio.carveF = cf;
  }catch(e){ audio.ctx = null; }
}
function updateAudio(dt){
  if(!audio.ctx) return;
  const on = audio.on && game.mode==='play' ? 1 : 0;
  const sp = player.vel.length();
  const s01 = clamp(sp/45,0,1);
  audio.windG.gain.value = damp(audio.windG.gain.value, on*(0.02 + s01*0.30), 4, dt);
  audio.windF.frequency.value = 380 + s01*900;
  const carving = player.grounded && (input.left||input.right||input.brake) ? 1 : 0;
  const edge = player.grounded ? clamp(Math.abs(player.vel.dot(_side))*0.2,0,1) : 0;
  audio.carveG.gain.value = damp(audio.carveG.gain.value, on*(carving*0.16 + edge*0.2)*(0.3+s01), 6, dt);
  audio.carveF.frequency.value = 900 + s01*2600;
}
function blip(freq, dur, type, vol){
  if(!audio.ctx || !audio.on) return;
  const ctx = audio.ctx, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type||'sine'; o.frequency.value = freq;
  g.gain.value = 0; o.connect(g).connect(audio.master);
  const t = ctx.currentTime;
  g.gain.linearRampToValueAtTime(vol||0.18, t+0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, t+dur);
  o.start(t); o.stop(t+dur+0.02);
}
function sfxPop(p){ blip(180+p*130, 0.16, 'triangle', 0.14); }
function sfxLand(i){ blip(90+i*4, 0.22, 'sawtooth', 0.10); }
function sfxGate(){ blip(880, 0.10, 'square', 0.07); setTimeout(()=>blip(1320,0.12,'square',0.06),70); }
function sfxCrash(){
  if(!audio.ctx || !audio.on) return;
  const ctx=audio.ctx, len=ctx.sampleRate*0.5, b=ctx.createBuffer(1,len,ctx.sampleRate), d=b.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2);
  const s=ctx.createBufferSource(); s.buffer=b;
  const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=900;
  const g=ctx.createGain(); g.gain.value=0.4;
  s.connect(f).connect(g).connect(audio.master); s.start();
}

/* ---------------- 10. input + settings ---------------- */
const input = { left:false, right:false, tuck:false, brake:false, fwd:false, back:false, jump:false, grab:false };
// tuck/brake are derived, so only these can actually be written to
const RAW_INPUTS = ['left','right','fwd','back','jump','grab'];
function clearInput(){ for(const k of RAW_INPUTS) input[k] = false; }
const settings = { cam:'third', qual:'high', map:'timber', skill:'pro', rivals:3, sens:1.0, sound:true };
const game = { mode:'load', hudVisible:true, needRebuild:false };

const KEYMAP = {
  KeyA:'left', ArrowLeft:'left', KeyD:'right', ArrowRight:'right',
  KeyW:'fwd', ArrowUp:'fwd', KeyS:'back', ArrowDown:'back',
  Space:'jump', ShiftLeft:'grab', ShiftRight:'grab'
};

addEventListener('keydown', e=>{
  // the copyright dialog swallows everything except the key that closes it
  if(legalOpen){
    if(e.code === 'Escape' || e.code === 'Enter'){ showLegal(false); e.preventDefault(); }
    return;
  }
  if(e.code === 'Space') e.preventDefault();
  const k = KEYMAP[e.code];
  if(k) input[k] = true;
  if(e.repeat) return;
  switch(e.code){
    case 'KeyC': toggleCam(); break;
    case 'KeyP': case 'Escape': if(game.mode==='play') pause(); else if(game.mode==='pause') resume(); break;
    case 'KeyR': if(game.mode!=='load') startGame(true); break;
    case 'KeyH': game.hudVisible = !game.hudVisible; $('hud').classList.toggle('on', game.hudVisible && game.mode==='play'); break;
    case 'KeyM': if(game.mode!=='load' && game.mode!=='menu') returnToMenu(); break;
    case 'KeyN': settings.sound = !settings.sound; audio.on = settings.sound; toast(settings.sound?'SOUND ON':'SOUND OFF'); break;
    case 'Enter': if(game.mode==='menu') startGame(false); else if(game.mode==='end') startGame(true); break;
  }
});
addEventListener('keyup', e=>{ const k = KEYMAP[e.code]; if(k) input[k] = false; });
addEventListener('blur', clearInput);

/* ---- source-inspection shortcuts ----
   Blocks right-click, view-source, save, print and the devtools shortcuts.
   Worth being straight about it: this is a deterrent, not protection. Browsers
   let anyone open devtools from the menu, and the files are plain text on the
   wire either way. Anything that must stay secret belongs on a server. */
addEventListener('contextmenu', e=> e.preventDefault());
addEventListener('dragstart', e=> e.preventDefault());
addEventListener('keydown', e=>{
  const k = e.key.toLowerCase();
  const block =
    e.key === 'F12' ||
    (e.ctrlKey && !e.shiftKey && (k === 'u' || k === 's' || k === 'p')) ||
    ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) ||
    (e.metaKey && e.altKey && (k === 'i' || k === 'j' || k === 'c' || k === 'u'));
  if(block){ e.preventDefault(); e.stopPropagation(); return false; }
}, true);

// derived aliases
Object.defineProperty(input,'tuck',{get(){ return this.fwd && player.grounded; },configurable:true});
Object.defineProperty(input,'brake',{get(){ return this.back && player.grounded; },configurable:true});

// mouse look
let pointerLocked = false;
$('scene').addEventListener('click', ()=>{
  // returns a promise in newer browsers, and rejects in sandboxed frames
  if(game.mode==='play' && !pointerLocked){
    const q = $('scene').requestPointerLock();
    if(q && q.catch) q.catch(()=>{});
  }
});
document.addEventListener('pointerlockchange', ()=>{ pointerLocked = document.pointerLockElement === $('scene'); });
addEventListener('mousemove', e=>{
  if(!pointerLocked || game.mode!=='play') return;
  camYawOff = clamp(camYawOff - e.movementX*0.0022, -1.5, 1.5);
  camPitchOff = clamp(camPitchOff - e.movementY*0.0016, -0.5, 0.6);
});

function toggleCam(){
  settings.cam = settings.cam==='third' ? 'first' : 'third';
  $('camTag').textContent = settings.cam==='third' ? 'THIRD PERSON' : 'FIRST PERSON';
  document.querySelectorAll('#optCam button').forEach(b=> b.classList.toggle('on', b.dataset.v===settings.cam));
  camYawOff = 0; camPitchOff = 0;
}

/* map picker: one row per mountain, with its length and pitch */
function buildMapList(){
  const host = $('mapList');
  let html = '';
  for(const key in MAPS){
    const m = MAPS[key];
    const miles = (m.length*FT/5280).toFixed(1);
    const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="'+m.color
               + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
               + MAP_ICONS[m.icon] + '</svg>';
    html += '<button class="mapRow'+(key===settings.map?' on':'')+'" data-map="'+key+'">'
          + '<span class="swatch" style="background:'+m.color+'22;border-color:'+m.color+'66">'+icon+'</span>'
          + '<span class="mtxt"><span class="mname">'+m.name+'</span>'
          + '<span class="mblurb">'+m.blurb+'</span>'
          + '<span class="mfeel" style="color:'+m.color+'">'+m.feel+'</span></span>'
          + '<span class="mstat">'+miles+' mi<br>'+m.kickers+' jumps</span>'
          + '</button>';
  }
  host.innerHTML = html;
  host.addEventListener('click', e=>{
    const b = e.target.closest('.mapRow'); if(!b) return;
    settings.map = b.dataset.map;
    game.needRebuild = true;
    host.querySelectorAll('.mapRow').forEach(x=>x.classList.toggle('on', x===b));
    updateMenuKicker();
  });
  updateMenuKicker();
}
function updateMenuKicker(){
  const m = MAPS[settings.map];
  // vertical drop over the whole course, in feet
  const drop = Math.round(m.grade*m.length*FT/100)*100;
  $('menuKicker').textContent = m.name + ' · ' + m.feel + ' · '
    + (m.length*FT/5280).toFixed(1) + ' mile run · '
    + drop.toLocaleString() + ' ft vertical';
  $('menuKicker').style.color = m.color;
}

// segmented settings controls
function wireSeg(id, cb){
  const el = $(id);
  el.addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    el.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); cb(b.dataset.v);
  });
}

/* ---------------- HUD ---------------- */
const HUD = {};
const SPEEDO_MAX = 90;   // mph, full sweep of the dial
function cacheHud(){
  ['runTime','scoreVal','comboTag','distVal','altVal','dropVal','gradeVal','topVal','airVal',
   'trickVal','gateVal','crashVal','progFill','progTxt','speedNum','chargeFill',
   'chargeTxt','mapZ','warnTag','arcFg','arcBg','ticks','leanBar','progPct'].forEach(id=> HUD[id]=$(id));
  HUD.leanFill = HUD.leanBar.querySelector('i');
  // speedo arc geometry
  const A0 = 140, A1 = 400;   // degrees
  const R = 58, C = 84;
  const pt = a => { const r = a*Math.PI/180; return [C + Math.cos(r)*R, C + Math.sin(r)*R]; };
  const arc = (a0,a1)=>{
    const [x0,y0] = pt(a0), [x1,y1] = pt(a1);
    const large = (a1-a0) > 180 ? 1 : 0;
    return 'M '+x0.toFixed(2)+' '+y0.toFixed(2)+' A '+R+' '+R+' 0 '+large+' 1 '+x1.toFixed(2)+' '+y1.toFixed(2);
  };
  HUD.arcBg.setAttribute('d', arc(A0,A1));
  HUD.arcPath = arc;
  HUD.A0 = A0; HUD.A1 = A1;
  // tick marks every 15 mph up to the dial maximum
  let t = '';
  for(let v=0; v<=SPEEDO_MAX; v+=15){
    const a = A0 + (v/SPEEDO_MAX)*(A1-A0);
    const r = a*Math.PI/180;
    const x0 = C+Math.cos(r)*(R-9), y0 = C+Math.sin(r)*(R-9);
    const x1 = C+Math.cos(r)*(R-14), y1 = C+Math.sin(r)*(R-14);
    t += '<line x1="'+x0.toFixed(1)+'" y1="'+y0.toFixed(1)+'" x2="'+x1.toFixed(1)+'" y2="'+y1.toFixed(1)+'" stroke="rgba(200,225,245,.45)" stroke-width="1.4"/>';
  }
  HUD.ticks.innerHTML = t;
  HUD.gateVal.textContent = '0/'+world.gates.length;
  HUD.progTxt.textContent = '0 / '+ft(COURSE.finishZ).toLocaleString()+' ft';
  $('mapName').textContent = world.map.name;
  // progress ticks = gates
  let pt2 = '';
  world.gates.forEach(g=>{ pt2 += '<i style="left:'+((g.z/COURSE.finishZ)*100).toFixed(2)+'%"></i>'; });
  $('progTicks').innerHTML = pt2;
}

let hudAcc = 0;
function updateHud(dt){
  const p = player, sp = p.vel.length()*MPH;
  // speedo (every frame, it is the twitchy one)
  HUD.speedNum.textContent = Math.round(sp);
  const f = clamp(sp/SPEEDO_MAX,0,1);
  HUD.arcFg.setAttribute('d', HUD.arcPath(HUD.A0, HUD.A0 + f*(HUD.A1-HUD.A0)));
  HUD.chargeFill.style.width = (p.charge/CFG.maxCharge*100).toFixed(0)+'%';
  HUD.chargeTxt.textContent = Math.round(p.charge/CFG.maxCharge*100)+'%';
  HUD.leanFill.style.left = (50 + p.lean*-46)+'%';

  const airBig = $('airTimeBig'), spinBig = $('spinBig'), landCue = $('landCue');
  $('airBox').classList.toggle('on', p.state==='air');
  if(p.state==='air'){
    airBig.classList.add('on'); airBig.textContent = p.airTime.toFixed(1)+'s';
    const deg = Math.abs(p.spinAccum)*180/Math.PI;
    const flipD = Math.abs(p.flipAccum)*180/Math.PI;
    let s = '';
    if(deg > 60) s += (p.spinAccum>0?'FS ':'BS ') + Math.round(deg/10)*10 + '° ';
    if(flipD > 90) s += (p.flipAccum>0?'FRONT':'BACK')+'FLIP ';
    if(p.grabbing) s += 'GRAB';
    spinBig.textContent = s;
    spinBig.classList.toggle('on', s.length>0);
    if(landing.valid){
      landCue.textContent = p.assist > 0.02
        ? 'Squaring up — touchdown ' + landing.t.toFixed(1) + 's'
        : 'Landing ' + ft(landing.z - p.pos.z) + ' ft ahead · ' + landing.t.toFixed(1) + 's';
      landCue.classList.add('on');
    } else landCue.classList.remove('on');
  } else { spinBig.textContent = ''; landCue.textContent = ''; }

  hudAcc += dt;
  if(hudAcc < 0.08) return;
  hudAcc = 0;
  HUD.runTime.textContent = fmtTime(stats.t);
  HUD.scoreVal.textContent = stats.score.toLocaleString();
  const mult = 1 + stats.combo*0.25;
  HUD.comboTag.textContent = 'x'+mult.toFixed(2);
  HUD.comboTag.style.color = stats.combo>0 ? '#ffd166' : '#8ba3bd';
  HUD.distVal.innerHTML = Math.max(0, ft(p.pos.z)).toLocaleString()+'<small>ft</small>';
  HUD.altVal.innerHTML = (BASE_ALT_FT + ft(p.pos.y)).toLocaleString()+'<small>ft</small>';
  HUD.dropVal.innerHTML = ft(stats.startY - p.pos.y).toLocaleString()+'<small>ft</small>';
  HUD.gradeVal.innerHTML = (Math.atan(slopeGrade(p.pos.z))*180/Math.PI).toFixed(1)+'<small>&deg;</small>';
  HUD.topVal.innerHTML = mph(stats.top)+'<small>mph</small>';
  HUD.airVal.innerHTML = stats.air.toFixed(1)+'<small>s</small>';
  HUD.trickVal.textContent = stats.tricks;
  HUD.gateVal.textContent = stats.gates+'/'+world.gates.length;
  HUD.crashVal.textContent = stats.crashes;
  const prog = clamp(p.pos.z/COURSE.finishZ,0,1);
  HUD.progFill.style.width = (prog*100).toFixed(1)+'%';
  HUD.progPct.textContent = Math.round(prog*100)+'%';
  HUD.progTxt.textContent = Math.max(0,ft(p.pos.z)).toLocaleString()+' / '+ft(COURSE.finishZ).toLocaleString()+' ft';
  HUD.mapZ.textContent = Math.max(0,ft(COURSE.finishZ - p.pos.z)).toLocaleString()+' ft left';
  HUD.warnTag.classList.toggle('on', Math.abs(p.pos.x) > COURSE.halfWidth);
  $('stanceTag').textContent = p.lean > 0.15 ? 'HEEL EDGE' : p.lean < -0.15 ? 'TOE EDGE' : 'FLAT BASE';
  drawStandings();
  drawMinimap();
}

function drawStandings(){
  const panel = $('racePanel');
  if(!racers.length){ panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const s = updateStandings();
  let me = 1;
  let html = '';
  for(const e of s){
    if(e.you) me = e.place;
    const gapM = e.z - player.pos.z;
    let gap;
    if(e.you) gap = '—';
    else if(e.finished) gap = fmtTime(e.time);
    else gap = (gapM>=0?'+':'−') + Math.abs(ft(gapM)).toLocaleString() + 'ft';
    html += '<div class="rrow'+(e.you?' you':'')+(e.finished?' done':'')+'">'
          + '<span class="pl">'+ORDINAL[e.place]+'</span>'
          + '<span class="pip" style="background:#'+e.color.toString(16).padStart(6,'0')+'"></span>'
          + '<span class="nm">'+e.name+(e.finished?'<span class="tick">&#10003;</span>':'')+'</span>'
          + '<span class="gp">'+gap+'</span></div>';
  }
  $('raceList').innerHTML = html;
  $('placeTag').textContent = ORDINAL[me]+' / '+s.length;
}

function fmtTime(t){
  const m = Math.floor(t/60), s = t-m*60;
  return m+':'+(s<10?'0':'')+s.toFixed(1);
}

function showTrick(name, pts, cls){
  const d = document.createElement('div');
  d.className = 'trick '+(cls||'');
  d.innerHTML = name + (pts? '<span>+'+pts+'</span>' : '');
  $('trickFeed').appendChild(d);
  setTimeout(()=>d.remove(), 1650);
}
function toast(msg){ showTrick(msg, 0, ''); }

/* ---------------- minimap ---------------- */
let mapCtx = null;
function drawMinimap(){
  if(!mapCtx) mapCtx = $('minimap').getContext('2d');
  const c = mapCtx, W = 164, H = 230;
  const p = player;
  const zBack = 70, zFwd = 430;
  const z0 = p.pos.z - zBack, z1 = p.pos.z + zFwd;
  const X = x => W/2 + (x/COURSE.meshHalf)*(W/2-6);
  const Y = z => H - ((z - z0)/(z1-z0))*H;
  c.clearRect(0,0,W,H);
  // piste band
  c.fillStyle = 'rgba(190,225,255,.10)';
  c.fillRect(X(-COURSE.halfWidth), 0, X(COURSE.halfWidth)-X(-COURSE.halfWidth), H);
  c.strokeStyle = 'rgba(255,154,60,.5)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(X(-COURSE.halfWidth),0); c.lineTo(X(-COURSE.halfWidth),H);
  c.moveTo(X(COURSE.halfWidth),0); c.lineTo(X(COURSE.halfWidth),H); c.stroke();

  // trees / rocks in range
  const b0 = bucketOf(z0), b1 = bucketOf(z1);
  for(let b=b0;b<=b1;b++){
    const list = world.props.get(b); if(!list) continue;
    for(let i=0;i<list.length;i++){
      const {o,type} = list[i];
      if(o.z<z0||o.z>z1) continue;
      c.fillStyle = type==='tree' ? 'rgba(70,170,110,.85)' : 'rgba(150,160,175,.85)';
      c.fillRect(X(o.x)-1, Y(o.z)-1, 2, 2);
    }
  }
  // kickers
  c.fillStyle = 'rgba(255,209,102,.9)';
  world.kickers.forEach(k=>{ if(k.z>z0&&k.z<z1) c.fillRect(X(k.x)-3, Y(k.z)-1.5, 6, 3); });
  // gates
  world.gates.forEach(g=>{
    if(g.z<z0||g.z>z1) return;
    c.strokeStyle = g.passed ? 'rgba(157,255,143,.9)' : 'rgba(127,227,255,.9)';
    c.lineWidth = 1.5; c.beginPath();
    c.moveTo(X(g.x-g.w), Y(g.z)); c.lineTo(X(g.x+g.w), Y(g.z)); c.stroke();
  });
  // finish
  if(COURSE.finishZ>z0 && COURSE.finishZ<z1){
    c.strokeStyle='#ff4d5e'; c.lineWidth=2; c.beginPath();
    c.moveTo(0,Y(COURSE.finishZ)); c.lineTo(W,Y(COURSE.finishZ)); c.stroke();
  }
  // rivals
  for(const r of racers){
    if(r.pos.z<z0||r.pos.z>z1) continue;
    const rx = X(r.pos.x), ry = Y(r.pos.z);
    c.save(); c.translate(rx,ry); c.rotate(-r.yaw);
    c.fillStyle = '#'+r.color.toString(16).padStart(6,'0');
    c.beginPath(); c.moveTo(0,-5); c.lineTo(3.6,4); c.lineTo(0,2); c.lineTo(-3.6,4); c.closePath(); c.fill();
    c.restore();
  }
  // player arrow
  const px = X(p.pos.x), py = Y(p.pos.z);
  c.save(); c.translate(px,py); c.rotate(-player.yaw);
  c.fillStyle = '#fff'; c.beginPath();
  c.moveTo(0,-6); c.lineTo(4.5,5); c.lineTo(0,2.5); c.lineTo(-4.5,5); c.closePath(); c.fill();
  c.restore();
}

/* ---------------- screens ---------------- */
function statCell(label, val){
  return '<div class="statCell"><div class="lbl">'+label+'</div><div class="v">'+val+'</div></div>';
}
/* The copyright notice. Opening it while a run is going pauses that run, so you
   are not still riding down the hill behind the dialog. */
let legalOpen = false;
function showLegal(on){
  legalOpen = on;
  $('legalScreen').classList.toggle('hidden', !on);
  if(on){
    if(game.mode === 'play') pause();
    if(document.pointerLockElement) document.exitPointerLock();
    clearInput();
    $('legalClose').focus();
  }
}

function syncSens(){
  const v = Math.round(settings.sens*100);
  const txt = settings.sens.toFixed(2)+'×';
  ['optSens','pauseSens'].forEach(id=>{ const el = $(id); if(el) el.value = v; });
  ['optSensVal','pauseSensVal'].forEach(id=>{ const el = $(id); if(el) el.textContent = txt; });
}

function pause(){
  game.mode='pause';
  syncSens();
  $('pauseScreen').classList.remove('hidden');
  $('hud').classList.remove('on');
  if(document.pointerLockElement) document.exitPointerLock();
  $('pauseStats').innerHTML =
    statCell('Distance', ft(player.pos.z).toLocaleString()+' ft') +
    statCell('Score', stats.score.toLocaleString()) +
    statCell('Top speed', mph(stats.top)+' mph');
}
function resume(){
  game.mode='play';
  $('pauseScreen').classList.add('hidden');
  $('hud').classList.toggle('on', game.hudVisible);
  last = performance.now();
}
/* Back to the start screen from anywhere — pause, results or mid-run. */
function returnToMenu(){
  game.mode = 'menu';
  $('pauseScreen').classList.add('hidden');
  $('endScreen').classList.add('hidden');
  $('startScreen').classList.remove('hidden');
  $('hud').classList.remove('on');
  if(document.pointerLockElement) document.exitPointerLock();
  clearInput();
  last = performance.now();
}
function showEndScreen(bonus){
  game.mode='end';
  const s = stats;
  const score = s.score;
  const racing = racers.length > 0;
  const field = racers.length + 1;
  const rank = racing
    ? (s.place===1 ? 'S' : s.place===2 ? 'A' : s.place===3 ? 'B' : s.place<field ? 'C' : 'D')
    : (score>26000?'S': score>18000?'A': score>11000?'B': score>6000?'C':'D');
  $('rankBadge').textContent = rank;
  $('endKicker').textContent = racing
    ? world.map.name + ' · ' + SKILLS[settings.skill].name + ' rivals'
    : world.map.name + ' · solo run';
  $('endTitle').textContent = racing
    ? (s.place===1 ? 'You took the win' : s.place===2 ? 'Second by a board length' :
       s.place===field ? 'Last one down' : ORDINAL[s.place] + ' place')
    : (rank==='S' ? 'Absolutely sending it' : rank==='A' ? 'That was a clean line' :
       rank==='B' ? 'Solid descent' : rank==='C' ? 'You made it down' : 'Rough ride');
  const tr = s.tricks + (s.tricks===1?' trick':' tricks') + ' landed';
  $('endMsg').textContent = (s.crashes===0
    ? 'No crashes the whole way down. ' + tr + ', ' + s.gates + ' of ' + world.gates.length + ' gates threaded.'
    : s.crashes + (s.crashes===1?' crash':' crashes') + ', ' + tr + ', ' + s.gates + ' of ' + world.gates.length + ' gates.');
  $('endStats').innerHTML =
    (racing ? statCell('Finish', ORDINAL[s.place]+' of '+field) : '') +
    statCell('Final score', score.toLocaleString()) +
    statCell('Time', fmtTime(s.finishTime)) +
    statCell('Time bonus', '+'+bonus.toLocaleString()) +
    (racing ? statCell('Race bonus', '+'+s.raceBonus.toLocaleString()) : '') +
    statCell('Top speed', mph(s.top)+' mph') +
    statCell('Total air', s.air.toFixed(1)+'s') +
    statCell('Vertical drop', ft(s.startY-player.pos.y).toLocaleString()+' ft');
  $('endScreen').classList.remove('hidden');
  $('hud').classList.remove('on');
  if(document.pointerLockElement) document.exitPointerLock();
}

function startGame(skipMenu){
  $('startScreen').classList.add('hidden');
  $('endScreen').classList.add('hidden');
  $('pauseScreen').classList.add('hidden');
  if(game.needRebuild){
    game.needRebuild = false;
    rebuildWorld(()=>{ launch(); });
    return;
  }
  launch();
}
function launch(){
  resetPlayer();
  game.mode='play';
  $('hud').classList.toggle('on', game.hudVisible);
  initAudio();
  if(audio.ctx && audio.ctx.state==='suspended') audio.ctx.resume();
  audio.on = settings.sound;
  last = performance.now();
}

/* ---------------- 11. boot + loop ---------------- */
let last = 0, acc = 0;
const FIXED = 1/120;

function rebuildWorld(done){
  $('loadScreen').classList.remove('hidden');
  $('loadFill').style.width = '0%';
  $('loadTxt').textContent = 'carving terrain…';
  clearTerrain();
  const map = MAPS[settings.map] || MAPS.timber;
  buildCourse(map.seed, map);
  applySky();
  buildProps();
  buildRacers();
  let i = 0;
  const total = chunkCount();
  function step(){
    const t0 = performance.now();
    while(i < total && performance.now()-t0 < 24){ buildChunk(i++); }
    $('loadFill').style.width = ((i/total)*100).toFixed(0)+'%';
    $('loadTxt').textContent = map.name+'  '+i+' / '+total;
    if(i < total) requestAnimationFrame(step);
    else {
      cacheHud();
      $('loadScreen').classList.add('hidden');
      done && done();
    }
  }
  requestAnimationFrame(step);
}

function boot(){
  initRenderer();
  rider = makeRider(0xe2582f, 0x7fe3ff, 0xf2f4f8);
  buildMapList();
  // settings wiring
  wireSeg('optCam', v=>{ settings.cam=v; $('camTag').textContent = v==='third'?'THIRD PERSON':'FIRST PERSON'; });
  wireSeg('optQual', v=>{ settings.qual=v; applyQuality(v); game.needRebuild=true; });
  wireSeg('optRivals', v=>{ settings.rivals = +v; buildRacers(); });
  wireSeg('optSkill', v=>{ settings.skill = v; buildRacers(); });
  wireSeg('optSnd', v=>{ settings.sound = (v==='on'); audio.on = settings.sound; });
  // steering sensitivity lives in two places, so keep both sliders in step
  const sens = [$('optSens'), $('pauseSens')];
  sens.forEach(el => el.addEventListener('input', e=>{
    settings.sens = e.target.value/100;
    syncSens();
  }));
  syncSens();
  $('startBtn').addEventListener('click', ()=> startGame(false));
  $('resumeBtn').addEventListener('click', resume);
  $('restartBtn2').addEventListener('click', ()=> startGame(true));
  $('againBtn').addEventListener('click', ()=> startGame(true));
  $('menuBtn').addEventListener('click', returnToMenu);
  $('pauseMenuBtn').addEventListener('click', returnToMenu);

  // copyright notice, opened from the footer
  $('siteFooter').addEventListener('click', ()=> showLegal(true));
  $('legalClose').addEventListener('click', ()=> showLegal(false));
  $('legalScreen').addEventListener('click', e=>{
    if(e.target === $('legalScreen')) showLegal(false);   // click the backdrop to dismiss
  });

  const map0 = MAPS[settings.map];
  buildCourse(map0.seed, map0);
  applySky();
  buildProps();
  buildRacers();
  resetPlayer();

  let i = 0;
  const total = chunkCount();
  (function step(){
    const t0 = performance.now();
    while(i < total && performance.now()-t0 < 22){ buildChunk(i++); }
    $('loadFill').style.width = ((i/total)*100).toFixed(0)+'%';
    $('loadTxt').textContent = map0.name+'  '+i+' / '+total;
    if(i < total){ requestAnimationFrame(step); return; }
    cacheHud();
    $('loadScreen').classList.add('hidden');
    $('startScreen').classList.remove('hidden');
    game.mode = 'menu';
    last = performance.now();
    requestAnimationFrame(frame);
  })();
}

function frame(now){
  requestAnimationFrame(frame);
  let dt = (now - last)/1000;
  last = now;
  if(dt > 0.1) dt = 0.1;

  if(game.mode==='play'){
    if(!stats.started && (input.fwd||input.left||input.right||player.vel.length()>3)) stats.started = true;
    if(stats.started && !stats.finished) stats.t += dt;
    acc += dt;
    let n = 0;
    while(acc >= FIXED && n < 8){ stepPhysics(FIXED); stepRacers(FIXED); acc -= FIXED; n++; }
    if(acc > 0.25) acc = 0;
    updateHud(dt);
  }
  // nothing steps once the finish screen is up — the mountain holds still
  // behind it rather than drifting on under the results

  poseRider(Math.max(dt,0.0001));
  updateCamera(Math.max(dt,0.0001));
  cullProps();
  updateLandingMarker();
  updateSpray(dt);
  updateSnowfall(dt);
  updateAudio(dt);
  renderer.render(scene, camera);
}

function updateSnowfall(dt){
  if(!snowfall || !snowfall.visible) return;
  const a = snowfall.geometry.attributes.position, arr = a.array;
  const drift = Math.sin(performance.now()*0.0003)*1.6;
  for(let i=0;i<arr.length;i+=3){
    arr[i+1] -= (3.0 + (i%5))*dt;
    arr[i]   += drift*dt;
    if(arr[i+1] < -26) seedFlake(arr, i/3, 46);
  }
  a.needsUpdate = true;
}

boot();

