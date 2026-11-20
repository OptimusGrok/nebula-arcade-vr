// vrtest-v27 (Dave t517u): Neon Knockout SHOOT: the blaster is held in the right hand at hand height and points exactly where the shots go;
// every fire type leaves the gun's MUZZLE and travels straight along the barrel (not from the ground / upward). Hits still score.
const { openVR, H, IWER_SRC, SETUP } = require('./vrlib');
(async () => {
  let ok = true; const chk = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) ok = false; };
  const R = await openVR({ w: 480, h: 270, init: { content: IWER_SRC + SETUP } }); const page = R.page;
  const E = (f, a) => page.evaluate(f, a), until = (f, t = 30000) => page.waitForFunction(f, null, { timeout: t }), sleep = ms => new Promise(r => setTimeout(r, ms));
  const place = async (x, z, yaw = 0) => { await E(([x, z, yaw]) => { const S = window.__gaVR; S.rig = { x, y: 0, z, yaw }; S.applyRig(); window.__arcade.monkey.position.set(x, 0, z); }, [x, z, yaw]); await H.frames(page, 6); };
  // right controller (rig-local position, pitch / yaw in radians)
  const hold = async (pos, pitch, yaw) => { await E(([pos, pitch, yaw]) => { const T = window.__arcade.THREE, q = new T.Quaternion().setFromEuler(new T.Euler(pitch, yaw, 0, 'YXZ')), c = window.__xrd.controllers.right; c.position.set(...pos); c.quaternion.set(q.x, q.y, q.z, q.w); }, [pos, pitch, yaw]); await H.frames(page, 4); };
  const gun = () => E(() => { const A = window.__arcade, T = A.THREE, G = window.__nkGame, f = v => v.toArray().map(x => +x.toFixed(4)); const sc = A.scene, c = [0, 1].map(i => sc.getObjectByName('vrController' + i)).find(q => q && q.userData.hand === 'right');
    const mz = G.blasterMuzzle(new T.Vector3()), br = G.blasterBarrel(new T.Vector3()), q = new T.Quaternion(); c.getWorldQuaternion(q); const ray = new T.Vector3(0, 0, -1).applyQuaternion(q);
    const ry = c.userData.ray, ryO = ry.getWorldPosition(new T.Vector3());
    return { vis: G.blaster.visible, glove: G.gloves.R.visible, gun: f(G.blaster.getWorldPosition(new T.Vector3())), ctrl: f(new T.Vector3().setFromMatrixPosition(c.matrixWorld)), muzzle: mz && f(mz), barrel: br && f(br), ray: f(ray), sight: ry.visible, sightO: f(ryO), sightMz: mz ? +ryO.distanceTo(mz).toFixed(4) : null }; });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), nrm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
  const boltsSince = n0 => E(n0 => window.__roomFire.lasers.filter(L => L.__seen !== 1).map(L => { L.__seen = 1; return { o: L.o.slice(), d: L.dir.toArray(), p: L.mesh.position.toArray(), id: L }; }).map(({ o, d, p }) => ({ o, d, p })), n0);
  const mark = () => E(() => { for (const L of window.__roomFire.lasers) L.__seen = 1; });
  // follow bolts for a few frames: where they started and the direction they actually moved
  const flight = () => E(() => new Promise(res => { const Ls = window.__roomFire.lasers.filter(L => L.__seen !== 1); const p0 = Ls.map(L => L.mesh.position.clone()); requestAnimationFrame(() => setTimeout(() => {
    res(Ls.map((L, i) => { L.__seen = 1; const m = L.mesh.position.clone().sub(p0[i]); return { o: L.o.slice(), d: L.dir.toArray(), moved: m.length() > 1e-4 ? m.normalize().toArray() : null, dy: L.mesh.position.y - p0[i].y }; })); }, 60)); }));
  try {
    await E(() => { localStorage.setItem('galacticarcade.nkMode', 'shoot'); localStorage.removeItem('galacticarcade.vrFireType'); window.__tpTimeScale = 3; });
    await until(() => document.getElementById('vrBtn').classList.contains('on'), 20000); await until(() => window.__gaVR.prewarm.done, 180000);
    await page.click('#vrBtn'); await until(() => window.__gaVR.presenting && window.__gaVR.posed);
    await E(() => window.__loadNK()); await E(() => window.__tp.go('nk'));
    await until(() => window.__tp.where === 3 && window.__tp.state === 'idle' && window.__nkGame && window.__nkGame.inStudio, 90000); await H.frames(page, 10);
    const C0 = await E(() => { const v = window.__nkGame.mark.getWorldPosition(new window.__arcade.THREE.Vector3()); return [v.x, v.z]; }); await place(C0[0], C0[1], 0);
    await E(() => window.__nkGame.startRound({ diff: 'normal' })); await H.frames(page, 6);
    // 1) gun in the hand at hand height, barrel along the pointing ray, for several hand poses
    for (const [pos, pitch, yaw, nm] of [[[0.2, 1.25, -0.3], 0, 0, 'level'], [[0.25, 1.2, -0.25], -0.35, 0.3, 'down-right'], [[0.15, 1.35, -0.35], 0.3, -0.4, 'up-left']]) {
      await hold(pos, pitch, yaw); const g = await gun();
      chk(g.vis && !g.glove && g.gun[1] >= 1.1 && g.gun[1] <= 1.45 && dist(g.gun, g.ctrl) < 0.15, `1) ${nm}: blaster drawn in the right hand at hand height (y ${g.gun[1]}), right glove hidden`, { gun: g.gun, ctrl: g.ctrl });
      chk(g.muzzle[1] > 1.0 && dot(g.barrel, g.ray) > 0.999 && dot(nrm(g.muzzle.map((v, i) => v - g.gun[i])), g.barrel) > 0.8, `1) ${nm}: barrel along the pointing ray (dot ${dot(g.barrel, g.ray).toFixed(5)}), muzzle in front of the hand`, { muzzle: g.muzzle, barrel: g.barrel, ray: g.ray });
      chk(g.sight && g.sightMz < 0.01, `1) ${nm}: aiming line starts at the muzzle`, { sightMz: g.sightMz }); }
    // vrtest-v28: every ancestor of the gun visible up to the scene, the gun really drawn, and not at the feet (Dave's real-Quest bug)
    { const r = await E(() => { const A = window.__arcade, G = window.__nkGame, b = G.blaster; let m = null; b.traverse(o => { if (!m && o.isMesh) m = o; }); if (!m.__hk) { m.__hk = 1; const f0 = m.onBeforeRender; m.onBeforeRender = function () { G.__blR = (G.__blR || 0) + 1; return f0.apply(this, arguments); }; }
        const ch = []; let p = b, top = null; while (p) { ch.push(p.visible); top = p; p = p.parent; } const w = b.getWorldPosition(new A.THREE.Vector3()), S = window.__gaVR; return { all: ch.every(Boolean), top: top === A.scene, r0: G.__blR || 0, y: w.y, feet: Math.hypot(w.x - S.rig.x, w.y, w.z - S.rig.z) }; });
      await H.frames(page, 6); const r1 = await E(() => window.__nkGame.__blR || 0);
      chk(r.all && r.top && r1 > r.r0 && r.y > 1.05 && r.feet > 0.9, 'gun: every ancestor visible up to the scene, actually drawn, at hand height (not the feet)', { y: +r.y.toFixed(3), feet: +r.feet.toFixed(3), renders: [r.r0, r1] }); }
    // 2+4) every fire type: the bolt / beam starts at the muzzle and travels along the barrel
    await hold([0.2, 1.25, -0.3], -0.1, 0.15);
    const fire = async (type, how) => { await E(t => window.__gaVR.setFireType(t), type); await H.frames(page, 3); const g = await gun(); await mark();
      if (how === 'tap') { await H.btn(page, 'right', 'trigger', 1); await H.frames(page, 2); }
      else if (how === 'hold') { await H.btn(page, 'right', 'trigger', 1); await H.frames(page, 12); }
      else if (how === 'charge') { await H.btn(page, 'right', 'trigger', 1); await sleep(1200); await H.frames(page, 2); await H.btn(page, 'right', 'trigger', 0); await H.frames(page, 1); }
      const fl = type === 'beam' ? null : await flight();
      let beam = null; if (type === 'beam') beam = await E(() => { const T = window.__arcade.THREE, b = window.__arcade.scene.getObjectByName('vrLaserBeam'); b.updateMatrixWorld(true); return { vis: b.visible, o: b.getWorldPosition(new T.Vector3()).toArray(), d: new T.Vector3(0, 0, 1).transformDirection(b.matrixWorld).toArray() }; });
      await H.btn(page, 'right', 'trigger', 0); await H.frames(page, 4); return { g, fl, beam }; };
    const tol = 0.06;   // a bolt fired this frame vs the muzzle read just before (hand held still): within a few cm (+3 cm lead in front of the muzzle)
    for (const [type, how] of [['classic', 'tap'], ['pulse', 'hold'], ['charge', 'charge']]) {
      const { g, fl } = await fire(type, how); const bad = fl.filter(b => !(dist(b.o, g.muzzle) < tol && dot(nrm(b.d), g.barrel) > 0.99 && b.moved && dot(b.moved, g.barrel) > 0.99));
      chk(fl.length >= 1 && bad.length === 0 && fl.every(b => b.o[1] > 1.0), `2/4) ${type.toUpperCase()}: ${fl.length} bolt(s) leave the muzzle (y ~${g.muzzle[1].toFixed(2)}) and fly along the barrel`, { n: fl.length, first: fl[0] && { o: fl[0].o.map(v => +v.toFixed(3)), d: fl[0].d.map(v => +v.toFixed(3)), dot: +dot(nrm(fl[0].d), g.barrel).toFixed(5), movedDot: fl[0].moved && +dot(fl[0].moved, g.barrel).toFixed(5) }, muzzle: g.muzzle, bad: bad.length }); }
    { const { g, fl } = await fire('scatter', 'tap'); const ds = fl.map(b => dot(nrm(b.d), g.barrel)).sort((a, b) => b - a); const mean = nrm(fl.reduce((s, b) => s.map((v, i) => v + b.d[i]), [0, 0, 0]));
      chk(fl.length === 5 && fl.every(b => dist(b.o, g.muzzle) < tol && b.moved && dot(b.moved, nrm(b.d)) > 0.999) && ds[0] > 0.999 && dot(mean, g.barrel) > 0.99, `2/4) SCATTER: 5 bolts leave the muzzle, centre bolt along the barrel, fan centred on it`, { n: fl.length, dots: ds.map(v => +v.toFixed(4)), mean: +dot(mean, g.barrel).toFixed(5) }); }
    { const { g, beam } = await fire('beam', 'hold');
      chk(beam.vis && dist(beam.o, g.muzzle) < tol && dot(beam.d, g.barrel) > 0.99 && beam.o[1] > 1.0, `2/4) CONTINUOUS: the beam starts at the muzzle and runs along the barrel`, { o: beam.o.map(v => +v.toFixed(3)), dot: +dot(beam.d, g.barrel).toFixed(5) }); }
    // 3) aim the gun at moving targets: hits score
    await E(() => window.__gaVR.setFireType('classic'));
    await until(() => window.__nkGame.liveTargets().some(t => t.dt > 0.3 && t.dt < 1.6), 30000);
    const shootAt = async () => E(() => { const A = window.__arcade, T = A.THREE, S = window.__gaVR, G = window.__nkGame, t = G.liveTargets().filter(t => t.dt > 0.2 && t.dt < 1.8).sort((a, b) => a.dt - b.dt)[0]; if (!t) return false;
      const c = window.__xrd.controllers.right, rig = S.rig, cs = Math.cos(rig.yaw), sn = Math.sin(rig.yaw), p = c.position, w = new T.Vector3(rig.x + p.x * cs + p.z * sn, rig.y + p.y, rig.z - p.x * sn + p.z * cs);
      const m = new T.Matrix4().lookAt(w, new T.Vector3(...t.p), new T.Vector3(0, 1, 0)), q = new T.Quaternion().setFromRotationMatrix(m); c.quaternion.set(q.x, q.y, q.z, q.w); return true; });
    let s0 = await E(() => ({ h: window.__nkGame.state.shotHits || 0, sc: window.__nkGame.state.score })), tries = 0;
    for (; tries < 12; tries++) { if (await shootAt()) { await H.frames(page, 2); await shootAt(); await H.frames(page, 1); await H.press(page, 'right', 'trigger', 2); await H.frames(page, 4); }
      const s = await E(() => ({ h: window.__nkGame.state.shotHits || 0 })); if (s.h - s0.h >= 2) break; await sleep(250); }
    const s1 = await E(() => ({ h: window.__nkGame.state.shotHits || 0, sc: window.__nkGame.state.score }));
    chk(s1.h - s0.h >= 2 && s1.sc > s0.sc, '3) aiming the gun at moving targets hits and scores', { hits: [s0.h, s1.h], score: [s0.sc, s1.sc], tries });
    // PUNCH mode still gives the glove back
    await E(() => window.__nkGame.setMode('punch')); await H.frames(page, 4); const gp = await E(() => ({ bl: window.__nkGame.blaster.visible, glove: window.__nkGame.gloves.R.visible }));
    chk(!gp.bl && gp.glove, 'PUNCH: blaster gone, right glove back', gp);
    const errs = R.errors; chk(errs.length === 0, '5) no console errors', errs.slice(0, 4));
  } catch (e) { chk(false, 'ERROR ' + e.stack); }
  await R.close(); console.log(ok ? 'ALL PASS' : 'SOME FAIL'); process.exit(ok ? 0 : 1);
})();
