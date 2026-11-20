/* t855u: an old cache of THIS edition must reload once before START is interactive, and must never kick the player back after they have started.
   Galactic Arcade VR: only nebula-arcade_vr-* caches are ever deleted; the live game's galactic-arcade-v* and the test copy's
   galactic-arcade-test-* caches (same optimusgrok.github.io origin) must survive the head script, the delayed SW path and sw.js activate. */
const { open } = require('./lib');

(async () => {
  let ok = true;
  const chk = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };

  // 1) Seed an old cache on the first document only. Expect exactly one reload, then a stable arcade.
  const { page, errors, close } = await open({
    w: 800, h: 450,
    supa: r => (/^http:\/\/localhost/.test(r.request().url()) ? r.continue() : r.abort()),   // let the local vendor/supabase.js through so sw.js can precache (only the remote host is blocked)
    start: true,   // start screen stays up so we can see it wasn't dismissed mid-boot
    init: () => {
      if (window !== window.top) return;   // cabinet demo iframes share sessionStorage
      const n = Number(sessionStorage.getItem('gaLoadN') || 0) + 1;
      sessionStorage.setItem('gaLoadN', String(n));
      window.__gaLoadN = n;
      window.__gaSwSoon = 1;   // register the delayed SW immediately after first frames
      if (n !== 1) return;
      const put = k => caches.open(k).then(c => c.put(new Request('/__ga_stale__'), new Response('old', { headers: { 'content-type': 'text/plain' } })));
      return Promise.all(['nebula-arcade_vr-v0', 'nebula-arcade_vr-v1', 'nebula-arcade_vr-v2', 'nebula-arcade_vr-v3', 'nebula-arcade_vr-v4', 'nebula-arcade_vr-v8', 'nebula-arcade_vr-v11', 'nebula-arcade_vr-v10', 'nebula-arcade_vr-v9', 'nebula-arcade_vr-v12', 'nebula-arcade_vr-v15', 'nebula-arcade_vr-v16', 'galactic-arcade-v233', 'galactic-arcade-v199', 'galactic-arcade-test-v9', 'galactic-arcade_vrtest-v18'].map(put));
    },
  });

  const a = await page.evaluate(async () => {
    const keys = await caches.keys();
    const S = window.__start || {};
    return {
      loadN: Number(sessionStorage.getItem('gaLoadN') || 0),
      flag: sessionStorage.getItem('gavrReloaded.nebula-arcade_vr-v29'),
      stale: keys.filter(k => k.indexOf('nebula-arcade_vr-') === 0 && k !== 'nebula-arcade_vr-v29'),
      live: ['galactic-arcade-v233', 'galactic-arcade-v199', 'galactic-arcade-test-v9', 'galactic-arcade_vrtest-v18'].filter(k => keys.includes(k)),
      updating: document.documentElement.classList.contains('ga-updating'),
      checked: !!(window.__gaUpdate && window.__gaUpdate.checked),
      reloading: !!(window.__gaUpdate && window.__gaUpdate.reloading),
      startShown: !!(S.shown && !S.dismissed && document.getElementById('start')),
      dismissed: !!S.dismissed,
      frames: (window.__arcade && window.__arcade.stats && window.__arcade.stats.frames) || 0,
    };
  });
  console.log('after boot', JSON.stringify(a));
  chk(a.loadN === 2, 'stale cache caused exactly one reload (loadN=' + a.loadN + ')');
  chk(a.flag === '1', 'session guard gavrReloaded.nebula-arcade_vr-v29 is set');
  chk(a.stale.length === 0, 'old nebula-arcade_vr-* caches are gone (' + a.stale.join(',') + ')');
  chk(a.live.length === 4, 'live, test and VR test-link (galactic-arcade_vrtest-v18) caches untouched by the VR head script (' + a.live.join(',') + ')');
  chk(!a.updating && a.checked && !a.reloading, 'start screen is no longer blocked after the reload');
  chk(a.startShown && !a.dismissed, 'still on the start screen (not kicked mid-play)');
  chk(a.frames > 3, 'room is drawing behind the start screen');

  // Wait through the delayed SW registration. It must not reload again.
  await page.waitForTimeout(2500);
  const b = await page.evaluate(() => ({
    loadN: Number(sessionStorage.getItem('gaLoadN') || 0),
    dismissed: !!(window.__start && window.__start.dismissed),
    start: !!document.getElementById('start'),
    frames: (window.__arcade && window.__arcade.stats && window.__arcade.stats.frames) || 0,
  }));
  console.log('after delayed SW', JSON.stringify(b));
  chk(b.loadN === 2, 'delayed SW registration did not reload again (loadN=' + b.loadN + ')');
  chk(!b.dismissed && b.start, 'still on the start screen after delayed SW');
  chk(b.frames > a.frames, 'frames kept advancing (no mid-session bounce)');
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then(r => r && r.active), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const c = await page.evaluate(async () => ({ keys: await caches.keys(), scope: (await navigator.serviceWorker.getRegistration() || {}).scope || null, active: !!((await navigator.serviceWorker.getRegistration()) || {}).active }));
  console.log('after SW activate', JSON.stringify(c));
  chk(c.active && c.keys.includes('nebula-arcade_vr-v29'), 'VR service worker active with its own cache nebula-arcade_vr-v29');
  chk(['galactic-arcade-v233', 'galactic-arcade-v199', 'galactic-arcade-test-v9', 'galactic-arcade_vrtest-v18'].every(k => c.keys.includes(k)), 'sw.js activate + delayed SW path left the live / test caches alone');
  chk(errors.filter(e => !/Failed to load|supabase|net::/i.test(e)).length === 0, 'no page errors ' + errors.join(' | '));
  await close();

  // 2) Already playing, then a leftover old cache appears: delayed SW must delete it, not reload.
  const mid = await open({
    w: 800, h: 450,
    init: () => { window.__gaSwSoon = 1; },
  });
  const before = await mid.page.evaluate(async () => {
    await caches.open('nebula-arcade_vr-v0b').then(c => c.put(new Request('/__ga_stale2__'), new Response('old'))); await caches.open('galactic-arcade-v198').then(c => c.put(new Request('/__ga_stale2__'), new Response('live')));
    const frames = window.__arcade.stats.frames;
    const href = location.href;
    if (typeof window.__gaRegisterSW === 'function') window.__gaRegisterSW();
    return { frames, href, startDismissedSkip: !!window.__skipStart };
  });
  await mid.page.waitForTimeout(2000);
  const after = await mid.page.evaluate(async () => {
    const keys = await caches.keys();
    return {
      frames: window.__arcade && window.__arcade.stats.frames,
      href: location.href,
      arcade: !!window.__arcade,
      stale: keys.filter(k => k === 'nebula-arcade_vr-v0b'), live: keys.includes('galactic-arcade-v198'),
      start: !!document.getElementById('start') && !window.__skipStart,
    };
  });
  console.log('mid-session', JSON.stringify({ before, after }));
  chk(after.arcade && after.frames > before.frames, 'mid-session SW path kept the arcade running (frames ' + before.frames + ' -> ' + after.frames + ')');
  chk(after.href === before.href, 'mid-session SW path did not reload the page');
  chk(after.stale.length === 0, 'mid-session leftover VR cache was deleted without a reload');
  chk(after.live, 'mid-session: the live galactic-arcade-v198 cache was NOT touched');
  chk(!after.start, 'did not bounce back to the start screen mid-session');
  await mid.close();

  console.log(ok ? 'ALL OK' : 'SOME FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
