"""
Makes packages/launcher/src/renderer/src/assets/goddess.webm and goddess.webp
from the animated goddess: a Kling image-to-video clip of the site's tos-1 art
over chroma green (1440x1440, 24 fps, 5 s, H.264, no alpha). It removes the
green and nothing else; what Kling drew stays as Kling drew it.

Needs ffmpeg and a Python with numpy, pillow and scipy:

    python3 -m venv .venv && .venv/bin/pip install numpy pillow scipy

1. Frames. 24 fps is the clip's own rate. The art fills the frame (the
   1000 px tos-1 scaled to 1440), so there is no crop; check with cropdetect
   (limit=16) when the clip changes. All 121 frames are used.

    ffmpeg -i kling.mp4 frames/%03d.png

2. Key and resize (this script): frames/ -> keyed/, RGBA, 1000 px tall. The
   launcher shows her 660 css px tall, 1320 device px on a Retina screen,
   and 800 px was visibly softer in the face.

    .venv/bin/python tools/key-goddess.py frames keyed 1000

3. Loop. The clip does not return to its first pose, and a crossfade shows
   the hair twice, so it plays forward then backward. Symlink the reversed
   run after the forward one (121 frames become 240, 10 s):

    i=0; for n in $(seq 0 120) $(seq 119 -1 1); do
      ln -s ../keyed/$(printf %03d $n).png pp/$(printf %03d $i).png; i=$((i+1)); done

4. Encode. VP9 with alpha is the one format Chromium plays with transparency
   everywhere. Two passes at crf 44 came out indistinguishable from the
   frames at 2x zoom; crf 48 softens the braids.

    ffmpeg -framerate 24 -i pp/%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 44 -b:v 0 \
      -deadline good -cpu-used 0 -row-mt 1 -auto-alt-ref 1 -lag-in-frames 25 \
      -arnr-maxframes 15 -arnr-strength 4 -pass 1 -passlogfile pp -an -f null -
    ffmpeg -framerate 24 -i pp/%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 44 -b:v 0 \
      -deadline good -cpu-used 0 -row-mt 1 -auto-alt-ref 1 -lag-in-frames 25 \
      -arnr-maxframes 15 -arnr-strength 4 -pass 2 -passlogfile pp -an goddess.webm

5. Poster, the first frame, shown until the video decodes and instead of it
   under prefers-reduced-motion:

    ffmpeg -i keyed/000.png -c:v libwebp -quality 85 -compression_level 6 -update 1 goddess.webp

How the key works. Over a plain background a pixel is alpha * colour plus
(1 - alpha) * background, so its distance from the background alone cannot
tell an opaque pixel close to the background's tone from a contrasting
translucent one. The script takes a hard silhouette, closes pinholes and
erodes it a few pixels to get the certainly-opaque interior. For the band
around it, the true colour is taken from the nearest interior pixel and
alpha solved by projecting the pixel's distance from the background (a
signed vector per channel) onto that colour's; the colour is then divided
back out by that alpha. The background colour is read from the first
frame's corners.

Green is never art: no pixel of tos-1 has green above both red and blue by
ten. So a green-leaning raw pixel is the background whatever else it is,
shaded where the figure's see-through gaps show it, lit around the flame.
It never serves as a reference colour, a patch of it is transparent, rim
included, and a thin line of it (an edge over green) keeps the band's soft
alpha with the interior's colour, so there is no spill. Under fully
transparent pixels the frames carry the parchment colour the launcher shows
behind her, not black, so whatever the player's scaling bleeds from those
pixels into the edges is invisible.
"""

import glob
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src_dir, out_dir = sys.argv[1], sys.argv[2]
OUT_H = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
T_HARD = 12  # distance-from-background threshold for the hard silhouette
CLOSE_R = 3  # closing radius; fills gaps up to about 2 * CLOSE_R px
ERODE = 3  # interior = silhouette eroded by this many px
T_FRINGE = 10  # anything further than this from the background outside the silhouette still gets soft alpha; the encoder's noise on the green stays under 8
GREEN_LEAD = 8  # green above both red and blue by this much is the background, never the art
PATCH_OPEN = 2  # opening radius that separates a patch of green from a thin edge over green
PATCH_RIM = 2  # px a patch takes with it, where they are green too
PARCHMENT = (0xEB, 0xE7, 0xDC)  # the launcher's background, stored under transparent pixels

os.makedirs(out_dir, exist_ok=True)


def disc(r):
    y, x = np.ogrid[-r : r + 1, -r : r + 1]
    return (x * x + y * y) <= r * r


files = sorted(glob.glob(os.path.join(src_dir, '*.png')))
first = np.asarray(Image.open(files[0]).convert('RGB'))
corners = np.concatenate([first[:40, :40].reshape(-1, 3), first[:40, -40:].reshape(-1, 3), first[-40:, :40].reshape(-1, 3)])
BG = np.median(corners, axis=0).astype(np.float32)
print(f'background {BG.astype(int).tolist()}')


def key(rgb):
    p = rgb.astype(np.float32)
    d = p - BG  # distance from the background, per channel, signed
    m = np.abs(d).max(axis=2)
    hard = m > T_HARD
    closed = ndi.binary_closing(hard, structure=disc(CLOSE_R)) | hard
    interior = ndi.binary_erosion(closed, structure=disc(ERODE))

    greenish = (p[..., 1] > p[..., 0] + GREEN_LEAD) & (p[..., 1] > p[..., 2] + GREEN_LEAD)
    patch = ndi.binary_opening(greenish & hard, structure=disc(PATCH_OPEN))
    patch = ndi.binary_dilation(patch, structure=disc(PATCH_RIM)) & greenish
    interior &= ~greenish

    # the nearest interior pixel stands in for every pixel's true colour
    _, idx = ndi.distance_transform_edt(~interior, return_indices=True)
    c = d[idx[0], idx[1]]
    band = ~interior & (m > T_FRINGE)
    a_est = np.clip((d * c).sum(axis=2) / ((c * c).sum(axis=2) + 1e-3), 0.0, 1.0)
    alpha = np.where(interior, 1.0, np.where(band, a_est, 0.0)).astype(np.float32)
    alpha[patch] = 0.0

    # un-premultiply in the band; under thin alpha, and wherever the pixel
    # leans green, the reference colour is the one to keep
    safe = np.maximum(alpha, 0.05)[..., None]
    d_col = np.where(band[..., None], np.clip(d / safe, -255, 255), d)
    d_col = np.where((band & ((alpha < 0.3) | greenish))[..., None], c, d_col)
    col = np.clip(BG + d_col, 0, 255)
    # near-nothing alpha and the colour under it are noise the encoder would pay for
    alpha[alpha < 0.04] = 0.0
    col = np.where((alpha > 0)[..., None], col, 0.0)
    return col, alpha


def to_image(col, alpha):
    rgba = np.dstack([col, alpha * 255.0]).round().clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def resize(img):
    w, h = img.size
    nw = int(round(w * OUT_H / h))
    nw += nw % 2  # even width for yuv420
    # Pillow premultiplies when it resizes RGBA, so the edges keep no fringe
    out = np.asarray(img.resize((nw, OUT_H), Image.LANCZOS)).copy()
    # What lies under a transparent pixel still matters: the player filters
    # colour and alpha separately when it scales the video, so black under
    # the transparency bleeds into every pale edge and into the openings
    # between feathers as a dark rim. The parchment the launcher shows behind
    # her goes there instead, and the bleed becomes invisible.
    out[out[..., 3] == 0, :3] = PARCHMENT
    return Image.fromarray(out, 'RGBA')


for i, f in enumerate(files):
    col, alpha = key(np.asarray(Image.open(f).convert('RGB')))
    resize(to_image(col, alpha)).save(os.path.join(out_dir, f'{i:03d}.png'))
print(f'{len(files)} frames keyed into {out_dir}')
