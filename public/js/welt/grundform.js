"use strict";

/*
 * Die Grundform der Figur in der Garderobe: Haut, Haare, Frisur, Hose.
 * Die Garderobe (public/js/garderobe.js) hängt sie in ihren Reiter „Figur“.
 *
 * Sie kostet nichts und ist kein Besitz. Wer neu dazukommt, soll vom ersten
 * Abend an eine Figur haben, die nach ihm aussieht, und nicht erst nach der
 * zehnten Kiste. Alles, woran man Seltenheit erkennt (Jacke, Kopfbedeckung,
 * Gegenstand in der Hand), bleibt bei der Sammlung.
 *
 * Gespeichert wird am Konto (`welt:figur`), nicht im Browser: dieselbe
 * Figur soll auf dem iPad und dem Telefon stehen.
 */
(function () {
  const Casino = window.Casino;
  if (!Casino || !Casino.figur || !Casino.socket) return;
  const F = Casino.figur;
  const esc = (s) => Casino.escapeHtml ? Casino.escapeHtml(s) : String(s);

  /* Wohin gezeichnet wird, entscheidet die Garderobe (`zeichne(el)`). Früher
     hing die Grundform fest unter der Vorschau in der Sammlung. */
  let box = null;

  const FELDER = [
    { feld: "haut", titel: "Haut", farben: F.HAUT },
    { feld: "haar", titel: "Haare", farben: F.HAAR },
    { feld: "frisur", titel: "Frisur", farben: null },
    { feld: "hose", titel: "Hose", farben: F.HOSE },
  ];

  let speicherTimer = null;
  let gesichert = null;

  function aktuell() {
    const acc = Casino.getAccount() || {};
    const g = acc.figur || {};
    return { haut: g.haut || 0, haar: g.haar || 0, frisur: g.frisur || 0, hose: g.hose || 0 };
  }

  function zeichne(ziel) {
    if (ziel) box = ziel;
    if (!box || !box.isConnected) return;
    const g = aktuell();
    box.innerHTML = `
      <div class="gf">
        <p class="gf-hinweis">Haut, Haare und Hose gehören dir von Anfang an. Jacke, Kopfbedeckung und das Ding in der Hand kommen aus deiner Sammlung.</p>
        ${FELDER.map(({ feld, titel, farben }) => `
          <div class="gf-zeile">
            <span class="gf-titel" id="gf-${feld}">${esc(titel)}</span>
            <div class="gf-wahl" role="radiogroup" aria-labelledby="gf-${feld}">
              ${(farben || F.FRISUREN).map((wert, i) => {
                const an = g[feld] === i;
                const name = F.NAMEN[feld][i];
                return farben
                  ? `<button type="button" role="radio" aria-checked="${an}" aria-label="${esc(titel)}: ${esc(name)}" class="gf-farbe${an ? " an" : ""}" data-feld="${feld}" data-wert="${i}" style="--gf:${esc(wert)}"></button>`
                  : `<button type="button" role="radio" aria-checked="${an}" class="gf-text${an ? " an" : ""}" data-feld="${feld}" data-wert="${i}">${esc(name)}</button>`;
              }).join("")}
            </div>
          </div>`).join("")}
      </div>`;
  }

  /* Die Figur hat sich geändert: Spiegel und Welt zeichnen neu. */
  const melden = () => document.dispatchEvent(new CustomEvent("casino:figur"));

  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".gf [data-feld]");
    if (!b) return;
    const acc = Casino.getAccount();
    if (!acc) return;
    if (!gesichert) gesichert = aktuell();
    const neu = { ...aktuell(), [b.dataset.feld]: Number(b.dataset.wert) };
    // Sofort zeigen, gespeichert wird gebündelt: wer fünf Farben
    // durchprobiert, schickt eine Nachricht und nicht fünf.
    Casino.applyAccount({ figur: neu });
    zeichne();
    melden();
    if (Casino.welt) Casino.welt.eigeneFigurNeu({ figur: neu });
    clearTimeout(speicherTimer);
    speicherTimer = setTimeout(() => speichern(neu), 900);
  });

  function speichern(g) {
    speicherTimer = null;
    Casino.socket.emit("welt:figur", g, (res) => {
      if (res && res.ok) {
        gesichert = null;
        return;
      }
      Casino.toast((res && res.error) || "Die Figur konnte nicht gespeichert werden.");
      if (gesichert) {
        Casino.applyAccount({ figur: gesichert });
        gesichert = null;
        zeichne();
        melden();
      }
    });
  }

  Casino.socket.on("account:update", () => { if (!speicherTimer) zeichne(); });
  Casino.grundform = { zeichne };
})();
