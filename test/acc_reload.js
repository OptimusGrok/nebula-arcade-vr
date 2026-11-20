// vrtest-v17 (t494u): after a v16-style stale cache of player.js, a v17 page must keep using the
// detailed v13 accessory builders across 3 reloads. The old SW could serve a stale player.js from
// another cache (ignoreSearch + caches.match across every cache) next to a new index.html, which
// rolled the hats back to the originals. Small viewport.
const { open } = require('./lib');

(async () => {
  let ok = true;
  const chk = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
  const { page, errors, close } = await open({
    w: 480, h: 270, start: true,
    init: () => { window.__gaSwSoon = 1; window.__gaKeepRoom = 1; },
  });

  const stats = () => page.evaluate(async () => {
    const A = window.__arcade, P = window.__gaPlayer;
    if (A && A.monkey && P && P.apply) try { P.apply(); } catch (e) {}
    const s = P && P.accessoryStats ? P.accessoryStats() : {};
    const keys = await caches.keys();
    return {
      build: window.__GA_ACC_BUILD || (P && P.accBuild) || null,
      oldAcc: !!(P && P.oldAcc),
      crown: s.crown || null,
      propeller: s.propeller || null,
      viking: s.viking || null,
      staleCaches: keys.filter(k => k.indexOf('nebula-arcade_vr-') === 0 && k !== 'nebula-arcade_vr-v29'),
      hasV27: keys.includes('nebula-arcade_vr-v29'),
    };
  });

  await page.waitForFunction(() => window.__arcade && window.__gaPlayer && window.__arcade.monkey, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const first = await stats();
  console.log('first', JSON.stringify(first));
  chk(first.build === 'v13detail' && !first.oldAcc, 'first load uses the v13 accessory builders ' + JSON.stringify({ build: first.build, oldAcc: first.oldAcc }));
  chk(first.crown && first.crown.tris >= 1000 && first.crown.meshes >= 5 && first.propeller && first.propeller.meshes >= 4, 'detailed meshes are present (crown/propeller) ' + JSON.stringify({ crown: first.crown, propeller: first.propeller }));
  const baseline = { crown: first.crown.meshes, propeller: first.propeller.meshes, viking: first.viking && first.viking.meshes };

  // Wait until the v18 SW is in control, then plant a STALE player.js in a leftover v16 cache
  // (the v16 bug: fallback searched every cache with ignoreSearch and could serve this file).
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 120000 }).catch(() => {});
  await page.evaluate(async () => {
    const stale = new Response('window.__GA_ACC_BUILD="stale-v16";window.__gaPlayer={oldAcc:true,accBuild:"stale-v16",accessoryStats:function(){return {crown:{meshes:2,tris:12,mats:1}};}};', { headers: { 'content-type': 'text/javascript' } });
    const c = await caches.open('nebula-arcade_vr-v25');
    await c.put(new Request(new URL('player.js', location.href).href), stale.clone());
    await c.put(new Request(new URL('player.js?v=27', location.href).href), stale.clone());
    await c.put(new Request('player.js'), stale);
  });

  const waitArcade = async () => {
    for (let i = 0; i < 8; i++) {
      try {
        await page.waitForFunction(() => window.__arcade && window.__gaPlayer && window.__arcade.monkey, null, { timeout: 60000 });
        return;
      } catch (e) {
        if (i === 7 || !/Execution context was destroyed|frame was detached/i.test(String(e))) throw e;
      }
    }
  };
  for (let n = 1; n <= 3; n++) {
    await page.reload({ timeout: 120000 });
    await waitArcade();
    await page.waitForTimeout(400);
    const s = await stats();
    console.log('reload ' + n, JSON.stringify(s));
    chk(s.build === 'v13detail' && !s.oldAcc, 'reload ' + n + ': still the v13 builders (not the stale v16 player.js) ' + JSON.stringify({ build: s.build, oldAcc: s.oldAcc }));
    chk(s.crown && s.crown.meshes === baseline.crown && s.propeller && s.propeller.meshes === baseline.propeller,
      'reload ' + n + ': detailed mesh counts unchanged ' + JSON.stringify({ crown: s.crown, propeller: s.propeller, baseline }));
    chk(!s.staleCaches.length, 'reload ' + n + ': leftover vrtest caches were cleaned up (' + s.staleCaches.join(',') + ')');
  }

  chk(!errors.filter(e => !/Failed to load|supabase|net::/i.test(e)).length, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await close();
  console.log(ok ? 'ALL OK' : 'SOME FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
