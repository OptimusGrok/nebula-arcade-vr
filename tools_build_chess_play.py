# Builds chess-play/index.html: the playable CHESS for the Nebula Arcade VR chess table (Grok's shop, between the ACCESSORIES
# wardrobe and the pool tables). Source: /workspace/chess/src (live https://optimusgrok.github.io/chess/, repo OptimusGrok/chess),
# READ ONLY: the inlining is done here in memory (same as its build.sh), nothing is written into the chess folder and the original
# never gets tickets. Arcade copy only: own storage keys (arcade_chess.*), tickets for a win vs the Computer + the VR painter
# (tools_chess_arcade.js), offline guard, watch-shim + vr-frame-shim. Pieces, battles, robot hand and settings are unchanged.
# Rerun (then python3 tools_vr_inject_shim.py) on every Chess update.
import re, sys, os, hashlib
sys.path.insert(0, 'tools'); from hooks import inject, require, verify, fail
N = 'chess'; SRC = '/workspace/chess/src'
rd = lambda f: open(os.path.join(SRC, f), encoding='utf-8').read()
t = rd('template.html')
for k, f in [('/*STYLE*/', 'style.css'), ('/*ENGINE*/', 'engine.js'), ('/*UI*/', 'ui.js')]:
    if t.count(k) != 1: fail(N, 'template:' + k, 'placeholder missing')
    t = t.replace(k, rd(f).strip())
if re.search(r'</script>', rd('engine.js'), re.I): fail(N, 'engine', 'engine.js contains </script>')
s = t
sys.stderr.write(f'note [{N}]: source sha1 {hashlib.sha1(s.encode()).hexdigest()[:12]}\n')
s = re.sub(r'<link rel="(manifest|apple-touch-icon|icon)"[^>]*>', '', s)
s = s.replace("'serviceWorker' in navigator", "false").replace('"serviceWorker" in navigator', 'false')
urls = [u for u in re.findall(r'https?://[^\s"\')<]+', s) if not u.startswith('http://www.w3.org/')]
if urls: fail(N, 'offline', f'original now loads {urls[:3]}')
for h, pat in [('api:chessApp', r'window\.chessApp = \{'), ('api:undo', r'newGame: newGame, undo: undo'), ('api:over', r'get over\(\) \{ return over; \}'),
               ('api:ended', r'get ended\(\) \{ return ended; \}'), ('api:cfg', r'get cfg\(\) \{ return cfg; \}'), ('dom:undoBtn', r'id="undoBtn"'),
               ('dom:board', r'id="board"'), ('dom:frame', r'id="frame"'), ('css:rfx', r'\.rfx\{'), ('css:bfx', r'\.bfx\{'), ('sym', r"'<symbol id=\"pc-' \+ k \+ t")]:
    require(s, N, h, pat)
keys = sorted(set(re.findall(r"'(chess\.[\w.]+)'", s)))
if keys != ['chess.prefs.v1', 'chess.save.v2']: fail(N, 'storage keys', f'unexpected keys {keys}')
for k in keys: s = s.replace("'" + k + "'", "'arcade_" + k + "'")
s = inject(s, N, 'tickets+vr', '</body>', '<script>' + open('tools_chess_arcade.js').read() + '</script>\n</body>')
g = open('tools_play_guard.html').read().replace("||x.origin==='https://kfupqtafhaflzaoqtenf.supabase.co'", "")
assert 'supabase' not in g
s = s.replace('<head>', '<head><script src="../watch-shim.js"></script>' + g, 1)
verify(s, N, ['window.__chessArcade', 'window.__chessVR', '__chessWin', 'arcade_chess.save.v2', 'arcade_chess.prefs.v1', 'watch-shim.js'])
os.makedirs('chess-play', exist_ok=True)
open('chess-play/index.html', 'w', encoding='utf-8').write(s)
print('ok', len(s))
