"use strict";

/**
 * Ein Bild vom Geraet holen und auf ein festes Mass bringen.
 *
 * ---------------------------------------------------------------------------
 * Warum die Verkleinerung hier passiert und nicht auf dem Server
 *
 * Bild-Upload ist der klassische Weg, sich einen Server einzutreten: eine
 * SVG-Datei mit eingebettetem Skript, eine Datei, die gleichzeitig ein
 * gueltiges Bild und ein gueltiges HTML ist, EXIF-Daten mit dem Wohnort des
 * Fotografen, ein 40-Megapixel-Bild, das beim Verarbeiten den Arbeitsspeicher
 * sprengt.
 *
 * Der Umweg ueber ein Canvas raeumt das alles ab, ohne dass jemand eine
 * Bibliothek einbinden muss: der Browser dekodiert das Bild, wir zeichnen es
 * in eine Flaeche fester Groesse, und heraus kommt ein frisch erzeugtes
 * Rasterbild — ohne Skript, ohne Anhaengsel, ohne EXIF, mit bekannter
 * Kantenlaenge. Die Originaldatei verlaesst das Geraet nie.
 *
 * Der Server prueft trotzdem Signatur und Groesse: ein Client laesst sich
 * faelschen, und auf etwas, das er nicht selbst erzeugt hat, verlaesst sich
 * ein Server nicht.
 */
(function () {
  const Casino = (window.Casino = window.Casino || {});

  const MAX_QUELLE = 25 * 1024 * 1024;   // vor dem Verkleinern; alles darueber
                                          // ist ein Versehen, kein Wappen

  /**
   * Datei einlesen, quadratisch zuschneiden, verkleinern, neu kodieren.
   *
   * @param {File} datei
   * @param {object} [o]
   * @param {number} [o.kante=256]   Kantenlaenge des Ergebnisses.
   * @param {number} [o.guete=0.86]  WebP-Guete.
   * @returns {Promise<{ok: boolean, error?: string, datenUrl?: string, bytes?: number}>}
   */
  async function verkleinere(datei, o = {}) {
    const kante = o.kante || 256;
    const guete = o.guete || 0.86;

    if (!datei) return { ok: false, error: "Keine Datei gewählt." };
    if (!/^image\//.test(datei.type || "")) {
      return { ok: false, error: "Das ist kein Bild." };
    }
    if (datei.size > MAX_QUELLE) {
      return { ok: false, error: `Die Datei ist sehr groß (${Math.round(datei.size / 1024 / 1024)} MB). Nimm ein kleineres Bild.` };
    }

    let bitmap = null;
    try {
      /* createImageBitmap dekodiert nebenlaeufig und faellt bei kaputten
         Dateien sauber auf die Nase, statt eine halbe Zeichnung zu liefern.
         Safari kann es seit 15 — fuer aeltere kommt der Rueckfall darunter. */
      if (typeof createImageBitmap === "function") {
        bitmap = await createImageBitmap(datei);
      }
    } catch { bitmap = null; }

    if (!bitmap) {
      try {
        bitmap = await new Promise((fertig, schiefgegangen) => {
          const url = URL.createObjectURL(datei);
          const img = new Image();
          img.onload = () => { URL.revokeObjectURL(url); fertig(img); };
          img.onerror = () => { URL.revokeObjectURL(url); schiefgegangen(new Error("nicht lesbar")); };
          img.src = url;
        });
      } catch {
        return { ok: false, error: "Das Bild ließ sich nicht öffnen." };
      }
    }

    const bw = bitmap.width || bitmap.naturalWidth;
    const bh = bitmap.height || bitmap.naturalHeight;
    if (!bw || !bh) return { ok: false, error: "Das Bild ist leer." };

    // Mittigen Ausschnitt nehmen — ein Wappen ist quadratisch, und ein
    // gestauchtes Bild sieht immer nach Fehler aus.
    const seite = Math.min(bw, bh);
    const sx = Math.floor((bw - seite) / 2);
    const sy = Math.floor((bh - seite) / 2);

    const c = document.createElement("canvas");
    c.width = kante;
    c.height = kante;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    try {
      ctx.drawImage(bitmap, sx, sy, seite, seite, 0, 0, kante, kante);
    } catch {
      return { ok: false, error: "Das Bild ließ sich nicht verarbeiten." };
    }
    if (bitmap.close) { try { bitmap.close(); } catch {} }

    /* WebP ist deutlich kleiner als PNG. Kann ein Browser es nicht, liefert
       toDataURL still ein PNG — das faellt hier auf und wird akzeptiert,
       der Server nimmt beides. */
    let datenUrl = c.toDataURL("image/webp", guete);
    if (!/^data:image\/webp/.test(datenUrl)) {
      datenUrl = c.toDataURL("image/png");
    }
    const bytes = Math.round((datenUrl.length - datenUrl.indexOf(",") - 1) * 0.75);
    return { ok: true, datenUrl, bytes };
  }

  /**
   * Dateiauswahl oeffnen und gleich verkleinern.
   * @returns {Promise<null|{ok: boolean, error?: string, datenUrl?: string, bytes?: number}>}
   *   null, wenn niemand etwas ausgewaehlt hat.
   */
  function waehle(o = {}) {
    return new Promise((fertig) => {
      const feld = document.createElement("input");
      feld.type = "file";
      feld.accept = "image/png,image/jpeg,image/webp,image/gif";
      feld.style.display = "none";
      document.body.appendChild(feld);
      let erledigt = false;
      const aufraeumen = () => { try { feld.remove(); } catch {} };
      feld.addEventListener("change", async () => {
        erledigt = true;
        const datei = feld.files && feld.files[0];
        aufraeumen();
        if (!datei) return fertig(null);
        fertig(await verkleinere(datei, o));
      });
      /* Bricht jemand den Systemdialog ab, kommt kein change-Ereignis. Ohne
         dieses Aufraeumen bliebe fuer jeden Abbruch ein Feld im Dokument. */
      window.addEventListener("focus", () => {
        setTimeout(() => { if (!erledigt) { aufraeumen(); fertig(null); } }, 400);
      }, { once: true });
      feld.click();
    });
  }

  Casino.bildwahl = { waehle, verkleinere };
})();
