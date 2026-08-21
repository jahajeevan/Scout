"""Render the Scout Siri-style orb to PNG (+ .icns when iconutil is available).

Pure offline image generation (numpy + Pillow) — no GUI. Produces:
  macos/assets/orb.png        — 88px, used as the menu-bar icon (retina-friendly)
  macos/assets/orb_1024.png   — 1024px, the app-icon master
  macos/assets/Scout.icns     — app icon bundle (only if `iconutil` is present)

The look matches frontend/components/Orb.tsx: a dark glossy sphere with drifting
vivid colour blobs, a specular highlight, and a soft outer bloom.

Run:  python3.11 macos/make_orb_icon.py
"""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ASSETS = Path(__file__).resolve().parent / "assets"

# Scout identity palette (teal · emerald · gold · violet · sky) — deliberately
# NOT Siri's magenta rainbow. Shared with the web Orb (frontend/components/Orb.tsx).
_BLOBS = [
    ((36, 222, 205), 0.30, 0.0),   # teal (primary)
    ((52, 200, 140), 0.34, 1.7),   # emerald
    ((255, 196, 92), 0.28, 3.1),   # gold (accent)
    ((122, 110, 238), 0.26, 4.6),  # violet (depth)
    ((46, 178, 224), 0.24, 5.7),   # sky
]


def _render(size: int, t: float = 0.0) -> Image.Image:
    """Render the orb at animation phase ``t`` (radians). t=0 is the static pose;
    frames step t so the colour blobs drift like the web orb."""
    S = size
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64)
    cx = cy = S / 2.0
    R = S / 2.0
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    rad = R * 0.86

    rgb = np.zeros((S, S, 3), dtype=np.float64)

    # Dark interior so colours pop.
    inner = np.clip(1 - dist / rad, 0, 1)
    rgb[..., 0] += 0x1a * inner + 0x05 * (1 - inner)
    rgb[..., 1] += 0x10 * inner + 0x04 * (1 - inner)
    rgb[..., 2] += 0x30 * inner + 0x0d * (1 - inner)

    # Additive colour blobs, drifting with t.
    for (r, g, b), sp, ph in _BLOBS:
        ang = ph + t * sp * 3.0
        orbit = rad * (0.32 + 0.1 * math.sin(t * 0.7 + ph))
        bx = cx + math.cos(ang) * orbit
        by = cy + math.sin(ang * 1.1) * orbit
        br = rad * 0.6
        d = np.sqrt((xx - bx) ** 2 + (yy - by) ** 2)
        fall = np.clip(1 - d / br, 0, 1) ** 1.5
        rgb[..., 0] += r * fall * 0.6
        rgb[..., 1] += g * fall * 0.6
        rgb[..., 2] += b * fall * 0.6

    # Specular highlight (top-left).
    sx, sy = cx - rad * 0.32, cy - rad * 0.38
    sd = np.sqrt((xx - sx) ** 2 + (yy - sy) ** 2)
    sheen = np.clip(1 - sd / (rad * 0.9), 0, 1) ** 2
    for c in range(3):
        rgb[..., c] += 255 * sheen * 0.5

    rgb = np.clip(rgb, 0, 255)

    # Alpha: solid inside the sphere with a soft 1px edge, transparent outside;
    # plus a faint outer bloom just past the rim.
    edge = 1.5
    alpha = np.clip((rad - dist) / edge + 0.5, 0, 1)
    bloom = np.clip((rad * 1.12 - dist) / (rad * 0.26), 0, 1) * 0.28
    alpha = np.clip(alpha + bloom * (dist > rad), 0, 1)

    out = np.zeros((S, S, 4), dtype=np.uint8)
    out[..., :3] = rgb.astype(np.uint8)
    out[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def _app_icon(size: int = 1024) -> Image.Image:
    """A proper macOS-style app icon: a rounded-square (squircle) dark card with a
    soft teal glow and the Scout orb centred — not a bare floating orb."""
    from PIL import ImageDraw, ImageFilter

    S = size
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pad = int(S * 0.085)
    inner = S - 2 * pad
    rad = int(inner * 0.225)  # macOS squircle-ish corner

    # Dark vertical-gradient card.
    yy = np.linspace(0, 1, inner)[:, None]
    top = np.array([0.10, 0.13, 0.20]); bot = np.array([0.02, 0.02, 0.05])
    grad = bot * yy + top * (1 - yy)          # (inner, 3)
    card = np.repeat(grad[:, None, :], inner, axis=1)  # (inner, inner, 3)
    card = (np.clip(card, 0, 1) * 255).astype("uint8")
    card_img = Image.fromarray(card, "RGB").convert("RGBA")
    mask = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, inner - 1, inner - 1], rad, fill=255)

    # Soft teal glow behind the orb.
    glow = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gc = inner // 2
    gr = int(inner * 0.34)
    gd.ellipse([gc - gr, gc - gr, gc + gr, gc + gr], fill=(52, 214, 196, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(inner // 12))
    card_img.alpha_composite(glow)

    img.paste(card_img, (pad, pad), mask)

    # Orb centred.
    orb = _render(1024)  # the teal/gold orb (transparent)
    od = int(inner * 0.6)
    orb = orb.resize((od, od), Image.LANCZOS)
    img.alpha_composite(orb, ((S - od) // 2, (S - od) // 2))

    # Hairline rim + top sheen for depth.
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([pad, pad, S - pad - 1, S - pad - 1], rad, outline=(255, 255, 255, 34), width=max(1, S // 380))
    return img


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)

    _render(88).save(ASSETS / "orb.png")
    master = _render(1024)
    master.save(ASSETS / "orb_1024.png")
    print(f"wrote {ASSETS/'orb.png'} and {ASSETS/'orb_1024.png'}")

    # Animation frames for the native overlay (a big Siri orb that spins while
    # Scout is listening/thinking/speaking). Pre-rendered so the menu-bar app just
    # swaps images on a timer — no heavy compute at runtime.
    frames_dir = ASSETS / "orb_frames"
    frames_dir.mkdir(exist_ok=True)
    N = 36
    for i in range(N):
        t = (i / N) * 2 * math.pi
        _render(240, t).save(frames_dir / f"orb_{i:02d}.png")
    print(f"wrote {N} frames → {frames_dir}")

    # Proper macOS app icon (squircle) → Scout.icns + a PNG preview.
    app_master = _app_icon(1024)
    app_master.save(ASSETS / "app_icon_1024.png")
    print(f"wrote {ASSETS/'app_icon_1024.png'}")
    if shutil.which("iconutil"):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = Path(tmp) / "Scout.iconset"
            iconset.mkdir()
            for sz in (16, 32, 128, 256, 512):
                app_master.resize((sz, sz), Image.LANCZOS).save(iconset / f"icon_{sz}x{sz}.png")
                app_master.resize((sz * 2, sz * 2), Image.LANCZOS).save(iconset / f"icon_{sz}x{sz}@2x.png")
            out = ASSETS / "Scout.icns"
            subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(out)], check=True)
            print(f"wrote {out}")
    else:
        print("iconutil not found — skipped .icns.")


if __name__ == "__main__":
    main()
