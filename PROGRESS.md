
## t253 PORTALS in room 2 + hallway (sw v109)
- setWalls: room 2 walls R2_WALLS swap to the shared portalMat (window wall 1 stays hidden/window); hallway W/E walls use portalWallsHall (portalMat clone, uv scaled HALL_L x DOOR_H, shared portalU uniforms); originals restored via userData.mat0; medieval hallway code reads mat0.
- Draw calls in room 2 (phone): current 229 -> portals 223.
- test/portals_room2.js (phone 412x915), shots/portals_{room2_wide,room2_back,room2_window,hall}_phone.png

## Unique player names (Dave via Chief, sw v111)
- Supabase (kfupqtafhaflzaoqtenf): table public.player_names (RLS on, no policies, anon revoked) + SECURITY DEFINER RPCs claim_name(p_name,p_owner,p_legacy) -> ok/taken/bad and name_free(p_name,p_owner). SQL: supabase/migrations/20261105_player_names.sql
- names.js (new, classic script before player.js): owner = secret neonarcade.nameKey (not the broadcast mpId); ET reserved ('__reserved__'), grandfathered via neonarcade.nameLegacy set on first load when galacticarcade.player.name was ET; offline -> fail open + mp presence check.
- player.js (start box + PLAY gating only): debounced check, 'Name taken' hint, PLAY hidden until free; PLAY claims.
- test/names.js all pass; start.js phone + multiplayer.js pass.

## VR v24 (Dave t435u / t437u, sw galactic-arcade_vr-v24)
- Strike HUD: A HYPER SPEED + B BOMB buttons side by side at the TOP RIGHT, bomb icons at the TOP LEFT, both just under the black HUD bar (solo y 62 / co-op y 66; icons y 47 / 54), see-through (fill x0.45, ring 0.6, text 0.8, badges 0.85). layBtns() moves the hit areas too.
- A bug (headset): the A press that starts the cabinet (demo -> play) stayed held into play, so vr.js sent KeyC on the first play frame and Strike burned its one HYPER SPEED (8 s) during the stage intro, then a 60 s recharge ate every later A. Fix: vr.js S.aLatch, A must be released after the start before it counts. Strike toasts "HYPER SPEED RECHARGING Ns" when A hits the recharge.
- Flat Quest: getGamepads() is empty in the 2D Quest Browser (Dave's own ?qdbg overlay), so A cannot reach a page there; the on-screen HYPER SPEED button (laser click) is the flat path. Old non xr-standard pad layout (A = 3) now maps to HYPER SPEED in vr.js + quest-pad.js.
- test/strike_v24.js (layout solo + co-op, real start flow with A held, enemy clock + px drop while A held, X, legacy index).

## VR v25 (Dave t442u / t443u, sw galactic-arcade_vr-v25)
- Strike: P1 / P2 labels at the bottom of the co-op screen removed (top names / scores untouched). A / B buttons r 21 -> 13, side by side in the top-right corner (B at W-16, A at W-46, y 53 solo / 58 co-op), count / status only inside + small A / B badges; hit areas follow r.
- B laser bug: roomfire.js only fires while its FIRE button is "shown", and canShow() needs #bZoom 'on'. main.js skipped syncZoomBtn() while in XR, so after v18's PLAY -> straight into VR the flat HUD never ran and #bZoom stayed off: B never fired (older tests entered VR from a walking flat game, so it was already on). main.js now syncs #bZoom in XR too.
- Room controls (headset): Y (left) = menu open / close, always; B (right) = gun fire only (gear()), nothing without the gun (B no longer opens the menu). NK B / Y pause, Strike B bomb, Neon Bricks, chess, golf unchanged.
- Flat Quest (B / Y = trapped history back, the browser can't tell them apart): walking in the room, B fires the gun's FIRE button only while it is shown, else nothing (was Space = jump). In games / Neon Bricks unchanged.
- test/vr_bfire_v25.js (real PLAY -> VR start; B with gun off / on / off, Y menu; flat Quest B gun off / on). Older tests that opened the menu with B now use Y.

## VR v26 (Dave t499u, sw galactic-arcade_vr-v26)
- App name is Galactic Arcade (manifest name + short_name, page title, apple-mobile-web-app-title).
- Full-bleed black app icons (192 / 512 / 180 apple-touch, plus a 512 maskable): the neon hexagon sits in the 80% safe zone and the black fills the tile edge to edge. theme_color / background_color are #000000 so Quest does not add a white plate.
- Icons and the manifest are precached with ?v=26.

## VR v27 (Dave t501u / t502u, sw galactic-arcade_vr-v27)
- Everything from the VR test link (galactic-arcade-vr-test vrtest v1-v18, merged as history) is now on the main link: streaming + memory cuts, Chief's v256 ports (KTX2 posters / icon atlas, mono music, trimmed precache), light-set fixes, PREPARING VR card + audio / greeting hold, golf putter + sign removal, wrist HUD, Meta-menu pause, BACK TO TITLE, Rockfall / Sky Tower music, Chief's cabinet tracks, dimmed shop whites, detailed accessories, prize thumbnails, right-stick fire-type wheel, left-stick HUD toggle, SW update + cache fixes, NEON KNOCKOUT second pad (shop-only first pad), BEAM TO signs removed.
- Main-only differences from the test tree: cache galactic-arcade_vr-v27 / prefix galactic-arcade_vr- (index.html head + register scripts, sw.js, quest-pad.js debug, tests), ?v=27, __GA_VR vr27, title "Galactic Arcade", no MEMORY TEST banner. Debug ?flags kept. The v17 stale-player.js fix now only unregisters this edition's own SW scope (not other optimusgrok.github.io apps). sw_reload checks galactic-arcade_vrtest-* caches survive.
- Icons (icons/make_icons.py): 192 / 512 / 180 are full-size art (outer hexagon ~2% from the top / bottom edges; a pointy-top hexagon is 0.87 as wide as tall); maskable 512 keeps the logo inside the 80% safe circle. Rings are filled bands (mitred corners). The Quest's white tile around web-app icons is drawn by the Quest.
- Memory, emulated Quest 3 (test/vr_mem.js from the test repo, GA_ROOT, room1 / shop / nk / play=Strike), v26 -> v27: GPU textures 205.7 -> 92.1 MB (-113.6; KTX2 11.6 of it), render targets 16.4 -> 7.8 MB, geometry 19.1 -> 21.0 MB, JS heap ~70-74 -> ~82-87 MB, GPU process RSS -97 to -186 MB. Decoded audio alive after GC: room 1 43.9 -> 16.2, Strike cabinet 58.1 -> 16.4, NK 58.1 -> 2.1 MB. Precache 173 files 15.65 MB -> 184 files 16.72 MB.

## VR v28 (Dave t506u, sw galactic-arcade_vr-v28)
- Neon Knockout changes from the test link (vrtest-v20, galactic-arcade-vr-test f605014) on the main VR link: SCENERY option (NEON STUDIO /
  CYBERPUNK ROOFTOP, nk/rooftop.js, galacticarcade.nkScenery, ?norooftop=1) via the SCENERY orb, the Y menu in Neon Knockout and the flat button;
  NK menu orbs pointable (TRIGGER or A); footprint outline at the stand spot (?nofeet=1). nk/rooftop.js precached. Details: vrtest-v20 notes in the test repo.
- test/nk_scenery_v20.js + test/vr_start_play.js pass on this build. Emulator: studio 358 draw calls / rooftop 272; worst switch frame 34 ms (median 16.6).

## VR v29: renamed to NEBULA ARCADE, new link https://optimusgrok.github.io/nebula-arcade-vr/ (Dave via Chief, sw nebula-arcade_vr-v29)
- Why: Meta Horizon Worlds already uses the name Galactic Arcade. The normal game moves to /nebula-arcade/ (Chief, v260).
- Content = main v28 (galactic-arcade-vr bd30e89) exactly (none of the vrtest-v22..v25 features), plus only the rename:
  title / apple title / start aria-label + alt / landscape hint (index.html), manifest name + short_name, the start overlay logo
  (player.js: NEBULA / ARCADE), Grok's 'who built this' answer (grokchat.js), the ticket art text NEBULA ARCADE (ticket-art.js,
  tools_ticket_art.js and every *-play page), the rooftop neon sign 'NEBULA' (nk/rooftop.js), the start picture img/start.webp/.jpg
  and the shop title wall tex/shop_title_wall.jpg (+ tex/ktx2/shop_title_wall.ktx2 rebuilt with the same toktx settings as
  tools/build_ktx2.py), and the PA welcome voice audio/pa_welcome.m4a/.ogg ("Welcome to Nebula Arcade. ...", same voice cloned from the
  old clip, same loudness -17.5 LUFS). The app icon has no text (unchanged). Comments saying Galactic Arcade were renamed too.
- Kept on purpose (same origin, so everything carries over): localStorage keys galacticarcade.* / neonarcade.*, the
  galactic-arcade-public multiplayer channel, Supabase tables / RPCs / rooms, internal identifiers (__gaVR, ga* names). 'Galactic Golf' is
  a game name, unchanged.
- Cache family is now nebula-arcade_vr-* (underscore, so the normal game's nebula-arcade-v* cleanup never matches it); ?v=29 on every tag.
- Old link https://optimusgrok.github.io/galactic-arcade-vr/ is now a redirect page (query + hash kept) with a self-destructing sw.js
  (deletes only galactic-arcade_vr-* caches, unregisters, navigates its windows here). As a belt-and-braces step this build's delayed SW path
  also unregisters the worker whose scope is exactly /galactic-arcade-vr/ and deletes galactic-arcade_vr-* caches (nothing else).
- Tests: test/start.js now expects the title 'Nebula Arcade'; test/sw_reload.js + test/acc_reload.js use nebula-arcade_vr-v29.
