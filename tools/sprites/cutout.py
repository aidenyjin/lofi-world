"""Cut generated characters out of their paper backgrounds.

Flood-fills paper-coloured pixels connected to the image edge (ink outlines
stop the fill, so white fur survives), drops stray paint flecks, un-mixes the
paper colour from soft edges, then crops and scales to 512px tall.
"""
import sys, json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

def cutout(path, out, max_h=512):
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    h, w, _ = im.shape
    border = np.concatenate([im[:6].reshape(-1, 3), im[-6:].reshape(-1, 3), im[:, :6].reshape(-1, 3), im[:, -6:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((im - bg) ** 2).sum(-1))
    # Paper texture varies a little; anything this close to the paper colour
    # and connected to the edge is background.
    near = dist < 30
    lab, _ = ndi.label(near)
    edge_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge_labels = edge_labels[edge_labels != 0]
    bgmask = np.isin(lab, edge_labels)
    fg = ~bgmask
    # Keep the character (largest blob) plus anything big touching it; drop flecks.
    flab, n = ndi.label(fg)
    if n > 1:
        sizes = ndi.sum(fg, flab, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = sizes >= max(sizes.max() * 0.02, 400)
        fg = keep[flab]
    fg = ndi.binary_fill_holes(fg) & (fg | ~bgmask)  # keep enclosed light areas (fur) solid
    fg = ndi.binary_opening(fg, iterations=1)
    # Soft alpha: ramp on colour distance across a thin band at the silhouette edge.
    band = ndi.binary_dilation(fg, iterations=2) & ~ndi.binary_erosion(fg, iterations=2)
    alpha = fg.astype(np.float32)
    ramp = np.clip((dist - 12) / 30, 0, 1)
    alpha[band] = np.maximum(alpha[band] * 0.0, ramp[band]) * ndi.binary_dilation(fg, iterations=2)[band]
    alpha = ndi.gaussian_filter(alpha, 0.6)
    alpha[~ndi.binary_dilation(fg, iterations=3)] = 0
    # Un-mix the paper colour from semi-transparent edge pixels (no halos).
    a = np.clip(alpha, 1e-3, 1)[..., None]
    rgb = np.clip((im - (1 - a) * bg) / a, 0, 255)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    ys, xs = np.where(alpha > 0.05)
    pad = 6
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, h)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, w)
    crop = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA')
    if crop.height > max_h:
        crop = crop.resize((round(crop.width * max_h / crop.height), max_h), Image.LANCZOS)
    crop.save(out, optimize=True)
    return crop.size, bg.tolist()

src = Path(sys.argv[1]); dst = Path(sys.argv[2]); dst.mkdir(parents=True, exist_ok=True)
for f in sys.argv[3:]:
    name = Path(f).stem
    size, bg = cutout(src / f, dst / f"{name}.png")
    print(name, size, [round(c) for c in bg])
