"""Die Winterkiste aus dem Bild der Gala-Kiste.

Die Gala-Kiste ist abgelaufen, ihr Bild hat aber genau den Aufbau, den eine
limitierte Kiste braucht: Korpus, Bänder, Beschläge und ein Wappen vorn.
Gefärbt wird nach drei Sorten Pixel, nicht nach einer Formel für alles:
Schwarz wird Nachtblau, das rote Band wird Frost, Gold wird Eissilber. So
bleibt der Stern als Nordstern stehen. Obendrauf liegt Schnee, der der
Oberkante der Silhouette folgt; dadurch passt er ohne Handarbeit.

Aufruf: python3 tools/winterkiste-bild.py
"""
import colorsys
import math
import random
from pathlib import Path

from PIL import Image

ORDNER = Path(__file__).resolve().parent.parent / "public" / "assets" / "kisten"


def verlauf(stops, t):
    t = max(0.0, min(1.0, t))
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if t <= b:
            f = (t - a) / (b - a) if b > a else 0
            return tuple(round(x + (y - x) * f) for x, y in zip(ca, cb))
    return stops[-1][1]


hex_ = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
KORPUS = [(0, hex_("#050c1a")), (0.5, hex_("#163259")), (1, hex_("#5d8fc4"))]
BAND = [(0, hex_("#27486e")), (0.45, hex_("#9cc6e6")), (1, hex_("#ffffff"))]
BESCHLAG = [(0, hex_("#2a3a50")), (0.5, hex_("#9fb9d0")), (0.85, hex_("#e8f4ff")), (1, hex_("#ffffff"))]


def faerben(bild):
    px = bild.load()
    w, h = bild.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hu, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            grad = hu * 360
            hell = (0.3 * r + 0.59 * g + 0.11 * b) / 255
            if s > 0.45 and v > 0.22 and (grad < 18 or grad > 330):
                neu = verlauf(BAND, hell * 1.9)
            elif s > 0.3 and 18 <= grad < 75 and v > 0.2:
                neu = verlauf(BESCHLAG, hell * 1.15)
            else:
                neu = verlauf(KORPUS, hell * 3.2)
            px[x, y] = (*neu, a)


def schnee(bild):
    """Eine Schneedecke entlang der Oberkante, mit Wellen und Tropfnasen."""
    px = bild.load()
    w, h = bild.size
    alpha = bild.split()[3].load()
    zufall = random.Random(7)
    nasen = [(zufall.randint(60, 450), zufall.uniform(6, 14), zufall.uniform(5, 9)) for _ in range(7)]
    for x in range(w):
        oben = next((y for y in range(h) if alpha[x, y] > 128), None)
        if oben is None:
            continue
        tiefe = 22 + 6 * math.sin(x / 23) + 3 * math.sin(x / 7.3 + 1.2)
        for mitte, laenge, breite in nasen:
            d = abs(x - mitte)
            if d < breite:
                tiefe += laenge * math.cos(d / breite * math.pi / 2)
        # Ein kleiner Wulst über der Kante, damit der Schnee liegt und nicht klebt.
        wulst = 5 + 2 * math.sin(x / 11)
        for y in range(max(0, int(oben - wulst)), min(h, int(oben + tiefe))):
            if y >= oben and alpha[x, y] == 0:
                continue
            t = (y - (oben - wulst)) / (tiefe + wulst)
            # Oben fast weiß, zur Unterkante hin bläulich, wie Schatten im Schnee.
            farbe = verlauf([(0, (255, 255, 255)), (0.7, (234, 244, 252)), (1, (176, 205, 228))], t)
            rausch = zufall.randint(-6, 4)
            farbe = tuple(max(0, min(255, c + rausch)) for c in farbe)
            # Die letzte Zeile weich auslaufen lassen.
            rest = oben + tiefe - y
            deckung = 255 if rest > 1.5 else int(255 * max(0.0, rest / 1.5))
            if y < oben:
                deckung = min(deckung, int(255 * min(1.0, (y - (oben - wulst)) + 0.6)))
            r0, g0, b0, a0 = px[x, y]
            f = deckung / 255
            px[x, y] = (
                round(r0 * (1 - f) + farbe[0] * f),
                round(g0 * (1 - f) + farbe[1] * f),
                round(b0 * (1 - f) + farbe[2] * f),
                max(a0, deckung),
            )


def glitzern(bild):
    """Ein paar helle Punkte auf Eis und Schnee, sonst wirkt es matt."""
    px = bild.load()
    zufall = random.Random(11)
    w, h = bild.size
    for _ in range(60):
        x, y = zufall.randint(30, w - 30), zufall.randint(100, h - 100)
        r, g, b, a = px[x, y]
        if a < 255 or (r + g + b) < 560:
            continue
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            px[x + dx, y + dy] = (255, 255, 255, 255)


def main():
    bild = Image.open(ORDNER / "gala.png").convert("RGBA")
    faerben(bild)
    schnee(bild)
    glitzern(bild)
    bild.quantize(colors=255, method=Image.Quantize.FASTOCTREE).save(ORDNER / "winter.png", optimize=True)


if __name__ == "__main__":
    main()
