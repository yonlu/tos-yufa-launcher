"""
Recolours the green that the key left in the goddess clip so it reads as
flame. Nothing is removed; the matte stays as it is.

The source is a VP9 WebM with an alpha channel, keyed elsewhere from Kling's
clip over chroma green. Where Kling shaded the green beside the flame, or
let a dying wisp dissolve into green and olive, the key kept the pixels.
They have a shape and an alpha worth keeping; only their hue is wrong.

Two things pick a pixel out, each as a weight from 0 to 1 so there is no
seam where one fades into the flame:

- Green. Nothing in the art leans green (no pixel of tos-1 has green above
  both red and blue by ten), so a green-leaning pixel, anywhere in the
  frame, is the background's and takes full weight.
- Olive, in the flame's corner only. A dying wisp's body has green about
  equal to red with blue well under, at a middle brightness. The art has
  the same balance in its pale gold highlights and its dark outlines, so
  the brightness gate is what keeps the rule off the ornaments; the corner
  keeps it off everything else.

The new colour keeps the pixel's own brightness and takes its hue from two
places, blended by how far inside the silhouette the pixel sits:

- At the edge, the neighbourhood: a gaussian average of the warm, solid,
  untouched pixels nearby (the flame's body, not its outlines; the nearest
  such pixel where the average is thin), with its chroma lifted a little.
  Near the wisps that is flame; along the hair and the wing it is hair and
  wing, which is what a fringe there should be. A fringe pixel is dark,
  and painting it in the flame's dark colours put a rust rim on every wisp.
- In the body, in the flame's corner, the flame's own colour at that
  brightness: a ramp sampled from the flame in the first frame, which is
  the art itself. A dissolving wisp is green at a middle brightness, and
  the neighbourhood's average there is too pale to read as anything but
  brown.

Alpha is untouched, and so is the colour under fully transparent pixels:
filling it with the launcher's parchment doubled the file, and the player
scales this one down, so nothing bleeds.

    ffmpeg -c:v libvpx-vp9 -i keyed.webm -pix_fmt rgba frames/%03d.png
    .venv/bin/python tools/flame-goddess.py frames out
    ffmpeg -framerate 24 -i out/%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 44 -b:v 0 \\
      -deadline good -cpu-used 0 -row-mt 1 -auto-alt-ref 1 -lag-in-frames 25 \\
      -arnr-maxframes 15 -arnr-strength 4 -pass 1 -passlogfile out -an -f null -
    ffmpeg -framerate 24 -i out/%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 44 -b:v 0 \\
      -deadline good -cpu-used 0 -row-mt 1 -auto-alt-ref 1 -lag-in-frames 25 \\
      -arnr-maxframes 15 -arnr-strength 4 -pass 2 -passlogfile out -an goddess.webm
    ffmpeg -i out/001.png -c:v libwebp -quality 85 -compression_level 6 -update 1 goddess.webp

The frame rate is the source's (this one is 1440x1440 at 24 fps). The
audio track is dropped; the player is muted.
"""

import glob
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src_dir, out_dir = sys.argv[1], sys.argv[2]
GREEN_LEAD = 8  # green above both red and blue by this much leans green
CORNER = (0.5, 0.45)  # the flame's corner: right of this share of the width, above this share of the height
FLAME_BOX = (0.55, 0.32)  # where the flame is in the first frame: right of this share of the width, above this share of the height
OLIVE_BLUE = (20, 15)  # olive: blue under the smaller of red and green by this, full weight this much further
OLIVE_LUMA = (200, 30)  # olive: brightness under this, full weight this much further down
OLIVE_LEAD = (-26, 12)  # olive: green minus red above this, full weight this much further up
REF_ALPHA = 200  # a reference pixel is at least this solid
REF_LEAD = -15  # a reference pixel has green under red by at least this: warm
REF_LUMA = 120  # a reference pixel is at least this bright: the flame's body, not its outlines
SIGMA = 10.0  # px, radius of the gaussian that averages the reference
THIN = 0.02  # under this much reference weight the nearest reference pixel is used instead
SAT = 1.3  # the reference's chroma is scaled by this
EDGE = (2, 8)  # px from the silhouette: the neighbourhood's colour to here, the flame ramp from here
RAMP_STEP = 16  # brightness levels per ramp bin
RAMP_MIN = 20  # a ramp bin needs this many pixels; emptier ones borrow the nearest filled bin

os.makedirs(out_dir, exist_ok=True)
files = sorted(glob.glob(os.path.join(src_dir, '*.png')))


def ramp(x, start, width):
    return np.clip((x - start) / width, 0, 1)


def luma(c):
    return 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]


def load(f):
    return np.asarray(Image.open(f).convert('RGBA')).astype(np.float32)


# the flame's colour by brightness, sampled from the first frame
first = load(files[0])
H, W = first.shape[:2]
Y, X = np.mgrid[:H, :W]
corner = (X > CORNER[0] * W) & (Y < CORNER[1] * H)
flame = (
    (X > FLAME_BOX[0] * W) & (Y < FLAME_BOX[1] * H)
    & (first[..., 3] > REF_ALPHA) & (first[..., 1] - first[..., 0] < REF_LEAD)
)
nbins = 256 // RAMP_STEP
bin_of = np.clip((luma(first[..., :3])[flame] / RAMP_STEP).astype(int), 0, nbins - 1)
lut = np.zeros((nbins, 3))
count = np.bincount(bin_of, minlength=nbins)
for i in range(nbins):
    if count[i] >= RAMP_MIN:
        lut[i] = first[..., :3][flame][bin_of == i].mean(0)
filled = np.nonzero(count >= RAMP_MIN)[0]
for i in range(nbins):
    if count[i] < RAMP_MIN:
        lut[i] = lut[filled[np.argmin(np.abs(filled - i))]]
centers = np.arange(nbins) * RAMP_STEP + RAMP_STEP / 2


def flame_colour(L):
    return np.stack([np.interp(L, centers, lut[:, c]) for c in range(3)], -1)


for f in files:
    a = load(f)
    rgb, alpha = a[..., :3], a[..., 3]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    L = luma(rgb)
    lead = g - r

    green = (g > np.maximum(r, b) + GREEN_LEAD).astype(np.float32)
    olive = (
        ramp(np.minimum(r, g) - b, *OLIVE_BLUE)
        * ramp(-L, -OLIVE_LUMA[0], OLIVE_LUMA[1])
        * ramp(lead, *OLIVE_LEAD)
        * corner
    )
    w = np.maximum(green, olive) * (alpha > 0)

    ref_mask = ((alpha > REF_ALPHA) & (w == 0) & (lead < REF_LEAD) & (L > REF_LUMA)).astype(np.float32)
    num = np.stack([ndi.gaussian_filter(rgb[..., i] * ref_mask, SIGMA) for i in range(3)], -1)
    den = ndi.gaussian_filter(ref_mask, SIGMA)
    near = ndi.distance_transform_edt(ref_mask == 0, return_indices=True)[1]
    ref = np.where(den[..., None] > THIN, num / np.maximum(den, 1e-6)[..., None], rgb[near[0], near[1]])
    Lr = np.maximum(luma(ref), 1.0)[..., None]
    ref = Lr + (ref - Lr) * SAT

    # the reference at the pixel's own brightness; where a channel would clip, pull toward grey instead
    new = ref * (L[..., None] / Lr)
    mx = new.max(-1)
    t = np.where(mx > 255, (mx - 255) / np.maximum(mx - L, 1e-6), 0)[..., None]
    new = new + t * (L[..., None] - new)

    inside = ndi.distance_transform_edt(alpha >= 128)
    body = (ramp(inside, EDGE[0], EDGE[1] - EDGE[0]) * corner)[..., None]
    new = new * (1 - body) + flame_colour(L) * body

    out = rgb * (1 - w[..., None]) + new * w[..., None]
    res = np.concatenate([out.clip(0, 255), alpha[..., None]], -1).astype(np.uint8)
    Image.fromarray(res).save(os.path.join(out_dir, os.path.basename(f)))
