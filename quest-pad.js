// t856u / v237 … t864u / v241 + t865u / v242: Quest 2D thumbstick support.
// Research (Meta Browser specs, Meta input mappings, WebXR issues #995/#1347, Chromium wheel routing):
//  - In 2D Quest Browser the thumbstick is a SCROLL device (like a mouse wheel), not a Gamepad.
//    XR controllers are typically exposed via getGamepads() only inside a WebXR session.
//  - Desktop mode is the default; meta viewport tags (user-scalable=no) are IGNORED, so the
//    "zoom in/out" Dave saw is likely browser pinch-zoom (visualViewport.scale) or page zoom
//    (devicePixelRatio), not the arcade camera. Chromium can turn an unconsumed wheel into
//    EventAction kPageZoom when nothing is scrollable. This page used overflow:hidden, so
//    there was no scroll target.
//  - wheel may never reach JS (compositor scroll / only first event cancelable). A scrollable
//    sentinel + visualViewport/gesture/pinch/key fallbacks are needed.
//  - v240: do NOT make html/body overflow:scroll or inject a 300vw spacer — that recentres
//    the document and can slide position:fixed #start off-screen. Do NOT style all canvases
//    as fullscreen (that blew #gaCv, the start-screen player preview, over the PLAY button).
//    Isolated #gaQscroll sentinel only; pin only the room canvas (body > canvas) behind #start.
//  - v241 (Dave's Quest 3 ?qdbg=1 photo): wheel events ARRIVE (count + last dx/dy) but src stays
//    none, move stays 0, age stays "-". Cause: the controller ray fires pointermove/touch
//    (pointerType "touch") continuously, so lastDrag never goes stale and onWheel returns
//    before ingest(). On Quest, wheel always drives movement unless a real 2-finger pinch is
//    happening right now. Start-screen gate checks #start visibility directly.
//  - v242: official Meta mapping is "thumbstick = scroll" for either controller; there is no
//    documented left/right split in 2D Browser. Dave's left stick is plain wheel in 37.5
//    steps (no ctrl). Analog speed = events-per-second × |delta|, smoothed, clamped.
//    Fallback: plain wheel/scroll = walk (keeps the working left stick). ctrl/meta+wheel,
//    gesture, and visualViewport scale (the Chromium zoom channel) = camera look. A small
//    STICK LOOK toggle routes plain wheel to look if the right stick is also unmodded.
//    ?qdbg=1 logs deltaMode, modifiers, rate, pointer id/type, and clientX/Y so a right-
//    stick photo can confirm or refute the zoom-channel guess.
//  - An "Enter VR controls" WebXR session is NOT added: immersive-vr would leave the 2D arcade,
//    and Dave's overlay confirms getGamepads()=0 in 2D even though xr vr=true. Flag support
//    in ?qdbg=1 instead.
// VR edition v9 (t368u, Dave on a real Quest 3: "both left and right controllers are moving the player"):
//  - Both thumbsticks arrive as the same plain wheel scroll, so every wheel used to walk. Each stick event is now CLASSIFIED (move = left,
//    look = right) by, in order: the STICK LOOK toggle; ctrl/meta/alt (zoom channel); a saved STICK SETUP calibration (Dave holds the left
//    stick, then the right one; whatever differs between them - the controller ray the scroll lands on, screen side, channel, deltaMode,
//    step size - becomes the rule); the two-ray rule (each controller's ray sends its own pointer events: a wheel landing on the ray that
//    is further RIGHT on screen is the right stick); gamepads with handedness if the browser ever exposes them; else walk.
//  - ?qdbg=1 lists the last stick events (raw wheel dx/dy/dz/mode/modifiers/x,y, matched ray id, class + reason), every ray seen,
//    gamepads (id/hand/axes) and the calibration.
(function (root) {
  'use strict';
  var DEAD = 0.18;
  var AXIS_SCALE = 80;
  var HOLD = 150;
  var FADE = 80;
  var ANALOG_WIN = 100;
  var REF_PXPS = 2200;
  var cssOn = false, listenOn = false, loopOn = false, keyListenOn = false, keysOn = {};
  var lastDrag = 0, lastWheelEvt = 0, lastIngestAt = 0, lastIngestSrc = 'none', touchCount = 0, lastTouchAt = 0;
  var virtX = 0, virtY = 0, lookVX = 0, lookVY = 0, lastLookAt = 0;
  var lastWheelDx = 0, lastWheelDy = 0, lastWheelCtrl = false, lastWheelShift = false, lastWheelMode = 0;
  var lastWheelCX = 0, lastWheelCY = 0, lastRate = 0, lastPxps = 0, lastChan = 'move';
  var moveHist = [], lookHist = [], lookToggle = false, lookBtn = null;
  var lastPtr = { id: null, type: '', x: 0, y: 0, buttons: 0, t: 0 };
  var heldKeys = Object.create(null);
  var dbgEl = null, dbgOn = false, unlocked = false, recentring = false;
  var sentinel = null, midSX = 0, midSY = 0;
  var lastScale = 1, lastVvX = 0, lastVvY = 0, pinchDist0 = 0, gestureScale0 = 1;
  var lastWheelStamp = 0;
  // t377u: last wheel time PER CHANNEL. The scroll / visualViewport fallbacks only drop an event as a duplicate of a wheel on the SAME
  // channel; before, any wheel (the left stick walking) muted the other channel for 50 ms at a time, so the camera could not turn while walking.
  var lastWheelAt = { move: 0, look: 0 };
  function dupOf(look, now) { return now - lastWheelAt[look ? 'look' : 'move'] < 50; }
  var counts = { wheel: 0, mousewheel: 0, scroll: 0, vvresize: 0, vvscroll: 0, gesture: 0, touch: 0, pinch: 0, key: 0, gamepad: 0, pointer: 0 };
  var xrInfo = { inline: null, 'immersive-vr': null, 'immersive-ar': null };

  function isQuest() {
    if (root.__gaForceQuest) return true;
    try {
      var ua = navigator.userAgent || '';
      return /OculusBrowser/i.test(ua) || /\bQuest\b/i.test(ua);
    } catch (e) { return false; }
  }

  function startUp() {
    // v241: trust whether #start is actually on screen, not only __start.shown
    // (that flag can lag or stick after dismiss / skipStart / the .out fade).
    try {
      var el = document.getElementById('start');
      if (!el || !el.isConnected) return false;
      if (window.__start && window.__start.dismissed) return false;
      if (el.classList && el.classList.contains('out')) return false;
      var r = el.getBoundingClientRect && el.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) return false;
      var cs = root.getComputedStyle ? root.getComputedStyle(el) : null;
      if (cs) {
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (cs.pointerEvents === 'none') return false;
        if (parseFloat(cs.opacity) === 0) return false;
      }
      return true;
    } catch (e) {}
    return false;
  }

  function fromStartUI(e) {
    if (!startUp()) return false;
    var t = e && e.target;
    try {
      if (t && t.closest && t.closest('#start, #gaP, #opt, #turnHint, #homeQ')) return true;
    } catch (err) {}
    return false;
  }

  function pinchNow() { return touchCount >= 2 && lastTouchAt && (performance.now() - lastTouchAt) < 200; }

  function wantDebug() {
    if (root.__gaQuestDbg) return true;
    try {
      var q = String(location.search || '') + String(location.hash || '');
      return /[?&#]qdbg=1(?:&|$)/.test(q);
    } catch (e) { return false; }
  }

  function bump(k) { counts[k] = (counts[k] || 0) + 1; }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function padList() {
    var raw = [], i, gp;
    try {
      gp = (navigator.getGamepads && navigator.getGamepads()) || [];
      for (i = 0; i < gp.length; i++) if (gp[i] && gp[i].connected !== false) raw.push(gp[i]);
    } catch (e) {}
    return raw;
  }

  function padIds() {
    return padList().map(function (g) { return (g.index != null ? g.index + ':' : '') + (g.id || '?') + (g.mapping ? '(' + g.mapping + ')' : '') + ' hand=' + (handOf(g) || '-') + ' axes=' + Array.prototype.map.call(g.axes || [], function (v) { return (+v).toFixed(2); }).join(','); });
  }

  function handOf(gp) {
    var id = String((gp && gp.id) || '');
    var h = (gp && (gp.hand || gp.handedness)) || '';
    if (/right/i.test(id) || h === 'right') return 'right';
    if (/left/i.test(id) || h === 'left') return 'left';
    return '';
  }

  function pair(axes, i) {
    var x = +axes[i] || 0, y = +axes[i + 1] || 0;
    if (!isFinite(x)) x = 0;
    if (!isFinite(y)) y = 0;
    return { x: x, y: y, mag: Math.hypot(x, y) };
  }

  function live(s) {
    if (!s || s.mag < DEAD) return { x: 0, y: 0, mag: 0 };
    return s;
  }

  function pressed(gp, i) {
    var b = gp.buttons && gp.buttons[i];
    if (!b) return false;
    return !!(b.pressed || (typeof b.value === 'number' && b.value >= 0.5));
  }

  function fadeStick(x0, y0, at) {
    if (!at) return { x: 0, y: 0, mag: 0 };
    var age = performance.now() - at, k = 1;
    if (age > HOLD) k = Math.max(0, 1 - (age - HOLD) / FADE);
    if (k <= 0) return { x: 0, y: 0, mag: 0 };
    var x = x0 * k, y = y0 * k;
    return { x: x, y: y, mag: Math.hypot(x, y) };
  }
  function virtStick() { return fadeStick(virtX, virtY, lastIngestAt); }
  function virtLook() { return fadeStick(lookVX, lookVY, lastLookAt); }

  function pushHist(hist, dx, dy, now) {
    hist.push({ t: now, dx: dx, dy: dy });
    var cut = now - 220;
    while (hist.length && hist[0].t < cut) hist.shift();
  }

  function analogFrom(hist, now) {
    var cut = now - ANALOG_WIN, sx = 0, sy = 0, flux = 0, n = 0, tFirst = now, i, h, len, win, rate, pxps, mag;
    for (i = 0; i < hist.length; i++) {
      h = hist[i];
      if (h.t < cut) continue;
      if (h.t < tFirst) tFirst = h.t;
      sx += h.dx; sy += h.dy; flux += Math.hypot(h.dx, h.dy); n++;
    }
    if (!n) return { x: 0, y: 0, mag: 0, rate: 0, pxps: 0 };
    win = Math.max(50, now - tFirst);
    rate = n / (win / 1000);
    pxps = flux / (win / 1000);
    mag = clamp(pxps / REF_PXPS, 0, 1);
    len = Math.hypot(sx, sy);
    if (len < 1e-6) return { x: 0, y: 0, mag: 0, rate: rate, pxps: pxps };
    return { x: (sx / len) * mag, y: (sy / len) * mag, mag: mag, rate: rate, pxps: pxps };
  }

  // ---------- v9 stick classifier ----------
  var padStickAt = 0, padWheelSkip = 0, lastLookSrc = '';
  var ptrs = {}, evLog = [], calib = null, cal = null, calBtn = null, calMsg = null, CAL_KEY = 'gaQuest.stickCal';
  // v13 (t391u-t393u, Dave: "still swapping and now both sticks move the camera"): the Quest 2D browser gives a page NO way to tell the
  // thumbsticks apart (no gamepads outside WebXR, one live ray, both sticks = the same plain wheel), so by default EVERY stick signal
  // walks (dy forward/back, dx strafe) and nothing a stick sends can turn the camera. TURN = hold the on-screen turn buttons, or hold
  // the TRIGGER on the 3D view and drag. A real left/right split only comes from handed gamepads (if the browser ever exposes them:
  // left stick walks, right stick turns, by the pad's own handedness, never a guess). The old classifier / STICK SETUP / STICK LOOK
  // only run with ?qsplit=1 (experiments). A saved STICK SETUP from older versions is wiped on a version change.
  var QVER = 'v13', SPLIT = false, VER_KEY = 'gaQuest.ver', lookIgn = {};
  try { SPLIT = /[?&]qsplit=1\b/.test(location.search); } catch (e) {}
  try { if (localStorage.getItem(VER_KEY) !== QVER) { localStorage.removeItem(CAL_KEY); localStorage.removeItem('gaQuest.lookStick'); localStorage.setItem(VER_KEY, QVER); } } catch (e) {}
  try { calib = SPLIT ? JSON.parse(localStorage.getItem(CAL_KEY) || 'null') : null; } catch (e) { calib = null; }
  // t369u: each ray remembers where it HOVERS (hx: smoothed x while not pressed), so a controller holding the FLY button
  // (bottom right) still counts as the hand it is. A held ray's drags (the Quest can turn that controller's stick into a drag
  // while its trigger is down) are stick input too ('held' events), classified like the wheel.
  function isHoldBtn(el) { try { return !!(el && el.closest && el.closest('#bFly, #bFire, #bZoom, #bJump, button, [role="button"]')); } catch (e) { return false; } }
  function notePtrTrack(e) {
    if (!e || e.pointerId == null || e.clientX == null) return;
    var id = String(e.pointerId), p = ptrs[id] || (ptrs[id] = { id: id, type: '', x: 0, y: 0, t: 0, n: 0, hx: null, pressed: false, hold: false, first: performance.now() });
    var px = p.x, py = p.y;
    p.type = e.pointerType || p.type; p.x = e.clientX; p.y = e.clientY; p.t = performance.now(); p.n++; (p.ts || (p.ts = [])).push(p.t); if (p.ts.length > 6) p.ts.shift();
    if (!p.pressed && e.type !== 'pointerdown') p.hx = p.hx == null ? p.x : p.hx * 0.7 + p.x * 0.3;
    tryLock(p);
    if (e.type === 'pointerdown') { p.pressed = true; p.hold = isQuest() && isHoldBtn(e.target) && !isTurnBtn(e.target); p.trig = !!((e.buttons & 1) || (e.button === 0 && e.buttons == null)); p.cvDrag = isQuest() && p.trig && !p.hold && !!(e.target && e.target.tagName === 'CANVAS') && !startUp() && !stickBusy(300); p.downAt = performance.now(); p.live = false; p.acc = 0; p.pend = null; return; }
    if (!p.pressed) return;
    if (e.type === 'pointermove' && e.buttons != null && !(e.buttons & 1) && p.cvDrag) { p.cvDrag = false; dragLook.noTrig = (dragLook.noTrig || 0) + 1; }   // trigger not held any more: no turning
    if (p.cvDrag && e.type === 'pointermove') { var cx0 = p.x - px, cy0 = p.y - py; if (Math.abs(cx0) + Math.abs(cy0) >= 0.5) cvDragMove(p, cx0, cy0); return; }
    if (p.hold && e.type === 'pointermove' && !startUp()) {
      var mx = p.x - px, my = p.y - py; if (Math.abs(mx) < 0.5 && Math.abs(my) < 0.5) return;
      var hev = { src: 'held', dx: -mx * 2, dy: -my * 2, dz: 0, mode: 0, cx: p.x, cy: p.y, pid: id, ptype: p.type };
      var hc = classify(hev); logEv(hev, hc); if (cal) return;
      var hh = hc.look ? lookHist : moveHist, now = performance.now();
      pushHist(hh, hev.dx, hev.dy, now); var a = analogFrom(hh, now);
      if (hc.look) ingestLook('held', a.x, a.y); else ingest('held', a.x, a.y);
    }
  }
  // v12 (t383u): HAND LOCK. Each ray (pointerId) is locked to a hand ONCE and never flips, so where the controllers point no longer
  // swaps MOVE / LOOK mid-session. Locks: (1) the first time two rays are live, by which one hovers further right (R = LOOK);
  // (2) a new ray while the other hand's ray is live = the opposite hand; (3) a new ray with no live partner inherits the hand of the
  // quiet locked ray it appeared next to (Quest gives a controller a new pointerId per press). A wheel landing where both rays
  // overlap keeps the previous wheel's ray (latch) instead of guessing.
  var hands = {}, lockLog = [], lastWheelPid = null, lastWheelPidAt = 0, LIVE_MS = 1500, PAIR_MS = 400;
  // two rays count as BOTH LIVE only if each sent >= 3 events in the last 400 ms (a Quest re-id leaves the old id quiet; Dave's Quest shows one ray)
  function together(a, b) { return !!(a && b && a.first != null && b.first != null && a.t > b.first + 0.5 && b.t > a.first + 0.5); }   // both sent events after the other appeared (not a re-id)
  function busyRay(q, now) { if (!q.ts) return false; var n = 0; for (var i = 0; i < q.ts.length; i++) if (now - q.ts[i] < PAIR_MS) n++; return n >= 3; }
  function lockHand(id, h, why) { if (hands[id]) return; hands[id] = h; lockLog.unshift(id + '=' + h + ' (' + why + ')'); if (lockLog.length > 6) lockLog.length = 6; }
  function hxOf(p) { return p.hx != null ? p.hx : p.x; }
  function tryLock(p) {
    if (!p || hands[p.id] || p.n < 2) return;
    var now = performance.now(), k, q, liveL = 0, liveR = 0, liveU = null, near = null, nd = 1e9, d;
    for (k in ptrs) { q = ptrs[k]; if (k === p.id) continue; var live = now - q.t < LIVE_MS;
      if (hands[k]) { if (live) { if (hands[k] === 'L') liveL++; else liveR++; }
        else if (now - q.t < 600000) { d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y); if (d < nd) { nd = d; near = q; } } }
      else if (busyRay(q, now) && busyRay(p, now) && together(p, q)) liveU = q; }
    if (liveL && liveR) {   // both hands live: the new id replaces the ray that went quiet first (the controller that just pressed)
      var old = null; for (k in ptrs) { q = ptrs[k]; if (k !== p.id && hands[k] && now - q.t < LIVE_MS && (!old || q.t < old.t)) old = q; }
      if (old && now - old.t > 100) return lockHand(p.id, hands[old.id], 'reid of ' + old.id);
      return; }
    if (liveL && !liveR) return lockHand(p.id, 'R', 'other=L');
    if (liveR && !liveL) return lockHand(p.id, 'L', 'other=R');
    if (!liveL && !liveR && near && nd < 220) return lockHand(p.id, hands[near.id], 'reid of ' + near.id);
    if (liveU && Math.abs(hxOf(p) - hxOf(liveU)) > 40) { var pr = hxOf(p) > hxOf(liveU); lockHand(p.id, pr ? 'R' : 'L', 'pair x'); lockHand(liveU.id, pr ? 'L' : 'R', 'pair x'); }
  }
  var oneRay = { n: 0, hinted: false }, dragLook = { n: 0, skipped: 0, lastTouch: 0, lastMouse: 0 };
  function oneRaySeen() { oneRay.n++; if (oneRay.hinted || oneRay.n < 20 || cal) return; if (startUp()) { oneRay.n = 0; return; } oneRay.hinted = true;
    try { ensureCalUi(); calSay(SPLIT ? 'Both sticks WALK here (the Quest browser sends them the same). TURN: hold the TRIGGER on the floor and drag, or tap STICK WALK to switch the sticks to LOOK' : 'Both sticks WALK (the Quest browser cannot tell them apart). TURN: hold \u25C0 \u25B6 or hold the TRIGGER on the floor and drag'); setTimeout(function () { if (!cal) calSay(''); }, 7000); } catch (e) {} }
  // v12 (Dave's 2nd photo): pushing the LEFT stick sideways sends wheel dx (MOVE, strafe) AND the Quest reports that ray as pressed
  // ("DOWN", touch=27) with drag moves -> main.js's touch / mouse drag-look turned the camera. A drag while stick wheels are arriving is
  // the stick, not the hand: stickBusy() tells main.js (and the trigger-drag turn here) to ignore it.
  var dragBlocked = 0;
  function stickBusy(ms) { var now = performance.now(), m = ms || 220; return isQuest() && (now - lastWheelEvt < m || now - (lastScrollStamp ? lastScrollIn : 0) < m); }
  function cvDragMove(p, mx, my) {   // trigger held on the 3D view: drag = turn the camera (main.js look(), like a touch drag)
    // v13: main.js no longer drag-turns on a Quest; this (trigger held on the 3D view) is the only drag turn. A stick push can come with a
    // pressed-ray drag (Dave's 2nd photo), so a drag only turns after 150 ms + 10 px with NO stick wheel; one stick wheel during the press
    // cancels that whole press (it was the stick, not your hand).
    var now = performance.now();
    if (stickBusy(300)) { dragBlocked++; p.cvDrag = false; p.pend = null; return; }
    if (!p.live) { p.pend = p.pend || [0, 0]; p.pend[0] += mx; p.pend[1] += my; p.acc = (p.acc || 0) + Math.abs(mx) + Math.abs(my);
      if (now - (p.downAt || now) < 150 || p.acc < 10) return; p.live = true; mx = p.pend[0]; my = p.pend[1]; p.pend = null; }
    if (typeof root.__gaLook === 'function') { root.__gaLook(mx * 1.4, my * 1.4, 'trigger-drag'); dragLook.n++; }
  }
  // v13: ◀ ▶ TURN buttons (hold to turn) next to the walk stick: the one unambiguous turn in the 2D browser
  var turnDir = 0, turnBtns = null, turnN = 0, TURN_RATE = 0.55;
  function isTurnBtn(el) { try { return !!(el && el.closest && el.closest('.gaQturn')); } catch (e) { return false; } }
  function ensureTurnBtns() {
    if (turnBtns || !document.body || !isQuest() || isPlayFrame()) return;
    turnBtns = [];
    [['gaQturnL', '\u25C0', -1, 'Turn left (hold)'], ['gaQturnR', '\u25B6', 1, 'Turn right (hold)']].forEach(function (d) {
      var b = document.createElement('button'); b.id = d[0]; b.className = 'gaQturn'; b.type = 'button'; b.textContent = d[1]; b.title = d[3]; b.setAttribute('aria-label', d[3]);
      var on = function (e) { if (e && e.cancelable) e.preventDefault(); if (e && e.stopPropagation) e.stopPropagation(); turnDir = d[2]; turnN++; b.classList.add('on'); };
      var off = function (e) { if (turnDir === d[2]) turnDir = 0; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off); addEventListener('pointerup', off, true); addEventListener('blur', off);
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      document.body.appendChild(b); turnBtns.push(b);
    });
  }
  function ptrUp(e) { if (!e || e.pointerId == null) return; var p = ptrs[String(e.pointerId)]; if (p) { p.pressed = false; p.hold = false; p.cvDrag = false; } }
  function ptrAt(cx, cy) {
    if (cx == null) return null;
    var best = null, bd = 1e9, now = performance.now(), k, p, d;
    for (k in ptrs) { p = ptrs[k]; if (now - p.t > 3000) continue; d = Math.abs(p.x - cx) + Math.abs(p.y - cy); if (d < bd) { bd = d; best = p; } }
    return best && bd <= 48 ? best : null;
  }
  function ptrAtWheel(cx, cy) {   // v12: like ptrAt, but where two rays of different hands overlap, keep the ray the previous wheel used
    if (cx == null) return null;
    var now = performance.now(), k, p, d, a = null, ad = 1e9, b = null, bd = 1e9;
    for (k in ptrs) { p = ptrs[k]; if (now - p.t > 3000) continue; d = Math.abs(p.x - cx) + Math.abs(p.y - cy); if (d < ad) { b = a; bd = ad; a = p; ad = d; } else if (d < bd) { b = p; bd = d; } }
    if (!a || ad > 48) return null;
    if (b && bd <= 48 && bd - ad < 16 && hands[a.id] && hands[b.id] && hands[a.id] !== hands[b.id] && lastWheelPid && now - lastWheelPidAt < 400 && (lastWheelPid === a.id || lastWheelPid === b.id)) { a = ptrs[lastWheelPid]; a.latch = (a.latch || 0) + 1; }
    lastWheelPid = a.id; lastWheelPidAt = now; return a;
  }
  function otherPtr(id) {
    var best = null, now = performance.now(), k, p;
    for (k in ptrs) { p = ptrs[k]; if (k === id || !busyRay(p, now) || !together(p, ptrs[id])) continue; if (!best || p.t > best.t) best = p; }   // v12: LIVE rays only (v9 compared against rays gone quiet for up to 60 s = the MOVE/LOOK flip)
    return best;
  }
  function stepQ(px) { px = Math.abs(px); return px < 0.5 ? 0 : Math.round(Math.log(px) / Math.LN2 * 2) / 2; }
  function feats(ev) {
    var W = root.innerWidth || 1;
    // v12: no ray id / screen side here: the Quest gives a ray a new pointerId per press and the side follows where you point (both flipped)
    return { src: ev.src, mode: String(ev.mode || 0), step: String(stepQ(Math.max(Math.abs(ev.dx || 0), Math.abs(ev.dy || 0)))) };
  }
  function classify(ev) {
    if (!SPLIT) { if (ev.src === 'wheel' || ev.src === 'scroll' || ev.src === 'vvscroll') oneRaySeen(); return { look: false, why: 'v13 WALK' }; }
    if (lookToggle) return { look: true, why: 'toggle' };
    if (ev.ctrl || ev.meta || ev.alt) return { look: true, why: 'mod' };
    if (calib && calib.rules && calib.rules.length) {
      var f = feats(ev), v = 0, used = [], i, r;
      for (i = 0; i < calib.rules.length; i++) { r = calib.rules[i]; if (f[r.k] === r.R) { v++; used.push(r.k); } else if (f[r.k] === r.L) { v--; used.push(r.k); } }
      if (v !== 0) return { look: v > 0, why: 'cal:' + used.join('+') };
    }
    if (ev.pid != null) {
      var hl = hands[String(ev.pid)]; if (hl) return { look: hl === 'R', why: 'lock ' + hl };   // v12: never flips once locked
      var me = ptrs[String(ev.pid)], o = otherPtr(String(ev.pid)), mx = me && hxOf(me), ox = o && hxOf(o);
      if (me && o && busyRay(me, performance.now()) && Math.abs(mx - ox) > 40) { var lk = mx > ox; lockHand(me.id, lk ? 'R' : 'L', '2ray'); if (!hands[o.id]) lockHand(o.id, lk ? 'L' : 'R', '2ray'); return { look: lk, why: '2ray' }; }
    }
    // v12 (Dave's Quest photo): only ONE ray is live at a time and both sticks arrive as the same plain wheel at that ray -> nothing tells
    // the sticks apart, so the wheel always WALKS (stable, never flips). Turning: trigger-drag on the floor / screen, the STICK LOOK button,
    // or STICK SETUP (if the sticks differ in delta mode / step size on this headset).
    if (ev.pid != null && (ev.src === 'wheel' || ev.src === 'scroll' || ev.src === 'vvscroll')) oneRaySeen();
    return { look: false, why: ev.pid != null ? '1ray' : 'default' };
  }
  function logEv(ev, c) {
    ev.cls = c.look ? 'LOOK' : 'MOVE'; ev.why = c.why; ev.t = performance.now();
    evLog.unshift(ev); if (evLog.length > 8) evLog.length = 8;
    if (cal) calFeed(ev);
  }
  // STICK SETUP: hold LEFT stick, then RIGHT stick; keep the features that tell them apart
  function calSay(t) { if (calMsg) { calMsg.textContent = t; calMsg.hidden = !t; } }
  function calStart() {
    ensureCalUi(); cal = { phase: 'L', L: [], R: [], t0: 0, timer: 0 };
    calSay('STICK SETUP 1/2: push and hold your LEFT thumbstick');
    clearTimeout(cal.timer); cal.timer = setTimeout(function () { calAbort('No stick input seen. Try again.'); }, 12000);
    return true;
  }
  function calAbort(msg) { if (cal) clearTimeout(cal.timer); cal = null; calSay(msg); setTimeout(function () { if (!cal) calSay(''); }, 4000); }
  function calFeed(ev) {
    if (cal.phase !== 'L' && cal.phase !== 'R') return;
    var now = performance.now(); if (!cal.t0) cal.t0 = now;
    cal[cal.phase].push(feats(ev));
    if (now - cal.t0 < 1500 || cal[cal.phase].length < 6) return;
    if (cal.phase === 'L') { cal.phase = 'pause'; calSay('Let go...'); setTimeout(function () { if (!cal) return; cal.phase = 'R'; cal.t0 = 0; calSay('STICK SETUP 2/2: push and hold your RIGHT thumbstick'); }, 1200); return; }
    if (cal.phase === 'R') calFinish();
  }
  function dom(list, k) { var c = {}, best = null, n = 0, i; for (i = 0; i < list.length; i++) { c[list[i][k]] = (c[list[i][k]] || 0) + 1; } for (i in c) if (c[i] > n) { n = c[i]; best = i; } return { v: best, p: list.length ? n / list.length : 0 }; }
  function calFinish() {
    var rules = [], ks = ['ray', 'side', 'src', 'mode', 'step'], i, a, b;
    for (i = 0; i < ks.length; i++) { a = dom(cal.L, ks[i]); b = dom(cal.R, ks[i]); if (a.v !== b.v && a.v !== '-' && b.v !== '-' && a.p >= 0.75 && b.p >= 0.75) rules.push({ k: ks[i], L: a.v, R: b.v }); }
    clearTimeout(cal.timer); cal = null;
    if (rules.length) {
      calib = { rules: rules, at: Date.now() }; try { localStorage.setItem(CAL_KEY, JSON.stringify(calib)); } catch (e) {}
      calSay('STICK SETUP done: right stick = camera (told apart by ' + rules.map(function (r) { return r.k; }).join(', ') + ')');
    } else calSay('Your Quest sends both sticks the same way. Tip: point the RIGHT controller at the right side of the screen, then try again.');
    setTimeout(function () { if (!cal) calSay(''); }, 6000);
  }
  function calClear() { calib = null; try { localStorage.removeItem(CAL_KEY); } catch (e) {} }
  function ensureCalUi() {
    if (!document.body || !isQuest()) return;
    if (!calMsg) { calMsg = document.createElement('div'); calMsg.id = 'gaQcalMsg'; calMsg.hidden = true; document.body.appendChild(calMsg); }
    if (!calBtn) {
      calBtn = document.createElement('button'); calBtn.id = 'gaQcal'; calBtn.type = 'button'; calBtn.textContent = 'STICK SETUP';
      calBtn.title = 'Teach the arcade which thumbstick is which: hold the left stick, then the right one.';
      calBtn.addEventListener('click', function (e) { if (e && e.preventDefault) e.preventDefault(); if (e && e.stopPropagation) e.stopPropagation(); calStart(); });
      document.body.appendChild(calBtn);
    }
  }

  function notePointer(e) {
    if (!e) return;
    if (e.pointerId != null) lastPtr.id = e.pointerId;
    if (e.pointerType) lastPtr.type = e.pointerType;
    if (e.clientX != null) lastPtr.x = e.clientX;
    if (e.clientY != null) lastPtr.y = e.clientY;
    lastPtr.buttons = e.buttons || 0;
    lastPtr.t = performance.now();
  }


  function keyList() {
    var out = [], k;
    for (k in heldKeys) if (heldKeys[k]) out.push(k);
    out.sort();
    return out;
  }

  function ingest(source, nx, ny) {
    nx = clamp(+nx || 0, -1, 1);
    ny = clamp(+ny || 0, -1, 1);
    var mag = Math.hypot(nx, ny);
    if (mag > 1) { nx /= mag; ny /= mag; }
    virtX = clamp(virtX * 0.2 + nx * 0.8, -1, 1);
    virtY = clamp(virtY * 0.2 + ny * 0.8, -1, 1);
    lastIngestAt = performance.now();
    lastIngestSrc = source || 'virt';
    lastChan = 'move';
    if (isPlayFrame()) applyPlay(read());
    return virtStick();
  }

  function ingestLook(source, nx, ny) {
    if (!SPLIT && source !== 'turn' && source !== 'gamepad') { lookIgn[source] = (lookIgn[source] || 0) + 1; return virtLook(); }   // v13: no stick-made signal turns the camera
    nx = clamp(+nx || 0, -1, 1);
    ny = clamp(+ny || 0, -1, 1);
    var mag = Math.hypot(nx, ny);
    if (mag > 1) { nx /= mag; ny /= mag; }
    lookVX = clamp(lookVX * 0.2 + nx * 0.8, -1, 1);
    lookVY = clamp(lookVY * 0.2 + ny * 0.8, -1, 1);
    lastLookAt = performance.now();
    lastChan = 'look';
    lastIngestSrc = source || 'look';
    lastLookSrc = source || 'look';
    return virtLook();
  }


  // ---- v12 (t382u): GRIP = BACK in flat Quest mode ----
  // The 2D Quest Browser does not document a page event for the grip, so every candidate is mapped to BACK and counted in ?qdbg=1:
  // a gamepad grip (xr-standard button 1, if the browser ever exposes the controllers), a non-primary pointer button (button 1/2/3+,
  // contextmenu), a BrowserBack/GoBack key. B/Y (the browser's own back) is trapped and FIRES instead.
  // BACK = the game's own Escape (it closes the open panel / overlay, leaves a cabinet game, stands up from chess, closes the pool table...).
  var backN = {}, backLast = '', backAt = 0, trapOn = false, padGrip = {};
  function inXR() { try { return !!(document.body && document.body.classList.contains('vr')); } catch (e) { return false; } }
  function backFire(src) {
    var now = performance.now(); backN[src] = (backN[src] || 0) + 1;
    if (inXR() || now - backAt < 250) return false; backAt = now; backLast = src;
    try { if (typeof root.__gaBack === 'function') { root.__gaBack(src); return true; } } catch (e) {}
    try { var t = document.activeElement && document.activeElement !== document.body && document.activeElement.tagName !== 'IFRAME' ? document.activeElement : (document.body || document.documentElement);
      ['keydown', 'keyup'].forEach(function (ty) { var ev = new KeyboardEvent(ty, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }); try { Object.defineProperty(ev, 'keyCode', { get: function () { return 27; } }); } catch (e) {} t.dispatchEvent(ev); });
      backN.sent = (backN.sent || 0) + 1; } catch (e) {}
    return true;
  }
  // v12: B/Y in the Quest 2D browser = history back -> the trap turns it into FIRE (a Space tap + the on-screen FIRE button), not back;
  // GRIP is the back button now.
  var bFireN = 0;
  // v21 (Dave): in arcade STRIKE, B = BOMB on the flat Quest screen too (the game's own X key, sent into its iframe)
  var bBombN = 0;
  function strikeWin() { try { var f = document.getElementById('game'); if (!f || !document.body.classList.contains('ingame') || !/strike-play\//.test(f.getAttribute('src') || f.src || '')) return null; return f.contentWindow; } catch (e) { return null; } }
  function strikeKey(w, code, on) { try { var ev = new w.KeyboardEvent(on ? 'keydown' : 'keyup', { code: code, key: code === 'KeyX' ? 'x' : code, bubbles: true, cancelable: true }); try { Object.defineProperty(ev, 'keyCode', { get: function () { return code === 'KeyX' ? 88 : 0; } }); } catch (e) {} (w.document.body || w.document.documentElement).dispatchEvent(ev); } catch (e) {} }
  function bFire() { if (inXR()) return; var sw = strikeWin(); if (sw) { bBombN++; root.__gaQuestBomb = bBombN; strikeKey(sw, 'KeyX', true); setTimeout(function () { strikeKey(sw, 'KeyX', false); }, 120); return; }
    // v25 (Dave t442u): walking in the arcade room, B fires the laser pistol only while it is equipped (its on-screen FIRE button); no gun = nothing (it used to jump)
    var bd = document.body; if (bd && !bd.classList.contains('ingame') && !bd.classList.contains('nbPlay')) { var RF = root.__roomFire; if (!(RF && RF.shown)) { root.__gaQuestBNone = (root.__gaQuestBNone || 0) + 1; return; }
      bFireN++; try { pressSel('#bFire', true); } catch (e) {} setTimeout(function () { try { pressSel('#bFire', false); } catch (e) {} }, 120); return; }
    bFireN++; try { setKey('Space', true); pressSel('#bFire, #fire, button[aria-label*="Fire" i], button[aria-label*="FIRE" i]', true); } catch (e) {}
    setTimeout(function () { try { if (!prevBtn.fire) setKey('Space', false); pressSel('#bFire, #fire, button[aria-label*="Fire" i], button[aria-label*="FIRE" i]', false); } catch (e) {} }, 120); }
  root.__gaQuestBFire = bFire;
  function backTrap() {
    if (trapOn || !isQuest()) return; trapOn = true;
    try { history.pushState({ gaBackTrap: 1 }, ''); addEventListener('popstate', function () { bFire(); try { history.pushState({ gaBackTrap: 1 }, ''); } catch (e) {} }); } catch (e) {}
  }
  function listenBack() {
    addEventListener('contextmenu', function (e) { if (!isQuest()) return; if (e.cancelable) e.preventDefault(); backFire('contextmenu'); }, true);
    addEventListener('pointerdown', function (e) { backTrap(); if (isQuest() && e && e.button > 0) backFire('pointer button ' + e.button); }, true);
    addEventListener('keydown', function (e) { if (!e) return; var k = e.key || '', c = e.code || ''; if (/^(BrowserBack|GoBack)$/.test(k) || /^(BrowserBack|GoBack)$/.test(c) || e.keyCode === 166) { if (e.cancelable) e.preventDefault(); backFire('key ' + (c || k)); } }, true);
  }
  function readPads() {
    var pads = padList();
    var move = { x: 0, y: 0, mag: 0 }, look = { x: 0, y: 0, mag: 0 };
    var fire = false, fly = false, zoom = false, slow = false, unhanded = [], i, j, gp, axes, s01, s23, stick, alt, hand, mapping;
    for (i = 0; i < pads.length; i++) {
      gp = pads[i];
      axes = gp.axes || [];
      s01 = live(pair(axes, 0));
      s23 = live(pair(axes, 2));
      mapping = gp.mapping || '';
      if (mapping === 'xr-standard') {
        stick = s23.mag ? s23 : s01;
        alt = { x: 0, y: 0, mag: 0 };
      } else if (s01.mag && s23.mag) {
        stick = s01; alt = s23;
      } else {
        stick = s01.mag ? s01 : s23;
        alt = { x: 0, y: 0, mag: 0 };
      }
      hand = handOf(gp);
      if ((hand === 'right' || hand === 'left') && stick.mag) padStickAt = performance.now();   // v13: handed pads = the real split; the wheel they also make is ignored
      if (hand === 'right') {
        if (stick.mag) look = stick;
      } else if (hand === 'left') {
        if (stick.mag) move = stick;
        if (alt.mag) look = alt;
      } else if (s01.mag && s23.mag && mapping !== 'xr-standard') {
        move = s01; look = s23;
      } else if (stick.mag) {
        unhanded.push(stick);
      }
      if (mapping === 'xr-standard') {
        if (pressed(gp, 0)) fire = true;
        if (pressed(gp, 4)) { if (strikeWin()) slow = true; else fire = true; }   // v23: in Strike, A / X = HYPER SPEED (it was FIRE, so the enemy slow-mo never started)
        if (pressed(gp, 5)) fly = true;
        var gk = String(gp.index != null ? gp.index : i) + (hand || ''), gn = pressed(gp, 1);   // v12: grip = BACK (edge)
        if (gn && !padGrip[gk]) backFire('gamepad grip ' + (hand || '?')); padGrip[gk] = gn;
        if (pressed(gp, 3)) zoom = true;
      } else {
        if (pressed(gp, 0) || pressed(gp, 2) || pressed(gp, 6) || pressed(gp, 7)) fire = true;
        if (pressed(gp, 1) || pressed(gp, 5)) fly = true;
        if (pressed(gp, 3) && strikeWin()) slow = true;   // v24: non xr-standard pads (old Oculus layout, 3 = A / X) = HYPER SPEED in Strike too
        else if (pressed(gp, 3) || pressed(gp, 4)) zoom = true;
      }
    }
    for (j = 0; j < unhanded.length; j++) {
      if (!move.mag) move = unhanded[j];
      else if (!look.mag) look = unhanded[j];
    }
    return { move: move, look: look, fire: fire, fly: fly, zoom: zoom, slow: slow, n: pads.length };
  }

  function read() {
    var pads = readPads();
    var v = virtStick(), lv = virtLook();
    var keys = keyList();
    var move = pads.move, look = pads.look, source = 'none';
    if (move.mag) source = 'gamepad';
    else if (v.mag) { move = v; source = lastIngestSrc || 'virt'; }
    else if (lv.mag) source = lastIngestSrc || 'look';
    else if (keys.length) source = 'key';
    if (look.mag) lastLookSrc = 'gamepad';
    if (!look.mag && lv.mag) look = lv;
    var vv = root.visualViewport;
    var lookAge = lastLookAt ? +(performance.now() - lastLookAt).toFixed(0) : null;
    var moveAge = lastIngestAt ? +(performance.now() - lastIngestAt).toFixed(0) : null;
    return {
      move: move, look: look,
      fire: pads.fire, fly: pads.fly, zoom: pads.zoom, slow: pads.slow,
      n: pads.n, source: source, keys: keys, counts: counts, unlocked: unlocked,
      pads: padIds(),
      ua: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
      scale: vv ? vv.scale : 1,
      dpr: root.devicePixelRatio || 1,
      xr: xrInfo,
      lookStick: !!lookToggle,
      chan: lastChan,
      wheel: {
        dx: lastWheelDx, dy: lastWheelDy, mode: lastWheelMode,
        age: lastChan === 'look' ? lookAge : moveAge,
        x: v.x, y: v.y, ctrl: lastWheelCtrl, shift: lastWheelShift,
        rate: lastRate, pxps: lastPxps,
        cx: lastWheelCX, cy: lastWheelCY,
        ptrId: lastPtr.id, ptrType: lastPtr.type, ptrX: lastPtr.x, ptrY: lastPtr.y
      }
    };
  }

  function ensureViewport() {
    try {
      var m = document.querySelector('meta[name="viewport"]');
      if (!m) {
        m = document.createElement('meta');
        m.setAttribute('name', 'viewport');
        m.setAttribute('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover');
        (document.head || document.documentElement).appendChild(m);
      } else if (!/user-scalable\s*=\s*no/i.test(m.getAttribute('content') || '')) {
        m.setAttribute('content', (m.getAttribute('content') || '') + ',maximum-scale=1,user-scalable=no');
      }
    } catch (e) {}
  }

  function applyCss() {
    if (cssOn) return;
    cssOn = true;
    try {
      var s = document.createElement('style');
      s.setAttribute('data-ga-quest', '1');
      // Never unlock document overflow or inflate the layout: position:fixed #start / HUD would
      // scroll off, and a blanket canvas rule made #gaCv (start preview) cover PLAY.
      s.textContent = 'html.gaQuest,html.gaQuest body{overflow:hidden!important;overscroll-behavior:none!important}'
        + 'html.gaQuest body>canvas,html.gaQuest canvas.gaQuestRoom{position:fixed!important;inset:0;width:100%!important;height:100%!important;z-index:0}'
        + 'html.gaQuest #start{z-index:100!important}'
        + '#gaQscroll{position:fixed;inset:0;overflow:scroll;z-index:0;pointer-events:none;opacity:0;overscroll-behavior:auto}'
        + '#gaQdbg{position:fixed;top:max(4px,env(safe-area-inset-top));left:max(4px,env(safe-area-inset-left));z-index:2147483000;pointer-events:none;background:#000c;color:#9ff;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;padding:6px 8px;border:1px solid #0ff6;border-radius:6px;white-space:pre;max-width:min(96vw,420px)}'
        + '#gaQlook{position:fixed;right:max(8px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));z-index:25;pointer-events:auto;font:800 11px/1.15 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;color:#dffbff;background:#0a0612cc;border:1px solid #00e5ff88;border-radius:8px;padding:8px 10px;text-shadow:0 0 6px #00e5ff;cursor:pointer}'
        + '#gaQlook.on{border-color:#ff3cf0;color:#ffd0fa;text-shadow:0 0 6px #ff3cf0}'
        + '#gaQlook[hidden]{display:none!important}'
        + '#gaQcal{position:fixed;right:max(8px,env(safe-area-inset-right));bottom:calc(max(10px,env(safe-area-inset-bottom)) + 40px);z-index:25;pointer-events:auto;font:800 11px/1.15 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;color:#fff6c8;background:#0a0612cc;border:1px solid #ffd23a88;border-radius:8px;padding:8px 10px;text-shadow:0 0 6px #ffb000;cursor:pointer}'
        + '#gaQcal[hidden]{display:none!important}'
        + '#gaQcalMsg{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:2147483001;pointer-events:none;font:900 20px/1.3 Arial Black,Arial,sans-serif;color:#fff;background:#0a0612e6;border:2px solid #ffd23a;border-radius:12px;padding:14px 20px;text-align:center;max-width:80vw;text-shadow:0 0 8px #ffb000}'
        + '#gaQcalMsg[hidden]{display:none!important}'
        + '.gaQturn{position:fixed;bottom:max(30px,calc(env(safe-area-inset-bottom) + 22px));z-index:25;width:76px;height:76px;border-radius:50%;pointer-events:auto;touch-action:none;font:900 30px/1 Arial,sans-serif;color:#dffbff;background:#0a0612cc;border:2px solid #00e5ffaa;box-shadow:0 0 12px #00e5ff55;user-select:none;-webkit-user-select:none}'
        + '#gaQturnL{left:max(160px,calc(env(safe-area-inset-left) + 152px))}#gaQturnR{left:max(248px,calc(env(safe-area-inset-left) + 240px))}'
        + '.gaQturn.on{background:#ff3cf0aa;border-color:#fff}.gaQturn[hidden]{display:none!important}';
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
    ensureViewport();
  }

  function showDebug(on) {
    dbgOn = on !== false;
    if (!dbgOn) {
      if (dbgEl && dbgEl.parentNode) dbgEl.parentNode.removeChild(dbgEl);
      dbgEl = null;
      return;
    }
    applyCss();
    if (!dbgEl) {
      dbgEl = document.createElement('div');
      dbgEl.id = 'gaQdbg';
      (document.body || document.documentElement).appendChild(dbgEl);
    }
    renderDebug(read());
  }

  function renderDebug(s) {
    if (!dbgOn) return;
    if (!dbgEl) showDebug(true);
    if (!dbgEl) return;
    s = s || api.last || {};
    var w = s.wheel || {};
    var mv = s.move || {};
    var lk = s.look || {};
    var c = s.counts || counts;
    var ua = (s.ua || '').slice(0, 180);
    var xr = s.xr || {};
    var now = performance.now(), k, pl = [];
    for (k in ptrs) pl.push(k + (hands[k] ? '[' + hands[k] + ']' : '') + ':' + (ptrs[k].type || '?') + '@' + Math.round(ptrs[k].x) + ',' + Math.round(ptrs[k].y) + (ptrs[k].hx != null ? ' hx' + Math.round(ptrs[k].hx) : '') + (ptrs[k].pressed ? (ptrs[k].hold ? ' HOLD' : ' DOWN') : '') + ' ' + Math.round((now - ptrs[k].t) / 100) / 10 + 's n' + ptrs[k].n);
    var el = evLog.map(function (e) { return (e.src === 'wheel' ? 'W' : e.src === 'scroll' ? 'S' : e.src === 'held' ? 'H' : 'V') + ' dx' + Math.round(e.dx) + ' dy' + Math.round(e.dy) + (e.dz ? ' dz' + Math.round(e.dz) : '') + ' m' + (e.mode || 0)
      + (e.ctrl ? ' C' : '') + (e.alt ? ' A' : '') + (e.meta ? ' M' : '') + (e.shift ? ' S' : '') + ' @' + (e.cx == null ? '-' : Math.round(e.cx) + ',' + Math.round(e.cy)) + ' ray' + (e.pid == null ? '-' : e.pid) + ' -> ' + e.cls + ' (' + e.why + ')'; });
    var YL = root.__gaYaw || { log: [], by: {} };
    dbgEl.textContent = 'GA Quest dbg VR ' + QVER + ' | page ' + (root.__GA_VR || '?') + ' | sw ' + swInfo
      + '\nSTICKS: ' + (SPLIT ? 'qsplit=1 EXPERIMENT (classifier on)' : (padStickAt ? 'GAMEPADS: left stick WALK, right stick TURN (by handedness)' : 'both WALK (dy walk, dx strafe), never turn')) + ' | TURN: \u25C0 \u25B6 x' + turnN + (turnDir ? (turnDir < 0 ? ' <<' : ' >>') : '') + ', trigger-drag x' + dragLook.n
      + '\nyaw by ' + (Object.keys(YL.by).length ? Object.keys(YL.by).map(function (k) { return k + '=' + YL.by[k].n + '(' + YL.by[k].d.toFixed(2) + 'rad)'; }).join(' ') : 'nothing yet')
      + '\nyaw last ' + (YL.log.length ? YL.log.slice(0, 4).map(function (e) { return e.c + ' ' + (e.d >= 0 ? '+' : '') + e.d.toFixed(3) + ' ' + Math.round((now - e.t) / 100) / 10 + 's'; }).join(' | ') : '-')
      + '\nstick look ignored ' + (Object.keys(lookIgn).length ? Object.keys(lookIgn).map(function (k) { return k + '=' + lookIgn[k]; }).join(' ') : '0') + ' | pad-wheel skipped ' + padWheelSkip + ' | drag w/o trigger ' + (dragLook.noTrig || 0) + ' | stick drags ignored ' + dragBlocked
      + '\nrays ' + (pl.length ? pl.join(' | ') : '-')
      + '\nMODE ' + (function () { var live = 0, k2; for (k2 in ptrs) if (busyRay(ptrs[k2], now)) live++; if (live >= 2) { var ks = Object.keys(ptrs).filter(function (q) { return busyRay(ptrs[q], now); }); live = ks.some(function (a) { return ks.some(function (b) { return a !== b && together(ptrs[a], ptrs[b]); }); }) ? 2 : 1; } return live >= 2 || Object.keys(hands).length ? '2 RAYS: left ray = MOVE, right ray = LOOK (locked per ray)' : '1 RAY: stick wheel = MOVE always (dy walk, dx strafe, never turns) | TURN = trigger-drag on the floor, STICK LOOK button, or STICK SETUP'; })() + ' | drag-turns ' + dragLook.n + (dragLook.skipped ? ' (main ' + dragLook.skipped + ')' : '') + ' | stick-drags ignored ' + dragBlocked
      + '\nhand lock ' + (Object.keys(hands).length ? Object.keys(hands).map(function (id) { var p = ptrs[id]; return 'ray' + id + '=' + hands[id] + (hands[id] === 'R' ? '(LOOK)' : '(MOVE)') + (p && now - p.t < LIVE_MS ? ' live' : ''); }).join(' | ') : 'none yet (point both controllers at the page)') + (lockLog.length ? '\n  locks: ' + lockLog.join('; ') : '')
      + '\nsetup ' + (cal ? 'RUNNING ' + cal.phase : calib && calib.rules ? calib.rules.map(function (r) { return r.k + ' L=' + r.L + ' R=' + r.R; }).join('; ') : 'none')
      + '\nlast stick events (newest first):\n ' + (el.length ? el.join('\n ') : '-')
      + '\n----'
      + '\nUA ' + (ua || '-')
      + '\nsrc ' + (s.source || 'none')
      + ' chan=' + (s.chan || lastChan || '-')
      + ' unlocked=' + (s.unlocked ? '1' : '0')
      + '\nwheel dx=' + (w.dx == null ? '-' : (+w.dx).toFixed(1))
      + ' dy=' + (w.dy == null ? '-' : (+w.dy).toFixed(1))
      + ' mode=' + (w.mode == null ? '-' : w.mode)
      + ' age=' + (w.age == null ? '-' : w.age + 'ms')
      + (w.ctrl ? ' CTRL' : '')
      + (w.shift ? ' SHIFT' : '')
      + '\nrate=' + (w.rate == null ? '-' : (+w.rate).toFixed(1) + '/s')
      + ' pxps=' + (w.pxps == null ? '-' : Math.round(+w.pxps))
      + '\nptr id=' + (w.ptrId == null ? '-' : w.ptrId)
      + ' type=' + (w.ptrType || '-')
      + ' xy=' + (w.cx == null ? '-' : Math.round(+w.cx) + ',' + Math.round(+w.cy))
      + '\nmove x=' + (mv.x || 0).toFixed(2) + ' y=' + (mv.y || 0).toFixed(2)
      + ' look x=' + (lk.x || 0).toFixed(2) + ' y=' + (lk.y || 0).toFixed(2)
      + ' stick=' + (lookToggle ? 'LOOK' : 'WALK')
      + '\nvv.scale=' + (s.scale == null ? '-' : (+s.scale).toFixed(3))
      + ' dpr=' + (s.dpr == null ? '-' : (+s.dpr).toFixed(3))
      + '\ngrip/back ' + (Object.keys(backN).length ? Object.keys(backN).map(function (k) { return k + '=' + backN[k]; }).join(' ') : 'none yet (press GRIP)') + (backLast ? ' last=' + backLast : '') + ' trap=' + (trapOn ? 1 : 0) + ' | B/Y (browser back) = FIRE x' + bFireN
      + '\ngamepads ' + (s.n || 0) + ' ' + ((s.pads && s.pads.length) ? s.pads.join(' | ') : '-')
      + '\nkeys ' + ((s.keys && s.keys.length) ? s.keys.join(',') : '-')
      + '\nstart=' + (startUp() ? '1' : '0')
      + ' pinch=' + (pinchNow() ? '1' : '0')
      + ' drag=' + (lastDrag ? Math.round(performance.now() - lastDrag) + 'ms' : '0')
      + '\ncounts wheel=' + (c.wheel || 0)
      + ' mousewheel=' + (c.mousewheel || 0)
      + ' scroll=' + (c.scroll || 0)
      + ' vvR=' + (c.vvresize || 0)
      + ' vvS=' + (c.vvscroll || 0)
      + ' gest=' + (c.gesture || 0)
      + ' pinch=' + (c.pinch || 0)
      + ' touch=' + (c.touch || 0)
      + ' key=' + (c.key || 0)
      + ' gp=' + (c.gamepad || 0)
      + '\nxr inline=' + xr.inline + ' vr=' + xr['immersive-vr'] + ' ar=' + xr['immersive-ar'];
  }

  function deltaToAxis(dx, dy, mode) {
    if (mode === 1) { dx *= 16; dy *= 16; }
    else if (mode === 2) { dx *= 80; dy *= 80; }
    return { x: clamp(dx / AXIS_SCALE, -1, 1), y: clamp(dy / AXIS_SCALE, -1, 1) };
  }

  function onWheel(e) {
    // Same Event object can hit both the window and canvas listeners; mark it.
    // Do not key on timeStamp alone — a held stick (and our tests) can deliver
    // several distinct events in the same millisecond, and rate is the analog cue.
    if (e && e.__gaQSeen) return;
    if (e) e.__gaQSeen = 1;
    bump(e.type === 'mousewheel' || e.type === 'DOMMouseScroll' ? 'mousewheel' : 'wheel');
    if (e.cancelable) e.preventDefault();
    lastWheelCtrl = !!(e.ctrlKey || e.metaKey);
    lastWheelShift = !!e.shiftKey;
    lastWheelMode = e.deltaMode || 0;
    lastWheelDx = (e.deltaX != null ? e.deltaX : (e.wheelDeltaX != null ? -e.wheelDeltaX : 0)) || 0;
    lastWheelDy = (e.deltaY != null ? e.deltaY : (e.wheelDelta != null ? -e.wheelDelta : 0)) || 0;
    lastWheelCX = e.clientX != null ? e.clientX : lastPtr.x;
    lastWheelCY = e.clientY != null ? e.clientY : lastPtr.y;
    lastWheelEvt = performance.now();
    notePointer(e);
    // v241: on Quest, wheel always becomes input unless a real two-finger pinch is active.
    // v242: analog speed from event rate × |delta|. Plain wheel = walk (left stick).
    // ctrl/meta/alt+wheel (Chromium zoom channel) or the STICK LOOK toggle = camera look.
    if (startUp()) return;
    if (pinchNow()) return;
    if (!isQuest() && lastDrag && performance.now() - lastDrag < 100) return;
    if (padStickAt && lastWheelEvt - padStickAt < 600) { padWheelSkip++; return; }
    var pm = ptrAtWheel(lastWheelCX, lastWheelCY);
    var wev = { src: 'wheel', dx: lastWheelDx * (lastWheelMode === 1 ? 16 : lastWheelMode === 2 ? 80 : 1), dy: lastWheelDy * (lastWheelMode === 1 ? 16 : lastWheelMode === 2 ? 80 : 1), dz: e.deltaZ || 0, mode: lastWheelMode,
      ctrl: !!e.ctrlKey, meta: !!e.metaKey, alt: !!e.altKey, shift: !!e.shiftKey, cx: lastWheelCX, cy: lastWheelCY, pid: pm ? pm.id : null, ptype: pm ? pm.type : '' };
    var cls = classify(wev); logEv(wev, cls);
    if (cal) return;   // STICK SETUP: learn, don't move
    var toLook = cls.look; lastWheelAt[toLook ? 'look' : 'move'] = lastWheelEvt;
    var hist = toLook ? lookHist : moveHist;
    // Keep signed pixel deltas in the hist so rate × magnitude is meaningful.
    var pdx = lastWheelDx, pdy = lastWheelDy;
    if (lastWheelMode === 1) { pdx *= 16; pdy *= 16; }
    else if (lastWheelMode === 2) { pdx *= 80; pdy *= 80; }
    pushHist(hist, pdx, pdy, lastWheelEvt);
    var a = analogFrom(hist, lastWheelEvt);
    lastRate = a.rate; lastPxps = a.pxps;
    if (toLook) ingestLook('wheel', a.x, a.y);
    else ingest('wheel', a.x, a.y);
  }

  function recen() {
    recentring = true;
    try {
      if (sentinel) { sentinel.scrollLeft = midSX; sentinel.scrollTop = midSY; }
      var se = document.scrollingElement || document.documentElement;
      if (se && (se.scrollLeft || se.scrollTop)) { se.scrollLeft = 0; se.scrollTop = 0; }
    } catch (e) {}
    recentring = false;
  }

  var lastScrollStamp = 0, lastScrollIn = 0;
  function onScroll(e) {
    var stamp = e.timeStamp || performance.now();
    if (stamp && stamp === lastScrollStamp) return;
    lastScrollStamp = stamp;
    bump('scroll');
    if (recentring) return;
    if (startUp()) { recen(); return; }
    if (pinchNow()) { recen(); return; }
    if (!isQuest() && lastDrag && performance.now() - lastDrag < 100) { recen(); return; }
    var isSent = sentinel && (e.target === sentinel);
    if (!isSent) { recen(); return; }
    var dx = (sentinel.scrollLeft || 0) - midSX, dy = (sentinel.scrollTop || 0) - midSY;
    recen();
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    lastScrollIn = performance.now();
    if (padStickAt && lastScrollIn - padStickAt < 600) { padWheelSkip++; return; }
    var sev = { src: 'scroll', dx: dx, dy: dy, dz: 0, mode: 0, cx: null, cy: null, pid: lastPtr.id != null && performance.now() - lastPtr.t < 3000 ? String(lastPtr.id) : null, ptype: lastPtr.type };
    var sc = classify(sev);
    if (dupOf(sc.look, performance.now())) return;   // t377u: the scroll a wheel on the same channel already counted
    logEv(sev, sc);
    if (cal) return;
    var h = sc.look ? lookHist : moveHist;
    pushHist(h, dx, dy, performance.now());
    var a = analogFrom(h, performance.now());
    lastRate = a.rate; lastPxps = a.pxps;
    if (sc.look) ingestLook('scroll', a.x, a.y); else ingest('scroll', a.x, a.y);
  }

  function onVV(kind) {
    bump(kind === 'scroll' ? 'vvscroll' : 'vvresize');
    var vv = root.visualViewport; if (!vv) return;
    var scale = vv.scale || 1;
    var x = vv.offsetLeft || 0, y = vv.offsetTop || 0;
    var dScale = scale - lastScale;
    var dx = x - lastVvX, dy = y - lastVvY;
    lastScale = scale; lastVvX = x; lastVvY = y;
    if (startUp()) return;
    if (pinchNow()) return;
    if (!isQuest() && lastDrag && performance.now() - lastDrag < 100) return;
    var nowV = performance.now();
    // Zoom in (scale up) -> forward (negative joy.y), matching "stick up zooms in".
    if (Math.abs(dScale) > 0.001) { if (!dupOf(true, nowV)) ingestLook('vvscale', 0, -clamp(dScale * 8, -1, 1)); }   // t377u: the zoom channel is LOOK; a walking wheel no longer mutes it
    else if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      var vev = { src: 'vvscroll', dx: dx, dy: dy, dz: 0, mode: 0, cx: null, cy: null, pid: lastPtr.id != null && performance.now() - lastPtr.t < 3000 ? String(lastPtr.id) : null, ptype: lastPtr.type };
      var vc = classify(vev); if (dupOf(vc.look, nowV)) return; logEv(vev, vc); if (cal) return;
      if (vc.look) ingestLook('vvscroll', clamp(dx / AXIS_SCALE, -1, 1), clamp(dy / AXIS_SCALE, -1, 1)); else ingest('vvscroll', clamp(dx / AXIS_SCALE, -1, 1), clamp(dy / AXIS_SCALE, -1, 1));
    }
  }

  function onGesture(e) {
    bump('gesture');
    if (e.cancelable) e.preventDefault();
    if (startUp() || fromStartUI(e)) return;
    if (e.type === 'gesturestart') { gestureScale0 = e.scale || 1; return; }
    var sc = e.scale || 1;
    var d = sc - (e.type === 'gestureend' ? sc : gestureScale0);
    if (e.type === 'gesturechange') gestureScale0 = sc;
    if (Math.abs(d) > 0.01) ingestLook('gesture', 0, -clamp(d * 4, -1, 1));
  }

  function touchDist(ev) {
    if (!ev || !ev.touches || ev.touches.length < 2) return 0;
    var a = ev.touches[0], b = ev.touches[1];
    return Math.hypot((a.clientX || 0) - (b.clientX || 0), (a.clientY || 0) - (b.clientY || 0));
  }

  function onTouch(e) {
    bump('touch');
    lastTouchAt = performance.now();
    var n = (e.touches && e.touches.length) || 0;
    touchCount = n;
    if (n < 2) lastDrag = 0;
    if (n >= 2) {
      var d = touchDist(e);
      if (e.type === 'touchstart' || !pinchDist0) { pinchDist0 = d; return; }
      var dd = d - pinchDist0;
      pinchDist0 = d;
      if (Math.abs(dd) > 2) {
        bump('pinch');
        if (e.cancelable) e.preventDefault();
        if (startUp() || fromStartUI(e)) return;
        ingestLook('pinch', 0, -clamp(dd / 80, -1, 1));
      }
    } else {
      pinchDist0 = 0;
    }
  }

  function attachWheel(el) {
    if (!el || !el.addEventListener) return;
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    el.addEventListener('mousewheel', onWheel, { passive: false, capture: true });
  }

  function installScrollCatcher() {
    try { document.documentElement.classList.add('gaQuest'); } catch (e) {}
    if (!document.body) return;
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = 'gaQscroll';
      sentinel.setAttribute('aria-hidden', 'true');
      var inner = document.createElement('div');
      inner.style.cssText = 'width:300%;height:300%';
      sentinel.appendChild(inner);
      document.body.appendChild(sentinel);
    }
    midSX = Math.floor((sentinel.scrollWidth - sentinel.clientWidth) / 2);
    midSY = Math.floor((sentinel.scrollHeight - sentinel.clientHeight) / 2);
    recen();
  }

  function unlockPads() {
    if (unlocked) return;
    unlocked = true;
    try { navigator.getGamepads && navigator.getGamepads(); } catch (e) {}
  }

  function applyListeners() {
    if (listenOn) return;
    listenOn = true;
    attachWheel(root);
    attachWheel(document);
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    var vv = root.visualViewport;
    if (vv) {
      try { lastScale = vv.scale || 1; lastVvX = vv.offsetLeft || 0; lastVvY = vv.offsetTop || 0; } catch (e) {}
      vv.addEventListener('resize', function () { onVV('resize'); });
      vv.addEventListener('scroll', function () { onVV('scroll'); });
    }
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
      addEventListener(t, onGesture, { capture: true, passive: false });
    });
    addEventListener('touchstart', onTouch, { capture: true, passive: false });
    addEventListener('touchmove', onTouch, { capture: true, passive: false });
    addEventListener('touchend', onTouch, { capture: true, passive: false });
    addEventListener('pointermove', function (e) {
      if (!e) return;
      notePointer(e); notePtrTrack(e);
      // Only a pressed-button move is a real drag. The Quest ray reports pointerType
      // "touch" (or a hovering "mouse") continuously and must not latch lastDrag.
      if (e.buttons) lastDrag = performance.now();
    }, true);
    addEventListener('pointerdown', function (e) { notePointer(e); notePtrTrack(e); }, true);
    addEventListener('pointerover', notePtrTrack, true);
    ['pointerup', 'pointercancel', 'mouseup'].forEach(function (t) {
      addEventListener(t, function (e) { lastDrag = 0; ptrUp(e); }, true);
    });
    ['pointerdown', 'mousedown', 'click', 'touchstart', 'keydown'].forEach(function (t) {
      addEventListener(t, function () { if (t !== 'keydown') bump('pointer'); unlockPads(); }, true);
    });
    addEventListener('gamepadconnected', function () { bump('gamepad'); unlockPads(); });
  }

  function listenKeys() {
    if (keyListenOn) return;
    keyListenOn = true;
    var moveCodes = /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|KeyW|KeyA|KeyS|KeyD|Space|ShiftLeft|ShiftRight)$/;
    addEventListener('keydown', function (e) {
      if (!e || !e.code) return;
      bump('key');
      heldKeys[e.code] = 1;
      if (moveCodes.test(e.code) && !keysOn[e.code]) {
        // Native arrow/WASD already move the arcade; still record source for ?qdbg=1.
        lastIngestSrc = lastIngestSrc === 'none' || !virtStick().mag ? 'key' : lastIngestSrc;
      }
    }, true);
    addEventListener('keyup', function (e) {
      if (!e || !e.code) return;
      delete heldKeys[e.code];
    }, true);
    addEventListener('blur', function () { heldKeys = Object.create(null); }, false);
  }

  function probeXR() {
    try {
      var xr = navigator.xr;
      if (!xr || !xr.isSessionSupported) return;
      ['inline', 'immersive-vr', 'immersive-ar'].forEach(function (m) {
        xr.isSessionSupported(m).then(function (ok) { xrInfo[m] = !!ok; }).catch(function () { xrInfo[m] = false; });
      });
    } catch (e) {}
  }

  function isPlayFrame() {
    try { if (window.frameElement && window.frameElement.id === 'game') return true; } catch (e) {}
    try {
      var p = location.pathname || '';
      if (/-play\//.test(p) || /sky-tower-play/.test(p)) return true;
    } catch (e2) {}
    return false;
  }

  function keyName(code) {
    return ({ KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', Space: ' ' })[code] || code;
  }

  function setKey(code, on) {
    on = !!on;
    if (!!keysOn[code] === on) return;
    keysOn[code] = on;
    try {
      var ev = new KeyboardEvent(on ? 'keydown' : 'keyup', { code: code, key: keyName(code), bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
    } catch (e) {}
  }

  function pressSel(sel, on) {
    var el;
    try { el = document.querySelector(sel); } catch (e) { return; }
    if (!el) return;
    try {
      var typ = on ? 'pointerdown' : 'pointerup';
      el.dispatchEvent(new PointerEvent(typ, { bubbles: true, cancelable: true, pointerId: 97, isPrimary: true, button: 0, buttons: on ? 1 : 0 }));
    } catch (e) {}
  }

  var prevBtn = { fire: false, fly: false, zoom: false };

  function applyPlay(s) {
    var mx = (s.move && s.move.x) || 0, my = (s.move && s.move.y) || 0;
    setKey('KeyA', mx < -0.35);
    setKey('KeyD', mx > 0.35);
    setKey('KeyW', my < -0.35);
    setKey('KeyS', my > 0.35);
    if (s.fire !== prevBtn.fire) {
      prevBtn.fire = !!s.fire;
      setKey('Space', prevBtn.fire);
      pressSel('#bFire, #fire, button[aria-label*="Fire" i], button[aria-label*="FIRE" i]', prevBtn.fire);
    }
    if (s.fly !== prevBtn.fly) {
      prevBtn.fly = !!s.fly;
      pressSel('#bFly, #fly, button[aria-label*="Fly" i], button[aria-label*="FLY" i]', prevBtn.fly);
    }
    if (s.zoom !== prevBtn.zoom) {
      prevBtn.zoom = !!s.zoom;
      pressSel('#bZoom, #zoom, button[aria-label*="Zoom" i], button[aria-label*="ZOOM" i]', prevBtn.zoom);
    }
  }

  // v23 (Dave t421u): flat Quest browser, Strike open: A / X (xr-standard button 4) = HYPER SPEED (KeyC into the game), like A in the headset.
  // The play iframe has no quest-pad of its own here, so the arcade page forwards it (B / Y = BOMB is the history-back trap above).
  var slowOn = false;
  function strikeSlow(s) { var on = !!s.slow; if (on === slowOn) return; slowOn = on; if (inXR()) return; var sw = strikeWin(); if (!sw) return;
    strikeKey(sw, 'KeyC', on); if (on) root.__gaQuestSlow = (root.__gaQuestSlow || 0) + 1; }
  function tick() {
    loopOn = true;
    var s;
    if (isQuest()) {
      if (!sentinel && document.body) installScrollCatcher();
      // v17: the ARENA canvas (the renderer's), never just the first <canvas> in the page: that was the 56 px OPTIONS icon in #ui,
      // stretched full-screen over the HUD, so on a Quest 2D tab it swallowed taps on PLAY CHESS and other buttons
      var AR = window.__arcade, cv = (AR && AR.renderer && AR.renderer.domElement) || document.querySelector('body>canvas');
      if (cv && !cv.__gaQWheel) { cv.__gaQWheel = 1; try { cv.classList.add('gaQuestRoom'); } catch (e) {} attachWheel(cv); }
      if (!lookBtn) ensureLookBtn();
      if (lookBtn) lookBtn.hidden = !SPLIT || !!startUp();
      if (!calBtn) ensureCalUi();
      if (calBtn) calBtn.hidden = !SPLIT || !!startUp();
      if (!turnBtns) ensureTurnBtns();
      if (turnBtns) { var th = !!startUp() || inXR() || document.body.classList.contains('nbPlay') || document.body.classList.contains('ingame'); for (var tb = 0; tb < turnBtns.length; tb++) turnBtns[tb].hidden = th; if (th) turnDir = 0; }
      if (turnDir) ingestLook('turn', turnDir * TURN_RATE, 0);
      s = read();
      if (isPlayFrame()) applyPlay(s);
      else strikeSlow(s);
    } else {
      s = { move: { x: 0, y: 0, mag: 0 }, look: { x: 0, y: 0, mag: 0 }, fire: false, fly: false, zoom: false, n: 0, source: 'none', keys: [], wheel: {}, counts: counts };
      if (prevBtn.fire || prevBtn.fly || prevBtn.zoom || keysOn.KeyW || keysOn.KeyA || keysOn.KeyS || keysOn.KeyD || keysOn.Space) {
        applyPlay({ move: { x: 0, y: 0, mag: 0 }, fire: false, fly: false, zoom: false });
      }
    }
    api.last = s;
    if (dbgOn) renderDebug(s);
    if (typeof api.onFrame === 'function') {
      try { api.onFrame(s); } catch (e) {}
    }
    requestAnimationFrame(tick);
  }

  function setLookStick(on) {
    lookToggle = !!on;
    if (lookBtn) {
      lookBtn.classList.toggle('on', lookToggle);
      lookBtn.textContent = lookToggle ? 'STICK LOOK' : 'STICK WALK';
      lookBtn.setAttribute('aria-pressed', lookToggle ? 'true' : 'false');
    }
    return lookToggle;
  }

  function ensureLookBtn() {
    if (lookBtn || !document.body || !isQuest()) return;
    lookBtn = document.createElement('button');
    lookBtn.id = 'gaQlook';
    lookBtn.type = 'button';
    lookBtn.textContent = 'STICK WALK';
    lookBtn.title = 'Default: plain stick scrolls walk. Tap to send plain stick to the camera (use if the right stick is also a plain wheel).';
    lookBtn.setAttribute('aria-pressed', 'false');
    lookBtn.addEventListener('click', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      setLookStick(!lookToggle);
    });
    document.body.appendChild(lookBtn);
  }

  var swInfo = '?';
  function probeSW() { try { var ctl = navigator.serviceWorker && navigator.serviceWorker.controller ? 'ctl' : 'no-ctl';
    if (root.caches && caches.keys) caches.keys().then(function (ks) { swInfo = (ks.filter(function (k) { return k.indexOf('nebula-arcade_vr-') === 0; }).join(',') || 'no cache') + ' ' + ctl; }).catch(function () { swInfo = ctl; }); else swInfo = ctl; } catch (e) {} }
  function start() {
    probeSW(); setInterval(probeSW, 5000);
    applyCss();
    applyListeners();
    listenKeys();
    listenBack();
    addEventListener('touchmove', function () { dragLook.lastTouch = performance.now(); }, true);
    addEventListener('mousemove', function (e) { if (e && e.buttons) dragLook.lastMouse = performance.now(); }, true);
    probeXR();
    if (document.body) { installScrollCatcher(); ensureLookBtn(); ensureCalUi(); }
    else document.addEventListener('DOMContentLoaded', function () { installScrollCatcher(); ensureLookBtn(); ensureCalUi(); });
    if (wantDebug()) showDebug(true);
    if (!loopOn) requestAnimationFrame(tick);
    return api;
  }

  var api = root.__gaQuestPad = {
    DEAD: DEAD,
    isQuest: isQuest,
    read: read,
    start: start,
    ingest: ingest,
    ingestLook: ingestLook,
    setLookStick: setLookStick,
    applyWheelBlock: applyListeners,
    applyCss: applyCss,
    isPlayFrame: isPlayFrame,
    showDebug: showDebug,
    classify: classify,
    calStart: calStart,
    calClear: calClear,
    get calib() { return calib; },
    get calibrating() { return cal ? cal.phase : null; },
    get evLog() { return evLog.slice(); },
    get lookSrc() { return lastLookSrc; }, VER: QVER, get split() { return SPLIT; }, get turn() { return { dir: turnDir, n: turnN }; }, setTurn: function (d) { turnDir = d | 0; if (d) turnN++; }, lookIgnored: lookIgn, get padWheelSkip() { return padWheelSkip; },
    back: backFire, bFire: bFire, get bFires() { return bFireN; },
    get backs() { return Object.assign({ last: backLast, trap: trapOn }, backN); },
    stickBusy: stickBusy,
    noteDragBlocked: function () { dragBlocked++; },
    get dragBlocked() { return dragBlocked; },
    get oneRay() { return { n: oneRay.n, hinted: oneRay.hinted }; },
    get dragLook() { return Object.assign({}, dragLook); },
    get hands() { return Object.assign({}, hands); },
    get lockLog() { return lockLog.slice(); },
    resetHands: function () { hands = {}; lockLog = []; },
    get rays() { var o = [], k; for (k in ptrs) o.push(Object.assign({}, ptrs[k])); return o; },
    last: null,
    onFrame: null
  };

  if (isQuest() || wantDebug()) start();
  else {
    try {
      addEventListener('gamepadconnected', function () { if (isQuest()) start(); });
    } catch (e) {}
  }
})(window);
