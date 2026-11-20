// Nebula Arcade VR - WebXR for Meta Quest Browser (and any WebXR headset).
// ENTER VR on the arcade floor -> the headset is the camera at real-world scale (1 unit = 1 m; cabinets are life size).
//   LEFT STICK   smooth walk where you look (same wall / cabinet collision as the flat game)
//   RIGHT STICK  left/right = smooth turn; the further you push, the faster (deadzone 0.15, x^2 curve, max 90 deg/s) (t350u)
//   R STICK CLICK  (button 3) holographic laser fire-type menu above the right controller; stick moves the highlight, A selects, click again closes (t489u)
//   L STICK CLICK  hide / show the left-wrist HUD (battery, time, player count)
//   TRIGGER      point at a cabinet = play it; point at the floor = teleport there; point at a sign / menu button = press it
//   Y / B        MENU: BEAM TO SHOP / ARCADE (teleporter), BUY TICKETS (ticket exchange), PRIZE SHOP, NEON BRICKS
//   signs        BUY TICKETS over the kiosk, SHOP / NEON KNOCKOUT pad labels (press to beam), BEAM TO ARCADE over the shop / studio pads, PRIZE SHOP over the shop counter,
//                NEON BRICKS by the window game (point at the window + trigger = play; sticks move, A/X/trigger rotate, B/Y drop, hold grip = leave)
//   in a game    the cabinet's game shows on a big screen in front of you. A/X = insert tickets / start, then the
//                game's buttons (sticks = arrows, A/X = fire / primary, B/Y = secondary or CONTINUE, trigger = fire or tap
//                the screen where you point), HOLD GRIP = leave the machine.
// The player rig is an offset XR reference space (renderer.xr.setReferenceSpace), so camera.position and the controller
// objects stay in world coordinates for the rest of the arcade code.
import * as THREE from 'three';
import { createVRChess } from './vrchess.js';   // v17 immersive VR chess
import { Reflector } from 'three/addons/objects/Reflector.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { loadPicture } from './texload.js';   // vrtest-v4: prebuilt icon sheet (KTX2 / webp)

const NAMES = { strike: 'STRIKE', ghost: 'GHOST 256', monkey: 'MONKEY CROSSING', berserker: 'BERSERKER', orc: 'ORC ATTACK', cyber: 'CYBERCITY', blaster: 'BLASTER', pip: 'SUPER PIP QUEST', bb: 'BURROW BUSTER', rockfall: 'ROCKFALL RUSH', skytower: 'SKY TOWER', nova: 'NOVA TETHER', claw: 'CLAW MACHINE', roadster: 'MARS ROADSTER', ds: 'DEAD SIGNAL' };
const SIGN_MAX = 30, TURN_DZ = 0.15, TURN_MAX = Math.PI / 2, SPEED = 2.2, RAY_MAX = 12, GRIP_EXIT_S = 0.6;
const KEYNAME = { KeyL: 'l', KeyB: 'b', KeyO: 'o', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', Space: ' ', Enter: 'Enter', KeyZ: 'z', KeyX: 'x', KeyP: 'p', KeyJ: 'j', KeyF: 'f', KeyE: 'e', ShiftLeft: 'Shift', KeyC: 'c' };
const KEYCODE = { KeyL: 76, KeyB: 66, KeyO: 79, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32, Enter: 13, KeyZ: 90, KeyX: 88, KeyP: 80, KeyJ: 74, KeyF: 70, KeyE: 69, ShiftLeft: 16, KeyC: 67 };
// what each cabinet's buttons send into its game iframe (a = A/X, b = B/Y; trig: 'a' = same as A, 'ptr' = tap the screen where the ray points)
const MAPS = {
  // v21 (Dave): A = HYPER SPEED (the game's C key), B = BOMB (X key), trigger = FIRE; pointing at the game's bottom-right HYPER SPEED / BOMB
  // buttons and pulling the trigger taps them instead of firing (btnAt asks the game which button is under the ray)
  strike: { a: ['KeyC'], b: ['KeyX'], trig: 'keys', trigKeys: ['KeyZ'], btnAt: '__strikeBtnAt', help: 'STICK FLY · TRIGGER FIRE · A HYPER SPEED · B BOMB' },
  // t353u: Berserker's power-ups are HTML buttons on the right that appear when ready (THOR at 100 energy, BERSERK and ODIN after their timers).
  // VR: A/B/trigger only on the RIGHT controller (attack / dash); each power-up gets its own free button, shown on a button beside the screen on the right.
  // t358u (Dave): A = DASH (always shown on the right), B = THOR, X = BERSERK, Y = ODIN; trigger = attack; hold grip = leave
  berserker: { a: ['Space'], b: [], trig: 'keys', trigKeys: ['KeyJ'], handAB: 'right', help: 'STICK MOVE · TRIGGER ATTACK · A DASH · B THOR · X BERSERK · Y ODIN',
    pw: [{ id: 'dash', name: 'DASH', code: 'Space', btn: 'A', el: 'bD', always: true }, { id: 'thor', name: 'THOR', code: 'KeyL', btn: 'B', el: 'thor' }, { id: 'rage', name: 'BERSERK', code: 'KeyB', btn: 'X', el: 'bRg' }, { id: 'odin', name: 'ODIN', code: 'KeyO', btn: 'Y', el: 'bOd' }] },
  ghost: { a: ['Space'], b: [], trig: 'a', help: 'STICK STEER · A START' },
  claw: { a: ['Enter', 'Space'], b: [], trig: 'ptr', help: 'STICK MOVE · A DROP · TRIGGER TAPS' },
  orc: { a: [], b: [], trig: 'ptr', help: 'POINT + TRIGGER TO TAP THE SCREEN' },
  // t354u (Dave): left stick moves, right stick pans the camera (the game's own lookDrag), X/A = jetpack (hold Space), Y/B/trigger = laser (hold F: charge, release = shot)
  skytower: { a: ['Space'], b: ['KeyF'], trig: 'b', moveStick: 'left', pan: '__skytower', help: 'L-STICK MOVE · R-STICK CAMERA · A/X FLY · B/Y LASER' },
  roadster: { a: ['Space'], b: [], trig: 'a', help: 'STICK STEER / GAS · A ACTION' },
  nova: { a: ['Space', 'KeyZ'], b: ['ShiftLeft'], trig: 'a', help: 'STICK MOVE · A ACTION · B ALT' },
  ds: { a: ['Space', 'KeyE'], b: [], trig: 'a', help: 'STICK MOVE · A ACTION' },
  default: { a: ['Space', 'KeyZ'], b: ['KeyX'], trig: 'ptr', help: 'STICK MOVE · A/X ACTION · B/Y ALT · TRIGGER TAPS' },
};

export function setupVR(A) {
  const { renderer, scene, camera, monkey, st, play } = A;
  const S = window.__gaVR = {
    presenting: false, supported: false, pwFired: {}, pwShown: {}, mirrorKicks: 0, wardPicks: 0, wardBuys: 0, starts: 0, ends: 0, frames: 0, snaps: 0, turnRate: 0, turnSum: 0, turnTime: 0, turnMaxStep: 0, beams: 0, ticketBuys: 0, collected: 0, shopBuys: 0, nbStarts: 0, nbRot: 0, nbDrops: 0, nbExits: 0, panels: {}, teleports: 0, launches: 0, exits: 0, keysSent: 0, ptrSent: 0, texUploads: 0, pumps: 0,
    rig: { x: 0, y: 0, z: 0, yaw: 0 }, head: null, hover: null, held: {}, maps: MAPS, lastKey: null, msg: '', msgT: 0,
  };
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _ray = new THREE.Ray(), _hit = new THREE.Vector3();
  let baseRef = null, session = null, saved = null;

  // ---------- ENTER VR button (flat page; only when the browser has an immersive-vr device) ----------
  const css = document.createElement('style');
  css.textContent = '#vrBtn{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 10px);transform:translateX(-50%);z-index:60;display:none;padding:10px 20px;border-radius:12px;border:2px solid #3ff3ff;background:#0a0618ee;color:#fff;font:900 16px/1 "Arial Black",Arial,sans-serif;letter-spacing:.08em;box-shadow:0 0 16px #3ff3ff88,inset 0 0 10px #ff3fd244;cursor:pointer}'
    + '#vrBtn.on{display:block}body.ingame #vrBtn{display:none!important}#vrBtn small{display:block;font:700 9px/1.3 "Courier New",monospace;color:#ffe14a;letter-spacing:.06em;margin-top:3px}'
    + 'body.vr>:not(canvas):not(iframe):not(script):not(style){visibility:hidden!important}';   // VR: the DOM HUD is not visible in the headset; the in-world ticket display replaces it
  document.head.appendChild(css);
  const btn = document.createElement('button'); btn.id = 'vrBtn'; btn.type = 'button'; btn.innerHTML = 'ENTER VR<small>META QUEST · WEBXR</small>'; document.body.appendChild(btn);
  for (const ev of ['pointerdown', 'touchstart', 'mousedown']) btn.addEventListener(ev, e => e.stopPropagation());
  btn.addEventListener('click', e => { e.stopPropagation(); enter(); });
  function checkSupport() { const xr = navigator.xr; if (!xr || !xr.isSessionSupported) { S.supported = false; return; }
    xr.isSessionSupported('immersive-vr').then(ok => { S.supported = !!ok; document.body.classList.toggle('gaQuestVR', !!ok && !!A.QUEST); }).catch(() => { S.supported = false; }); }
  window.__gaVRPlay = () => enter();   // v18: the start screen's PLAY on a Quest headset browser (called inside the click: requestSession needs the gesture)
  checkSupport(); if (navigator.xr && navigator.xr.addEventListener) navigator.xr.addEventListener('devicechange', checkSupport);
  setInterval(() => { const startUp = document.getElementById('start') && window.__start && window.__start.shown && !window.__start.dismissed;
    btn.classList.toggle('on', S.supported && !S.presenting && !startUp && play.mode === 'walk'); }, 300);
  async function enter() {
    if (S.presenting || !navigator.xr) return;
    try { const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'layers'] });
      try { renderer.xr.setFoveation(1); } catch (e) {}
      try { renderer.xr.setFramebufferScaleFactor(A.TIER && A.TIER.name === 'low' ? 0.85 : 1); } catch (e) {}   // t358u: low tier renders a bit smaller (set before the session)
      await renderer.xr.setSession(s);
    } catch (e) { console.warn('ENTER VR failed', e); S.lastError = String(e); }
  }
  S.enter = enter; S.exit = () => { try { session && session.end(); } catch (e) {} };
  // vrtest-v5 (Dave t462u): Y menu -> BACK TO TITLE SCREEN -> YES: end the XR session (three's sessionend releases held input, the
  // animation loop, avatar hands, game page pumping) and then do exactly what the flat HOME button does (play.home.go: leave any cabinet
  // game / demo, keys up, __startUI.show), so PLAY / PLAY ON SCREEN work again from the start screen.
  function toTitleFlat() { S.toTitles = (S.toTitles || 0) + 1; try { if (play.home && play.home.go) play.home.go(); else if (window.__startUI && window.__startUI.show) window.__startUI.show(); } catch (e) { S.lastError = String(e); } }
  function backToTitle() { uiClose(); if (S.presenting && session) { S.toTitle = true; try { releaseAll(); } catch (e) {} try { session.end(); } catch (e) { S.toTitle = false; toTitleFlat(); } } else toTitleFlat(); }
  S.backToTitle = backToTitle;

  // ---------- controllers: ray + simple built-in model (Quest models load from the WebXR input-profile CDN when online) ----------
  const ctrls = [], grips = [];
  const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const factory = window.__gavrNoModels ? null : new XRControllerModelFactory();
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i); c.name = 'vrController' + i;
    const ray = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0x3ff3ff, transparent: true, opacity: 0.85, fog: false, toneMapped: false }));
    ray.name = 'vrRay'; ray.scale.z = 3; ray.frustumCulled = false; c.add(ray); c.userData.ray = ray;
    c.addEventListener('connected', e => { c.userData.src = e.data; c.userData.hand = e.data && e.data.handedness; });
    c.addEventListener('disconnected', () => { c.userData.src = null; c.userData.hand = null; });
    scene.add(c); ctrls.push(c);
    const g = renderer.xr.getControllerGrip(i); g.name = 'vrGrip' + i;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.11, 12).rotateX(Math.PI / 2 - 0.5), new THREE.MeshBasicMaterial({ color: 0x1a1030, fog: false }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.006, 6, 20), new THREE.MeshBasicMaterial({ color: 0xff3fd2, fog: false, toneMapped: false })); ring.position.set(0, 0.012, -0.03); ring.rotation.x = 0.6;
    body.add(ring); body.name = 'vrFallbackModel'; g.add(body); g.userData.fallback = body;
    if (factory) try { const m = factory.createControllerModel(g); g.add(m); g.userData.model = m; } catch (e) {}
    scene.add(g); grips.push(g);
  }
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false, depthTest: false })); dot.renderOrder = 1002; dot.visible = false; scene.add(dot);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x3ff3ff, fog: false, toneMapped: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const tpRing = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32).rotateX(-Math.PI / 2), ringMat); tpRing.visible = false; tpRing.name = 'vrTeleportRing'; scene.add(tpRing);

  // ---------- text panels (canvas textures) ----------
  function panel(w, h, cw, ch) { const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, toneMapped: false, depthTest: false, depthWrite: false }));
    m.renderOrder = 1001; m.userData = { cv, g: cv.getContext('2d'), tex, txt: '' }; return m; }
  function drawPanel(m, lines, opts = {}) { const key = lines.join('|') + (opts.bar ? '|bar' + Math.round(opts.bar.v * 50) + opts.bar.low : '') + (opts.bat ? '|bat' + opts.bat.pct + (opts.bat.charging ? 'c' : '') : '') + (opts.status ? '|st' + opts.status : ''); if (m.userData.txt === key) return; m.userData.txt = key;
    const { cv, g, tex } = m.userData, W = cv.width, H0 = cv.height, H = opts.bar ? Math.round(H0 * 0.72) : H0; g.clearRect(0, 0, W, H0);
    if (opts.bar) { const b = opts.bar, y = H + 2, bh = H0 - H - 8, x = 150, bw = W - x - 16;   // t358u: jetpack ENERGY bar under the text
      g.fillStyle = 'rgba(20,8,4,0.9)'; g.strokeStyle = '#ffb060'; g.lineWidth = 4; g.beginPath(); g.roundRect ? g.roundRect(4, y, W - 8, bh, bh * 0.3) : g.rect(4, y, W - 8, bh); g.fill(); g.stroke();
      g.fillStyle = '#ffe0b0'; g.font = '900 ' + Math.round(bh * 0.5) + 'px "Arial Black", Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('ENERGY', 16, y + bh / 2, x - 24);
      const gr = g.createLinearGradient(x, 0, x + bw, 0); gr.addColorStop(0, '#ff3b1a'); gr.addColorStop(0.55, '#ffb020'); gr.addColorStop(1, '#ffe080');
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, y + 8, bw, bh - 16); g.fillStyle = b.low ? '#ff3030' : gr; g.fillRect(x, y + 8, Math.max(0, Math.min(1, b.v)) * bw, bh - 16); }
    g.fillStyle = 'rgba(10,6,24,0.86)'; g.strokeStyle = opts.border || '#3ff3ff'; g.lineWidth = Math.max(3, H * 0.03); g.beginPath(); g.roundRect ? g.roundRect(4, 4, W - 8, H - 8, H * 0.12) : g.rect(4, 4, W - 8, H - 8); g.fill(); g.stroke();
    // vrtest-v5 (t460u): optional status strip on top (controller batteries · local time · players), drawn small above the lines
    const y0 = opts.status ? Math.round(H * 0.24) : 0;
    if (opts.status) { g.fillStyle = 'rgba(63,243,255,0.14)'; g.fillRect(12, 10, W - 24, y0 - 6); g.fillStyle = '#9fe8ff'; g.font = '900 ' + Math.round(y0 * 0.5) + 'px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(opts.status, W / 2, 8 + y0 / 2, W - 36); }
    const n = lines.length, lh = (H - 16 - y0) / n; g.textAlign = 'center'; g.textBaseline = 'middle';
    let bw = 0; if (opts.bat) { const B = opts.bat, lh0 = lh, bh = lh0 * 0.5, bwid = bh * 2, x = W - 24 - bwid - 92, y = 8 + y0 + lh0 * 0.5 - bh / 2, col = B.charging ? '#7dff9a' : B.pct <= 20 ? '#ff4040' : '#e8f6ff';   // battery icon + %, top right
      g.strokeStyle = col; g.lineWidth = 4; g.strokeRect(x, y, bwid, bh); g.fillStyle = col; g.fillRect(x + bwid, y + bh * 0.3, 6, bh * 0.4); g.fillRect(x + 4, y + 4, Math.max(0, (bwid - 8) * B.pct / 100), bh - 8);
      if (B.charging) { g.fillStyle = '#ffe14a'; g.strokeStyle = '#1a1030'; g.lineWidth = 2; const cx = x + bwid / 2, cy = y + bh / 2; g.beginPath(); g.moveTo(cx + 4, cy - bh * 0.62); g.lineTo(cx - 9, cy + 3); g.lineTo(cx - 1, cy + 3); g.lineTo(cx - 5, cy + bh * 0.62); g.lineTo(cx + 9, cy - 3); g.lineTo(cx + 1, cy - 3); g.closePath(); g.fill(); g.stroke(); }
      g.fillStyle = col; g.font = '900 ' + Math.round(bh * 0.95) + 'px "Arial Black", Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(B.pct + '%', x + bwid + 14, y + bh / 2 + 1, 84); g.textAlign = 'center'; bw = bwid + 120; }
    lines.forEach((t, i) => { g.fillStyle = i === 0 ? (opts.c0 || '#ffe14a') : '#e8f6ff'; g.font = '900 ' + Math.round(lh * (i === 0 ? 0.62 : 0.5)) + 'px "Arial Black", Arial, sans-serif'; g.fillText(t, i === 0 && bw ? (W - bw) / 2 : W / 2, 8 + y0 + lh * (i + 0.5), i === 0 && bw ? W - 24 - bw : W - 24); });
    tex.needsUpdate = true; }
  // t361u: headset battery on the left-controller display (navigator.getBattery, live via its events). Hidden when the browser has no Battery API.
  const BAT = { supported: false, level: null, charging: false, tried: false, updates: 0 };
  function batteryInit() { if (BAT.tried) return; BAT.tried = true; try { if (!navigator.getBattery) return; navigator.getBattery().then(b => { if (!b) return; BAT.supported = true; BAT.mgr = b;
      const up = () => { BAT.level = typeof b.level === 'number' ? b.level : null; BAT.charging = !!b.charging; BAT.updates++; }; up(); for (const ev of ['levelchange', 'chargingchange']) try { b.addEventListener(ev, up); } catch (e) {} }).catch(() => {}); } catch (e) {} }
  S.battery = () => ({ supported: BAT.supported, level: BAT.level, charging: BAT.charging, updates: BAT.updates, shown: !!(hud.userData.txt && /\|bat/.test(hud.userData.txt)) });
  const HUD_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9, 0, 0));
  // vrtest-v5 (t460u): controller batteries, local time and player count on the same display. WebXR has no standard controller battery;
  // we read one only if the browser exposes it on the input source / gamepad (none known on the Quest Browser), else show '--'.
  function ctrlBattery(hand) { try { const ss = renderer.xr.getSession && renderer.xr.getSession(); if (!ss) return null;
      for (const src of ss.inputSources) { if (src.handedness !== hand) continue; const gp = src.gamepad || {}, b = src.battery || gp.battery || null;
        let v = b && typeof b.level === 'number' ? b.level : typeof gp.batteryLevel === 'number' ? gp.batteryLevel : typeof src.batteryLevel === 'number' ? src.batteryLevel : null;
        if (v == null) for (const obj of [src, src.gamepad]) { if (!obj || v != null) continue; for (let p = obj; p && p !== Object.prototype && v == null; p = Object.getPrototypeOf(p)) for (const k of Object.getOwnPropertyNames(p)) { if (!/batt/i.test(k)) continue; let x; try { x = obj[k]; } catch (e) { continue; } if (typeof x === 'number') { v = x; break; } if (x && typeof x.level === 'number') { v = x.level; break; } } }
        return v == null ? null : Math.round(v <= 1 ? v * 100 : v); } } catch (e) {} return null; }
  const ST = { t: -1, txt: '', l: null, r: null, players: 1, time: '', builds: 0 };
  function hudStatus(now) { if (now - ST.t < 1000 && ST.txt) return ST.txt; ST.t = now;   // at most once a second; drawPanel redraws only if the text changed
    ST.l = ctrlBattery('left'); ST.r = ctrlBattery('right'); const mp = window.__mp; ST.players = mp && mp.state === 'on' ? (mp.count || 1) : 1;
    const d = new Date(); ST.time = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    ST.txt = 'L ' + (ST.l == null ? '--' : ST.l + '%') + '  R ' + (ST.r == null ? '--' : ST.r + '%') + '  ·  ' + ST.time + '  ·  ' + ST.players + (ST.players === 1 ? ' PLAYER' : ' PLAYERS'); ST.builds++; return ST.txt; }
  S.hudStatus = () => Object.assign({}, ST, { drawn: !!(hud.userData.txt && hud.userData.txt.indexOf('|st' + ST.txt) >= 0) });
  const hud = panel(0.2, 0.118, 512, 302);
  // vrtest-v6 (Dave t465u): ?padinfo=1 = a debug board above the left-controller display listing every property (own + prototype chain,
  // values for plain fields) of each XRInputSource and its Gamepad, plus navigator.getGamepads() outside XR, so a headset build can show
  // whatever the browser really exposes (no standard controller battery exists in WebXR / the Gamepad API; we look anyway: any field whose
  // name contains 'batt' is picked up by ctrlBattery's scan below and shown on the status line).
  const PADINFO = /[?&]padinfo=1\b/.test(location.search);
  const padBoard = PADINFO ? panel(0.42, 0.42, 1024, 1024) : null; if (padBoard) { padBoard.name = 'vrPadInfo'; padBoard.visible = false; scene.add(padBoard); }
  function propsOf(o, depth) { const out = []; if (!o || typeof o !== 'object') return out; const seen = new Set(); let p = o, lvl = 0;
    while (p && p !== Object.prototype && lvl < 6) { const cn = (p.constructor && p.constructor.name) || '?';
      for (const k of Object.getOwnPropertyNames(p)) { if (seen.has(k) || k === 'constructor') continue; seen.add(k); let v; try { v = o[k]; } catch (e) { v = '!' + e.name; }
        const t = typeof v, sv = t === 'function' ? '()' : v === null ? 'null' : t === 'object' ? (Array.isArray(v) || (v && typeof v.length === 'number') ? '[' + v.length + ']' : '{' + ((v && v.constructor && v.constructor.name) || 'obj') + '}') : String(v).slice(0, 24);
        out.push((lvl ? cn + '.' : '') + k + '=' + sv); }
      p = Object.getPrototypeOf(p); lvl++; }
    return out; }
  const PI_ = { t: -1e9, lines: [], key: '' };
  function battScan(o) { const r = []; for (const line of propsOf(o)) if (/batt|power|charge/i.test(line)) r.push(line); return r; }
  function padInfoUpdate(now) { if (!padBoard) return; padBoard.visible = !!(S.presenting && !S.hudHidden); if (!padBoard.visible) return;
    padBoard.position.set(0, 0.3, 0).applyQuaternion(hud.quaternion).add(hud.position); padBoard.quaternion.copy(hud.quaternion);
    if (now - PI_.t < 2000) return; PI_.t = now; const L = ['PADINFO  ' + navigator.userAgent.slice(0, 90)];
    try { const ss = renderer.xr.getSession(); for (const src of (ss && ss.inputSources) || []) { L.push('== ' + src.handedness + ' ' + src.targetRayMode + ' profiles=' + (src.profiles || []).join(','));
        L.push('src: ' + propsOf(src).join('  ')); if (src.gamepad) { L.push('pad: ' + propsOf(src.gamepad).join('  ')); const h = src.gamepad.hapticActuators; if (h && h[0]) L.push('haptic[0]: ' + propsOf(h[0]).join('  ')); }
        const b = battScan(src).concat(src.gamepad ? battScan(src.gamepad) : []); L.push('battery-like: ' + (b.length ? b.join('  ') : 'none')); } } catch (e) { L.push('err ' + e); }
    try { const gp = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; L.push('navigator.getGamepads(): ' + gp.length + ' ' + gp.map(g => g.id + ' ' + propsOf(g).filter(x => /batt|power|charge|hand|pose/i.test(x)).join(' ')).join(' | ')); } catch (e) {}
    L.push('navigator: getBattery=' + !!navigator.getBattery + ' hid=' + !!navigator.hid + ' bluetooth=' + !!navigator.bluetooth + ' usb=' + !!navigator.usb + ' headset bat=' + (BAT.level != null ? Math.round(BAT.level * 100) + '%' : '--'));
    const key = L.join('\n'); if (key === PI_.key) return; PI_.key = key; PI_.lines = L; try { console.log('[padinfo]\n' + key); } catch (e) {}
    const { cv, g, tex } = padBoard.userData; g.clearRect(0, 0, 1024, 1024); g.fillStyle = 'rgba(6,4,18,0.92)'; g.fillRect(0, 0, 1024, 1024); g.strokeStyle = '#ffde00'; g.lineWidth = 6; g.strokeRect(3, 3, 1018, 1018);
    g.fillStyle = '#e8f6ff'; g.font = '20px monospace'; g.textAlign = 'left'; g.textBaseline = 'top'; let y = 10;
    for (const line of L) { let rest = line; g.fillStyle = /^==/.test(line) ? '#ffde00' : /^battery-like: (?!none)/.test(line) ? '#7dff9a' : '#e8f6ff';
      while (rest.length && y < 1000) { g.fillText(rest.slice(0, 84), 10, y); rest = rest.slice(84); y += 22; } }
    tex.needsUpdate = true; }
  S.padInfo = () => ({ on: PADINFO, lines: PI_.lines }); hud.name = 'vrHud'; hud.visible = false; scene.add(hud);   // follows the left controller: the in-world ticket display

  // ---------- the game screen (shown while a cabinet game runs) ----------
  const scr = new THREE.Group(); scr.name = 'vrGameScreen'; scr.visible = false; scene.add(scr);
  const comp = document.createElement('canvas'); comp.width = 512; comp.height = 512; const cg = comp.getContext('2d');
  const scrTex = new THREE.CanvasTexture(comp); scrTex.colorSpace = THREE.SRGBColorSpace; scrTex.generateMipmaps = false; scrTex.minFilter = THREE.LinearFilter;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x05020c, fog: false, depthTest: false, depthWrite: false })); back.renderOrder = 998; scr.add(back);
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff3fd2, fog: false, toneMapped: false, depthTest: false, depthWrite: false })); edge.renderOrder = 997; edge.position.z = -0.002; scr.add(edge);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: scrTex, fog: false, toneMapped: false, depthTest: false, depthWrite: false })); face.renderOrder = 999; face.name = 'vrGameFace'; scr.add(face);
  const bar = panel(1.2, 0.16, 1024, 136); bar.name = 'vrStatus'; scr.add(bar);
  const G = { layoutT: 0, cvs: [], rect: null, aspect: 1, placed: false, w: 1, h: 1, ptrDown: false };
  const pwM = {};   // power-up buttons (right of the screen), one per power-up of the current game
  function pwMesh(p, i) { let m = pwM[p.id]; if (!m) { m = pwM[p.id] = panel(0.5, 0.17, 512, 174); m.name = 'vrPower_' + p.id; m.renderOrder = 1001; scr.add(m); drawPanel(m, [p.name, (p.always ? 'HOLD ' : 'PRESS ') + p.btn], p.always ? { c0: '#7dfcff', border: '#3ff3ff' } : { c0: '#ffe14a', border: '#ffe14a' }); }
    m.position.set(G.w / 2 + 0.33, G.h / 2 - 0.1 - i * 0.21, 0.002); return m; }
  S.screen = scr; S.comp = comp;
  function placeScreen() {
    const h = S.head || { x: monkey.position.x, y: 1.6, z: monkey.position.z, yaw: st.yaw }, d = 1.55;
    scr.position.set(h.x - Math.sin(h.yaw) * d, Math.max(1.0, h.y - 0.08), h.z - Math.cos(h.yaw) * d); scr.rotation.set(0, h.yaw, 0); G.placed = true; }
  function sizeScreen(aspect) { const maxW = 1.7, maxH = 1.25; let hh = maxH, ww = hh * aspect; if (ww > maxW) { ww = maxW; hh = ww / aspect; }
    G.w = ww; G.h = hh; face.scale.set(ww, hh, 1); back.scale.set(ww + 0.04, hh + 0.04, 1); edge.scale.set(ww + 0.07, hh + 0.07, 1); bar.position.set(0, -hh / 2 - 0.12, 0); }
  sizeScreen(9 / 16);
  function gameWin() { try { return play.frame && play.frame.contentWindow; } catch (e) { return null; } }
  function layout(w) {   // the visible canvases of the game page, and the box around them (CSS px in the iframe)
    const d = w.document, list = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, big = null, ba = 0;
    for (const c of d.querySelectorAll('canvas')) { if (!c.width || !c.height) continue; const r = c.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
      const cs = w.getComputedStyle(c); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= w.innerWidth || r.top >= w.innerHeight) continue;
      list.push({ c, r }); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); if (r.width * r.height > ba) { ba = r.width * r.height; big = { c, r }; } }
    if (!list.length) { G.cvs = []; G.rect = null; return; }
    // only canvases that sit over the biggest one (HUD layers); skip small decorations elsewhere on the page
    const br = big.r, keep = list.filter(o => o === big || (o.r.left >= br.left - 2 && o.r.top >= br.top - 2 && o.r.right <= br.right + 2 && o.r.bottom <= br.bottom + 2));
    G.cvs = keep; G.rect = { left: br.left, top: br.top, width: br.width, height: br.height };
    const k = Math.min(1024 / Math.max(br.width, br.height), Math.max(big.c.width / br.width, 512 / Math.max(br.width, br.height)));
    const cw = Math.max(16, Math.round(br.width * k)), ch = Math.max(16, Math.round(br.height * k));
    if (comp.width !== cw || comp.height !== ch) { comp.width = cw; comp.height = ch; scrTex.dispose(); }
    const asp = br.width / br.height; if (Math.abs(asp - G.aspect) > 0.01) { G.aspect = asp; sizeScreen(asp); }
  }
  function drawGame(w) {
    if (!G.rect) return; const R = G.rect, sx = comp.width / R.width, sy = comp.height / R.height;
    cg.imageSmoothingEnabled = false; cg.fillStyle = '#000'; cg.fillRect(0, 0, comp.width, comp.height);
    for (const { c } of G.cvs) { const r = c.getBoundingClientRect(); try { cg.drawImage(c, (r.left - R.left) * sx, (r.top - R.top) * sy, r.width * sx, r.height * sy); } catch (e) {} }
    scrTex.needsUpdate = true; S.texUploads++; }
  S.debugPixel = (u, v) => { const p = cg.getImageData(Math.min(comp.width - 1, u * comp.width | 0), Math.min(comp.height - 1, v * comp.height | 0), 1, 1).data; return [p[0], p[1], p[2]]; };
  S.compHash = () => { const d = cg.getImageData(0, 0, comp.width, comp.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; };

  // ---------- events into the game iframe ----------
  function sendKey(w, type, code) {
    try { const d = w.document, ev = new w.KeyboardEvent(type, { key: KEYNAME[code] || code, code, bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(ev, 'keyCode', { get: () => KEYCODE[code] || 0 }); Object.defineProperty(ev, 'which', { get: () => KEYCODE[code] || 0 });
      const t = d.activeElement && d.activeElement !== d.body && d.activeElement.tagName !== 'IFRAME' ? d.activeElement : (d.body || d.documentElement); t.dispatchEvent(ev);
      S.keysSent++; S.lastKey = type + ':' + code; } catch (e) {} }
  function hold(code, on, w) { const was = !!S.held[code]; if (was === !!on) return; if (on) S.held[code] = 1; else delete S.held[code]; if (w) sendKey(w, on ? 'keydown' : 'keyup', code); }
  function releaseAll() { const w = gameWin(); for (const c of Object.keys(S.held)) hold(c, false, w); if (G.ptrDown && w) sendPtr(w, 'pointerup', G.pu, G.pv); G.ptrDown = false; }
  function sendPtr(w, type, u, v) {
    if (!G.rect) return; try { const d = w.document, R = G.rect, x = R.left + u * R.width, y = R.top + (1 - v) * R.height, t = d.elementFromPoint(x, y) || G.cvs[0].c, down = type !== 'pointerup';
      const base = { clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, composed: true, button: 0, buttons: down ? 1 : 0, view: w };
      t.dispatchEvent(new w.PointerEvent(type, Object.assign({ pointerId: 41, pointerType: 'touch', isPrimary: true, width: 8, height: 8, pressure: down ? 0.5 : 0 }, base)));
      const mt = { pointerdown: 'mousedown', pointermove: 'mousemove', pointerup: 'mouseup' }[type]; t.dispatchEvent(new w.MouseEvent(mt, base));
      try { const tt = { pointerdown: 'touchstart', pointermove: 'touchmove', pointerup: 'touchend' }[type], touch = new w.Touch({ identifier: 41, target: t, clientX: x, clientY: y });
        t.dispatchEvent(new w.TouchEvent(tt, { bubbles: true, cancelable: true, composed: true, touches: down ? [touch] : [], targetTouches: down ? [touch] : [], changedTouches: [touch] })); } catch (e) {}
      if (type === 'pointerup') t.dispatchEvent(new w.MouseEvent('click', base));
      S.ptrSent++; G.pu = u; G.pv = v; } catch (e) {} }

  // ---------- input ----------
  const IN = { left: null, right: null };
  function readPad(src, prev) {
    const gp = src.gamepad, b = i => !!(gp && gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.75)), ax = gp ? gp.axes : [];
    const sx = ax.length >= 4 ? ax[2] : (ax[0] || 0), sy = ax.length >= 4 ? ax[3] : (ax[1] || 0);
    const leg = !!(gp && gp.mapping !== 'xr-standard' && gp.buttons.length < 6);   // v24: a non xr-standard pad (old Oculus layout: 3 = A / X, 4 = B / Y)
    const cur = { trig: b(0), grip: b(1), a: leg ? b(3) : b(4), b: leg ? b(4) : b(5), stick: b(3), x: Math.abs(sx) > 0.08 ? sx : 0, y: Math.abs(sy) > 0.08 ? sy : 0, src };
    for (const k of ['trig', 'grip', 'a', 'b', 'stick']) cur[k + 'Down'] = cur[k] && !(prev && prev[k]);
    return cur; }
  function poll() { const L = IN.left, R = IN.right; IN.left = IN.right = null; if (S.blurred) { S.blurPolls = (S.blurPolls || 0) + 1; return; }   // vrtest-v5: system overlay up: no input
    const ss = session && session.inputSources; if (!ss) return;
    for (const src of ss) { if (!src.gamepad || (src.handedness !== 'left' && src.handedness !== 'right')) continue; IN[src.handedness] = readPad(src, src.handedness === 'left' ? L : R); } }
  function ctrlFor(hand) { for (const c of ctrls) if (c.userData.hand === hand) return c; return null; }
  function pulse(src, k = 0.5, ms = 30) { if (S.blurred) return; try { const h = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0]; if (h && h.pulse) h.pulse(k, ms); } catch (e) {} }
  function rayOf(c) { c.updateMatrixWorld(true); _o.setFromMatrixPosition(c.matrixWorld); if (GF.on && c === GF.ctrl) _o.copy(GF.o); c.getWorldQuaternion(_q); _d.set(0, 0, -1).applyQuaternion(_q).normalize(); _ray.set(_o, _d); return _ray; }

  // ---------- rig: the player's place in the arcade = an offset reference space ----------
  function applyRig() { if (!baseRef || typeof XRRigidTransform === 'undefined') return; const r = S.rig;
    const t = new XRRigidTransform({ x: r.x, y: r.y, z: r.z, w: 1 }, { x: 0, y: Math.sin(r.yaw / 2), z: 0, w: Math.cos(r.yaw / 2) });
    try { renderer.xr.setReferenceSpace(baseRef.getOffsetReferenceSpace(t.inverse)); } catch (e) { S.lastError = String(e); } }
  function moveRig(dx, dz, dy = 0) { if (!dx && !dz && !dy) return; S.rig.x += dx; S.rig.z += dz; S.rig.y += dy; if (S.head) { S.head.x += dx; S.head.z += dz; S.head.y += dy; } S.rigDirty = true; }
  function turnRig(a) { const r = S.rig, h = S.head || { x: r.x, z: r.z }, c = Math.cos(a), s = Math.sin(a), ox = r.x - h.x, oz = r.z - h.z;
    r.x = h.x + ox * c + oz * s; r.z = h.z - ox * s + oz * c; r.yaw += a; if (S.head) S.head.yaw += a; S.rigDirty = true; }
  S.applyRig = applyRig; S.turn = a => { turnRig(a); applyRig(); };

  // ---------- cabinets you can point at ----------
  const boxes = new Map();
  function boxOf(c) { let b = boxes.get(c); if (!b) { b = new THREE.Box3().setFromObject(c); boxes.set(c, b); } return b; }
  function machineOf(c) { return Object.values(play.machines || {}).find(m => m.cab === c) || null; }
  function pickCab(ray) { let best = null, bd = RAY_MAX; for (const c of A.playables) { if (!c || !machineOf(c)) continue; const p = ray.intersectBox(boxOf(c), _hit); if (!p) continue; const d = p.distanceTo(ray.origin); if (d < bd) { bd = d; best = { cab: c, d, p: p.clone() }; } } return best; }
  function startCab(cab, p) {
    const m = machineOf(cab); if (!m || play.mode !== 'walk') return false;
    if (m.key === 'roadster' && cab.userData.seats) { const seat = p && p.x < cab.position.x ? 'L' : 'R'; cab.userData.seat = seat; cab.userData.screen = cab.userData.screens[seat === 'L' ? 0 : 1]; }
    releaseAll(); G.placed = false; play.start(m); if (play.mode === 'walk') return false; S.launches++; S.lastLaunch = m.key; return true; }
  S.startCab = startCab; S.machineOf = machineOf; S.pickCab = pickCab;
  function tryTeleport(p) { const q = new THREE.Vector3(p.x, monkey.position.y, p.z); A.collide(q); if (Math.hypot(q.x - p.x, q.z - p.z) > 0.35) return false;
    const h = S.head || { x: monkey.position.x, z: monkey.position.z }; moveRig(q.x - h.x, q.z - h.z); monkey.position.x = q.x; monkey.position.z = q.z; st.vel.set(0, 0, 0); S.teleports++; return true; }
  S.teleport = tryTeleport;

  // ---------- t350u: VR panels (ticket exchange, prize shop, menu) pressed with the ray + trigger ----------
  // The flat game uses HTML overlays for these (VR can't click them), so VR draws its own panel and calls the SAME functions:
  // kiosk.buy(i) / collect the dispensed tickets (play.addTickets), shop.buy(id), tp.go() (teleporter).
  const UI = { open: null, page: 0, msg: '', msgT: 0, btns: [], hover: null, key: '' };
  const uiM = panel(1.0, 0.75, 1024, 768); uiM.name = 'vrMenu'; uiM.renderOrder = 1003; uiM.visible = false; scene.add(uiM);
  const kiosk = () => window.__kiosk || null, nbApi = () => A.nb || null;
  const grokAway = () => { const C = window.__chessTable; return !!(C && C.grokBusy); };   // v12: the clerk is walking to / sitting at the chess table
  const inChat = () => UI.open === 'chat';
  function uiOpen(kind) { const h = S.head || { x: monkey.position.x, y: 1.6, z: monkey.position.z, yaw: st.yaw }, d = 0.9;
    if (inChat() && kind !== 'chat') chatEnd();
    UI.open = kind; UI.page = 0; UI.msg = ''; UI.msgT = 0; UI.key = '';
    uiM.position.set(h.x - Math.sin(h.yaw) * d, Math.max(0.9, h.y - 0.12), h.z - Math.cos(h.yaw) * d); uiM.rotation.set(0, h.yaw, 0); uiM.visible = true; uiM.updateMatrixWorld(true);
    S.panels[kind] = (S.panels[kind] || 0) + 1; }
  function uiClose() { chatEnd(); UI.open = null; uiM.visible = false; UI.btns = []; }
  function say(m) { UI.msg = m; UI.msgT = 3; }
  function vcTap() { const vc = window.__voice; if (!vc) return; const r = vc.tap();
    const show = () => { const st = vc.state; say(st === 'on' ? (vc.muted ? 'MIC MUTED' : 'MIC ON · PLAYERS IN VOICE HEAR YOU') : st === 'listen' ? (vc.err === 'NotAllowedError' ? 'MIC BLOCKED · LISTENING ONLY' : 'NO MIC · LISTENING ONLY') : (vc.msg || '').toUpperCase().slice(0, 40)); UI.key = ''; };
    if (r && r.then) { say('ASKING FOR THE MIC…'); r.then(show, show); } else show(); }
  function beam(dest) { const tp = A.tp; if (!tp || tp.state !== 'idle' || play.mode !== 'walk') return false; uiClose(); tp.go(dest === 'nk' ? 'nk' : dest === 'shop' || !dest ? 'shop' : dest); S.beams++; return true; }
  // v16 Neon Knockout studio (nk/nkgame.js, lazy): its gloves replace the controller models there; rays hide during a round
  const nkIn = () => !!(A.tp && A.tp.NKX != null && monkey.position.x < A.tp.NKX / 2);
  const nkRound = () => { const N = window.__nkGame; return !!(N && N.inStudio && N.state.mode === 'play'); };
  const nkPlaying = () => nkRound() && !window.__nkGame.state.paused;   // v17: a paused round shows the rays again (for the pause panel)
  const nkPaused = () => nkRound() && !!window.__nkGame.state.paused;
  S.nkPauses = 0; S.nkResets = 0; S.nkExits = 0;
  // v17 (t404u) / v23: B or Y during a Neon Knockout round = pause: RESUME / RESET GAME / EXIT GAME (exit beams back to the arcade, no tickets)
  function nkPause() { const N = window.__nkGame; if (!N || !N.pause()) return false; S.nkPauses++; uiOpen('nkPause'); return true; }
  function nkResume() { const N = window.__nkGame; if (UI.open === 'nkPause') uiClose(); if (N) N.resume(); }
  function nkReset() { const N = window.__nkGame; if (UI.open === 'nkPause') uiClose(); if (N && N.resetRound()) S.nkResets++; }
  function nkExit() { const N = window.__nkGame; if (UI.open === 'nkPause') uiClose(); if (N) N.abort('exit'); S.nkExits++; beam(); }
  S.nkGrip = hand => { const i = ctrls.findIndex(c => c.userData.hand === hand && c.userData.src); return i >= 0 ? { obj: grips[i], src: ctrls[i].userData.src } : null; };
  S.nkHide = null; S.nkHid = false;
  function nkCtrl() { const want = nkIn() && !!(S.nkHide && S.nkHide.models) && !!window.__nkGame; if (want) { ctrlModelsVis(false); S.nkHid = true; } else if (S.nkHid) { ctrlModelsVis(true); S.nkHid = false; } }
  function collect() { const K = kiosk(); if (!K || !K.pending || K.dispK < 1) return false; const n = K.pending;
    K.setState({ bal: K.C.bal, at: K.C.at, pending: 0 }); play.addTickets(n); K.pocketed = (K.pocketed || 0) + n; S.collected += n; say('+' + n + ' TICKETS COLLECTED'); return true; }
  function nbStart() { const n = nbApi(); if (!n || n.playing || play.mode !== 'walk' || (A.tp && A.tp.locked)) return false; uiClose(); n.start(); if (n.playing) { S.nbStarts++; try { n.setZoomAmt(0); } catch (e) {} } return n.playing; }
  S.ui = { open: k => uiOpen(k), close: uiClose, nb: () => nbApi(), tp: () => A.tp, shop: () => A.shop, get kind() { return UI.open; }, get btns() { return UI.btns.map(b => ({ id: b.id, label: b.label, on: b.on, art: b.art || null, pix: b.pix || null })); }, beam, collect, nbStart,
    // world point of a button (tests aim the ray at it)
    btnWorld(id) { const b = UI.btns.find(q => q.id === id); if (!b) return null; uiM.updateMatrixWorld(true); const p = new THREE.Vector3(((b.x + b.w / 2) / 1024 - 0.5) * 1.0, (0.5 - (b.y + b.h / 2) / 768) * 0.75, 0); return uiM.localToWorld(p).toArray(); } };
  // v12 (t388u): picture tiles for the backpack (prizes + accessories)
  const WARD_IC = { hat: '\uD83C\uDFA9', glasses: '\uD83D\uDD76\uFE0F', back: '\uD83C\uDF92', hand: '\u270B', hoodie: '\uD83E\uDDE5', suit: '\uD83E\uDDBA', fur: '\uD83D\uDC12', shoes: '\uD83D\uDC5F' };
  const CLAW_IC = { bear: '\uD83E\uDDF8', bunny: '\uD83D\uDC30', duck: '\uD83E\uDD86', frog: '\uD83D\uDC38', cat: '\uD83D\uDC31', octopus: '\uD83D\uDC19', penguin: '\uD83D\uDC27', alien: '\uD83D\uDC7D', monkey: '\uD83D\uDC35', grok: '\uD83E\uDD16' };
  function prizeIcon(it) { if (it.src === 'claw') return CLAW_IC[it.id.slice(5)] || '\uD83E\uDDF8'; const n = it.name;
    return /GROK|ROBOT/.test(n) ? '\uD83E\uDD16' : /MONKEY/.test(n) ? '\uD83D\uDC35' : /TEDDY|BEAR/.test(n) ? '\uD83E\uDDF8' : /COTTON|CANDY/.test(n) ? '\uD83C\uDF6D' : /SWORD/.test(n) ? '\u2694\uFE0F' : /BALLOON/.test(n) ? '\uD83C\uDF88' : /CROWN/.test(n) ? '\uD83D\uDC51' : /DRINK|SODA|CUP/.test(n) ? '\uD83E\uDD64' : /ICE CREAM/.test(n) ? '\uD83C\uDF66' : /DUCK/.test(n) ? '\uD83E\uDD86' : /STAR/.test(n) ? '\u2B50' : '\uD83C\uDF81'; }
  function packTabs(add, on) { add('pt_prizes', '\uD83C\uDF81 PRIZES', 120, 166, 380, 60, true, () => { if (UI.open !== 'pack') { UI.open = 'pack'; UI.page = 0; UI.key = ''; } }); add('ward', '\uD83C\uDFA9 ACCESSORIES', 524, 166, 380, 60, !!window.__gaPlayer, () => { if (UI.open !== 'ward') { UI.open = 'ward'; UI.page = 0; UI.key = ''; S.panels.ward = (S.panels.ward || 0) + 1; } }); }
  // floor preview: every 5 s the next floor picture (img/floor_*.webp, the same pictures as the flat OPTIONS)
  const FLOOR_IMG = {}; function floorImg(v) { let im = FLOOR_IMG[v]; if (!im) { im = FLOOR_IMG[v] = new Image(); im.onload = () => { UI.key = ''; }; im.src = 'img/floor_' + v + '.webp'; } return im.complete && im.naturalWidth ? im : null; }
  const floorNow = () => ROOM_FLOORS[Math.floor(performance.now() / 5000) % ROOM_FLOORS.length];
  S.menuFloor = () => floorNow()[0]; S.menuArt = {};
  function uiSpec() {
    if (UI.open === 'shop' || UI.open === 'pack' || UI.open === 'ward') { try { const sh = window.__shop || (A.shop); if (sh && sh.queueIcons) sh.queueIcons(); } catch (e) {} }
    const B = [], add = (id, label, x, y, w, h, on, act) => B.push({ id, label, x, y, w, h, on: on !== false, act });
    let title = '', sub = '', body = '';
    add('close', 'X', 900, 22, 100, 90, true, uiClose);
    if (UI.open === 'nkPause') { B[0].act = nkResume; title = 'PAUSED'; sub = 'B / Y = RESUME · EXIT = BACK TO THE ARCADE · NO TICKETS FOR AN UNFINISHED ROUND';
      add('nkResume', 'RESUME', 162, 210, 700, 140, true, nkResume); add('nkReset', 'RESET GAME', 162, 390, 700, 140, true, nkReset); add('nkExit', 'EXIT GAME', 162, 570, 700, 140, true, nkExit); }
    if (UI.open === 'tickets') { const K = kiosk(); title = 'TICKET EXCHANGE';
      if (!K) sub = 'NOT READY'; else { const bal = K.C.bal, left = Math.max(0, Math.ceil((K.C.at + 36e5 - Date.now()) / 6e4));
        sub = 'CASH $' + bal + (bal < 5 ? '  ·  +$' + (5 - bal) + ' IN ' + left + ' MIN' : '');
        (K.offers || []).forEach(([d, t], i) => add('offer' + i, '$' + d + '  =  ' + t + ' TICKETS', 112, 190 + i * 118, 800, 100, bal >= d, () => { if (K.buy(i)) { S.ticketBuys++; say('+' + t + ' TICKETS · DISPENSING...'); } else say('NOT ENOUGH CASH'); }));
        if (K.pending) add('collect', K.dispK >= 1 ? 'COLLECT ' + K.pending + ' TICKETS' : 'DISPENSING ' + K.pending + ' TICKETS...', 112, 548, 800, 100, K.dispK >= 1, collect); } }
    else if (UI.open === 'shop') { const sh = A.shop; title = 'GROK PRIZE SHOP';
      if (!sh) sub = 'THE SHOP IS LOADING'; else { const b = sh.balance(), per = 4, items = (sh.ITEMS || []).concat(sh.NK_SHOP ? sh.NK_SHOP() : []), pages = Math.max(1, Math.ceil(items.length / per)); UI.page = Math.min(UI.page, pages - 1);
        sub = 'YOU HAVE ' + b + ' TICKETS  ·  PAGE ' + (UI.page + 1) + '/' + pages;
        items.slice(UI.page * per, UI.page * per + per).forEach((it, i) => { const lab = it.nk ? it.name.toUpperCase() + '  ·  ' + (it.on ? 'WEARING' : it.owned ? 'OWNED · WEAR' : it.price + ' TICKETS') : it.name.toUpperCase() + '  ·  ' + it.price + ' TICKETS';
          it.nk ? add('item_' + it.id, lab, 40, 190 + i * 112, 944, 96, it.owned || b >= it.price, () => { if (sh.buyGlove(it.nk)) { S.shopBuys++; say((it.owned ? 'WEARING: ' : 'GOT IT: ') + it.name.toUpperCase()); } else say('NEED ' + it.price + ' TICKETS · YOU HAVE ' + sh.balance()); })
          : add('item_' + it.id, lab, 40, 190 + i * 112, 944, 96, b >= it.price, () => { if (sh.buy(it.id)) { S.shopBuys++; say('GOT IT: ' + it.name.toUpperCase()); } else say('NEED ' + it.price + ' TICKETS · YOU HAVE ' + sh.balance()); });
          B[B.length - 1].art = 'shopRow'; B[B.length - 1].pix = it.nk ? 'nk_' + it.nk : it.id; });
        add('prev', '<', 40, 640, 150, 96, UI.page > 0, () => { UI.page--; }); add('next', '>', 834, 640, 150, 96, UI.page < pages - 1, () => { UI.page++; }); } }
    else if (UI.open === 'ward') { const gp = window.__gaPlayer; title = 'MONKEY BACKPACK';
      packTabs(add, 'ward');
      if (!gp || !gp.allOpts) sub = 'NOT READY'; else {
        const cats = ['hat', 'glasses', 'back', 'hand', 'hoodie', 'suit', 'fur', 'shoes'].filter(k => gp.allOpts[k] && gp.allOpts[k].length); if (!cats.includes(UI.cat)) UI.cat = cats[0];
        const k = UI.cat, L = gp.allOpts[k], per = 4, pages = Math.max(1, Math.ceil(L.length / per)), bal = gp.balance(); UI.page = Math.min(UI.page, pages - 1);
        sub = 'ACCESSORIES  ·  YOU HAVE ' + bal + ' TICKETS  ·  ' + k.toUpperCase() + ' ' + (UI.page + 1) + '/' + pages;
        cats.forEach((c, i) => add('cat_' + c, (WARD_IC[c] || '') + ' ' + c.toUpperCase(), 40 + (i % 4) * 240, 240 + Math.floor(i / 4) * 64, 224, 56, true, () => { UI.cat = c; UI.page = 0; }));
        for (const b of B) if (b.id === 'cat_' + k) b.sel = true;
        const nm = v => String(v).replace(/^suit(?=.)/, 'suit ').toUpperCase();
        L.slice(UI.page * per, UI.page * per + per).forEach(([v], i) => { const own = gp.has(k, v), on = gp.p[k] === v, pr = gp.priceOf(k, v);
          add('w_' + k + '_' + v, nm(v) + (on ? ' · ON' : own ? '' : ' · ' + pr + ' T'), 40 + i * 240, 380, 224, 210, own || bal >= pr, () => {
            if (own) { gp.pick(k, v); S.wardPicks++; say(v === 'none' ? 'REMOVED' : 'WEARING ' + nm(v)); }
            else { gp.tryOn(k, v); if (gp.buy()) { S.wardBuys++; S.wardPicks++; say('BOUGHT · WEARING ' + nm(v)); } else { if (gp.wardrobe) gp.wardrobe.try = null; say('NEED ' + pr + ' TICKETS'); } } });
          B[B.length - 1].ic = v === 'none' ? '\u2716' : (WARD_IC[k] || '\u2728'); if (v !== 'none') B[B.length - 1].pix = k + ':' + v; B[B.length - 1].sel = on; });
        if (L.some(a => a[0] === 'none')) add('remove', 'REMOVE ' + k.toUpperCase(), 230, 610, 564, 80, gp.p[k] !== 'none', () => { gp.pick(k, 'none'); S.wardPicks++; say('REMOVED'); });
        add('prev', '<', 40, 610, 170, 80, UI.page > 0, () => { UI.page--; }); add('next', '>', 814, 610, 170, 80, UI.page < pages - 1, () => { UI.page++; }); } }
    else if (UI.open === 'chat') { title = 'CHAT WITH GROK'; const C = chatApi();   // v23 (Dave t432u): preset questions only (no TYPE keyboard, no TALK)
      if (!C || !C.open) { sub = 'GROK HAS GONE'; } else {
        if ((C.seq || 0) !== (UI.chatSeq || 0)) { UI.chatSeq = C.seq; UI.chatQ = C.lastQ || ''; UI.chatA = C.lastA || ''; }   // flat-picked questions land here too
        sub = UI.chatQ ? 'YOU: ' + UI.chatQ.toUpperCase() : 'PICK A QUESTION';
        body = 'GROK: ' + (UI.chatA || '...');
        const per = 8, pages = Math.ceil(CHAT_QS.length / per); UI.page = Math.min(UI.page, pages - 1);
        CHAT_QS.slice(UI.page * per, UI.page * per + per).forEach((q, i) => add('q_' + (UI.page * per + i), q, 30 + (i % 2) * 488, 382 + Math.floor(i / 2) * 68, 476, 60, true, () => chatAsk(q)));
        add('prev', '<', 30, 666, 170, 84, UI.page > 0, () => { UI.page--; }); add('next', '>', 824, 666, 170, 84, UI.page < pages - 1, () => { UI.page++; }); }
      add('close', 'CLOSE', 220, 666, 584, 84, true, uiClose); }
    else if (UI.open === 'pack') { title = 'MONKEY BACKPACK'; const sh = A.shop || window.__shop;
      packTabs(add, 'prizes');
      if (!sh || !sh.hold) { sub = 'OPENING THE BACKPACK...'; try { window.__arcade && window.__arcade.loadShop && window.__arcade.loadShop(); } catch (e) {} } else {
        const items = packItems(sh), h = heldNow(), per = 8, pages = Math.max(1, Math.ceil(items.length / per)); UI.page = Math.min(UI.page, pages - 1);
        const nm = id => { const it = items.find(q => q.id === id); return it ? it.name : String(id).replace(/^claw:/, '').toUpperCase(); };
        sub = 'RIGHT: ' + (h.R ? nm(h.R) : '-') + '   ·   LEFT: ' + (h.L ? nm(h.L) : '-');
        if (!items.length) UI.msg = UI.msg || 'NO PRIZES YET · BUY AT THE GROK SHOP OR WIN THE CLAW';
        items.slice(UI.page * per, UI.page * per + per).forEach((it, i) => { const sl = h.R === it.id ? 'R' : h.L === it.id ? 'L' : '';
          add('p_' + it.id, it.name + (it.n > 1 ? ' x' + it.n : '') + (sl ? ' · ' + sl : ''), 40 + (i % 4) * 240, 250 + Math.floor(i / 4) * 175, 224, 160, true, () => packTap(sh, it)); B[B.length - 1].ic = prizeIcon(it); B[B.length - 1].pix = it.id; B[B.length - 1].sel = !!sl; });
        add('away_R', 'PUT R AWAY', 40, 610, 300, 70, !!h.R, () => { sh.unhold('R'); S.packUnequips = (S.packUnequips || 0) + 1; say('RIGHT HAND EMPTY'); });
        add('away_L', 'PUT L AWAY', 362, 610, 300, 70, !!h.L, () => { sh.unhold('L'); S.packUnequips = (S.packUnequips || 0) + 1; say('LEFT HAND EMPTY'); });
        add('away', 'PUT BOTH AWAY', 684, 610, 300, 70, !!(h.R || h.L), () => { sh.unhold(); S.packUnequips = (S.packUnequips || 0) + 1; say('HANDS EMPTY'); });
        add('prev', '<', 40, 690, 150, 66, UI.page > 0, () => { UI.page--; }); add('next', '>', 834, 690, 150, 66, UI.page < pages - 1, () => { UI.page++; }); } }
    else if (UI.open === 'room') { title = 'FLOOR + WALLS'; sub = 'FREE  ·  LASTS UNTIL YOU RELOAD'; const tb = UI.roomTab === 'walls' ? 'walls' : 'floor';
      add('rt_floor', tb === 'floor' ? '> FLOOR <' : 'FLOOR', 40, 165, 460, 70, true, () => { UI.roomTab = 'floor'; });
      add('rt_walls', tb === 'walls' ? '> WALLS <' : 'WALLS', 524, 165, 460, 70, true, () => { UI.roomTab = 'walls'; });
      const L = tb === 'floor' ? roomFloors() : ROOM_WALLS, cur = roomNow(tb);
      L.forEach(([v, nm], i) => add((tb === 'floor' ? 'fl_' : 'wl_') + v, nm + (cur === v ? '  ·  ON' : ''), 40 + (i % 2) * 484, 265 + Math.floor(i / 2) * 95, 460, 85, true, () => roomPick(tb, v, nm)));
      add('rback', 'BACK', 230, 640, 564, 96, true, () => uiOpen('menu')); }
    else if (UI.open === 'toTitle') { title = 'BACK TO TITLE SCREEN?'; const P = play, inGame = P.mode === 'game' && P.sub === 'play';
      sub = (inGame ? 'THE CURRENT GAME WILL END · ' : '') + 'LEAVES VR · TICKETS + PRIZES ARE KEPT';
      add('ttYes', 'YES', 162, 260, 330, 160, true, backToTitle); add('ttNo', 'NO', 532, 260, 330, 160, true, () => uiOpen('menu')); }
    else if (UI.open === 'menu') { const tp = A.tp, inShop = tp && tp.where === 2; title = 'MENU'; { const w = wallet(); sub = '$' + w.cash + ' CASH   ·   ' + w.tickets + ' TICKETS'; }
      // v12 (t388u): the monkey BACKPACK (prizes + accessories inside) and a FLOOR + WALLS square that shows a different floor every 5 s;
      // no BEAM (the pad signs beam) / BUY TICKETS (the ticket machine + its sign) / CLOSE: just the X (or GRIP)
      add('pack', 'BACKPACK', 70, 180, 420, 350, true, () => { UI.packTab = 'prizes'; uiOpen('pack'); }); B[B.length - 1].art = 'pack';
      add('room', 'FLOOR + WALLS', 534, 180, 420, 350, !!window.__setFloor, () => { UI.roomTab = UI.roomTab || 'floor'; uiOpen('room'); }); B[B.length - 1].art = 'floor';
      // v15 (t398u): background music only (music.js 'neonarcade.music', the same switch as the flat Options MUSIC button); game sounds + voice chat stay
      add('toTitle', 'BACK TO TITLE SCREEN', 524, 546, 430, 58, true, () => uiOpen('toTitle'));   // vrtest-v5 (Dave t462u)
      { const mu = window.__music, on = !mu || mu.on !== false; add('music', on ? 'MUTE MUSIC' : 'MUSIC ON', 70, 546, 430, 58, !!(mu && mu.setOn), () => { mu.setOn(!(mu.on !== false)); say(mu.on ? 'MUSIC ON' : 'MUSIC MUTED · GAME SOUNDS + VOICE STAY ON'); UI.key = ''; });
        if (!on) B[B.length - 1].sel = true; }
      // v14 (t396u): voice chat. MIC ON asks for the mic (only on this tap), then the same button mutes / unmutes; ✕ VC leaves voice
      const vc = window.__voice, vin = !!(vc && vc.state !== 'off');
      const N = window.__nkGame, inNK = !!(tp && tp.where === 3 && N && N.setScenery && !N.noRoof);   // vrtest-v20 (Dave t503u): in Neon Knockout this slot = SCENERY
      if (inNK) { add('nkScenery', 'SCENERY: ' + (N.sceneryWant !== N.scenery ? 'LOADING…' : N.scenery === 'rooftop' ? 'ROOFTOP' : 'STUDIO'), 70, 620, 520, 100, true, () => { const nx = N.sceneryWant === 'rooftop' ? 'studio' : 'rooftop'; N.setScenery(nx).then(() => { UI.key = ''; }); say(nx === 'rooftop' ? 'SCENERY: CYBERPUNK ROOFTOP' : 'SCENERY: NEON STUDIO'); UI.key = ''; }); if (N.sceneryWant === 'rooftop') B[B.length - 1].sel = true; }
      else if (!inShop) add('nb', 'PLAY NEON BRICKS', 70, 620, 520, 100, !!nbApi(), nbStart);
      else add('shop', 'PRIZE SHOP', 70, 620, 520, 100, !!A.shop, () => uiOpen('shop'));
      add('mic', vc ? vc.label() : 'MIC ON', 610, 620, vin ? 224 : 344, 100, !!vc, vcTap); if (vc && vc.state === 'on') B[B.length - 1].sel = !vc.muted;
      if (vin) add('voff', '✕ VC', 846, 620, 108, 100, true, () => { vc.leave(); say('VOICE CHAT OFF'); }); }
    return { title, sub, body, B }; }
  // ---- backpack: Grok Shop prizes + claw plushes, held through shop.js's two-hand API (hold(id, 'R'|'L') / unhold(slot)) ----
  const J = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  // t355u: the menu shows your money (kiosk cash) and tickets, live (the panel redraws when the text changes)
  function wallet() { const k = kiosk(); let cash = 0; try { if (k && k.refill) k.refill(); cash = k && k.C ? k.C.bal | 0 : 0; } catch (e) {} const t = play.tickets; return { cash, tickets: t ? t.total | 0 : 0 }; }
  S.wallet = () => wallet();
  // ---- t365u: floor + walls from the headset menu, free (main.js setFloor / setWalls; index.html resets to cobble + medieval on every load) ----
  const ROOM_FLOORS = [['cobble', 'COBBLESTONE'], ['neon', 'NEON'], ['carpet', 'CHARACTER CARPET'], ['checkers', 'CHECKERS'], ['lava', 'LAVA'], ['ice', 'ICE']];
  const ROOM_WALLS = [['medieval', 'MEDIEVAL'], ['current', 'NEON PANELS'], ['viking', 'VIKING RUNES'], ['portals', 'PORTALS']];
  function roomFloors() { return ROOM_FLOORS; }
  const roomNow = k => { try { return localStorage.getItem('neonarcade.' + k); } catch (e) { return null; } };   // main.js setFloor / setWalls write these
  function roomPick(kind, v, nm) { try { if (kind === 'floor') window.__setFloor(v); else window.__setWalls(v); } catch (e) { S.lastError = 'room ' + e; return; }
    S.roomPicks = (S.roomPicks || 0) + 1; say((kind === 'floor' ? 'FLOOR: ' : 'WALLS: ') + nm); }
  S.room = () => ({ floor: roomNow('floor'), walls: roomNow('walls'), picks: S.roomPicks || 0, floors: roomFloors().map(f => f[0]), wallsList: ROOM_WALLS.map(w => w[0]), random: !window.__noRandomRoom });
  S.uiSub = () => { try { return uiSpec().sub; } catch (e) { return null; } };
  function heldNow() { const v = J('neonarcade.held', null); if (typeof v === 'string') return { R: v, L: null }; return { R: (v && v.R) || null, L: (v && v.L) || null }; }
  const CLAWN = { bear: 'TEDDY BEAR', bunny: 'BUNNY', duck: 'DUCKY', frog: 'FROG', cat: 'KITTY', octopus: 'OCTOPUS', penguin: 'PENGUIN', alien: 'ALIEN', monkey: 'MONKEY', grok: 'GROK' };   // inventory.js CLAW names
  function packItems(sh) { const out = [], p = J('neonarcade.prizes', {}), byId = {}; for (const it of sh.ITEMS || []) byId[it.id] = it;
    for (const id in p) if ((p[id] | 0) > 0 && byId[id]) out.push({ id, name: byId[id].name.toUpperCase(), n: p[id] | 0, src: 'shop' });
    const cl = J('arcade_clawMachine.collection', {}); for (const k in cl) if ((cl[k] | 0) > 0) out.push({ id: 'claw:' + k, name: (CLAWN[k] || k.toUpperCase()) + ' PLUSH', n: cl[k] | 0, src: 'claw' });
    return out; }
  function packTap(sh, it) { const h = heldNow();
    if (h.R === it.id) { sh.unhold('R'); S.packUnequips = (S.packUnequips || 0) + 1; say('PUT AWAY: ' + it.name); return; }
    if (h.L === it.id) { sh.unhold('L'); S.packUnequips = (S.packUnequips || 0) + 1; say('PUT AWAY: ' + it.name); return; }
    const slot = !h.R ? 'R' : !h.L ? 'L' : 'R'; const r = sh.hold(it.id, slot) || heldNow();
    if (r.R === it.id || r.L === it.id) { S.packEquips = (S.packEquips || 0) + 1; say('HOLDING ' + it.name + (r.L === it.id ? ' · LEFT HAND' : r.L || slot === 'R' && h.L ? ' · RIGHT HAND' : '')); }
    else say("CAN'T HOLD " + it.name + ' YET'); }
  S.pack = { items: () => { const sh = A.shop || window.__shop; return sh ? packItems(sh) : []; }, held: heldNow };
  function drawPackIcon(g, x, y, s) {   // little brown monkey backpack
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = '#7a4a24'; g.beginPath(); g.roundRect ? g.roundRect(-30, -26, 60, 64, 14) : g.rect(-30, -26, 60, 64); g.fill();
    g.strokeStyle = '#4a2a10'; g.lineWidth = 5; g.beginPath(); g.arc(0, -26, 14, Math.PI, 0); g.stroke();
    g.fillStyle = '#9a6a3e'; g.beginPath(); g.arc(0, 8, 19, 0, 7); g.fill(); g.beginPath(); g.arc(-19, -2, 8, 0, 7); g.arc(19, -2, 8, 0, 7); g.fill();
    g.fillStyle = '#f0c99a'; g.beginPath(); g.ellipse(0, 13, 13, 10, 0, 0, 7); g.fill(); g.fillStyle = '#1a0d05'; g.beginPath(); g.arc(-6, 3, 3, 0, 7); g.arc(6, 3, 3, 0, 7); g.fill();
    g.restore(); }
  // ---------- t360u: CHAT WITH GROK in VR. Same chat as the flat game (grokchat.js: openChat(source) makes Grok face you, ask(text) answers from
  // its offline knowledge base and makes him talk). There is no keyboard in the headset, so the typed box becomes ray-clickable questions. ----------
  const CHAT_QS = ['WHAT GAMES ARE THERE?', 'HOW DO I GET TICKETS?', 'WHAT CAN I WIN IN THE SHOP?', 'WHAT ARE YOU DOING?', 'TELL ME A JOKE', 'WHO ARE YOU?', 'HOW DO I OPEN LEVEL 2?', 'HOW DOES THE WARDROBE WORK?',
    'HOW DOES THE BACKPACK WORK?', 'HOW DO I CHANGE CHARACTER?', 'HOW DO I PLAY BERSERKER?', 'HOW DO I PLAY SKY TOWER?', 'HOW DO I PLAY NEON BRICKS?', 'HOW DO I PLAY GOLF?', 'HOW DOES THE CLAW MACHINE WORK?', 'WHAT ARE VIKING TICKETS?',
    'HOW DO I GET CASH?', 'CAN I PLAY WITH FRIENDS?', 'WHAT TIME IS IT?', 'WHAT DO YOU LIKE TO EAT?', 'THANKS GROK!', 'BYE GROK!'];
  const chatApi = () => window.__grokChat || null;
  function chatStart(src) { const C = chatApi(); if (!C || !C.hooks || !C.hooks[src]) return false; if (C.open && C.ctx && C.ctx.source !== src) C.close('vr');
    if (!C.open) C.openChat(src); if (!C.open) return false; try { C.input && C.input.blur(); } catch (e) {}
    UI.chatSrc = src; uiOpen('chat'); UI.chatSeq = C.seq || 0; UI.typed = ''; UI.chatQ = ''; const lg = C.log.filter(e => e.who === 'g'); UI.chatA = lg.length ? lg[lg.length - 1].text : ''; S.chatOpens = (S.chatOpens || 0) + 1; return true; }
  function chatEnd() { if (!inChat()) return; const C = chatApi(); try { if (C && C.open) C.close('vr'); } catch (e) {} UI.chatSrc = null; }
  function chatAsk(q, via) { const C = chatApi(); if (!C || !C.open) return; UI.chatQ = q; UI.chatA = C.ask(q, via || 'pick') || ''; UI.chatSeq = C.seq || 0; S.chatAsks = (S.chatAsks || 0) + 1; UI.key = ''; }
  S.chat = { start: chatStart, ask: chatAsk, get q() { return UI.chatQ || ''; }, get a() { return UI.chatA || ''; }, qs: CHAT_QS };
  function wrapText(g, text, maxW) { const out = []; for (const para of String(text || '').split('\n')) { let line = ''; for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } out.push(line); } return out; }
  function uiDraw() { const sp = uiSpec(); UI.btns = sp.B; const msg = UI.msgT > 0 ? UI.msg : '';
    const key = sp.title + '|' + sp.sub + '|' + (sp.body || '') + '|' + msg + '|' + UI.hover + '|' + (UI.open === 'menu' ? floorNow()[0] : '') + '|' + sp.B.map(b => b.id + b.label + b.on + (b.sel ? 's' : '')).join(',') + '|ir' + ((window.__shop && window.__shop.iconRev) || 0); if (key === UI.key) return; UI.key = key;
    const { cv, g, tex } = uiM.userData; g.clearRect(0, 0, 1024, 768);
    g.fillStyle = 'rgba(10,6,24,0.92)'; g.strokeStyle = '#3ff3ff'; g.lineWidth = 8; g.beginPath(); g.roundRect ? g.roundRect(4, 4, 1016, 760, 40) : g.rect(4, 4, 1016, 760); g.fill(); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffe14a'; g.font = '900 64px "Arial Black", Arial, sans-serif'; g.fillText(sp.title, UI.open === 'pack' ? 500 : 470, 70, UI.open === 'pack' ? 740 : 820);
    g.fillStyle = '#9ff8ff'; g.font = '900 34px "Arial Black", Arial, sans-serif'; g.fillText(sp.sub, 512, 140, 960);
    for (const b of sp.B) { const hv = UI.hover === b.id && b.on; g.fillStyle = !b.on ? 'rgba(60,60,80,0.6)' : hv ? '#ff3fd2' : b.sel ? 'rgba(255,225,74,0.30)' : 'rgba(0,229,255,0.22)'; g.strokeStyle = b.on ? (hv ? '#ffffff' : b.sel ? '#ffe14a' : '#3ff3ff') : '#555a70'; g.lineWidth = 6;
      g.beginPath(); g.roundRect ? g.roundRect(b.x, b.y, b.w, b.h, 24) : g.rect(b.x, b.y, b.w, b.h); g.fill(); g.stroke();
      if (b.art || b.ic) { tileArt(g, b); continue; }
      g.fillStyle = b.on ? '#ffffff' : '#9097a8'; g.font = '900 ' + Math.round(Math.min(48, b.h * 0.42)) + 'px "Arial Black", Arial, sans-serif'; g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2, b.w - 24); }
    if (UI.open === 'pack' || UI.open === 'ward') drawPackIcon(g, 70, 72, 0.95);
    if (sp.body) { g.save(); g.fillStyle = 'rgba(13,42,64,0.9)'; g.strokeStyle = '#00e5ff'; g.lineWidth = 3; g.beginPath(); g.roundRect ? g.roundRect(30, 168, 964, 196, 18) : g.rect(30, 168, 964, 196); g.fill(); g.stroke();
      let fs = 30, lines; for (; fs >= 20; fs -= 2) { g.font = '600 ' + fs + 'px Arial, sans-serif'; lines = wrapText(g, sp.body, 920); if (lines.length * fs * 1.22 <= 176) break; }
      g.textAlign = 'left'; g.fillStyle = '#e8f6ff'; lines.slice(0, 8).forEach((l, i) => g.fillText(l, 52, 190 + fs * 0.6 + i * fs * 1.22)); g.restore(); }
    if (msg) { g.fillStyle = '#ffe14a'; g.font = '900 38px "Arial Black", Arial, sans-serif'; g.fillText(msg, 512, UI.open === 'pack' ? 722 : UI.open === 'ward' ? 726 : UI.open === 'shop' ? 688 : UI.open === 'menu' ? 600 : 715, UI.open === 'ward' || UI.open === 'pack' ? 600 : 640); }
    tex.needsUpdate = true; }
  // v12 (t388u): picture tiles: the real monkey backpack art (inventory.js's #bPack canvas), the cycling floor, or a big emoji + name
  function tileArt(g, b) { const pad = 18, lh = Math.max(26, Math.min(44, b.h * 0.13)), ih = b.h - lh - pad * 2.2, cx = b.x + b.w / 2;
    g.save(); g.beginPath(); g.rect(b.x + 6, b.y + 6, b.w - 12, b.h - 12); g.clip();
    if (b.art === 'shopRow') {
      const ts = Math.min(80, b.h - 16), tx = b.x + 12, ty = b.y + (b.h - ts) / 2;
      g.fillStyle = 'rgba(8,12,24,0.55)'; g.beginPath(); g.roundRect ? g.roundRect(tx, ty, ts, ts, 12) : g.rect(tx, ty, ts, ts); g.fill();
      if (b.pix && window.__shop && window.__shop.iconBlit && window.__shop.iconBlit(g, b.pix, tx + 4, ty + 4, ts - 8, ts - 8)) S.menuArt.icons = (S.menuArt.icons || 0) + 1;
      else if (b.ic) { g.font = '600 36px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(b.ic, tx + ts / 2, ty + ts / 2); }
      g.fillStyle = b.on ? '#ffffff' : '#9097a8'; g.font = '900 ' + Math.round(Math.min(40, b.h * 0.42)) + 'px "Arial Black", Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(b.label, tx + ts + 16, b.y + b.h / 2 + 2, b.w - ts - 40); g.restore(); return;
    }
    if (b.art === 'pack') { const pc = document.querySelector('#bPack canvas'), sz = Math.min(ih, b.w - pad * 2); if (pc && pc.width) g.drawImage(pc, cx - sz / 2, b.y + pad, sz, sz); else drawPackIcon(g, cx, b.y + pad + sz / 2, sz / 70); S.menuArt.pack = pc && pc.width ? 'bPack' : 'icon'; }
    else if (b.art === 'floor') { const [v, nm] = floorNow(), im = floorImg(v), w = b.w - pad * 2, h = ih; S.menuArt.floor = v; S.menuArt.floorImg = !!im; S.menuArt.floorDraws = (S.menuArt.floorDraws || 0) + 1; if (im) g.drawImage(im, b.x + pad, b.y + pad, w, h); else { g.fillStyle = '#222'; g.fillRect(b.x + pad, b.y + pad, w, h); }
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(b.x + pad, b.y + pad + h - 46, w, 46); g.fillStyle = '#ffe14a'; g.font = '900 28px "Arial Black", Arial, sans-serif'; g.fillText(nm, cx, b.y + pad + h - 22, w - 12); }
    else if (b.pix && window.__shop && window.__shop.iconBlit && window.__shop.iconBlit(g, b.pix, b.x + pad, b.y + pad, b.w - pad * 2, ih)) { S.menuArt.icons = (S.menuArt.icons || 0) + 1; }
    else { g.font = Math.round(Math.min(ih, b.w * 0.6) * 0.8) + 'px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.fillStyle = '#fff'; g.globalAlpha = b.on ? 1 : 0.45; S.menuArt.icons = (S.menuArt.icons || 0) + 1; g.fillText(b.ic, cx, b.y + pad + ih / 2 + 4); g.globalAlpha = 1; }
    g.fillStyle = b.on ? '#ffffff' : '#9097a8'; g.font = '900 ' + Math.round(lh) + 'px "Arial Black", Arial, sans-serif'; g.fillText(b.label, cx, b.y + b.h - pad - lh / 2 + 2, b.w - 20); g.restore(); }
  function uiHit(ray) { if (!UI.open) return null; uiM.updateMatrixWorld(true);
    const n = _v.set(0, 0, 1).applyQuaternion(uiM.getWorldQuaternion(_q)), den = n.dot(ray.direction); if (Math.abs(den) < 1e-4) return null;
    const t = _hit.copy(uiM.position).sub(ray.origin).dot(n) / den; if (t <= 0 || t > RAY_MAX) return null;
    const p = ray.at(t, new THREE.Vector3()), lp = uiM.worldToLocal(p.clone()), x = (lp.x / 1.0 + 0.5) * 1024, y = (0.5 - lp.y / 0.75) * 768;
    if (x < 0 || x > 1024 || y < 0 || y > 768) return null;
    return { t, p, btn: UI.btns.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null }; }

  // exact ray hit on a flat panel (PlaneGeometry w x h, any scale / parent): distance or null
  const _rn = new THREE.Vector3(), _rp = new THREE.Vector3(), _rq = new THREE.Quaternion(), _rs = new THREE.Vector3();
  function rectHit(ray, m, max = SIGN_MAX) { if (!m.visible) return null; for (let o = m.parent; o; o = o.parent) if (!o.visible) return null;
    m.updateMatrixWorld(true); m.matrixWorld.decompose(_rp, _rq, _rs); _rn.set(0, 0, 1).applyQuaternion(_rq); const den = _rn.dot(ray.direction); if (Math.abs(den) < 1e-5) return null;
    const t = _hit.copy(_rp).sub(ray.origin).dot(_rn) / den; if (t <= 0 || t > max) return null;
    const lp = m.worldToLocal(ray.at(t, new THREE.Vector3())), gp = m.geometry.parameters || { width: 1, height: 1 };
    return Math.abs(lp.x) <= gp.width / 2 && Math.abs(lp.y) <= gp.height / 2 ? t : null; }
  S.rectHit = rectHit; S.rayLens = () => { const o = {}; for (const c of ctrls) if (c.userData.hand) o[c.userData.hand] = { len: c.userData.rayLen, o: c.userData.rayO }; return o; };
  // ---------- in-world signs (VR only): point + trigger ----------
  function makeSign(text, color) { const m = panel(0.95, 0.24, 512, 128); m.renderOrder = 1000; m.material.depthTest = true; drawPanel(m, [text], { c0: color || '#ffe14a', border: color || '#3ff3ff' }); m.visible = false; scene.add(m); return m; }
  const signs = [];
  function addSign(id, text, color, where, act, show) { const m = makeSign(text, color); m.name = 'vrSign_' + id; signs.push({ id, m, where, act, show }); return m; }
  const padTop = (w, y = 2.05) => { const tp = A.tp; if (!tp) return null; const P = w === 1 ? tp.PAD1 : w === 4 ? tp.PAD4 : w === 3 ? tp.PAD3 : tp.PAD2; return P ? [P.x, y, P.z] : null; };
  addSign('tickets', 'BUY TICKETS', '#ffe14a', () => { const K = kiosk(); if (!K || !K.K) return null; const p = K.K.getWorldPosition(new THREE.Vector3()); return [p.x, 1.95, p.z]; }, () => uiOpen('tickets'), () => !!kiosk() && (!A.tp || A.tp.where === 1));
  addSign('beamArcade', 'BEAM TO ARCADE', '#3ff3ff', () => padTop(2), beam, () => A.tp && A.tp.where === 2 && A.tp.state === 'idle');
  // v17 (t494u): NEON KNOCKOUT has its own SW pad (PAD4); the original pad is shop only. Return from the studio is still on PAD3.
  // v18 (t500u): no extra 'BEAM TO SHOP' / 'BEAM TO NEON KNOCKOUT' signs above the pads — the existing SHOP /
  // NEON KNOCKOUT labels are what you point at to beam (same position). BEAM TO ARCADE over the shop / studio pads stays.
  function padLabel(name) { return (A.tp && A.tp.labels || []).find(o => o.name === name) || scene.getObjectByName(name) || null; }
  function addPadLabelSign(id, name, act, show) { signs.push({ id, m: padLabel(name), name, act, show, keep: true, where: () => { const m = padLabel(name); return m ? [m.position.x, m.position.y, m.position.z] : null; } }); }
  addPadLabelSign('beamShop', 'teleportLabel_SHOP', () => beam('shop'), () => A.tp && A.tp.where === 1 && A.tp.state === 'idle' && !!A.tp.PAD1);
  addPadLabelSign('beamNK', 'teleportLabel_NEONKNOCKOUT', () => beam('nk'), () => A.tp && A.tp.where === 1 && A.tp.state === 'idle' && !!A.tp.PAD4);
  // v19 (t411u, Dave: "can't play mini golf in VR"): the stairwell's energy shield only had a flat-screen PAY button. In the headset a sign
  // over the shield: trigger = pay 5 tickets (only if you have them) and the shield drops; then walk down the stairs with the stick.
  const golfA = () => A.golf || null;
  // v23 (Dave t432u): mini golf is free and open: no PAY sign; just walk down the stairs.
  function golfPay() { const G = golfA(); if (!G) return false; const t = play.tickets.total;
    if (G.unlock()) { S.golfPays = (S.golfPays || 0) + 1; S.msg = 'SHIELD DOWN · WALK DOWN THE STAIRS TO PLAY'; S.msgT = 3.5; return true; }
    return false; }
  S.golfPay = golfPay;
  // putting: near a ball (3 m) your pointing hand aims instead of teleporting. Point at the green where the ball should go (further = harder),
  // HOLD the trigger to aim (line + putter), LET GO to putt; grip while aiming cancels. The other hand still teleports.
  const GV = { hand: null };
  function golfVR(L, R) { const G = golfA(), h0 = S.head; if (!G || !G.below || !h0) { GV.hand = null; return null; }
    const h = G.vrNear(h0.x, h0.z); if (!h) { if (G.aiming && G.vr && !G.rolling) G.stopAim(); GV.hand = null; return null; }
    if (G.rolling) { GV.hand = null; return 'rolling'; }
    if (!GV.hand) { if (R && R.trigDown) GV.hand = 'right'; else if (L && L.trigDown) GV.hand = 'left'; }
    const hand = GV.hand || 'right', c = ctrlFor(hand), P = hand === 'right' ? R : L; if (!c || !P) return null;
    if (GV.hand && ((L && L.gripDown) || (R && R.gripDown))) { if (G.aiming && G.vr) G.stopAim(); GV.hand = null; S.msg = 'PUTT CANCELLED'; S.msgT = 1.5; return hand; }
    const ray = rayOf(c), b = G.ballAt(h); let p = null;
    if (ray.direction.y < -0.02) { const t = (b.y - ray.origin.y) / ray.direction.y; if (t > 0 && t < 25) { p = ray.at(t, _hit); c.userData.ray.scale.z = t; c.userData.ray.material.color.setHex(0xffb000); dot.position.copy(p); dot.visible = true; } }
    if (GV.hand) {
      if (P.trig) { if (p) { const ang = Math.atan2(p.x - b.x, p.z - b.z), pw = Math.min(1, Math.hypot(p.x - b.x, p.z - b.z) / 3.0); G.vrAim(h, ang, pw); S.golfAim = { ang, pw }; } }
      else { if (G.aiming && G.vr && G.vrStrike()) { pulse(P.src, 0.8, 50); S.golfPutts = (S.golfPutts || 0) + 1; } else if (G.aiming && G.vr) G.stopAim(); GV.hand = null; } }
    return hand; }
  S.golfVR = () => ({ hand: GV.hand, aiming: !!(golfA() && golfA().aiming), vr: !!(golfA() && golfA().vr) });
  addSign('beamArcadeNK', 'BEAM TO ARCADE', '#3ff3ff', () => padTop(3), beam, () => A.tp && A.tp.where === 3 && A.tp.state === 'idle' && !nkPlaying());
  addSign('shop', 'PRIZE SHOP', '#ff3fd2', () => { const g = A.shop && A.shop.grok; if (!g) return null; const p = g.getWorldPosition(new THREE.Vector3()); return [p.x, p.y + 2.3, p.z]; }, () => uiOpen('shop'), () => A.tp && A.tp.where === 2 && !!A.shop && !grokAway());
  // t356u/t358u: the shop mirror. shop.js's Reflector is 512x420 (blurred in a headset) and its own hook only draws within 12 m of the
  // camera, so in VR it stayed frozen after you beamed in until you walked halfway over. In VR a twin Reflector of vr.js's own takes
  // its place (same geometry and transform; shop.js is not edited). It is sharp: 1536 px on the long side (1024 on the low tier), glass aspect,
  // linear, no mipmaps. vr.js draws it once per frame with the head camera: every frame within MIRROR_NEAR m or while you are reflected in it,
  // every MIRROR_FAR_EVERY frames out to MIRROR_FAR m, and only while it is in view and facing you. On exit the shop's own mirror comes back.
  const MIRROR_NEAR = 8, MIRROR_FAR = 25, MIRROR_FAR_EVERY = 2, _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _mp = new THREE.Vector3(), _mn = new THREE.Vector3(), _mc = new THREE.Vector3();
  const MV = { twin: null, src: null, draw: null, renders: 0, skips: 0, far: 0 };
  function mirrorTwin() { const m = mirrorMesh(); if (!m || !m.parent) return null;
    if (MV.twin && MV.src === m) return MV.twin;
    const gp = m.geometry && m.geometry.parameters, gw = (gp && gp.width) || 1, gh = (gp && gp.height) || 1, L = A.TIER && A.TIER.name === 'low' ? 768 : 1024;   // TEST v1 (VR memory): was 1536 / 1024
    const w = gh >= gw ? Math.round(L * gw / gh) : L, h = gh >= gw ? L : Math.round(L * gh / gw);
    const col = (m.material && m.material.uniforms && m.material.uniforms.color) ? m.material.uniforms.color.value.getHex() : 0xa8c4d4;
    const t = new Reflector(m.geometry, { textureWidth: w, textureHeight: h, color: col, multisample: 0 });
    const tx = t.getRenderTarget().texture; tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter; tx.generateMipmaps = false;
    t.name = 'vrMirrorTwin'; t.position.copy(m.position); t.quaternion.copy(m.quaternion); t.scale.copy(m.scale); m.parent.add(t);
    MV.draw = t.onBeforeRender; t.onBeforeRender = () => {};   // never from the per-eye XR passes; post() draws it once per frame
    MV.twin = t; MV.src = m; return t; }
  function mirrorVR(on) { const m = mirrorMesh(), t = on ? mirrorTwin() : MV.twin; if (t) t.visible = !!on;
    if (m) { if (on && t) { if (m.userData.vrLayers == null) m.userData.vrLayers = m.layers.mask; m.layers.set(31); }   // shop.js keeps toggling .visible, so hide it from every camera by layer
      else if (m.userData.vrLayers != null) { m.layers.mask = m.userData.vrLayers; m.userData.vrLayers = null; } } }
  // vrtest-v6 (t464u) debug URL flags for bisecting the shop freezes on the Quest (golf.js reads ?nogolfroom=1 ?nogolflamps=1):
  // ?nomirror=1 no VR mirror at all (twin hidden + never re-rendered, shop's own mirror hidden), ?nogrok=1 hides Grok, ?nowarm=1 skips pre-warm.
  function dbg() { const q = location.search, f = n => new RegExp('[?&]' + n + '=1\\b').test(q);
    if (!window.__gaDbg) window.__gaDbg = { nomirror: f('nomirror'), nogolfroom: f('nogolfroom'), nogolflamps: f('nogolflamps'), nogrok: f('nogrok'), nowarm: f('nowarm'), golfold: /[?&]golflights=old\b/.test(q), noveil: f('noveil'), warmlog: f('warmlog') };
    const D = window.__gaDbg; if (D.warmlog == null) D.warmlog = f('warmlog');   // golf.js may build __gaDbg first
    if (D.oldacc == null) { D.oldacc = f('oldacc'); D.noatlas = f('noatlas'); D.nofiretypes = f('nofiretypes'); D.olddim = f('olddim'); D.beamlog = f('beamlog'); }
    return D; }
  S.dbg = dbg;
  // vrtest-v16 (t492u): ?beamlog=1 — after each beam, a small panel in VR shows the worst frame in the
  // 3 s around the cut, shader / texture / geometry uploads, and whether an atlas bake, pre-warm, a
  // long task or an audio decode ran, plus the first objects drawn in that window. Dave can read it out.
  const BL = { on: false, frames: [], ev: [], first: [], seen: new WeakSet(), lastT: 0, lastP: 0, lastTx: 0, lastG: 0, texMB: 0, active: null, report: null, panel: null, until: 0, hook: false, bakeHook: false };
  function blOn() { return !!dbg().beamlog; }
  function blEv(n) { if (!blOn()) return; BL.ev.push({ t: performance.now(), n }); if (BL.ev.length > 100) BL.ev.shift(); }
  function blTickFrame(ms) {
    if (!blOn() || !S.presenting) return;
    const i = renderer.info, p = i.programs ? i.programs.length : 0, tx = i.memory.textures, g = i.memory.geometries;
    const rec = { t: performance.now(), ms, dp: Math.max(0, p - (BL.lastP || p)), dtx: Math.max(0, tx - (BL.lastTx || tx)), dg: Math.max(0, g - (BL.lastG || g)) };
    BL.lastP = p; BL.lastTx = tx; BL.lastG = g;
    BL.frames.push(rec); const cut = rec.t - 4500; while (BL.frames.length && BL.frames[0].t < cut) BL.frames.shift();
    if (BL.active) scene.traverseVisible(o => { if ((o.isMesh || o.isPoints || o.isLine) && !BL.seen.has(o)) { BL.seen.add(o); if (BL.first.length < 24) BL.first.push(o.name || o.type); } });
  }
  function blEnsure() {
    if (BL.hook || !blOn()) return; BL.hook = true;
    const r = renderer, o = r.render.bind(r);
    r.render = function (s, c) { const out = o(s, c); if (r.xr.isPresenting && s === scene && !S.inMirror) { const n = performance.now(), ms = BL.lastT ? n - BL.lastT : 0; BL.lastT = n; if (ms) blTickFrame(ms); } return out; };
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) if (e.duration >= 50) blEv('long ' + Math.round(e.duration) + 'ms'); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC && AC.prototype.decodeAudioData && !AC.prototype.__gaBl) { const d0 = AC.prototype.decodeAudioData; AC.prototype.decodeAudioData = function () { blEv('audioDecode'); return d0.apply(this, arguments); }; AC.prototype.__gaBl = 1; } } catch (e) {}
    try { const gl = r.getContext();
      const add = (n, wf, hf) => { const f = gl[n]; if (typeof f !== 'function') return; gl[n] = function () { if (BL.active) { const w = (typeof arguments[wf] === 'number' && arguments[wf]) || 0, h = (typeof arguments[hf] === 'number' && arguments[hf]) || 0; BL.texMB += w && h ? w * h * 4 / (1024 * 1024) : 0.05; } return f.apply(this, arguments); }; };
      add('texImage2D', 3, 4); add('texStorage2D', 3, 4); add('compressedTexImage2D', 3, 4); } catch (e) {}
  }
  function blHookBake() {
    if (BL.bakeHook || !blOn()) return; const sh = window.__shop; if (!sh || !sh.bakeIcons) return; BL.bakeHook = true;
    const orig = sh.bakeIcons.bind(sh); sh.bakeIcons = function () { const r = orig.apply(this, arguments); if (r && r.did) blEv('atlasBake ' + r.did + ' ' + Math.round(r.ms) + 'ms'); return r; };
  }
  function blDraw(rep) {
    if (!BL.panel) { BL.panel = panel(0.5, 0.38, 1024, 780); BL.panel.name = 'vrBeamLog'; BL.panel.renderOrder = 2001; scene.add(BL.panel); }
    const flags = [rep.atlas && 'ATLAS BAKE', rep.warm && 'PRE-WARM', rep.longTask && 'LONG TASK', rep.audio && 'AUDIO DECODE'].filter(Boolean);
    const lines = ['BEAM ' + String(rep.dest || '?').toUpperCase(), 'WORST FRAME  ' + rep.worstMs + ' ms',
      'SHADERS +' + rep.progs + '   TEX +' + rep.tex + (rep.texMB ? '  ' + rep.texMB + ' MB' : ''), 'GEOMETRY +' + rep.geo,
      flags.length ? flags.join('  ') : 'no bake / warm / long task / audio', 'FIRST  ' + (rep.first.slice(0, 8).join(', ') || '(none)')];
    drawPanel(BL.panel, lines, { border: '#ffde00', c0: '#ffde00' }); BL.panel.visible = true;
  }
  function blPlace() {
    if (!BL.panel || !BL.panel.visible) return;
    if (performance.now() > BL.until) { BL.panel.visible = false; return; }
    if (!S.head && !camera) return; camera.updateMatrixWorld(true); camera.getWorldQuaternion(BL.panel.quaternion); camera.getWorldPosition(BL.panel.position);
    BL.panel.position.add(_v.set(0, -0.06, -1.2).applyQuaternion(BL.panel.quaternion));
  }
  function blFinalize() {
    const a = BL.active; if (!a) return;
    const t0 = a.t0 - 500, t1 = a.t0 + 2500, fr = BL.frames.filter(f => f.t >= t0 && f.t <= t1);
    const worst = fr.reduce((m, f) => f.ms > m.ms ? f : m, { ms: 0 });
    const ev = BL.ev.filter(e => e.t >= t0 && e.t <= t1).map(e => e.n);
    const sh = window.__shop && window.__shop.iconAtlas, bakeN = (sh && sh.bakeN) || 0, bakeMs = (sh && sh.bakeMs) || 0;
    const rep = { dest: a.dest, worstMs: +((worst.ms) || 0).toFixed(1), frames: fr.length,
      progs: fr.reduce((s, f) => s + f.dp, 0), tex: fr.reduce((s, f) => s + f.dtx, 0), texMB: +Math.max(0, BL.texMB - (a.texMB0 || 0)).toFixed(2),
      geo: fr.reduce((s, f) => s + f.dg, 0), atlas: ev.some(n => n.indexOf('atlas') === 0) || bakeN > (a.bake0 || 0),
      warm: ev.some(n => n.indexOf('warm') === 0) || !!(PW.busy && PW.startedAt && PW.startedAt <= t1 && (PW.startedAt + (PW.ms || 0) >= t0 || !PW.done)),
      longTask: ev.some(n => n.indexOf('long ') === 0), audio: ev.some(n => n.indexOf('audio') === 0),
      first: BL.first.slice(), ev: ev.slice(0, 16), bakeDelta: bakeN - (a.bake0 || 0), bakeMs: +(bakeMs - (a.bakeMs0 || 0)).toFixed(1) };
    BL.report = rep; BL.active = null; BL.until = performance.now() + 14000; blDraw(rep);
  }
  function blStep() {
    if (!blOn()) { if (BL.panel) BL.panel.visible = false; return; }
    blEnsure(); blHookBake();
    if (PW && PW.busy && PW.cur) { const k = 'warm ' + (PW.cur.area || '') + ':' + (PW.cur.kind || ''); if (BL._warm !== k) { BL._warm = k; blEv(k); } }
    const tp = A.tp;
    if (tp && tp.state !== 'idle' && !BL.active) {
      BL.active = { t0: performance.now(), dest: tp.dest || (tp.where === 2 ? 'shop' : tp.where === 3 ? 'nk' : 'arcade'), bake0: (window.__shop && window.__shop.iconAtlas && window.__shop.iconAtlas.bakeN) || 0, bakeMs0: (window.__shop && window.__shop.iconAtlas && window.__shop.iconAtlas.bakeMs) || 0, texMB0: BL.texMB };
      BL.first = [];
    }
    if (BL.active && !BL.active.idleAt && tp && tp.state === 'idle' && performance.now() - BL.active.t0 > 80) BL.active.idleAt = performance.now();
    if (BL.active && performance.now() >= BL.active.t0 + 2500 && (!BL.active.idleAt || performance.now() >= BL.active.idleAt + 200)) blFinalize();
    blPlace();
  }
  S.beamLog = () => BL.report; S.beamLogTick = blStep;

  function mirrorFrame() { if (VEIL.on) return; if (dbg().nomirror) { const m = mirrorMesh(); if (MV.twin) MV.twin.visible = false; if (m) m.layers.set(31); return; }
    const t = mirrorTwin(); if (!t || !S.head) return; if (!t.visible || mirrorMesh().layers.mask !== (1 << 31)) mirrorVR(true);
    t.getWorldPosition(_mp); t.getWorldDirection(_mn); camera.updateMatrixWorld(true); camera.getWorldPosition(_mc);
    const d = _mp.distanceTo(_mc); if (d > MIRROR_FAR || (_mn.x * (_mc.x - _mp.x) + _mn.y * (_mc.y - _mp.y) + _mn.z * (_mc.z - _mp.z)) <= 0) { MV.skips++; return; }
    if (!t.geometry.boundingSphere) t.geometry.computeBoundingSphere();
    _fr.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); if (!_fr.intersectsObject(t)) { MV.skips++; return; }
    const mk = monkey.position, toMk = _mn.x * (mk.x - _mp.x) + _mn.z * (mk.z - _mp.z), seen = toMk > 0 && Math.hypot(mk.x - _mp.x, mk.z - _mp.z) < 12;
    if (d > MIRROR_NEAR && !seen && (S.frames % MIRROR_FAR_EVERY)) { MV.skips++; return; }
    if (d > MIRROR_NEAR && !seen) MV.far++;
    const vis = monkey.visible; monkey.visible = true;   // you see yourself in it
    // t364u: your own first-person things (controller models + rings, rays, cursor, HUD, menu, charge glow) sit right in front of the mirror
    // camera, so they reflected as huge arms and pink rings. The mirror shows only the avatar (with its small hand controllers).
    const fp = fpList(), was = fp.map(o => o.visible); for (const o of fp) o.visible = false; MV.fpHidden = fp.length;
    S.inMirror = true; pinScan(); pinLights(); try { MV.draw.call(t, renderer, scene, camera); MV.renders++; S.mirrorKicks++; } catch (e) { S.lastError = 'mirror ' + e; } S.inMirror = false; unpinLights();
    fp.forEach((o, i) => { o.visible = was[i]; }); monkey.visible = vis; }
  const _fp = []; function fpList() { _fp.length = 0; for (const o of ctrls) _fp.push(o); for (const o of grips) _fp.push(o); _fp.push(dot, tpRing, hud, uiM); if (VL.glow) _fp.push(VL.glow); if (VL.beamMesh) _fp.push(VL.beamMesh); if (FM.group) _fp.push(FM.group); if (GF.gun) _fp.push(GF.gun, GF.hand, GF.ray); return _fp; }
  S.fpNames = () => fpList().map(o => o.name || o.type);
  S.ctrlFor = ctrlFor;   // vrtest-v2: golf.js puts the held putter on the right controller
  // ---------- t360u: the avatar's arms + hands follow the real controllers (so the mirror shows you holding them) ----------
  // Cheap: per arm, the shoulder turns toward where the controller is relative to your real shoulder (scaled to the avatar), the elbow bends
  // when the hand is close to the body, the hand takes the grip's rotation, and a small controller model sits in each avatar hand.
  const _ha = { ws: new THREE.Vector3(), wp: new THREE.Vector3(), rs: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), pq: new THREE.Quaternion(), gq: new THREE.Quaternion(), dn: new THREE.Vector3(0, -1, 0), fix: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)) };
  const AH = { frames: 0, models: new Map() };
  function handModel(hand) { let m = AH.models.get(hand); if (m && m.parent === hand) return m;
    m = new THREE.Group(); m.name = 'vrAvatarCtrl';
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.09, 10).rotateX(Math.PI / 2 - 0.5), new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: 0.5, metalness: 0.3 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.005, 6, 18), new THREE.MeshStandardMaterial({ color: 0x2a2a34, roughness: 0.5, metalness: 0.3 }));   // v13: no pink ring in the mirror ring.position.set(0, 0.01, -0.025); ring.rotation.x = 0.6;
    m.add(body, ring); const ws = new THREE.Vector3(); hand.getWorldScale(ws); m.scale.setScalar(1 / Math.max(0.05, Math.abs(ws.y))); m.position.set(0, -0.02 / Math.max(0.05, Math.abs(ws.y)), 0); m.rotation.x = -Math.PI / 2; hand.add(m); AH.models.set(hand, m); return m; }
  // one arm solver for your own avatar (mirror) and other VR players' avatars (t362u): h = real head {x, y, z, yaw}, gripOf(hand) = {p, q} world grip pose
  // v13 (t395u, Dave: the mirror hands are "not right"): a real two-bone IK. From the avatar's own shoulder, the upper arm + forearm (their
  // real lengths) bend at the elbow (pointing down / out / back) so the HAND lands on the controller (as far as the arm reaches: no
  // stretching), and the hand takes the controller's rotation. The small controller in the avatar hand is dark (no pink ring), and with
  // the laser pistol in that hand the gun is held instead and points where the controller points (the shot leaves its muzzle).
  const _ik = { S: new THREE.Vector3(), T: new THREE.Vector3(), u: new THREE.Vector3(), pole: new THREE.Vector3(), E: new THREE.Vector3(), H: new THREE.Vector3(), y: new THREE.Vector3(), x: new THREE.Vector3(), z: new THREE.Vector3(), fwd: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), pq: new THREE.Quaternion(), ws: new THREE.Vector3(), flip: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) };
  const IKS = { err: {}, reach: {} };
  const GUN_S = 0.42, GUN_GRIP = new THREE.Vector3(0, -0.09, 0.02), _gf = { m: new THREE.Matrix4(), pi: new THREE.Matrix4(), p: new THREE.Vector3(), s: new THREE.Vector3() };
  function gunFit(pg, q, at) { _gf.p.copy(GUN_GRIP).multiplyScalar(GUN_S).applyQuaternion(q); _gf.p.subVectors(at, _gf.p); _gf.m.compose(_gf.p, q, _gf.s.setScalar(GUN_S));
    pg.parent.updateMatrixWorld(true); _gf.pi.copy(pg.parent.matrixWorld).invert(); pg.matrix.multiplyMatrices(_gf.pi, _gf.m); pg.matrixAutoUpdate = false; pg.userData.vrFit = true; pg.updateMatrixWorld(true); }
  function gunRest(pg) { if (pg && pg.userData.vrFit) { pg.matrixAutoUpdate = true; pg.userData.vrFit = false; pg.updateMatrix(); } }
  function boneQ(dir, fwd, out) {   // a bone whose local -Y runs along dir, local +Z as close to fwd as possible
    _ik.y.copy(dir).negate().normalize(); _ik.x.crossVectors(_ik.y, fwd); if (_ik.x.lengthSq() < 1e-6) _ik.x.crossVectors(_ik.y, _v.set(0, 1, 0.3)); _ik.x.normalize();
    _ik.z.crossVectors(_ik.x, _ik.y).normalize(); _ik.m.makeBasis(_ik.x, _ik.y, _ik.z); return out.setFromRotationMatrix(_ik.m); }
  const _ikM = { w: new THREE.Matrix4(), pi: new THREE.Matrix4(), l: new THREE.Matrix4(), r: new THREE.Matrix4(), fx: new THREE.Vector3(-1, 1, 1) };
  function setWorldQ(o, wq) {   // local rotation that gives o this world rotation, also under a mirrored (scale.x < 0) or scaled parent
    o.parent.updateMatrixWorld(true); _ikM.w.makeRotationFromQuaternion(wq); const pm = o.parent.matrixWorld; if (pm.determinant() < 0) _ikM.w.scale(_ikM.fx);
    _ikM.pi.copy(pm).setPosition(0, 0, 0).invert(); _ikM.l.multiplyMatrices(_ikM.pi, _ikM.w); _ikM.r.extractRotation(_ikM.l); o.quaternion.setFromRotationMatrix(_ikM.r); o.updateMatrixWorld(true); }
  function armIK(arms, h, gripOf, own) { const rx = Math.cos(h.yaw), rz = -Math.sin(h.yaw);   // your right, flat
    for (const arm of arms) { if (!arm || !arm.sh) continue;
      // v13: the arm on YOUR right follows the right controller (by where the shoulder really is: v12 matched 'handR' to the right controller,
      // but the model's handR sits on its other side, so the arms crossed in the mirror)
      arm.sh.getWorldPosition(_ik.S); const side = ((_ik.S.x - h.x) * rx + (_ik.S.z - h.z) * rz) >= 0 ? 'right' : 'left', G = gripOf(side);
      const pg = arm.hand && arm.hand.getObjectByName('gaPistol'), gun = !!(pg && pg.visible);
      const mdl = arm.hand ? handModel(arm.hand) : null; if (mdl) { mdl.visible = !!G && !gun; if (G) { arm.hand.getWorldScale(_ha.ws); mdl.scale.setScalar(Math.min(4, 1 / Math.max(0.05, Math.abs(_ha.ws.y)))); } }   // keep it controller-sized whatever the hand's scale
      if (!G && gun) gunRest(pg);
      if (!G || !arm.el || !arm.hand) continue;
      arm.sh.parent.updateMatrixWorld(true); arm.sh.getWorldPosition(_ik.S);
      for (let it = 0; it < 2; it++) {   // bone lengths measured in the world (the torso can be scaled unevenly), solved twice
      arm.sh.updateMatrixWorld(true); arm.el.getWorldPosition(_ik.E); arm.hand.getWorldPosition(_ik.H); const L1 = _ik.E.distanceTo(_ik.S), L2 = _ik.H.distanceTo(_ik.E);
      _ik.T.copy(G.p); _ik.u.copy(_ik.T).sub(_ik.S); let d = _ik.u.length(); if (d < 1e-5) break; _ik.u.divideScalar(d);
      const full = d; d = Math.min(Math.max(d, Math.abs(L1 - L2) + 1e-3), L1 + L2 - 1e-3); IKS.reach[side] = +(full / (L1 + L2)).toFixed(2);
      // elbow: down, out to your side and a little back
      _ik.fwd.set(-Math.sin(h.yaw), 0, -Math.cos(h.yaw)); _ik.pole.set(rx * arm.sd * 0.55, -1, rz * arm.sd * 0.55).addScaledVector(_ik.fwd, -0.3);
      _ik.pole.addScaledVector(_ik.u, -_ik.pole.dot(_ik.u)); if (_ik.pole.lengthSq() < 1e-6) _ik.pole.set(0, -1, 0); _ik.pole.normalize();
      const ca = Math.min(1, Math.max(-1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))), sa = Math.sqrt(1 - ca * ca);
      _ik.E.copy(_ik.S).addScaledVector(_ik.u, ca * L1).addScaledVector(_ik.pole, sa * L1);
      _ik.H.copy(_ik.S).addScaledVector(_ik.u, d);
      setWorldQ(arm.sh, boneQ(_v.copy(_ik.E).sub(_ik.S), _ik.fwd, _ik.q));
      setWorldQ(arm.el, boneQ(_v.copy(_ik.H).sub(_ik.E), _ik.fwd, _ik.q));
      }
      _ik.q.copy(G.q).multiply(_ha.fix); setWorldQ(arm.hand, _ik.q); arm.hand.visible = true;
      // v15 (t397u): the gun is HELD: a real-size blaster (GUN_S of the model, ~30 cm) whose grip sits in the hand on the controller, barrel (+Z)
      // along the controller's ray (-Z; other players: along their grip). Its world matrix is set directly (the monkey hand is scaled unevenly).
      if (gun) { _ik.q.copy(own ? (G.aq || G.q) : G.q).multiply(_ik.flip); arm.hand.getWorldPosition(_ik.H); gunFit(pg, _ik.q, _ik.H); }
      arm.hand.getWorldPosition(_ik.H); IKS.err[side] = +_ik.H.distanceTo(_ik.T).toFixed(3); } }
  const _gp = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const _gaq = new THREE.Quaternion();
  function myGrip(hand) { const i = ctrls.findIndex(c => c.userData.hand === hand && c.userData.src), g = i >= 0 ? grips[i] : null; if (!g) return null;
    g.updateMatrixWorld(true); _gp.p.setFromMatrixPosition(g.matrixWorld); g.getWorldQuaternion(_gp.q); ctrls[i].updateMatrixWorld(true); ctrls[i].getWorldQuaternion(_gaq); _gp.aq = _gaq; return _gp; }
  function avatarHands() { const u = monkey.userData || {}, arms = u.arms; if (!arms || !S.head) return;
    // v13: the monkey model holds its pistol in 'handR', which is on the model's left as seen from behind; in the headset the avatar is
    // mirrored (scale.x = -1, three.js flips the face winding) so that hand, and the gun, are on your RIGHT with the right controller
    if (monkey.scale.x > 0) { monkey.scale.x = -monkey.scale.x; AH.flipped = true; }
    monkey.updateMatrixWorld(true); armIK(arms, S.head, myGrip, true); AH.frames++; }
  S.ikStats = () => JSON.parse(JSON.stringify(IKS));
  S.ctrlGrips = () => { const out = {}; for (const h of ['left', 'right']) { const g = myGrip(h); if (g) out[h] = g.p.toArray(); } return out; };
  S.laserFromMuzzle = () => VL.fromMuzzle || 0;
  // ---------- v15 (t397u): first person. Your avatar is hidden in your own view, so with the laser pistol out a copy of the monkey's right
  // hand + the held gun is drawn where the mirror shows them (on your right controller); that controller's model and its cone ray are hidden,
  // and a thin ray from the MUZZLE (all aiming / UI pointing for that hand starts there) keeps you able to point at panels. ----------
  const GF = { on: false, ctrl: null, o: new THREE.Vector3(), d: new THREE.Vector3(), hand: null, gun: null, ray: null, frames: 0, src: null };
  function fpGunOff() { if (!GF.on && !(GF.gun && GF.gun.visible)) return; GF.on = false; GF.ctrl = null; for (const o of [GF.hand, GF.gun, GF.ray]) if (o) o.visible = false; ctrlModelsVis(true); }
  function ctrlModelsVis(on, only) { for (let i = 0; i < grips.length; i++) { if (only != null && i !== only) continue; const g = grips[i].userData, parts = [g.fallback, g.model].filter(Boolean);
      if (!on) { if (!g.fpHid) { g.fpHid = parts.map(o => o.visible); } for (const o of parts) o.visible = false; }
      else if (g.fpHid) { parts.forEach((o, k) => { o.visible = g.fpHid[k]; }); g.fpHid = null; } } }
  function fpGun() { const u = monkey.userData || {}, pg = monkey.getObjectByName('gaPistol'), pz = pg && pg.getObjectByName('gaPistolMuzzle');
    const i = ctrls.findIndex(c => c.userData.hand === 'right' && c.userData.src);
    const on = !!(renderer.xr.isPresenting && pg && pg.visible && pz && u.char !== 'alien' && i >= 0 && pg.userData.vrFit) && !nkIn();   // v16: no gun in the boxing studio
    if (!on) { fpGunOff(); return; }
    const hand = pg.parent;
    if (!GF.gun || GF.src !== pg) { if (GF.gun) scene.remove(GF.gun); GF.gun = pg.clone(true); GF.gun.name = 'vrFpGun'; GF.gun.matrixAutoUpdate = false; GF.gun.traverse(o => { o.frustumCulled = false; }); scene.add(GF.gun); GF.src = pg;
      GF.fpMuzzle = GF.gun.getObjectByName('gaPistolMuzzle'); if (GF.fpMuzzle) GF.fpMuzzle.name = 'vrFpMuzzle'; }
    if (!GF.hand) { GF.hand = new THREE.Mesh(hand.geometry, hand.material); GF.hand.name = 'vrFpHand'; GF.hand.matrixAutoUpdate = false; GF.hand.frustumCulled = false; scene.add(GF.hand); }
    if (!GF.ray) { GF.ray = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0x3ff3ff, transparent: true, opacity: 0.55, fog: false, toneMapped: false })); GF.ray.name = 'vrFpRay'; GF.ray.frustumCulled = false; scene.add(GF.ray); }
    GF.gun.matrix.copy(pg.matrixWorld); GF.gun.matrixWorldNeedsUpdate = true; GF.gun.updateMatrixWorld(true); GF.hand.matrix.copy(hand.matrixWorld); GF.hand.updateMatrixWorld(true);
    GF.gun.visible = true; GF.hand.visible = true; GF.on = true; GF.ctrl = ctrls[i]; GF.frames++;
    const c = ctrls[i]; c.updateMatrixWorld(true); c.getWorldQuaternion(_q); GF.d.set(0, 0, -1).applyQuaternion(_q).normalize(); pz.getWorldPosition(GF.o).addScaledVector(GF.d, 0.03);
    for (let k = 0; k < grips.length; k++) if (k !== i) ctrlModelsVis(true, k); ctrlModelsVis(false, i); }
  function fpRayPost() { if (!GF.on || !GF.ctrl) return; const r = GF.ctrl.userData.ray; GF.ray.position.copy(GF.o); GF.ctrl.getWorldQuaternion(GF.ray.quaternion); GF.ray.scale.set(1, 1, r.scale.z);
    GF.ray.material.color.copy(r.material.color); GF.ray.visible = r.visible; r.visible = false; }
  S.fpGun = () => { const pg = monkey.getObjectByName('gaPistol'), pz = pg && pg.getObjectByName('gaPistolMuzzle'), out = { on: GF.on, frames: GF.frames };
    if (!GF.on) return out; const v = new THREE.Vector3(), g = myGrip('right'); out.grip = g ? g.p.toArray() : null;
    out.muzzle = GF.fpMuzzle ? GF.fpMuzzle.getWorldPosition(v).toArray() : null; out.mirrorMuzzle = pz ? pz.getWorldPosition(new THREE.Vector3()).toArray() : null;
    out.hand = new THREE.Vector3().setFromMatrixPosition(GF.hand.matrixWorld).toArray(); const ws = new THREE.Vector3(); GF.gun.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws); out.gunScale = Math.abs(ws.x);
    out.barrel = new THREE.Vector3(0, 0, 1).transformDirection(GF.gun.matrixWorld).toArray(); out.aim = GF.d.toArray(); out.rayO = GF.o.toArray(); out.ctrl = new THREE.Vector3().setFromMatrixPosition(GF.ctrl.matrixWorld).toArray();
    out.gunVis = GF.gun.visible; out.handVis = GF.hand.visible; out.fpRay = GF.ray.visible; out.fpRayLen = GF.ray.scale.z; out.ctrlRay = GF.ctrl.userData.ray.visible;
    const gi = ctrls.indexOf(GF.ctrl), gd = grips[gi] && grips[gi].userData; out.ctrlModel = !!(gd && ((gd.fallback && gd.fallback.visible) || (gd.model && gd.model.visible)));
    const ld = ctrls.findIndex(c => c.userData.hand === 'left'), lg = grips[ld] && grips[ld].userData; out.leftModel = !!(lg && ((lg.fallback && lg.fallback.visible) || (lg.model && lg.model.visible))); return out; };
  function avatarHandsOff() { gunRest(monkey.getObjectByName('gaPistol')); fpGunOff(); for (const m of AH.models.values()) m.visible = false; if (AH.flipped && monkey.scale.x < 0) monkey.scale.x = -monkey.scale.x; AH.flipped = false; }
  // ---------- t362u: two (or more) people in the VR arcade: mp.js's shared room + VR poses ----------
  // Sent: with each mp 'st' packet (mp.js ticks at 10 Hz, only when changed) a compact `v` = head + both grips relative to the body
  // (position cm, rotation quaternion), so it lines up with the smoothed body the others draw. Flat / older clients ignore `v`.
  // Received: the remote avatar's head turns with their headset, its arms reach for their controllers (same solver as the mirror), a small
  // controller sits in each hand and a visor marks them as a VR player. Poses ease toward each packet (~70 ms), so 10 Hz looks smooth.
  const MPV = { sent: 0, posed: 0, steps: 0, zaps: 0, Y: new THREE.Vector3(0, 1, 0), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), qpi: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), e: new THREE.Euler(0, 0, 0, 'YXZ'), v: new THREE.Vector3() };
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  function poseEnc(p, q, base, yaw, head) { const c = Math.cos(yaw), sn = Math.sin(yaw), dx = p.x - base.x, dz = p.z - base.z;
    MPV.qa.setFromAxisAngle(MPV.Y, -yaw).multiply(q); if (head) MPV.qa.multiply(MPV.qpi);   // head: identity = looking where the body faces
    return [r2(dx * c - dz * sn), r2(p.y - base.y), r2(dx * sn + dz * c), r3(MPV.qa.x), r3(MPV.qa.y), r3(MPV.qa.z), r3(MPV.qa.w)]; }
  function vrSnap() { if (!renderer.xr.isPresenting || !S.posed || !S.head) return undefined;
    const base = monkey.position, yaw = monkey.rotation.y, out = { vr: 1 };
    camera.updateMatrixWorld(true); camera.getWorldPosition(MPV.v); camera.getWorldQuaternion(MPV.qb); out.h = poseEnc(MPV.v, MPV.qb, base, yaw, true);
    for (const hand of ['left', 'right']) { const g = myGrip(hand); if (g) out[hand[0]] = poseEnc(g.p, g.q, base, yaw, false); }
    MPV.sent++; return out; }
  const arr7 = a => Array.isArray(a) && a.length === 7 && a.every(x => typeof x === 'number' && isFinite(x) && Math.abs(x) < 30);
  function visor(p, on) { const u = p.g.userData || {}, hd = u.head || p.g; if (!p.visor && on) {
      const m = new THREE.Group(); m.name = 'vrVisor'; const ws = new THREE.Vector3(); p.g.updateMatrixWorld(true); hd.getWorldScale(ws);
      const bx = new THREE.Box3().setFromObject(hd), sz = bx.getSize(new THREE.Vector3()), rad = Math.max(0.08, Math.min(0.3, Math.max(sz.x, sz.z) * 0.5)), sc = 1 / Math.max(0.05, ws.x);
      const shell = new THREE.Mesh(new THREE.BoxGeometry(rad * 1.25, rad * 0.5, rad * 0.45), new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.35, metalness: 0.4 }));
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(rad * 1.1, rad * 0.32), new THREE.MeshBasicMaterial({ color: 0x2ae5ff, toneMapped: false })); lens.position.z = rad * 0.23;
      shell.add(lens); m.add(shell); m.scale.setScalar(sc); m.position.set(0, (bx.getCenter(new THREE.Vector3()).y - hd.getWorldPosition(new THREE.Vector3()).y) / Math.max(0.05, ws.y) + 0.01 * sc, rad * 0.85 * sc); hd.add(m); p.visor = m; }
    if (p.visor) p.visor.visible = on; }
  function posePeer(p, dt, now) { const u = p.g.userData || {}, v = p.v, fresh = !!(v && now - (p.vAt || -1e9) < 2000 && arr7(v.h));
    p.vr = fresh; visor(p, fresh && p.g.visible);
    if (!fresh || !p.g.visible || p.slot || !u.arms) { gunRest(p.g.getObjectByName('gaPistol')); if (p.flip && p.g.scale.x < 0) { p.g.scale.x = -p.g.scale.x; p.flip = false; } if (p.vrS) { p.vrS = null; for (const arm of u.arms || []) { const m = arm.hand && AH.models.get(arm.hand); if (m) m.visible = false; } if (u.head) u.head.rotation.set(0, 0, 0); } return; }
    if (p.g.scale.x > 0) { p.g.scale.x = -p.g.scale.x; p.flip = true; }   // v13: like your own avatar, a VR player's model is mirrored so its 'handR' (gun hand) is on their right
    const k = 1 - Math.exp(-Math.max(dt, 0) * 14), S0 = p.vrS || (p.vrS = { first: true });
    for (const key of ['h', 'l', 'r']) { const a = v[key]; if (!arr7(a)) { S0[key] = null; continue; }
      let e = S0[key]; if (!e) e = S0[key] = { p: new THREE.Vector3().fromArray(a), q: new THREE.Quaternion(a[3], a[4], a[5], a[6]).normalize(), snap: true };
      MPV.qa.set(a[3], a[4], a[5], a[6]).normalize(); MPV.v.fromArray(a);
      if (e.snap || e.p.distanceToSquared(MPV.v) > 4) { e.p.copy(MPV.v); e.q.copy(MPV.qa); e.snap = false; } else { e.p.lerp(MPV.v, k); e.q.slerp(MPV.qa, k); } }
    const g = p.g, yaw = g.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw), bp = g.position, toW = (lp, out) => out.set(bp.x + lp.x * c + lp.z * sn, bp.y + lp.y, bp.z - lp.x * sn + lp.z * c);
    g.updateMatrixWorld(true);
    // head: turn + nod (clamped), on top of the body's facing
    const H = S0.h; MPV.e.setFromQuaternion(H.q, 'YXZ'); const hy = Math.max(-1.3, Math.min(1.3, MPV.e.y)), hp = Math.max(-0.9, Math.min(0.9, MPV.e.x));
    if (u.head) { MPV.e.set(hp, hy, 0, 'YXZ'); MPV.qb.setFromEuler(MPV.e); MPV.qa.setFromAxisAngle(MPV.Y, yaw).multiply(MPV.qb); setWorldQ(u.head, MPV.qa); }
    const hw = toW(H.p, new THREE.Vector3()), head = { x: hw.x, y: hw.y, z: hw.z, yaw: yaw - Math.PI + hy };
    const grip = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    armIK(u.arms, head, hand => { const e = S0[hand[0]]; if (!e) return null; toW(e.p, grip.p); grip.q.setFromAxisAngle(MPV.Y, yaw).multiply(e.q); return grip; });
    MPV.posed++; }
  let mpHooked = null, rfHooked = null;
  function vrLaserSnap() { if (!renderer.xr.isPresenting) return undefined; const aim = (VL.beam || (VL.held && !VL.spent && VL.charge > 0.02)) ? laserAim() : null; if (!aim) return undefined;
    const h = (monkey.userData || {}).char === 'alien' ? 'red' : 'cyan', o = aim.o.toArray().map(r3), d = aim.d.toArray().map(r3), CT = (window.__roomFire && window.__roomFire.CHARGE_T) || 4;
    return VL.beam ? { k: 1, b: +Math.max(0.01, VL.beamT).toFixed(2), o, d, h } : { k: +Math.min(1, VL.charge / CT).toFixed(3), b: 0, o, d, h }; }
  function mpHook() { const M = window.__mp; if (M && mpHooked !== M) { mpHooked = M; M.vrSnap = vrSnap; M.posePeer = posePeer; }
    const R = window.__roomFire; if (R && R.laserSnap && rfHooked !== R) { rfHooked = R; const ls0 = R.laserSnap; R.laserSnap = function () { const v = vrLaserSnap(); return v !== undefined ? v : ls0.apply(this, arguments); }; } }
  setInterval(mpHook, 1000);
  // ---------- t366u/t367u + t869u / v11: painted pictures above the cabinets + the claw icon's black-panel fix ----------
  // The wall pictures above each cabinet (neonsigns.js icon atlas: simple canvas-drawn shapes, the same as the live original) are
  // replaced by new painted neon art, one picture per game (tex/icons/<key>.webp, 512 px, transparent background). They go into a
  // fresh power-of-two atlas with the SAME 4x4 cell layout (the icon quads' UVs are fractions, so they keep working); each picture is
  // fitted to its quad's own shape so it is never squashed. neonsigns.js is not edited. If a picture fails to load, its old icon stays.
  // The free-standing claw's animated icon used a 2560x256 canvas strip that was re-uploaded (with mipmaps) on every claw frame, also
  // mid-XR; on the Quest a failed upload leaves an incomplete texture, which samples as an opaque BLACK panel hanging under the ceiling.
  // It now gets a power-of-two copy uploaded once and animates by sharing the old texture's offset (a uniform; no re-uploads).
  // t869u / v11: this swap was restored (it had been removed in v10) so VR matches Dave's request for Arcade's painted art.
  const ICON_KEYS = ['strike', 'ghost', 'cyber', 'orc', 'pip', 'berserker', 'monkey', 'nova', 'blaster', 'bb', 'rockfall', 'skytower', 'roadster', 'claw'];
  const IC = { done: false, loaded: [], failed: [], cell: 0, claw: false, k: 0 };
  // vrtest-v4 (t911u port): one prebuilt sheet (tex/icons_atlas.ktx2 / .webp, same 4x4 x 256 px layout) instead of 13 pictures drawn
  // into a canvas; the canvas path below stays as the fallback if the sheet does not load in 8 s.
  function iconArt() { const icons = window.__neonIcons; if (!icons || !icons.material || !icons.material.map || IC.started) return; IC.started = true;
    const old0 = icons.material.map; let settled = false;
    const sheet = t => { if (settled) return; settled = true; t.anisotropy = old0.anisotropy || 4; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
      try { renderer.initTexture(t); } catch (e) {}
      icons.material.map = t; icons.material.color.setScalar(IC.k = Math.max(icons.material.color.r, 0.8)); icons.material.needsUpdate = false;
      try { old0.dispose(); } catch (e) {} IC.sheet = t.isCompressedTexture ? 'ktx2' : 'webp'; IC.cell = 256; IC.loaded = ICON_KEYS.filter(k => k !== 'claw'); IC.done = true; };
    try { loadPicture(THREE, 'tex/icons_atlas.webp', { mips: false, onLoad: t => { if (t && (t.isCompressedTexture || (t.image && (t.image.width || 0) >= 512))) sheet(t); } }); } catch (e) {}
    setTimeout(() => { if (!settled) { settled = true; iconCanvas(icons); } }, 8000);
    clawFix(); }
  function iconCanvas(icons) {
    const old = icons.material.map, oc = old.image, low = (A.TIER && A.TIER.name === 'low') || !oc || oc.width <= 512, S0 = oc ? oc.width / 4 : 256;
    const C = IC.cell = 256, cv = document.createElement('canvas'); cv.width = cv.height = C * 4; const g = cv.getContext('2d');
    if (oc) g.drawImage(oc, 0, 0, cv.width, cv.height);   // start from the old icons (fallback for any picture that fails)
    const info = {}; (icons.userData.icons || []).forEach(i => { info[i.key] = i; });
    const load = k => new Promise(res => { const im = new Image(); im.onload = () => res([k, im]); im.onerror = () => res([k, null]); im.src = 'tex/icons/' + k + '.webp'; });
    Promise.all(ICON_KEYS.filter(k => k !== 'claw').map(load)).then(list => { try {
      for (const [k, im] of list) { if (!im) { IC.failed.push(k); continue; }
        const i = ICON_KEYS.indexOf(k), x = (i % 4) * C, y = Math.floor(i / 4) * C, pad = 12 * C / S0, inner = C - 2 * pad, q = info[k];
        // the quad shows the cell's inner square stretched to w x h: draw the picture at h/w of the height (or w/h of the width) so it looks square
        const r = q && q.w > 0 && q.h > 0 ? q.w / q.h : 1, dw = r >= 1 ? inner / r : inner, dh = r >= 1 ? inner : inner * r;
        g.clearRect(x, y, C, C); g.drawImage(im, x + pad + (inner - dw) / 2, y + pad + (inner - dh) / 2, dw, dh); IC.loaded.push(k); }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = old.anisotropy || 4; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;   // TEST v1: 256 px cells, 1024 atlas, no mips
      try { renderer.initTexture(t); } catch (e) {}
      icons.material.map = t; icons.material.color.setScalar(IC.k = Math.max(icons.material.color.r, 0.8));   // painted art: a bit brighter than the dim neon (0.55)
      icons.material.needsUpdate = false; old.dispose(); IC.done = true;
    } catch (e) { S.lastError = 'icons ' + e; IC.done = true; } });
    clawFix(); }
  function clawFix() { const claw = window.__neonClawIcon; if (!claw || !claw.material || !claw.material.map || IC.claw) return;
    const ot = claw.material.map, src = ot.image; if (ot.isCompressedTexture) { IC.claw = 'ktx2'; return; }   // vrtest-v10: baked KTX2 strip (Chief v256) is already compact; nothing to redraw
    if (!src || !src.width) return;
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 256; cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ot.anisotropy || 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.copy(ot.repeat); t.offset = ot.offset;   // shared Vector2: neonsigns.js's tick moves the frame, nothing is re-uploaded
    try { renderer.initTexture(t); } catch (e) {}
    claw.material.map = t; ot.dispose(); IC.claw = true; }
  const icT = setInterval(() => { iconArt(); clawFix(); if (IC.done && (IC.claw || !window.__neonClawIcon)) clearInterval(icT); }, 500);
  S.icons = () => ({ done: IC.done, loaded: IC.loaded.slice(), failed: IC.failed.slice(), cell: IC.cell, claw: IC.claw, k: IC.k,
    atlas: window.__neonIcons && window.__neonIcons.material.map && window.__neonIcons.material.map.image ? window.__neonIcons.material.map.image.width : 0,
    clawTex: window.__neonClawIcon && window.__neonClawIcon.material.map.image ? window.__neonClawIcon.material.map.image.width : 0 });
  // ---------- t365u: Quest Browser 2D (on the screen, not in VR): left stick walks, right stick looks ----------
  // quest-pad.js (ported from the original v242) turns the Quest's stick input (wheel / scroll / zoom channels, or real gamepads when exposed)
  // into read() = { move, look }. Applied here like the original main.js applyQuestPad: move -> the on-screen stick's st.joy, look -> the
  // camera yaw / pitch. Nothing while an XR session is on (vr.js drives the sticks there) or on the start screen / inside a cabinet.
  const QF = { joy: false, moves: 0, looks: 0, frames: 0, xrSkips: 0, lastT: 0 };
  const QJ = { DEAD: 12, REACH: 176, GENTLE: 1.05, SPRINT: 5.2 };
  function qfJoyOff() { if (!QF.joy) return; QF.joy = false; st.joy.on = false; st.joy.x = 0; st.joy.y = 0; st.joy.dist = 0; st.joy.vmax = 0; }
  function questFlat(s) { const Q = window.__gaQuestPad; if (!Q || !Q.isQuest || !Q.isQuest()) return; QF.frames++;
    const now = performance.now(), ms = Math.min(50, Math.max(1, now - (QF.lastT || now - 16))); QF.lastT = now;
    if (renderer.xr.isPresenting) { qfJoyOff(); QF.xrSkips++; QF.yawSeen = null; return; }
    const S0 = window.__start, startUp = !!(S0 && S0.shown && !S0.dismissed && document.getElementById('start')), walking = play.mode === 'walk' && !(A.nb && A.nb.playing);
    const mv = (s && s.move) || { x: 0, y: 0 }, lk = (s && s.look) || { x: 0, y: 0 }, dead = Q.DEAD || 0.18, mag = Math.hypot(mv.x || 0, mv.y || 0);
    if (startUp || !walking) { qfJoyOff(); QF.yawSeen = null; return; }
    if (mag >= dead && (QF.joy || !st.joy.on)) {   // never fight a finger on the touch stick
      const t = Math.min(1, (mag - dead) / (1 - dead)), dist = QJ.DEAD + t * (QJ.REACH - QJ.DEAD), u = Math.min(1, (dist - QJ.DEAD) / (QJ.REACH - QJ.DEAD)), sm = u * u * (3 - 2 * u);
      QF.joy = true; st.joy.on = true; st.joy.x = mv.x / mag; st.joy.y = mv.y / mag; st.joy.dist = dist; st.joy.vmax = QJ.GENTLE + (QJ.SPRINT - QJ.GENTLE) * sm; QF.moves++;
    } else qfJoyOff();
    const lm = Math.hypot(lk.x || 0, lk.y || 0);
    if (lm > 0) { const dx = (lk.x || 0) * 0.6 * ms, dy = (lk.y || 0) * 0.6 * ms;   // same as main.js look(): yaw -= dx * 0.005, pitch += dy * 0.004 (clamped)
      st.lookT = st.t; st.yaw -= dx * 0.005; if (window.__gaNoteYaw) window.__gaNoteYaw('quest-look:' + (Q.lookSrc || '?'), -dx * 0.005); st.pitch = Math.max(-0.6, Math.min(1.25, st.pitch + dy * 0.004)); QF.looks++; }
    // v13: anything else that turned the camera since the last frame shows up in ?qdbg=1 as 'other'
    const Y = window.__gaYaw; if (Y) { if (QF.yawSeen != null) { const un = Math.atan2(Math.sin(st.yaw - QF.yawSeen - (Y.sum - QF.sumSeen)), Math.cos(st.yaw - QF.yawSeen - (Y.sum - QF.sumSeen))); if (Math.abs(un) > 1e-6 && window.__gaNoteYaw) window.__gaNoteYaw('other', un); } QF.yawSeen = st.yaw; QF.sumSeen = Y.sum; } }
  function qfHook() { const Q = window.__gaQuestPad; if (Q && Q.onFrame !== questFlat && (!Q.onFrame || Q.onFrame.__ga !== 1)) { questFlat.__ga = 1; Q.onFrame = questFlat; } }
  qfHook(); setInterval(qfHook, 1000);
  S.questFlat = () => Object.assign({}, QF, { quest: !!(window.__gaQuestPad && window.__gaQuestPad.isQuest()), joy: { on: st.joy.on, x: st.joy.x, y: st.joy.y, vmax: st.joy.vmax }, yaw: st.yaw, pitch: st.pitch });   // also for players in the VR edition who are not in a headset: they still see VR players' heads and hands
  function mpStep() { mpHook(); const M = window.__mp; if (!M || !M.step) return; const now = performance.now();
    if (now - (M.lastStep || 0) > 30) { M.step(now); MPV.steps++; } }   // the headset's frame loop keeps remote players moving (window rAF pauses in VR)
  S.mp = () => { const M = window.__mp; const peers = M ? [...M.peers.values()].map(p => { const u = p.g.userData || {}, arm = u.arms && u.arms.find(a => a.sd > 0), arml = u.arms && u.arms.find(a => a.sd < 0), w = new THREE.Vector3();
      const hp = o => o ? (p.g.updateMatrixWorld(true), o.getWorldPosition(w).toArray().map(r3)) : null, mdl = a => !!(a && a.hand && AH.models.get(a.hand) && AH.models.get(a.hand).visible);
      return { id: p.id, vr: !!p.vr, visor: !!(p.visor && p.visor.visible), vis: p.g.visible, a: p.a, pos: p.g.position.toArray().map(r3), r: r3(p.g.rotation.y), headQ: u.head ? u.head.quaternion.toArray().map(r3) : null, handR: hp(arm && arm.hand), handL: hp(arml && arml.hand), ctrlR: mdl(arm), ctrlL: mdl(arml), lz: p.lz || null, v: p.v || null, pistol: (() => { const pg = p.g.getObjectByName('gaPistol'); if (!pg) return false; for (let o = pg; o; o = o.parent) if (!o.visible) return false; return true; })(), thr: (() => { let t = false; p.g.traverse(o => { if (o.name === 'gaThruster' && o.visible) t = true; }); return t; })() }; }) : [];
    return { state: M && M.state, sent: MPV.sent, zaps: MPV.zaps, posed: MPV.posed, steps: MPV.steps, peers }; };
  S.avatarHands = () => { const u = monkey.userData || {}; monkey.updateMatrixWorld(true); return (u.arms || []).map(a => { const p = new THREE.Vector3(); (a.hand || a.el).getWorldPosition(p); const m = a.hand && AH.models.get(a.hand); return { sd: a.sd, hand: p.toArray(), model: !!(m && m.visible && m.parent === a.hand) }; }).concat([{ frames: AH.frames }]); };
  S.mirrorStats = () => ({ renders: MV.renders, skips: MV.skips, far: MV.far, twin: !!(MV.twin && MV.twin.visible), shopVisible: !!(mirrorMesh() && mirrorMesh().visible && mirrorMesh().layers.isEnabled(0)) });
  S.mirrorRT = () => { const m = MV.twin && MV.twin.visible ? MV.twin : mirrorMesh(); if (!m || !m.getRenderTarget) return null; const rt = m.getRenderTarget(); return { w: rt.width, h: rt.height, vr: m === MV.twin, filter: rt.texture.minFilter === THREE.LinearFilter ? 'linear' : rt.texture.minFilter, mips: rt.texture.generateMipmaps }; };
  const mirrorMesh = () => { const w = A.shop && A.shop.wardrobe; return (w && w.mirror && w.mirror.mesh) || null; };
  // t360u: CHAT WITH GROK over the shop clerk (above PRIZE SHOP) and over the visiting Grok in the arcade
  addSign('chatClerk', 'CHAT WITH GROK', '#7dfcff', () => { const g = A.shop && A.shop.grok; if (!g) return null; const p = g.getWorldPosition(new THREE.Vector3()), h = S.head, k = h ? Math.min(3, Math.max(1, Math.hypot(h.x - p.x, h.z - p.z) / 6)) : 1; return [p.x, p.y + 2.3 + 0.33 * k, p.z]; }, () => chatStart('clerk'), () => A.tp && A.tp.where === 2 && !!A.shop && !grokAway() && !!(chatApi() && chatApi().hooks.clerk) && !inChat());
  addSign('chatVisitor', 'CHAT WITH GROK', '#7dfcff', () => { const v = window.__grokVisit, g = v && v.grok; if (!g) return null; const p = g.getWorldPosition(new THREE.Vector3()); return [p.x, p.y + 2.3, p.z]; }, () => chatStart('visitor'),
    () => { const v = window.__grokVisit, g = v && v.grok; if (!g || !g.visible || !v.state || v.state === 'idle' || v.state === 'done' || inChat() || !(chatApi() && chatApi().hooks.visitor)) return false; if (A.tp && A.tp.where !== 1) return false; const p = g.getWorldPosition(_v); return Math.hypot(p.x - monkey.position.x, p.z - monkey.position.z) < 10; });
  addSign('ward', 'ACCESSORIES', '#ff4fd8', () => { const m = mirrorMesh(); if (!m) return null; const p = m.getWorldPosition(new THREE.Vector3()); return [p.x, p.y + 1.35, p.z]; }, () => uiOpen('ward'), () => A.tp && A.tp.where === 2 && !!mirrorMesh() && !!window.__gaPlayer);
  addSign('nb', 'NEON BRICKS · PLAY', '#ff3fd2', () => { const n = nbApi(); if (!n || !n.grp) return null; const p = n.grp.getWorldPosition(new THREE.Vector3()); return [p.x - 1.1, 1.75, (n.grp.parent ? n.grp.parent.getWorldPosition(new THREE.Vector3()).z : 0)]; }, nbStart, () => { const n = nbApi(); return !!n && !n.playing && (!A.tp || A.tp.where === 1); });
  S.signs = () => signs.filter(g => g.m && g.m.visible && (!g.keep || (S.presenting && g.show()))).map(g => ({ id: g.id, at: g.m.position.toArray() }));
  const _sph = new THREE.Sphere(); let kioskBox = null;
  function nbBox() { const n = nbApi(); if (!n || !n.grp) return null; const p = n.grp.getWorldPosition(new THREE.Vector3()), z = n.grp.parent ? n.grp.parent.getWorldPosition(new THREE.Vector3()).z : 0;
    return new THREE.Box3(new THREE.Vector3(p.x - 0.55, 0.4, z - 1.95), new THREE.Vector3(p.x + 0.4, 7.8, z + 1.95)); }
  // ---------- v12 (t374u): the CHESS table in the shop ----------
  // Point + trigger at the table (or its CHESS · PLAY sign) = sit down. chesstable.js (the same code as the flat game) walks Grok over from
  // the counter and sits him opposite. Seated: the rig turns once to face the board and follows the sit / stand tween; no walking or turning.
  // Once Grok sits, the real chess page (chess-play/: same pieces, battles, robot arm) is painted by its own window.__chessVR painter onto a
  // panel over the table; ray + trigger press / drag / release go into that page at the same spot. GRIP (short press) = stand up.
  const chessT = () => window.__chessTable || null, CHW = 1180, CHH = 720, CPW = 1.36, CPH = CPW * CHH / CHW;
  const chessM = panel(CPW, CPH, 1, 1); chessM.name = 'vrChess';   // TEST v1: 1x1 until you sit down (chessMem)
  function chessMem(on) { const u = chessM.userData; on = !!on; if (u.memOn === on) return; u.memOn = on; u.cv.width = on ? CHW : 1; u.cv.height = on ? CHH : 1;
    try { u.tex.dispose(); } catch (e) {} if (on) u.tex.needsUpdate = true; try { VC.mem(on); } catch (e) {} S.chessMemN = (S.chessMemN || 0) + 1; }
  S.chessMem = () => ({ panel: chessM.userData.cv.width, board: VC.board.material.map.image.width, on: !!chessM.userData.memOn, vc: VC.M }); chessM.renderOrder = 1002; chessM.visible = false; scene.add(chessM);
  const CS = { was: 'idle', down: false, hand: null, u: 0, v: 0, drawT: -9, draws: 0, ptr: 0, placed: false, aligns: 0, downEl: null };
  S.chess = CS; S.chessM = chessM; S.backs = { menu: 0, chess: 0, game: 0, nb: 0 };
  // v17 (t403u): IMMERSIVE chess (vrchess.js) replaces the painted-page panel once the game is up: own scene around you, own board
  const VC = createVRChess({ scene }); S.vrChess = VC; const IM = { on: false, prefs: null, pumpN: 0 };
  function immOn(w, A) { if (IM.on) return; IM.on = true; window.__chessImmersive = true; VC.V.sel = -1; VC.V.key = ''; VC.V.bkey = ''; VC.place(S.head || { x: monkey.position.x, y: 1.5, z: monkey.position.z, yaw: 0 }); VC.G.visible = true; chessM.visible = false;
    try { const p = A.prefs; IM.prefs = { robot: p.robot, battle: p.battle }; p.robot = false; p.battle = false; } catch (e) {} S.chessImm = (S.chessImm || 0) + 1; }
  function immOff() { if (!IM.on) return; IM.on = false; window.__chessImmersive = false; VC.G.visible = false; VC.V.sel = -1;
    try { const w = chessWin() || (chessT() && chessT().frame && chessT().frame.contentWindow), A = w && w.chessApp; if (A && IM.prefs) { A.prefs.robot = IM.prefs.robot; A.prefs.battle = IM.prefs.battle; } } catch (e) {} IM.prefs = null; }
  S.chessImmOn = () => IM.on;
  const chessIn = () => { const C = chessT(); return !!C && monkey.position.x > C.WXp / 2 && (!A.tp || A.tp.where !== 1 || monkey.position.x > C.WXp / 2); };
  const chessFree = () => { const C = chessT(); return !!C && C.state === 'idle' && C.gstate === 'home' && chessIn(); };
  function chessGo() { const C = chessT(); if (!C || play.mode !== 'walk') return false; uiClose(); const ok = C.start(); if (ok !== false) S.chessStarts = (S.chessStarts || 0) + 1; return ok; }
  S.chessGo = chessGo;
  function chessBox() { const C = chessT(), b = C.BOX; return new THREE.Box3(new THREE.Vector3(C.WXp + b.x0, 0, b.z0), new THREE.Vector3(C.WXp + b.x1, 1.25, b.z1)); }
  addSign('chess', 'CHESS · PLAY', '#ffe14a', () => { const C = chessT(); return C ? [C.CX, 1.95, C.CZ] : null; }, chessGo, chessFree);
  const chessWin = () => { const C = chessT(); try { return C && C.state === 'play' && C.frame ? C.frame.contentWindow : null; } catch (e) { return null; } };
  function chessPtr(w, type, u, v) { try { const x = Math.max(0, Math.min(w.innerWidth - 1, u * w.innerWidth)), y = Math.max(0, Math.min(w.innerHeight - 1, v * w.innerHeight)), d = w.document, t = d.elementFromPoint(x, y) || d.body, down = type !== 'pointerup';
      const base = { clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, composed: true, button: 0, buttons: down ? 1 : 0, view: w };
      t.dispatchEvent(new w.PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: down ? 0.5 : 0 }, base)));
      t.dispatchEvent(new w.MouseEvent({ pointerdown: 'mousedown', pointermove: 'mousemove', pointerup: 'mouseup' }[type], base));
      if (type === 'pointerdown') CS.downEl = t;
      if (type === 'pointerup') { const a = CS.downEl; let c = t; if (a && a !== t) { c = a.contains(t) ? a : t.contains(a) ? t : null; } if (c) c.dispatchEvent(new w.MouseEvent('click', base)); CS.downEl = null; }
      CS.u = u; CS.v = v; CS.ptr++; } catch (e) { S.lastError = 'chessPtr ' + e; } }
  S.chessPtr = (type, u, v) => { const w = chessWin(); if (w) chessPtr(w, type, u, v); };
  function chessUp() { if (CS.down) { const w = chessWin(); if (w) chessPtr(w, 'pointerup', CS.u, CS.v); } CS.down = false; CS.hand = null; }
  function placeChess() { const C = chessT(), h = S.head || { y: 1.5 }; chessM.position.set(C.CX + 0.06, Math.max(0.95, Math.min(1.5, h.y - 0.22)), C.CZ); chessM.rotation.set(-0.15, -Math.PI / 2, 0, 'YXZ'); chessM.updateMatrixWorld(true); CS.placed = true; }
  // before the step: seat the headset. Returns true while the chess table has you (sitting, playing, standing up).
  function chessPre() { const C = chessT(), now = C ? C.state : 'idle', ch = now !== CS.was;
    if (ch) { if (CS.was === 'idle' && S.head) { turnRig(-Math.PI / 2 - S.head.yaw); CS.aligns++; }   // face the board (+x) once
      if (now === 'idle') { chessUp(); chessM.visible = false; CS.placed = false; immOff(); chessMem(false); } else chessMem(true);
      CS.was = now; }
    if (now !== 'idle' && S.head && (ch || now === 'sit' || now === 'stand')) moveRig(monkey.position.x - S.head.x, monkey.position.z - S.head.z);   // the headset rides the sit / stand tween
    return now !== 'idle'; }
  // after the step: the board panel, its ray + trigger, skip, grip = stand up
  function chessPost(dt, L, R, order) { const C = chessT(), anyP = k => !!((L && L[k]) || (R && R[k])); if (UI.open) uiClose();
    if (anyP('gripDown') || (L && L.aDown)) { chessUp(); chessM.visible = false; immOff(); C.exit('grip'); S.backs.chess++; pulse((L && L.gripDown ? L : L && L.aDown ? L : R).src, 0.7, 50); return; }   // v17: GRIP or X = back to the shop
    if (C.grokBusy && C.gstate !== 'seated' && C.gstate !== 'sitdown' && (anyP('aDown') || anyP('trigDown'))) C.skip();
    const w = chessWin(), P = w && w.__chessVR; if (!P) { chessM.visible = false; immOff(); return; }
    const CA = w.chessApp; if (CA && CA.pos && CA.pos.legalMoves) { immOn(w, CA); chessImm(dt, w, CA, L, R, order); return; }
    try { if (w.__gaVRPump) S.pumps += w.__gaVRPump(); } catch (e) {}   // the chess page's frames (robot arm, battles, piece slides) run from the XR loop
    if (!CS.placed) placeChess(); chessM.visible = true;
    if (S.frames - CS.drawT >= 2 || CS.down) { CS.drawT = S.frames; try { const cv = P.draw(), u = chessM.userData; u.g.clearRect(0, 0, CHW, CHH); u.g.drawImage(cv, 0, 0, CHW, CHH); u.tex.needsUpdate = true; CS.draws++; S.texUploads++; } catch (e) { S.lastError = 'chess ' + e; } }
    let aim = null;
    for (const [hand, Pd] of order) { const c = ctrlFor(hand); if (!c || !Pd) continue; const ray = rayOf(c), t = rectHit(ray, chessM, RAY_MAX); if (t == null) continue;
      const p = ray.at(t, new THREE.Vector3()), lp = chessM.worldToLocal(p.clone()), u = lp.x / CPW + 0.5, v = 0.5 - lp.y / CPH;
      c.userData.ray.scale.z = t; c.userData.ray.material.color.setHex(0xffe14a);
      if (!aim || hand === CS.hand) { aim = { hand, u, v, P: Pd }; dot.position.copy(p); dot.visible = true; } }
    if (!CS.down) { if (aim && aim.P.trigDown) { CS.down = true; CS.hand = aim.hand; chessPtr(w, 'pointerdown', aim.u, aim.v); pulse(aim.P.src, 0.4, 25); } }
    else { const Ph = CS.hand === 'right' ? R : L, a = aim && aim.hand === CS.hand ? aim : null;
      if (Ph && Ph.trig) { if (a) chessPtr(w, 'pointermove', a.u, a.v); }
      else { chessPtr(w, 'pointerup', a ? a.u : CS.u, a ? a.v : CS.v); CS.down = false; CS.hand = null; } } }
  // v17: the immersive board: rays pick squares / bar buttons; the page's own frames only every 4th XR frame (no robot / battles now)
  function chessImm(dt, w, A, L, R, order) {
    if ((++IM.pumpN & 3) === 0) { try { if (w.__gaVRPump) S.pumps += w.__gaVRPump(); } catch (e) {} }
    let aim = null;
    for (const [hand, Pd] of order) { const c = ctrlFor(hand); if (!c || !Pd) continue; const ray = rayOf(c), h = VC.hit(ray); if (!h) continue;
      c.userData.ray.scale.z = h.t; c.userData.ray.material.color.setHex(h.kind === 'sq' ? 0x7dff9a : 0xffe14a);
      if (!aim || Pd.trigDown) { aim = { hand, h, P: Pd }; dot.position.copy(h.p); dot.visible = true; } }
    VC.V.hover = aim && aim.h.kind === 'sq' ? aim.h.sq : -1; VC.V.hbtn = aim && aim.h.kind === 'btn' ? aim.h.id : null;
    if (aim && aim.P.trigDown) { const h = aim.h; pulse(aim.P.src, 0.45, 30);
      if (h.kind === 'sq') { S.chessLast = VC.pick(A, h.sq); }
      else if (h.id === 'new') { try { A.newGame(); VC.V.sel = -1; VC.say('NEW GAME'); } catch (e) {} S.chessLast = 'new'; }
      else if (h.id === 'undo') { try { A.undo(); VC.V.sel = -1; } catch (e) {} S.chessLast = 'undo'; }
      else if (h.id === 'exit') { const C = chessT(); chessUp(); immOff(); C.exit('button'); S.backs.chess++; S.chessLast = 'exit'; return; } }
    VC.frameUpdate(w, A, dt); }
  // the nearest thing the ray points at: a sign, the kiosk, the Neon Bricks window
  function pickTarget(ray) { let best = null; const take = (d, p, act, id, max = RAY_MAX) => { if (d < max && (!best || d < best.d)) best = { d, p: p.clone(), act, id }; };
    for (const g of signs) { if (!g.m || !g.m.visible) continue; if (g.show && !g.show()) continue; const t = rectHit(ray, g.m); if (t != null) take(t, ray.at(t, new THREE.Vector3()), g.act, g.id, SIGN_MAX); }
    const K = kiosk(); if (K && K.K && (!A.tp || A.tp.where === 1)) { if (!kioskBox) kioskBox = new THREE.Box3().setFromObject(K.K); const p = ray.intersectBox(kioskBox, _hit); if (p) take(p.distanceTo(ray.origin), p, () => uiOpen('tickets'), 'kiosk'); }
    const gk = A.shop && A.shop.grok; if (gk && A.tp && A.tp.where === 2 && !grokAway()) { gk.getWorldPosition(_sph.center); _sph.center.y += 1.0; _sph.radius = 0.9; const p = ray.intersectSphere(_sph, _hit); if (p) take(p.distanceTo(ray.origin), p, () => uiOpen('shop'), 'shop', SIGN_MAX); }   // the clerk himself
    const n = nbApi(); if (n && !n.playing && (!A.tp || A.tp.where === 1)) { const b = nbBox(); const p = b && ray.intersectBox(b, _hit); if (p) take(p.distanceTo(ray.origin), p, nbStart, 'nbWindow'); }
    if (chessFree()) { const p = ray.intersectBox(chessBox(), _hit); if (p) take(p.distanceTo(ray.origin), p, chessGo, 'chessTable'); }   // v12: the chess table itself
    { const N = window.__nkGame; if (N && N.pointOrbs && nkIn()) for (const o of N.pointOrbs()) { _sph.center.copy(o.p); _sph.radius = o.r; const p = ray.intersectSphere(_sph, _hit); if (p) take(p.distanceTo(ray.origin), p, o.act, 'nkOrb_' + o.id, SIGN_MAX); } }   // vrtest-v20: point at a Neon Knockout menu orb + TRIGGER or A (punching still works)
    return best; }
  function signsUpdate() { const h = S.head; for (const g of signs) {
    if (g.keep) { if (!g.m) g.m = padLabel(g.name); if (g.m && g.m.material && g.m.material.color) { const hv = S.presenting && g.show() && S.hoverTarget === g.id; g.m.material.color.setHex(hv ? 0xffffff : 0xffffff); g.m.userData.hl = hv; } continue; }
    const show = S.presenting && g.show(); const w = show ? g.where() : null; g.m.visible = !!w;
    if (w) { const hv = S.hoverTarget === g.id || (g.id === 'tickets' && S.hoverTarget === 'kiosk') || (g.id === 'nb' && S.hoverTarget === 'nbWindow') || (g.id === 'shop' && S.hoverTarget === 'shop') || (g.id === 'chess' && S.hoverTarget === 'chessTable'); g.m.material.color.setHex(hv ? 0xffffff : 0xb8b8c8); g.m.userData.hl = hv;
      g.m.position.set(w[0], w[1], w[2]); if (h) { g.m.rotation.set(0, Math.atan2(h.x - w[0], h.z - w[2]), 0); g.m.scale.setScalar(Math.min(3, Math.max(1, Math.hypot(h.x - w[0], h.z - w[2]) / 6)) * (hv ? 1.12 : 1)); } } } }   // far signs grow so they stay readable / easy to point at

  // ---------- never pitch black (t349u) ----------
  // A soft sky/ground fill light while in VR, so the room is always visible even if a tier drops lights or the room's own lights are culled.
  const fill = new THREE.HemisphereLight(0xc8d8ff, 0x403050, 0.9); fill.name = 'vrFill'; fill.visible = false; scene.add(fill); S.fill = fill;
  // Render-target probe: in VR every room draw must go into three's XR framebuffer, never the page canvas (that is what made the Quest black).
  S.rt = { xr: 0, bad: 0, last: '' };
  function rtCheck(rt) { if (rt && rt.isXRRenderTarget) S.rt.xr++; else { S.rt.bad++; S.rt.last = rt ? 'other' : 'null'; } }

  // ---------- vrtest-v8 (Dave t466u: "fix the delay when the player first enters the VR") ----------
  // Tapping PLAY before the background pre-warm had finished started the session with nothing compiled: the first XR frame compiled the
  // arcade synchronously (~150 programs = a multi-second freeze, more stalls on the first beam). Now, if the pre-warm is still running, the
  // headset shows a dark 'PREPARING VR' card (nothing else is drawn, no input, no movement) while the pre-warm finishes in the background,
  // compiles asynchronously and draws each area once; then the world appears already warm. Safety: the card lifts after 45 s regardless.
  const VEIL = S.veil = { on: false, t0: 0, shows: 0, ms: 0, hidden: [] };
  const veilM = panel(0.9, 0.3, 768, 256); veilM.name = 'vrVeil'; veilM.visible = false; veilM.renderOrder = 2000; veilM.material.depthTest = false; scene.add(veilM);
  // v10 (Dave t475u: "it will freeze on 60% with black screen while I can hear the arcade running"): v9's number only ever showed 0 / 50 / 60 %
  // (60 = 'some shader still linking'), and the wait for the driver's parallel link had no cap, so a link that never reported ready kept the card
  // up until the 45 s safety. Now: the number follows the real step (compile i/n 0-50 %, link 50-80 %, first draw 80-99 %), the link wait is
  // capped (see runJob), the card lifts after 20 s whatever happens, and ?warmlog=1 shows the step on the card.
  const VEIL_MAX = 20000;
  function veilPct(where) { const P = PW.prog, c = PW.cur; if (S.areaWarm(where)) return 100; if (!c || !P || c.area !== where || c.kind !== 'vis') return c && c.area === where ? 2 : 1;
    const f = P.n ? Math.min(1, P.i / P.n) : 1; return Math.min(99, Math.round(P.ph === 'compile' ? 50 * f : P.ph === 'draw' ? 80 + 19 * f : 50 + 30 * f)); }
  function veilFrame() { if (!VEIL.on) return; const where = (A.tp && A.tp.where) || 1, now = performance.now();
    if (S.areaWarm(where) || now - VEIL.t0 > VEIL_MAX || !S.presenting) { if (!S.areaWarm(where) && S.presenting) { VEIL.timedOut = (VEIL.timedOut || 0) + 1; logW('card timeout after ' + VEIL_MAX + ' ms at ' + JSON.stringify(PW.prog || null)); } veilOff(); return; }
    const pct = veilPct(where); VEIL.pct = pct;
    camera.updateMatrixWorld(true); camera.getWorldQuaternion(veilM.quaternion); camera.getWorldPosition(veilM.position); veilM.position.add(_v.set(0, 0, -1.4).applyQuaternion(veilM.quaternion));
    if (dbg().warmlog) { const P = PW.prog || {}, c = PW.cur || {}, sl = PW.slices[0];
      drawPanel(veilM, ['PREPARING VR ' + pct + '%', (P.ph || c.kind || 'wait') + ' ' + (c.area || '-') + ':' + (c.kind || '-') + ' ' + (P.i || 0) + '/' + (P.n || 0), ((now - VEIL.t0) / 1000).toFixed(1) + 's cap ' + (PW.linkCapped || 0) + ' max ' + (sl ? sl[0] + 'ms ' + sl[1] : '-')]); }
    else drawPanel(veilM, ['PREPARING VR', pct + '%']); }
  // v10 (t475u/t476u "have the arcade play after the loading", "the greeting and grok entering too"): while the card is up, all arcade sound is held
  // (the shared AudioContext is suspended, room music target 0) and the greeting, Grok's visit, the attract demos and the arcade's own clocks wait
  // (window.__gaHoldAV). When the card lifts: sound resumes, the room music fades in, the greeting and Grok follow a moment after the reveal.
  function holdAV(on) { if (!!window.__gaHoldAV === !!on) return; window.__gaHoldAV = !!on; VEIL.holds = (VEIL.holds || 0) + (on ? 1 : 0);
    try { const ac = window.__unlockAC; if (ac) { if (!ac.__gaHold) { const r0 = ac.resume.bind(ac); ac.resume = () => (S.blurred || window.__gaHoldAV ? Promise.resolve() : r0()); ac.__gaHold = r0; }
        if (on && ac.state === 'running') { ac.suspend(); S.acHeld = true; } else if (!on && S.acHeld) { S.acHeld = false; if (!S.blurred) ac.__gaHold(); } } } catch (e) {}
    try { window.__music && window.__music.tick && window.__music.tick(); } catch (e) {}   // music target 0 at once, not on its next 120 ms tick
    if (!on) { window.__gaRevealAt = performance.now(); logW('reveal: arcade audio + sim released'); } }
  S.holdAV = holdAV;
  function veilOff() { VEIL.on = false; VEIL.ms = Math.round(performance.now() - VEIL.t0); veilM.visible = false; holdAV(false); }
  function veilHide() { const H = VEIL.hidden; H.length = 0; for (const c of scene.children) if (c !== veilM && c.visible && !c.isLight) { H.push(c); c.visible = false; } veilM.visible = true; }
  function veilShow() { for (const c of VEIL.hidden) c.visible = true; VEIL.hidden.length = 0; veilM.visible = false; }
  // ---------- session ----------
  renderer.xr.addEventListener('sessionstart', () => {
    session = renderer.xr.getSession(); renderer.xr.setReferenceSpace(null); baseRef = renderer.xr.getReferenceSpace();
    S.presenting = true; S.starts++; st.vr = true; st.vrMove = null; S.head = null; S.posed = false; IN.left = IN.right = null;
    saved = { fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far, zoom: camera.zoom };
    for (const k in A.keys) A.keys[k] = false; st.joy.on = false; st.joy.x = st.joy.y = 0;
    S.rig = { x: monkey.position.x, y: monkey.position.y, z: monkey.position.z, yaw: st.yaw }; applyRig();
    try { renderer.xr.setFoveation(1); } catch (e) {}
    document.body.classList.add('vr'); hud.visible = !S.hudHidden; fill.visible = true; uiClose(); kioskBox = null; closeFireMenu();
    try { const n = nbApi(); if (n && n.playing) n.setZoomAmt(0); } catch (e) {}   // VR: Neon Bricks never zooms
    if (!S.areaWarm((A.tp && A.tp.where) || 1) && !dbg().noveil && window.__cullFor) { VEIL.on = true; VEIL.t0 = performance.now(); VEIL.shows++; holdAV(true); logW('card up at VR entry'); }
    S.warmReq = PW.done || VEIL.on || PW.busy || S.areaWarm((A.tp && A.tp.where) || 1) ? null : 'start';   // v9: a running sliced pre-warm is never replaced by a one-frame compile S.warmWhere = A.tp ? A.tp.where : 0; S.warmShop = !!A.shop; if (PW.done) for (const a of PW.areas) LS.done.add(a.sig);   // v18: pre-warmed = nothing to compile on entry
    try { if (!A.shop && window.__arcade && window.__arcade.loadShop) window.__arcade.loadShop(); } catch (e) {}   // t358u: load the shop now, not on the first beam
    renderer.setAnimationLoop((t, f) => A.frame(t, f));
    S.blurred = false; S.vis = session.visibilityState || 'visible';
    try { session.addEventListener('visibilitychange', onXRVis); session.addEventListener('end', onXREnd); } catch (e) {}
  });
  // vrtest-v5 (Dave t461u: "the right Meta button shows a way to close the game but the controllers are not working"): when the Quest
  // system overlay is up the session is 'visible-blurred' (or 'hidden'): the input sources belong to the system. We stop reading them,
  // let go of everything held in a cabinet game (no stuck button / pointer), stop haptics, stop pumping game pages and suspend our audio,
  // then pick it all up again on 'visible'. The 'end' event (Quit from the overlay) releases the same things even if three's sessionend is late.
  function setBlur(on, why) { on = !!on; if (S.blurred === on) return; S.blurred = on; S.blurN = (S.blurN || 0) + (on ? 1 : 0); S.blurWhy = why;
    if (on) { try { releaseAll(); } catch (e) {} IN.left = IN.right = null; for (const k in A.keys) A.keys[k] = false; st.vrMove = null; S.vrFly = false; S.vrFire = false;
      try { if (st.fly) st.fly.hold = false; } catch (e) {} try { const rf = window.__roomFire; if (rf && rf.setHeld) rf.setHeld(false); } catch (e) {}
      try { for (const src of (session && session.inputSources) || []) { const h = src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0]; if (h && h.reset) h.reset(); } } catch (e) {}
      try { const ac = window.__unlockAC; if (ac) { if (!ac.__gaHold) { const r0 = ac.resume.bind(ac); ac.resume = () => (S.blurred || window.__gaHoldAV ? Promise.resolve() : r0()); ac.__gaHold = r0; }   // music / cabinet loops / PA call resume() every frame: hold them while blurred
          if (ac.state === 'running') { ac.suspend(); S.acSuspended = true; } } } catch (e) {} }
    else { try { const ac = window.__unlockAC; if (ac && S.acSuspended && !window.__gaHoldAV) { (ac.__gaHold || ac.resume.bind(ac))(); } } catch (e) {} S.acSuspended = false; } }
  function onXRVis() { const v = session ? session.visibilityState : 'hidden'; S.vis = v; setBlur(v !== 'visible', v); }
  function onXREnd() { setBlur(true, 'end'); try { releaseAll(); } catch (e) {} S.xrEnded = (S.xrEnded || 0) + 1; }
  S.setBlurForTest = (on) => setBlur(on, 'test');
  renderer.xr.addEventListener('sessionend', () => {
    renderer.setAnimationLoop(null); if (VEIL.on) veilOff(); else holdAV(false); releaseAll(); S.blurred = false; try { const ac = window.__unlockAC; if (ac && S.acSuspended) ac.resume(); } catch (e) {} S.acSuspended = false;
    S.presenting = false; S.ends++; st.vr = false; st.vrMove = null; session = null;
    if (S.head) st.yaw = S.head.yaw; st.camInit = false; monkey.visible = true;
    renderer.xr.setReferenceSpace(null); baseRef = null;
    if (saved) { Object.assign(camera, saved); camera.updateProjectionMatrix(); }
    document.body.classList.remove('vr'); uiClose(); closeFireMenu(); laserEndBeam(); laserGlow(null); S.hudHidden = false; for (const g of signs) g.m.visible = false; fill.visible = false; hud.visible = scr.visible = dot.visible = tpRing.visible = false;
    for (const f of document.querySelectorAll('iframe')) try { f.contentWindow.__gaVRPump && f.contentWindow.__gaVRPump(); } catch (e) {}   // hand frames back to the normal rAF
    mirrorVR(false); avatarHandsOff(); unadoptAll(); LS.done.clear();
    A.resumeFlat();
    if (S.toTitle) { S.toTitle = false; toTitleFlat(); }
  });

  function pump() { if (S.blurred) return; const gf = play.frame, cf = window.__chessTable && window.__chessTable.frame; for (const f of document.querySelectorAll('iframe')) { if (f !== gf && f !== cf && (S.frames & 1)) continue; if (f === cf && IM.on) continue;   // v17: immersive chess pumps its page itself, every 4th frame
    try { const w = f.contentWindow; if (w && w.__gaVRPump) S.pumps += w.__gaVRPump(); } catch (e) {} } }

  // ---------- t355u: equipped gear in the arcade world (not in a cabinet): JETPACK -> hold A to fly, LASER PISTOL -> B shoots ----------
  // Uses the flat game's own code: main.js flyIntegrate() reads st.fly.hold (same as the FLY button), roomfire.js setHeld() (same as
  // the FIRE button: hold charges, release shoots). With the pistol on, B shoots and the menu moves to Y only.
  const jetOn = () => { try { return !!(window.__arcade && window.__arcade.jetpackOn && window.__arcade.jetpackOn()); } catch (e) { return false; } };
  const laserOn = () => { const rf = window.__roomFire; try { return !!(rf && rf.equipped && rf.equipped()); } catch (e) { return false; } };
  S.gear = () => ({ jet: jetOn(), laser: laserOn(), flying: !!S.vrFly, firing: !!S.vrFire, flyFrames: S.flyFrames || 0, laserPulls: S.laserPulls || 0 });
  function gear(ok, dt) { const R = IN.right, rf = window.__roomFire;
    const jet = jetOn(), fly = !!(ok && jet && R && R.a && !FM.open && !FM.ateA);
    if (jet || S.vrFly) { if (st.fly) st.fly.hold = fly; if (fly) S.flyFrames = (S.flyFrames || 0) + 1; S.vrFly = fly; }
    const las = laserOn(), fire = !!(ok && las && R && R.b && rf && rf.shown && !FM.open);
    if (las || S.vrFire || VL.beam || (VL.glow && VL.glow.visible) || VL.beamHeld) vrLaser(fire, dt, R); S.vrFire = fire; }
  // ---------- t359u + vrtest-v14 (t488u/t489u): laser from the RIGHT CONTROLLER, five fire types ----------
  // roomfire.js aims from the avatar's body, so VR runs the trigger itself: RF.fire() still makes the real bolt (zap, shot count,
  // multiplayer), then we place it on the controller / muzzle aim. Classic = the original single bolt; the other four types have
  // their own colour, sound and haptic. Bolts are pooled in roomfire.js; the beam and charge glow are reused (no new lights).
  const FIRE_KEY = 'galacticarcade.vrFireType';
  const FIRE_TYPES = [
    { id: 'classic', name: 'CLASSIC', color: 0x48f2ff, accent: 0x2f8cff },
    { id: 'pulse', name: 'RAPID PULSE', color: 0xffe14a, accent: 0xffb000 },
    { id: 'scatter', name: 'SCATTER SHOT', color: 0xff6a22, accent: 0xff3010 },
    { id: 'charge', name: 'CHARGE SHOT', color: 0xe14bff, accent: 0xffe14a },
    { id: 'beam', name: 'CONTINUOUS', color: 0x2dff8a, accent: 0x00c853 }
  ];
  const FM = { open: false, hover: 0, type: 'classic', group: null, warm: [], stickArmed: true, ateA: false, picks: 0, opens: 0 };
  try { const v = localStorage.getItem(FIRE_KEY); if (FIRE_TYPES.some(t => t.id === v)) FM.type = v; } catch (e) {}
  FM.hover = Math.max(0, FIRE_TYPES.findIndex(t => t.id === FM.type));
  const fireSpec = id => FIRE_TYPES.find(t => t.id === (id || FM.type)) || FIRE_TYPES[0];
  function setFireType(id) { const t = fireSpec(id); if (!t) return; FM.type = t.id; FM.hover = FIRE_TYPES.indexOf(t); try { localStorage.setItem(FIRE_KEY, t.id); } catch (e) {} if (FM.group) drawFireMenu(); }
  function fireCols(id) { const t = fireSpec(id); if (t.id === 'classic') return laserCols(); const c = laserCols(); return { a: t.color, b: t.accent, char: c.char, kind: t.id }; }
  function drawFireIcon(g, id, x, y, s, col) {
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = Math.max(2, s * 0.1); g.lineCap = 'round'; g.lineJoin = 'round';
    if (id === 'classic') { g.beginPath(); g.moveTo(x - s * 0.45, y); g.lineTo(x + s * 0.5, y); g.stroke(); g.beginPath(); g.arc(x + s * 0.5, y, s * 0.14, 0, 7); g.fill(); }
    else if (id === 'pulse') { for (let i = 0; i < 3; i++) { const px = x - s * 0.4 + i * s * 0.32; g.beginPath(); g.moveTo(px, y); g.lineTo(px + s * 0.18, y); g.stroke(); g.beginPath(); g.arc(px + s * 0.18, y, s * 0.08, 0, 7); g.fill(); } }
    else if (id === 'scatter') { for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(x - s * 0.2, y); g.lineTo(x + s * 0.5, y + i * s * 0.22); g.stroke(); } }
    else if (id === 'charge') { g.beginPath(); g.arc(x, y, s * 0.22, 0, 7); g.stroke(); g.beginPath(); g.arc(x, y, s * 0.38, 0, 7); g.stroke(); g.beginPath(); g.arc(x, y, s * 0.12, 0, 7); g.fill(); }
    else { g.beginPath(); g.moveTo(x - s * 0.5, y); g.lineTo(x + s * 0.55, y); g.lineWidth = s * 0.22; g.stroke(); g.lineWidth = s * 0.1; g.beginPath(); g.moveTo(x - s * 0.5, y - s * 0.18); g.lineTo(x + s * 0.45, y - s * 0.18); g.moveTo(x - s * 0.5, y + s * 0.18); g.lineTo(x + s * 0.45, y + s * 0.18); g.stroke(); } }
  function drawFireMenu() {
    if (!FM.cv) return; const g = FM.cv.getContext('2d'), W = FM.cv.width, H = FM.cv.height, n = FIRE_TYPES.length, row = (H - 70) / n;
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(8, 28, 48, 0.55)'); bg.addColorStop(1, 'rgba(4, 10, 24, 0.72)');
    g.fillStyle = bg; g.fillRect(8, 8, W - 16, H - 16);
    g.strokeStyle = 'rgba(80, 230, 255, 0.85)'; g.lineWidth = 4; g.strokeRect(10, 10, W - 20, H - 20);
    g.fillStyle = '#7dffff'; g.font = '900 36px "Courier New",monospace'; g.textAlign = 'center'; g.fillText('LASER', W / 2, 48);
    g.font = '800 22px "Courier New",monospace'; g.fillStyle = 'rgba(180, 240, 255, 0.7)'; g.fillText('A SELECT  ·  CLICK CLOSE', W / 2, 70);
    for (let i = 0; i < n; i++) {
      const t = FIRE_TYPES[i], y = 86 + i * row, on = i === FM.hover, sel = t.id === FM.type, hex = '#' + t.color.toString(16).padStart(6, '0');
      if (on) { g.fillStyle = 'rgba(80, 230, 255, 0.28)'; g.fillRect(20, y, W - 40, row - 6); g.strokeStyle = '#7dffff'; g.lineWidth = 3; g.strokeRect(20, y, W - 40, row - 6); }
      else if (sel) { g.strokeStyle = hex; g.lineWidth = 2; g.strokeRect(22, y + 2, W - 44, row - 10); }
      drawFireIcon(g, t.id, 58, y + row * 0.42, 28, on ? '#e8ffff' : hex);
      g.textAlign = 'left'; g.font = (on ? '900 ' : '800 ') + '30px "Courier New",monospace'; g.fillStyle = on ? '#e8ffff' : sel ? hex : 'rgba(200, 240, 255, 0.82)';
      g.fillText(t.name, 96, y + row * 0.48 + 10);
      if (sel) { g.textAlign = 'right'; g.font = '900 26px "Courier New",monospace'; g.fillStyle = hex; g.fillText('●', W - 36, y + row * 0.48 + 10); } }
    if (FM.tex) FM.tex.needsUpdate = true; }
  function makeFireMenu() {
    if (dbg().nofiretypes) return;
    if (FM.group) return;
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640; FM.cv = cv;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.premultiplyAlpha = false; FM.tex = tex;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.225), mat); mesh.name = 'vrFireMenu'; mesh.renderOrder = 1002; mesh.frustumCulled = false;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.188, 0.233), new THREE.MeshBasicMaterial({ color: 0x0a2030, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false }));
    back.position.z = -0.002; back.renderOrder = 1001; back.frustumCulled = false;
    const group = new THREE.Group(); group.name = 'vrFireHolo'; group.add(back); group.add(mesh); group.visible = false; scene.add(group);
    FM.group = group; FM.mesh = mesh; FM.warm.push(mesh, back); drawFireMenu(); }
  function openFireMenu() { if (dbg().nofiretypes) return; makeFireMenu(); FM.open = true; FM.hover = Math.max(0, FIRE_TYPES.findIndex(t => t.id === FM.type)); FM.stickArmed = true; FM.opens++; drawFireMenu(); S.fireMenuOpens = FM.opens; }
  function closeFireMenu() { FM.open = false; if (FM.group) FM.group.visible = false; }
  function placeFireMenu() {
    if (!FM.group) return; const show = !!(S.presenting && FM.open && !VEIL.on && !S.blurred); FM.group.visible = show; if (!show) return;
    const rc = ctrlFor('right'); if (!rc || !rc.userData.src) { FM.group.visible = false; return; }
    rc.updateMatrixWorld(true); FM.group.position.set(0, 0.16, -0.05).applyMatrix4(rc.matrixWorld);
    if (S.head) FM.group.lookAt(S.head.x, S.head.y, S.head.z); else { rc.getWorldQuaternion(_q); FM.group.quaternion.copy(_q); } }
  function fireMenuInput(L, R) {
    FM.ateA = false;
    if (L && L.stickDown) { S.hudHidden = !S.hudHidden; S.hudToggles = (S.hudToggles || 0) + 1; if (L.src) pulse(L.src, 0.35, 20); }
    const walk = play.mode === 'walk' && !(A.tp && A.tp.locked) && !(A.shop && A.shop.open) && !(A.nb && A.nb.playing) && !nkPlaying();
    if (R && R.stickDown && walk && !dbg().nofiretypes) { if (FM.open) closeFireMenu(); else openFireMenu(); if (R.src) pulse(R.src, 0.45, 28); }
    if (!FM.open) { FM.stickArmed = true; return; }
    if (R && R.aDown) { setFireType(FIRE_TYPES[FM.hover].id); FM.picks++; FM.ateA = true; FM.lastPick = FM.type; closeFireMenu(); if (R.src) pulse(R.src, 0.7, 35); return; }
    if (!R) return;
    const ax = R.x || 0, ay = R.y || 0, mag = Math.hypot(ax, ay);
    if (mag < 0.35) { FM.stickArmed = true; return; }
    if (!FM.stickArmed || mag < 0.55) return;
    const step = Math.abs(ay) >= Math.abs(ax) ? (ay > 0 ? 1 : -1) : (ax > 0 ? 1 : -1);   // WebXR stick y+: down / toward the player = next option
    FM.hover = (FM.hover + step + FIRE_TYPES.length) % FIRE_TYPES.length; FM.stickArmed = false; drawFireMenu(); if (R.src) pulse(R.src, 0.25, 15); }
  const VL = { held: false, charge: 0, spent: false, beam: null, beamMesh: null, beamT: 0, beamHeld: false, glow: null, last: null, beams: 0, bolts: 0, pulseT: 0 };
  const CHARGE_FIRE_T = 1.25, PULSE_GAP = 0.09;
  const _lo = new THREE.Vector3(), _ld = new THREE.Vector3(), _lq = new THREE.Quaternion(), _le = new THREE.Vector3(), _lt = new THREE.Vector3(), _fan = new THREE.Vector3(), _fanQ = new THREE.Quaternion(), _fanAx = new THREE.Vector3();
  function laserAim() { const i = ctrls.findIndex(c => c.userData.hand === 'right' && c.userData.src); if (i < 0) return null;
    const c = ctrls[i], g = grips[i]; c.updateMatrixWorld(true); c.getWorldQuaternion(_lq); _ld.set(0, 0, -1).applyQuaternion(_lq).normalize();   // pointing direction = the controller's ray
    (g && g.visible !== false ? (g.updateMatrixWorld(true), _lo.setFromMatrixPosition(g.matrixWorld)) : _lo.setFromMatrixPosition(c.matrixWorld)).addScaledVector(_ld, 0.07);   // origin = just in front of the grip
    // t361u: the alien's shot leaves its floating machine (botEye, as roomfire.js does), aimed at where the right controller points
    // v13 (t395u): with the laser pistol in the avatar's right hand the shot leaves the gun's MUZZLE (the IK puts the hand on the controller
    // and turns the barrel along its ray), so in the mirror and in the world the bolt / beam comes out of the gun
    const pz = monkey.getObjectByName('gaPistolMuzzle'), pgun = pz && pz.parent;
    if (pz && pgun && pgun.visible && (monkey.userData || {}).char !== 'alien') { try { avatarHands(); } catch (e) {} pz.getWorldPosition(_le); _lo.copy(_le).addScaledVector(_ld, 0.03); VL.fromMuzzle = (VL.fromMuzzle || 0) + 1; return { o: _lo, d: _ld, muzzle: true }; }
    const u = monkey.userData || {}; if (u.char === 'alien') { const eye = monkey.getObjectByName('botEye') || u.bot; if (eye) { monkey.updateMatrixWorld(true); eye.getWorldPosition(_le); _lt.copy(_lo).addScaledVector(_ld, 20); _ld.copy(_lt).sub(_le).normalize(); _lo.copy(_le).addScaledVector(_ld, 0.12); return { o: _lo, d: _ld, alien: true }; } }
    return { o: _lo, d: _ld }; }
  function laserCols() { const rf = window.__roomFire; try { return rf.playerCols(); } catch (e) { return { a: 0x2f8cff, b: 0x0a3cff, char: 'monkey' }; } }
  function ensureLaserFX() {
    if (dbg().nofiretypes) return;
    if (!VL.glow) { const col = fireCols('charge'); VL.glow = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: col.a, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      VL.glow.name = 'vrLaserCharge'; VL.glow.renderOrder = 7; VL.glow.frustumCulled = false; VL.glow.visible = false;
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: col.b, transparent: true, opacity: 0.3, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      halo.name = 'vrLaserHalo'; VL.glow.add(halo); scene.add(VL.glow); FM.warm.push(VL.glow, halo); }
    if (!VL.beamMesh) { const L = 28, col = fireCols('beam'), g = new THREE.Group(); g.name = 'vrLaserBeam';
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, L, 10, 1, true), new THREE.MeshBasicMaterial({ color: col.a, toneMapped: false, depthWrite: false, fog: false }));
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, L, 10, 1, true), new THREE.MeshBasicMaterial({ color: col.b, transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      for (const m of [core, glow]) { m.rotation.x = Math.PI / 2; m.position.z = L / 2; m.renderOrder = 6; m.frustumCulled = false; g.add(m); }
      g.visible = false; scene.add(g); VL.beamMesh = g; FM.warm.push(core, glow); }
    makeFireMenu(); }
  function laserGlow(k, aim, col) { ensureLaserFX(); if (!VL.glow) return;
    const on = k != null && !!aim; VL.glow.visible = on; if (!on) return;
    VL.glow.position.copy(aim.o); VL.glow.scale.setScalar(0.5 + k * 2.2); VL.glow.material.color.setHex(col.a); VL.glow.children[0].material.color.setHex(col.b);
    VL.glow.material.opacity = 0.5 + k * 0.45; VL.glow.children[0].material.opacity = 0.18 + k * 0.4 + Math.sin(S.frames * 0.5) * 0.05 * k; }
  function laserBeam(aim, col, opts) { ensureLaserFX(); const g = VL.beamMesh, first = !VL.beam; g.children[0].material.color.setHex(col.a); g.children[1].material.color.setHex(col.b);
    g.visible = true; VL.beam = g;
    if (opts && opts.held) VL.beamHeld = true;
    else if (first) { VL.beamHeld = false; VL.beamT = 3; VL.beams++; S.vrBeams = VL.beams; }
    if (aim) { g.position.copy(aim.o); g.lookAt(aim.o.x + aim.d.x, aim.o.y + aim.d.y, aim.o.z + aim.d.z); VL.last = { o: aim.o.toArray(), d: aim.d.toArray(), beam: true, kind: FM.type }; } }
  function laserEndBeam() { if (VL.beamMesh) VL.beamMesh.visible = false; VL.beam = null; VL.beamT = 0; VL.beamHeld = false; stopBeamHum(); }
  let beamHum = null;
  function stopBeamHum() { if (!beamHum) return; try { const ac = window.__unlockAC; if (ac && beamHum.g) { const t = ac.currentTime; beamHum.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06); if (beamHum.o) beamHum.o.stop(t + 0.08); if (beamHum.o2) beamHum.o2.stop(t + 0.08); } } catch (e) {} beamHum = null; }
  function startBeamHum() { stopBeamHum(); try { if (window.__muted || (window.__mute && window.__mute.on) || localStorage.getItem('neonarcade.mute') === '1') return; const ac = window.__unlockAC || (window.__unlockAC = new (window.AudioContext || window.webkitAudioContext)()); if (!ac) return; if (ac.state === 'suspended' && ac.resume) ac.resume().catch(() => {});
      const t = ac.currentTime, o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = 280; o2.type = 'sine'; o2.frequency.value = 560; f.type = 'lowpass'; f.frequency.value = 900; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.08);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(ac.destination); o.start(t); o2.start(t); beamHum = { o, o2, g }; } catch (e) { beamHum = null; } }
  function shootAimed(aim, opts, R) {
    const rf = window.__roomFire; if (!rf || !rf.fire || !aim) return null;
    const dir = opts.dir || aim.d, o = aim.o.toArray(), d = dir.toArray ? dir.toArray() : dir;
    const M = window.__mp, z0 = M && M.zap; let zh = null; if (z0) M.zap = (oo, dd, c) => { zh = c; return true; };
    let L = null; try { L = rf.fire(Object.assign({ fromRelease: true, o, d }, opts)); } finally { if (z0) M.zap = z0; }
    if (L && z0 && zh) { try { if (z0(L.o, L.dir.toArray(), zh, opts.k || 0)) MPV.zaps++; } catch (e) {} }
    if (L) { VL.bolts++; VL.last = { o: L.o, d: L.dir.toArray(), k: L.k, char: (L.hue === 'red' ? 'alien' : 'monkey'), kind: opts.kind || FM.type }; }
    return L; }
  function vrLaser(held, dt, R) {
    const rf = window.__roomFire, aim = laserAim(), kind = FM.type, col = fireCols(kind);
    if (VL.beam && !VL.beamHeld && kind !== 'beam') { VL.beamT -= dt; laserBeam(aim, col); if (R && S.frames % 6 === 0) pulse(R.src, 0.5, 20); if (VL.beamT <= 0) laserEndBeam(); }
    if (VL.beamHeld && kind !== 'beam') laserEndBeam();
    if (kind === 'classic') {
      laserGlow(null); if (held && !VL.held) { S.laserPulls = (S.laserPulls || 0) + 1; shootAimed(aim, { k: 0, kind: 'classic' }, R); if (R) pulse(R.src, 0.55, 28); } }
    else if (kind === 'pulse') {
      laserGlow(null);
      if (held && aim) { if (!VL.held) { VL.pulseT = 0; S.laserPulls = (S.laserPulls || 0) + 1; } VL.pulseT -= dt;
        if (VL.pulseT <= 0) { VL.pulseT = PULSE_GAP; shootAimed(aim, { k: 0, kind: 'pulse', color: col.a, cool: PULSE_GAP, force: true, life: 0.32 }, R); if (R) pulse(R.src, 0.25, 14); } } }
    else if (kind === 'scatter') {
      laserGlow(null);
      if (held && !VL.held && aim) { S.laserPulls = (S.laserPulls || 0) + 1; const n = 5, spread = 0.14;
        _fanAx.set(0, 1, 0); if (Math.abs(aim.d.dot(_fanAx)) > 0.95) _fanAx.set(1, 0, 0);
        for (let i = 0; i < n; i++) { _fanQ.setFromAxisAngle(_fanAx, (i - (n - 1) / 2) * spread); _fan.copy(aim.d).applyQuaternion(_fanQ).normalize();
          shootAimed(aim, { k: 0, kind: 'scatter', color: col.a, dir: _fan.clone(), silent: i > 0, force: i > 0, noCool: i > 0 }, R); }
        if (R) pulse(R.src, 0.8, 40); } }
    else if (kind === 'charge') {
      if (held && !VL.held) { VL.charge = 0; VL.spent = false; S.laserPulls = (S.laserPulls || 0) + 1; if (R) pulse(R.src, 0.35, 24); try { if (rf && rf.startChargeSnd) rf.startChargeSnd(); } catch (e) {} }
      if (held) { VL.charge += dt; const k = Math.min(1, VL.charge / CHARGE_FIRE_T); laserGlow(k, aim, col); if (R && S.frames % 8 === 0) pulse(R.src, 0.1 + k * 0.55, 15); try { if (rf && rf.tickChargeSnd) rf.tickChargeSnd(k); } catch (e) {} }
      else { laserGlow(null); try { if (rf && rf.stopChargeSnd) rf.stopChargeSnd(); } catch (e) {}
        if (VL.held && !VL.spent && aim) { const k = Math.min(0.999, Math.max(0.08, VL.charge / CHARGE_FIRE_T)); shootAimed(aim, { k, kind: 'charge', color: col.a, fromRelease: true }, R); if (R) pulse(R.src, 0.4 + k * 0.6, 50); } } }
    else if (kind === 'beam') {
      laserGlow(null);
      if (held && aim) { if (!VL.held || !VL.beamHeld) { S.laserPulls = (S.laserPulls || 0) + 1; laserBeam(aim, col, { held: true }); VL.beams++; S.vrBeams = VL.beams; try { if (rf && rf.zapKind) rf.zapKind('beam', col.char === 'alien' ? 'red' : 'cyan'); } catch (e) {} startBeamHum(); if (R) pulse(R.src, 0.6, 30); }
        else { laserBeam(aim, col, { held: true }); if (R && S.frames % 6 === 0) pulse(R.src, 0.4, 18); } }
      else if (VL.beamHeld) laserEndBeam(); }
    VL.held = held; }
  ensureLaserFX();
  S.setFireType = setFireType;
  S.fireMenu = () => ({ open: FM.open, hover: FM.hover, type: FM.type, types: FIRE_TYPES.map(t => t.id), visible: !!(FM.group && FM.group.visible),
    hudHidden: !!S.hudHidden, hudVisible: hud.visible, picks: FM.picks, opens: FM.opens, lastPick: FM.lastPick || null,
    pos: FM.group && FM.group.visible ? FM.group.position.toArray() : null, labels: FIRE_TYPES.map(t => t.name), colors: FIRE_TYPES.map(t => t.color) });
  S.vrLaser = () => ({ ctrl: (() => { const i = ctrls.findIndex(c => c.userData.hand === 'right' && c.userData.src); if (i < 0) return null; const c = ctrls[i]; c.updateMatrixWorld(true); const q = c.getWorldQuaternion(new THREE.Quaternion()); return { d: new THREE.Vector3(0, 0, -1).applyQuaternion(q).toArray(), o: new THREE.Vector3().setFromMatrixPosition((grips[i] || c).matrixWorld).toArray() }; })(),
    eye: (() => { const e = monkey.getObjectByName('botEye'); if (!e || (monkey.userData || {}).char !== 'alien') return null; monkey.updateMatrixWorld(true); return e.getWorldPosition(new THREE.Vector3()).toArray(); })(), held: VL.held, charge: VL.charge, bolts: VL.bolts, beams: VL.beams, beam: !!VL.beam, beamHeld: !!VL.beamHeld, type: FM.type, last: VL.last, glow: VL.glow && VL.glow.visible ? { color: VL.glow.material.color.getHex(), halo: VL.glow.children[0].material.color.getHex(), scale: VL.glow.scale.x, at: VL.glow.position.toArray() } : null,
    aim: (() => { const a = laserAim(); return a ? { o: a.o.toArray(), d: a.d.toArray() } : null; })() });
  // ---------- t358u: warm-up so walking / turning / beaming doesn't freeze ----------
  // The flat game compiles its shaders for the post-processing target (linear, no tone mapping); the headset draws straight into the XR
  // framebuffer (sRGB + tone mapping), so every material compiled AGAIN the first time it came into view in VR (turn = freeze), and again for
  // the mirror's own target. Here, inside an XR frame (three has bound the XR target), compile the whole scene for that target and for the
  // mirror's target, and upload the textures, at session start, when the shop arrives, and right after each teleport (the lit area changes).
  function warmXR(why) { const t0 = performance.now(), p0 = renderer.info.programs ? renderer.info.programs.length : 0; let tex = 0;
    try { mirrorTwin(); } catch (e) {}
    try { camera.updateMatrixWorld(true); renderer.compile(scene, camera); } catch (e) { S.lastError = 'warm ' + e; }
    const t = MV.twin; if (t) { const prev = renderer.getRenderTarget(), mv = A.monkey && A.monkey.visible; const xe = renderer.xr.enabled; try { if (A.monkey) A.monkey.visible = true; renderer.xr.enabled = false; renderer.setRenderTarget(t.getRenderTarget()); renderer.compile(scene, camera); } catch (e) {} finally { renderer.xr.enabled = xe; renderer.setRenderTarget(prev); if (A.monkey) A.monkey.visible = mv; } }   // as the Reflector pass draws (xr off, half-float target)
    if (renderer.initTexture) { const seen = new Set(); scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null; if (!ms) return;
      for (const m of ms) for (const k of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'lightMap', 'envMap']) { const x = m[k]; if (x && x.isTexture && !seen.has(x) && !x.isRenderTargetTexture && !x.isVideoTexture && !(x.image && x.image.tagName === 'CANVAS')) { seen.add(x); try { renderer.initTexture(x); tex++; } catch (e) {} } } }); }
    for (const p of renderer.info.programs || []) { try { p.getUniforms(); } catch (e) {} }   // link now (entry / beam cut / arrival), not on first sight; already-linked ones are cached
    try { LS.done.add(lightSig()); } catch (e) {}
    const r = { why, ms: +(performance.now() - t0).toFixed(1), programs: (renderer.info.programs ? renderer.info.programs.length : 0) - p0, textures: tex }; (S.warms = S.warms || []).push(r); return r; }
  S.warmXR = warmXR;
  // Light-count variants: three compiles a new program for EVERY lit material whenever the number of lit lights changes. In the arcade one spot
  // (dsSpot) blinks on/off as its station group is culled, so turning around recompiled the cabinets (13 vs 14 spots). In VR such a light moves
  // onto an always-visible holder (following its old parent's transform) and is drawn at intensity 0 while it should be off, right around the
  // frame's render only; it goes back home when VR ends. Whole-room culls (beaming) are left alone.
  const PIN = { lights: new Set(), seen: new Map(), pins: 0, holder: null, lastArea: 0, areaT: 0 };
  const effVis = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  function adopt(l) { if (PIN.lights.has(l) || !l.parent) return; if (!PIN.holder) { PIN.holder = new THREE.Group(); PIN.holder.name = 'vrPinnedLights'; scene.add(PIN.holder); }
    const home = l.parent; l.userData.vrHome = { parent: home, pos: l.position.clone(), quat: l.quaternion.clone(), scale: l.scale.clone() }; PIN.holder.attach(l); PIN.lights.add(l); }
  // vrtest-v7 (t464u, real-Quest freezes at Grok's counter and the top of the golf stairs): the mini golf's 14 point lights (basement 9 +
  // stair lamps 5) went in and out of the shop's light list (basement shown from 8 m, lamps on from 3 m), so the shop flipped between
  // three light sets (10 / 19 / 24 point lights) = three full program sets switched in one frame each. In the shop they now ride the pinned
  // holder all the time (drawn at intensity 0 while off / the basement is hidden): ONE fixed light count, one program set, warmed once.
  // ?golflights=old restores the old switching (for comparing on the headset).
  function golfPin(on) { const g = scene.getObjectByName('golfStairs'); if (!g || dbg().golfold) return; const ls = []; g.traverse(o => { if (o.isLight && !o.isAmbientLight && !o.isHemisphereLight) ls.push(o); });
    for (const l of [...PIN.lights]) if (l.userData.vrGolf && !on) { const h = l.userData.vrHome; if (l.userData.vrPinI != null) { l.intensity = l.userData.vrPinI; l.visible = l.userData.vrPinV; l.userData.vrPinI = null; }
      if (h && h.parent) { h.parent.add(l); l.position.copy(h.pos); l.quaternion.copy(h.quat); l.scale.copy(h.scale); } l.userData.vrHome = null; PIN.lights.delete(l); }
    if (on) for (const l of ls) if (!PIN.lights.has(l)) { adopt(l); l.userData.vrGolf = true; }
    PIN.golf = on; }
  // pinned whenever the shop's white room is drawn this frame (main.js culls it at the beam cut), so the cut never sees the shop with 10 lights
  function golfWant() { const wr = A.tp && A.tp.whiteRoom; return wr ? effVis(wr) : !!(A.tp && A.tp.where === 2); }
  S.golfPin = golfPin;
  function pinScan() { if (!PIN.seeded) { PIN.seeded = true; const ds = []; scene.traverse(o => { if (o.isLight && o.name === 'dsSpot') ds.push(o); }); ds.forEach(adopt); }   // known blinker: Dead Signal station spot (its group is culled by distance)
    const area = A.tp ? A.tp.where : 0; if (!PIN.staging) { const gw = golfWant(); if (gw !== !!PIN.golf) golfPin(gw); }
    if (area !== PIN.lastArea || (A.tp && A.tp.state !== 'idle')) { PIN.lastArea = area; PIN.areaT = S.frames; PIN.seen.clear(); return; }
    if (S.frames % 15 !== 0 && PIN.seen.size) return; const flips = [];
    scene.traverse(o => { if (!o.isLight || o.isAmbientLight || o.isHemisphereLight || PIN.lights.has(o)) return; const v = effVis(o), was = PIN.seen.get(o); if (was !== undefined && was !== v) flips.push(o); PIN.seen.set(o, v); });
    if (S.frames - PIN.areaT > 60 && flips.length && flips.length < 3) for (const l of flips) adopt(l); }   // a light blinking on its own (not a whole room being culled)
  function pinLights() { for (const l of PIN.lights) { const h = l.userData.vrHome; if (!h || !h.parent) continue; h.parent.updateMatrixWorld(); _v.copy(h.pos).applyMatrix4(h.parent.matrixWorld); l.position.copy(_v);
      const on = l.visible && effVis(h.parent); if (!on) { l.userData.vrPinI = l.intensity; l.userData.vrPinV = l.visible; l.intensity = 0; l.visible = true; PIN.pins++; } } }
  function unpinLights() { for (const l of PIN.lights) if (l.userData.vrPinI != null) { l.intensity = l.userData.vrPinI; l.visible = l.userData.vrPinV; l.userData.vrPinI = null; } }
  function unadoptAll() { unpinLights(); for (const l of PIN.lights) { const h = l.userData.vrHome; if (h && h.parent) { h.parent.add(l); l.position.copy(h.pos); l.quaternion.copy(h.quat); l.scale.copy(h.scale); } l.userData.vrHome = null; } PIN.lights.clear(); PIN.seen.clear(); PIN.golf = false; }
  S.pinned = () => [...PIN.lights].map(l => l.name || l.type);
  function warmCheck() {
    if (!!A.shop !== S.warmShop) { S.warmShop = !!A.shop; if (A.shop && !PW.busy && !PW.done) S.warmReq = S.warmReq || 'shop'; }
    if (S.warmReq && S.frames > 1) { const why = S.warmReq; S.warmReq = null; pinScan(); pinLights(); warmXR(why); unpinLights(); } }
  // ---------- per frame: before the arcade step (input -> movement) ----------
  function pre(dt, xf) {
    S.frames++; poll(); if (S.rigDirty) { applyRig(); S.rigDirty = false; }
    veilFrame(); if (VEIL.on) { st.vrMove = null; S.walkStart = null; S.turnRate = 0; return; }
    if (S.blurred) { st.vrMove = null; S.walkStart = null; S.turnRate = 0; S.blurFrames = (S.blurFrames || 0) + 1; return; }   // vrtest-v5: overlay up: no movement / game input
    unpinLights(); if (xf) warmCheck();
    const ref = renderer.xr.getReferenceSpace(), vp = xf && ref ? xf.getViewerPose(ref) : null;
    if (vp) { const p = vp.transform.position, o = vp.transform.orientation; _e.setFromQuaternion(_q.set(o.x, o.y, o.z, o.w), 'YXZ'); S.head = { x: p.x, y: p.y, z: p.z, yaw: _e.y, pitch: _e.x }; S.posed = true; }
    const walk = play.mode === 'walk' && !(A.tp && A.tp.locked) && !(A.shop && A.shop.open);
    S.turnRate = 0;
    S.walkStart = null; st.vrMove = null;
    const L = IN.left, R = IN.right;
    fireMenuInput(L, R);
    if (chessPre()) { gear(false, dt); if (S.head) st.yaw = S.head.yaw; return; }   // v12: seated at the chess table: no walking / turning
    gear(walk && !(A.nb && A.nb.playing), dt);
    if (!walk || !S.head) return;
    // roomscale: your real steps move the player too, through the same collision (a wall or cabinet pushes the world back)
    const h = S.head, q = _v.set(h.x, monkey.position.y, h.z); A.collide(q); moveRig(q.x - h.x, q.z - h.z); monkey.position.x = q.x; monkey.position.z = q.z;
    const nbOn = !!(A.nb && A.nb.playing);
    // t350u smooth turn: rate = 90 deg/s * ((|x| - 0.15) / 0.85)^2, nothing inside the deadzone, no snapping. Off while Neon Bricks takes the sticks.
    // vrtest-v14: the fire-type hologram owns the right stick while it is open (no turn / no teleport from that stick).
    if (R && !nbOn && !FM.open) { const ax = Math.abs(R.x);
      if (ax > TURN_DZ) { const k = Math.min(1, (ax - TURN_DZ) / (1 - TURN_DZ)), rate = -Math.sign(R.x) * TURN_MAX * k * k, a = rate * dt;
        turnRig(a); S.turnRate = rate; S.turnSum += Math.abs(a); S.turnTime += dt; S.turnMaxStep = Math.max(S.turnMaxStep, Math.abs(a)); } }
    st.yaw = S.head.yaw;
    if (nbOn) { const P = [L, R].reduce((b, q) => q && Math.hypot(q.x, q.y) > Math.hypot(b.x, b.y) ? q : b, { x: 0, y: 0 }); st.vrMove = { x: P.x, y: P.y, speed: SPEED }; }   // either stick moves the blocks
    else st.vrMove = L ? { x: L.x, y: L.y, speed: SPEED } : null;
    S.walkStart = { x: monkey.position.x, z: monkey.position.z };
  }

  // ---------- per frame: after the arcade step (follow the player, rays, the game screen, HUD) ----------
  function post(dt) {
    if (blOn()) blStep();
    if (S.walkStart) { moveRig(monkey.position.x - S.walkStart.x, monkey.position.z - S.walkStart.z, monkey.position.y - S.rig.y); }
    // t350u: the teleporter moves the player (walk onto the pad, then the cut to the other pad): the headset goes with them
    if (A.tp && A.tp.locked && S.head) { const dx = monkey.position.x - S.head.x, dz = monkey.position.z - S.head.z; if (dx * dx + dz * dz > 1e-6) { moveRig(dx, dz); S.tpFollow = (S.tpFollow || 0) + 1; applyRig(); S.rigDirty = false; } if (UI.open) uiClose(); }   // v18: the new reference space now, so the very next headset frame is already at the destination
    monkey.visible = false;
    const chessOn = !!(chessT() && chessT().state !== 'idle');
    if (S.head && !chessOn) monkey.rotation.y = S.head.yaw + Math.PI;   // the avatar (seen in the mirror / by other players) faces where you look
    // t353u mirror: the shop's Reflector only renders for the main camera, but in VR three hands it the per-eye XR cameras, so it never
    // rendered (black). Kick it here, before the frame's render, with the main camera (three keeps it at the head pose). The Reflector
    // itself turns XR off for its own pass and restores the render target, so this is XR-safe (same lesson as the black-room fix).
    avatarHands(); fpGun(); nkCtrl(); mpStep(); mirrorFrame(); if (dbg().nogrok && A.shop && A.shop.grok) A.shop.grok.visible = false;
    signsUpdate(); S.hoverTarget = null; UI.msgT = Math.max(0, UI.msgT - dt);
    if (UI.open && S.head && Math.hypot(S.head.x - uiM.position.x, S.head.z - uiM.position.z) > 4) uiClose();   // walked away
    const nbOn = !!(nbApi() && nbApi().playing);
    const mode = play.mode, inGame = mode === 'game', L = IN.left, R = IN.right;
    dot.visible = false; tpRing.visible = false; S.hover = null;
    // rays
    let aimScreen = null;
    for (const c of ctrls) { const ray = c.userData.ray; if (!c.userData.src) { ray.visible = false; continue; } ray.visible = true; ray.scale.z = 3; ray.material.color.setHex(0x3ff3ff); }
    const order = [['right', R], ['left', L]];
    const anyP = k => !!((L && L[k]) || (R && R[k]));
    if (mode !== 'walk' && chessOn) chessM.visible = false;
    if (mode === 'walk' && chessOn) chessPost(dt, L, R, order);   // v12: at the chess table
    else if (mode === 'walk' && nbOn) {   // NEON BRICKS: sticks move (step() -> nb.joy), A/X/trigger rotate, B/Y hard drop, hold grip = leave
      const n = nbApi(); if (UI.open) uiClose();
      if (anyP('aDown') || anyP('trigDown')) { n.rotate(); S.nbRot++; }
      if (anyP('bDown')) { n.hardDrop(); S.nbDrops++; }
      const grip = (L && L.grip) || (R && R.grip); S.nbGripT = grip ? (S.nbGripT || 0) + dt : 0;   // own timer (S.gripT is reset outside cabinet games)
      if (S.nbGripT >= GRIP_EXIT_S) { S.nbGripT = 0; n.stop('exit'); S.nbExits++; S.backs.nb++; pulse((L && L.grip ? L : R).src, 0.8, 60); }
      if (n.zoomAmt) n.setZoomAmt(0);
    } else if (mode === 'walk') {
      if (nkRound()) {   // v23 (Dave t421u): Neon Knockout round: B or Y pauses / resumes (GRIP does nothing); the pause panel stays up until a choice
        if (anyP('bDown')) { if (nkPaused()) nkResume(); else nkPause(); pulse((L && L.bDown ? L : R).src, 0.6, 40); }
        else if (nkPaused() && UI.open !== 'nkPause') uiOpen('nkPause'); }
      else if (L && L.bDown && !(A.tp && A.tp.locked) && !nkPlaying()) { if (UI.open) uiClose(); else uiOpen('menu'); }   // v25 (Dave t442u): Y (left) = menu, always; B (right) = the laser pistol's FIRE (gear()), nothing without the gun
      else if (anyP('gripDown') && UI.open) { uiClose(); S.backs.menu++; pulse((L && L.gripDown ? L : R).src, 0.5, 30); }   // v12 (t382u): GRIP (short press) = back: closes any panel (menu, shop, accessories, tickets, chat, pack)
      UI.hover = null;
      const golfHand = !UI.open && !nkPlaying() ? golfVR(L, R) : null;   // v19: mini golf putting owns the pointing hand near a ball
      if (nkPlaying()) { for (const c of ctrls) c.userData.ray.visible = false; }   // v16: boxing round: the controllers are gloves (no rays, no floor teleports)
      else for (const [hand, P] of order) { const c = ctrlFor(hand); if (!c || !P) continue; if (golfHand === hand || golfHand === 'rolling' && P.trigDown) continue; const ray = rayOf(c);
        if (UI.open) { const u = uiHit(ray);
          if (u) { c.userData.ray.scale.z = u.t; c.userData.ray.material.color.setHex(0x7dff9a); dot.position.copy(u.p); dot.visible = true; if (u.btn && !UI.hover) UI.hover = u.btn.id;
            if (P.trigDown && u.btn && u.btn.on) { pulse(P.src, 0.5, 30); S.lastPress = u.btn.id; u.btn.act(); UI.key = ''; } continue; } }
        const tg = pickTarget(ray), hit = pickCab(ray);
        if (tg && (!hit || tg.d <= hit.d)) { c.userData.ray.scale.z = tg.d; c.userData.ray.material.color.setHex(0x7dff9a); dot.position.copy(tg.p); dot.visible = true; if (!S.hover) S.hover = { target: tg.id, hand }; S.hoverTarget = tg.id;
          if (P.trigDown || (P.aDown && /^nkOrb_/.test(tg.id))) { pulse(P.src, 0.5, 30); S.lastPress = tg.id; tg.act(); } continue; }
        if (UI.open) continue;   // no floor teleports while a panel is open
        if (hit) { c.userData.ray.scale.z = hit.d; c.userData.ray.material.color.setHex(0xffe14a); if (!S.hover) S.hover = { cab: hit.cab, m: machineOf(hit.cab), hand }; dot.position.copy(hit.p); dot.visible = true;
          if (P.trigDown) { pulse(P.src, 0.6, 40); startCab(hit.cab, hit.p); } continue; }
        const gy = monkey.position.y; if (ray.direction.y < -0.05) { const t = (gy - ray.origin.y) / ray.direction.y; if (t > 0 && t < RAY_MAX) { const p = ray.at(t, _hit); c.userData.ray.scale.z = t;
          const q = new THREE.Vector3(p.x, gy, p.z); A.collide(q); const ok = Math.hypot(q.x - p.x, q.z - p.z) <= 0.35;
          if (hand === 'right' || !tpRing.visible) { tpRing.position.set(p.x, gy + 0.02, p.z); tpRing.visible = true; ringMat.color.setHex(ok ? 0x3ff3ff : 0xff3040); }
          c.userData.ray.material.color.setHex(ok ? 0x3ff3ff : 0xff3040);
          if (P.trigDown && ok) { tryTeleport(p); pulse(P.src, 0.3, 25); } } }
      }
    }
    if (UI.open) uiDraw();
    // the game screen
    if (inGame && !G.placed) placeScreen();
    scr.visible = inGame;
    const w = inGame ? gameWin() : null;
    if (inGame) {
      pump();
      if (w) { try { if (!G.rect || S.frames - G.layoutT > 30) { G.layoutT = S.frames; layout(w); } drawGame(w); } catch (e) {} }
      // power-up buttons beside the screen (only the ready ones)
      const map0 = MAPS[play.cur && play.cur.key] || MAPS.default; for (const id in pwM) { pwM[id].visible = false; pwM[id].scale.setScalar(1); }
      if (map0.pw && w) map0.pw.forEach((p, i) => { const r = pwReady(w, p), m = pwMesh(p, i); m.visible = r; if (r && !S.pwShown[p.id]) { S.pwShown[p.id] = 1; const P = R || L; if (P) pulse(P.src, 0.4, 40); } if (!r) S.pwShown[p.id] = 0; });
      scr.updateMatrixWorld(true); S.trigOnPw = false;
      for (const [hand, P] of order) { const c = ctrlFor(hand); if (!c || !P) continue; const ray = rayOf(c);
        if (map0.pw) { let hitPw = null; for (const p of map0.pw) { const m = pwM[p.id]; if (!m || !m.visible) continue; const t = rectHit(ray, m); if (t != null && (!hitPw || t < hitPw.t)) hitPw = { p, t }; }
          if (hitPw) { pwM[hitPw.p.id].scale.setScalar(1.12); c.userData.ray.scale.z = hitPw.t; c.userData.ray.material.color.setHex(0xffe14a); dot.position.copy(ray.at(hitPw.t, _hit)); dot.visible = true; if (P.trig) S.trigOnPw = true; if (P.trigDown) { pwFire(w, hitPw.p); pulse(P.src, 0.6, 50); } continue; } }
        const n = _v.set(0, 0, 1).applyQuaternion(scr.getWorldQuaternion(_q)), denom = n.dot(ray.direction); if (Math.abs(denom) < 1e-4) continue;
        const t = _hit.copy(scr.position).sub(ray.origin).dot(n) / denom; if (t <= 0 || t > RAY_MAX) continue;
        const p = ray.at(t, new THREE.Vector3()), lp = scr.worldToLocal(p.clone()), u = lp.x / G.w + 0.5, v = lp.y / G.h + 0.5;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        c.userData.ray.scale.z = t; c.userData.ray.material.color.setHex(0xff3fd2); if (!aimScreen) { aimScreen = { hand, u, v }; dot.position.copy(p); dot.visible = true; } }
      gameInput(w, aimScreen, dt);
    } else { if (Object.keys(S.held).length || G.ptrDown) releaseAll(); G.placed = false; G.rect = null; S.gripT = 0; }
    // t353u: a ray never passes through a VR button / panel / sign / screen: cut it at the nearest one it crosses
    const nPw = Object.keys(pwM).length; if (!S._surf || S._surfN !== signs.length + nPw) { S._surf = [uiM, chessM, ...signs.map(g => g.m).filter(Boolean), back, bar, ...Object.values(pwM)]; S._surfN = signs.length + nPw; } const surf = S._surf;
    for (const c of ctrls) { if (!c.userData.src) continue; const ray = rayOf(c); let t = c.userData.ray.scale.z;
      for (const m of surf) { const h = rectHit(ray, m, t); if (h != null && h < t) t = h; } c.userData.ray.scale.z = t; c.userData.rayLen = t; c.userData.rayO = ray.origin.toArray(); }
    fpRayPost();
    // HUD on the left controller (or under your view when there is none)
    const T = play.tickets ? play.tickets.total : 0, lc = ctrlFor('left') || ctrlFor('right');
    if (lc && lc.userData.src) { lc.updateMatrixWorld(true); hud.position.set(0, 0.07, 0.02).applyMatrix4(lc.matrixWorld); hud.quaternion.copy(lc.getWorldQuaternion(_q)).multiply(HUD_TILT); }
    else if (S.head) { const h = S.head; hud.position.set(h.x - Math.sin(h.yaw) * 0.7, h.y - 0.45, h.z - Math.cos(h.yaw) * 0.7); hud.rotation.set(-0.5, h.yaw, 0, 'YXZ'); }
    hud.visible = !!(S.presenting && !S.hudHidden); placeFireMenu(); if (padBoard) padBoard.visible = !!(PADINFO && S.presenting && !S.hudHidden);
    if (play.lastToast && play.lastToast !== S._toast) { S._toast = play.lastToast; S.msg = play.lastToast; S.msgT = 2.5; }
    S.msgT = Math.max(0, S.msgT - dt);
    const hv = S.hover && S.hover.m, cost = hv ? (hv.cost || 1) : 0, TG = { ward: 'TRIGGER: ACCESSORIES', tickets: 'TRIGGER: BUY TICKETS', kiosk: 'TRIGGER: BUY TICKETS', beamShop: 'TRIGGER: SHOP', beamNK: 'TRIGGER: NEON KNOCKOUT', beamArcade: 'TRIGGER: BEAM TO ARCADE', shop: 'TRIGGER: PRIZE SHOP', nb: 'TRIGGER: PLAY NEON BRICKS', nbWindow: 'TRIGGER: PLAY NEON BRICKS', chatClerk: 'TRIGGER: CHAT WITH GROK', chatVisitor: 'TRIGGER: CHAT WITH GROK', chess: 'TRIGGER: PLAY CHESS WITH GROK', golfPay: 'TRIGGER: PAY 5 TICKETS · MINI GOLF', chessTable: 'TRIGGER: PLAY CHESS WITH GROK' };
    const CTs = chessOn ? chessT() : null, chessLine = CTs ? (CTs.state === 'play' ? 'TRIGGER: MOVE A PIECE · GRIP: STAND UP' : CTs.state === 'stand' ? 'STANDING UP' : CTs.gstate === 'seated' || CTs.gstate === 'sitdown' ? 'GROK SITS DOWN · GRIP: STAND UP' : 'GROK IS COMING · A: SKIP · GRIP: STAND UP') : null;
    const GA = golfA(), golfLine = GA && GA.below && S.head ? (GA.rolling ? 'ROLLING…' : GA.aiming && GA.vr ? 'LET GO: PUTT · POWER ' + Math.round((GA.power || 0) * 100) + '% · GRIP: CANCEL' : GA.vrNear(S.head.x, S.head.z) ? 'POINT WHERE TO PUTT · HOLD TRIGGER TO AIM' : null) : null;
    const line2 = S.msgT > 0 ? S.msg : chessLine ? chessLine : golfLine ? golfLine : nbOn ? 'STICK MOVE · A ROTATE · B DROP · HOLD GRIP LEAVE' : hv ? 'TRIGGER: PLAY ' + (NAMES[hv.key] || hv.key.toUpperCase()) + ' · ' + cost + (cost === 1 ? ' TICKET' : ' TICKETS') : S.hover && S.hover.target ? TG[S.hover.target] : inGame ? 'HOLD GRIP TO LEAVE' : UI.open ? 'TRIGGER: PRESS · GRIP: BACK' : 'TRIGGER: TELEPORT / PLAY · Y: MENU';
    const fly = st.fly, jb = jetOn() && fly ? { v: fly.e, low: fly.e <= 0.18 } : null; S.hudBar = jb ? Math.round(fly.e * 100) : null;   // t358u: main.js's real jetpack energy (st.fly.e, 0..1)
    if (!!jb !== !!hud.userData.bar) { hud.userData.bar = !!jb; hud.scale.set(1, jb ? 1.3 : 1, 1); }
    batteryInit(); const bat = BAT.supported && BAT.level != null ? { pct: Math.round(BAT.level * 100), charging: BAT.charging } : null;
    padInfoUpdate(performance.now()); drawPanel(hud, [T + (T === 1 ? ' TICKET' : ' TICKETS'), line2], Object.assign({ status: hudStatus(performance.now()) }, jb ? { bar: jb } : {}, bat ? { bat } : {}));
    if (inGame) { const m = play.cur, sub = play.sub, map = MAPS[m && m.key] || MAPS.default, c = m ? (m.cost || 1) : 0;
      const top = sub === 'demo' ? (m.credits > 0 ? 'A: START  ·  CREDIT ' + m.credits : (T >= c ? 'A: INSERT ' + c + ' TICKET' + (c > 1 ? 'S' : '') : 'NEED ' + c + ' TICKETS · YOU HAVE ' + T)) : contCan(w) ? 'B/Y: CONTINUE · ' + play.continueCost + ' TICKETS' : map.help;
      drawPanel(bar, [S.msgT > 0 ? S.msg : top, T + ' TICKETS  ·  HOLD GRIP TO LEAVE'], { c0: '#ffffff', border: '#ff3fd2' }); }
  }
  // Light-set warm-up: three keys every lit program on the counts of lit lights, so the first frame a new set shows (the shop during the beam,
  // back in the arcade) would compile dozens of programs one by one. Checked right before three gathers the lights (after main.js culled the rooms):
  // a set never warmed before compiles + links everything for it in one go, also for the mirror pass.
  const LS = { list: [], t: -1e9, done: new Set() };
  function lightSig() { if (S.frames - LS.t > 120) { LS.t = S.frames; LS.list.length = 0; scene.traverse(o => { if (o.isLight && !o.isAmbientLight) LS.list.push(o); }); }
    let p = 0, sp = 0, d = 0, h = 0, ra = 0, sh = 0; for (const l of LS.list) { if (!effVis(l)) continue; if (l.isPointLight) p++; else if (l.isSpotLight) sp++; else if (l.isDirectionalLight) d++; else if (l.isHemisphereLight) h++; else if (l.isRectAreaLight) ra++; if (l.castShadow) sh++; }
    return p + 'p' + sp + 's' + d + 'd' + h + 'h' + ra + 'r' + sh + 'x'; }
  S.lightSig = () => lightSig();
  // ---------- v18 (t405u / t407u): PRE-WARM before you enter VR and before you beam ----------
  // Entering VR froze (the whole arcade compiled again for the headset in one frame) and every beam froze at the cut (the shop / studio
  // compiled for the first time, ~130-160 programs) = the Quest shows a black void. On a headset browser, in the background soon after load,
  // each area (room 1, the shop, the Neon Knockout studio) is staged as if you stood on its pad - its own room culling, the VR fill light,
  // the pinned lights - and compiled for the headset's target (three keys an XR frame like the default framebuffer: sRGB + tone mapping),
  // async (KHR_parallel_shader_compile), plus the shop mirror's own pass; then every texture is uploaded a few per frame. Each area's light set
  // is marked done, so the cut, the arrival and the session start find everything ready. Phones / computers (no immersive-vr) skip all of it.
  const PW = S.prewarm = { done: false, busy: false, areas: [], ms: 0, programs: 0, textures: 0, err: null, startedAt: 0 };
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  function stageArea(area, fn) { const T = A.tp, nkRoot = scene.getObjectByName('nkStudio'), P = area === 2 ? T.PAD2 : area === 3 ? T.PAD3 : area === 4 ? { x: 0, z: (A.Z2 || -40) + 3 } : T.PAD1;
    const pos = new THREE.Vector3(P.x, 1.6, P.z), fv = fill.visible, nkv = nkRoot ? nkRoot.visible : false, mv = monkey.visible, cp = camera.position.clone(), cq = camera.quaternion.clone();
    const fr = new THREE.Frustum(); camera.position.copy(pos); camera.updateMatrixWorld(true);
    fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const wasAdopted = PIN.lights.size;
    try { window.__cullFor(pos, fr); fill.visible = true; if (nkRoot) nkRoot.visible = area === 3; pinScan(); PIN.staging = true; golfPin(area === 2); pinLights(); return fn(); }
    finally { unpinLights(); PIN.staging = false; golfPin(!!S.presenting && golfWant()); if (!S.presenting && !wasAdopted) { unadoptAll(); PIN.seeded = false; }
      fill.visible = fv; if (nkRoot) nkRoot.visible = nkv; monkey.visible = mv; camera.position.copy(cp); camera.quaternion.copy(cq); camera.updateMatrixWorld(true);
      const f2 = new THREE.Frustum(); f2.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); window.__cullFor(S.presenting && S.head ? new THREE.Vector3(S.head.x, S.head.y, S.head.z) : camera.position.clone(), f2); } }
  // after the compile: draw the staged area once into a 2x2 corner of the default framebuffer (the headset's program variants), looking
  // four ways from the pad, so the GPU driver builds its draw state and the meshes' vertex buffers are uploaded before the first real frame.
  // Reflector passes are switched off for it (the headset doesn't draw them either); the next normal frame repaints those pixels.
  // ---------- vrtest-v9 (Dave t468u: start-screen lag, PREPARING VR ~30 s on the Quest; t469u: the first shop -> arcade beam froze) ----------
  // The v18 pre-warm compiled the WHOLE scene (every material of every room, ~150 programs) for each area's light set in one call, drew each
  // area 4-8 times in one frame and uploaded 6 textures per frame: long frames on the start screen, and the PREPARING VR card waited for all of it.
  // Now everything is sliced into small jobs run inside a per-frame time budget (start screen / flat 5 ms, under the VR card 14 ms, in VR 3 ms;
  // at least one job per frame), shaders are only issued (KHR_parallel_shader_compile links them on driver threads) and polled for readiness:
  //   gate  (the card waits only for this): the meshes you can see in the area you are in (deduped by program inputs), compiled + linked,
  //         drawn once per direction into a 2x2 corner (driver state + vertex buffers);
  //   then  the rest, in order: the shop (with the golf basement + lamps, its mirror pass), room 2, the Neon Knockout studio, every other
  //         material under each of those light sets (hidden UI / props), the textures, and a simulated arcade -> shop -> arcade round trip
  //         (the arcade drawn again from the pad after the shop: what froze on the first return).
  // A beam whose destination isn't warm yet holds at the cut (max 4 s) while that area's jobs run first with a big budget.
  const _wc = new THREE.PerspectiveCamera(100, 1, 0.05, 300), _vp = new THREE.Vector4(), _sc = new THREE.Vector4();
  const areaPos = area => { const T = A.tp; return area === 2 ? T.PAD2 : area === 3 ? T.PAD3 : area === 4 ? { x: 0, z: (A.Z2 || -40) + 3 } : T.PAD1; };
  function golfStage(area) { const G = window.__minigolf; return area === 2 && G && G.warmStage && !dbg().golfold ? G.warmStage(true, true) : null; }
  // one 2x2 draw of the staged area: dir 0-3 = level, 4-7 = from the golf stairs looking down (shop), 8-11 = the shop mirror's own pass
  // one 2x2 draw of part of the staged area: meshes list[i..i+n) only (camera + lights on a spare layer 30), level view from the pad;
  // mirror = the shop mirror's own target. Small chunks per frame keep the GPU work of a first draw (vertex buffers, driver state) small.
  function drawChunk(area, list, i, n, mirror) { if (S.presenting && !VEIL.on && !PW.holdFor) return i + n; const xe = renderer.xr.enabled; renderer.xr.enabled = false; const on = [], lit = [];
    try { stageArea(area, () => { const undoG = golfStage(area), st0 = renderer.getScissorTest(), prev = renderer.getRenderTarget(), ac = renderer.autoClear; renderer.getViewport(_vp); renderer.getScissor(_sc);
      try { for (let q = i; q < Math.min(list.length, i + n); q++) { const o = list[q]; if (!o.layers.isEnabled(30)) { o.layers.enable(30); on.push(o); } }
        scene.traverse(o => { if (o.isLight && !o.layers.isEnabled(30)) { o.layers.enable(30); lit.push(o); } });
        _wc.position.copy(camera.position); _wc.rotation.set(-0.15, 0, 0, 'YXZ'); _wc.updateMatrixWorld(true); _wc.layers.set(30);
        const fc = []; for (const o of on) if (o.frustumCulled) { o.frustumCulled = false; fc.push(o); }
        try { const tw = mirror ? MV.twin : null;
          if (tw) { const rt = tw.getRenderTarget(); renderer.setRenderTarget(rt); rt.scissor.set(0, 0, 2, 2); rt.scissorTest = true; rt.viewport.set(0, 0, 2, 2); try { renderer.render(scene, _wc); } finally { rt.scissorTest = false; rt.scissor.set(0, 0, rt.width, rt.height); rt.viewport.set(0, 0, rt.width, rt.height); } }
          else { renderer.setRenderTarget(null); renderer.autoClear = false; renderer.setViewport(0, 0, 2, 2); renderer.setScissor(0, 0, 2, 2); renderer.setScissorTest(true); renderer.render(scene, _wc); }
          PW.draws = (PW.draws || 0) + 1; } finally { for (const o of fc) o.frustumCulled = true; } }
      catch (e) { PW.err = 'draw ' + e; }
      finally { for (const o of on) o.layers.disable(30); for (const o of lit) o.layers.disable(30); renderer.setScissorTest(st0); renderer.setScissor(_sc); renderer.setViewport(_vp); renderer.setRenderTarget(prev); renderer.autoClear = ac; if (undoG) undoG(); } }); }
    finally { renderer.xr.enabled = xe; }
    return i + n; }
  const GEO = { seen: new WeakSet(), mat: null };
  function geoChunk(objs) { if (!GEO.mat) GEO.mat = new THREE.RawShaderMaterial({ vertexShader: 'attribute vec3 position; uniform mat4 modelViewMatrix, projectionMatrix; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'precision lowp float; void main() { gl_FragColor = vec4(0.0); }' });
    const xe = renderer.xr.enabled, st0 = renderer.getScissorTest(), prev = renderer.getRenderTarget(), ac = renderer.autoClear, ov = scene.overrideMaterial, shown = [], on = [], fc = [];
    renderer.xr.enabled = false; renderer.getViewport(_vp); renderer.getScissor(_sc);
    try { for (const o of objs) { let p = o; while (p) { if (!p.visible) { p.visible = true; shown.push(p); } p = p.parent; } if (!o.layers.isEnabled(30)) { o.layers.enable(30); on.push(o); } if (o.frustumCulled) { o.frustumCulled = false; fc.push(o); } }
      _wc.position.copy(camera.position); _wc.rotation.set(-0.15, 0, 0, 'YXZ'); _wc.updateMatrixWorld(true); _wc.layers.set(30); scene.overrideMaterial = GEO.mat;
      renderer.setRenderTarget(null); renderer.autoClear = false; renderer.setViewport(0, 0, 2, 2); renderer.setScissor(0, 0, 2, 2); renderer.setScissorTest(true); renderer.render(scene, _wc); }
    catch (e) { PW.err = 'geo ' + e; }
    finally { scene.overrideMaterial = ov; for (const o of shown) o.visible = false; for (const o of on) o.layers.disable(30); for (const o of fc) o.frustumCulled = true;
      renderer.setScissorTest(st0); renderer.setScissor(_sc); renderer.setViewport(_vp); renderer.setRenderTarget(prev); renderer.autoClear = ac; renderer.xr.enabled = xe; } }
  // draw a whole visible list in chunks (one chunk per frame), plus the mirror pass for the shop
  async function drawList(area, list, mirror) { for (let i = 0; i < list.length;) { i = drawChunk(area, list, i, 24, false); if (PW.prog && PW.prog.ph === 'draw') PW.prog.i = Math.min(i, list.length); await frame(); }
    if (mirror && MV.twin) { const ml = list.filter(o => !o.isReflector); for (let i = 0; i < ml.length;) { i = drawChunk(area, ml, i, 24, true); await frame(); } } }
  function drawAllNow(area) { const l = LISTS[area] || []; for (let i = 0; i < l.length;) i = drawChunk(area, l, i, 1e9, false); if (area === 2 && MV.twin) drawChunk(area, l, 0, 1e9, true); }
  // program inputs that matter for dedupe: the material(s), instancing / skinning / batching, vertex colours, morph targets
  const progKey = o => { const ms = Array.isArray(o.material) ? o.material : [o.material], g = o.geometry; return ms.map(m => m && m.uuid).join(',') + (o.isInstancedMesh ? 'I' : '') + (o.isSkinnedMesh ? 'S' : '') + (o.isBatchedMesh ? 'B' : '') + (o.isPoints ? 'P' : o.isLine ? 'L' : o.isSprite ? 'Sp' : '') + (g && g.attributes && g.attributes.color ? 'c' : '') + (g && g.morphAttributes ? Object.keys(g.morphAttributes).length : ''); };
  function meshList(area, visibleOnly, skip) { const out = [], keys = new Set(); stageArea(area, () => { const undoG = golfStage(area);
      try { const add = o => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material || o.isReflector) return; const k = progKey(o); if (keys.has(k) || (skip && skip.has(k))) return; keys.add(k); out.push(o); };
        if (visibleOnly) { scene.traverseVisible(add); for (const o of (FM.warm || [])) add(o); } else scene.traverse(add); } finally { if (undoG) undoG(); } }); return { list: out, keys }; }
  // compile meshes[i..] under the staged area's lights until the slice budget runs out (always at least one); returns the next index
  function compileSome(area, list, i, budget, mirror) { const t0 = performance.now(); let j = i; const fake = { traverse: cb => { for (let q = j0; q < j1; q++) cb(list[q]); }, traverseVisible() {} }; let j0 = i, j1 = i;
    stageArea(area, () => { const undoG = golfStage(area), prev = renderer.getRenderTarget(); LS.t = -1e9; const sig = lightSig(); LS.done.add(sig); PW.lastSig = sig;
      try { camera.updateMatrixWorld(true); renderer.setRenderTarget(null);
        while (j < list.length && (j === i || performance.now() - t0 < budget)) { j0 = j; j1 = j + 1; const ms = renderer.compile(fake, camera, scene); for (const m of ms) PW.pending.add(m);
          if (mirror && MV.twin) { const xe = renderer.xr.enabled, mv = monkey.visible; try { monkey.visible = true; renderer.xr.enabled = false; renderer.setRenderTarget(MV.twin.getRenderTarget()); renderer.compile(fake, camera, scene); } finally { renderer.xr.enabled = xe; monkey.visible = mv; renderer.setRenderTarget(null); } }
          j++; PW.jobs++; } }
      catch (e) { PW.err = 'compile ' + e; j = Math.max(j, i + 1); }
      finally { renderer.setRenderTarget(prev); if (undoG) undoG(); } });
    return j; }
  // poll KHR_parallel_shader_compile completion (three's isReady) without blocking; true when everything issued so far is linked
  function ready(budget) { const t0 = performance.now(); for (const m of PW.pending) { if (performance.now() - t0 > budget) return false; let r = true; try { const p = renderer.properties.get(m).currentProgram; r = !p || p.isReady() !== false; } catch (e) {} if (r) PW.pending.delete(m); } return PW.pending.size === 0; }   // v10: a null status (deleted / errored program) never turns true: count it as done
  const budget = () => PW.holdFor ? 20 : S.presenting ? (VEIL.on ? 14 : 4) : 5;
  // v10: ?warmlog=1 prints each pre-warm step to the console and shows the current step + timings on the PREPARING VR card (S.warmLog() returns the log)
  PW.log = []; function logW(m) { const t = Math.round(performance.now() - (PW.startedAt || 0)); PW.log.push(t + 'ms ' + m); if (PW.log.length > 80) PW.log.shift(); if (dbg().warmlog) console.log('[warm] ' + t + 'ms ' + m); }
  S.warmLog = () => PW.log.slice();
  PW.slices = []; let _sl = 0;   // the longest pre-warm slices (ms, job) for the tests
  function frame() { const n = performance.now(); if (_sl) { const d = n - _sl, c = PW.cur ? PW.cur.area + ':' + PW.cur.kind : '?'; if (PW.slices.length < 8 || d > PW.slices[PW.slices.length - 1][0]) { PW.slices.push([Math.round(d), c]); PW.slices.sort((a, b) => b[0] - a[0]); PW.slices.length = Math.min(8, PW.slices.length); } }
    return new Promise(r => { const go = () => { _sl = performance.now(); r(); }; if (S.presenting && session) session.requestAnimationFrame(go); else requestAnimationFrame(go); }); }
  // the job list: [name, area, kind, ...]
  function buildJobs(first) { const J = []; const areas = [first, ...[1, 2, 4, 3].filter(a => a !== first)];
    for (const a of areas) J.push({ area: a, kind: 'vis', gate: a === first });
    J.push({ area: first, kind: 'rest' }); for (const a of areas) if (a !== first && a !== 4) J.push({ area: a, kind: 'rest' });
    J.push({ kind: 'icons' }, { kind: 'tex' }, { kind: 'geo' }, { kind: 'trip' }); return J; }
  async function runJob(job) { const a = job.area, t0 = performance.now(), p0 = renderer.info.programs ? renderer.info.programs.length : 0;
    if (a === 2) { const q = performance.now(); try { if (A.loadShop) await A.loadShop(); } catch (e) {} try { mirrorTwin(); } catch (e) {} PW.loadShopMs = Math.round(performance.now() - q); _sl = performance.now(); }
    if (a === 3) { const q = performance.now(); try { if (window.__loadNK) await window.__loadNK(); } catch (e) {} PW.loadNKMs = Math.round(performance.now() - q); _sl = performance.now(); if (!scene.getObjectByName('nkStudio')) return; }
    if (job.kind === 'vis' || job.kind === 'rest') {
      const { list, keys } = meshList(a, job.kind === 'vis', job.kind === 'rest' ? PW.seenKeys[a] : null); if (job.kind === 'vis') PW.seenKeys[a] = keys;
      let i = 0; PW.prog = { a, kind: job.kind, ph: 'compile', i: 0, n: list.length }; logW('start ' + a + ':' + job.kind + ' meshes ' + list.length);
      while (i < list.length) { i = compileSome(a, list, i, budget(), a === 2 && job.kind === 'vis'); PW.prog.i = i; await frame(); }
      // v10 (Dave t475u: the card sat at 60% on the Quest): wait for the driver's parallel link, but never forever. After LINK_CAP (3 s under the card,
      // 8 s otherwise) the rest are linked ONE PER FRAME (a synchronous getUniforms), so the card keeps drawing and its number keeps moving.
      { const tR = performance.now(), n0 = PW.pending.size; PW.prog = { a, kind: job.kind, ph: 'link', i: 0, n: n0 };
        while (!ready(budget())) { PW.prog.i = n0 - PW.pending.size; if (performance.now() - tR > (VEIL.on ? 3000 : 8000)) break; await frame(); }
        if (PW.pending.size) { const left = [...PW.pending]; PW.linkCapped = (PW.linkCapped || 0) + left.length; logW('link cap: ' + left.length + ' of ' + n0 + ' not reported ready after ' + Math.round(performance.now() - tR) + ' ms; linking one per frame');
          PW.prog = { a, kind: job.kind, ph: 'link1', i: 0, n: left.length };
          let tF = performance.now(); for (const m of left) { const t1 = performance.now(); try { const p = renderer.properties.get(m).currentProgram; if (p) p.getUniforms(); } catch (e) {} PW.pending.delete(m); PW.prog.i++; const d = performance.now() - t1; if (d > (PW.link1Max || 0)) PW.link1Max = Math.round(d); if (performance.now() - tF > 6) { await frame(); tF = performance.now(); } } }   // shared programs are already linked: several per frame while under 6 ms, a slow real link gets a frame to itself
        logW('linked ' + a + ':' + job.kind + ' ' + n0 + ' in ' + Math.round(performance.now() - tR) + ' ms'); }
      if (job.kind === 'vis') { LISTS[a] = list; PW.prog = { a, kind: job.kind, ph: 'draw', i: 0, n: list.length }; if (S.presenting && !VEIL.on) PW.needDraw.add(a); else await drawList(a, list, a === 2); logW('drawn ' + a + ' at ' + Math.round(performance.now() - PW.startedAt) + ' ms'); }   // in VR (card gone) the one draw waits for the beam's cut
      PW.areas.push({ area: a === 4 ? 'room2' : a, kind: job.kind, sig: PW.lastSig, meshes: list.length, programs: (renderer.info.programs ? renderer.info.programs.length : 0) - p0, ms: Math.round(performance.now() - t0) });
      if (job.kind === 'vis') PW.warm.add(a); }
    else if (job.kind === 'icons') {   // vrtest-v15 (t491u): slice the prize/accessory atlas under the card / start screen, never at a beam
      if (dbg().noatlas) { PW.icons = { n: 0, ms: 0, left: 0, skipped: 1 }; return; }
      const sh = window.__shop || A.shop; try { if (sh && sh.queueIcons) sh.queueIcons(); } catch (e) {}
      let t = performance.now(); const n0 = sh && sh.iconsPending ? sh.iconsPending() : 0; PW.prog = { a: 2, kind: 'icons', ph: 'bake', i: 0, n: n0 };
      while (sh && sh.iconsPending && sh.iconsPending()) {
        if (S.presenting && !VEIL.on) break;   // card already down: don't hitch live VR; leftovers wait for the start screen / a later veil
        const ib = Math.max(40, budget());
        if (!(sh.bakeIcons(ib).did) && sh.iconsPending()) { await frame(); t = performance.now(); continue; }
        PW.prog.i = n0 - sh.iconsPending(); if (performance.now() - t > budget()) { await frame(); t = performance.now(); } }
      PW.icons = { n: n0, ms: Math.round(performance.now() - t0), left: sh && sh.iconsPending ? sh.iconsPending() : 0 }; }
    else if (job.kind === 'tex') { const seen = new Set(); scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null; if (!ms) return;
        for (const m of ms) for (const k of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'lightMap', 'envMap', 'bumpMap']) { const x = m[k]; if (x && x.isTexture && !x.isRenderTargetTexture && !x.isVideoTexture && x.image) seen.add(x); }
        if (o.material && o.material.uniforms) for (const u of Object.values(o.material.uniforms)) { const x = u && u.value; if (x && x.isTexture && !x.isRenderTargetTexture && !x.isVideoTexture && x.image) seen.add(x); } });
      let t = performance.now(); for (const x of seen) { const props = renderer.properties.get(x); if (props && props.__webglTexture && props.__version === x.version) continue; try { renderer.initTexture(x); PW.textures++; } catch (e) {} if (performance.now() - t > budget()) { await frame(); t = performance.now(); } } }
    else if (job.kind === 'geo') { if (S.presenting && !VEIL.on) return;   // vrtest-v10 (Chief v256 45ecbdf, sliced): upload the geometry of everything still hidden
      // (golf basement, Grok visitor, ticket FX, ...) so it isn't first uploaded mid-session. One raw override program (no lights in its key), 48 meshes a
      // frame into a 2x2 scissor; Chief's version unhid the whole scene for one full render, which would add light sets and a long frame here.
      const list = []; scene.traverse(o => { if (!(o.isMesh || o.isPoints || o.isLine) || !o.geometry || o.isReflector || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
        let p = o, hid = false; while (p) { if (!p.visible) { hid = true; break; } p = p.parent; } if (hid && !GEO.seen.has(o.geometry)) { GEO.seen.add(o.geometry); list.push(o); } });
      const g0 = renderer.info.memory.geometries; let t = performance.now();
      for (let i = 0; i < list.length; i += 48) { geoChunk(list.slice(i, i + 48)); if (performance.now() - t > budget()) { await frame(); t = performance.now(); } }
      PW.geo = { meshes: list.length, uploaded: renderer.info.memory.geometries - g0, ms: Math.round(performance.now() - t0) }; }
    else if (job.kind === 'trip') { if (S.presenting && !VEIL.on) return;   // arcade -> shop -> arcade, one direction per frame (the first return froze on the Quest)
      for (const ar of [1, 2, 1]) await drawList(ar, LISTS[ar] || [], false); PW.trip = true; } }
  const LISTS = {}; PW.warm = new Set(); PW.pending = new Set(); PW.seenKeys = {}; PW.jobs = 0; PW.holdFor = 0;
  PW.needDraw = new Set();
  S.areaWarm = a => (PW.done || PW.warm.has(a)) && !PW.needDraw.has(a);
  // a beam whose destination area isn't warm yet holds at the cut (max 4 s) while that area's jobs run first with a 16 ms budget
  { const hold = { t: 0 }; const T = () => A.tp; const hook = () => { const tp = T(); if (!tp || tp.holdCut) return !!tp; tp.holdCut = dd => { const a = dd === 'shop' ? 2 : dd === 'nk' ? 3 : 1;
      if (S.presenting && PW.needDraw.has(a) && PW.warm.has(a)) { PW.needDraw.delete(a); PW.holdFor = a; drawAllNow(a); PW.holdFor = 0; PW.cutDraws = (PW.cutDraws || 0) + 1; return true; }   // compiled in VR, drawn once now at the cut
      if (!S.presenting || S.areaWarm(a) || !PW.busy) { PW.holdFor = 0; hold.t = 0; return false; }
      if (!hold.t) { hold.t = performance.now(); PW.holds = (PW.holds || 0) + 1; } if (performance.now() - hold.t > 8000) { PW.holdFor = 0; hold.t = 0; return false; }
      PW.holdFor = a; return true; }; return true; };
    const iv = setInterval(() => { if (hook()) clearInterval(iv); }, 500); }
  async function prewarm() { if (PW.busy || PW.done || !A.tp || !window.__cullFor) return; if (dbg().nowarm) { PW.done = true; PW.ms = 0; return; } PW.busy = true; PW.startedAt = performance.now(); const t0 = performance.now();
    try { const first = A.tp.where || 1; PW.queue = buildJobs(first);
      while (PW.queue.length) {
        const tp = A.tp, beaming = !!(tp && tp.state !== 'idle');
        // v17 (t494u): during a beam, only the destination's jobs may run (shop pad pre-warms shop, NK pad pre-warms NK)
        if (beaming && S.presenting) { const a = tp.dest === 'shop' ? 2 : tp.dest === 'nk' ? 3 : 1;
          const h = PW.queue.findIndex(j => j.area === a);
          if (h < 0) { await frame(); continue; }
          const job = PW.queue.splice(h, 1)[0]; PW.cur = job; await runJob(job); if (job.gate) PW.gateMs = Math.round(performance.now() - t0); continue; }
        let k = 0; if (PW.holdFor) { const h = PW.queue.findIndex(j => j.kind === 'vis' && j.area === PW.holdFor); if (h >= 0) k = h; }
        const job = PW.queue.splice(k, 1)[0]; PW.cur = job; await runJob(job); if (job.gate) PW.gateMs = Math.round(performance.now() - t0); }
      PW.programs = renderer.info.programs ? renderer.info.programs.length : 0; PW.done = true; }
    catch (e) { PW.err = String(e && e.stack || e).slice(0, 300); }
    PW.busy = false; PW.cur = null; PW.ms = Math.round(performance.now() - t0); }
  S.prewarmRun = prewarm;
  { const kick = setInterval(() => { if (PW.done || PW.busy) { if (PW.done) clearInterval(kick); return; } if (window.__noPrewarm) return; const ST = window.__arcade && window.__arcade.stats; if (S.supported && ST && ST.frames > 5 && A.tp) prewarm(); }, 500); }
  function prerender() { pinScan(); if (!PIN.golf && window.__minigolf && window.__minigolf.lampsOff && !dbg().golfold) window.__minigolf.lampsOff();   // v9: beam-cut frames (monkey at the shop pad, arcade still drawn) counted the lamps = an unwarmed 28-light set
    pinLights(); if (S.frames > 1 && !S.warmReq) { const sig = lightSig(); if (!LS.done.has(sig)) { LS.done.add(sig); warmXR('lights ' + sig); } } }
  { const b0 = scene.onBeforeRender, a0 = scene.onAfterRender;   // pin right before three gathers the lights, unpin right after the frame's render
    scene.onBeforeRender = function () { if (b0) b0.apply(this, arguments); if (renderer.xr.isPresenting && !S.inMirror) { if (VEIL.on) veilHide(); else prerender(); } };
    scene.onAfterRender = function () { if (a0) a0.apply(this, arguments); if (VEIL.hidden.length) veilShow(); if (renderer.xr.isPresenting && !S.inMirror) unpinLights(); }; }
  function contCan(w) { try { const C = w && w.__gaContinue, m = play.cur; return !!(play.sub === 'play' && m && m.cont && C && C.can && C.can()); } catch (e) { return false; } }

  function gameInput(w, aim, dt) {
    const L = IN.left, R = IN.right, m = play.cur, map = MAPS[m && m.key] || MAPS.default;
    // HOLD GRIP (either hand) = leave the machine
    const grip = (L && L.grip) || (R && R.grip); S.gripT = grip ? (S.gripT || 0) + dt : 0;
    if (S.gripT >= GRIP_EXIT_S) { S.gripT = 0; releaseAll(); pulse((L && L.grip ? L : R).src, 0.8, 60); play.exit('vr'); S.exits++; S.backs.game++; return; }
    if (!w || play.mode !== 'game') return;
    const any = k => !!((L && L[k]) || (R && R[k])), anyAB = map.handAB === 'right' ? (k => !!(R && R[k])) : any;
    if (play.sub === 'demo') {   // attract screen: A / X / trigger = insert the ticket price, then start
      if (any('aDown') || any('trigDown')) { const before = m.credits; if (m.credits < 1) play.insertTicket(); else play.tryPlay(); if (m.credits !== before || play.sub === 'play') pulse(((R && (R.aDown || R.trigDown)) ? R : L).src, 0.5, 40); }
      if (Object.keys(S.held).length) releaseAll(); S.aLatch = true; return; }
    if (play.sub !== 'play') return;
    // v24 (Dave t435u, A did not slow Strike's enemies): the A press that STARTS a game used to stay held into play, so Strike got a C keydown at
    // the very start and burned its one HYPER SPEED (8 s, then a 60 s recharge) during the stage intro; every A after that hit the recharge.
    // A now has to be let go after the start before it counts in the game.
    if (S.aLatch && !any('a')) S.aLatch = false;
    // sticks -> arrow keys (whichever stick is pushed further)
    const sx = map.moveStick === 'left' ? (L || { x: 0, y: 0 }) : [L, R].reduce((a, P) => P && Math.hypot(P.x, P.y) > Math.hypot(a.x, a.y) ? P : a, { x: 0, y: 0 });
    if (map.pan) camPan(w, map, R, dt);
    const th = (code, v) => S.held[code] ? v > 0.3 : v > 0.55;
    hold('ArrowLeft', th('ArrowLeft', -sx.x), w); hold('ArrowRight', th('ArrowRight', sx.x), w); hold('ArrowUp', th('ArrowUp', -sx.y), w); hold('ArrowDown', th('ArrowDown', sx.y), w);
    // B / Y: CONTINUE when the game offers it, otherwise the game's secondary button
    const canC = contCan(w);
    if (canC && any('bDown')) play.tryContinue();
    for (const k of map.b) hold(k, !canC && (anyAB('b') || (map.trig === 'b' && any('trig'))), w);
    if (map.pw) pwInput(w, map, L, R, dt);
    // trigger: tap the screen where you point (pointer games) or the primary button
    let trigAsA = map.trig === 'a';
    if (map.trig === 'ptr') { const tr = (R && R.trig) || (L && L.trig);
      if (aim && tr) { if (!G.ptrDown) { sendPtr(w, 'pointerdown', aim.u, aim.v); G.ptrDown = true; } else sendPtr(w, 'pointermove', aim.u, aim.v); }
      else if (G.ptrDown) { sendPtr(w, 'pointerup', aim ? aim.u : G.pu, aim ? aim.v : G.pv); G.ptrDown = false; }
      if (!aim) trigAsA = true; }
    const prim = (!S.aLatch && anyAB('a')) || (trigAsA && !S.trigOnPw && any('trig'));
    for (const k of map.a) hold(k, prim, w);
    if (map.btnAt) { const tD = (R && R.trigDown) || (L && L.trigDown), tr = (R && R.trig) || (L && L.trig);
      if (tD && aim && G.rect && typeof w[map.btnAt] === 'function') { const x = G.rect.left + aim.u * G.rect.width, y = G.rect.top + (1 - aim.v) * G.rect.height; let id = null; try { id = w[map.btnAt](x, y); } catch (e) {}
        if (id) { sendPtr(w, 'pointerdown', aim.u, aim.v); sendPtr(w, 'pointerup', aim.u, aim.v); S.trigOnBtn = true; S.btnTaps = S.btnTaps || {}; S.btnTaps[id] = (S.btnTaps[id] || 0) + 1; pulse(((R && R.trigDown) ? R : L).src, 0.6, 40); } }
      if (!tr) S.trigOnBtn = false; }
    if (map.trig === 'keys') for (const k of map.trigKeys) hold(k, !S.trigOnPw && !S.trigOnBtn && any('trig'), w);   // t358u: the trigger has its own key (Berserker attack)
  }
  // ---- right stick = camera pan through the game's own drag-look (Sky Tower: lookDrag(dx, dy) in drag pixels, 0.0055 rad per px) ----
  function camPan(w, map, R, dt) { const api = w && w[map.pan]; if (!api || typeof api.lookDrag !== 'function' || !R) return;
    const f = v => { const a = Math.abs(v); return a < 0.15 ? 0 : Math.sign(v) * ((a - 0.15) / 0.85); }, px = 2.0 * dt / 0.0055;   // full push = 2 rad/s
    const dx = f(R.x) * px, dy = f(R.y) * px * 0.6; if (dx || dy) { try { api.lookDrag(dx, dy); S.pans = (S.pans || 0) + 1; } catch (e) {} } }
  // ---- power-ups: ready = the game's own button is showing; fire = tap its key for a few frames ----
  const pwRel = {};
  function pwReady(w, p) { if (p.always) return !!w; try { const e = w.document.getElementById(p.el); return !!(e && e.style.display === 'flex'); } catch (e) { return false; } }
  function pwFire(w, p) { if (!w || !pwReady(w, p)) return false; hold(p.code, true, w); pwRel[p.code] = 0.15; S.pwFired[p.id] = (S.pwFired[p.id] || 0) + 1; S.lastPw = p.id; return true; }
  function pwInput(w, map, L, R, dt) {
    for (const c in pwRel) { pwRel[c] -= dt; if (pwRel[c] <= 0) { delete pwRel[c]; hold(c, false, w); } }
    // t358u: B (right) / X / Y (left) fire their power-up when it is ready; A is DASH (held through map.a, like the game's own key)
    for (const p of map.pw) { const P = p.btn === 'B' ? R : L, go = (p.btn === 'B' && R && R.bDown) || (p.btn === 'X' && L && L.aDown) || (p.btn === 'Y' && L && L.bDown); if (go && pwFire(w, p)) pulse(P.src, 0.6, 50); } }
  S.pw = { fire: id => { const m = MAPS[play.cur && play.cur.key] || {}, p = (m.pw || []).find(q => q.id === id); return p ? pwFire(gameWin(), p) : false; }, ready: () => { const m = MAPS[play.cur && play.cur.key] || {}, w = gameWin(); return (m.pw || []).filter(p => w && pwReady(w, p)).map(p => p.id); },
    world: id => { const m = pwM[id]; if (!m || !m.visible) return null; m.updateMatrixWorld(true); return m.getWorldPosition(new THREE.Vector3()).toArray(); } };
  S.gameScreenWorld = (x, y) => { if (!G.rect) return null; const u = (x - G.rect.left) / G.rect.width, v = 1 - (y - G.rect.top) / G.rect.height; scr.updateMatrixWorld(true); return scr.localToWorld(new THREE.Vector3((u - 0.5) * G.w, (v - 0.5) * G.h, 0)).toArray(); };   // v21 tests: a game-page point on the in-world screen
  S.sendKey = (code, type) => { const w = gameWin(); if (w) sendKey(w, type, code); };
  S.state = () => ({ presenting: S.presenting, rig: { ...S.rig }, head: S.head && { ...S.head }, mode: play.mode, sub: play.sub, cur: play.cur && play.cur.key, screen: scr.visible, held: Object.keys(S.held), keysSent: S.keysSent, ptrSent: S.ptrSent, texUploads: S.texUploads, launches: S.launches, exits: S.exits, teleports: S.teleports, snaps: S.snaps, turnRate: S.turnRate, turnSum: S.turnSum, turnTime: S.turnTime, turnMaxStep: S.turnMaxStep, panel: UI.open, beams: S.beams, tpWhere: A.tp && A.tp.where, tpState: A.tp && A.tp.state, nb: !!(A.nb && A.nb.playing), pumps: S.pumps, hover: S.hover && S.hover.m && S.hover.m.key, monkey: [monkey.position.x, monkey.position.y, monkey.position.z], comp: [comp.width, comp.height], err: S.lastError || null });
  return { pre, post, S, rtCheck };
}
