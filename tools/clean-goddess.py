"""
Cleans an already keyed goddess clip: the green and the black the key left
behind, and nothing else.

The source is a VP9 WebM with an alpha channel, keyed elsewhere from Kling's
clip over chroma green. Its matte is kept as it is. Three things go:

- Green. Nothing in the art leans green (no pixel of tos-1 has green above
  both red and blue by ten), so a green-leaning pixel is the background's.
  A patch of them turns transparent, rim included, with the faint edge the
  key drew around the patch and any small piece the removal leaves
  hanging; a thin line of them, an edge, keeps its alpha and has the green
  pulled down to the larger of its red and blue.
- The dark fringe. The key writes its soft edge with the colour already
  multiplied by the alpha, so every outline carries a near-black rim that
  the player's upscale spreads further. Dividing the colour by the alpha
  gives the edge its real colour back; nothing is erased.
- Grey haze. Kling shades the green beside the flame, and the key keeps
  the shadow as a grey smear at half alpha. In the flame's corner of the
  frame everything real is solid (the wing, the hair, the wisps), so there
  a semi-transparent grey pixel that is not hugging something solid is the
  key's and goes. The rule stays in that corner: elsewhere the key has the
  belt's shadow at half alpha too, and that is art.

What stays: the solid dark spot where the wisps rise from the hair. The art
has a dark crevice there (frame 1, which is the art itself, has it), and
Kling only deepens it; a neutral-dark test that catches it also catches
the key's outlines on the wisps and the wing's edge, and every fill tried
(inpaint, nearest warm colour) looked worse than the spot.

    ffmpeg -c:v libvpx-vp9 -i keyed.webm -pix_fmt rgba frames/%03d.png
    .venv/bin/python tools/clean-goddess.py frames out
    ffmpeg -framerate 60000/1001 -i out/%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 44 -b:v 0 \\
      -deadline good -cpu-used 0 -row-mt 1 -auto-alt-ref 1 -lag-in-frames 25 \\
      -arnr-maxframes 15 -arnr-strength 4 -pass 1 -passlogfile out -an -f null -
    ffmpeg -framerate 60000/1001 -i out/%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 44 -b:v 0 \\
      -deadline good -cpu-used 0 -row-mt 1 -auto-alt-ref 1 -lag-in-frames 25 \\
      -arnr-maxframes 15 -arnr-strength 4 -pass 2 -passlogfile out -an goddess.webm
    ffmpeg -i out/001.png -c:v libwebp -quality 85 -compression_level 6 -update 1 goddess.webp

The frame rate is the source's (this one is 720x720 at 59.94 fps). The
audio track is dropped; the player is muted. Under fully transparent pixels
the frames carry the parchment colour the launcher shows behind her, so
whatever the player's scaling bleeds from them into the edges is invisible.
"""

import glob
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src_dir, out_dir = sys.argv[1], sys.argv[2]
GREEN_LEAD = 8  # green above both red and blue by this much leans green
PATCH_OPEN = 2  # opening radius that separates a patch from a thin edge
PATCH_RIM = 2  # px a patch takes with it, where they lean green too
EDGE_REACH = 3  # px around a removed patch within which the key's faint edge goes too
EDGE_ALPHA = 40  # alpha under which an edge pixel counts as faint
LOOSE_MAX = 4000  # px; a piece this small left touching a removed patch goes with it
SOLID = 250  # alpha at and above which the key's pixel is solid, not a soft edge
CORNER = (0.5, 0.45)  # the flame's corner: right of this share of the width, above this share of the height
HAZE_ALPHA = 200  # in the corner, a pixel under this alpha that is grey is haze
HAZE_GREY = 40  # grey: max minus min channel under this
HUG = 2  # px from a solid pixel within which a soft grey pixel is an edge, not haze
PARCHMENT = (0xEB, 0xE7, 0xDC)

os.makedirs(out_dir, exist_ok=True)


def disc(r):
    y, x = np.ogrid[-r : r + 1, -r : r + 1]
    return (x * x + y * y) <= r * r


for f in sorted(glob.glob(os.path.join(src_dir, '*.png'))):
    a = np.asarray(Image.open(f).convert('RGBA')).astype(np.float32)
    rgb, alpha = a[..., :3].copy(), a[..., 3].copy()

    # the dark fringe: the soft edge's colour divided by its alpha
    soft = (alpha > 0) & (alpha < SOLID)
    rgb[soft] = np.clip(rgb[soft] / (alpha[soft][:, None] / 255.0), 0, 255)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)

    # green
    greenish = (alpha > 0) & (g > r + GREEN_LEAD) & (g > b + GREEN_LEAD)
    patch = ndi.binary_opening(greenish, structure=disc(PATCH_OPEN))
    patch = ndi.binary_dilation(patch, structure=disc(PATCH_RIM)) & greenish
    edge = greenish & ~patch
    gone = patch | (ndi.binary_dilation(patch, structure=disc(EDGE_REACH)) & (alpha < EDGE_ALPHA))

    # small pieces a removed green patch leaves hanging (the detached curls
    # of the flame are islands too, so this does not follow the haze below)
    labels, n = ndi.label((alpha > 0) & ~gone)
    if n:
        ids = np.arange(1, n + 1)
        size = ndi.sum(np.ones_like(alpha), labels, ids)
        touches = ndi.maximum(ndi.binary_dilation(gone, structure=disc(EDGE_REACH)), labels, ids) > 0
        gone |= np.isin(labels, ids[(size < LOOSE_MAX) & touches])

    # grey haze in the flame's corner
    H, W = alpha.shape
    YY, XX = np.mgrid[0:H, 0:W]
    corner = (XX >= CORNER[0] * W) & (YY <= CORNER[1] * H)
    near_solid = ndi.binary_dilation(alpha >= SOLID, structure=disc(HUG))
    gone |= corner & (alpha > 0) & (alpha < HAZE_ALPHA) & (mx - mn < HAZE_GREY) & ~near_solid

    alpha[gone] = 0.0
    rgb[..., 1][edge] = np.maximum(r, b)[edge]
    rgb[alpha == 0] = PARCHMENT
    out = np.dstack([rgb, alpha]).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(os.path.join(out_dir, os.path.basename(f)))
print(f'cleaned into {out_dir}')
