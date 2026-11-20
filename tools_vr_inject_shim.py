#!/usr/bin/env python3
"""Nebula Arcade VR: put <script src="../vr-frame-shim.js"></script> first in every cabinet game page.
Idempotent; re-run after rebuilding any *-play / *-demo copy with the tools_build_*.py scripts."""
import glob, os, re, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
TAG = '<script src="../vr-frame-shim.js"></script>'
pages = sorted(glob.glob(os.path.join(ROOT, '*-play', 'index.html')) + glob.glob(os.path.join(ROOT, '*-demo', 'index.html')))
for p in pages:
    s = open(p, encoding='utf-8').read()
    if 'vr-frame-shim.js' in s: print('ok    ', os.path.relpath(p, ROOT)); continue
    m = re.search(r'<head[^>]*>', s, re.I)
    if m: s = s[:m.end()] + TAG + s[m.end():]
    else:
        m = re.search(r'<html[^>]*>', s, re.I) or re.search(r'<!doctype[^>]*>', s, re.I)
        s = (s[:m.end()] + TAG + s[m.end():]) if m else TAG + s
    open(p, 'w', encoding='utf-8').write(s); print('added ', os.path.relpath(p, ROOT))
