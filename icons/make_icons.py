# Nebula Arcade icons: nested neon hexagons on full-bleed black.
# v27 / vrtest-v19 (t501u/t502u): the 'any' icons (192, 512, 180 apple-touch) are full-size art: the outer pink hexagon
# runs to within ~2% of the top and bottom edges (a pointy-top hexagon is 0.87 as wide as it is tall, so the sides keep
# a little black). The maskable 512 keeps the whole logo inside the 80% safe zone so launchers can crop it to a circle.
# The Quest draws its own white rounded tile around web-app icons; that frame is not part of these files.
# Rings are filled hexagonal bands (crisp mitred corners, no notches at the vertices).
from PIL import Image, ImageDraw, ImageFilter
import math, os

BG = (0, 0, 0)
COLS = [(255, 43, 214), (34, 216, 255), (255, 165, 58)]
CENTRE = [0.38, 0.285, 0.195]      # ring centre-line circumradius at the maskable (safe-zone) scale
STROKE = 0.040                     # band thickness measured across an edge, as a fraction of the icon size
C30 = math.cos(math.pi / 6)

def hex_pts(cx, cy, r):
    return [(cx + r * math.cos(math.pi / 3 * k - math.pi / 2), cy + r * math.sin(math.pi / 3 * k - math.pi / 2)) for k in range(6)]

def outer_extent(scale):           # how far the outer pink vertex reaches from the centre (fraction of size)
    return CENTRE[0] * scale + STROKE * scale / 2 / C30

def make(size, name, full):
    # full: outer vertex at 0.48 of the size (2% margin); maskable: outer vertex at 0.40 (inside the 80% safe circle)
    scale = (0.48 if full else 0.40) / outer_extent(1.0)
    c = size / 2
    def band(draw, i, col, extra=0.0):
        r = CENTRE[i] * scale * size; hw = (STROKE * scale * size / 2 + extra) / C30
        draw.polygon(hex_pts(c, c, r + hw), fill=col); draw.polygon(hex_pts(c, c, max(0.0, r - hw)), fill=BG)
    glow = Image.new('RGB', (size, size), BG); dg = ImageDraw.Draw(glow)
    for i, col in enumerate(COLS): band(dg, i, col, extra=size * 0.012)
    blur = glow.filter(ImageFilter.GaussianBlur(max(2, size / 26)))
    im = Image.composite(blur, Image.new('RGB', (size, size), BG), blur.convert('L').point(lambda v: min(255, int(v * 1.4))))
    d = ImageDraw.Draw(im)
    for i, col in enumerate(COLS): 
        # draw outer->inner so each band's BG hole doesn't erase the next ring's glow: redraw only the band area
        r = CENTRE[i] * scale * size; hw = STROKE * scale * size / 2 / C30
        mask = Image.new('L', (size, size), 0); dm = ImageDraw.Draw(mask)
        dm.polygon(hex_pts(c, c, r + hw), fill=255); dm.polygon(hex_pts(c, c, r - hw), fill=0)
        im.paste(col, (0, 0), mask)
    px = im.load()
    for y in range(size):
        for x in range(size):
            p = px[x, y]
            if p[0] < 8 and p[1] < 8 and p[2] < 8: px[x, y] = BG
    im.save(name, 'PNG', optimize=True)
    return scale

def build(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    spec = [('icon-192.png', 192, True), ('icon-512.png', 512, True), ('icon-maskable-512.png', 512, False), ('apple-touch-icon.png', 180, True)]
    for fn, sz, full in spec: make(sz, os.path.join(out_dir, fn), full)
    for fn, sz, full in spec:
        im = Image.open(os.path.join(out_dir, fn)).convert('RGB'); w, h = im.size
        assert im.size == (sz, sz), (fn, im.size)
        corners = [im.getpixel((0, 0)), im.getpixel((w-1, 0)), im.getpixel((0, h-1)), im.getpixel((w-1, h-1))]
        assert all(p == BG for p in corners), (fn, corners)
        ys = [y for y in range(h) for x in range(w) if max(im.getpixel((x, y))) >= 200]
        xs = [x for y in range(h) for x in range(w) if max(im.getpixel((x, y))) >= 200]
        top, bot, lft, rgt = min(ys) / h, 1 - (max(ys) + 1) / h, min(xs) / w, 1 - (max(xs) + 1) / w
        if full: assert top < 0.035 and bot < 0.035, (fn, 'art not full height', top, bot)
        else:
            cx = cy = sz / 2; far = max(math.hypot(x + .5 - cx, y + .5 - cy) for y in range(h) for x in range(w) if max(im.getpixel((x, y))) >= 200)
            assert far <= 0.40 * sz + 1, (fn, 'bright ink outside the maskable safe circle', far / sz)
        print(f'  OK {fn} {sz}x{sz} {"full" if full else "maskable"} margins top {top:.3f} bottom {bot:.3f} left {lft:.3f} right {rgt:.3f}')

if __name__ == '__main__':
    import sys
    build(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)))
