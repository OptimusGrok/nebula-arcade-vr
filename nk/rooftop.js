// NEON KNOCKOUT · CYBERPUNK ROOFTOP scenery (vrtest-v20, Dave t503u). Built procedurally, no image files:
// sky dome (gradient + clouds + stars in the shader), a skyline of instanced towers whose lit windows are computed in the shader
// (no window texture), a wet roof slab with reflecting puddles (the mirrored neon under the floor shows through the puddles; the
// sky is reflected in the shader), parapet + railing + HVAC units + stairwell hut + water tank + antenna (ONE merged mesh),
// neon strips (ONE merged mesh, with dim mirrored copies for the puddles), neon signs from one 512x512 canvas atlas (ONE mesh),
// light rain (ONE LineSegments animated in the vertex shader). No lights, no shadows. dispose() frees every GPU resource.
import * as THREE from 'three';

// a tiny merger: non-indexed positions / colors / uvs (+ an optional float attribute) into one BufferGeometry
function Builder(withUV, extra) {
  const P = [], C = [], U = [], X = [];
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _n = new THREE.Vector3();
  return {
    // add(geo, {x,y,z, rx,ry,rz, sx,sy,sz, color, shade:true, uvRect:[u0,v0,u1,v1], x1: extra value, mirror:k})
    add(geo, o = {}) {
      const g = geo.index ? geo.toNonIndexed() : geo; const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e); _s.set(o.sx || 1, o.sy || 1, o.sz || 1); _p.set(o.x || 0, o.y || 0, o.z || 0);
      _m.compose(_p, _q, _s); _c.set(o.color == null ? 0xffffff : o.color); const k = o.k == null ? 1 : o.k;
      const reps = o.mirror ? 2 : 1;
      for (let r = 0; r < reps; r++) {
        for (let i = 0; i < pos.count; i++) {
          _n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(_m); if (r === 1) _n.y = -_n.y;
          P.push(_n.x, _n.y, _n.z);
          let f = k; if (o.shade !== false && nor) { const ny = nor.getY(i), nx = Math.abs(nor.getX(i)); f *= ny > 0.5 ? 1 : ny < -0.5 ? 0.35 : nx > 0.5 ? 0.62 : 0.78; }
          if (r === 1) f *= o.mirror;
          C.push(_c.r * f, _c.g * f, _c.b * f);
          if (withUV) { const a = o.uvRect || [0, 0, 1, 1], u = uv ? uv.getX(i) : 0, v = uv ? uv.getY(i) : 0; U.push(a[0] + (a[2] - a[0]) * u, a[1] + (a[3] - a[1]) * v); }
          if (extra) X.push(o.x1 || 0);
        }
      }
      if (g !== geo) g.dispose(); geo.dispose();
    },
    build() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      if (withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); if (extra) g.setAttribute(extra, new THREE.Float32BufferAttribute(X, 1)); g.computeBoundingSphere(); return g; },
  };
}

const NOISE = 'float h1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h1(i),h1(i+vec2(1,0)),f.x),mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x),f.y);}';
// sky colour by direction height (shared by the dome and the puddle reflections)
const SKY = 'vec3 skyC(float y){vec3 top=vec3(0.015,0.008,0.05),mid=vec3(0.075,0.02,0.14),hor=vec3(0.36,0.07,0.25);vec3 c=mix(hor,mid,smoothstep(0.0,0.28,y));c=mix(c,top,smoothstep(0.28,0.85,y));c+=vec3(0.95,0.35,0.22)*exp(-abs(y)*16.)*0.35;if(y<0.)c=mix(c,vec3(0.06,0.02,0.07),smoothstep(0.,-0.35,y));return c;}';
export const ROOF_FOG = new THREE.Color(0.19, 0.045, 0.16);

// slice: true = build across several short tasks (one section per task) so no single frame pays the whole ~30 ms; false = all in this task
export async function buildRooftop({ glowTex, COL = { L: 0x18d8ff, R: 0xff2bd6 }, slice = false }) {
  const brk = () => slice ? new Promise(r => setTimeout(r, 0)) : null;
  const group = new THREE.Group(); group.name = 'nkRooftop';
  const mats = [], geos = [], texs = [], uT = { value: 0 }, uBeat = { value: 0 }, uPow = { value: 0 };
  const own = (m) => { mats.push(m); return m; };
  const add = (geo, mat, name, ro) => { geos.push(geo); const m = new THREE.Mesh(geo, mat); m.name = name; if (ro != null) m.renderOrder = ro; group.add(m); return m; };
  const rnd = (() => { let s = 1337; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();   // seeded: the same skyline every time

  // ---- sky dome (r 108: inside the camera's 120 m far plane) ----
  const skyMat = own(new THREE.ShaderMaterial({ uniforms: { uT },
    vertexShader: 'varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform float uT;varying vec3 vD;' + NOISE + SKY + 'void main(){vec3 d=normalize(vD);vec3 c=skyC(d.y);'
      + 'if(d.y>0.){vec2 q=d.xz/(d.y+0.25)*1.6;float cl=vn(q+vec2(uT*0.015,0.))*0.65+vn(q*2.3-vec2(uT*0.01,0.))*0.35;cl=smoothstep(0.45,0.85,cl)*smoothstep(0.02,0.25,d.y)*(1.-smoothstep(0.5,0.9,d.y));c=mix(c,vec3(0.32,0.08,0.28)*(0.6+0.4*(1.-d.y)),cl*0.55);'
      + 'vec2 sg=floor(d.xz/(d.y+0.4)*260.);float st=step(0.9965,h1(sg))*smoothstep(0.3,0.7,d.y)*(1.-cl);c+=st*vec3(0.7,0.75,1.)*(0.5+0.5*sin(uT*2.+h1(sg+3.)*30.));}'
      + 'gl_FragColor=vec4(c,1.);}',
    side: THREE.BackSide, depthWrite: false, fog: false }));
  const sky = add(new THREE.SphereGeometry(108, 32, 16), skyMat, 'nkRoofSky', -10); sky.frustumCulled = false;

  await brk();
  // ---- skyline: instanced towers, windows computed in the shader ----
  const towerMat = own(new THREE.ShaderMaterial({ uniforms: { uT, uFog: { value: ROOF_FOG } },
    vertexShader: 'varying vec3 vL;varying vec3 vN;varying vec3 vS;varying vec3 vW;varying float vH;void main(){mat4 im=instanceMatrix;vec3 sc=vec3(length(im[0].xyz),length(im[1].xyz),length(im[2].xyz));vL=position*sc;vH=sc.y*0.5;vN=normal;\n'
      + '#ifdef USE_INSTANCING_COLOR\nvS=instanceColor;\n#else\nvS=vec3(0.5);\n#endif\nvec4 w=modelMatrix*im*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: 'uniform float uT;uniform vec3 uFog;varying vec3 vL;varying vec3 vN;varying vec3 vS;varying vec3 vW;varying float vH;' + NOISE
      + 'void main(){vec3 n=abs(vN);vec3 col=vec3(0.018,0.014,0.032);'
      + 'if(n.y<0.5){float u=n.x>0.5?vL.z:vL.x;vec2 g=vec2(u/1.7,vL.y/2.6);vec2 cell=floor(g),f=fract(g);'
      + 'float win=step(0.2,f.x)*step(f.x,0.8)*step(0.28,f.y)*step(f.y,0.78);float r=h1(cell+vS.xy*97.+n.x*13.);float lit=step(1.-vS.z,r);'
      + 'vec3 wc=mix(vec3(1.,0.68,0.32),vec3(0.45,0.8,1.),step(0.55,h1(cell*1.7+3.)));wc=mix(wc,vec3(1.,0.3,0.85),step(0.93,h1(cell*2.3+7.)));'
      + 'float fl=step(0.985,h1(cell+floor(uT*0.5)));col+=win*lit*wc*(0.35+0.4*h1(cell+11.))*(1.-fl*0.8);'
      + 'vec3 acc=vS.x>0.66?vec3(1.,0.17,0.84):vS.x>0.33?vec3(0.09,0.85,1.):vec3(0.62,0.3,1.);float band=step(vH-0.9,vL.y)*step(vL.y,vH-0.45);col=mix(col,acc*1.4,band*step(0.35,vS.y));'
      + 'float stripe=step(0.8,vS.y)*smoothstep(0.12,0.,abs(fract(u/6.)-0.5)-0.38);col+=acc*stripe*0.5*step(-vH*0.6,vL.y);}'
      + 'else{col+=vec3(0.03,0.02,0.05);}'
      + 'float d=length(vW-cameraPosition);float fg=1.-exp(-pow(d*0.0105,2.));col=mix(col,uFog,fg);col=mix(col,uFog*1.15,smoothstep(-10.,-45.,vW.y)*0.85);gl_FragColor=vec4(col,1.);}',
    fog: false }));
  const towers = []; // [x, z, w, d, top]
  const hero = [];
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2, r = 40 + Math.pow(rnd(), 0.8) * 56; let x = Math.cos(a) * r, z = Math.sin(a) * r - 8;
    if (Math.hypot(x, z) > 99) { const s = 99 / Math.hypot(x, z); x *= s; z *= s; }
    if (Math.abs(x) < 14 && z > -44 && z < 14) continue;   // keep clear of the roof
    const w = 6 + rnd() * 12, d = 6 + rnd() * 12, top = -8 + rnd() * rnd() * 62 + (r > 70 ? 10 : 0);
    towers.push([x, z, w, d, top]);
  }
  // a few close "hero" towers carrying big signs
  [[-24, -46, 12, 12, 34], [26, -52, 14, 12, 42], [-38, -14, 10, 14, 22], [36, -6, 12, 12, 28], [4, -66, 16, 12, 52]].forEach(t => { towers.push(t); hero.push(t); });
  const tower = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMat, towers.length); tower.name = 'nkRoofTowers'; geos.push(tower.geometry);
  const _m = new THREE.Matrix4(), _c = new THREE.Color();
  towers.forEach(([x, z, w, d, top], i) => { const bot = -70, h = top - bot; _m.makeScale(w, h, d).setPosition(x, bot + h / 2, z); tower.setMatrixAt(i, _m); _c.setRGB(rnd(), rnd(), 0.22 + rnd() * 0.3); tower.setColorAt(i, _c); });
  tower.instanceMatrix.needsUpdate = true; if (tower.instanceColor) tower.instanceColor.needsUpdate = true; tower.computeBoundingSphere(); tower.frustumCulled = false; group.add(tower);

  await brk();
  // ---- the roof slab: wet concrete, reflecting puddles, the play lanes + ring kept (same look as the studio floor's cues) ----
  const roofMat = own(new THREE.ShaderMaterial({ uniforms: { uT, uBeat, uPow, uFog: { value: ROOF_FOG }, uO: { value: new THREE.Vector3() } },
    vertexShader: 'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: 'uniform float uT;uniform float uBeat;uniform float uPow;uniform vec3 uFog;uniform vec3 uO;varying vec3 vW;' + NOISE + SKY
      + 'void main(){vec3 L=vW-uO;vec2 p=L.xz;'
      + 'vec2 g=abs(fract(p/1.5)-0.5);float seam=smoothstep(0.03,0.0,min(g.x,g.y));float n=vn(p*1.3)*0.6+vn(p*5.)*0.4;'
      + 'vec3 col=vec3(0.045,0.044,0.06)*(0.65+0.55*n)-seam*0.018;'
      + 'float pd=smoothstep(0.56,0.63,vn(p*0.33+3.)*0.7+vn(p*1.15)*0.3);'   // puddles
      + 'vec3 V=normalize(vW-cameraPosition);vec3 R=reflect(V,vec3(0.,1.,0.));float fr=pow(1.-abs(V.y),3.);vec3 sk=skyC(R.y);'
      + 'vec2 rc=floor(p*1.6),rl=fract(p*1.6)-0.5-(vec2(h1(rc),h1(rc+5.))-0.5)*0.5;float rt=fract(uT*0.9+h1(rc+9.));float rip=smoothstep(0.035,0.,abs(length(rl)-rt*0.42))*(1.-rt);'
      + 'col=mix(col,col*0.35+sk*(0.18+0.55*fr)+rip*0.06,pd);col+=sk*fr*0.07*(1.-pd);'
      // the studio floor's play cues, kept: the two lanes, the beat ring, the hot glow ahead
      + 'float d=length(p-vec2(0.,-1.5));float lane=smoothstep(0.06,0.0,abs(abs(p.x)-0.95));float flow=0.5+0.5*sin(p.y*1.4+uT*9.);'
      + 'col+=lane*mix(vec3(0.1,0.85,1.0),vec3(1.0,0.2,0.85),step(0.,p.x))*(0.45+0.4*flow)*exp(-max(0.,-p.y)*0.04)*0.8;'
      + 'vec3 hot=mix(vec3(0.55,0.05,0.85),vec3(1.0,0.75,0.2),uPow);col+=hot*0.14*exp(-d*0.45)*(0.6+0.6*uBeat);'
      + 'float ring=smoothstep(0.05,0.0,abs(length(p)-1.25-uBeat*0.15));col+=ring*vec3(0.2,0.6,1.)*0.35;'
      + 'float fg=1.-exp(-pow(length(vW-cameraPosition)*0.02,2.));col=mix(col,uFog,fg);'
      + 'gl_FragColor=vec4(col,mix(mix(0.97,0.42,pd),1.,fg));}',
    transparent: true, depthWrite: false }));
  const roof = add(new THREE.PlaneGeometry(17, 44), roofMat, 'nkRoofSlab', -1); roof.rotation.x = -Math.PI / 2; roof.position.set(0, 0.002, -15);
  const X0 = 8.5, Z0 = 7, Z1 = -37;

  await brk();
  // ---- solid props: ONE merged mesh (vertex colours, no lighting) ----
  const S = Builder(false);
  const box = (w, h, d, x, y, z, color, o = {}) => S.add(new THREE.BoxGeometry(w, h, d), Object.assign({ x, y, z, color }, o));
  const cyl = (rt, rb, h, x, y, z, color, o = {}) => S.add(new THREE.CylinderGeometry(rt, rb, h, o.seg || 12), Object.assign({ x, y, z, color }, o));
  const WALL = 0x2a2634, CAP = 0x3b3646, MET = 0x4a4e5a, DARK = 0x16141c;
  // parapet + cap
  box(0.32, 1.0, Z0 - Z1, -X0, 0.5, (Z0 + Z1) / 2, WALL); box(0.32, 1.0, Z0 - Z1, X0, 0.5, (Z0 + Z1) / 2, WALL);
  box(2 * X0 + 0.32, 1.0, 0.32, 0, 0.5, Z1, WALL); box(2 * X0 + 0.32, 1.0, 0.32, 0, 0.5, Z0, WALL);
  box(0.42, 0.08, Z0 - Z1 + 0.1, -X0, 1.04, (Z0 + Z1) / 2, CAP); box(0.42, 0.08, Z0 - Z1 + 0.1, X0, 1.04, (Z0 + Z1) / 2, CAP);
  box(2 * X0 + 0.42, 0.08, 0.42, 0, 1.04, Z1, CAP); box(2 * X0 + 0.42, 0.08, 0.42, 0, 1.04, Z0, CAP);
  // the building below the roof (outer walls only, facing out)
  [[-X0 - 0.16, Math.PI / 2, Z0 - Z1, (Z0 + Z1) / 2], [X0 + 0.16, -Math.PI / 2, Z0 - Z1, (Z0 + Z1) / 2]].forEach(([x, ry, w, z]) => S.add(new THREE.PlaneGeometry(w, 30), { x: x, y: -15, z, ry: ry + Math.PI, color: 0x100d16, shade: false }));
  S.add(new THREE.PlaneGeometry(2 * X0, 30), { x: 0, y: -15, z: Z1 - 0.16, ry: Math.PI, color: 0x100d16, shade: false });
  // railing: posts every 2 m + a top rail on the two long sides and the back
  for (let z = Z0 - 1; z > Z1; z -= 2) [-1, 1].forEach(s => box(0.05, 0.55, 0.05, s * X0, 1.35, z, MET));
  for (let x = -X0 + 1; x < X0; x += 2) box(0.05, 0.55, 0.05, x, 1.35, Z1, MET);
  [-1, 1].forEach(s => box(0.06, 0.06, Z0 - Z1, s * X0, 1.64, (Z0 + Z1) / 2, MET)); box(2 * X0, 0.06, 0.06, 0, 1.64, Z1, MET);
  await brk();
  // HVAC units (with fan housings, grilles, ducts to the parapet)
  [[-6.3, -6], [6.2, -9], [-6.4, -17.5], [6.0, -21], [-5.9, -28], [6.3, -31]].forEach(([x, z], i) => {
    const w = 1.7, h = 1.1 + (i % 2) * 0.25, d = 1.3; box(w, h, d, x, h / 2, z, MET); box(w + 0.06, 0.06, d + 0.06, x, h, z, CAP);
    cyl(0.42, 0.42, 0.16, x - 0.3 * Math.sign(x), h + 0.08, z, DARK, { seg: 16 }); cyl(0.05, 0.05, 0.18, x - 0.3 * Math.sign(x), h + 0.09, z, MET, { seg: 6 });
    for (let k = 0; k < 5; k++) box(0.02, h * 0.6, 0.04, x - Math.sign(x) * (w / 2 + 0.01), h * 0.5, z - d / 2 + 0.2 + k * 0.22, DARK);
    box(Math.abs(Math.abs(x) - X0) - w / 2, 0.35, 0.35, Math.sign(x) * (X0 + Math.abs(x) + w / 2) / 2, 0.6, z + 0.2, 0x3a3d48);
  });
  await brk();
  // stairwell hut (front-left) with a door
  box(3.0, 2.8, 3.2, -6.4, 1.4, 3.6, WALL); box(3.2, 0.12, 3.4, -6.4, 2.86, 3.6, CAP); box(0.06, 2.1, 1.0, -4.88, 1.05, 3.4, DARK);
  // water tank on legs (back-right)
  [[5.3, -33.4], [7.0, -33.4], [5.3, -35.1], [7.0, -35.1]].forEach(([x, z]) => box(0.12, 2.2, 0.12, x, 1.1, z, MET));
  cyl(1.25, 1.25, 2.4, 6.15, 3.4, -34.25, 0x3a2e2a, { seg: 20 }); S.add(new THREE.ConeGeometry(1.35, 0.7, 20), { x: 6.15, y: 4.95, z: -34.25, color: 0x2a2220 });
  for (let k = 0; k < 4; k++) S.add(new THREE.TorusGeometry(1.27, 0.03, 4, 24), { x: 6.15, y: 2.5 + k * 0.6, z: -34.25, rx: Math.PI / 2, color: 0x241c1a, shade: false });
  // antenna mast (back-left) with cross bars and a dish
  box(0.14, 12, 0.14, -6.6, 6, -34.5, MET); for (let k = 1; k < 6; k++) box(1.6 - k * 0.2, 0.05, 0.05, -6.6, k * 2, -34.5, MET);
  [[-0.7, 0], [0.7, 0], [0, 0.7]].forEach(([dx, dz]) => S.add(new THREE.CylinderGeometry(0.02, 0.02, 7.2, 4), { x: -6.6 + dx * 0.5, y: 3.5, z: -34.5 + dz * 0.5, rz: -dx * 0.1, rx: dz * 0.1, color: MET }));
  S.add(new THREE.SphereGeometry(0.9, 14, 6, 0, Math.PI * 2, 0, 1.0), { x: -5.4, y: 1.6, z: -31.8, rx: -1.1, ry: 0.6, color: 0x8a8e98 }); box(0.1, 1.4, 0.1, -5.4, 0.7, -31.8, MET);
  await brk();
  // pipes along the left parapet + a cable tray on the right
  cyl(0.12, 0.12, Z0 - Z1 - 1, -X0 + 0.35, 0.22, (Z0 + Z1) / 2, 0x3a3440, { rx: Math.PI / 2, seg: 8 }); cyl(0.07, 0.07, Z0 - Z1 - 1, -X0 + 0.62, 0.15, (Z0 + Z1) / 2, 0x4a3a30, { rx: Math.PI / 2, seg: 8 });
  box(0.3, 0.1, Z0 - Z1 - 2, X0 - 0.45, 0.12, (Z0 + Z1) / 2, 0x2c2f38);
  // billboard frame at the back + side sign frames
  [-5.2, 5.2].forEach(x => box(0.25, 9.5, 0.25, x, 4.75, Z1 - 0.6, MET)); box(10.8, 0.2, 0.3, 0, 6.6, Z1 - 0.6, MET); box(10.8, 2.9, 0.12, 0, 8.15, Z1 - 0.72, DARK);
  box(0.12, 5.6, 1.5, -X0 - 0.35, 4.3, -14, DARK); box(0.12, 5.6, 1.5, X0 + 0.35, 4.3, -22, DARK);
  [[-X0 - 0.35, -14], [X0 + 0.35, -22]].forEach(([x, z]) => box(0.1, 1.6, 0.1, x, 0.8, z, MET));
  const props = add(S.build(), own(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })), 'nkRoofProps');

  await brk();
  // ---- neon tubes: ONE merged mesh, dim mirrored copies (y -> -y) for the puddles ----
  const N = Builder(false);
  const tube = (w, h, d, x, y, z, color, k = 1.5, mirror = 0.45) => N.add(new THREE.BoxGeometry(w, h, d), { x, y, z, color, k, shade: false, mirror });
  tube(0.05, 0.05, Z0 - Z1, -X0 + 0.2, 1.1, (Z0 + Z1) / 2, COL.L); tube(0.05, 0.05, Z0 - Z1, X0 - 0.2, 1.1, (Z0 + Z1) / 2, COL.R);
  tube(2 * X0 - 0.4, 0.05, 0.05, 0, 1.1, Z1 + 0.2, 0x9a5bff);
  tube(0.03, 0.03, Z0 - Z1, -X0, 1.68, (Z0 + Z1) / 2, COL.L, 0.9, 0.3); tube(0.03, 0.03, Z0 - Z1, X0, 1.68, (Z0 + Z1) / 2, COL.R, 0.9, 0.3);
  // billboard outline
  tube(10.9, 0.07, 0.07, 0, 9.65, Z1 - 0.64, COL.R, 1.8); tube(10.9, 0.07, 0.07, 0, 6.68, Z1 - 0.64, COL.L, 1.8);
  [-5.45, 5.45].forEach(x => tube(0.07, 3.0, 0.07, x, 8.15, Z1 - 0.64, 0xffffff, 1.2));
  // side sign outlines
  [[-X0 - 0.27, -14, COL.L], [X0 + 0.27, -22, COL.R]].forEach(([x, z, c]) => { tube(0.05, 5.7, 0.05, x, 4.3, z - 0.78, c, 1.8); tube(0.05, 5.7, 0.05, x, 4.3, z + 0.78, c, 1.8); tube(0.05, 0.05, 1.6, x, 7.15, z, c, 1.8); tube(0.05, 0.05, 1.6, x, 1.45, z, c, 1.8); });
  await brk();
  // hut: door light + roof edge strip; HVAC status LEDs; tank ring
  tube(0.5, 0.06, 0.1, -4.85, 2.3, 3.4, 0xffc070, 2, 0.5); tube(3.2, 0.04, 0.04, -6.4, 2.93, 2.0, COL.R, 1.4);
  [[-6.3, -6], [6.2, -9], [-6.4, -17.5], [6.0, -21], [-5.9, -28], [6.3, -31]].forEach(([x, z], i) => tube(0.03, 0.06, 0.12, x - Math.sign(x) * 0.87, 0.85, z + 0.4, i % 2 ? 0x55ff88 : 0xff4455, 2, 0));
  N.add(new THREE.TorusGeometry(1.3, 0.035, 4, 32), { x: 6.15, y: 4.55, z: -34.25, rx: Math.PI / 2, color: COL.L, k: 1.6, shade: false, mirror: 0.4 });
  // antenna tip lights
  for (let k = 1; k < 6; k++) tube(0.08, 0.08, 0.08, -6.6 + (0.8 - k * 0.1), k * 2, -34.5, 0xff3344, 1.6, 0);
  const neon = add(N.build(), own(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide })), 'nkRoofNeon');

  await brk();
  // ---- neon signs: one 512x512 canvas atlas, 8 strips; ONE additive mesh (+ mirrored copies) with a per-sign flicker ----
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const g = cv.getContext('2d');
  const WORDS = [['NEON KNOCKOUT', '#ffffff', '#ff2bd6'], ['RAMEN 24H', '#ffd0f4', '#ff2bd6'], ['CYBER GYM', '#d8fbff', '#18d8ff'], ['KO CLUB', '#fff3c0', '#ffb02b'],
    ['HOTEL', '#ffd0d8', '#ff3355'], ['ARCADE', '#d8fbff', '#18d8ff'], ['BAR · OPEN', '#e8d8ff', '#9a5bff'], ['NEBULA', '#ffffff', '#7fffd4']];
  WORDS.forEach(([t, fill, glow], i) => { const y = i * 64 + 32; g.font = '900 44px system-ui,Arial Black,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(t).width; if (tw > 480) g.font = '900 ' + Math.floor(44 * 480 / tw) + 'px system-ui,Arial Black,sans-serif';
    g.shadowColor = glow; g.shadowBlur = 14; g.fillStyle = glow; g.fillText(t, 256, y); g.shadowBlur = 4; g.fillStyle = fill; g.fillText(t, 256, y); });
  const atlas = new THREE.CanvasTexture(cv); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 2; texs.push(atlas);
  await brk();
  const row = i => [0, 1 - (i + 1) / 8, 1, 1 - i / 8];
  const G = Builder(true, 'aF');
  const sign = (i, w, x, y, z, ry, rz = 0, mirror = 0.5, fl = 0) => G.add(new THREE.PlaneGeometry(w, w / 8), { x, y, z, ry, rz, uvRect: row(i), shade: false, mirror, x1: fl });
  sign(0, 10.4, 0, 8.15, Z1 - 0.65, 0, 0, 0.55, 0);
  sign(1, 5.2, -X0 - 0.27, 4.3, -14, Math.PI / 2, Math.PI / 2, 0.5, 0.31);
  sign(2, 5.2, X0 + 0.27, 4.3, -22, -Math.PI / 2, -Math.PI / 2, 0.5, 0.57);
  // the hero towers' signs (face toward the roof)
  hero.forEach(([x, z, w, d, top], i) => { const wd = Math.min(14, (Math.abs(x) > Math.abs(z) ? d : w) * 0.95) * 1.2, yy = top - 4 - (i % 2) * 6;
    if (Math.abs(x) > Math.abs(z)) sign(3 + i, wd, x - Math.sign(x) * (w / 2 + 0.3), yy, z, -Math.sign(x) * Math.PI / 2, 0, 0, 0.13 + i * 0.21);
    else sign(3 + i, wd, x, yy, z - Math.sign(z) * (d / 2 + 0.3), z < 0 ? 0 : Math.PI, 0, 0, 0.13 + i * 0.21); });
  sign(7, 2.4, -6.4, 3.25, 2.0, Math.PI, 0, 0.5, 0.77);   // hut sign
  const signMat = own(new THREE.ShaderMaterial({ uniforms: { map: { value: atlas }, uT, uFog: { value: ROOF_FOG } },
    vertexShader: 'attribute float aF;attribute vec3 color;varying vec2 vU;varying float vF;varying vec3 vK;varying vec3 vW;void main(){vU=uv;vF=aF;vK=color;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: 'uniform sampler2D map;uniform float uT;uniform vec3 uFog;varying vec2 vU;varying float vF;varying vec3 vK;varying vec3 vW;float h1(float x){return fract(sin(x*91.7)*43758.5);}'
      + 'void main(){vec4 t=texture2D(map,vU);float fl=vF>0.?(step(0.07,h1(floor(uT*9.+vF*50.)+vF))*0.75+0.25):1.;fl=mix(1.,fl,step(0.9,h1(floor(uT*0.7+vF*13.))));'
      + 'float d=length(vW-cameraPosition);float fg=1.-exp(-pow(d*0.009,2.));gl_FragColor=vec4(t.rgb*t.a*vK*fl*(1.-fg*0.7)*1.25,1.);}',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const signs = add(G.build(), signMat, 'nkRoofSigns', 1);

  await brk();
  // ---- light rain: ONE LineSegments, the fall is animated in the vertex shader ----
  const RN = 1100, rp = new Float32Array(RN * 6), re = new Float32Array(RN * 2);
  for (let i = 0; i < RN; i++) { const x = (rnd() - 0.5) * 17, y = rnd() * 14, z = Z0 - rnd() * (Z0 - Z1); rp.set([x, y, z, x, y, z], i * 6); re[i * 2] = 0; re[i * 2 + 1] = 1; }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rg.setAttribute('aE', new THREE.BufferAttribute(re, 1));
  const rainMat = own(new THREE.ShaderMaterial({ uniforms: { uT },
    vertexShader: 'uniform float uT;attribute float aE;varying float vA;void main(){vec3 p=position;p.y=mod(p.y-uT*10.5,14.)-0.6+aE*0.34;p.x+=aE*0.05;vA=1.-aE*0.85;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
    fragmentShader: 'varying float vA;void main(){gl_FragColor=vec4(vec3(0.42,0.52,0.78)*0.3*vA,1.);}',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  geos.push(rg); const rain = new THREE.LineSegments(rg, rainMat); rain.name = 'nkRoofRain'; rain.frustumCulled = false; group.add(rain);

  // ---- antenna beacon + tank glow: two sprites (the studio's existing sprite shader + glow texture) ----
  const beacons = [[-6.6, 12.15, -34.5, 0xff2233, 1.6], [6.15, 5.4, -34.25, 0xff2233, 1.0]].map(([x, y, z, c, s]) => { const m = own(new THREE.SpriteMaterial({ map: glowTex, color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true }));
    const sp = new THREE.Sprite(m); sp.scale.set(s, s, 1); sp.position.set(x, y, z); sp.name = 'nkRoofBeacon'; group.add(sp); return sp; });

  let disposed = false;
  return {
    group, roofMat,
    update(dt, clock, beat, pow, origin) { uT.value = clock; uBeat.value = beat; uPow.value += ((pow ? 1 : 0) - uPow.value) * Math.min(1, dt * 3); roofMat.uniforms.uO.value.copy(origin);
      const on = (clock % 1.6) < 0.18; beacons[0].material.opacity = on ? 1 : 0.12; beacons[1].material.opacity = ((clock + 0.8) % 1.6) < 0.18 ? 1 : 0.1; },
    stats() { return { meshes: group.children.length, towers: towers.length, rain: RN, atlas: '512x512', tris: [props, neon, signs].reduce((a, m) => a + m.geometry.attributes.position.count / 3, 0) }; },
    dispose() { if (disposed) return; disposed = true; group.removeFromParent(); for (const gq of geos) gq.dispose(); for (const m of mats) m.dispose(); for (const t of texs) t.dispose(); },
  };
}
