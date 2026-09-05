#!/usr/bin/env python3
"""
Erzeugt die App-Icons aus einer Zeichenvorschrift, damit sie nicht als
undurchsichtige Binaerdateien im Repo liegen und jederzeit neu gebaut
werden koennen.

    python3 tools/make-icons.py

Motiv: ein goldener Casino-Chip auf dunklem Filzgruen. Ein Chip ist auch
bei 40 Pixeln auf dem Homescreen noch eindeutig zu erkennen, ein Schriftzug
waere dort laengst Matsch.

Ausgabe nach public/icons/. Das maskierbare Icon hat bewusst mehr Rand:
Android schneidet daraus einen Kreis, und der Chip soll dabei heil bleiben.
"""

import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
SIZE = 1024  # in dieser Groesse wird gezeichnet, danach herunterskaliert
SS = 4       # vierfaches Ueberzeichnen gegen ausgefranste Kanten

FELT_OUTER = (4, 21, 14)
FELT_INNER = (22, 74, 50)
GOLD_DARK = (198, 158, 66)
GOLD = (231, 198, 107)
GOLD_LIGHT = (250, 227, 154)
CREAM = (250, 246, 235)


def felt_background(size):
    """Dunkelgruener Grund mit weichem Lichtkegel von oben."""
    img = Image.new("RGB", (size, size), FELT_OUTER)
    px = img.load()
    cx, cy = size / 2, size * 0.36
    max_d = size * 0.78
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy) / max_d
            t = max(0.0, 1.0 - d) ** 1.6
            px[x, y] = tuple(
                int(FELT_OUTER[i] + (FELT_INNER[i] - FELT_OUTER[i]) * t) for i in range(3)
            )
    return img


def draw_chip(img, center, radius):
    """Ein Chip: Aussenring mit Kerben, Innenring, Mitte mit Stern."""
    size = img.size[0]
    layer = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy, r = center[0] * SS, center[1] * SS, radius * SS

    def circle(rr, fill):
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=fill)

    circle(r, GOLD_DARK + (255,))
    circle(r * 0.955, GOLD + (255,))

    # Kerben am Rand, das typische Chip-Merkmal.
    notches = 8
    for i in range(notches):
        a = (i / notches) * 2 * math.pi + math.pi / notches
        for side in (-1, 1):
            aa = a + side * 0.16
            x0 = cx + math.cos(aa) * r * 0.80
            y0 = cy + math.sin(aa) * r * 0.80
            x1 = cx + math.cos(aa) * r * 1.02
            y1 = cy + math.sin(aa) * r * 1.02
            d.line([x0, y0, x1, y1], fill=CREAM + (255,), width=int(r * 0.17))
    for i in range(notches):
        a = (i / notches) * 2 * math.pi + math.pi / notches
        x0 = cx + math.cos(a) * r * 0.80
        y0 = cy + math.sin(a) * r * 0.80
        x1 = cx + math.cos(a) * r * 1.02
        y1 = cy + math.sin(a) * r * 1.02
        d.line([x0, y0, x1, y1], fill=CREAM + (255,), width=int(r * 0.34))

    circle(r * 0.78, GOLD + (255,))
    circle(r * 0.74, GOLD_DARK + (255,))
    circle(r * 0.70, GOLD_LIGHT + (255,))
    circle(r * 0.60, FELT_OUTER + (255,))

    # Stern in der Mitte, als Anspielung auf die Slot-Wilds.
    points = []
    spikes = 5
    outer, inner = r * 0.42, r * 0.175
    for i in range(spikes * 2):
        rr = outer if i % 2 == 0 else inner
        a = -math.pi / 2 + i * math.pi / spikes
        points.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    d.polygon(points, fill=GOLD_LIGHT + (255,))

    layer = layer.resize((size, size), Image.LANCZOS)
    img.paste(layer, (0, 0), layer)
    return img


def build(padding_ratio):
    img = felt_background(SIZE).convert("RGBA")
    radius = SIZE * (0.5 - padding_ratio)
    return draw_chip(img, (SIZE / 2, SIZE / 2), radius)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    normal = build(0.12)
    # Android schneidet aus maskierbaren Icons einen Kreis. Mehr Rand,
    # damit die Kerben nicht abgeschnitten werden.
    maskable = build(0.22)

    targets = [
        (normal, "icon-512.png", 512),
        (normal, "icon-192.png", 192),
        (normal, "apple-touch-icon.png", 180),
        (normal, "favicon-32.png", 32),
        (normal, "favicon-16.png", 16),
        (maskable, "icon-maskable-512.png", 512),
    ]
    for src, name, size in targets:
        out = src.resize((size, size), Image.LANCZOS).convert("RGB")
        path = os.path.join(OUT_DIR, name)
        out.save(path, "PNG", optimize=True)
        print(f"{name}: {size}x{size}, {os.path.getsize(path)} Bytes")


if __name__ == "__main__":
    main()
