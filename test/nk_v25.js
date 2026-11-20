// vrtest-v25 (Dave t514u): Neon Knockout MODE: PUNCH / SHOOT. Toggle (orb / Y menu / pause / flat OPTIONS) + persistence, shooting a target scores,
// calories hidden in SHOOT and back in PUNCH, right stick click opens the fire-type hologram in NK, the fire type changes the shot, Y-only pause, ?noshootmode=1.
const { openVR, H, IWER_SRC, SETUP, HEADSET_FB } = require('./vrlib');
const fs = require('fs');
(async () => {
  let ok = true; const chk = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) ok = false; };
  let R = await openVR({ w: 480, h: 270, init: { content: IWER_SRC + SETUP + HEADSET_FB } }); let page = R.page;
  const E = (f, a) => page.evaluate(f, a), until = (f, t = 30000) => page.waitForFunction(f, null, { timeout: t });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const place = async (x, z, yaw = 0) => { await E(([x, z, yaw]) => { const S = window.__gaVR; S.rig = { x, y: 0, z, yaw }; S.applyRig(); window.__arcade.monkey.position.set(x, 0, z); }, [x, z, yaw]); await H.frames(page, 6); };
  const aimPress = async (target, hand = 'right') => { await H.aim(page, hand, [0.2, 1.3, -0.2], target); await H.frames(page, 3); await H.press(page, hand, 'trigger'); await H.frames(page, 3); };
  const btnAt = id => E(id => window.__gaVR.ui.btnWorld(id), id), btns = () => E(() => window.__gaVR.ui.btns.map(b => b.id)), panel = () => E(() => window.__gaVR.ui.kind || null);
  const look = async pitch => { await E(p => { const T = window.__arcade.THREE, q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), p); window.__xrd.quaternion.set(q.x, q.y, q.z, q.w); }, pitch); await H.frames(page, 8); };
  // average RGB of a region of the left eye (fractions, y up)
  const eyeRGB = (rx0, ry0, rx1, ry1) => E(([rx0, ry0, rx1, ry1]) => { const L = window.__hsLayer, gl = L.context, w = L.__w, h = L.__h, px = new Uint8Array(w * h * 4); const prev = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L.__fb); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev); let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.floor(ry0 * h); y < ry1 * h; y++) for (let x = Math.floor(rx0 * w / 2); x < rx1 * w / 2; x++) { const i = (y * w + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; } return [r / n, g / n, b / n].map(v => Math.round(v)); }, [rx0, ry0, rx1, ry1]);
  const shot = async name => { if (!process.env.SHOTS) return; const d = await E(() => { const L = window.__hsLayer, gl = L.context, w = L.__w, h = L.__h, px = new Uint8Array(w * h * 4); const prev = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L.__fb); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
    const c = document.createElement('canvas'); c.width = w / 2; c.height = h; const g = c.getContext('2d'), im = g.createImageData(w / 2, h); for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) { const s = ((h - 1 - y) * w + x) * 4, t = (y * w / 2 + x) * 4; im.data[t] = px[s]; im.data[t + 1] = px[s + 1]; im.data[t + 2] = px[s + 2]; im.data[t + 3] = 255; } g.putImageData(im, 0, 0); return c.toDataURL('image/png'); });
    fs.writeFileSync('/tmp/v23_' + name + '.png', Buffer.from(d.split(',')[1], 'base64')); };
  const clickStick = async hand => { await H.btn(page, hand, 'thumbstick', 1); await H.frames(page, 3); await H.btn(page, hand, 'thumbstick', 0); await H.frames(page, 3); };
  const N = f => E(f);
  // each NK tick: point the right controller so its ray leaves the blaster muzzle straight at the nearest live target (what the next frame's shot tests)
  const track = on => E(on => { const G = window.__nkGame; if (!G.__t0) { G.__t0 = G.tick; G.tick = function (dt) { const r = G.__t0.apply(this, arguments); if (G.__track) try {
        const A = window.__arcade, T = A.THREE, S = window.__gaVR, live = G.liveTargets().filter(t => t.dt > 0.15 && t.dt < 1.8).sort((a, b) => a.dt - b.dt)[0]; G.__aimed = live || null; if (!live) return r;
        const mz = G.blasterMuzzle(new T.Vector3()); if (!mz) return r; const m = new T.Matrix4().lookAt(mz, new T.Vector3(...live.p), new T.Vector3(0, 1, 0)), qw = new T.Quaternion().setFromRotationMatrix(m);
        const ql = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -S.rig.yaw).multiply(qw); window.__xrd.controllers.right.quaternion.set(ql.x, ql.y, ql.z, ql.w); } catch (e) { G.__trackErr = String(e); } return r; }; }
      G.__track = on; }, on);
  const st = () => E(() => { const G = window.__nkGame, S = window.__gaVR; return { mode: G.mode, play: G.state.mode, paused: !!G.state.paused, score: G.state.score, shotHits: G.state.shotHits || 0, shots: G.state.shots || 0, kcal: G.state.kcal, hits: G.state.hits,
    calVis: G.panelR.m.visible, scoreVis: G.panelL.m.visible, blaster: !!(G.blaster && G.blaster.visible), gloveR: G.gloves.R.visible, gloveL: G.gloves.L.visible, nkShots: S.nkShots, beamHits: S.nkBeamHits || 0, last: S.vrLaser().last, type: S.fireMenu().type, fm: S.fireMenu().open, ui: S.ui.kind || null,
    ray: (() => { const c = window.__arcade.scene.getObjectByName('vrController0'), d = window.__arcade.scene.getObjectByName('vrController1'); return [c, d].map(q => q && q.userData.ray ? q.userData.ray.visible : null); })() }; });
  const lastBolt = () => E(() => { const L = window.__roomFire.lasers[window.__roomFire.lasers.length - 1]; return L ? L.hex : null; });
  try {
    await E(() => { localStorage.removeItem('galacticarcade.nkMode'); localStorage.removeItem('galacticarcade.vrFireType'); window.__tpTimeScale = 3; });
    await until(() => document.getElementById('vrBtn').classList.contains('on'), 20000); await until(() => window.__gaVR.prewarm.done, 180000);
    await page.click('#vrBtn'); await until(() => window.__gaVR.presenting && window.__gaVR.posed);
    await E(() => window.__loadNK());
    const pad4 = await E(() => [window.__tp.PAD4.x, window.__tp.PAD4.z]); await place(pad4[0] + 2.2, pad4[1] - 2.2, 3 * Math.PI / 4);
    await aimPress(await E(() => window.__gaVR.signs().find(q => q.id === 'beamNK').at));
    await until(() => window.__tp.where === 3 && window.__tp.state === 'idle' && window.__nkGame && window.__nkGame.inStudio, 90000); await H.frames(page, 10);
    const C0 = await E(() => { const v = window.__nkGame.mark.getWorldPosition(new window.__arcade.THREE.Vector3()); return [v.x, v.z]; }); await place(C0[0], C0[1], 0); await H.frames(page, 10);
    // ---- the MODE orb ----
    let s = await st(); const ov = await E(() => { const G = window.__nkGame, o = G.menuOrbs.find(q => q.id === 'mode'); if (!o) return null; const c = o.lab.material.map.image, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let edge = 0;
      for (let y = 0; y < c.height; y++) for (const x of [0, 1, 2, c.width - 3, c.width - 2, c.width - 1]) if (d[(y * c.width + x) * 4 + 3] > 200) edge++; return { label: o.label, vis: o.g.visible, edge, pt: G.pointOrbs().some(p => p.id === 'mode') }; });
    chk(s.mode === 'punch' && ov && ov.label === 'MODE: PUNCH' && ov.vis && ov.edge === 0 && ov.pt, 'default PUNCH; MODE orb in the menu, full label, pointable', { s: s.mode, ov });
    await aimPress(await E(() => window.__nkGame.orbWorld('mode').toArray())); await H.frames(page, 6); s = await st();
    chk(s.mode === 'shoot' && (await E(() => localStorage.getItem('galacticarcade.nkMode'))) === 'shoot', 'MODE orb -> SHOOT (saved galacticarcade.nkMode)');
    chk(s.blaster && !s.gloveR && s.gloveL, 'SHOOT: blaster in the right hand (right glove hidden)', s);
    // ---- a round in SHOOT ----
    await E(() => window.__nkGame.startRound({ diff: 'normal' })); await H.frames(page, 6); s = await st();
    chk(s.play === 'play' && s.scoreVis && !s.calVis, 'SHOOT round: SCORE board shown, CALORIES board hidden', s);
    chk(s.ray[0] || s.ray[1], 'SHOOT round: the aiming ray is shown', s.ray);
    await until(() => window.__nkGame.liveTargets().some(t => t.dt > 0.3 && t.dt < 1.6), 30000);
    await track(true); await H.frames(page, 3);
    let s0 = await st(); await H.press(page, 'right', 'trigger', 2); await H.frames(page, 3); let s1 = await st();
    chk(s1.nkShots > s0.nkShots && s1.shotHits > s0.shotHits && s1.score > s0.score && s1.last && s1.last.kind === 'classic', 'CLASSIC: trigger fires, the bolt hits a moving target and scores', { shots: [s0.nkShots, s1.nkShots], hits: [s0.shotHits, s1.shotHits], score: [s0.score, s1.score], last: s1.last });
    chk(s1.kcal === 0, 'no calories counted in SHOOT', s1.kcal);
    // ---- right stick click: fire-type hologram in NK, stick moves the highlight, A selects ----
    await clickStick('right'); let fm = await E(() => window.__gaVR.fireMenu()); chk(fm.open && fm.visible, 'right stick click opens the fire-type hologram in a NK round', fm);
    s0 = await st(); await H.press(page, 'right', 'trigger', 2); await H.frames(page, 2); s1 = await st(); chk(s1.nkShots === s0.nkShots, 'trigger does not fire while the hologram is open');
    const yaw0 = await E(() => window.__gaVR.rig.yaw);
    await H.axes(page, 'right', 0, 1); await H.frames(page, 4); await H.axes(page, 'right', 0, 0); await H.frames(page, 3);
    fm = await E(() => window.__gaVR.fireMenu()); chk(fm.hover === 1 && Math.abs((await E(() => window.__gaVR.rig.yaw)) - yaw0) < 1e-6, 'stick moves the highlight to RAPID PULSE (no turning)', { hover: fm.hover });
    await H.press(page, 'right', 'a-button'); await H.frames(page, 3); fm = await E(() => window.__gaVR.fireMenu());
    chk(!fm.open && fm.type === 'pulse' && (await E(() => localStorage.getItem('galacticarcade.vrFireType'))) === 'pulse', 'A selects RAPID PULSE (saved galacticarcade.vrFireType), hologram closes', fm);
    s0 = await st(); await H.btn(page, 'right', 'trigger', 1); await H.frames(page, 20); await H.btn(page, 'right', 'trigger', 0); await H.frames(page, 3); s1 = await st(); let hx = await lastBolt();
    chk(s1.nkShots - s0.nkShots >= 3 && s1.last.kind === 'pulse' && hx === 0xffe14a, 'RAPID PULSE: holding fires a stream of yellow bolts', { n: s1.nkShots - s0.nkShots, kind: s1.last.kind, hx });
    chk(s1.shotHits >= s0.shotHits, 'pulse hits counted', [s0.shotHits, s1.shotHits]);
    await E(() => window.__gaVR.setFireType('scatter')); s0 = await st(); await H.press(page, 'right', 'trigger', 2); await H.frames(page, 3); s1 = await st(); hx = await lastBolt();
    chk(s1.nkShots - s0.nkShots === 5 && s1.last.kind === 'scatter' && hx === 0xff6a22, 'SCATTER: one pull = 5 orange bolts', { n: s1.nkShots - s0.nkShots, hx });
    await E(() => window.__gaVR.setFireType('charge')); s0 = await st(); await H.btn(page, 'right', 'trigger', 1); await sleep(1400); await H.frames(page, 2); await H.btn(page, 'right', 'trigger', 0); await H.frames(page, 3); s1 = await st();
    chk(s1.nkShots - s0.nkShots === 1 && s1.last.kind === 'charge' && s1.last.k > 0.5, 'CHARGE: hold + release = one big bolt', { n: s1.nkShots - s0.nkShots, k: s1.last.k });
    await E(() => window.__gaVR.setFireType('beam')); s0 = await st(); await H.btn(page, 'right', 'trigger', 1); await sleep(900); await H.frames(page, 3); s1 = await st();
    const beamVis = await E(() => window.__arcade.scene.getObjectByName('vrLaserBeam').visible); await H.btn(page, 'right', 'trigger', 0); await H.frames(page, 3);
    chk(beamVis && s1.beamHits > s0.beamHits && s1.score > s0.score, 'CONTINUOUS: the held beam burns through targets', { beamHits: [s0.beamHits, s1.beamHits], score: [s0.score, s1.score] });
    await track(false);
    // ---- Y-only pause, MODE + SCENERY in the pause panel; PUNCH brings calories back ----
    await H.press(page, 'right', 'b-button'); await H.frames(page, 4); s = await st(); chk(!s.paused && !s.ui, 'B still does nothing in a NK round', s.ui);
    await H.press(page, 'left', 'y-button'); await H.frames(page, 6); let bs = await btns(); s = await st();
    chk(s.paused && s.ui === 'nkPause' && bs.includes('nkMode') && bs.includes('nkScenery'), 'Y pauses; the panel has MODE + SCENERY', bs);
    await aimPress(await btnAt('nkMode')); await H.frames(page, 4); s = await st();
    chk(s.mode === 'punch' && s.calVis && !s.blaster && s.gloveR && s.paused, 'pause panel MODE -> PUNCH: CALORIES board back, gloves back, still paused', s);
    await H.press(page, 'left', 'y-button'); await H.frames(page, 30); s = await st();
    chk(!s.paused && s.kcal > 0 && s.calVis, 'resume in PUNCH: calories count again', { kcal: s.kcal });
    await E(() => window.__nkGame.abort('test')); await H.frames(page, 6);
    // ---- Y menu MODE button ----
    await H.press(page, 'left', 'y-button'); await H.frames(page, 6); bs = await btns(); chk(bs.includes('nkMode'), 'Y menu in NK has MODE', bs);
    await aimPress(await btnAt('nkMode')); await H.frames(page, 4); s = await st(); chk(s.mode === 'shoot', 'Y menu MODE -> SHOOT');
    await H.press(page, 'left', 'y-button'); await H.frames(page, 4);
    chk(R.errors.length === 0, 'no console errors (VR)', R.errors.slice(0, 4));
    // ---- reload: persists; flat OPTIONS shows + toggles it ----
    await page.reload(); await page.waitForFunction(() => window.__arcade && window.__arcade.stats.frames > 3, null, { timeout: 90000 }); await page.waitForFunction(() => !!document.getElementById('opNkMode'), null, { timeout: 20000 });
    let fl = await E(() => document.getElementById('opNkMode').textContent); chk(/SHOOT/.test(fl), 'after a reload: flat OPTIONS shows NEON KNOCKOUT: SHOOT', fl);
    await E(() => window.__loadNK()); await until(() => !!window.__nkGame); chk((await E(() => window.__nkGame.mode)) === 'shoot', 'after a reload the game loads in SHOOT');
    await page.click('#bOpt'); await page.waitForSelector('#opNkMode', { state: 'visible' }); await page.click('#opNkMode');
    fl = await E(() => ({ t: document.getElementById('opNkMode').textContent, m: window.__nkGame.mode, ls: localStorage.getItem('galacticarcade.nkMode') })); await page.click('#opX').catch(() => {});
    chk(/PUNCH/.test(fl.t) && fl.m === 'punch' && fl.ls === 'punch', 'flat OPTIONS -> PUNCH (game + saved)', fl);
    chk(R.errors.length === 0, 'no console errors (after reload)', R.errors.slice(0, 4));
    await R.close();
    // ---- ?noshootmode=1 ----
    R = await openVR({ w: 480, h: 270, qs: '?noshootmode=1' }); page = R.page;
    await page.waitForFunction(() => window.__arcade && window.__arcade.stats.frames > 3, null, { timeout: 90000 });
    await E(() => localStorage.setItem('galacticarcade.nkMode', 'shoot')); await E(() => window.__loadNK()); await until(() => !!window.__nkGame);
    s = await E(() => ({ m: window.__nkGame.mode, orb: !!window.__nkGame.menuOrbs.find(o => o.id === 'mode'), btn: getComputedStyle(document.getElementById('opNkMode')).display }));
    chk(s.m === 'punch' && !s.orb && s.btn === 'none', '?noshootmode=1: punch only, no MODE orb, no OPTIONS button (even with shoot saved)', s);
    chk(R.errors.length === 0, 'no console errors (?noshootmode=1)', R.errors.slice(0, 4));
  } catch (e) { chk(false, 'exception ' + (e && e.stack || e)); }
  await R.close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})();
