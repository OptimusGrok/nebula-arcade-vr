// vrtest-v11 (Chief's v256 precache trim): the SW no longer installs the jpg/webp behind each KTX2. If a KTX2 transcode fails while OFFLINE,
// pictures must still show: photo textures fall back to their jpg/webp (cached in the background after install) and baked posters paint
// themselves. Load once online (SW installs), go offline, reload with ?ktxfail=1 (every transcode 'fails'), check no picture is left blank.
const { open } = require('./lib');
(async () => {
  let ok = true; const chk = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
  const T0 = Date.now(), lg = m => console.log('[' + Math.round((Date.now() - T0) / 1000) + 's] ' + m);
  const o = await open({ w: 480, h: 270, supa: r => (/^http:\/\/localhost/.test(r.request().url()) ? r.continue() : r.abort()),   // local vendor/supabase.js must load so the SW install (addAll) succeeds
    init: () => { window.__gaSwSoon = 1; } }); const { page, errors } = o; lg('booted');   // register the SW right after the first frames (as sw_reload.js)
  try {
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then(r => !!(r && r.active)), null, { timeout: 120000 }); lg('sw active');
    const sw = await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); const want = (await (await fetch('sw.js')).text()).match(/const FALLBACKS=\[([^\]]*)\]/)[1].split(',').map(x => x.replace(/'/g, ''));
      const t0 = Date.now(); let have = 0, keys = [];
      while (Date.now() - t0 < 60000) { keys = await caches.keys(); const c = await caches.open(keys.find(k => k.startsWith('nebula-arcade_vr-')));
        have = 0; for (const u of want) if (await c.match(u)) have++; if (have === want.length) break; await new Promise(r => setTimeout(r, 1000)); }
      return { active: !!reg.active, want: want.length, have, keys }; });
    chk(sw.active && sw.have === sw.want, 'SW active, KTX2 fallbacks cached in the background after install ' + JSON.stringify(sw));
    lg('sw'); await page.context().setOffline(true);
    const url = page.url().split('?')[0] + '?ktxfail=1';
    await page.goto(url, { timeout: 120000 });
    await page.waitForFunction(() => window.__arcade && window.__arcade.stats && window.__arcade.stats.frames > 3, null, { timeout: 120000 });
    lg('offline boot'); await page.waitForTimeout(12000);
    const r = await page.evaluate(() => { const A = window.__arcade, seen = new Set(), blank = [], kinds = {};
      const roots = [A.scene]; if (A.shop && A.shop.group && !A.shop.group.parent) roots.push(A.shop.group);
      for (const root of roots) root.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) for (const k of ['map', 'emissiveMap']) { const t = m[k]; if (!t || seen.has(t) || t.isRenderTargetTexture || t.isVideoTexture || t.isDataTexture) continue; seen.add(t);
        const kind = t.isCompressedTexture ? 'ktx' : t.image && t.image.getContext ? 'canvas' : t.image && t.image.tagName ? t.image.tagName : t.image ? 'other' : 'none'; kinds[kind] = (kinds[kind] || 0) + 1;
        const empty = t.isCompressedTexture ? !(t.mipmaps && t.mipmaps[0] && t.mipmaps[0].data) : !(t.image && (t.image.width || t.image.videoWidth) > 4); if (empty && !/^vrChess/.test(o.name || '')) blank.push((o.name || '?') + '/' + k); } });   // VR chess panels are 1x1 on purpose until you sit down (TEST v1 chessMem), not pictures
      return { fails: window.__ktxStats && window.__ktxStats.fails, blank, kinds, offline: !navigator.onLine }; });
    chk(r.offline && r.fails > 10, 'offline, every KTX2 transcode failed ' + JSON.stringify({ fails: r.fails, offline: r.offline }));
    chk(r.blank.length === 0 && !r.kinds.ktx, 'no picture left blank: all fell back to images / painted canvases ' + JSON.stringify({ kinds: r.kinds, blank: r.blank.slice(0, 12) }));
  } catch (e) { chk(false, 'exception ' + e.message.split('\n')[0]); }
  chk(errors.filter(e => !/supabase|net::|Failed to load|ktxfail|ERR_INTERNET/i.test(e)).length === 0, 'no page errors ' + JSON.stringify(errors.filter(e => !/supabase|net::|Failed to load|ktxfail|ERR_INTERNET/i.test(e)).slice(0, 3)));
  await o.close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.log('FAIL exception ' + e.message); process.exit(1); });
