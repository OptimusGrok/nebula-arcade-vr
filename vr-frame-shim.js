// Nebula Arcade VR: loaded first inside every cabinet game iframe (same origin).
// While the parent page is in an immersive WebXR session, a headset browser may pause window.requestAnimationFrame
// for the page and its iframes. This wraps the iframe's requestAnimationFrame so the parent's XR frame loop can run
// the game's frame callbacks itself (window.__gaVRPump), in the same task that then copies the game canvas into a
// texture (that also keeps WebGL game canvases readable without preserveDrawingBuffer).
// Outside VR (or opened on its own) every callback still runs from the normal requestAnimationFrame.
(function () {
  var P = null; try { P = window.parent; if (!P || P === window) return; void P.document; } catch (e) { return; }
  var nat = window.requestAnimationFrame.bind(window), natC = window.cancelAnimationFrame.bind(window);
  var q = new Map(), seq = 0;
  function xr() { try { var X = P.__gaVR; return !!(X && X.presenting); } catch (e) { return false; } }
  window.requestAnimationFrame = function (cb) {
    var id = ++seq, e = { cb: cb, done: false, nid: 0 }; q.set(id, e);
    e.nid = nat(function (t) { if (e.done || xr()) return; e.done = true; q.delete(id); e.cb(t); });   // in XR the pump owns it
    return id;
  };
  window.cancelAnimationFrame = function (id) { var e = q.get(id); if (e) { e.done = true; natC(e.nid); q.delete(id); } };
  window.__gaVRPump = function () {
    if (!q.size) return 0; var list = Array.from(q.values()), t = performance.now(), n = 0; q.clear();
    for (var i = 0; i < list.length; i++) { var e = list[i]; if (e.done) continue; e.done = true; natC(e.nid); n++;
      try { e.cb(t); } catch (err) { setTimeout(function () { throw err; }); } }
    return n;
  };
  window.__gaVRShim = 1;
})();
