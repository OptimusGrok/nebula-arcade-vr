// Nebula Arcade - cabinet music (drop-in kit; built by the Chief for Arcade to wire in).
// ONE player for both cases, so demo music and proximity music can never double up:
//   * walk mode: the nearest cabinet within RADIUS of the monkey plays its loop; the room track ducks (via __cabMusic.duck)
//   * cabinet DEMO view (play.mode 'game', sub 'demo'): that cabinet's loop plays (the game copies' demos are silent)
//   * playing a game, zooming, start screen, tab hidden, MUSIC off (window.__music.on === false): silent
// Crossfade (vrtest-v10, Chief's test-v5 fix 346a85b): the next track is fetched + decoded FIRST, then both ramps overlap for FADE s, so a
// walk-up never goes silent and never restarts mid-note; the outgoing buffer is freed after its fade (one decoded song once settled, t911u).
// Picking sticks to the current cabinet while you are still in its range (no retrigger walking a tight row) with a 1.4 s minimum play time.
// Room music hook: music.js multiplies its target by (1 - window.__cabMusic.duck)  (see INTEGRATION.md).
(function () {
  var VOL = 0.38, FADE = 0.6, RADIUS = 2.8, HYST = 0.5, MAX_CACHE = 1,   // TEST v1 (VR memory): only the current loop stays decoded (was 3)
      BASE = '';
  // t771u: strike = the game's own stage-1 track (HC 's1', 155 bpm), rendered offline from strike-play's engine: one pass of its
  // 48-bar loop (after the intro), seamless. The other loops are kit compositions (cabinet-kit/audio/gen.py), not the games' music.
  // exact loop lengths (samples) let us skip mp3 encoder padding like music.js does; berserker reuses its own title music
  var TRACKS = {
    strike: { src: 'audio/cab_strike.mp3', samples: 1638813, rate: 22050 }, monkey: { src: 'audio/cab_monkey.mp3', samples: 355560, rate: 22050 },
    nova: { src: 'audio/cab_nova.mp3', samples: 357443, rate: 22050 }, cyber: { src: 'audio/cab_cyber.mp3', samples: 357443, rate: 22050 },
    orc: { src: 'audio/cab_orc.mp3', samples: 357443, rate: 22050 }, ghost: { src: 'audio/cab_ghost.mp3', samples: 357443, rate: 22050 },
    roadster: { src: 'audio/cab_roadster.mp3', samples: 294000, rate: 22050 }, ds: { src: 'audio/cab_ds.mp3', samples: 353678, rate: 22050 },
    blaster: { src: 'audio/cab_blaster.mp3', samples: 264600, rate: 22050 }, pip: { src: 'audio/cab_pip.mp3', samples: 291060, rate: 22050 },
    claw: { src: 'audio/cab_claw.mp3', samples: 384873, rate: 22050 }, bb: { src: 'audio/cab_bb.mp3', samples: 357443, rate: 22050 },
    berserker: { src: 'audio/cab_berserker.mp3', vol: 0.3 },
    // vrtest-v8 (Dave t466u): bb, cyber, ds, ghost, monkey, nova, orc, pip and skytower are now Chief's tracks from the normal link (v255,
    // the games' own music recorded by his tools/render_cab_music.js); strike, blaster, claw, roadster, berserker already were. Chief has no
    // Rockfall track (his stays silent), so Rockfall keeps the vrtest-v5 loop.
    // vrtest-v5 (t458u): Rockfall Rush and Sky Tower had no entry here, so positions() skipped their cabinets and walking up was silent
    rockfall: { src: 'audio/cab_rockfall.mp3', samples: 311294, rate: 22050 }, skytower: { src: 'audio/cab_skytower.mp3', samples: 355560, rate: 22050 }
  };
  var C = window.__cabMusic = { tracks: TRACKS, want: null, cur: null, duck: 0, fades: 0, loads: 0, starts: 0, maxSources: 0, radius: RADIUS, err: null };
  var ac = null, out = null, node = null, ng = null, curKey = null, cache = {}, order = [], pending = {}, pos = null, lastNear = null, live = 0;
  var pendingKey = null, switchId = 0, holdUntil = 0, HOLD = 1400, STICK = 0.7;
  function ctx() { if (!ac) { ac = window.__unlockAC || new (window.AudioContext || window.webkitAudioContext)(); window.__unlockAC = ac; if (ac.state === 'suspended') ac.resume(); out = ac.createGain(); out.gain.value = 1; out.connect(ac.destination); }
    else if (!out) { out = ac.createGain(); out.gain.value = 1; out.connect(ac.destination); } return ac; }
  function remember(k, buf) {
    cache[k] = buf; if (order.indexOf(k) < 0) order.push(k);
    // keep the playing and incoming buffers; evict everything else so we stay at one song after handover
    var keep = {}; keep[curKey] = 1; keep[C.want] = 1; keep[pendingKey] = 1; keep[k] = 1; var next = [];
    for (var i = 0; i < order.length; i++) { var o = order[i]; if (keep[o] && next.indexOf(o) < 0) next.push(o); else if (!keep[o]) { delete cache[o]; C.drops = (C.drops || 0) + 1; } }
    order = next;
  }
  function evictKey(k) {
    if (!k || k === curKey || k === C.want || k === pendingKey || !cache[k]) return;
    delete cache[k]; var i = order.indexOf(k); if (i >= 0) order.splice(i, 1); C.drops = (C.drops || 0) + 1;
  }
  function load(k) {
    if (cache[k]) return Promise.resolve(cache[k]); if (pending[k]) return pending[k]; var t = TRACKS[k]; if (!t) return Promise.reject('no track ' + k);
    C.loads++;
    return pending[k] = fetch(BASE + t.src).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.src); return r.arrayBuffer(); })
      .then(function (b) { return new Promise(function (ok, no) { ctx().decodeAudioData(b, ok, no); }); })
      .then(function (buf) { delete pending[k]; remember(k, buf); return buf; })
      .catch(function (e) { delete pending[k]; C.err = String(e && e.message || e); throw e; });
  }
  function fadeOutNode(n, g, oldKey) {
    if (!n || !g) return;
    var t = ctx().currentTime; try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + FADE); } catch (e) {}
    C.fades++;
    setTimeout(function () { try { n.stop(); } catch (e) {} try { n.disconnect(); g.disconnect(); } catch (e) {} live = Math.max(0, live - 1); evictKey(oldKey); }, FADE * 1000 + 40);
  }
  function fadeOut() {
    if (!node) { curKey = null; C.cur = null; return; }
    var n = node, g = ng, oldKey = curKey; node = null; ng = null; curKey = null; C.cur = null;
    fadeOutNode(n, g, oldKey);
  }
  function fadeIn(k, buf) {
    var t = TRACKS[k], a = ctx(), n = a.createBufferSource(), g = a.createGain(); n.buffer = buf; n.loop = true;
    if (t.samples) { var len = t.samples * buf.sampleRate / t.rate, extra = buf.length - len, lead = extra >= 1105 ? Math.min(extra, 1105) : 0;   // 529+576 (mp3 priming)
      var start = lead / buf.sampleRate, end = start + len / buf.sampleRate;
      if (end > 0 && end <= buf.duration + 1e-4) { n.loopStart = start; n.loopEnd = Math.min(end, buf.duration); } }   // never a loop end past the buffer
    g.gain.value = 0; n.connect(g); g.connect(out);
    if (a.state === 'suspended') a.resume();
    n.start(0, n.loopStart || 0); var now = a.currentTime; g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(t.vol || VOL, now + FADE);
    node = n; ng = g; curKey = k; C.cur = k; C.starts++; C.fades++; live++; C.maxSources = Math.max(C.maxSources, live);
  }
  function apply(k) {
    if (k && k === curKey && node) { pendingKey = null; return; }
    if (k && k === pendingKey) return;
    if (!k) { pendingKey = null; switchId++; if (node) fadeOut(); return; }
    pendingKey = k; var id = ++switchId;
    load(k).then(function (buf) {
      if (id !== switchId || C.want !== k) return;
      if (k === curKey && node) { pendingKey = null; return; }
      var oldN = node, oldG = ng, oldKey = curKey;
      node = null; ng = null;   // fadeIn assigns the new source; the old one fades out in parallel (no silent gap)
      fadeIn(k, buf); pendingKey = null;
      if (oldN) fadeOutNode(oldN, oldG, oldKey);
    }).catch(function () { if (id === switchId) pendingKey = null; });
  }
  // cabinet positions (stand-in-front point) per play.js machine key; cabinets never move, so this is built once
  function positions(A) {
    if (pos) return pos; var P = A.play, M = P && P.machines; if (!M) return null; pos = [];
    for (var k in M) { var c = M[k].cab; if (!c || !TRACKS[k]) continue; var u = c.userData || {}, p = u.front ? { x: u.front.x, z: u.front.z } : (function () { var v = new A.THREE.Vector3(); c.getWorldPosition(v); return { x: v.x, z: v.z }; })();
      var n = u.inward && (u.inward.x || u.inward.z) ? { x: u.inward.x, z: u.inward.z } : null;
      pos.push({ k: k, x: p.x, z: p.z, nx: n ? n.x : 0, nz: n ? n.z : 0 }); if (k === 'roadster' && u.frontR) pos.push({ k: k, x: u.frontR.x, z: u.frontR.z }); }
    return pos;
  }
  C.setPositions = function (list) { pos = list; };   // [{k,x,z}] override (tests / other rooms)
  // vrtest-v5 (t458u): "some don't play their own music when approaching": side-by-side cabinets (strike/ghost, pip/bb, cyber/claw) have front
  // points ~1.5 m apart, so walking straight up to one you heard its NEIGHBOUR until 2 m out. Distance is now facing-aware: sideways offset
  // (across the cabinet's facing) counts 1.8x, so the cabinet you are walking up to wins. Cabinets without a facing use plain distance.
  // plus the way you face (VR: your head, flat: the monkey): a cabinet straight ahead counts as is, one beside you 1.25x, behind you 1.5x
  var fx = 0, fz = 0;
  function dist(p, x, z) { var dx = x - p.x, dz = z - p.z, d; if (!p.nx && !p.nz) d = Math.hypot(dx, dz); else { var along = dx * p.nx + dz * p.nz, side = dx * p.nz - dz * p.nx; d = Math.hypot(side * 1.8, along); }
    if (fx || fz) { var cx = p.x - (p.nx || 0) * 1.2 - x, cz = p.z - (p.nz || 0) * 1.2 - z, L = Math.hypot(cx, cz) || 1; d *= 1.25 - 0.25 * ((cx * fx + cz * fz) / L); } return d; }
  C.nearest = function (x, z, yaw) { if (yaw != null) { fx = -Math.sin(yaw); fz = -Math.cos(yaw); } else fx = fz = 0; var best = null, bd = Infinity, lastD = Infinity;
    (pos || []).forEach(function (p) { var d = dist(p, x, z); if (d < bd) { bd = d; best = p.k; } if (lastNear && p.k === lastNear && d < lastD) lastD = d; });
    // vrtest-v10 (346a85b): stay on the current cabinet while still inside its radius + hysteresis, unless another is clearly (STICK m) nearer
    if (lastNear && lastD <= RADIUS + HYST) { if (best && best !== lastNear && bd < lastD - STICK) return best; return lastNear; }
    var r = RADIUS + (best && best === lastNear ? HYST : 0); return bd <= r ? best : null; };
  function wanted() {
    var A = window.__arcade, S = window.__start, M = window.__music;
    if (window.__gaHoldAV || !A || !A.play || document.hidden || (M && M.on === false) || (document.getElementById('start') && !(S && S.dismissed))) return null;
    var P = A.play;
    if (P.mode === 'game') return P.sub === 'demo' && P.cur && TRACKS[P.cur.key] ? P.cur.key : null;
    if (P.mode !== 'walk' || !positions(A)) return null;
    var m = A.monkey.position, yaw = A.st && typeof A.st.yaw === 'number' ? A.st.yaw : null, k = C.nearest(m.x, m.z, yaw), now = performance.now();
    if (k && lastNear && k !== lastNear && now < holdUntil) {   // 346a85b: minimum play time, unless you have left the last cabinet's range
      var stay = Infinity; (pos || []).forEach(function (p) { if (p.k === lastNear) stay = Math.min(stay, dist(p, m.x, m.z)); });
      if (stay <= RADIUS + HYST) k = lastNear; }
    if (k && k !== lastNear) holdUntil = now + HOLD;
    lastNear = k; return k;
  }
  // vrtest-v4 (t911u port): one song at a time. Besides the drop when a loop fades out (above), anything still cached is freed once no
  // cabinet has wanted music for 1 s (a decode that finished after you walked on), so at most one cabinet AudioBuffer stays decoded.
  var idleSince = 0;
  function evictIdle() { Object.keys(cache).forEach(function (key) { evictKey(key); }); if (!curKey && !C.want && !pendingKey) { cache = {}; order = []; } }
  function tick() {
    var k = null; try { k = wanted(); } catch (e) { C.err = String(e); }
    C.want = k; apply(k);
    C.bufCount = Object.keys(cache).length; C.cached = Object.keys(cache);
    if (!k && !curKey) { idleSince = idleSince || performance.now(); if (performance.now() - idleSince > 1000) evictIdle(); } else idleSince = 0;
    // duck the room track while a cabinet loop is (or is about to be) playing in walk mode; in game mode music.js is already at 0
    var target = k ? 1 : 0; C.duck += (target - C.duck) * 0.5; if (C.duck < 0.01) C.duck = 0; if (C.duck > 0.99) C.duck = 1;
  }
  C.tick = tick; setInterval(tick, 120); document.addEventListener('visibilitychange', tick);
})();
