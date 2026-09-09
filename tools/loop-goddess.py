"""
Closes the goddess clip into a seamless loop. Runs on the frames that
tools/flame-goddess.py wrote, before the encode.

Kling's "looping" mode does not return to its first pose: the last frame is
about five frame steps away from the first, all over the figure, so the
player's jump back to the start is a visible twitch. Somewhere in the clip,
though, a later frame comes within two steps of the first; for this clip
that is frame 95 against frame 1. The loop keeps frames 1 to MATCH - 1 and
morphs across the cut: for the first W frames of the output, frame
MATCH + i is warped toward frame 1 + i along the optical flow between the
two, frame 1 + i is warped back the other way, and the two are blended
(premultiplied, so the alpha morphs with the colour). A plain dissolve
doubled the wisps' outlines and the wing's edge for the length of the
dissolve; the warp keeps every outline single. The steps across the cut
come out the size of an ordinary frame step.

What it costs: the frames after MATCH are dropped (here 26 frames, 1.1 s
of idle motion; the blink and both wisp dissolves come earlier and stay).

    .venv/bin/python tools/flame-goddess.py frames out
    .venv/bin/python tools/loop-goddess.py out loop 95 8
    ffmpeg -framerate 24 -i loop/%03d.png ...   # the encode in flame-goddess.py, from loop/

To find MATCH for another clip: composite the frames over parchment, shrink
them, and take the pair (1, b) with the smallest mean difference among
b >= 72; the search is a few lines of numpy.
"""

import os
import sys

import cv2
import numpy as np
from PIL import Image

src_dir, out_dir, MATCH, W = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
PARCHMENT = np.array([0xEB, 0xE7, 0xDC], np.float32)  # the flow is estimated on the figure over the launcher's ground

os.makedirs(out_dir, exist_ok=True)
flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)


def load(n):
    return np.asarray(Image.open(os.path.join(src_dir, f'{n:03d}.png')).convert('RGBA')).astype(np.float32)


def grey(a):
    al = a[..., 3:4] / 255
    over = (a[..., :3] * al + PARCHMENT * (1 - al)).clip(0, 255).astype(np.uint8)
    return cv2.cvtColor(over, cv2.COLOR_RGB2GRAY)


def premultiplied(a):
    return np.concatenate([a[..., :3] * a[..., 3:4] / 255, a[..., 3:4]], -1)


def warp(p, f, t, X, Y):
    return cv2.remap(p, X - t * f[..., 0], Y - t * f[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


for i in range(MATCH - 1):
    if i < W:
        a, b = load(MATCH + i), load(1 + i)
        t = (i + 1) / (W + 1)
        ga, gb = grey(a), grey(b)
        H, Wd = ga.shape
        Y, X = np.mgrid[:H, :Wd].astype(np.float32)
        p = warp(premultiplied(a), flow.calc(ga, gb, None), t, X, Y) * (1 - t) + warp(
            premultiplied(b), flow.calc(gb, ga, None), 1 - t, X, Y
        ) * t
        alpha = p[..., 3:4]
        rgb = np.where(alpha > 0, p[..., :3] * 255 / np.maximum(alpha, 1e-6), 0)
        res = np.concatenate([rgb, alpha], -1)
    else:
        res = load(1 + i)
    Image.fromarray(res.clip(0, 255).astype(np.uint8)).save(os.path.join(out_dir, f'{i + 1:03d}.png'))
