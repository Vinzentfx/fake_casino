"use strict";

/**
 * Kniffel-Duell, Oberfläche.
 *
 * Zwei Bloecke: die Wuerfel oben (antippen zum Halten), der Block darunter
 * zeigt beide Zettel nebeneinander. Was ein Feld mit den aktuellen Wuerfeln
 * braechte, steht direkt daneben, sonst muesste man im Kopf rechnen, und
 * genau das ist bei Kniffel die Entscheidung, nicht das Rechnen.
 *
 * Die Vorschau bekommt nur, wer dran ist. Der Server schickt sie dem Gegner
 * gar nicht erst mit.
 */
(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let st = null;
  let grenzen = { minBet: 50, maxBet: 50000 };
  let felder = [];
  let uhr = null;

  const PUNKTE = {
    1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
  };
  const wuerfelSvg = (a) =>
    `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="currentColor">` +
    (PUNKTE[a] || []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8.5"/>`).join("") + `</g></svg>`;

  function zeichne(v) {
    st = v;
    const laeuft = v && !v.none && v.phase !== "vorbei";
    const warten = v && v.phase === "warten";

    $("#kn-setup").classList.toggle("hidden", !!v && !v.none);
    $("#kn-warten").classList.toggle("hidden", !warten);
    $("#kn-spiel").classList.toggle("hidden", !(v && v.phase === "laeuft"));
    $("#kn-ende").classList.toggle("hidden", !(v && v.phase === "vorbei"));

    clearInterval(uhr);
    if (!v || v.none) return;

    if (warten) {
      $("#kn-code").textContent = v.code;
      $("#kn-warten-info").textContent = `Einsatz ${fmt(v.einsatz)} Chips. Warte auf einen Gegner, oder lade jemanden ein.`;
      return;
    }

    if (v.phase === "vorbei" && v.ergebnis) {
      const e = v.ergebnis;
      const ich = (Casino.getAccount() || {}).name;
      const gewonnen = e.gewinner && ich && e.gewinner.toLowerCase() === ich.toLowerCase();
      $("#kn-ende-titel").textContent = !e.gewinner ? "Unentschieden" : gewonnen ? "Gewonnen!" : "Verloren";
      $("#kn-ende-text").innerHTML = e.stand.map((s) => `${escapeHtml(s.name)}: <b>${s.punkte}</b>`).join(" &nbsp;·&nbsp; ") +
        (e.grund === "aufgegeben" ? "<br><small>Aufgegeben.</small>" : e.grund === "abgelaufen" ? "<br><small>Zu lange nichts passiert.</small>" : "");
      return;
    }

    // --- Würfel ---
    const box = $("#kn-wuerfel");
    box.innerHTML = "";
    (v.wuerfel || []).forEach((a, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kn-w" + (v.halten[i] ? " gehalten" : "");
      b.dataset.index = String(i);
      b.disabled = !v.ichBinDran;
      b.innerHTML = wuerfelSvg(a) + `<span class="kn-w-marke">${v.halten[i] ? "hält" : ""}</span>`;
      box.appendChild(b);
    });

    $("#kn-dran").innerHTML = v.ichBinDran
      ? `<b>Du bist dran</b> · noch ${v.wuerfeUebrig} ${v.wuerfeUebrig === 1 ? "Wurf" : "Würfe"}`
      : `${escapeHtml(v.dranName || "…")} ist dran`;
    $("#kn-wurf").disabled = !v.ichBinDran || v.wuerfeUebrig < 1;
    $("#kn-wurf").textContent = v.wuerfeUebrig ? `Nochmal würfeln (${v.wuerfeUebrig})` : "Keine Würfe mehr";

    // Restzeit für den Zug
    if (v.zugBis) {
      const tick = () => {
        const s = Math.max(0, Math.round((v.zugBis - Date.now()) / 1000));
        $("#kn-zeit").textContent = s > 0 ? `${s}s` : "Zeit um";
        $("#kn-zeit").classList.toggle("knapp", s <= 15);
      };
      tick();
      uhr = setInterval(() => {
        if (Casino.screens.current() !== "kniffel") { clearInterval(uhr); return; }
        tick();
      }, 1000);
    }

    // --- Zettel ---
    const ichKey = v.spieler.find((s) => s.name === (Casino.getAccount() || {}).name);
    const kopf = `<div class="kn-zeile kn-kopf"><span></span>` +
      v.spieler.map((s) => `<span>${escapeHtml(s.name)}</span>`).join("") + `</div>`;
    const zeilen = felder.map((f) => {
      const vorschauWert = v.vorschau && v.vorschau[f.id];
      const zellen = v.spieler.map((s) => {
        const wert = s.blatt[f.id];
        if (wert != null) return `<span class="kn-wert">${wert}</span>`;
        const meins = ichKey && s.key === ichKey.key;
        if (meins && v.ichBinDran && vorschauWert != null) {
          return `<button class="kn-setzen${vorschauWert === 0 ? " null" : ""}" data-feld="${f.id}">${vorschauWert}</button>`;
        }
        return `<span class="kn-leer">-</span>`;
      }).join("");
      return `<div class="kn-zeile"><span class="kn-feld"><b>${escapeHtml(f.label)}</b><em>${escapeHtml(f.hinweis)}</em></span>${zellen}</div>`;
    }).join("");
    const summe = `<div class="kn-zeile kn-summe"><span>Gesamt</span>` +
      v.spieler.map((s) => `<span>${s.gesamt}</span>`).join("") + `</div>`;
    $("#kn-zettel").innerHTML = kopf + zeilen + summe;
    $("#kn-topf").textContent = `Topf ${fmt(v.topf)} Chips`;
  }

  function hole() { socket.emit("kniffel:state", (r) => zeichne(r)); }

  function wire() {
    $("#kn-create")?.addEventListener("click", () => {
      const err = $("#kn-error"); err.textContent = "";
      const bet = parseInt($("#kn-amount").value, 10);
      if (!Number.isFinite(bet) || bet < grenzen.minBet) { err.textContent = `Mindestens ${fmt(grenzen.minBet)} Chips.`; return; }
      if (bet > grenzen.maxBet) { err.textContent = `Maximaleinsatz ${fmt(grenzen.maxBet)} Chips.`; return; }
      const oeffentlich = $("#kn-oeffentlich").checked;
      socket.emit("kniffel:create", { bet, oeffentlich }, (r) => {
        if (!r || !r.ok) { err.textContent = (r && r.error) || "Ging nicht."; return; }
        if (r.account) applyAccount(r.account);
        zeichne(r);
      });
    });

    $("#kn-join")?.addEventListener("click", () => {
      const err = $("#kn-error"); err.textContent = "";
      const code = ($("#kn-code-eingabe").value || "").trim().toUpperCase();
      if (!code) { err.textContent = "Code eingeben."; return; }
      socket.emit("kniffel:join", { code }, (r) => {
        if (!r || !r.ok) { err.textContent = (r && r.error) || "Ging nicht."; return; }
        if (r.account) applyAccount(r.account);
        zeichne(r);
      });
    });

    $("#kn-wuerfel")?.addEventListener("click", (e) => {
      const b = e.target.closest(".kn-w");
      if (!b || b.disabled) return;
      socket.emit("kniffel:halten", { index: Number(b.dataset.index) }, (r) => { if (r && r.ok) zeichne(r); });
    });

    $("#kn-wurf")?.addEventListener("click", () => {
      socket.emit("kniffel:wurf", (r) => { if (r && r.ok) zeichne(r); else if (r) toast(r.error); });
    });

    $("#kn-zettel")?.addEventListener("click", (e) => {
      const b = e.target.closest(".kn-setzen");
      if (!b) return;
      socket.emit("kniffel:eintragen", { feld: b.dataset.feld }, (r) => { if (r && !r.ok) toast(r.error); });
    });

    for (const id of ["#kn-aufgeben", "#kn-abbrechen"]) {
      $(id)?.addEventListener("click", async () => {
        const frage = id === "#kn-abbrechen"
          ? "Partie abbrechen? Du bekommst deinen Einsatz zurück."
          : "Wirklich aufgeben? Der Einsatz ist dann weg.";
        if (!await Casino.dialog.frage(frage, { titel: "Kniffel", okText: "Ja", gefahr: id === "#kn-aufgeben" })) return;
        socket.emit("kniffel:aufgeben", () => hole());
      });
    }
    $("#kn-nochmal")?.addEventListener("click", () => zeichne({ none: true }));
  }
  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire, { once: true });

  socket.on("kniffel:state", (v) => { if (Casino.screens.current() === "kniffel") zeichne(v); });
  // Beitritt aus der Lobby-Liste heraus.
  window.Casino._kniffelJoinCode = (code) => {
    Casino.screens.show("kniffel");
    socket.emit("kniffel:join", { code }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Ging nicht."); return; }
      if (r.account) applyAccount(r.account);
      zeichne(r);
    });
  };

  window.Casino._loadKniffel = () => {
    socket.emit("kniffel:config", (c) => {
      if (c && c.ok) {
        grenzen = { minBet: c.minBet, maxBet: c.maxBet };
        felder = c.felder || [];
        const feld = $("#kn-amount");
        if (feld) { feld.min = c.minBet; feld.max = c.maxBet; }
        Casino.einsatz?.leiste(feld, { min: c.minBet, max: c.maxBet, schritt: 50 });
      }
      hole();
    });
  };
})();
