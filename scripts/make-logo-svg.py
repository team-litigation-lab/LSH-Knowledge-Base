import numpy as np, potrace
from PIL import Image

im = Image.open('public/lsh-logo-dark.png').convert('RGBA')
a = np.asarray(im).astype(int)
rgb, alpha = a[..., :3], a[..., 3]

COLORS = {'navy': (42, 46, 64), 'orange': (215, 120, 46), 'white': (255, 255, 255)}
names = list(COLORS)
dist = np.stack([((rgb - np.array(COLORS[n])) ** 2).sum(-1) for n in names])
nearest = dist.argmin(0)
ink = alpha > 128
H, W = ink.shape

def pt(p): return p.x, p.y

paths = []
for i, n in enumerate(names):
    mask = ink & (nearest == i)
    if not mask.any(): continue
    plist = potrace.Bitmap(np.where(mask, 0, 255).astype(np.uint8)).trace(turdsize=2, alphamax=1.0, opttolerance=0.2)
    d = []
    for curve in plist:
        sx, sy = pt(curve.start_point)
        d.append(f"M{sx:.2f} {sy:.2f}")
        for seg in curve:
            if seg.is_corner:
                cx, cy = pt(seg.c); ex, ey = pt(seg.end_point)
                d.append(f"L{cx:.2f} {cy:.2f}L{ex:.2f} {ey:.2f}")
            else:
                c1 = pt(seg.c1); c2 = pt(seg.c2); e = pt(seg.end_point)
                d.append(f"C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {e[0]:.2f} {e[1]:.2f}")
        d.append("Z")
    paths.append((n, '#%02x%02x%02x' % COLORS[n], ''.join(d)))

def write(path):
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="Legal Support Help">',
           '<title>Legal Support Help</title>']
    for n, col, d in paths:
        svg.append(f'<path fill="{col}" fill-rule="evenodd" d="{d}"/>')
    svg.append('</svg>')
    open(path, 'w').write('\n'.join(svg) + '\n')

write('public/lsh-logo-dark.svg')
print('layers:', [n for n, _, _ in paths])
