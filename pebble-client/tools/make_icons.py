#!/usr/bin/env python3
"""Generate the watchapp icon set (resources/images/ic_*.png).

Bold geometric glyphs drawn at 10x supersample and LANCZOS-downscaled to
22x22 so they stay crisp on the watch. Icons sit centered on white badge
circles (r=11/12 -> 22/24 px), so every glyph keeps ~2.5px of transparent
margin and uses a saturated brand color that reads on white.

Run manually after editing:  python3 tools/make_icons.py
(Deliberately NOT named gen_icons.py: the wscript auto-runs that name as a
build step, which has broken builds before.)
"""
import os

from PIL import Image, ImageDraw, ImageFont

S = 10            # supersample factor
SZ = 22           # final icon size
C = SZ * S
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "resources", "images"))

AMBER = (244, 166, 0, 255)
GREEN = (20, 164, 88, 255)
TEAL = (13, 148, 158, 255)
BLUE = (28, 105, 224, 255)
RED = (226, 70, 74, 255)
PURPLE = (126, 48, 196, 255)
SLATE = (47, 61, 76, 255)
GRAY = (118, 130, 143, 255)
BTC_ORANGE = (247, 147, 26, 255)
LTC_BLUE = (52, 93, 157, 255)
XMR_ORANGE = (242, 104, 34, 255)
WHITE = (255, 255, 255, 255)

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def P(*xy):
    """Scale a list of (x, y) coords from 22-space to canvas-space."""
    return [(x * S, y * S) for x, y in xy]


def box(x0, y0, x1, y1):
    return [x0 * S, y0 * S, x1 * S, y1 * S]


def new():
    im = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def save(im, name, size=SZ):
    im.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    print("wrote", name)


def stroke_path(d, pts, width, color):
    """Polyline with round caps/joints."""
    pts = P(*pts)
    w = width * S
    d.line(pts, fill=color, width=int(w), joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)


def bolt_glyph(d, color, cx=11.0, cy=11.0, scale=1.0):
    """Filled lightning bolt centered at (cx, cy)."""
    pts = [(12.6, 1.6), (4.8, 12.6), (9.8, 12.6), (8.6, 20.4),
           (16.8, 9.4), (11.6, 9.4), (14.6, 1.6)]
    pts = [((x - 11) * scale + cx, (y - 11) * scale + cy) for x, y in pts]
    d.polygon(P(*pts), fill=color)


def make_bolt():
    im, d = new()
    bolt_glyph(d, AMBER)
    save(im, "ic_bolt.png")


def make_check():
    im, d = new()
    stroke_path(d, [(4.2, 11.8), (9.0, 16.4), (17.8, 5.6)], 3.4, GREEN)
    save(im, "ic_check.png")


def make_wallet():
    im, d = new()
    # Body with a lighter top fold and a white clasp dot.
    d.rounded_rectangle(box(2.2, 5.2, 19.8, 17.8), radius=2.6 * S, fill=TEAL)
    d.rounded_rectangle(box(2.2, 5.2, 19.8, 8.6), radius=1.6 * S,
                        fill=(9, 116, 124, 255))
    d.ellipse(box(14.6, 10.6, 18.0, 14.0), fill=WHITE)
    save(im, "ic_wallet.png")


def make_gauge():
    im, d = new()
    # Speedometer: open-bottom arc + needle + hub.
    d.arc(box(3.0, 3.6, 19.0, 19.6), start=140, end=40, fill=BLUE,
          width=int(3.0 * S))
    stroke_path(d, [(11.0, 11.6), (15.4, 6.4)], 2.6, BLUE)
    r = 2.1
    d.ellipse(box(11.0 - r, 11.6 - r, 11.0 + r, 11.6 + r), fill=BLUE)
    save(im, "ic_gauge.png")


def make_temp():
    im, d = new()
    d.rounded_rectangle(box(8.9, 2.2, 13.1, 13.0), radius=2.1 * S, fill=RED)
    d.ellipse(box(6.6, 11.0, 15.4, 19.8), fill=RED)
    # Mercury column highlight.
    d.rounded_rectangle(box(10.3, 4.0, 11.7, 9.2), radius=0.7 * S, fill=WHITE)
    save(im, "ic_temp.png")


def make_chart():
    im, d = new()
    stroke_path(d, [(3.0, 16.6), (8.6, 10.6), (12.6, 13.6), (19.0, 5.4)],
                3.0, PURPLE)
    r = 2.4
    d.ellipse(box(19.0 - r, 5.4 - r, 19.0 + r, 5.4 + r), fill=PURPLE)
    save(im, "ic_chart.png")


def make_session():
    im, d = new()
    for cy in (5.4, 11.0, 16.6):
        r = 1.9
        d.ellipse(box(3.2 - r + 1.9, cy - r, 3.2 + r + 1.9, cy + r),
                  fill=SLATE)
        d.rounded_rectangle(box(8.6, cy - 1.5, 19.4, cy + 1.5),
                            radius=1.5 * S, fill=SLATE)
    save(im, "ic_session.png")


def make_dot():
    im, d = new()
    d.ellipse(box(5.5, 5.5, 16.5, 16.5), fill=GRAY)
    save(im, "ic_dot.png")


def coin(letter, bg, name, ticks=False):
    im, d = new()
    d.ellipse(box(0.6, 0.6, 21.4, 21.4), fill=bg)
    font = ImageFont.truetype(FONT_PATH, int(13.5 * S))
    d.text((11 * S, 10.6 * S), letter, font=font, fill=WHITE, anchor="mm")
    if ticks:  # the B's currency strokes
        d.rectangle(box(10.0, 2.6, 11.4, 4.4), fill=WHITE)
        d.rectangle(box(10.0, 17.6, 11.4, 19.4), fill=WHITE)
    save(im, name)


def make_menu_icon():
    """Launcher icon: the hashcat cat silhouette, lifted straight from the
    desktop app's build/icon.ico. The ico's own 24x24 frame is pre-tuned for
    small sizes (downscaling the 256px art turns the cat to mush), so it is
    used as-is, centered on the 25x25 launcher canvas."""
    sz = 25
    cat = Image.open(os.path.join(HERE, "..", "..", "build", "icon.ico"))
    cat.size = (24, 24)        # select the ico's 24x24 frame
    cat.load()
    cat = cat.convert("RGBA")
    im = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
    im.alpha_composite(cat, ((sz - 24) // 2, (sz - 24) // 2))
    im.save(os.path.join(OUT, "menu_icon.png"))
    print("wrote menu_icon.png")


if __name__ == "__main__":
    make_bolt()
    make_check()
    make_wallet()
    make_gauge()
    make_temp()
    make_chart()
    make_session()
    make_dot()
    coin("B", BTC_ORANGE, "ic_btc.png", ticks=True)
    coin("Ł", LTC_BLUE, "ic_ltc.png")
    coin("M", XMR_ORANGE, "ic_xmr.png")
    make_menu_icon()
