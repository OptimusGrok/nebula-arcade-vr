// vrtest-v23 (Dave t510u / t511u): Neon Knockout. Y only (B does nothing there), SCENERY reachable in VR (orb fully labelled + in view,
// Y menu, pause panel), no boxing ring (posts / ropes / 1.25 m mat edge) in either scenery, grey concrete rooftop floor without neon lane / ring cues,
// footprints exactly in the centre of the standing circle. No console errors.
const { openVR, H, IWER_SRC, SETUP, HEADSET_FB } = require('./vrlib');
const fs = require('fs');
(async () => {
  let ok = true; const chk = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) ok = false; };
  const R = await openVR({ w: 480, h: 270, init: { content: IWER_SRC + SETUP + HEADSET_FB } }), page = R.page;
  const E = (f, a) => page.evaluate(f, a), until = (f, t = 30000) => page.waitForFunction(f, null, { timeout: t });
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
  try {
    await E(() => { localStorage.removeItem('galacticarcade.nkScenery'); window.__tpTimeScale = 3; });
    await until(() => document.getElementById('vrBtn').classList.contains('on'), 20000); await until(() => window.__gaVR.prewarm.done, 180000);
    await page.click('#vrBtn'); await until(() => window.__gaVR.presenting && window.__gaVR.posed);
    await E(() => window.__loadNK());
    const pad4 = await E(() => [window.__tp.PAD4.x, window.__tp.PAD4.z]); await place(pad4[0] + 2.2, pad4[1] - 2.2, 3 * Math.PI / 4);
    await aimPress(await E(() => window.__gaVR.signs().find(q => q.id === 'beamNK').at));
    await until(() => window.__tp.where === 3 && window.__tp.state === 'idle' && window.__nkGame && window.__nkGame.inStudio, 90000); await H.frames(page, 10);
    // stand in the standing circle, facing the targets
    const C0 = await E(() => { const N = window.__nkGame, v = N.mark.getWorldPosition(new window.__arcade.THREE.Vector3()); return [v.x, v.z]; }); await place(C0[0], C0[1], 0); await H.frames(page, 10);
    // ---- 3) no boxing ring ----
    const ring = await E(() => { const root = window.__arcade.scene.getObjectByName('nkStudio') || window.__arcade.scene, out = [];
      root.traverse(o => { const g = o.geometry, p = g && g.parameters; if (!p) return; if (g.type === 'CylinderGeometry' && [1.5, 4.2, 4.8].includes(p.height)) out.push('cyl' + p.height); if (g.type === 'TorusGeometry' && Math.abs(p.radius - 1.25) < 1e-6) out.push('torus1.25'); });
      const fl = window.__arcade.scene.getObjectByName('nkFloor'); return { out, floorRing: fl ? /length\(vW\.xz\)-1\.25/.test(fl.material.fragmentShader) : null }; });
    chk(ring.out.length === 0 && ring.floorRing === false, 'studio: no ring posts / ropes / 1.25 m mat edge (mesh or floor line)', ring);
    // ---- 5) footprints centred in the standing circle ----
    let ft = await E(() => { const N = window.__nkGame, c = N.feet.material.map.image, d = c.getContext('2d').getImageData(0, 0, 256, 256).data; let x0 = 256, y0 = 256, x1 = -1, y1 = -1;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (d[(y * 256 + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      return { cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, f: [N.feet.position.x, N.feet.position.z], m: [N.mark.position.x, N.mark.position.z], shift: N.feetShift }; });
    chk(Math.abs(ft.cx - 128) <= 0.5 && Math.abs(ft.cy - 128) <= 0.5 && ft.f[0] === ft.m[0] && ft.f[1] === ft.m[1], 'footprints: outline centred on its quad, quad on the circle centre', ft);
    await look(-1.25); await shot('studio_down'); await look(0);
    // ---- 2) SCENERY orb: in view, fully labelled, reachable with the ray ----
    const ov = await E(() => { const N = window.__nkGame, S = window.__gaVR, o = N.orbWorld('scenery'), h = S.head, dx = o.x - h.x, dy = o.y - h.y, dz = o.z - h.z;
      const orb = N.menuOrbs.find(q => q.id === 'scenery'), c = orb.lab.material.map.image, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let edge = 0;
      for (let y = 0; y < c.height; y++) for (const x of [0, 1, 2, 3, c.width - 4, c.width - 3, c.width - 2, c.width - 1]) if (d[(y * c.width + x) * 4 + 3] > 200) edge++;
      return { vis: orb.g.visible, label: orb.label, yawDeg: Math.atan2(dx, -dz) * 180 / Math.PI, pitchDeg: Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI, edge, r: orb.r, inPoint: N.pointOrbs().some(p => p.id === 'scenery') }; });
    chk(ov.vis && ov.inPoint && Math.abs(ov.yawDeg) < 35 && Math.abs(ov.pitchDeg) < 30 && ov.edge === 0 && /SCENERY: STUDIO/.test(ov.label), 'SCENERY orb visible in front (within 35 deg), label not clipped, pointable', ov);
    await aimPress(await E(() => window.__nkGame.orbWorld('scenery').toArray()));
    await until(() => window.__nkGame.scenery === 'rooftop', 30000); await H.frames(page, 20);
    chk(true, 'ray + trigger on the SCENERY orb -> rooftop');
    // ---- 3 + 4) rooftop: no ring, grey concrete, no lane / ring cues ----
    const rf = await E(() => { const N = window.__nkGame, sl = window.__arcade.scene.getObjectByName('nkRoofSlab'), fs = sl.material.fragmentShader, out = [];
      (window.__arcade.scene.getObjectByName('nkStudio') || window.__arcade.scene).traverse(o => { const g = o.geometry, p = g && g.parameters; if (o.visible && p && g.type === 'CylinderGeometry' && [1.5, 4.2, 4.8].includes(p.height)) out.push(p.height); });
      return { lane: /lane/.test(fs), ring: /1\.25/.test(fs), hot: /hot/.test(fs), transparent: sl.material.transparent, out }; });
    chk(!rf.lane && !rf.ring && !rf.hot && rf.transparent === false && rf.out.length === 0, 'rooftop: opaque concrete slab, no neon lanes / ring / glow cues, no ring meshes', rf);
    await look(-1.3); const rgb = await eyeRGB(0.05, 0.02, 0.32, 0.25); await shot('roof_down');
    const sat = Math.max(...rgb) - Math.min(...rgb), lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
    chk(lum > 25 && lum < 140 && sat < 30, 'rooftop floor under you reads as grey concrete (low saturation)', { rgb, sat, lum });
    await look(-0.25); await shot('roof_ahead'); await look(0);
    // ---- Y menu has SCENERY ----
    await H.press(page, 'left', 'y-button'); await H.frames(page, 6); let bs = await btns();
    chk((await panel()) === 'menu' && bs.includes('nkScenery'), 'Y opens the menu in NK, with SCENERY', bs);
    await aimPress(await btnAt('nkScenery')); await until(() => window.__nkGame.scenery === 'studio', 30000);
    chk(true, 'Y menu SCENERY -> studio');
    await H.press(page, 'left', 'y-button'); await H.frames(page, 6); chk(!(await panel()), 'Y closes the menu');
    // ---- 1) B does nothing in NK (menu / title) ----
    await H.press(page, 'right', 'b-button'); await H.frames(page, 6); chk(!(await panel()), 'B in the NK menu: no menu opens');
    // ---- round: B ignored, Y pauses (pause panel has SCENERY) ----
    await place(C0[0] + 0.3, C0[1] - 0.2, 0);
    await E(() => window.__nkGame.startRound()); await H.frames(page, 20);
    await H.press(page, 'right', 'b-button'); await H.frames(page, 6);
    let st = await E(() => ({ m: window.__nkGame.state.mode, p: !!window.__nkGame.state.paused, ui: window.__gaVR.ui.kind || null, ign: window.__gaVR.nkBIgnored || 0 }));
    chk(st.m === 'play' && !st.p && !st.ui && st.ign >= 1, 'B during a round: no pause, no menu', st);
    ft = await E(() => { const N = window.__nkGame, S = window.__gaVR, h = S.head, w = N.mark.getWorldPosition(new window.__arcade.THREE.Vector3()), f = N.feet.getWorldPosition(new window.__arcade.THREE.Vector3()); return { f: [f.x, f.z], m: [w.x, w.z], h: [h.x, h.z] }; });
    chk(Math.hypot(ft.f[0] - ft.m[0], ft.f[1] - ft.m[1]) < 1e-6 && Math.hypot(ft.m[0] - ft.h[0], ft.m[1] - ft.h[1]) < 0.06, 'round start (calibrated to where you stand): circle + footprints move together, same centre', ft);
    await H.press(page, 'left', 'y-button'); await H.frames(page, 6); bs = await btns();
    st = await E(() => ({ p: !!window.__nkGame.state.paused, ui: window.__gaVR.ui.kind || null }));
    chk(st.p && st.ui === 'nkPause' && ['nkResume', 'nkReset', 'nkExit', 'nkScenery'].every(b => bs.includes(b)), 'Y pauses: RESUME / RESET / EXIT + SCENERY', bs);
    await aimPress(await btnAt('nkScenery')); await until(() => window.__nkGame.scenery === 'rooftop', 30000); await H.frames(page, 4);
    st = await E(() => ({ p: !!window.__nkGame.state.paused, ui: window.__gaVR.ui.kind || null }));
    chk(st.p && st.ui === 'nkPause', 'pause panel SCENERY -> rooftop, still paused', st);
    await H.press(page, 'left', 'y-button'); await H.frames(page, 20);
    st = await E(() => ({ m: window.__nkGame.state.mode, p: !!window.__nkGame.state.paused, ui: window.__gaVR.ui.kind || null, hits0: window.__nkGame.state.hits }));
    chk(st.m === 'play' && !st.p && !st.ui, 'Y resumes', st);
    await E(() => window.__nkGame.abort('test')); await H.frames(page, 10);
    chk(R.errors.length === 0, 'no console errors', R.errors.slice(0, 4));
  } catch (e) { chk(false, 'exception ' + (e && e.stack || e)); }
  await R.close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})();
