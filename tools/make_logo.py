#!/usr/bin/env python3
"""
Generate the Claude Session Relay logo and icon from code - no external design tool.

The mark: a rounded sand tile with a coral arrow going into a bracket - the
"sign in" gesture. The bracket is the VS Code window; the arrow is the request
that reaches it from outside. The whole product in one mark: "get into the tab".

Usage:
    pip install pillow
    python tools/make_logo.py

Outputs (overwritten in place):
    docs/logo.png   480px - README hero
    docs/icon.png   128px - Marketplace / extension icon
"""
import os
from PIL import Image, ImageDraw

# ---- palette ---------------------------------------------------------------
SAND = (244, 236, 226, 255)   # #F4ECE2  tile
CORAL = (226, 115, 80, 255)   # #E27350  arrow and bracket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")


def render(px):
    """Draw at px*px; authored in a 256 grid and scaled by k."""
    k = px / 256.0
    im = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = lambda *v: [x * k for x in v]
    w = round(22 * k)
    half = 11

    d.rounded_rectangle(s(16, 16, 240, 240), radius=56 * k, fill=SAND)
    # the bracket: the window
    d.line(s(150, 70, 190, 70), fill=CORAL, width=w)
    d.line(s(190, 59, 190, 197), fill=CORAL, width=w)
    d.line(s(150, 186, 190, 186), fill=CORAL, width=w)
    # the arrow: the request, with a round tail
    d.line(s(60, 128, 124, 128), fill=CORAL, width=w)
    d.ellipse(s(60 - half, 128 - half, 60 + half, 128 + half), fill=CORAL)
    d.polygon([(x * k, y * k) for x, y in ((112, 92), (160, 128), (112, 164))], fill=CORAL)
    return im


def save(px, name, ss=4):
    big = render(px * ss)
    big.resize((px, px), Image.LANCZOS).save(os.path.join(DOCS, name))
    print(os.path.join("docs", name), f"{px}px")


if __name__ == "__main__":
    os.makedirs(DOCS, exist_ok=True)
    save(480, "logo.png")
    save(128, "icon.png")
