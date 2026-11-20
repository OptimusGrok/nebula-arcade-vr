// vrtest-v22 (Dave t508u / t509u): comfort locomotion. LEFT stick forward = teleport arc + ring, release = fade-to-black teleport;
// invalid spot (outside the room) = red, nothing on release; pull back = cancel; RIGHT stick flick = exactly 30 deg snap turn with a fade,
// re-centre between snaps, none while the fire-type menu is open; MOVEMENT: SMOOTH (Y menu) persists across a reload (flat OPTIONS shows it);
// the fade always clears (timeout, beam); ?oldmove=1 = old behaviour. No console errors.
const { openVR, H, IWER_SRC, SETUP } = require('./vrlib');
(async () => {
  let ok = true; const chk = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); if (!c) ok = false; };
  let R = await openVR({ w: 480, h: 270, qs: '?nowarm=1&noveil=1' }), page = R.page;
  const E = (f, a) => page.evaluate(f, a), sleep = ms => new Promise(r => setTimeout(r, ms));
  const C = () => E(() => window.__gaVR.comfort());
  const rig = () => E(() => ({ ...window.__gaVR.rig, head: window.__gaVR.head && { ...window.__gaVR.head }, m: [window.__arcade.monkey.position.x, window.__arcade.monkey.position.z] }));
  const place = async (x, z, yaw = 0) => { await E(([x, z, yaw]) => { const S = window.__gaVR; S.rig = { x, y: 0, z, yaw }; S.applyRig(); window.__arcade.monkey.position.set(x, 0, z); }, [x, z, yaw]); await H.frames(page, 6); };
  // aim the left controller so the 7.5 m/s arc lands at (tx, tz) (yaw 0 rig): solve the launch elevation by bisection
  const aimArc = async (tx, tz) => { const r = await rig(); const lo = [-0.2, 1.0, -0.2], o = [r.x + lo[0], lo[1], r.z + lo[2]], d = Math.hypot(tx - o[0], tz - o[2]), V = 7.5, G = 9.81;
    const land = th => { const vy = V * Math.sin(th), vh = V * Math.cos(th), t = (vy + Math.sqrt(vy * vy + 2 * G * o[1])) / G; return vh * t; };
    let a = -1.2, b = 0.7; for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (land(m) < d) a = m; else b = m; } const th = (a + b) / 2, hx = (tx - o[0]) / d, hz = (tz - o[2]) / d;
    await H.aim(page, 'left', lo, [o[0] + hx * Math.cos(th), o[1] + Math.sin(th), o[2] + hz * Math.cos(th)]); await H.frames(page, 3); };
  const clickStick = async hand => { await H.btn(page, hand, 'thumbstick', 1); await H.frames(page, 3); await H.btn(page, hand, 'thumbstick', 0); await H.frames(page, 3); };
  const fadeDone = () => page.waitForFunction(() => window.__gaVR.comfort().fade.phase === 'idle', null, { timeout: 10000 });
  try {
    await E(() => localStorage.removeItem('galacticarcade.vrMove'));
    await page.waitForFunction(() => document.getElementById('vrBtn') && document.getElementById('vrBtn').classList.contains('on'), null, { timeout: 20000 });
    await page.click('#vrBtn'); await page.waitForFunction(() => window.__gaVR.presenting && window.__gaVR.posed && !(window.__gaVR.veil && window.__gaVR.veil.on), null, { timeout: 30000 });
    chk((await C()).mode === 'teleport', 'default movement = teleport');
    // ---- valid teleport: find a free spot ~3.5 m ahead ----
    await place(2, 4); let hit = null;
    for (const [tx, tz] of [[2, 0.5], [1, 1], [3, 1], [0, 2], [4, 2], [2, 2], [-1, 3], [5, 3]]) { await aimArc(tx, tz); await H.axes(page, 'left', 0, -1); await H.frames(page, 4);
      const c = await C(); if (c.aim && c.valid) { hit = { tx, tz, c }; break; } await H.axes(page, 'left', 0, 1); await H.frames(page, 3); await H.axes(page, 'left', 0, 0); await H.frames(page, 3); }
    chk(!!hit && hit.c.arc && hit.c.ring, 'left stick forward: arc + cyan landing ring on a free spot', hit && { t: hit.c.target, why: hit.c.why });
    const colOk = await E(() => { const sc = window.__arcade.scene, a = sc.getObjectByName('vrTpArc'), r = sc.getObjectByName('vrTpArcRing'); return [a.material.color.getHex(), r.material.color.getHex()]; });
    chk(colOk[0] === 0x3ff3ff && colOk[1] === 0x3ff3ff, 'arc + ring are cyan', colOk);
    const before = await rig(), c0 = await C(), tgt = c0.target;
    await H.axes(page, 'left', 0, 0); await H.frames(page, 2); const f1 = await C();
    chk(f1.fade.phase !== 'idle' && f1.fade.kind === 'tp' && !f1.arc, 'release: arc gone, fade to black started', f1.fade);
    await fadeDone(); const after = await rig(), c1 = await C();
    chk(c1.tps === 1 && Math.hypot(after.head.x - tgt[0], after.head.z - tgt[2]) < 0.12 && Math.hypot(after.m[0] - tgt[0], after.m[1] - tgt[2]) < 0.12, 'teleported: head + player on the ring', { tgt, head: [after.head.x, after.head.z], m: after.m });
    chk(Math.abs(after.yaw - before.yaw) < 1e-9, 'facing unchanged', [before.yaw, after.yaw]);
    chk(c1.fade.maxA >= 0.99 && c1.fade.a === 0 && !c1.fade.visible && c1.lastTpMs > 200 && c1.lastTpMs < 700, 'faded fully to black then cleared (~270 ms)', { maxA: c1.fade.maxA, ms: c1.lastTpMs });
    // ---- invalid: outside the room wall ----
    await place(9, 4); await aimArc(12.6, 4); await H.axes(page, 'left', 0, -1); await H.frames(page, 4); let c = await C();
    const red = await E(() => window.__arcade.scene.getObjectByName('vrTpArc').material.color.getHex());
    chk(c.aim && !c.valid && red === 0xff3040, 'aim past the wall: red arc, invalid', { why: c.why, target: c.target });
    const b2 = await rig(); await H.axes(page, 'left', 0, 0); await H.frames(page, 8); const a2 = await rig(); c = await C();
    chk(c.badReleases >= 1 && c.tps === 1 && c.fade.phase === 'idle' && Math.hypot(a2.x - b2.x, a2.z - b2.z) < 1e-6, 'release on red: nothing happens (no fade, no move)', { bad: c.badReleases, fade: c.fade.starts });
    // ---- cancel by pulling back ----
    await place(2, 4); await aimArc(hit.tx, hit.tz); await H.axes(page, 'left', 0, -1); await H.frames(page, 4); await H.axes(page, 'left', 0, 0.8); await H.frames(page, 3); c = await C();
    chk(!c.aim && !c.arc && c.cancels >= 1, 'pull the stick back: cancelled, arc hidden', { cancels: c.cancels });
    await H.axes(page, 'left', 0, 0); await H.frames(page, 6); c = await C(); chk(c.tps === 1, 'no teleport after a cancel');
    // ---- snap turn ----
    await place(2, 4, 0); let r0 = await rig();
    await H.axes(page, 'right', 1, 0); await H.frames(page, 25); let r1 = await rig(); c = await C();
    chk(Math.abs(r1.yaw - (r0.yaw - Math.PI / 6)) < 1e-9 && c.snaps === 1, 'right flick: exactly 30 deg snap (right = clockwise)', { d: (r1.yaw - r0.yaw) * 180 / Math.PI, snaps: c.snaps });
    chk(Math.hypot(r1.head.x - r0.head.x, r1.head.z - r0.head.z) < 0.01, 'snap turns around the head (no drift)', [r0.head, r1.head]);
    chk(c.fade.maxA >= 0.99 && c.lastSnapMs > 120 && c.lastSnapMs < 500 && !c.fade.visible, 'snap has a quick fade and clears (~160 ms)', { ms: c.lastSnapMs });
    await H.frames(page, 20); r1 = await rig(); chk((await C()).snaps === 1, 'holding the stick: still one snap (needs re-centring)');
    await H.axes(page, 'right', 0, 0); await H.frames(page, 3); await H.axes(page, 'right', -1, 0); await H.frames(page, 25); let r2 = await rig();
    chk(Math.abs(r2.yaw - r0.yaw) < 1e-9 && (await C()).snaps === 2, 'centre, then left flick: snaps back 30 deg', { d: (r2.yaw - r1.yaw) * 180 / Math.PI });
    await H.axes(page, 'right', 0, 0); await H.frames(page, 3);
    // ---- fire menu open: no snap ----
    await clickStick('right'); const fmOpen = await E(() => window.__gaVR.fireMenu().open); r0 = await rig();
    await H.axes(page, 'right', 1, 0); await H.frames(page, 20); await H.axes(page, 'right', 0, 0); await H.frames(page, 3); r1 = await rig();
    chk(fmOpen && Math.abs(r1.yaw - r0.yaw) < 1e-9 && (await C()).snaps === 2, 'fire-type menu open: right stick does not snap', { fmOpen, d: r1.yaw - r0.yaw });
    await clickStick('right'); chk(!(await E(() => window.__gaVR.fireMenu().open)), 'right stick click closes the fire menu');
    // ---- left stick click still toggles the wrist HUD ----
    const hh0 = await E(() => window.__gaVR.fireMenu().hudHidden); await clickStick('left'); const hh1 = await E(() => window.__gaVR.fireMenu().hudHidden); await clickStick('left');
    chk(hh0 !== hh1, 'left stick click still toggles the wrist HUD', [hh0, hh1]);
    // ---- the fade always clears ----
    await E(() => window.__gaVR.fadeTest(5000)); await H.frames(page, 3); await sleep(1800); await H.frames(page, 3); c = await C();
    chk(c.fade.phase === 'idle' && !c.fade.visible && c.fade.lastForced === 'timeout', 'a fade that never finishes is forced off after 1.5 s', c.fade);
    // ---- smooth mode via the Y menu ----
    await H.aim(page, 'right', [0.2, 1.2, 0.1], [2, 1.2, 0]);
    await H.press(page, 'left', 'y-button'); await H.frames(page, 6);
    let b = await E(() => window.__gaVR.ui.btns.find(q => q.id === 'move')); chk(!!b && /TELEPORT/.test(b.label), 'Y menu: MOVEMENT: TELEPORT + SNAP TURN', b && b.label);
    let bw = await E(() => window.__gaVR.ui.btnWorld('move')); await H.aim(page, 'right', [0.2, 1.2, 0.1], bw); await H.frames(page, 4); await H.press(page, 'right', 'trigger'); await H.frames(page, 4);
    b = await E(() => window.__gaVR.ui.btns.find(q => q.id === 'move')); c = await C();
    chk(c.mode === 'smooth' && /SMOOTH/.test(b.label) && (await E(() => localStorage.getItem('galacticarcade.vrMove'))) === 'smooth', 'MOVEMENT -> SMOOTH WALK (saved)', b.label);
    await E(() => window.__gaVR.ui.close()); await place(2, 4, 0); const m0 = await rig();
    await H.axes(page, 'left', 0, -1); await H.frames(page, 20); await H.axes(page, 'left', 0, 0); await H.frames(page, 3); const m1 = await rig(); c = await C();
    chk(!c.aim && !c.arc && Math.hypot(m1.m[0] - m0.m[0], m1.m[1] - m0.m[1]) > 0.2, 'smooth mode: left stick walks (no arc)', { moved: Math.hypot(m1.m[0] - m0.m[0], m1.m[1] - m0.m[1]) });
    // ---- a beam clears a fade ----
    await E(() => { window.__tpTimeScale = 4; window.__gaVR.fadeTest(5000); }); await H.frames(page, 2); await E(() => window.__tp.go('shop')); await H.frames(page, 6); c = await C();
    chk(c.fade.phase === 'idle' && !c.fade.visible && c.fade.lastForced === 'beam', 'a beam starting clears the fade at once', c.fade);
    chk(R.errors.length === 0, 'no console errors (VR)', R.errors.slice(0, 4));
    // ---- reload: smooth persists, flat OPTIONS shows it, back to teleport from OPTIONS ----
    await page.reload(); await page.waitForFunction(() => window.__arcade && window.__arcade.stats.frames > 3, null, { timeout: 90000 });
    await page.waitForFunction(() => !!document.getElementById('opMove'), null, { timeout: 20000 });
    let fl = await E(() => ({ mode: window.__gaMove && window.__gaMove.mode, txt: document.getElementById('opMove').textContent }));
    chk(fl.mode === 'smooth' && /SMOOTH/.test(fl.txt), 'after a reload: still SMOOTH (VR + flat OPTIONS)', fl);
    await page.click('#bOpt'); await page.waitForSelector('#opMove', { state: 'visible' }); await page.click('#opMove'); await page.click('#opX').catch(() => {});
    fl = await E(() => ({ mode: window.__gaMove.mode, txt: document.getElementById('opMove').textContent, ls: localStorage.getItem('galacticarcade.vrMove') }));
    chk(fl.mode === 'teleport' && /TELEPORT/.test(fl.txt) && fl.ls === 'teleport', 'flat OPTIONS: VR MOVEMENT -> TELEPORT', fl);
    chk(R.errors.length === 0, 'no console errors (after reload)', R.errors.slice(0, 4));
    await R.close();
    // ---- ?oldmove=1 ----
    R = await openVR({ w: 480, h: 270, qs: '?nowarm=1&noveil=1&oldmove=1' }); page = R.page;
    await page.waitForFunction(() => document.getElementById('vrBtn') && document.getElementById('vrBtn').classList.contains('on'), null, { timeout: 20000 });
    await page.click('#vrBtn'); await page.waitForFunction(() => window.__gaVR.presenting && window.__gaVR.posed && !(window.__gaVR.veil && window.__gaVR.veil.on), null, { timeout: 30000 });
    await place(2, 4, 0); const o0 = await rig();
    await H.axes(page, 'right', 1, 0); await H.frames(page, 20); await H.axes(page, 'right', 0, 0); await H.axes(page, 'left', 0, -1); await H.frames(page, 20); await H.axes(page, 'left', 0, 0); await H.frames(page, 3);
    const o1 = await rig(); c = await C(); await H.press(page, 'left', 'y-button'); await H.frames(page, 6); b = await E(() => window.__gaVR.ui.btns.find(q => q.id === 'move'));
    const sm = Math.abs(o1.yaw - o0.yaw) > 0.05 && Math.abs(Math.abs(o1.yaw - o0.yaw) - Math.PI / 6) > 1e-3;
    chk(c.mode === 'old' && c.snaps === 0 && c.aims === 0 && sm && Math.hypot(o1.m[0] - o0.m[0], o1.m[1] - o0.m[1]) > 0.2 && !b && (await E(() => getComputedStyle(document.getElementById('opMove')).display)) === 'none', '?oldmove=1: smooth turn + smooth walk, no MOVEMENT options', { yaw: o1.yaw - o0.yaw, snaps: c.snaps });
    chk(R.errors.length === 0, 'no console errors (?oldmove=1)', R.errors.slice(0, 4));
  } catch (e) { chk(false, 'exception ' + (e && e.stack || e)); }
  await R.close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})();
