// v16 (t399u, Dave): NEON KNOCKOUT in the arcade's own XR session (no page reload). The SW pad's NEON KNOCKOUT label beams there,
// the studio's gloves ride the arcade controllers (their models + rays hidden), punching the START / difficulty orbs, calibration from the
// headset height, punches hit orbs, ducking under a bar by lowering the headset dodges it, results pay tickets, BEAM TO ARCADE goes back.
const { openVR, H, IWER_SRC, SETUP, HEADSET_FB } = require('./vrlib');
(async () => {
  let ok = true; const chk = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
  const { page, errors, close } = await openVR({ init: { content: IWER_SRC + SETUP + HEADSET_FB } });
  const E = (f, a) => page.evaluate(f, a), until = (f, ms = 30000, arg) => page.waitForFunction(f, arg, { timeout: ms });
  const place = async (x, z, yaw = 0) => { await E(([x, z, yaw]) => { const S = window.__gaVR; S.rig = { x, y: 0, z, yaw }; S.applyRig(); window.__arcade.monkey.position.set(x, 0, z); }, [x, z, yaw]); await H.frames(page, 6); };
  const aimPress = async (target, hand = 'right') => { await H.aim(page, hand, [0.2, 1.3, -0.2], target); await H.frames(page, 3); await H.press(page, hand, 'trigger'); };
  const sign = id => E(id => { const s = window.__gaVR.signs().find(q => q.id === id); return s ? s.at : null; }, id);
  // put a controller at a WORLD position (rig-local for IWER)
  const ctrlAt = (hand, w) => E(([hand, w]) => { const r = window.__gaVR.rig, c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = w[0] - r.x, dz = w[2] - r.z;
    const C = window.__xrd.controllers[hand]; C.position.set(c * dx - s * dz, w[1] - r.y, s * dx + c * dz); C.quaternion.set(0, 0, 0, 1); }, [hand, w]);
  const punchAt = async (hand, w) => { for (const k of [0.45, 0.3, 0.15, 0, -0.12]) { await ctrlAt(hand, [w[0], w[1], w[2] + k]); await H.frames(page, 1); } await ctrlAt(hand, [w[0] + (hand === 'left' ? -0.3 : 0.3), w[1] - 0.3, w[2] + 0.5]); await H.frames(page, 2); };
  const vis = () => E(() => { const sc = window.__arcade.scene, g = [0, 1].map(i => sc.getObjectByName('vrGrip' + i)).filter(Boolean), rays = [0, 1].map(i => { const c = sc.getObjectByName('vrController' + i); return c && c.userData.ray ? c.userData.ray.visible : null; });
    return { models: g.map(x => !!((x.userData.fallback && x.userData.fallback.visible) || (x.userData.model && x.userData.model.visible))), rays }; });
  try {
    await E(() => { localStorage.removeItem('gaNK.scores'); localStorage.removeItem('gaNK.dailyDone'); window.__arcade.play.tickets.total = 100; window.__tpTimeScale = 3; });
    await until(() => document.getElementById('vrBtn').classList.contains('on'), 20000); await until(() => window.__gaVR.prewarm.done, 180000);
    await page.click('#vrBtn'); await until(() => window.__gaVR.presenting && window.__gaVR.posed, 30000);
    const pad = await E(() => [window.__tp.PAD1.x, window.__tp.PAD1.z]);
    const pad4 = await E(() => [window.__tp.PAD4.x, window.__tp.PAD4.z]);
    await place(pad[0] + 2.2, pad[1] + 2.2, Math.PI / 4);
    const sShop = await sign('beamShop');
    chk(!!sShop, 'SHOP pad label is the shop beam target ' + JSON.stringify(sShop && sShop.map(v => +v.toFixed(2))));
    await place(pad4[0] + 2.2, pad4[1] - 2.2, 3 * Math.PI / 4);
    const sg = await sign('beamNK');
    chk(!!sg, 'NEON KNOCKOUT pad label is the beam target ' + JSON.stringify(sg && sg.map(v => +v.toFixed(2))));
    chk(await E(() => !!window.__nkGame && window.__gaVR.prewarm.done), 'v18: on a headset the studio is loaded + pre-warmed in the background before the first beam');
    await aimPress(sg);
    await until(() => window.__tp.where === 3 && window.__tp.state === 'idle' && window.__nkGame && window.__nkGame.inStudio, 90000); await H.frames(page, 8);
    let s = await E(() => { const S = window.__gaVR, P = window.__tp.PAD3; return { pres: S.presenting, head: S.head && [S.head.x, S.head.z], P: [P.x, P.z], reloads: performance.getEntriesByType('navigation').length }; });
    chk(s.pres && Math.hypot(s.head[0] - s.P[0], s.head[1] - s.P[1]) < 0.6, 'beamed to the studio inside the same XR session (head on the studio pad) ' + JSON.stringify(s));
    const hs = await E(() => window.__hsRead && window.__hsRead()); chk(hs && hs.left.lit > 2, 'the headset shows the neon studio (lit ' + (hs && hs.left.lit) + '%)');
    // gloves on the controllers, controller models hidden; rays still there for the menu
    await H.aim(page, 'left', [-0.2, 1.1, -0.35], [0, 1, -5]); await H.aim(page, 'right', [0.2, 1.1, -0.35], [0, 1, -5]); await H.frames(page, 4);
    s = await E(() => { const N = window.__nkGame, sc = window.__arcade.scene, T = window.__arcade.THREE, out = {}; for (const [k, h] of [['L', 'left'], ['R', 'right']]) { const S = window.__gaVR, gp = S.nkGrip(h); const gw = gp.obj.getWorldPosition(new T.Vector3()); out[k] = { vis: N.gloves[k].visible, d: +N.gloves[k].getWorldPosition(new T.Vector3()).distanceTo(gw).toFixed(3) }; } return out; });
    chk(s.L.vis && s.R.vis && s.L.d < 0.06 && s.R.d < 0.06, 'boxing gloves ride the controllers ' + JSON.stringify(s));
    let v = await vis(); chk(v.models.every(m => !m), 'controller models hidden in the studio (the gloves replace them) ' + JSON.stringify(v));
    // v23 (Dave t421u): the menu orbs sit at the far end of the ground circle (studio -Z, 1.25 m) and stay put when the head moves
    const orbsAt = () => E(() => { const N = window.__nkGame, T = window.__arcade.THREE, root = window.__arcade.scene.getObjectByName('nkStudio'), o = {};
      for (const id of ['start', 'easy', 'normal', 'beast', 'daily', 'gloves']) { const w = N.orbWorld(id), l = root.worldToLocal(w.clone()); o[id] = [+l.x.toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3)]; } return o; });
    const oa = await orbsAt(); const P3s = await E(() => [window.__tp.PAD3.x, window.__tp.PAD3.z]);
    await place(P3s[0] + 0.9, P3s[1] - 1.1, 0.7); await H.frames(page, 10); const ob = await orbsAt(); await place(P3s[0], P3s[1], 0); await H.frames(page, 6);
    chk(Math.abs(oa.start[2] - (-1.25)) < 0.02 && Math.abs(oa.start[0]) < 0.02 && JSON.stringify(oa) === JSON.stringify(ob), 'menu orbs locked to the far end of the ground circle (START at z ' + oa.start[2] + ' m), not following the head', { oa, ob });
    // punch the BEAST orb, then START
    await H.aim(page, 'right', [0.2, 1.1, 0.1], [0, 1, -5]); await H.frames(page, 3);
    let w = await E(() => window.__nkGame.orbWorld('beast').toArray()); await punchAt('left', w);
    chk((await E(() => window.__nkGame.state.diff)) === 'beast', 'punching the BEAST orb picks BEAST');
    w = await E(() => window.__nkGame.orbWorld('normal').toArray()); await H.frames(page, 20); await punchAt('left', w);
    chk((await E(() => window.__nkGame.state.diff)) === 'normal', 'punching NORMAL picks NORMAL');
    await H.frames(page, 20); w = await E(() => window.__nkGame.orbWorld('start').toArray()); await punchAt('right', w);
    s = await E(() => { const N = window.__nkGame; return { mode: N.state.mode, vr: N.state.vr, headH: N.state.headH, bpm: N.BPM }; });
    chk(s.mode === 'play' && s.vr && Math.abs(s.headH - 1.6) < 0.08, 'punching START starts a VR round, calibrated to the headset height ' + JSON.stringify(s));
    v = await vis(); chk(v.rays.every(r => !r) && v.models.every(m => !m), 'during the round: no pointer rays, no controller models ' + JSON.stringify(v));
    // punch orbs as they arrive; duck under bars
    const t0 = Date.now(); let dodged = 0;
    while (Date.now() - t0 < 150000) {
      const st = await E(() => { const N = window.__nkGame; return { t: N.state.t, hits: N.state.hits, dodges: N.state.dodges, tw: N.targetsW(), bars: N.bars() }; });
      if (st.hits >= 4 && st.dodges >= 1) break;
      const bar = st.bars.find(d => d > 0 && d < 0.6);
      if (bar != null) { await E(() => { window.__xrd.position.y = 1.15; }); await H.frames(page, 2); while ((await E(() => window.__nkGame.bars().some(d => d > -0.05)))) await H.frames(page, 2); await E(() => { window.__xrd.position.y = 1.6; }); continue; }
      const t = st.tw.find(t => t.dt < 0.25 && t.dt > -0.3 && t.type !== 'C') || st.tw.find(t => t.dt < 0.25 && t.dt > -0.3);
      if (t) await punchAt(t.type === 'R' ? 'right' : 'left', t.p); else await H.frames(page, 1);
    }
    s = await E(() => { const st = window.__nkGame.state; return { t: +st.t.toFixed(1), hits: st.hits, misses: st.misses, dodges: st.dodges, bumps: st.bumps, score: st.score }; });
    chk(s.hits >= 4, 'VR punches hit the orbs ' + JSON.stringify(s));
    chk(s.dodges >= 1, 'lowering the headset under a red bar dodges it');
    // v23 (Dave t421u): B / Y pauses the round (was GRIP; GRIP now does nothing): RESUME / RESET GAME / EXIT GAME
    const btnAt = id => E(id => window.__gaVR.ui.btnWorld(id), id);
    const pst = () => E(() => { const N = window.__nkGame, S = window.__gaVR; return { mode: N.state.mode, paused: !!N.state.paused, t: +N.state.t.toFixed(3), panel: S.state().panel, btns: S.ui.btns.map(b => b.id), tix: window.__arcade.play.tickets.total, hits: N.state.hits, aborts: N.state.aborts || 0, lastAbort: N.state.lastAbort || null }; });
    const tk0 = await E(() => window.__arcade.play.tickets.total);
    await H.press(page, 'right', 'squeeze'); await H.press(page, 'left', 'squeeze'); await H.frames(page, 4);
    let p0 = await pst(); chk(p0.mode === 'play' && !p0.paused && !p0.panel, 'GRIP does nothing in a Neon Knockout round', p0);
    await H.press(page, 'right', 'b-button'); await H.frames(page, 4);   // vrtest-v23 (Dave t510u): B no longer pauses / opens a menu in NK
    let pb = await pst(); chk(pb.mode === 'play' && !pb.paused && !pb.panel, 'vrtest-v23: B does nothing in a Neon Knockout round (Y only)', pb);
    await H.press(page, 'left', 'y-button'); await H.frames(page, 4);
    let p1 = await pst(); v = await vis();
    chk(p1.mode === 'play' && p1.paused && p1.panel === 'nkPause' && ['nkResume', 'nkReset', 'nkExit'].every(b => p1.btns.includes(b)) && v.rays.some(r => r), 'Y pauses: PAUSED panel with RESUME / RESET GAME / EXIT GAME, pointer rays back ' + JSON.stringify({ p1, rays: v.rays }));
    await H.frames(page, 40); let p2 = await pst();
    chk(p2.t === p1.t && p2.paused && p2.hits === p1.hits, 'while paused the round clock stands still ' + JSON.stringify([p1.t, p2.t]));
    await aimPress(await btnAt('nkResume')); await H.frames(page, 30); p2 = await pst(); v = await vis();
    chk(p2.mode === 'play' && !p2.paused && !p2.panel && p2.t > p1.t && v.rays.every(r => !r), 'RESUME: panel gone, the round runs on, rays hidden again ' + JSON.stringify({ p2, rays: v.rays }));
    await H.press(page, 'left', 'y-button'); await H.frames(page, 4); p1 = await pst();
    chk(p1.paused && p1.panel === 'nkPause' && p1.btns.includes('nkScenery'), 'Y pauses again (pause panel has SCENERY too)', p1.btns);
    await aimPress(await btnAt('nkReset')); await H.frames(page, 4); p2 = await pst();
    chk(p2.mode === 'play' && !p2.paused && !p2.panel && p2.t < 1 && p2.hits === 0 && p2.tix === tk0, 'RESET GAME: a fresh round from 0:00, no tickets for the abandoned one ' + JSON.stringify(p2));
    await H.press(page, 'left', 'y-button'); await H.frames(page, 4); await H.press(page, 'left', 'y-button'); await H.frames(page, 4); p2 = await pst();
    chk(p2.mode === 'play' && !p2.paused && !p2.panel, 'Y again while paused = resume ' + JSON.stringify(p2));
    const t1 = await E(() => window.__arcade.play.tickets.total);
    await E(() => { const N = window.__nkGame; N.skipTo(N.state.lastT - 0.5); }); await until(() => window.__nkGame.state.mode === 'results', 30000); await H.frames(page, 3);
    s = await E(() => ({ r: window.__nkGame.state.result, t: window.__arcade.play.tickets.total, c: window.__nkGame.dbgPanel }));
    chk(s.r && s.t === t1 + s.r.tix, 'round complete in VR: grade ' + s.r.grade + ', +' + s.r.tix + ' tickets');
    v = await vis(); chk(v.rays.some(r => r), 'after the round the pointer rays are back (signs / menus)');
    // back to the arcade with the studio pad's sign
    const P3 = await E(() => [window.__tp.PAD3.x, window.__tp.PAD3.z]); await place(P3[0] - 1.6, P3[1] - 1.6, Math.PI * 1.25);
    const sb = await sign('beamArcadeNK'); chk(!!sb, 'BEAM TO ARCADE sign over the studio pad');
    if (sb) await aimPress(sb);
    await until(() => window.__tp.where === 1 && window.__tp.state === 'idle', 90000); await H.frames(page, 8);
    v = await vis(); s = await E(() => ({ g: window.__nkGame.gloves.L.visible || window.__nkGame.gloves.R.visible, pres: window.__gaVR.presenting }));
    chk(s.pres && !s.g && v.models.every(m => m), 'back in the arcade (still in VR): gloves gone, controller models back ' + JSON.stringify(v));
    // v17: EXIT GAME mid-round -> back to the arcade, no tickets
    await place(pad4[0] + 2.2, pad4[1] - 2.2, 3 * Math.PI / 4); await aimPress(await sign('beamNK'));
    await until(() => window.__tp.where === 3 && window.__tp.state === 'idle' && window.__nkGame.inStudio, 90000); await H.frames(page, 8);
    await E(() => window.__nkGame.startRound()); await H.frames(page, 30);
    const tk1 = await E(() => window.__arcade.play.tickets.total);
    await H.press(page, 'left', 'y-button'); await H.frames(page, 4);
    await aimPress(await btnAt('nkExit'));
    await until(() => window.__tp.where === 1 && window.__tp.state === 'idle', 90000); await H.frames(page, 8);
    const p3 = await pst(); v = await vis();
    chk(p3.mode !== 'play' && !p3.paused && !p3.panel && p3.lastAbort === 'exit' && p3.tix === tk1 && v.models.every(m => m), 'EXIT GAME: beams back to the arcade, round dropped, no tickets, controllers back ' + JSON.stringify({ p3, tk1, v }));
  } catch (e) { chk(false, 'exception ' + (e && e.stack || e).toString().slice(0, 600)); }
  const errs = errors.filter(e => !/supabase|ERR_FAILED|net::/i.test(e)); chk(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})();
