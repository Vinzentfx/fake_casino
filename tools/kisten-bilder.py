#!/usr/bin/env python3
"""Die vier Kistenbilder aus dem Ausgangsbild schneiden und freistellen.

Das Ausgangsbild ist eine 2x2-Tafel: oben Tages- und Holzkiste, unten
Messing- und Schwarze Kiste, jede auf einem Studiohintergrund mit Lichtring
und einer Beschriftung darunter.

Zwei Dinge macht dieses Skript, und beide sind der Grund, warum die Bilder
im Haus nicht mehr wie Produktfotos in einem grauen Kasten aussehen:

  1. Es SCHNEIDET nach Mass, nicht nach Raster. Jede Kiste sitzt anders im
     Quadranten; ein festes Raster trifft dadurch keine einzige mittig.
     Gemessen wird ueber die Kantenstaerke, denn der Hintergrund ist ein
     glatter Verlauf und die Kiste hat harte Kanten.
  2. Es STELLT FREI. Mit durchsichtigem Hintergrund kann die Kiste im
     Browser schweben, einen farbigen Schein werfen und ueber ihre Kachel
     hinausragen. Mit Hintergrund bleibt sie ein Rechteck.

Drei Dinge haengen als Rest am Rand der Kiste und muessen weg: die
Beschriftung (wird vorher abgeschnitten), der Lichtring auf dem Boden (ein
duenner Bogen, den starkes Schrumpfen abreisst) und der Schatten direkt
unter der Kiste (ein schmaler Stumpf, den fussKappen() wegnimmt).

    python3 tools/kisten-bilder.py <ausgangsbild.png>              # 2x2-Tafel
    python3 tools/kisten-bilder.py <ausgangsbild.png> <name>       # ein Bild

Die zweite Form ist fuer Nachzuegler wie die Gala-Kiste: ein Bild, eine
Kiste, derselbe Weg.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

NAMEN = [["tag", "holz"], ["messing", "schwarz"]]
# So viel vom Quadranten bleibt stehen. Darunter steht nur noch die
# Beschriftung, und die gehoert nicht ins Spiel: die Kiste heisst im Haus so,
# wie es in game/kisten.js steht.
UNTEN = 0.76
SEITE = 512


def groesste(m):
    """Nur die groesste zusammenhaengende Flaeche behalten."""
    lab, n = ndimage.label(m)
    if not n:
        return m
    return lab == (np.argmax(ndimage.sum(m, lab, range(1, n + 1))) + 1)


def schaele(voll, tief, zurueck):
    """Duenne Auslaeufer abreissen, ohne die Ecken rund zu machen.

    Schrumpfen trennt den Lichtring von der Kiste, danach bleibt nur der
    Kern uebrig. Der wird wieder ausgedehnt und mit der urspruenglichen
    Flaeche geschnitten - dadurch behaelt die Kiste ihre scharfen Ecken,
    statt sie beim Zurueckdehnen zu verlieren.
    """
    kern = groesste(ndimage.binary_erosion(voll, iterations=tief))
    return ndimage.binary_fill_holes(voll & ndimage.binary_dilation(kern, iterations=zurueck))


def kappen(m, achse, anteil, vonHinten=True):
    """Schmale Reste am Rand abschneiden.

    Zwei Sorten haengen an der Kiste: der Schatten darunter (ein schmaler
    Stumpf am Boden) und Reste des Lichtrings an den Seiten. Beide sind
    deutlich duenner als die Kiste selbst, also: vom Rand nach innen laufen
    und alles wegnehmen, was unter dem Anteil der dicksten Reihe bleibt.
    """
    dicke = m.sum(axis=1 - achse)
    if not dicke.max():
        return m
    grenze = dicke.max() * anteil
    reihe = range(len(dicke) - 1, -1, -1) if vonHinten else range(len(dicke))
    for i in reihe:
        if dicke[i] >= grenze:
            break
        if achse == 0:
            m[i] = False
        else:
            m[:, i] = False
    return m


def spannFuellen(m):
    """Kerben in der Silhouette schliessen.

    Selbst mit beiden Spuren bleiben Kerben stehen, wo eine Flaeche im
    Schatten liegt: bei der Holzkiste die rechte Seitenwand, bei der
    Gala-Kiste der Spalt neben dem Eckbeschlag.

    Eine Kiste ist aber KONVEX — ein Kasten in Schraegsicht ist ein Sechseck.
    Also wird erst je Zeile alles zwischen dem linken und dem rechten
    Treffer gefuellt und danach auf dem ERGEBNIS je Spalte alles zwischen
    dem obersten und dem untersten. Hintereinander, nicht geschnitten:
    eine Kerbe, die bis zum unteren Rand durchgeht, hat in ihren Spalten
    nichts mehr unter sich, mit dem sie sich ueberbruecken liesse, und
    bliebe beim Schneiden stehen.
    """
    def spanne(feld, achse):
        out = np.zeros_like(feld)
        for i in range(feld.shape[achse]):
            reihe = feld[i] if achse == 0 else feld[:, i]
            treffer = np.flatnonzero(reihe)
            if not len(treffer):
                continue
            if achse == 0:
                out[i, treffer[0]:treffer[-1] + 1] = True
            else:
                out[treffer[0]:treffer[-1] + 1, i] = True
        return out

    # Erst zeilenweise, dann spaltenweise auf dem ERGEBNIS. Zuerst hatte ich
    # beide getrennt gerechnet und geschnitten; das laesst eine Kerbe stehen,
    # die bis zum unteren Rand durchgeht, weil in ihren Spalten unterhalb
    # nichts mehr liegt, mit dem sie sich ueberbruecken liesse. Hintereinander
    # schliesst beides, und ueber die Silhouette hinaus waechst es nicht:
    # die groesste Flaeche steht vorher schon allein da.
    return spanne(spanne(m, 0), 1)


def silhouette(grau):
    """Wo die Kiste ist.

    Zuerst stand hier nur die Kantenstaerke, und daran ist die Holzkiste
    gescheitert: ihre rechte Seitenwand liegt im Schatten und hat kaum
    Kontrast zum Hintergrund, es fehlte ein ganzes Stueck aus der Kiste.

    Die zweite Spur ist die oertliche STREUUNG. Der Hintergrund ist
    weichgezeichnet und damit fast glatt; die Kiste hat Maserung, Nieten und
    Beschlaege und streut ueberall stark, auch im Schatten. Beide Spuren
    zusammen finden die Silhouette auch dort, wo eine allein blind ist.
    """
    mittel = ndimage.uniform_filter(grau, 9)
    streuung = np.sqrt(np.clip(ndimage.uniform_filter(grau * grau, 9) - mittel * mittel, 0, None))
    kante = np.hypot(ndimage.sobel(grau, axis=1), ndimage.sobel(grau, axis=0))
    return (streuung > np.percentile(streuung, 88) * 0.5) | (kante > np.percentile(kante, 97) * 0.30)


def freistellen(bild):
    grau = np.asarray(bild.convert("L"), dtype=np.float32) / 255.0
    m = silhouette(grau)
    m = ndimage.binary_dilation(m, iterations=4)
    m = ndimage.binary_closing(m, structure=np.ones((11, 11)))
    m = groesste(ndimage.binary_fill_holes(m))
    m = schaele(m, 12, 16)
    m = kappen(m, 0, 0.60)                   # Schatten unter der Kiste
    m = kappen(m, 1, 0.30)                   # Ringreste rechts
    m = kappen(m, 1, 0.30, vonHinten=False)  # und links
    m = spannFuellen(groesste(m))            # Kerben zu, Kiste bleibt Kiste

    # Weiche Kante, sonst treppt der Rand vor dem farbigen Schein.
    alpha = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1)))
    ys, xs = np.where(alpha > 16)
    kiste = Image.fromarray(np.dstack([np.asarray(bild.convert("RGB")), alpha])) \
        .crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

    # Quadratisch mit etwas Luft: so ist jede Kiste gleich gross im Raster,
    # egal wie breit sie ist, und der Schein hat Platz.
    w, h = kiste.size
    s = int(max(w, h) * 1.12)
    leer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    leer.paste(kiste, ((s - w) // 2, (s - h) // 2), kiste)
    leer = leer.resize((SEITE, SEITE), Image.LANCZOS)
    # 200 Farben statt 16 Millionen. Nebeneinander ist kein Unterschied zu
    # sehen, die Datei ist danach ein Fuenftel so gross - und vier Bilder
    # zu je 230 kB waeren auf dem iPad unterwegs eine Gedenksekunde.
    return leer.quantize(colors=200, method=Image.FASTOCTREE)


def schreibe(ausschnitt, name):
    ziel = f"public/assets/kisten/{name}.png"
    freistellen(ausschnitt).save(ziel, optimize=True)
    print("geschrieben:", ziel)


def main(quelle, name=None, unten=UNTEN):
    src = Image.open(quelle)
    if name:
        # Ein Bild, eine Kiste. Unten steht auch hier die Beschriftung.
        w, h = src.size
        schreibe(src.crop((0, 0, w, int(h * unten))), name)
        return
    qw, qh = src.size[0] // 2, src.size[1] // 2
    for r in range(2):
        for c in range(2):
            q = src.crop((c * qw, r * qh, (c + 1) * qw, r * qh + int(qh * UNTEN)))
            schreibe(q, NAMEN[r][c])


if __name__ == "__main__":
    if not 2 <= len(sys.argv) <= 4:
        sys.exit(__doc__)
    main(sys.argv[1],
         sys.argv[2] if len(sys.argv) >= 3 else None,
         float(sys.argv[3]) if len(sys.argv) == 4 else UNTEN)
