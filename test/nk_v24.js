// vrtest-v24 (Dave t513u): Neon Knockout SCORE + CALORIES boards on the player's LEFT (~43 / 68 deg, 2.1 m, facing the head, above the duck bar),
// both sceneries, following the round-start calibration; clear of targets, the bar, the menu orbs and the punch area. Wrist HUD: no 'undefined' on NK orbs.
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
    const C0 = await E(() => { const v = window.__nkGame.mark.getWorldPosition(new window.__arcade.THREE.Vector3()); return [v.x, v.z]; }); await place(C0[0], C0[1], 0); await H.frames(page, 10);
    // ---- wrist HUD while pointing at an NK orb ----
    await H.aim(page, 'right', [0.2, 1.3, -0.2], await E(() => window.__nkGame.orbWorld('scenery').toArray())); await H.frames(page, 6);
    let hud = await E(() => ({ txt: window.__arcade.scene.getObjectByName('vrHud').userData.txt, hov: window.__gaVR.hover && window.__gaVR.hover.target }));
    chk(/^\d+ TICKETS?\|TRIGGER: SCENERY: STUDIO/.test(hud.txt) && !/undefined/.test(hud.txt), 'wrist HUD on the SCENERY orb: ticket count + "TRIGGER: SCENERY: STUDIO" (was "undefined")', hud);
    await H.aim(page, 'right', [0.2, 1.3, -0.2], await E(() => window.__nkGame.orbWorld('beast').toArray())); await H.frames(page, 6);
    hud = await E(() => window.__arcade.scene.getObjectByName('vrHud').userData.txt); chk(/TRIGGER: BEAST/.test(hud) && !/undefined/.test(hud), 'wrist HUD on the BEAST orb', hud);
    await H.aim(page, 'right', [0.2, 1.3, -0.2], [C0[0], 0.5, C0[1] + 3]); await H.frames(page, 3);
    const orbsW = await E(() => window.__nkGame.menuOrbs.map(o => [o.id, ...window.__nkGame.orbWorld(o.id).toArray(), o.r]));
    const geo = () => E(() => { const N = window.__nkGame, T = window.__arcade.THREE, root = window.__arcade.scene.getObjectByName('nkStudio'), c = N.state.center.clone().add(root.position), hh = N.state.headH + root.position.y, head = window.__gaVR.head;
      const one = P => { P.m.updateMatrixWorld(true); const p = P.m.getWorldPosition(new T.Vector3()), dx = p.x - c.x, dz = p.z - c.z, n = new T.Vector3(0, 0, 1).transformDirection(P.m.matrixWorld), toH = new T.Vector3(head.x, head.y, head.z).sub(p).normalize();
        const w = P.m.geometry.parameters.width / 2, h = P.m.geometry.parameters.height / 2, corners = [[-w, -h], [w, -h], [-w, h], [w, h]].map(([x, y]) => new T.Vector3(x, y, 0).applyMatrix4(P.m.matrixWorld).toArray());
        return { vis: P.m.visible, left: Math.atan2(-dx, -dz) * 180 / Math.PI, dist: Math.hypot(dx, dz), y: p.y - hh, face: n.dot(toH), corners, inv: P.m.matrixWorld.clone().invert().toArray(), w, h }; };
      return { c: [c.x, c.z], hh, L: one(N.panelL), R: one(N.panelR) }; });
    const clearOf = (P, pts, m) => pts.filter(q => { const e = P.inv, x = e[0] * q[0] + e[4] * q[1] + e[8] * q[2] + e[12], y = e[1] * q[0] + e[5] * q[1] + e[9] * q[2] + e[13], z = e[2] * q[0] + e[6] * q[1] + e[10] * q[2] + e[14];
      return Math.abs(x) < P.w + m && Math.abs(y) < P.h + m && Math.abs(z) < m; });
    for (const sc of ['studio', 'rooftop']) {
      if (sc === 'rooftop') { await E(() => window.__nkGame.setScenery('rooftop')); await until(() => window.__nkGame.scenery === 'rooftop', 30000); }
      // stand off the old centre so the round-start calibration moves everything
      const off = sc === 'studio' ? [0.35, -0.25] : [-0.3, 0.2]; await place(C0[0] + off[0], C0[1] + off[1], 0);
      await E(() => window.__nkGame.startRound()); await H.frames(page, 2);
      const g = await geo();
      const head = await E(() => window.__gaVR.head);
      chk(Math.hypot(g.c[0] - head.x, g.c[1] - head.z) < 0.06, sc + ': round start calibrated the standing spot to where you stand', { c: g.c, head: [head.x, head.z] });
      for (const [k, P, want] of [['SCORE', g.L, 43], ['CALORIES', g.R, 68]]) {
        chk(P.vis && Math.abs(P.left - want) < 1 && Math.abs(P.dist - 2.1) < 0.02 && P.face > 0.97 && P.y > 0.3 && P.y < 0.45, sc + ': ' + k + ' board ' + P.left.toFixed(1) + ' deg LEFT, ' + P.dist.toFixed(2) + ' m, ' + P.y.toFixed(2) + ' m above head height, facing the head', { left: P.left, dist: P.dist, y: P.y, face: P.face });
        const low = P.corners.filter(q => Math.abs(q[0] - g.c[0]) < 1.85).map(q => q[1] - g.hh);
        chk(low.every(y => y > 0.08), sc + ': ' + k + ' clear of the duck bar + posts (lower edge above head height + 0.08 m)', low.map(v => +v.toFixed(2)));
        const near = Math.min(...P.corners.map(q => Math.hypot(q[0] - head.x, q[2] - head.z)));
        chk(near > 1.4, sc + ': ' + k + ' out of punch reach (nearest edge ' + near.toFixed(2) + ' m from the head)');
        const pts = await E(() => { const N = window.__nkGame, T = window.__arcade.THREE, root = window.__arcade.scene.getObjectByName('nkStudio'), out = [], v = new T.Vector3();
          for (const ev of N.events()) { if (ev.type === 'BAR') continue; const t = { type: ev.type, x: ev.x, y: ev.y, t: 0 }; for (let k = -6; k <= 40; k++) { N.targetPos(t, -k / 40 * 3, v); out.push(v.clone().add(root.position).toArray()); } } return out; });
        const hits = clearOf(P, pts, 0.2); chk(pts.length > 100 && hits.length === 0, sc + ': ' + k + ' clear of every target path (' + pts.length + ' samples, 20 cm margin)', hits.slice(0, 3));
        const oh = clearOf(P, orbsW.map(o => o.slice(1, 4)), 0.25); chk(oh.length === 0, sc + ': ' + k + ' clear of the menu / SCENERY orbs', oh);
      }
      chk(g.L.left + 12 < g.R.left - 12, sc + ': the two boards do not overlap (angular)', [g.L.left, g.R.left]);
      await shot('boards_' + sc);
      await E(() => window.__nkGame.abort('test')); await H.frames(page, 6);
    }
    chk(R.errors.length === 0, 'no console errors', R.errors.slice(0, 4));
  } catch (e) { chk(false, 'exception ' + (e && e.stack || e)); }
  await R.close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})();
