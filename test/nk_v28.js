// vrtest-v28 / v31 (Dave t519u/t520u, real Quest): "No gun or controller on the right and the fire is still coming from the player's feet".
// Root cause: in the ARCADE the equipped laser pistol is fitted to the controller with pg.matrixAutoUpdate = false (vr.js gunFit). NK cloned
// that pistol (player.js previewItem -> clone(true)), the clone inherited matrixAutoUpdate = false + the frozen matrix, so NK's position /
// quaternion writes were ignored: the blaster sat at the studio origin = the player's feet, and every bolt left its muzzle there.
// This test reproduces Dave's real flow: pistol EQUIPPED and held in the arcade first (gunFit runs), controllers in SWAPPED order
// (right = index 0), beam to Neon Knockout with the pad route, SHOOT, then a controller reconnect inside NK. Checks the whole ancestor chain is
// visible, the gun really renders (onBeforeRender), the gun / muzzle / every bolt / the beam are at hand height and never at the feet.
const { openVR, H, IWER_SRC, SETUP } = require('./vrlib');
const SWAP = `;(function(){ const P = window.XRSession && window.XRSession.prototype; if (!P) return; const o = P.addEventListener;
  P.addEventListener = function (t, f, ...r) { if (t === 'inputsourceschange' && typeof f === 'function') { const g = f; f = function (e) { return g.call(this, { added: [...(e.added || [])].reverse(), removed: [...(e.removed || [])], session: e.session }); }; } return o.call(this, t, f, ...r); }; })();`;
(async () => {
  let ok = true; const chk = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 420) : '')); if (!c) ok = false; };
  const R = await openVR({ w: 480, h: 270, init: { content: IWER_SRC + SETUP + SWAP } }); const page = R.page;
  const E = (f, a) => page.evaluate(f, a), until = (f, t = 30000) => page.waitForFunction(f, null, { timeout: t }), sleep = ms => new Promise(r => setTimeout(r, ms));
  const place = async (x, z, yaw = 0) => { await E(([x, z, yaw]) => { const S = window.__gaVR; S.rig = { x, y: 0, z, yaw }; S.applyRig(); window.__arcade.monkey.position.set(x, 0, z); }, [x, z, yaw]); await H.frames(page, 6); };
  const hold = async (pos, pitch, yaw) => { await E(([pos, pitch, yaw]) => { const T = window.__arcade.THREE, q = new T.Quaternion().setFromEuler(new T.Euler(pitch, yaw, 0, 'YXZ')), c = window.__xrd.controllers.right; c.position.set(...pos); c.quaternion.set(q.x, q.y, q.z, q.w); }, [pos, pitch, yaw]); await H.frames(page, 4); };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
  // distance of a bolt's CURRENT position from the line muzzle + t * dir (it flew straight out of the muzzle)
  const offLine = (p, o, d) => { const n = nrm(d), v = p.map((x, i) => x - o[i]), t = dot(v, n); return Math.hypot(...v.map((x, i) => x - t * n[i])); };
  const gun = () => E(() => { const A = window.__arcade, T = A.THREE, G = window.__nkGame, S = window.__gaVR, sc = A.scene, f = v => v.toArray().map(x => +x.toFixed(3)), b = G.blaster;
    const cs = [0, 1].map(i => sc.getObjectByName('vrController' + i)), gi = cs.findIndex(c => c && c.userData.hand === 'right' && c.userData.src), grip = sc.getObjectByName('vrGrip' + gi);
    const chain = []; let p = b, top = null; while (p) { chain.push({ n: p.name || p.type, v: p.visible }); top = p; p = p.parent; }
    const mz = G.blasterMuzzle(new T.Vector3()), br = G.blasterBarrel(new T.Vector3()), q = new T.Quaternion(); cs[gi].getWorldQuaternion(q);
    return { hands: cs.map(c => c && c.userData.hand), rightIdx: gi, chain, allVis: chain.every(c => c.v), inScene: top === sc, mau: b ? b.matrixAutoUpdate : null, gun: b && f(b.getWorldPosition(new T.Vector3())), grip: f(new T.Vector3().setFromMatrixPosition(grip.matrixWorld)),
      feet: [S.rig.x, 0, S.rig.z].map(v => +v.toFixed(3)), muzzle: mz && f(mz), barrel: br && f(br), ray: f(new T.Vector3(0, 0, -1).applyQuaternion(q)), renders: G.__blRenders || 0, glove: G.gloves.R.visible }; });
  const renderHook = () => E(() => { const G = window.__nkGame; let m = null; G.blaster.traverse(o => { if (!m && o.isMesh) m = o; }); if (m && !m.__hk) { m.__hk = 1; const f0 = m.onBeforeRender; m.onBeforeRender = function () { G.__blRenders = (G.__blRenders || 0) + 1; return f0.apply(this, arguments); }; } return !!m; });
  const check = async (tag) => { await renderHook(); const r0 = (await gun()).renders; await H.frames(page, 6); const g = await gun();
    chk(g.rightIdx >= 0 && g.allVis && g.inScene && !g.glove, `${tag}: gun + every ancestor up to the scene visible, right glove hidden`, { hands: g.hands, chain: g.chain });
    chk(g.renders > r0, `${tag}: the gun is actually drawn (onBeforeRender ${r0} -> ${g.renders})`);
    chk(g.gun[1] > 1.05 && g.gun[1] < 1.5 && dist(g.gun, g.grip) < 0.15 && dist(g.gun, g.feet) > 0.9, `${tag}: gun in the right hand (y ${g.gun[1]}, ${dist(g.gun, g.grip).toFixed(3)} m from the grip), not at the feet`, { gun: g.gun, grip: g.grip, feet: g.feet });
    chk(g.muzzle[1] > 1.0 && dist(g.muzzle, g.feet) > 0.9 && dot(g.barrel, g.ray) > 0.999, `${tag}: muzzle at hand height, barrel along the pointing ray`, { muzzle: g.muzzle, dot: +dot(g.barrel, g.ray).toFixed(5) }); return g; };
  const flight = () => E(() => new Promise(res => { const Ls = window.__roomFire.lasers.filter(L => L.__seen !== 1); const p0 = Ls.map(L => L.mesh.position.clone()); requestAnimationFrame(() => setTimeout(() => {
    res(Ls.map((L, i) => { L.__seen = 1; const m = L.mesh.position.clone().sub(p0[i]); return { o: L.o.slice(), d: L.dir.toArray(), wp: L.mesh.getWorldPosition(new window.__arcade.THREE.Vector3()).toArray(), moved: m.length() > 1e-4 ? m.normalize().toArray() : null }; })); }, 60)); }));
  try {
    await E(() => { localStorage.removeItem('galacticarcade.nkMode'); localStorage.removeItem('galacticarcade.vrFireType'); window.__tpTimeScale = 3; });
    await until(() => document.getElementById('vrBtn').classList.contains('on'), 20000); await until(() => window.__gaVR.prewarm.done, 180000);
    await E(() => { window.__arcade.play.addTickets(60); const gp = window.__gaPlayer; gp.tryOn('hand', 'pistol'); gp.buy(); gp.pick('hand', 'pistol'); });   // Dave has the laser pistol
    await page.click('#vrBtn'); await until(() => window.__gaVR.presenting && window.__gaVR.posed); await H.frames(page, 8);
    const hs = await E(() => [0, 1].map(i => window.__arcade.scene.getObjectByName('vrController' + i).userData.hand));
    chk(hs[0] === 'right' && hs[1] === 'left', 'controllers connected in SWAPPED order (right = index 0, as a real Quest can)', hs);
    // in the arcade: hold the pistol out so the arcade fits it to the controller (the state Dave is in before he beams)
    await hold([0.2, 1.25, -0.3], 0, 0); await H.frames(page, 10);
    const fit = await E(() => { const pg = window.__arcade.monkey.getObjectByName('gaPistol'); return { vis: !!(pg && pg.visible), fit: !!(pg && pg.userData.vrFit), mau: pg ? pg.matrixAutoUpdate : null, fp: window.__gaVR.fpGun().on }; });
    chk(fit.vis && fit.fit && fit.mau === false && fit.fp, 'arcade: the pistol is in the right hand (gunFit: matrixAutoUpdate false), first-person gun on', fit);
    // beam to Neon Knockout with the pad route
    const pad4 = await E(() => [window.__tp.PAD4.x, window.__tp.PAD4.z]); await place(pad4[0] + 2.2, pad4[1] - 2.2, 3 * Math.PI / 4);
    await H.aim(page, 'right', [0.2, 1.3, -0.2], await E(() => window.__gaVR.signs().find(q => q.id === 'beamNK').at)); await H.frames(page, 3); await H.press(page, 'right', 'trigger'); await H.frames(page, 3);
    await until(() => window.__tp.where === 3 && window.__tp.state === 'idle' && window.__nkGame && window.__nkGame.inStudio, 90000); await H.frames(page, 10);
    const C0 = await E(() => { const v = window.__nkGame.mark.getWorldPosition(new window.__arcade.THREE.Vector3()); return [v.x, v.z]; }); await place(C0[0], C0[1], 0);
    // SHOOT via the MODE orb (as Dave does), then on the title screen the gun is already in the hand
    await H.aim(page, 'right', [0.2, 1.3, -0.2], await E(() => window.__nkGame.orbWorld('mode').toArray())); await H.frames(page, 3); await H.press(page, 'right', 'trigger'); await H.frames(page, 6);
    chk((await E(() => window.__nkGame.mode)) === 'shoot', 'MODE orb -> SHOOT');
    await hold([0.2, 1.25, -0.3], 0, 0); await check('NK title (SHOOT)');
    await E(() => window.__nkGame.startRound({ diff: 'normal' })); await H.frames(page, 6);
    for (const [pos, pitch, yaw, nm] of [[[0.2, 1.25, -0.3], 0, 0, 'round, level'], [[0.25, 1.2, -0.25], -0.35, 0.3, 'round, down-right'], [[0.15, 1.35, -0.35], 0.3, -0.4, 'round, up-left']]) { await hold(pos, pitch, yaw); await check(nm); }
    // all five fire types from the muzzle, at hand height, along the barrel
    await hold([0.2, 1.25, -0.3], -0.1, 0.15); const tol = 0.06;
    const fire = async (type, how) => { await E(t => window.__gaVR.setFireType(t), type); await H.frames(page, 3); const g = await gun(); await E(() => { for (const L of window.__roomFire.lasers) L.__seen = 1; });
      if (how === 'tap') { await H.btn(page, 'right', 'trigger', 1); await H.frames(page, 2); } else if (how === 'hold') { await H.btn(page, 'right', 'trigger', 1); await H.frames(page, 12); }
      else { await H.btn(page, 'right', 'trigger', 1); await sleep(1200); await H.frames(page, 2); await H.btn(page, 'right', 'trigger', 0); await H.frames(page, 1); }
      const fl = type === 'beam' ? null : await flight(); let beam = null;
      if (type === 'beam') beam = await E(() => { const T = window.__arcade.THREE, b = window.__arcade.scene.getObjectByName('vrLaserBeam'); b.updateMatrixWorld(true); return { vis: b.visible, o: b.getWorldPosition(new T.Vector3()).toArray(), d: new T.Vector3(0, 0, 1).transformDirection(b.matrixWorld).toArray() }; });
      const sight = await E(() => { const sc = window.__arcade.scene, c = [0, 1].map(i => sc.getObjectByName('vrController' + i)).find(c => c.userData.hand === 'right'); const r = c.userData.ray; return { vis: r.visible, o: r.getWorldPosition(new window.__arcade.THREE.Vector3()).toArray() }; });
      await H.btn(page, 'right', 'trigger', 0); await H.frames(page, 4); return { g, fl, beam, sight }; };
    for (const [type, how] of [['classic', 'tap'], ['pulse', 'hold'], ['charge', 'charge'], ['scatter', 'tap']]) {
      const { g, fl } = await fire(type, how); const centre = fl.map(b => dot(nrm(b.d), g.barrel)).sort((a, b) => b - a)[0];
      const okAll = fl.length >= 1 && fl.every(b => dist(b.o, g.muzzle) < tol && b.o[1] > 1.0 && offLine(b.wp, g.muzzle, b.d) < 0.03 && dist(b.o, g.feet) > 0.9 && b.moved && dot(b.moved, nrm(b.d)) > 0.999) && centre > 0.99;
      chk(okAll, `${type.toUpperCase()}: ${fl.length} bolt(s) leave the muzzle at hand height (not the feet) and fly straight along the barrel`, { o: fl[0] && fl[0].o.map(v => +v.toFixed(3)), muzzle: g.muzzle, feet: g.feet, centreDot: +(centre || 0).toFixed(5), bolts: fl.map(b => ({ d0: +dist(b.o, g.muzzle).toFixed(3), line: +offLine(b.wp, g.muzzle, b.d).toFixed(4), mv: b.moved && +dot(b.moved, nrm(b.d)).toFixed(4) })) }); }
    { const { g, beam, sight } = await fire('beam', 'hold');
      chk(beam.vis && dist(beam.o, g.muzzle) < tol && beam.o[1] > 1.0 && dot(beam.d, g.barrel) > 0.99, 'CONTINUOUS: the beam starts at the muzzle at hand height, along the barrel', { o: beam.o.map(v => +v.toFixed(3)), dot: +dot(beam.d, g.barrel).toFixed(5) });
      chk(sight.vis === false || dist(sight.o, g.muzzle) < 0.02, 'aiming line (when shown) starts at the muzzle', sight); }
    { await E(() => window.__gaVR.setFireType('classic')); await H.frames(page, 3); const s = await E(() => { const sc = window.__arcade.scene, c = [0, 1].map(i => sc.getObjectByName('vrController' + i)).find(c => c.userData.hand === 'right'); const r = c.userData.ray; return { vis: r.visible, o: r.getWorldPosition(new window.__arcade.THREE.Vector3()).toArray() }; }); const g = await gun();
      chk(s.vis && dist(s.o, g.muzzle) < 0.02, 'aiming line shown in the round and starts at the muzzle', { sight: s.o.map(v => +v.toFixed(3)), muzzle: g.muzzle }); }
    // controllers drop + reconnect inside NK (Quest sleeps / re-detects them): the gun follows the right hand again
    await E(() => { window.__xrd.controllers.right.connected = false; window.__xrd.controllers.left.connected = false; }); await H.frames(page, 6);
    await E(() => { window.__xrd.controllers.left.connected = true; }); await H.frames(page, 4); await E(() => { window.__xrd.controllers.right.connected = true; }); await H.frames(page, 8);
    const hs2 = await E(() => [0, 1].map(i => window.__arcade.scene.getObjectByName('vrController' + i).userData.hand)); console.log('INFO after reconnect: ' + JSON.stringify(hs2));
    await hold([0.22, 1.28, -0.3], 0.05, -0.1); await check('after a controller reconnect in NK');
    // hits still score when aimed from the gun
    const shootAt = () => E(() => { const A = window.__arcade, T = A.THREE, S = window.__gaVR, G = window.__nkGame, t = G.liveTargets().filter(t => t.dt > 0.2 && t.dt < 1.8).sort((a, b) => a.dt - b.dt)[0]; if (!t) return false;
      const c = window.__xrd.controllers.right, rig = S.rig, cs = Math.cos(rig.yaw), sn = Math.sin(rig.yaw), p = c.position, w = new T.Vector3(rig.x + p.x * cs + p.z * sn, rig.y + p.y, rig.z - p.x * sn + p.z * cs);
      const m = new T.Matrix4().lookAt(w, new T.Vector3(...t.p), new T.Vector3(0, 1, 0)), q = new T.Quaternion().setFromRotationMatrix(m); c.quaternion.set(q.x, q.y, q.z, q.w); return true; });
    const s0 = await E(() => ({ h: window.__nkGame.state.shotHits || 0, sc: window.__nkGame.state.score })); let tries = 0;
    for (; tries < 14; tries++) { if (await shootAt()) { await H.frames(page, 2); await shootAt(); await H.frames(page, 1); await H.press(page, 'right', 'trigger', 2); await H.frames(page, 4); } if ((await E(() => window.__nkGame.state.shotHits || 0)) - s0.h >= 2) break; await sleep(250); }
    const s1 = await E(() => ({ h: window.__nkGame.state.shotHits || 0, sc: window.__nkGame.state.score })); chk(s1.h - s0.h >= 2 && s1.sc > s0.sc, 'aimed shots hit moving targets and score', { hits: [s0.h, s1.h], score: [s0.sc, s1.sc] });
    // PUNCH: glove back, gun gone; leaving NK: no gun in the arcade
    await E(() => window.__nkGame.setMode('punch')); await H.frames(page, 4); const pu = await E(() => ({ bl: window.__nkGame.blaster.visible, glove: window.__nkGame.gloves.R.visible }));
    chk(!pu.bl && pu.glove, 'PUNCH: right glove back, gun hidden', pu);
    chk(R.errors.length === 0, 'no console errors', R.errors.slice(0, 4));
  } catch (e) { chk(false, 'ERROR ' + e.stack); }
  await R.close(); console.log(ok ? 'ALL PASS' : 'SOME FAIL'); process.exit(ok ? 0 : 1);
})();
