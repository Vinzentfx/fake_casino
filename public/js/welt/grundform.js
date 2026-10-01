"use strict";

/*
 * Die Grundform der Figur in der Garderobe: Haut, Haare, Frisur, Hose.
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

  const vorschau = document.getElementById("cos-preview");
  if (!vorschau) return;

  const box = document.createElement("details");
  box.className = "wardrobe-outfits welt-grundform";
  box.open = true;
  vorschau.after(box);

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

  function zeichne() {
    const g = aktuell();
    box.innerHTML = `<summary>Deine Figur <span>kostenlos</span></summary>
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

  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-feld]");
    if (!b) return;
    const acc = Casino.getAccount();
    if (!acc) return;
    if (!gesichert) gesichert = aktuell();
    const neu = { ...aktuell(), [b.dataset.feld]: Number(b.dataset.wert) };
    // Sofort zeigen, gespeichert wird gebündelt: wer fünf Farben
    // durchprobiert, schickt eine Nachricht und nicht fünf.
    Casino.applyAccount({ figur: neu });
    zeichne();
    if (Casino._cosVorschau) Casino._cosVorschau();
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
        if (Casino._cosVorschau) Casino._cosVorschau();
      }
    });
  }

  document.addEventListener("casino:screen", (e) => { if (e.detail.screen === "cosmetics") zeichne(); });
  Casino.socket.on("account:update", () => { if (Casino.screens.current() === "cosmetics" && !speicherTimer) zeichne(); });
  zeichne();
})();
