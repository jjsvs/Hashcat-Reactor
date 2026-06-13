#!/usr/bin/env python3
"""Generate the app-store marketing banner (720x320) for Hashcat Reactor."""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 720, 320
OUT = os.path.join(os.path.dirname(__file__), "screenshots", "banner.png")

# Brand palette (matches the watch panel colours).
YELLOW = (255, 170, 0)
GREEN  = (0, 170, 0)
CYAN   = (0, 170, 255)
NAVY   = (0, 40, 90)
PURPLE = (170, 0, 170)
WHITE  = (255, 255, 255)
GREY   = (150, 165, 185)
BLACK  = (0, 0, 0)

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
def f(size, bold=True):
    return ImageFont.truetype(FONT if bold else FONT_R, size)

img = Image.new("RGB", (W, H), (10, 20, 36))
d = ImageDraw.Draw(img)

# Subtle vertical gradient backdrop.
top, bot = (14, 28, 50), (6, 13, 26)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)],
           fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))

# Left accent bar.
d.rounded_rectangle([40, 70, 46, 250], radius=3, fill=YELLOW)

# Title.
d.text((64, 64),  "HASHCAT", font=f(58), fill=WHITE)
d.text((64, 126), "REACTOR", font=f(58), fill=YELLOW)

# Tagline.
d.text((66, 200), "Live GPU cracking telemetry,", font=f(22, False), fill=GREY)
d.text((66, 228), "right on your wrist.",          font=f(22, False), fill=GREY)

# Card-deck colour motif.
chips = [YELLOW, GREEN, CYAN, NAVY, PURPLE]
cx = 66
for c in chips:
    d.rounded_rectangle([cx, 268, cx + 56, 292], radius=6, fill=c)
    cx += 66

# ---- Watch mockup on the right showing the HASHRATE card ----
bx0, by0, bx1, by1 = 506, 40, 690, 280          # bezel
d.rounded_rectangle([bx0, by0, bx1, by1], radius=26, fill=(20, 22, 26))
sx0, sy0, sx1, sy1 = bx0 + 10, by0 + 10, bx1 - 10, by1 - 10  # screen
d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=18, fill=YELLOW)
scx = (sx0 + sx1) // 2

# White badge with a lightning bolt.
bcx, bcy, br = scx, sy0 + 42, 24
d.ellipse([bcx - br, bcy - br, bcx + br, bcy + br], fill=WHITE)
bolt = [(bcx - 4, bcy - 13), (bcx - 11, bcy + 2), (bcx - 2, bcy + 2),
        (bcx - 6, bcy + 13), (bcx + 11, bcy - 4), (bcx + 1, bcy - 4)]
d.polygon(bolt, fill=YELLOW)

def ctext(cx, y, text, font, fill):
    w = d.textlength(text, font=font)
    d.text((cx - w / 2, y), text, font=font, fill=fill)

ctext(scx, sy0 + 78,  "HASHRATE", f(20), BLACK)
ctext(scx, sy0 + 100, "5.43",     f(52), BLACK)
ctext(scx, sy0 + 158, "GH/s",     f(24), BLACK)
ctext(scx, sy0 + 192, "3 sessions active", f(15, False), (90, 60, 0))

img.save(OUT)
print("wrote", OUT, img.size)
