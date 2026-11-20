// NEON KNOCKOUT · Nebula Arcade VR copy (v16, t399u). A port of Side Scroller Platform's VR fitness boxing game
// (OptimusGrok/neon-knockout 8c203ad, /workspace/vr-boxing/src/main.js) into the arcade's own three.js scene + XR session:
// the studio is built under `root` (placed far west of the arcade), the arcade's controllers are the gloves, ducking reads the
// headset height. Lazy loaded on the first beam to the studio. Arcade-only extras: difficulty (EASY / NORMAL / BEAST), a daily
// routine seeded by the date, tickets by grade, glove skins (nkgloves.js), a local high-score wall. The original is untouched and
// uses different localStorage keys (neonko.*); this copy uses gaNK.*.
import * as THREE from 'three';
import { gloveSkin, gloveState, ownsGlove, wearGlove, gloveIds } from '../nkgloves.js';
import { buildRooftop } from './rooftop.js?v=31';

export const NK_DIFF = {
  easy: { label: 'EASY', bpm: 110, travel: 2.5, duck: 8, mix: 0.6, mult: 0.6 },
  normal: { label: 'NORMAL', bpm: 124, travel: 2.2, duck: 4, mix: 1, mult: 1 },
  beast: { label: 'BEAST', bpm: 140, travel: 1.85, duck: 3, mix: 1.4, mult: 1.6 },
};
export const NK_ROUND = 150;
export const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export function daySeed(k) { let h = 2166136261; for (const c of String(k)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (Math.abs(h) % 2147483646) + 1; }
// tickets for a finished round: grade base + 1 per 4000 points, scaled by difficulty; the daily routine adds a once-a-day bonus
export const GRADE_TIX = { S: 12, A: 8, B: 5, C: 3, D: 1 };
export function ticketsFor(score, grade, diff) { const d = NK_DIFF[diff] || NK_DIFF.normal; return Math.max(1, Math.round(((GRADE_TIX[grade] || 1) + Math.floor(score / 4000)) * d.mult)); }
export const DAILY_BONUS = 15;

export function createNK(ENV) {   // ENV: the arcade hooks (main.js loadNK); not `env`, the audio code has its own env() envelope helper
const { root, renderer } = ENV;
const scene = root;   // everything below adds to the studio root (root.position = the studio's place in the arcade world)
let BPM = 124, BEAT = 60 / BPM, BAR = BEAT * 4, TRAVEL = 2.2;
const ROUND_LEN = NK_ROUND;
const SPAWN_DIST = 30;
const WIN = 0.36;                 // flat-mode hit window (s)
const POWER_TIME = 8;
const COL = { L: 0x18d8ff, R: 0xff2bd6, C: 0xfff1a8, BAR: 0xff3355, blue: 0x2a6bff, gold: 0xffc94a };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const STAND_Y = 1.5;
const FOGC = new THREE.Color(0x070414);
const camera = ENV.camera;
// glass floor (world coords made studio-local with uO)
const floorMat = new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uBeat: { value: 0 }, uFog: { value: FOGC }, uPow: { value: 0 }, uO: { value: root.position } },
  vertexShader: 'uniform vec3 uO;varying vec3 vW;varying vec3 vC;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz-uO;vC=cameraPosition-uO;gl_Position=projectionMatrix*viewMatrix*w;}',
  fragmentShader: `uniform float uT;uniform float uBeat;uniform vec3 uFog;uniform float uPow;varying vec3 vW;varying vec3 vC;
  void main(){vec2 g=abs(fract(vW.xz*0.5)-0.5);float ln=smoothstep(0.035,0.0,min(g.x,g.y));
  float d=length(vW.xz-vec2(0.,-1.5));
  vec3 col=vec3(0.006,0.01,0.03);
  col+=ln*vec3(0.05,0.55,1.0)*0.5*exp(-d*0.07);
  float lane=smoothstep(0.06,0.0,abs(abs(vW.x)-0.95));
  float flow=0.5+0.5*sin(vW.z*1.4+uT*9.);
  col+=lane*mix(vec3(0.1,0.85,1.0),vec3(1.0,0.2,0.85),step(0.,vW.x))*(0.55+0.45*flow)*exp(-max(0.,-vW.z)*0.04);
  vec3 hot=mix(vec3(0.55,0.05,0.85),vec3(1.0,0.75,0.2),uPow);
  col+=hot*0.16*exp(-d*0.45)*(0.6+0.6*uBeat);
  float fogF=1.-exp(-pow(length(vW-vC)*0.028,2.));
  gl_FragColor=vec4(mix(col,uFog,fogF),mix(0.74-ln*0.25,1.,fogF));}`,
  transparent: true, depthWrite: false,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 80), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.z = -25; floor.position.y = 0.002; floor.renderOrder = -1; floor.name = 'nkFloor'; scene.add(floor);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function radialTex(inner = 'rgba(255,255,255,1)', size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const glowTex = radialTex();
function glowSprite(color, s, op = 1) {
  const m = new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: op, fog: true });
  const sp = new THREE.Sprite(m); sp.scale.set(s, s, 1); return sp;
}
function fresnelMat(color, intensity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(color) }, uI: { value: intensity } },
    vertexShader: 'varying vec3 vN;varying vec3 vV;void main(){vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform vec3 uC;uniform float uI;varying vec3 vN;varying vec3 vV;void main(){float f=1.-abs(dot(normalize(vN),normalize(vV)));float a=0.10+pow(f,2.4)*1.35;gl_FragColor=vec4(uC*a*uI,1.);}',
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
}

// ---------- studio environment ----------
const reflect = new THREE.Group(); reflect.scale.y = -1; scene.add(reflect);
const ENV_DEF = []; let envBucket = null;   // vrtest-v20: the studio's own surroundings (hidden + GPU-freed while the rooftop scenery is on)
const neonMats = {};
function neonMat(color, k = 1) { const key = color + ':' + k; return neonMats[key] || (neonMats[key] = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), fog: true })); }
const reflMats = {};
function reflMat(color) { return reflMats[color] || (reflMats[color] = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), fog: true, side: THREE.DoubleSide })); }
const pulsers = [];   // neon pieces that pulse to the beat
function neon(geo, color, x, y, z, rx = 0, ry = 0, rz = 0, k = 1.6, mirror = true) {
  const m = new THREE.Mesh(geo, neonMat(color, k)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); scene.add(m); if (envBucket) envBucket.push(m);
  if (mirror) { const r = new THREE.Mesh(geo, reflMat(color)); r.position.copy(m.position); r.rotation.copy(m.rotation); r.renderOrder = -2; reflect.add(r); if (envBucket) envBucket.push(r); }
  return m;
}
// tunnel of neon portal frames the targets fly through
const portals = [];
for (let i = 0; i < 6; i++) {
  const z = -5 - i * 5.2, w = 6.4, h = 4.6, c = i % 2 ? COL.R : COL.L, t = 0.045;
  const g = new THREE.Group();
  const hb = new THREE.BoxGeometry(w, t, t), vb = new THREE.BoxGeometry(t, h, t);
  [[0, h, 0, hb], [-w / 2, h / 2, 0, vb], [w / 2, h / 2, 0, vb]].forEach(([x, y, zz, geo]) => g.add(neon(geo, c, x, y, z, 0, 0, 0, 1.8)));
  // inner chevrons
  const ch = new THREE.BoxGeometry(0.9, 0.03, 0.03);
  [-1, 1].forEach(s => { const m = neon(ch, COL.blue, s * (w / 2 - 0.55), h - 0.35, z, 0, 0, s * 0.5, 2.2); });
  portals.push({ z, c, mats: [neonMat(c, 1.8)] });
}
// side columns + ceiling strips
envBucket = ENV_DEF;
for (let i = 0; i < 9; i++) {
  const z = 1.5 - i * 4;
  [-1, 1].forEach(s => neon(new THREE.BoxGeometry(0.06, 5.5, 0.06), i % 3 === 1 ? 0xffffff : s < 0 ? COL.L : COL.R, s * 4.6, 2.75, z, 0, 0, 0, 1.4));
}
[-1, 1].forEach(s => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 40), neonMat(s < 0 ? COL.L : COL.R, 1.5)); m.position.set(s * 2.2, 6.2, -16); scene.add(m); ENV_DEF.push(m); });
envBucket = null;
// vrtest-v23 (Dave t510u / t511u): the boxing ring (white posts, ropes, the 1.25 m mat edge) is gone in both sceneries
// back wall hologram sign
function signTex() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d');
  g.font = '900 150px system-ui,Arial Black,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const gr = g.createLinearGradient(0, 0, 1024, 0); gr.addColorStop(0, '#18d8ff'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#ff2bd6');
  const tw = g.measureText('NEON KNOCKOUT').width; if (tw > 960) g.font = '900 ' + Math.floor(150 * 960 / tw) + 'px system-ui,Arial Black,sans-serif';
  g.shadowColor = '#3a7bff'; g.shadowBlur = 40; g.fillStyle = gr; g.fillText('NEON KNOCKOUT', 512, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: signTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.85 }));
sign.position.set(0, 7.2, -38); scene.add(sign); ENV_DEF.push(sign);
const backGlow = glowSprite(0x3a2bff, 30, 0.55); backGlow.position.set(0, 3, -40); backGlow.material.fog = false; scene.add(backGlow); ENV_DEF.push(backGlow);
// volumetric light cones
const coneMat = (c) => new THREE.ShaderMaterial({
  uniforms: { uC: { value: new THREE.Color(c) }, uI: { value: 0.32 } },
  vertexShader: 'varying float vY;varying vec3 vN;varying vec3 vV;void main(){vY=uv.y;vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
  fragmentShader: 'uniform vec3 uC;uniform float uI;varying float vY;varying vec3 vN;varying vec3 vV;void main(){float e=pow(abs(dot(normalize(vN),normalize(vV))),1.6);gl_FragColor=vec4(uC*uI*e*pow(vY,1.3),1.);}',
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
});
const cones = [];
[[-2.2, -3, COL.L], [2.2, -3, COL.R], [0, -9, COL.blue], [-3, -14, COL.R], [3, -14, COL.L], [0, 0.5, 0x8fb4ff]].forEach(([x, z, c], i) => {
  const geo = new THREE.ConeGeometry(1.5, 6.4, 28, 1, true); geo.translate(0, -3.2, 0);
  const m = new THREE.Mesh(geo, coneMat(c)); m.position.set(x, 6.4, z); scene.add(m);
  const lamp = glowSprite(c, 0.9); lamp.position.set(x, 6.35, z); scene.add(lamp); ENV_DEF.push(m, lamp);
  cones.push({ m, ph: i * 1.7, base: x });
});
// floating haze dust
const dustN = 260, dustGeo = new THREE.BufferGeometry(), dustPos = new Float32Array(dustN * 3);
for (let i = 0; i < dustN; i++) { dustPos[i * 3] = rand(-5, 5); dustPos[i * 3 + 1] = rand(0.2, 6); dustPos[i * 3 + 2] = rand(-30, 3); }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.05, map: glowTex, color: 0x88aaff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(dust); ENV_DEF.push(dust, floor);
// ---------- particles / shards / rings / popups ----------
const PN = 1400;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pSize = new Float32Array(PN);
const pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
const pMat = new THREE.ShaderMaterial({
  uniforms: { uPR: { value: renderer.getPixelRatio() } },
  vertexShader: 'attribute float size;attribute vec3 color;varying vec3 vC;uniform float uPR;void main(){vC=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(size*uPR*(320./max(0.2,-mv.z)),48.*uPR);gl_Position=projectionMatrix*mv;}',
  fragmentShader: 'varying vec3 vC;void main(){vec2 p=gl_PointCoord-.5;float d=length(p);float a=smoothstep(.5,0.,d);gl_FragColor=vec4(vC*a*a*1.6,1.);}',
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
});
const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
let pHead = 0;
function emit(pos, color, n, speed, size = 0.045, life = 0.8) {
  const c = new THREE.Color(color);
  for (let k = 0; k < n; k++) {
    const i = pHead; pHead = (pHead + 1) % PN;
    pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
    const u = rand(-1, 1), th = rand(0, Math.PI * 2), r = Math.sqrt(1 - u * u), s = speed * rand(0.3, 1);
    pVel[i * 3] = r * Math.cos(th) * s; pVel[i * 3 + 1] = u * s + speed * 0.2; pVel[i * 3 + 2] = Math.min(r * Math.sin(th) * s, speed * 0.15);
    const w = Math.random() < 0.25 ? 1 : 0; // some white-hot sparks
    pCol[i * 3] = w ? 1 : c.r; pCol[i * 3 + 1] = w ? 1 : c.g; pCol[i * 3 + 2] = w ? 1 : c.b;
    pMax[i] = pLife[i] = life * rand(0.5, 1.1); pSize[i] = size * rand(0.5, 1.4);
  }
}
function updParticles(dt) {
  for (let i = 0; i < PN; i++) {
    if (pLife[i] <= 0) { if (pSize[i] !== 0) pSize[i] = 0; continue; }
    pLife[i] -= dt; const k = Math.max(0, pLife[i] / pMax[i]);
    pVel[i * 3] *= 0.965; pVel[i * 3 + 1] = pVel[i * 3 + 1] * 0.965 - 2.2 * dt; pVel[i * 3 + 2] *= 0.965;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    if (pLife[i] <= 0) pSize[i] = 0; else pSize[i] *= 0.99 + 0.01 * k;
  }
  pGeo.attributes.position.needsUpdate = pGeo.attributes.size.needsUpdate = pGeo.attributes.color.needsUpdate = true;
}
// crystal shards (instanced)
const SN = 320;
const shardMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.035), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), SN);
shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shardMesh.frustumCulled = false; scene.add(shardMesh);
const shards = Array.from({ length: SN }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0, max: 1, s: 1 }));
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _sv = new THREE.Vector3(), _c = new THREE.Color();
for (let i = 0; i < SN; i++) { _m4.makeScale(0, 0, 0); shardMesh.setMatrixAt(i, _m4); shardMesh.setColorAt(i, _c.set(0xffffff)); }
let sHead = 0;
function shatter(pos, color, n, speed, scale = 1) {
  const c = new THREE.Color(color);
  for (let k = 0; k < n; k++) {
    const s = shards[sHead]; const i = sHead; sHead = (sHead + 1) % SN;
    s.p.copy(pos); s.v.set(rand(-1, 1), rand(-0.6, 1.2), rand(-1, 0.12)).normalize().multiplyScalar(speed * rand(0.4, 1));
    s.r.set(rand(0, 6), rand(0, 6), rand(0, 6)); s.w.set(rand(-14, 14), rand(-14, 14), rand(-14, 14));
    s.max = s.life = rand(0.55, 1.0); s.s = scale * rand(0.6, 1.6);
    shardMesh.setColorAt(i, _c.copy(c).lerp(new THREE.Color(0xffffff), Math.random() * 0.5));
  }
  shardMesh.instanceColor.needsUpdate = true;
}
function updShards(dt) {
  for (let i = 0; i < SN; i++) {
    const s = shards[i]; if (s.life <= 0) continue;
    s.life -= dt; s.v.y -= 3.2 * dt; s.v.multiplyScalar(0.975); s.p.addScaledVector(s.v, dt);
    s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; s.r.z += s.w.z * dt;
    const k = Math.max(0, s.life / s.max) * s.s;
    _q.setFromEuler(s.r); _m4.compose(s.p, _q, _sv.set(k, k * 1.8, k)); shardMesh.setMatrixAt(i, _m4);
  }
  shardMesh.instanceMatrix.needsUpdate = true;
}
const rings = Array.from({ length: 10 }, () => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.visible = false; scene.add(m); return { m, life: 0 };
});
let rHead = 0;
function ringFx(pos, color, big = 1) { const r = rings[rHead]; rHead = (rHead + 1) % rings.length; r.m.position.copy(pos); r.m.material.color.set(color); r.life = 1; r.big = big; r.m.visible = true; }
const flashes = Array.from({ length: 8 }, () => { const s = glowSprite(0xffffff, 0.1); s.visible = false; scene.add(s); return { s, life: 0 }; });
let fHead = 0;
function flashFx(pos, color, size) { const f = flashes[fHead]; fHead = (fHead + 1) % flashes.length; f.s.position.copy(pos); f.s.material.color.set(color); f.size = size; f.life = 1; f.s.visible = true; }
// text popups
const labelTex = {};
function labelTexture(txt, color) {
  const key = txt + color; if (labelTex[key]) return labelTex[key];
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  g.font = 'italic 900 78px system-ui,Arial Black,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  { const tw = g.measureText(txt).width; if (tw > 470) g.font = 'italic 900 ' + Math.floor(78 * 470 / tw) + 'px system-ui,Arial Black,sans-serif'; }   // vrtest-v23: long labels (SCENERY: ROOFTOP) were clipped by the 512 px canvas
  g.shadowColor = color; g.shadowBlur = 24; g.lineWidth = 6; g.strokeStyle = color; g.strokeText(txt, 256, 66); g.fillStyle = '#fff'; g.fillText(txt, 256, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (labelTex[key] = t);
}
const pops = Array.from({ length: 10 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false })); s.visible = false; s.renderOrder = 10; scene.add(s); return { s, life: 0 }; });
let popHead = 0;
function popup(txt, color, pos, scale = 1) {
  const p = pops[popHead]; popHead = (popHead + 1) % pops.length;
  p.s.material.map = labelTexture(txt, color); p.s.material.needsUpdate = true; p.s.position.copy(pos); p.base = scale; p.life = 1; p.s.visible = true;
}
function updFx(dt) {
  rings.forEach(r => { if (r.life <= 0) return; r.life -= dt * 2.4; const k = 1 - r.life; const s = (0.6 + k * 3.2) * r.big; r.m.scale.set(s, s, s); r.m.material.opacity = Math.max(0, r.life); r.m.lookAt(camWorld); if (r.life <= 0) r.m.visible = false; });
  flashes.forEach(f => { if (f.life <= 0) return; f.life -= dt * 4; const s = f.size * (1.2 - f.life * 0.4); f.s.scale.set(s, s, 1); f.s.material.opacity = Math.max(0, f.life); if (f.life <= 0) f.s.visible = false; });
  pops.forEach(p => { if (p.life <= 0) return; p.life -= dt * 1.4; p.s.position.y += dt * 0.35; const k = p.life > 0.85 ? 1 + (p.life - 0.85) * 3 : 1; const s = p.base * k * (state.vr ? 0.1 : 0.13); p.s.scale.set(s * 4, s, 1); p.s.material.opacity = clamp(p.life * 2, 0, 1); if (p.life <= 0) p.s.visible = false; });
}

// ---------- gloves (skin from nkgloves.js; unlit materials + a fresnel rim, the arcade has no lights out here) ----------
let skin = gloveSkin();
function makeGlove(side) {
  const g = new THREE.Group(); g.name = 'nkGlove' + side;
  const white = new THREE.MeshBasicMaterial({ color: skin.body, fog: false });
  const blue = new THREE.MeshBasicMaterial({ color: skin.band, fog: false });
  const rimM = fresnelMat(skin.rim, 1.1);
  const main = new THREE.Mesh(new THREE.SphereGeometry(0.07, 22, 16), white); main.scale.set(1, 0.92, 1.28); main.position.z = -0.025; g.add(main);
  const rim = new THREE.Mesh(main.geometry, rimM); rim.scale.copy(main.scale).multiplyScalar(1.04); rim.position.copy(main.position); g.add(rim);
  const knuckle = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.011, 8, 28, Math.PI), blue); knuckle.rotation.set(0, Math.PI / 2, 0); knuckle.position.z = -0.03; knuckle.scale.set(1, 0.95, 1.3); g.add(knuckle);
  const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), white); thumb.scale.set(1, 1, 1.6); thumb.position.set(side === 'L' ? 0.058 : -0.058, -0.012, -0.03); g.add(thumb);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.054, 0.095, 18), white); cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.075; g.add(cuff);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.054, 0.009, 8, 28), blue); band.position.z = 0.06; g.add(band);
  const band2 = band.clone(); band2.position.z = 0.1; g.add(band2);
  const halo = glowSprite(skin.glow, 0.34, 0.55); halo.position.z = -0.03; g.add(halo);
  g.userData = { white, blue, rimM, halo, side }; g.visible = false; scene.add(g);
  return g;
}
const gloves = { L: makeGlove('L'), R: makeGlove('R') };
function applySkin(id) { skin = gloveSkin(id); for (const s of ['L', 'R']) { const u = gloves[s].userData; u.white.color.set(skin.body); u.blue.color.set(skin.band); u.rimM.uniforms.uC.value.set(skin.rim); u.halo.material.color.set(skin.glow); }
  trails.L.color.set(skin.trail[0]); trails.R.color.set(skin.trail[1]); state.skin = id || 'classic'; drawMenu(); }
const glove = {
  L: { obj: gloves.L, punch: null, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), speed: 0, trail: [], src: null, cool: 0, on: false },
  R: { obj: gloves.R, punch: null, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), speed: 0, trail: [], src: null, cool: 0, on: false },
};
const TRN = 18;
function makeTrail(color) {
  const geo = new THREE.BufferGeometry(); const pos = new Float32Array(TRN * 2 * 3), col = new Float32Array(TRN * 2 * 3); const idx = [];
  for (let i = 0; i < TRN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.frustumCulled = false; scene.add(m); return { m, pos, col, color: new THREE.Color(color), pts: [] };
}
const trails = { L: makeTrail(0x5fd8ff), R: makeTrail(0x8a8bff) };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), camWorld = new THREE.Vector3();
function updTrail(s, dt) {
  const T = trails[s], g = glove[s];
  T.pts.unshift(g.pos.clone()); if (T.pts.length > TRN) T.pts.length = TRN;
  const inten = clamp((g.speed - 0.6) / 3, 0, 1);
  T.level = Math.max(inten, (T.level || 0) - dt * 3);
  const c = state.power > 0 ? _c.set(COL.gold) : T.color;
  for (let i = 0; i < TRN; i++) {
    const p = T.pts[Math.min(i, T.pts.length - 1)], w = 0.028 * (1 - i / TRN), a = 0.8 * T.level * Math.pow(1 - i / TRN, 2);
    T.pos.set([p.x, p.y + w, p.z, p.x, p.y - w, p.z], i * 6);
    T.col.set([c.r * a, c.g * a, c.b * a, c.r * a, c.g * a, c.b * a], i * 6);
  }
  T.m.geometry.attributes.position.needsUpdate = T.m.geometry.attributes.color.needsUpdate = true;
}

// ---------- targets ----------
const orbGeo = new THREE.SphereGeometry(1, 28, 20), coreGeo = new THREE.SphereGeometry(1, 14, 10), crystGeo = new THREE.OctahedronGeometry(1, 0), ringGeo = new THREE.TorusGeometry(1, 0.06, 6, 40);
function makeTargetMesh() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(orbGeo, fresnelMat(0xffffff, 1)); g.add(shell);
  const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); core.scale.setScalar(0.32); g.add(core);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); ring.scale.setScalar(1.25); g.add(ring);
  const cryst = new THREE.Mesh(crystGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd27a, emissiveIntensity: 0.9, flatShading: true, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.88 })); cryst.scale.set(0.8, 1.35, 0.8); g.add(cryst);
  const crystShell = new THREE.Mesh(crystGeo, fresnelMat(0x9fe8ff, 1.2)); crystShell.scale.set(0.95, 1.55, 0.95); g.add(crystShell);
  const halo = glowSprite(0xffffff, 3.6, 0.6); g.add(halo);
  const refl = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); refl.renderOrder = -2; reflect.add(refl);
  g.visible = false; refl.visible = false; scene.add(g);
  return { g, shell, core, ring, cryst, crystShell, halo, refl };
}
const BARS = Array.from({ length: 4 }, () => {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.BAR).multiplyScalar(1.8) })); bar.rotation.z = Math.PI / 2; g.add(bar);
  const sheath = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.4, 16, 1, true), fresnelMat(COL.BAR, 1.3)); sheath.rotation.z = Math.PI / 2; g.add(sheath);
  [-1.7, 1.7].forEach(x => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.BAR).multiplyScalar(1.2) })); p.position.set(x, 0, 0); p.name = 'post'; g.add(p); });
  const warn = glowSprite(COL.BAR, 1.6, 0.5); g.add(warn);
  g.visible = false; scene.add(g); return { g, used: false };
});
const pool = Array.from({ length: 28 }, makeTargetMesh);
let targets = [];   // active
function styleTarget(t) {
  const m = t.m, isC = t.type === 'C', isS = t.type === 'S';
  const color = isC ? COL.C : isS ? 0x7fffd4 : COL[t.type];
  m.shell.visible = m.core.visible = m.ring.visible = !isC; m.cryst.visible = m.crystShell.visible = isC;
  m.shell.material.uniforms.uC.value.set(color); m.ring.material.color.set(color); m.halo.material.color.set(color); m.refl.material.color.set(color);
  m.core.material.color.set(color).lerp(new THREE.Color(0xffffff), 0.55);
  const r = isS ? 0.2 : isC ? 0.12 : 0.13; t.r = r; m.g.scale.setScalar(r);
  m.g.visible = m.refl.visible = true; m.g.rotation.set(0, 0, 0);
}
function spawnTarget(ev) {
  if (ev.type === 'BAR') { const b = BARS.find(b => !b.used); if (!b) return; b.used = true; b.g.visible = true; targets.push({ ev, type: 'BAR', bar: b, t: ev.t, alive: true }); return; }
  const m = pool.find(p => !p.g.visible); if (!m) return;
  const t = { ev, type: ev.type, m, t: ev.t, x: ev.x, y: ev.y, alive: true, claimed: false, dying: 0, pos: new THREE.Vector3() };
  styleTarget(t); targets.push(t);
}
function freeTarget(t) {
  if (t.type === 'BAR') { t.bar.used = false; t.bar.g.visible = false; } else { t.m.g.visible = false; t.m.refl.visible = false; }
}

// ---------- game state ----------
const state = {
  mode: 'title', vr: false, t: 0, score: 0, streak: 0, maxStreak: 0, hits: 0, misses: 0, perfect: 0, dodges: 0, bumps: 0, punches: 0,
  kcal: 0, power: 0, powerT: 0, events: [], evIdx: 0, lastT: 0, duckT: 0, duckY: 0, headH: STAND_Y, center: new THREE.Vector3(0, 0, 0),
  autoplay: false, paused: false, beatPulse: 0, shake: 0, hurt: 0, clock: 0,
  diff: ['easy', 'normal', 'beast'].includes(lsGet('gaNK.diff', 'normal')) ? lsGet('gaNK.diff', 'normal') : 'normal', daily: false, skin: 'classic', result: null, rounds: 0, payouts: [],
};
function hitZ() { return state.center.z - (state.vr ? 0.5 : 0.75); }
let seed = 1; const srnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// the original's pattern book; difficulty sets tempo (BPM), travel time, how often a DUCK bar comes (every `duck` bars) and how
// busy the bar picks are; the daily routine is the NORMAL set with a seed from the date (everyone gets the same routine that day)
function buildSchedule(len, diff, sd) {
  const D = NK_DIFF[diff] || NK_DIFF.normal; seed = sd;
  const ev = []; const bars = Math.floor(len / BAR);
  const P = {
    alt: [['L', 0], ['R', 1], ['L', 2], ['R', 3]],
    easy: [['L', 0], ['R', 2]],
    oneTwo: [['L', 0], ['R', 0.5], ['L', 2], ['R', 2.5]],
    dbl: [['L', 0], ['L', 1], ['R', 2], ['R', 3]],
    crys: [['L', 0], ['R', 1], ['C', 2.5]],
    duck: [['L', 0], ['BAR', 2], ['R', 3.5]],
    duck2: [['BAR', 0], ['R', 1.5], ['L', 2], ['R', 2.5]],
    duck3: [['BAR', 0], ['L', 1], ['BAR', 2], ['R', 3]],
    flurry: [['L', 0], ['R', 0.5], ['L', 1], ['R', 1.5], ['C', 2.5], ['C', 3.5]],
    both: [['L', 0], ['R', 0], ['L', 2], ['R', 2]],
    hook: [['R', 0], ['L', 1], ['R', 1.5], ['L', 2.5], ['C', 3.5]],
  };
  for (let b = 2; b < bars; b++) {
    const d = Math.min(1, (b / bars) * D.mix); let p;
    if (b % D.duck === D.duck - 1) p = diff === 'beast' && srnd() < 0.35 ? P.duck3 : srnd() < 0.5 ? P.duck : P.duck2;
    else if (b % 8 === 6) p = d > 0.35 ? P.flurry : P.crys;
    else if (b < 6 || diff === 'easy' && d < 0.5) p = srnd() < 0.5 ? P.easy : P.alt;
    else { const pick = d < 0.3 ? [P.alt, P.easy, P.dbl, P.crys] : d < 0.65 ? [P.alt, P.oneTwo, P.dbl, P.crys, P.hook] : [P.oneTwo, P.hook, P.both, P.flurry, P.alt]; p = pick[Math.floor(srnd() * pick.length)]; }
    p.forEach(([type, beat]) => {
      const t = b * BAR + beat * BEAT;
      const hi = srnd() < 0.5; const wide = srnd() < 0.35;
      const x = type === 'L' ? -(wide ? 0.3 : 0.19) : type === 'R' ? (wide ? 0.3 : 0.19) : (srnd() - 0.5) * 0.2;
      ev.push({ type, t, x, y: hi ? -0.06 : -0.24 + (type === 'C' ? 0.1 : 0) });
    });
  }
  ev.sort((a, b) => a.t - b.t); return ev;
}
function setTempo(diff) { const D = NK_DIFF[diff] || NK_DIFF.normal; BPM = D.bpm; BEAT = 60 / BPM; BAR = BEAT * 4; TRAVEL = D.travel; }
// ---------- audio ----------
let actx = null, master = null, musicBus = null, noiseBuf = null, lastSched = -1;
function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = window.__unlockAC || new (window.AudioContext || window.webkitAudioContext)(); window.__unlockAC = actx;
    master = actx.createGain(); master.gain.value = mutedNow() ? 0 : 0.8;
    const comp = actx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(actx.destination);
    musicBus = actx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { actx = null; }
}
function env(g, t, a, peak, dcy) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy); }
function osc(type, f, t, dur, peak, dest, f2) {
  const o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  env(g, t, 0.005, peak, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, peak, dest, hp = 6000, bp) {
  const s = actx.createBufferSource(); s.buffer = noiseBuf; const f = actx.createBiquadFilter(); f.type = bp ? 'bandpass' : 'highpass'; f.frequency.value = bp || hp;
  const g = actx.createGain(); env(g, t, 0.002, peak, dur); s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const BASS = [33, 29, 36, 31];
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function schedMusic(songT, horizon) {
  if (!actx || state.mode !== 'play') return;
  const now = actx.currentTime;
  const s0 = Math.max(lastSched + 1, Math.ceil(songT / (BEAT / 4)));
  const s1 = Math.floor((songT + horizon) / (BEAT / 4));
  for (let s = s0; s <= s1; s++) {
    lastSched = s; const st = s * BEAT / 4; if (st > ROUND_LEN + BAR) return;
    const t = now + (st - songT); if (t < now) continue;
    const step = s % 16, bar = Math.floor(s / 16), ch = bar % 4, intro = bar < 2, outro = st > ROUND_LEN - BAR, pw = state.power > 0;
    if (step % 4 === 0) { osc('sine', 150, t, 0.32, 0.9, musicBus, 42); }
    if (!intro && (step === 4 || step === 12)) { noise(t, 0.18, 0.35, musicBus, 0, 1800); osc('triangle', 210, t, 0.08, 0.2, musicBus, 120); }
    if (!intro && step % 4 === 2) noise(t, 0.05, 0.22, musicBus, 7000);
    if (!intro && step % 2 === 1 && Math.random() < 0.5) noise(t, 0.025, 0.08, musicBus, 9000);
    if (!intro && step % 4 === 2) { const f = mtof(BASS[ch]); osc('sawtooth', f, t, BEAT * 0.45, 0.18, musicBus); osc('square', f / 2, t, BEAT * 0.4, 0.1, musicBus); }
    if (step === 0) CHORDS[ch].forEach(n => { const o = actx.createOscillator(), g = actx.createGain(), f = actx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = rand(-9, 9); f.type = 'lowpass'; f.frequency.value = pw ? 2600 : 1100; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045, t + 0.25); g.gain.linearRampToValueAtTime(0.0001, t + BAR * 0.98); o.connect(f); f.connect(g); g.connect(musicBus); o.start(t); o.stop(t + BAR); });
    if ((pw || bar >= 16) && !outro && step % 2 === 0) { const n = CHORDS[ch][(step / 2) % 3] + 12 + (step % 8 === 6 ? 12 : 0); osc(pw ? 'square' : 'triangle', mtof(n), t, 0.12, pw ? 0.07 : 0.05, musicBus); }
  }
}
const sfx = {
  hit(q, pw) { if (!actx) return; const t = actx.currentTime; osc('sine', 120, t, 0.16, 0.8, master, 50); noise(t, 0.09, 0.5, master, 0, 2500); osc('triangle', q > 1.3 ? 1320 : 990, t + 0.01, 0.12, 0.18, master, q > 1.3 ? 1760 : 1100); if (pw) osc('sawtooth', 660, t, 0.2, 0.12, master, 1320); },
  crystal() { if (!actx) return; const t = actx.currentTime; noise(t, 0.25, 0.4, master, 5000); [1568, 2093, 2637].forEach((f, i) => osc('sine', f, t + i * 0.04, 0.35, 0.15, master)); osc('sine', 110, t, 0.2, 0.6, master, 45); },
  miss() { if (!actx) return; const t = actx.currentTime; osc('sawtooth', 110, t, 0.18, 0.12, master, 70); },
  whiff() { if (!actx) return; noise(actx.currentTime, 0.08, 0.12, master, 0, 900); },
  dodge() { if (!actx) return; const t = actx.currentTime; noise(t, 0.3, 0.25, master, 0, 600); osc('sine', 300, t, 0.25, 0.12, master, 700); },
  bump() { if (!actx) return; const t = actx.currentTime; osc('square', 90, t, 0.3, 0.25, master, 40); noise(t, 0.2, 0.3, master, 0, 300); },
  power() { if (!actx) return; const t = actx.currentTime; osc('sawtooth', 200, t, 0.8, 0.2, master, 1600); osc('square', 400, t + 0.05, 0.7, 0.08, master, 3200); },
  count(hi) { if (!actx) return; osc('square', hi ? 1320 : 880, actx.currentTime, 0.12, 0.12, master); },
};
function makePanel(w, h, cw, ch) {
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  m.renderOrder = 5; scene.add(m); return { m, c, g: c.getContext('2d'), tex };
}
const panelL = makePanel(0.9, 0.56, 512, 320), panelR = makePanel(0.9, 0.56, 512, 320), panelC = makePanel(1.6, 1.0, 640, 400);
function holoFrame(g, w, h, col) {
  g.clearRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(10,60,120,0.55)'); gr.addColorStop(1, 'rgba(40,10,90,0.35)');
  g.fillStyle = gr; g.beginPath(); g.roundRect(8, 8, w - 16, h - 16, 22); g.fill();
  g.strokeStyle = col; g.lineWidth = 4; g.shadowColor = col; g.shadowBlur = 16; g.stroke(); g.shadowBlur = 0;
  g.fillStyle = 'rgba(160,220,255,0.06)'; for (let y = 12; y < h - 12; y += 6) g.fillRect(14, y, w - 28, 2);
  g.fillStyle = col; g.fillRect(30, 8, 80, 5); g.fillRect(w - 110, h - 13, 80, 5);
}
function txt(g, s, x, y, size, col, align = 'left', weight = 800) { g.font = `${weight} ${size}px system-ui,Arial,sans-serif`; g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 10; g.fillText(s, x, y); g.shadowBlur = 0; }
const mult = () => Math.min(4, 1 + Math.floor(state.streak / 8)) * (state.power > 0 ? 2 : 1);
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function drawPanels() {
  let g = panelL.g; holoFrame(g, 512, 320, '#18d8ff');
  txt(g, 'SCORE', 40, 52, 30, '#7fe9ff'); txt(g, fmtTime(ROUND_LEN - state.t), 472, 52, 34, '#ffffff', 'right');
  txt(g, state.score.toLocaleString(), 40, 135, 92, '#ffffff', 'left', 900);
  txt(g, 'STREAK', 40, 220, 30, '#7fe9ff'); txt(g, String(state.streak), 40, 268, 56, '#ffffff', 'left', 900);
  txt(g, 'x' + mult(), 472, 252, 84, state.power > 0 ? '#ffd56a' : '#ff6be6', 'right', 900);
  panelL.tex.needsUpdate = true;
  g = panelR.g; holoFrame(g, 512, 320, '#ff2bd6');
  txt(g, 'CALORIES', 40, 52, 30, '#ff9cf0'); txt(g, state.kcal.toFixed(1) + ' kcal', 40, 120, 64, '#ffffff', 'left', 900);
  txt(g, state.power > 0 ? 'POWER MODE!' : 'POWER', 40, 200, 30, state.power > 0 ? '#ffd56a' : '#ff9cf0');
  const pw = state.power > 0 ? state.powerT / POWER_TIME : state.powerMeter || 0;
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(40, 232, 432, 44);
  const gr = g.createLinearGradient(40, 0, 472, 0); gr.addColorStop(0, '#18d8ff'); gr.addColorStop(0.6, '#ff2bd6'); gr.addColorStop(1, '#ffd56a');
  g.fillStyle = gr; g.shadowColor = '#ff2bd6'; g.shadowBlur = 18; g.fillRect(40, 232, 432 * pw, 44); g.shadowBlur = 0;
  for (let i = 1; i < 10; i++) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(40 + i * 43.2, 232, 3, 44); }
  panelR.tex.needsUpdate = true;
}
function drawCenterPanel(lines) {
  const g = panelC.g; holoFrame(g, 640, 400, '#7f9bff');
  lines.forEach(([s, y, size, col]) => txt(g, s, 320, y, size, col, 'center', 900));
  panelC.tex.needsUpdate = true;
}
const mutedNow = () => !!(window.__muted || (window.__mute && window.__mute.on));
const _w = new THREE.Vector3(), _w2 = new THREE.Vector3();
const toWorld = (v, out = _w) => out.copy(v).add(root.position);
const PANEL_VR = { score: 43, kcal: 68, d: 2.1, dy: 0.38 };   // degrees left of facing, metres, metres above head height (was: +-29 deg, 1.95 m, h + 0.05)
function placePanels() {
  const c = state.center, h = state.headH;
  panelL.m.visible = state.mode === 'play'; panelR.m.visible = state.mode === 'play' && !shootOn();   // v25: no CALORIES board in SHOOT
  const look = toWorld(_w2.set(c.x, h, c.z + (state.vr ? 0 : 2.5)), new THREE.Vector3());
  if (state.vr) {   // vrtest-v24 (Dave t513u): SCORE + CALORIES both on the player's LEFT, side by side around ~55 deg left of facing (-Z), 2.1 m from the
    // standing spot (follows the round-start calibration), raised so their lower edge (h + 0.10) clears the duck bar (h - 0.05, sheath to h + 0.06) and its posts
    for (const [P, a] of [[panelL, PANEL_VR.score], [panelR, PANEL_VR.kcal]]) { const r = a * Math.PI / 180;
      P.m.position.set(c.x - Math.sin(r) * PANEL_VR.d, h + PANEL_VR.dy, c.z - Math.cos(r) * PANEL_VR.d); P.m.updateMatrixWorld(); P.m.lookAt(toWorld(_w2.set(c.x, h, c.z), new THREE.Vector3())); }
  } else { const dz = 2.4, dx = 1.4, y = h + 0.35;
    panelL.m.position.set(c.x - dx, y, c.z - dz); panelL.m.updateMatrixWorld(); panelL.m.lookAt(look);
    panelR.m.position.set(c.x + dx, y, c.z - dz); panelR.m.updateMatrixWorld(); panelR.m.lookAt(look); }
  panelC.m.position.set(c.x, h + 0.35, c.z - 2.2); panelC.m.updateMatrixWorld(); panelC.m.lookAt(look);
}
function targetPos(t, now, out) {
  if (t.type === 'BAR') { const z = state.center.z - (t.t - now) * (SPAWN_DIST / TRAVEL); return out.set(state.center.x, state.headH - 0.05, z); }
  const u = (t.t - now) / TRAVEL; const hz = hitZ();
  const cx = state.center.x; const by = state.headH + t.y;
  return out.set(cx + t.x * (1 + u * 2.2), by + u * 0.5 + Math.sin(u * 6 + t.x * 9) * 0.05 * u, hz - u * SPAWN_DIST);
}
function addPower(v) {
  if (state.power > 0) return;
  state.powerMeter = clamp((state.powerMeter || 0) + v, 0, 1);
  if (state.powerMeter >= 1) { state.power = 1; state.powerT = POWER_TIME; state.powerMeter = 0; sfx.power(); popup('POWER MODE!', '#ffc94a', _v.set(state.center.x, state.headH + 0.45, hitZ() - 0.6), 1.5); flashFx(_v, COL.gold, 4); state.shake = 0.4; }
}
function scoreHit(t, side, quality, speed, shot) {
  const isC = t.type === 'C', off = !shot && !isC && t.type !== side;
  const q = quality >= 2 ? 1.5 : quality >= 1 ? 1.2 : 1.0;
  const base = isC ? 250 : 100;
  if (!state.autoplay) {
    if (off) { state.score += Math.round(base * 0.5); state.hits++; }
    else { state.streak++; state.maxStreak = Math.max(state.maxStreak, state.streak); state.score += Math.round(base * q * mult()); state.hits++; if (quality >= 2) state.perfect++; }
    if (shot) state.shotHits = (state.shotHits || 0) + 1; else state.punches++; if (!shootOn()) state.kcal += 0.14 + (speed ? clamp(speed - 1.5, 0, 4) * 0.03 : 0) + (isC ? 0.05 : 0);
    if (!off) addPower(isC ? 0.16 : quality >= 2 ? 0.08 : 0.06);
  }
  const p = t.pos, color = isC ? COL.C : COL[t.type], pw = state.power > 0;
  const k = pw ? 1.5 : 1;
  emit(p, color, Math.round((isC ? 90 : 55) * k), (isC ? 4.2 : 3.2) * k, 0.05);
  emit(p, 0xffffff, 16, 1.5, 0.08, 0.35);
  shatter(p, isC ? 0xbff6ff : color, isC ? 40 : 18, isC ? 3.6 : 2.6, isC ? 1.4 : 1);
  if (pw) { emit(p, COL.gold, 40, 4.5, 0.05); shatter(p, COL.gold, 10, 3); }
  ringFx(p, color, isC ? 1.5 : 1); flashFx(p, color, isC ? 2.2 : 1.5);
  const lbl = off ? ['OFF HAND', '#9aa7c7'] : quality >= 2 ? ['PERFECT', '#ffd56a'] : quality >= 1 ? ['GREAT', state.vr ? '#7fe9ff' : (side === 'L' ? '#18d8ff' : '#ff2bd6')] : ['GOOD', '#ffffff'];
  if (!state.autoplay || Math.random() < 0.3) popup(isC && !off ? 'CRYSTAL!' : lbl[0], isC && !off ? '#bff6ff' : lbl[1], _v.copy(p).add(_v2.set(0, 0.18, 0)), isC ? 1.2 : 1);
  isC ? sfx.crystal() : (!state.autoplay && sfx.hit(q, pw));
  state.shake = Math.max(state.shake, isC ? 0.18 : 0.08);
  const src = glove[shot ? 'R' : side].src; if (src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0]) { try { src.gamepad.hapticActuators[0].pulse(isC ? 1 : 0.7, isC ? 90 : 50); } catch (e) {} }
  t.alive = false; t.claimed = true; t.dying = 0.0001; t.m.g.visible = false; t.m.refl.visible = false;
}
function missTarget(t) {
  t.alive = false;
  if (state.autoplay) return;
  state.streak = 0; state.misses++; if (state.power <= 0) state.powerMeter = Math.max(0, (state.powerMeter || 0) - 0.08);
  popup('MISS', '#ff4d6d', _v.copy(t.pos).add(_v2.set(0, 0.2, 0.3)), 0.9); sfx.miss();
}
// ---------- flat screen: F / J (or the on-screen LEFT / RIGHT) punch, SPACE / DUCK ducks; the gloves float in front of the monkey ----------
function restOf(side, out) { const c = state.center; return out.set(c.x + (side === 'L' ? -0.2 : 0.2), state.headH - 0.32, c.z - 0.42); }
function punch(side) {
  if (state.mode !== 'play' || state.paused) return;
  const g = glove[side]; const now = state.t;
  let best = null, bestScore = 1e9;
  targets.forEach(t => {
    if (t.type === 'BAR' || !t.alive || t.claimed) return;
    const dt = Math.abs(t.t - now); if (dt > WIN) return;
    let s = dt; if (t.type !== side && t.type !== 'C') s += 0.5;   // prefer matching colour
    if (s < bestScore) { bestScore = s; best = t; }
  });
  if (!best) { const p = restOf(side, new THREE.Vector3()); p.z -= 0.8; p.y += 0.12; g.punch = { t0: 0, target: p, hitT: null }; sfx.whiff(); state.whiffs = (state.whiffs || 0) + 1; return; }
  best.claimed = true;
  const dt = Math.abs(best.t - now), quality = dt < 0.085 ? 2 : dt < 0.18 ? 1 : 0;
  g.punch = { t0: 0, target: best.pos.clone(), hitT: best, quality };
}
function duck() { if (state.mode !== 'play') return; if (state.duckT <= 0) state.duckT = 0.72; }
function updPunchAnim(side, dt) {
  const g = glove[side], o = g.obj, p = g.punch;
  const rest = restOf(side, _v); rest.y += Math.sin(state.clock * 7 + (side === 'L' ? 0 : 1.6)) * 0.012; rest.x += Math.sin(state.clock * 3.1 + (side === 'L' ? 0 : 2)) * 0.008;
  o.rotation.set(0.25, side === 'L' ? 0.12 : -0.12, 0);
  if (!p) { o.position.lerp(rest, 1 - Math.pow(0.0005, dt)); return; }
  p.t0 += dt;
  const OUT = 0.075, BACK = 0.17;
  if (p.t0 < OUT) { const k = p.t0 / OUT; o.position.lerpVectors(rest, p.target, 1 - (1 - k) * (1 - k)); o.rotation.z = (side === 'L' ? -1 : 1) * 0.4 * k; }
  else {
    if (p.hitT) { scoreHit(p.hitT, side, p.quality); p.hitT = null; }
    const k = Math.min(1, (p.t0 - OUT) / BACK); o.position.lerpVectors(p.target, rest, k * k * (3 - 2 * k)); o.rotation.z = (side === 'L' ? -1 : 1) * 0.4 * (1 - k);
    if (k >= 1) g.punch = null;
  }
}

// ---------- round flow ----------
function resetRun() {
  targets.forEach(freeTarget); targets = [];
  Object.assign(state, { t: 0, score: 0, streak: 0, maxStreak: 0, hits: 0, misses: 0, perfect: 0, dodges: 0, bumps: 0, punches: 0, shots: 0, shotHits: 0, kcal: 0, power: 0, powerT: 0, powerMeter: 0, evIdx: 0, duckT: 0, whiffs: 0 });
  const diff = state.daily ? 'normal' : state.diff; setTempo(diff);
  state.events = buildSchedule(ROUND_LEN, diff, state.daily ? daySeed(dayKey()) : (Date.now() % 100000) + 1); lastSched = -1;
  state.lastT = state.events.length ? state.events[state.events.length - 1].t : 0;
}
function calibrate() { ENV.headWorld(_v); _v.sub(root.position); if (_v.y > 0.6) { state.headH = clamp(_v.y, 1.0, 2.1); state.center.set(_v.x, 0, _v.z); } }
function startRound(opts = {}) {
  if (state.mode === 'play') return false;
  if (opts.daily != null) state.daily = !!opts.daily; if (opts.diff && NK_DIFF[opts.diff]) setDiff(opts.diff);
  initAudio(); state.vr = ENV.isVR();
  if (state.vr) calibrate(); else { const f = ENV.flatPlace(); state.center.copy(f.center); state.headH = f.headH; }
  resetRun(); state.mode = 'play'; state.paused = false; state.countBeat = -1; state.result = null; state.rounds++;
  placePanels();   // vrtest-v24: boards jump to the calibrated spot at once (not up to 0.1 s later)
  panelC.m.visible = false; hideMenu(); ui(); ENV.setHide({ models: true, rays: true });
  for (const s of ['L', 'R']) { glove[s].punch = null; if (!state.vr) glove[s].obj.position.copy(restOf(s, _v)); }
  return true;
}
function endRound() {
  state.mode = 'results'; targets.forEach(freeTarget); targets = [];
  const acc = state.hits + state.misses ? Math.round(100 * state.hits / (state.hits + state.misses)) : 0;
  const grade = acc >= 95 ? 'S' : acc >= 85 ? 'A' : acc >= 70 ? 'B' : acc >= 50 ? 'C' : 'D';
  const diff = state.daily ? 'daily' : state.diff, tix = ticketsFor(state.score, grade, state.daily ? 'normal' : state.diff);
  let bonus = 0; if (state.daily && lsGet('gaNK.dailyDone', '') !== dayKey()) { bonus = DAILY_BONUS; lsSet('gaNK.dailyDone', dayKey()); }
  const best = bestScore(), isBest = state.score > best; addScore({ s: state.score, d: diff, g: grade, t: dayKey(), vr: state.vr ? 1 : 0 });
  state.result = { acc, grade, isBest, tix, bonus, diff, score: state.score };
  state.payouts.push({ tix, bonus, grade, score: state.score, diff }); try { ENV.addTickets(tix + bonus); } catch (e) {}
  drawCenterPanel([['ROUND COMPLETE', 52, 40, '#7fe9ff'], [state.score.toLocaleString(), 130, 84, '#ffffff'], ['GRADE ' + grade + '   ACC ' + acc + '%', 205, 34, '#ff9cf0'],
    ['+' + tix + ' TICKETS' + (bonus ? '  +' + bonus + ' DAILY BONUS' : ''), 260, 34, '#ffe14a'], [isBest ? 'NEW BEST!' : 'BEST ' + Math.max(best, state.score).toLocaleString(), 312, 32, '#ffd56a'], ['PUNCH THE ORB TO PLAY AGAIN', 362, 26, '#ffffff']]);
  panelC.m.visible = true; drawBoard(); showMenu(); ui(); ENV.setHide({ models: true, rays: false });
}
function toTitle() { state.mode = 'title'; state.duckT = 0; targets.forEach(freeTarget); targets = []; state.result = null; showMenu(); drawMenu(); ui(); ENV.setHide({ models: true, rays: false }); }
function abort(why) { if (state.mode !== 'play') return; state.paused = false; state.aborts = (state.aborts || 0) + 1; state.lastAbort = why; toTitle(); }
// v17 (t404u): VR grip pause. The round clock, the orbs and the music stop; nothing is scored while paused. RESET = a fresh round,
// EXIT = abort (an unfinished round pays no tickets); both go through abort(), never endRound().
function pause() { if (state.mode !== 'play' || state.paused) return false; state.paused = true; state.pauses = (state.pauses || 0) + 1; if (master) master.gain.value = 0; ENV.setHide({ models: true, rays: false }); return true; }
function resume() { if (state.mode !== 'play' || !state.paused) return false; state.paused = false; for (const s of ['L', 'R']) { glove[s].fresh = true; glove[s].cool = 0.3; } ENV.setHide({ models: true, rays: true }); return true; }
function resetRound() { if (state.mode !== 'play') return false; abort('reset'); state.resets = (state.resets || 0) + 1; return startRound(); }
function setDiff(d) { if (!NK_DIFF[d]) return; state.diff = d; state.daily = false; lsSet('gaNK.diff', d); drawMenu(); ui(); }

// ---------- local high scores (the original has no world board; this copy keeps a local top 10) ----------
const SK = 'gaNK.scores';
function scores() { try { const a = JSON.parse(localStorage.getItem(SK)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function addScore(r) { const a = scores(); a.push(r); a.sort((x, y) => y.s - x.s); try { localStorage.setItem(SK, JSON.stringify(a.slice(0, 10))); } catch (e) {} }
const bestScore = () => (scores()[0] || { s: 0 }).s;
const board = makePanel(1.5, 1.2, 600, 480); board.m.name = 'nkBoard';
function drawBoard() { const g = board.g; holoFrame(g, 600, 480, '#ffd56a');
  txt(g, 'NEON KNOCKOUT · HIGH SCORES', 300, 46, 30, '#ffe14a', 'center', 900);
  const a = scores(); if (!a.length) txt(g, 'NO SCORES YET · PUNCH IN!', 300, 220, 30, '#ffffff', 'center');
  a.slice(0, 8).forEach((r, i) => { const y = 100 + i * 42, c = i === 0 ? '#ffd56a' : '#ffffff';
    txt(g, (i + 1) + '.', 40, y, 26, c); txt(g, r.s.toLocaleString(), 90, y, 28, c, 'left', 900); txt(g, (r.d || '').toUpperCase(), 330, y, 22, r.d === 'beast' ? '#ff6b8b' : r.d === 'daily' ? '#7fffd4' : r.d === 'easy' ? '#9ff8ff' : '#ff9cf0'); txt(g, r.g || '', 470, y, 26, '#7fe9ff'); txt(g, (r.t || '').slice(5), 560, y, 20, '#9aa7c7', 'right'); });
  txt(g, 'DAILY ' + dayKey() + (lsGet('gaNK.dailyDone', '') === dayKey() ? ' · BONUS CLAIMED' : ' · +' + DAILY_BONUS + ' BONUS WAITING'), 300, 448, 20, '#7fffd4', 'center');
  board.tex.needsUpdate = true; }

// ---------- studio menu: punch the orbs (VR) / tap the buttons (flat) ----------
// START orb in the ring; left column EASY / NORMAL / BEAST; right column DAILY + GLOVES (cycles the skins you own)
const menuOrbs = [];
const QS = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(); } })();
const NO_ROOF = QS.get('norooftop') === '1', NO_FEET = QS.get('nofeet') === '1';
// vrtest-v25 (Dave t514u): MODE: PUNCH (default) / SHOOT. In SHOOT (VR) the right hand holds the arcade's laser blaster, the trigger fires
// (vr.js runs the five fire types and calls shootRay()), hits score like punches; calories are hidden + not counted. ?noshootmode=1 = punch only.
const NO_SHOOT = QS.get('noshootmode') === '1', MODE_KEY = 'galacticarcade.nkMode';
let nkMode = NO_SHOOT ? 'punch' : (lsGet(MODE_KEY, 'punch') === 'shoot' ? 'shoot' : 'punch');
const shootOn = () => nkMode === 'shoot';
const modeLabel = () => 'MODE: ' + (nkMode === 'shoot' ? 'SHOOT' : 'PUNCH');
function setMode(m) { if (NO_SHOOT) return nkMode; nkMode = m === 'shoot' ? 'shoot' : 'punch'; lsSet(MODE_KEY, nkMode); state.modeSwitches = (state.modeSwitches || 0) + 1;
  if (state.mode === 'play') placePanels(); drawMenu(); ui(); try { if (window.__gaNkModeSync) window.__gaNkModeSync(); } catch (e) {} return nkMode; }
const MENU_Z = -1.25, MENU_H = 1.4;   // v23: VR menu orbs' plane = the far edge of the 1.25 m ground circle (studio -Z), fixed height
function menuOrb(id, label, color, dx, dy, r = 0.085) {
  const g = new THREE.Group(); g.name = 'nkOrb_' + id;
  const shell = new THREE.Mesh(orbGeo, fresnelMat(color, 1.2)); g.add(shell);
  const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); core.scale.setScalar(0.4); g.add(core);
  const halo = glowSprite(color, 3.2, 0.5); g.add(halo);
  const lab = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false })); lab.position.y = 1.9; lab.scale.set(4.4, 1.1, 1); g.add(lab);
  g.scale.setScalar(r); scene.add(g); const o = { id, label, color, g, lab, core, halo, dx, dy, r, pos: new THREE.Vector3(), alive: true, type: 'M' }; menuOrbs.push(o); setOrbLabel(o, label); return o; }
function setOrbLabel(o, label, col) { o.label = label; o.lab.material.map = labelTexture(label, col || '#' + new THREE.Color(o.color).getHexString()); o.lab.material.needsUpdate = true; }
const orbStart = menuOrb('start', 'START', 0x7fffd4, 0, -0.25, 0.2), orbs = {
  easy: menuOrb('easy', 'EASY', 0x7fe9ff, -0.62, NO_SHOOT ? 0.22 : 0.34), normal: menuOrb('normal', 'NORMAL', 0xff9cf0, -0.62, NO_SHOOT ? -0.02 : 0.11), beast: menuOrb('beast', 'BEAST', 0xff3355, -0.62, NO_SHOOT ? -0.26 : -0.12),
  daily: menuOrb('daily', 'DAILY', 0xffd56a, 0.62, NO_ROOF ? 0.12 : 0.22), gloves: menuOrb('gloves', 'GLOVES', 0xffffff, 0.62, NO_ROOF ? -0.18 : -0.02) };
if (!NO_SHOOT) { orbs.mode = menuOrb('mode', modeLabel(), 0x48f2ff, -0.62, -0.35, 0.1); orbs.mode.lab.scale.set(5.6, 1.4, 1); }   // vrtest-v25
if (!NO_ROOF) { orbs.scenery = menuOrb('scenery', 'SCENERY', 0xc77dff, 0.62, -0.28, 0.1); orbs.scenery.lab.scale.set(5.6, 1.4, 1); }   // vrtest-v20 (Dave t503u); v23: bigger, full label   // vrtest-v20 (Dave t503u)
orbStart.lab.position.y = 1.6; orbStart.lab.scale.set(3.2, 0.8, 1);
let menuOn = true;
function showMenu() { menuOn = true; for (const o of menuOrbs) o.g.visible = true; drawMenu(); }
function hideMenu() { menuOn = false; for (const o of menuOrbs) o.g.visible = false; }
function menuAct(id) { state.menuHits = (state.menuHits || 0) + 1; state.lastMenu = id;
  if (id === 'start') return startRound();
  if (id === 'daily') { state.daily = !state.daily; drawMenu(); ui(); return true; }
  if (id === 'gloves') { const own = gloveIds().filter(ownsGlove), i = own.indexOf(state.skin); const nx = own[(i + 1) % own.length]; wearGlove(nx); applySkin(nx); ui(); return true; }
  if (id === 'mode') { setMode(shootOn() ? 'punch' : 'shoot'); return true; }
  if (id === 'scenery') { setScenery(scenery === 'rooftop' || sceneryWant === 'rooftop' ? 'studio' : 'rooftop'); return true; }
  if (NK_DIFF[id]) { setDiff(id); return true; } }
function drawMenu() { if (state.mode === 'play') return;
  for (const k of ['easy', 'normal', 'beast']) { const on = !state.daily && state.diff === k; orbs[k].core.material.opacity = on ? 1 : 0.35; orbs[k].halo.material.opacity = on ? 0.8 : 0.25; setOrbLabel(orbs[k], (on ? '▶ ' : '') + NK_DIFF[k].label); }
  const done = lsGet('gaNK.dailyDone', '') === dayKey(); setOrbLabel(orbs.daily, (state.daily ? '▶ ' : '') + 'DAILY' + (done ? ' ✓' : ' +' + DAILY_BONUS)); orbs.daily.core.material.opacity = state.daily ? 1 : 0.35;
  setOrbLabel(orbs.gloves, 'GLOVES: ' + gloveSkin(state.skin).name.toUpperCase()); orbs.gloves.core.material.color.set(gloveSkin(state.skin).glow);
  if (orbs.scenery) setOrbLabel(orbs.scenery, sceneryLabel());
  if (orbs.mode) setOrbLabel(orbs.mode, modeLabel());
  if (state.mode === 'title') { const d = state.daily ? 'DAILY ROUTINE ' + dayKey() : NK_DIFF[state.diff].label + ' · ' + NK_DIFF[state.diff].bpm + ' BPM';
    drawCenterPanel([['NEON KNOCKOUT', 58, 62, '#ffffff'], ['Punch cyan orbs with your LEFT glove', 128, 26, '#7fe9ff'], ['Punch pink orbs with your RIGHT glove', 166, 26, '#ff9cf0'], ['Smash crystals with either • DUCK red bars', 204, 26, '#ffd56a'],
      [d, 262, 32, '#ffe14a'], ['Earn arcade tickets by grade', 306, 24, '#9ff8ff'], [state.vr ? 'Punch START to play · punch the side orbs to pick' : 'Press START (or ENTER) · F / J punch · SPACE ducks', 352, 24, '#ffffff']]); panelC.m.visible = true; } }
function placeMenu() { const c = state.menuC || state.center, h = state.menuH || state.headH;
  const hv = (window.__gaVR && window.__gaVR.hoverTarget) || '';
  for (const o of menuOrbs) { const s = o.r * (1 + state.beatPulse * 0.08 + Math.sin(state.clock * 3 + o.dx * 5) * 0.03) * (hv === 'nkOrb_' + o.id ? 1.18 : 1); o.pos.set(c.x + o.dx, h + o.dy, c.z - 0.5); o.g.position.copy(o.pos); o.g.scale.setScalar(s); } }

// ---------- studio props: a floor marker where you stand, the high-score wall beside the teleporter pad ----------
const PAD = ENV.padLocal || new THREE.Vector3(2.6, 0, 2.4);
const mark = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.38, 48), new THREE.MeshBasicMaterial({ color: 0x7fffd4, transparent: true, opacity: 0.8, fog: false, side: THREE.DoubleSide })); mark.rotation.x = -Math.PI / 2; mark.position.set(0, 0.01, 0); mark.name = 'nkStandHere'; scene.add(mark);
board.m.position.set(PAD.x + 1.6, 1.7, PAD.z - 0.6); board.m.renderOrder = 5;
// ---------- vrtest-v20 (Dave t504u): FOOTPRINTS. Two glowing shoe-sole outlines where you stand to box, shoulder width apart, toes toward
// the targets (-Z). One flat additive quad + a 256x256 canvas; faint (not gone) once the round starts. ?nofeet=1 = off.
let feetShift = null;
function feetTex() { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), PX = 256 / 0.75;   // 0.75 m square
  const sole = (cx, ang) => { g.save(); g.translate(128 + cx * PX, 128); g.rotate(ang); g.beginPath();
    const L = 0.27 * PX, W = 0.1 * PX;   // ~27 cm long, 10 cm wide; toes up (= -Z on the floor)
    g.moveTo(0, -L / 2); g.bezierCurveTo(W * 0.75, -L / 2, W * 0.62, -L * 0.1, W * 0.42, L * 0.08); g.bezierCurveTo(W * 0.36, L * 0.22, W * 0.5, L / 2, 0, L / 2);
    g.bezierCurveTo(-W * 0.5, L / 2, -W * 0.36, L * 0.22, -W * 0.44, L * 0.06); g.bezierCurveTo(-W * 0.62, -L * 0.12, -W * 0.68, -L / 2, 0, -L / 2); g.closePath();
    g.lineWidth = 5; g.strokeStyle = '#7fffd4'; g.shadowColor = '#18d8ff'; g.shadowBlur = 14; g.stroke(); g.lineWidth = 2; g.shadowBlur = 0; g.strokeStyle = '#ffffff'; g.stroke(); g.restore(); };
  sole(-0.19, -0.12); sole(0.19, 0.12);   // ~38 cm between the centres, toes turned out a little
  // vrtest-v23 (Dave t510u): centre the drawn outline (its pixel bounds, glow included) exactly on the quad = the standing circle's centre
  { const d = g.getImageData(0, 0, 256, 256).data; let x0 = 256, y0 = 256, x1 = -1, y1 = -1;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (d[(y * 256 + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const dx = Math.round(128 - (x0 + x1 + 1) / 2), dy = Math.round(128 - (y0 + y1 + 1) / 2); feetShift = [dx, dy];
    if (dx || dy) { const cp = document.createElement('canvas'); cp.width = cp.height = 256; cp.getContext('2d').drawImage(c, 0, 0); g.clearRect(0, 0, 256, 256); g.drawImage(cp, dx, dy); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const feet = NO_FEET ? null : new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ map: feetTex(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
if (feet) { feet.rotation.x = -Math.PI / 2; feet.position.set(0, 0.016, 0); feet.renderOrder = 3; feet.name = 'nkFeet'; scene.add(feet); }

// ---------- vrtest-v20 (Dave t503u): SCENERY = the studio (default) or a CYBERPUNK ROOFTOP (nk/rooftop.js). The ring, targets, menu, gloves,
// portals and gameplay are the same in both; only the surroundings swap. Saved in galacticarcade.nkScenery. Switching builds the rooftop
// hidden, compiles its 6 programs off the frame (compileAsync), then swaps in one frame; the unused scenery's GPU buffers / textures are
// freed (rooftop: everything disposed; studio: its geometries + sign texture disposed and re-uploaded on return; materials kept so
// its shaders stay compiled). ?norooftop=1 = no option, always the studio.
const SC_KEY = 'galacticarcade.nkScenery';
let scenery = 'studio', sceneryWant = 'studio', roofKit = null, roofP = null, scSeq = 0;
const scStats = { switches: 0, lastMs: 0, compileMs: 0, builds: 0, disposes: 0 };
function sceneryLabel() { return sceneryWant !== scenery ? 'SCENERY: LOADING…' : 'SCENERY: ' + (scenery === 'rooftop' ? 'ROOFTOP' : 'STUDIO'); }
function studioEnv(on) { for (const o of ENV_DEF) o.visible = on;
  if (!on) { for (const o of ENV_DEF) { if (o.geometry && !o.isSprite) o.geometry.dispose(); } sign.material.map.dispose(); } }
function topScene() { let p = root; while (p.parent) p = p.parent; return p; }
function compileKit(obj) { const sc = topScene();
  try { if (!ENV.isVR() && window.__compileForPlay) return window.__compileForPlay(obj, camera, sc); return renderer.compileAsync ? renderer.compileAsync(obj, camera, sc) : (renderer.compile(obj, camera, sc), Promise.resolve()); }
  catch (e) { return Promise.reject(e); } }
function applyScenery(id) { const t0 = performance.now(); scStats.tApply = t0;
  if (id === 'rooftop') { roofKit.group.visible = true; studioEnv(false); }
  else { studioEnv(true); if (roofKit) { roofKit.dispose(); roofKit = null; scStats.disposes++; } }
  scenery = id; scStats.switches++; scStats.lastMs = Math.round((performance.now() - t0) * 10) / 10; drawMenu(); ui(); }
function setScenery(id, opts = {}) { if (id !== 'rooftop') id = 'studio'; if (NO_ROOF) id = 'studio';
  sceneryWant = id; if (!opts.noSave) lsSet(SC_KEY, id); const seq = ++scSeq;
  if (id === scenery) { if (id === 'studio' && roofKit) { roofKit.dispose(); roofKit = null; scStats.disposes++; } drawMenu(); ui(); return Promise.resolve(id); }
  if (id === 'studio') { applyScenery('studio'); return Promise.resolve(id); }
  drawMenu(); ui();
  const kitP = roofKit ? Promise.resolve(roofKit) : (roofP || (roofP = (async () => { const b0 = performance.now(); scStats.tBuild = b0; const k = await buildRooftop({ glowTex, COL, slice: !opts.sync });
    scStats.buildMs = Math.round(performance.now() - b0); scStats.builds++; k.group.visible = false; scene.add(k.group); roofKit = k; roofP = null; return k; })()));
  return kitP.then(k => { if (seq !== scSeq || sceneryWant !== 'rooftop') { if (sceneryWant === 'studio' && roofKit && scenery !== 'rooftop') { roofKit.dispose(); roofKit = null; scStats.disposes++; } return scenery; }
    if (opts.sync) { applyScenery('rooftop'); compileKit(k.group).catch(() => {}); return scenery; }   // at load: shown at once (compiled in the background + by the beam pre-warm)
    const c0 = performance.now(); scStats.tCompile = c0; return compileKit(k.group).catch(() => {}).then(() => { scStats.compileMs = Math.round(performance.now() - c0); if (seq !== scSeq || sceneryWant !== 'rooftop' || !roofKit) return scenery; applyScenery('rooftop'); return scenery; }); }); }

function placeBoard() { board.m.updateMatrixWorld(); board.m.lookAt(toWorld(_w2.set(0, 1.6, 0), new THREE.Vector3())); }

// ---------- VR: the arcade's controllers are the gloves ----------
const _gq = new THREE.Quaternion(), _gp = new THREE.Vector3(), _go = new THREE.Vector3(0, -0.01, 0.03); const _rq = new THREE.Quaternion(), _w3 = new THREE.Vector3(), _w3b = new THREE.Vector3(), _bp = new THREE.Vector3(), _bm = new THREE.Matrix4(), _bmi = new THREE.Matrix4(), _bs = new THREE.Vector3();
function vrGloves() { for (const s of ['L', 'R']) { const G = glove[s], gp = ENV.grip(s === 'L' ? 'left' : 'right'); G.on = !!gp; G.obj.visible = !!gp; G.src = gp ? gp.src : null; if (!gp) continue;
    gp.obj.updateMatrixWorld(true); gp.obj.matrixWorld.decompose(_gp, _gq, _w2); G.obj.quaternion.copy(_gq); G.obj.position.copy(_go).applyQuaternion(_gq).add(_gp).sub(root.position);
    if (s === 'R') placeBlaster(gp, G); } }
// vrtest-v27 (Dave t517u): the shots fly along the controller's POINTING ray (target-ray space), like the arcade's gun. v25 turned the
// blaster by the GRIP pose, which is pitched ~45 deg against that ray (more on a real Quest), so the gun pointed up and the bolts seemed to
// come from below it. Now the barrel (+Z of the model) lies exactly along the ray and the handle sits in the hand (grip position).
// Called every NK tick AND by blasterMuzzle(), so a shot fired this frame leaves the muzzle where it is drawn this frame.
function placeBlaster(gp, G) { const b = shootOn() && state.vr && gp ? blasterGet() : null; if (!b) { if (BL.m) BL.m.visible = false; return false; }
  if (G) G.obj.visible = false; b.visible = true;
  gp.obj.updateMatrixWorld(true); gp.obj.matrixWorld.decompose(_bp, _rq, _w3);
  const rc = gp.ray || gp.obj; rc.updateMatrixWorld(true); rc.matrixWorld.decompose(_w3, _rq, _w3b);
  b.quaternion.copy(_rq).multiply(BL_Q); _w3.copy(BL_OFF).applyQuaternion(_rq).add(_bp);   // world pose of the gun: handle in the hand, barrel along the ray
  root.updateWorldMatrix(true, false); _bm.compose(_w3, b.quaternion, _bs.setScalar(BL_S)); b.matrix.copy(_bmi.copy(root.matrixWorld).invert()).multiply(_bm);   // -> local to the studio root
  b.matrix.decompose(b.position, b.quaternion, b.scale); b.matrixAutoUpdate = false; b.matrixWorldNeedsUpdate = true; b.updateMatrixWorld(true); BL.placed = (BL.placed || 0) + 1; return true; }
// vrtest-v25: the arcade's laser blaster (player.js's pistol model, cloned once) in the right hand in SHOOT. Barrel (+Z of the model) along the grip's -Z.
const BL = { m: null, muzzle: null, tried: false }, BL_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), BL_OFF = new THREE.Vector3(0, 0.035, 0.02), BL_S = 0.45;
function blasterGet() { if (BL.m || BL.tried) return BL.m; BL.tried = true; let c = null;
  try { const P = window.__gaPlayer; c = P && P.previewItem ? P.previewItem('hand', 'pistol') : null; } catch (e) { c = null; }
  if (!c) { c = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.5), new THREE.MeshBasicMaterial({ color: 0x3a4558 })); body.position.z = 0.25; c.add(body);
    const mz = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8), new THREE.MeshBasicMaterial({ color: 0x48f2ff })); mz.rotation.x = Math.PI / 2; mz.position.set(0, 0.03, 0.6); mz.name = 'gaPistolMuzzle'; c.add(mz); }
  // vrtest-v28 (Dave t519u, real Quest): the arcade fits the EQUIPPED pistol to the controller with matrixAutoUpdate = false + a hand-made
  // matrix (vr.js gunFit). A clone inherits both, so v25-v27 wrote position / quaternion into an object that never rebuilt its matrix: the gun
  // stayed at the studio origin (the player's feet, muzzle under the floor) and every bolt left from there. The clone is now cleaned (every
  // node rebuilds its own matrix, no vrFit flag) and placeBlaster() writes the gun's matrix itself, the same way the arcade's first-person gun does.
  c.traverse(o => { o.matrixAutoUpdate = true; if (o.userData) { delete o.userData.vrFit; } o.updateMatrix(); });
  c.name = 'nkBlaster'; c.scale.setScalar(BL_S); c.traverse(o => { o.frustumCulled = false; if (o.name === 'gaPistolMuzzle') { o.name = 'nkBlasterMuzzle'; BL.muzzle = o; } });
  c.matrixAutoUpdate = false;   // placeBlaster() composes c.matrix every frame
  c.visible = false; scene.add(c); BL.m = c; return c; }
// vrtest-v25: a blaster shot = a ray (world o, d) against the live targets (sphere test, a dozen targets: cheap). Bolts / beams hit the nearest
// target (the beam: every target it touches, each frame). Timing: PERFECT when the target is about to reach you, GREAT mid-way, GOOD far out.
const SHOT_RANGE = 26, _ro = new THREE.Vector3(), _rd = new THREE.Vector3(), _rv = new THREE.Vector3();
function shootRay(o, d, opts = {}) { if (!shootOn() || state.mode !== 'play' || state.paused) return null;
  _ro.set(o[0], o[1], o[2]).sub(root.position); _rd.set(d[0], d[1], d[2]).normalize();
  const k = opts.k || 0, beam = opts.kind === 'beam', pad = opts.kind === 'charge' ? 0.06 + k * 0.25 : beam ? 0.05 : 0.07;
  let best = null, bd = SHOT_RANGE, hits = 0; if (!beam) state.shots++;
  for (const t of targets) { if (t.type === 'BAR' || !t.alive || t.claimed) continue; _rv.copy(t.pos).sub(_ro); const along = _rv.dot(_rd); if (along < 0 || along > SHOT_RANGE) continue;
    const r = t.r + pad; if (_rv.lengthSq() - along * along > r * r) continue;
    if (beam) { shotHit(t); hits++; } else if (along < bd) { bd = along; best = t; } }
  if (best) { shotHit(best); hits++; }
  return { hits, dist: best ? bd : null }; }
function shotHit(t) { const rem = t.t - state.t, q = rem < 0.35 ? 2 : rem < 0.9 ? 1 : 0; scoreHit(t, t.type === 'C' ? 'R' : t.type, q, 0, true); }
function vrHits() {
  if (shootOn() && state.mode === 'play') return;   // v25: SHOOT round: the blaster scores (shootRay), no punching
  ['L', 'R'].forEach(side => {
    const g = glove[side]; if (!g.on) return;
    const list = state.mode === 'play' ? targets : menuOrbs;
    for (const t of list) {
      if (t.type === 'BAR' || !t.alive || (t.type === 'M' && !t.g.visible)) continue;
      const d = g.pos.distanceTo(t.pos);
      if (d < (t.type === 'M' ? t.r * 1.1 : t.r) + 0.09 && g.speed > (t.type === 'M' ? 0.8 : 1.1)) {
        if (t.type === 'M') { if (g.cool > 0) return; g.cool = 0.45; emit(t.pos, t.color, 60, 3, 0.05); ringFx(t.pos, t.color, 1.2); sfx.crystal(); haptic(side, 0.7, 60); menuAct(t.id); return; }
        const quality = g.speed > 3.2 ? 2 : g.speed > 2.2 ? 1 : 0;
        scoreHit(t, side, quality, g.speed);
      }
    }
  });
}
function haptic(side, v, ms) { const src = glove[side].src; try { const h = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0]; if (h) h.pulse(v, ms); } catch (e) {} }

// ---------- flat-screen overlay (only while you are in the studio and not in the headset) ----------
const css = document.createElement('style'); css.textContent = '#nkUI{position:fixed;inset:0;z-index:23;pointer-events:none;display:none;font-family:"Courier New",monospace;color:#e6fdff}#nkUI.on{display:block}'
  + '#nkUI .nkM{position:absolute;left:50%;top:calc(max(10px,env(safe-area-inset-top)) + 54px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:auto;background:#07021acc;border:2px solid #7f9bff;border-radius:16px;padding:10px 14px;max-width:94vw}'
  + '#nkUI button{pointer-events:auto;min-width:76px;height:42px;padding:0 12px;border-radius:21px;border:2px solid #00e5ff;background:#03141ae8;color:#e6fdff;font:900 14px/1 "Courier New",monospace;letter-spacing:.08em;cursor:pointer;touch-action:manipulation}#nkUI button.sel{border-color:#ffe14a;background:#3a2a00e8;color:#fff3b0}'
  + '#nkUI .row{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}#nkUI .t{font:900 18px/1.2 "Courier New",monospace;letter-spacing:.2em;color:#fff;text-shadow:0 0 8px #18d8ff}#nkUI .s{font:700 12px/1.3 "Courier New",monospace;color:#9ff8ff;text-align:center}'
  + '#nkUI .hud{position:absolute;left:50%;top:calc(max(8px,env(safe-area-inset-top)) + 8px);transform:translateX(-50%);display:none;gap:16px;font:900 16px/1 "Courier New",monospace;background:#07021aaa;border-radius:12px;padding:6px 14px}#nkUI.play .hud{display:flex}'
  + '#nkUI .pads{position:absolute;left:0;right:0;bottom:calc(max(10px,env(safe-area-inset-bottom)) + 10px);display:none;justify-content:space-between;padding:0 14px}#nkUI.play .pads{display:flex}#nkUI.play .nkM{display:none}'
  + '#nkUI .pads button{width:28vw;max-width:170px;height:84px;font-size:20px}#nkUI .pads #nkL{border-color:#18d8ff}#nkUI .pads #nkR{border-color:#ff2bd6}#nkUI .pads #nkD{border-color:#ff3355;width:22vw}'
  + '@media (max-height:480px){#nkUI .nkM{top:calc(max(6px,env(safe-area-inset-top)) + 44px);gap:4px;padding:6px 10px}#nkUI button{height:32px;min-width:64px;font-size:12px}#nkUI .t{font-size:14px}#nkUI .s{font-size:10px}#nkUI .pads button{height:64px}}';
document.head.appendChild(css);
const UI = document.createElement('div'); UI.id = 'nkUI'; UI.innerHTML = '<div class="hud"><span id="nkSc">0</span><span id="nkTm">2:30</span><span id="nkSt">x1</span></div>'
  + '<div class="nkM"><div class="t">NEON KNOCKOUT</div><div class="s" id="nkInfo"></div><div class="row"><button data-nk="easy">EASY</button><button data-nk="normal">NORMAL</button><button data-nk="beast">BEAST</button><button data-nk="daily">DAILY</button></div>'
  + '<div class="row"><button data-nk="gloves" id="nkGl">GLOVES</button><button data-nk="start" id="nkGo">START</button>' + (NO_ROOF ? '' : '<button data-nk="scenery" id="nkScn">SCENERY</button>') + '</div><div class="s">F / J or LEFT / RIGHT punch · SPACE or DUCK ducks · best in VR</div></div>'
  + '<div class="pads"><button id="nkL" data-nk="pL">LEFT</button><button id="nkD" data-nk="pD">DUCK</button><button id="nkR" data-nk="pR">RIGHT</button></div>';
document.body.appendChild(UI);
const stopE = e => { e.stopPropagation(); };
for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'click', 'pointerup']) UI.addEventListener(ev, stopE, { passive: true });
UI.addEventListener('pointerdown', e => { const b = e.target.closest && e.target.closest('[data-nk]'); if (!b) return; const k = b.dataset.nk; initAudio();
  if (k === 'pL') punch('L'); else if (k === 'pR') punch('R'); else if (k === 'pD') duck(); else menuAct(k); });
addEventListener('keydown', e => { if (!inStudioFlat()) return; const k = e.key.toLowerCase();
  if (state.mode === 'play') { let used = true; if (['f', 'arrowleft', 'z'].includes(k)) punch('L'); else if (['j', 'arrowright', 'x'].includes(k)) punch('R'); else if ([' ', 'arrowdown', 'c'].includes(k)) duck(); else if (k === 'escape') abort('quit'); else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); } }
  else if (k === 'enter') { e.preventDefault(); e.stopImmediatePropagation(); initAudio(); startRound(); } }, true);
addEventListener('keyup', e => { if (inStudioFlat() && state.mode === 'play') { const k = e.key.toLowerCase(); if (['f', 'j', ' ', 'arrowleft', 'arrowright', 'arrowdown', 'z', 'x', 'c'].includes(k)) e.stopImmediatePropagation(); } }, true);
let inStudio = false; const inStudioFlat = () => inStudio && !ENV.isVR();
function ui() { const on = inStudioFlat(); UI.classList.toggle('on', on); UI.classList.toggle('play', on && state.mode === 'play'); if (!on) return;
  for (const b of UI.querySelectorAll('[data-nk]')) { const k = b.dataset.nk; b.classList.toggle('sel', (NK_DIFF[k] && !state.daily && state.diff === k) || (k === 'daily' && state.daily)); }
  UI.querySelector('#nkGl').textContent = 'GLOVES: ' + gloveSkin(state.skin).name.toUpperCase(); UI.querySelector('#nkGo').textContent = state.mode === 'results' ? 'AGAIN' : 'START'; { const b = UI.querySelector('#nkScn'); if (b) { b.textContent = sceneryLabel(); b.classList.toggle('sel', sceneryWant === 'rooftop'); } }
  const r = state.result, done = lsGet('gaNK.dailyDone', '') === dayKey();
  UI.querySelector('#nkInfo').textContent = (r ? 'SCORE ' + r.score.toLocaleString() + ' · GRADE ' + r.grade + ' · +' + (r.tix + r.bonus) + ' TICKETS' + (r.isBest ? ' · NEW BEST' : '') + '  |  ' : '') + (state.daily ? 'DAILY ' + dayKey() + (done ? ' (bonus claimed)' : ' · +' + DAILY_BONUS + ' bonus') : NK_DIFF[state.diff].label + ' · ' + NK_DIFF[state.diff].bpm + ' BPM') + ' · BEST ' + bestScore().toLocaleString(); }
function updHud() { UI.querySelector('#nkSc').textContent = state.score.toLocaleString(); UI.querySelector('#nkTm').textContent = fmtTime(ROUND_LEN - state.t); UI.querySelector('#nkSt').textContent = 'x' + mult() + (state.streak ? ' · ' + state.streak : ''); }
// ---------- per-frame (called from the arcade's frame loop) ----------
const tmpPos = new THREE.Vector3(); let panelTick = 0, frames = 0, boardDrawn = false, wasVR = false;
function headY() { ENV.headWorld(_v2); return _v2.y - root.position.y; }
function update(dt) {
  state.clock += dt; state.vr = ENV.isVR();
  if (state.vr !== wasVR) { wasVR = state.vr; if (state.mode === 'play') abort(state.vr ? 'entered VR' : 'left VR'); ui(); drawMenu(); }
  const playing = state.mode === 'play' && !state.paused;
  if (playing) state.t += dt;
  const now = state.t;
  const bp = ((playing ? now : state.clock) % BEAT) / BEAT; state.beatPulse = Math.pow(1 - bp, 3);
  if (playing) {
    if (!mutedNow()) schedMusic(now, 0.25); if (master) master.gain.value = mutedNow() ? 0 : 0.8;
    const cb = Math.floor(now / BEAT);
    if (cb !== state.countBeat && cb < 8 && cb >= 4) { state.countBeat = cb; const lbl = ['3', '2', '1', 'GO!'][cb - 4]; popup(lbl, cb === 7 ? '#ffd56a' : '#7fe9ff', _v.set(state.center.x, state.headH + 0.25, hitZ() - 1.2), 1.6); sfx.count(cb === 7); }
    if (!shootOn()) state.kcal += dt * (3.6 / 60) * (state.vr ? 1.2 : 1);
    if (state.power > 0) { state.powerT -= dt; if (state.powerT <= 0) { state.power = 0; state.powerT = 0; } }
    if (now > Math.max(ROUND_LEN, state.lastT + 1.2)) { endRound(); return; }
    while (state.evIdx < state.events.length && state.events[state.evIdx].t - now <= TRAVEL) { spawnTarget(state.events[state.evIdx]); state.evIdx++; }
  }
  const duckDepth = state.vr ? 0 : (state.duckT > 0 ? Math.sin(Math.min(1, (0.72 - state.duckT) / 0.72) * Math.PI) : 0);
  if (state.duckT > 0) state.duckT -= dt;
  if (!state.vr) ENV.flatDuck(duckDepth);
  let barSoon = false;
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    if (t.type === 'BAR') {
      const p = targetPos(t, now, tmpPos); t.bar.g.position.copy(p); t.bar.g.children.forEach(c => { if (c.name === 'post') { c.position.y = -p.y / 2; c.scale.y = p.y; } });
      const s = 1 + state.beatPulse * 0.15; t.bar.g.children[1].scale.set(s, 1, s);
      if (t.t - now < 1.1 && t.t - now > 0) barSoon = true;
      if (t.alive && now >= t.t) {
        t.alive = false;
        const ducked = state.vr ? headY() < state.headH - 0.22 : state.duckT > 0.05;
        if (ducked) { state.dodges++; state.score += 50 * mult(); if (!shootOn()) state.kcal += 0.45; popup('DODGE!', '#7fe9ff', _v.set(p.x, state.headH + 0.3, p.z - 1.5), 1.1); sfx.dodge(); addPower(0.05); }
        else { state.bumps++; state.streak = 0; state.hurt = 1; state.shake = 0.5; popup('DUCK!', '#ff4d6d', _v.set(p.x, state.headH + 0.25, p.z - 1.5), 1.2); sfx.bump(); }
      }
      if (now > t.t + 1.0) { freeTarget(t); targets.splice(i, 1); }
      continue;
    }
    targetPos(t, now, t.pos);
    if (t.alive) {
      const m = t.m; m.g.position.copy(t.pos); m.refl.position.copy(t.pos); m.refl.scale.setScalar(t.r * 0.8);
      m.g.rotation.y += dt * (t.type === 'C' ? 3 : 1.2); m.ring.rotation.x = state.clock * 2 + t.x * 5; m.ring.rotation.y = state.clock * 1.3;
      const pulse = 1 + state.beatPulse * 0.12, near = 1 - clamp((t.t - now) / TRAVEL, 0, 1);
      m.core.scale.setScalar(0.32 * pulse); m.halo.material.opacity = 0.25 + 0.45 * near; m.shell.material.uniforms.uI.value = 0.7 + 0.6 * near;
      if (!t.claimed && now > t.t + (state.vr ? 0.45 : WIN)) missTarget(t);
    }
    if (!t.alive) {
      if (t.claimed) { freeTarget(t); targets.splice(i, 1); continue; }
      t.dying += dt; t.m.g.position.copy(t.pos); t.m.refl.position.copy(t.pos);
      const f = clamp(1 - t.dying * 1.6, 0, 1); t.m.g.scale.setScalar(t.r * f);
      if (f <= 0 || t.pos.z > state.center.z + 2.5) { freeTarget(t); targets.splice(i, 1); }
    }
  }
  state.barSoon = barSoon;
  if (state.mode !== 'play') { if (state.vr) { state.menuH = MENU_H; state.menuC = (state.menuC || new THREE.Vector3()).set(0, 0, MENU_Z + 0.5); } else { state.menuC = null; state.menuH = null; } placeMenu(); }   // v23 (Dave t421u): VR menu orbs locked to the far end of the ground circle (not following the head)
  ENV.headWorld(camWorld);
  if (state.vr) vrGloves(); else { for (const s of ['L', 'R']) { glove[s].on = state.mode === 'play'; glove[s].obj.visible = glove[s].on; glove[s].src = null; if (glove[s].on) updPunchAnim(s, dt); } }
  ['L', 'R'].forEach(s => {
    const g = glove[s]; g.prev.copy(g.pos); g.obj.updateMatrixWorld(); g.obj.localToWorld(_v.set(0, 0, -0.07)); g.pos.copy(_v).sub(root.position);
    if (dt > 0) { g.vel.subVectors(g.pos, g.prev).divideScalar(dt); const sp = g.vel.length(); g.speed = sp > 30 || g.fresh ? 0 : sp; } g.fresh = !g.on; if (g.cool > 0) g.cool -= dt;
    if (g.on) updTrail(s, dt); else trails[s].m.visible = false; if (g.on) trails[s].m.visible = true;
    const ud = g.obj.userData, pw = state.power > 0;
    ud.blue.color.set(pw ? COL.gold : skin.band); ud.halo.material.color.set(pw ? COL.gold : skin.glow); ud.halo.material.opacity = 0.35 + clamp(g.speed / 6, 0, 0.5);
  });
  if (state.vr && !(state.mode === 'play' && state.paused)) vrHits();
  updParticles(dt); updShards(dt); updFx(dt);
  floorMat.uniforms.uT.value = state.clock; floorMat.uniforms.uBeat.value = state.beatPulse; floorMat.uniforms.uPow.value += ((state.power > 0 ? 1 : 0) - floorMat.uniforms.uPow.value) * Math.min(1, dt * 3); floorMat.uniforms.uO.value.copy(root.position);
  cones.forEach(c => { c.m.rotation.z = Math.sin(state.clock * 0.6 + c.ph) * 0.28; c.m.rotation.x = Math.cos(state.clock * 0.45 + c.ph) * 0.18; c.m.material.uniforms.uI.value = 0.22 + state.beatPulse * 0.14 + (state.power > 0 ? 0.12 : 0); });
  const pw = state.power > 0;
  backGlow.material.color.set(pw ? 0xff9a2b : 0x3a2bff); sign.material.opacity = 0.7 + state.beatPulse * 0.3;
  if (roofKit && scenery === 'rooftop') roofKit.update(dt, state.clock, state.beatPulse, pw, root.position);
  mark.position.set(state.center.x, 0.012, state.center.z);
  if (feet) { feet.position.set(mark.position.x, 0.016, mark.position.z); /* vrtest-v23: exactly the standing circle's centre */ feet.material.opacity = state.mode === 'play' ? 0.16 : 0.62 + state.beatPulse * 0.3; }
  if (scenery !== 'rooftop') { const dp = dustGeo.attributes.position.array; for (let i = 0; i < dustN; i++) { dp[i * 3 + 2] += dt * (0.6 + (pw ? 2 : 0)); if (dp[i * 3 + 2] > 3) dp[i * 3 + 2] = -30; } dustGeo.attributes.position.needsUpdate = true; }
  state.hurt = Math.max(0, state.hurt - dt * 2); state.shake = Math.max(0, state.shake - dt * 1.6);
  mark.material.opacity = state.mode === 'play' ? 0.25 : 0.5 + state.beatPulse * 0.4; mark.position.set(state.center.x, 0.012, state.center.z);
  panelTick -= dt;
  if (panelTick <= 0 && state.mode === 'play') { panelTick = 0.1; placePanels(); drawPanels(); updHud(); }
  if (state.mode !== 'play') { panelL.m.visible = panelR.m.visible = false; if (panelTick <= 0) { panelTick = 0.5; placePanels(); } }
  if (!boardDrawn) { boardDrawn = true; drawBoard(); placeBoard(); }
  frames++;
}
function tick(dt) {
  const was = inStudio; inStudio = ENV.inStudio();
  if (!inStudio) { if (was) { abort('left the studio'); state.duckT = 0; try { ENV.flatDuck(0); } catch (e) {} root.visible = false; for (const s of ['L', 'R']) glove[s].obj.visible = false; if (BL.m) BL.m.visible = false; ENV.setHide({ models: false, rays: false }); ui(); } return; }
  if (!was) { root.visible = true; skin = gloveSkin(); applySkin(gloveState().on); drawBoard(); toTitle(); }
  update(Math.min(dt, 0.1) * (window.__nkSpeed ?? 1));
}
root.visible = false; toTitle();
// the saved choice is applied at load (the beam pre-warm then draws the rooftop like any other studio mesh)
if (!NO_ROOF && lsGet(SC_KEY, 'studio') === 'rooftop') setScenery('rooftop', { sync: true, noSave: true });
const api = {
  state, tick, startRound, endRound, toTitle, abort, pause, resume, resetRound, punch, duck, setDiff, menuAct, applySkin, scores, drawBoard, bestScore,
  get frames() { return frames; }, get inStudio() { return inStudio; }, get BPM() { return BPM; },
  events: () => state.events, menuOrbs, gloves, glove, board, panelL, panelR, PANEL_VR, BARS, targetPos,
  get mode() { return nkMode; }, setMode, get noShoot() { return NO_SHOOT; }, shootRay, get blaster() { return BL.m; }, blasterMuzzle(out) { if (BL.m && BL.m.visible && state.vr) placeBlaster(ENV.grip('right')); return BL.m && BL.m.visible && BL.muzzle ? BL.muzzle.getWorldPosition(out) : null; }, blasterBarrel(out) { return BL.m && BL.m.visible ? out.set(0, 0, 1).transformDirection(BL.m.matrixWorld) : null; },
  liveTargets() { return targets.filter(t => t.type !== 'BAR' && t.alive && !t.claimed).map(t => ({ type: t.type, p: toWorld(t.pos, new THREE.Vector3()).toArray(), r: t.r, dt: t.t - state.t })); },
  setScenery, get scenery() { return scenery; }, get sceneryWant() { return sceneryWant; }, scStats, get roofKit() { return roofKit; }, get noRoof() { return NO_ROOF; }, feet, mark, get feetShift() { return feetShift; },
  // vrtest-v20: menu orbs the VR pointer can aim at (vr.js pickTarget): world centre + radius + action
  pointOrbs() { if (state.mode === 'play' || !inStudio) return []; return menuOrbs.filter(o => o.g.visible).map(o => ({ id: o.id, p: toWorld(o.pos, new THREE.Vector3()), r: o.r * 1.15, act: () => menuAct(o.id) })); },
  orbWorld(id) { const o = menuOrbs.find(o => o.id === id); return o ? toWorld(o.pos, new THREE.Vector3()) : null; },
  targets: () => targets.filter(t => t.type !== 'BAR' && t.alive && !t.claimed).map(t => ({ type: t.type, dt: t.t - state.t, x: t.x })),
  bars: () => targets.filter(t => t.type === 'BAR' && t.alive).map(t => t.t - state.t),
  targetsW: () => targets.filter(t => t.type !== 'BAR' && t.alive && !t.claimed).map(t => ({ type: t.type, dt: t.t - state.t, p: toWorld(t.pos, new THREE.Vector3()).toArray() })),
  gloveWorld: s => glove[s].obj.getWorldPosition(new THREE.Vector3()).toArray(),
  skipTo(t) { state.t = t; state.evIdx = state.events.findIndex(e => e.t - t > -0.1); if (state.evIdx < 0) state.evIdx = state.events.length; targets.forEach(freeTarget); targets = []; lastSched = Math.floor(t / (BEAT / 4)); },
};
return api;
}
