"use strict";

/*
 * Der Warteraum im Browser (Server: game/einlass.js).
 *
 * Solange Einlass ist, steht man im Foyer: oben läuft der Countdown, alle
 * anderen Bildschirme sind zu (der Wächter in app.js fragt `sperrt`), und
 * die Dinge im Foyer öffnen hier ihre Tafeln. Die eigentliche Sperre sitzt
 * auf dem Server; was hier passiert, ist nur, dass man nicht gegen Wände
 * läuft.
 *
 * Die Restzeit kommt vom Server und wird hier gegen die eigene Uhr
 * weitergezählt, nicht gegen eine Uhrzeit: eine falsch gehende Uhr am iPad
 * ändert nichts. Bei der Öffnung („einlass:auf“) läuft die Schau: Tür auf,
 * Kordel fällt, Konfetti, und vier Sekunden später setzt der Server alle ins
 * Casino. Danach kommt das Ergebnis vom Schätzglas und das Eröffnungspaket.
 */
(function () {
  const Casino = window.Casino;
  const { socket, toast, escapeHtml } = Casino;
  const esc = (s) => escapeHtml(String(s == null ? "" : s));
  const de = (n) => Number(n || 0).toLocaleString("de-DE");
  const html = document.documentElement;

  let st = null;
  let ende = 0;               // eigene Uhr: Date.now() + rest beim Empfang
  let paketGefragt = false;
  let ergebnisGezeigt = false;
  let tafel = null, tafelArt = null;

  const gesperrt = () => !!(st && st.zu && !st.frei);
  const ALLE_DUERFEN = new Set(["lobby", "settings", "login", "verification"]);

  Casino.einlass = {
    gesperrt,
    geladen: () => !!st,
    sperrt: (name) => gesperrt() && !ALLE_DUERFEN.has(name),
    text: () => (st && st.text) || "Noch ist Einlass.",
    oeffne,
    zustand: () => st,
  };

  /* Band oben mit dem Countdown, und die großen Zahlen der letzten zehn
     Sekunden. */
  const band = document.createElement("div");
  band.className = "einlass-band hidden";
  band.setAttribute("role", "status");
  band.innerHTML = `<b></b><span></span><small>Bis dahin: schätzen, ins Gästebuch schreiben, lesen, was kommt. Und vielleicht mal an die Tür klopfen.</small>`;
  document.body.appendChild(band);
  /* Wer frei ist (Besitzer, Testliste), sieht den Warteraum sonst gar nicht.
     Ein schmales Band sagt, dass er läuft, und führt hinein und wieder heraus. */
  const frei = document.createElement("div");
  frei.className = "einlass-frei hidden";
  frei.innerHTML = `<span></span><button type="button" data-einlass-frei="rein">Warteraum ansehen</button>`;
  document.body.appendChild(frei);
  frei.addEventListener("click", (e) => {
    const b = e.target.closest("[data-einlass-frei]");
    if (!b) return;
    socket.emit("einlass:ansehen", { rein: b.dataset.einlassFrei === "rein" }, (r) => {
      if (!r || !r.ok) toast((r && r.error) || "Das ging nicht.");
    });
  });
  const gross = document.createElement("div");
  gross.className = "einlass-gross hidden";
  gross.setAttribute("aria-hidden", "true");
  document.body.appendChild(gross);

  function uhr(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sek = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(sek).padStart(2, "0")}`;
  }
  function dauer(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return `${min} Min.`;
    const h = Math.floor(min / 60), r = min % 60;
    return r ? `${h} Std. ${r} Min.` : `${h} Std.`;
  }

  function laden() {
    if (!Casino.getAccount || !Casino.getAccount()) return;
    socket.emit("einlass:state", (r) => {
      if (!r || !r.ok) return;
      anwenden(r);
    });
  }

  function anwenden(r) {
    st = r;
    ende = Date.now() + (r.rest || 0);
    html.classList.toggle("einlass-zu", gesperrt());
    band.classList.toggle("hidden", !gesperrt());
    frei.classList.toggle("hidden", !(r.zu && r.frei));
    if (r.zu && r.frei) freiZeichnen();
    if (gesperrt()) {
      band.querySelector("b").textContent = r.titel ? `${r.titel}: Einlass um ${zeitVon(r.bis)} Uhr` : `Einlass um ${zeitVon(r.bis)} Uhr`;
      // Wer schon in einem Spiel oder in der Übersicht stand, kommt zurück in den Raum.
      const jetzt = Casino.screens.current();
      if (jetzt && !ALLE_DUERFEN.has(jetzt)) Casino.showScreen("lobby");
      if (Casino.welt && Casino.welt.setzeAnsicht) Casino.welt.setzeAnsicht("welt");
    }
    if (tafel && tafelArt) zeichneTafel();
    anzeigen();
    if (!gesperrt()) nachDerOeffnung();
  }
  const zeitVon = (ts) => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

  /* Die Anzeigen an den Dingen im Foyer. */
  function anzeigen() {
    if (!st) return;
    const rest = Math.max(0, ende - Date.now());
    const u = document.querySelector('[data-anzeige="einlass-uhr"]');
    if (u) u.textContent = st.zu ? uhr(rest) : "OFFEN";
    const g = document.querySelector('[data-anzeige="einlass-glas"]');
    if (g) g.textContent = `${de(st.glas.schaetzungen)} ${st.glas.schaetzungen === 1 ? "Tipp" : "Tipps"}`;
    // Die Tafeln nur neu schreiben, wenn sich etwas ändert; der Takt läuft viermal je Sekunde.
    const t = document.querySelector('[data-anzeige="einlass-teaser"]');
    if (t) {
      const auf = st.teaser.filter((x) => x.auf).length;
      setzeHtml(t, st.teaser.map((x) => x.auf ? `<p><b>${esc(x.titel)}</b></p>` : `<p><b>???</b> in ${esc(dauer(x.in - (Date.now() - (ende - (st.rest || 0)))))}</p>`).join("")
        + `<p><small>${auf} von ${st.teaser.length} aufgedeckt</small></p>`);
    }
    const w = document.querySelector('[data-anzeige="einlass-wand"]');
    if (w) setzeHtml(w, (st.wand || []).slice(-5).reverse().map((x) => `<p><b>${esc(x.name)}</b>${esc(x.text)}</p>`).join("") || "<p>Noch leer. Schreib als Erster etwas.</p>");
  }
  function setzeHtml(el, inhalt) {
    if (el._inhalt === inhalt) return;
    el._inhalt = inhalt;
    el.innerHTML = inhalt;
  }

  function freiZeichnen() {
    if (!st || !st.zu || !st.frei) return;
    const imFoyer = Casino.welt && Casino.welt.zustand && Casino.welt.zustand().raum === "foyer";
    frei.querySelector("span").textContent = `Warteraum läuft, Einlass um ${zeitVon(st.bis)} Uhr (noch ${uhr(Math.max(0, ende - Date.now()))}). Du bist frei.`;
    const b = frei.querySelector("button");
    b.dataset.einlassFrei = imFoyer ? "raus" : "rein";
    b.textContent = imFoyer ? "Zurück ins Casino" : "Warteraum ansehen";
  }

  let letzteSekunde = null;
  setInterval(() => {
    if (!st) return;
    const rest = Math.max(0, ende - Date.now());
    if (gesperrt()) {
      band.querySelector("span").textContent = rest > 0 ? `noch ${uhr(rest)}` : "Gleich geht die Tür auf …";
      const sek = Math.ceil(rest / 1000);
      if (sek <= 10 && sek >= 1) {
        gross.textContent = String(sek);
        gross.classList.remove("hidden");
        if (sek !== letzteSekunde) {
          letzteSekunde = sek;
          gross.classList.remove("puls"); void gross.offsetWidth; gross.classList.add("puls");
          Casino.sound && Casino.sound.play(sek <= 3 ? "select" : "tick");
        }
      } else gross.classList.add("hidden");
    }
    if (st.zu && st.frei) freiZeichnen();
    anzeigen();
  }, 250);

  /* Die Tafeln an den Dingen. Gleiche Optik wie die Tische in der Welt. */
  function oeffne(art, res) {
    if (art === "tuer") {
      Casino.sound && Casino.sound.play(res && res.neu ? "geheimnis" : "klopfen");
      if (res && res.neu) Casino.dialog.hinweis(res.satz, { titel: "Gefunden!" });
      else if (res && res.satz) toast(res.satz);
      return;
    }
    tafelArt = art;
    if (!tafel) {
      tafel = document.createElement("section");
      tafel.className = "welt-tisch einlass-tafel";
      tafel.setAttribute("aria-live", "polite");
      (document.querySelector(".welt-hud") || document.body).appendChild(tafel);
      tafel.addEventListener("click", klick);
      tafel.addEventListener("submit", (e) => { e.preventDefault(); senden(); });
    }
    tafel.classList.remove("hidden");
    zeichneTafel();
    laden();
  }
  function zu() { if (tafel) tafel.classList.add("hidden"); tafelArt = null; }

  function zeichneTafel(info = "") {
    if (!tafel || !st) return;
    const kopf = (titel, unter) => `<header><div><b>${esc(titel)}</b><small>${esc(unter)}</small></div>
      <button type="button" class="welt-tisch-zu" data-einlass="zu" aria-label="Schließen">${Casino.icons ? Casino.icons.ui("schliessen") : "×"}</button></header>`;
    const hinweis = `<p class="welt-tisch-info">${esc(info)}</p>`;
    if (tafelArt === "glas") {
      const m = st.glas.meine;
      tafel.innerHTML = kopf("Schätzglas", `${de(st.glas.schaetzungen)} ${st.glas.schaetzungen === 1 ? "Schätzung" : "Schätzungen"} bisher`)
        + `<p class="einlass-text">Wie viele Chips sind im Glas? Jeder schätzt einmal, aufgelöst wird bei der Öffnung. Wer am nächsten dran ist, bekommt den Titel „Augenmaß“ und ${de(st.glas.preis)} Chips.</p>`
        + (m ? `<p class="einlass-text"><b>Deine Schätzung: ${de(m)}</b></p>`
          : st.zu ? `<form class="einlass-form"><input type="number" inputmode="numeric" min="1" max="100000" placeholder="Deine Zahl" aria-label="Deine Schätzung" required><button type="submit" class="welt-tisch-drehen">Schätzen</button></form>` : "")
        + hinweis;
    } else if (tafelArt === "wand") {
      const liste = (st.wand || []).slice().reverse();
      tafel.innerHTML = kopf("Gästebuch", `${liste.length} ${liste.length === 1 ? "Eintrag" : "Einträge"}`)
        + (st.zu ? `<form class="einlass-form"><input type="text" maxlength="60" placeholder="${st.meineZeile ? "Deine Zeile ändern" : "Was willst du hinterlassen?"}" aria-label="Eintrag" value="${esc(st.meineZeile)}" required><button type="submit" class="welt-tisch-drehen">${st.meineZeile ? "Ändern" : "Anschreiben"}</button></form>` : "")
        + `<div class="einlass-wandliste">${liste.map((x) => `<p><b>${esc(x.name)}</b> ${esc(x.text)}</p>`).join("") || "<p>Noch steht hier nichts.</p>"}</div>`
        + hinweis;
    } else if (tafelArt === "teaser") {
      const seit = Date.now() - (ende - (st.rest || 0));
      tafel.innerHTML = kopf("Was hinter der Tür wartet", "Je näher die Öffnung, desto mehr steht hier")
        + `<div class="einlass-teaser">${st.teaser.map((x) => x.auf
          ? `<div class="auf"><b>${esc(x.titel)}</b><span>${esc(x.text)}</span></div>`
          : `<div><b>Verdeckt</b><span>Deckt sich in ${esc(dauer(x.in - seit))} auf.</span></div>`).join("")}</div>`
        + hinweis;
    }
  }

  function klick(e) {
    if (e.target.closest('[data-einlass="zu"]')) zu();
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tafelArt) zu(); });
  function senden() {
    const feld = tafel && tafel.querySelector(".einlass-form input");
    if (!feld) return;
    const wert = feld.value;
    if (tafelArt === "glas") {
      socket.emit("einlass:schaetzen", { zahl: Number(wert) }, (r) => {
        if (!r || !r.ok) return zeichneTafel((r && r.error) || "Das ging nicht.");
        st = { ...st, ...r };
        Casino.sound && Casino.sound.play("chip");
        zeichneTafel("Gemerkt. Aufgelöst wird bei der Öffnung.");
      });
    } else if (tafelArt === "wand") {
      socket.emit("einlass:schreiben", { text: wert }, (r) => {
        if (!r || !r.ok) return zeichneTafel((r && r.error) || "Das ging nicht.");
        st = { ...st, ...r };
        Casino.sound && Casino.sound.play("select");
        zeichneTafel("Steht an der Wand.");
      });
    }
  }

  /* Die Öffnung. */
  let warImWarteraum = false;
  let berichtNachher = false;
  socket.on("einlass:auf", (d) => {
    warImWarteraum = gesperrt();
    berichtNachher = warImWarteraum;
    const warDrin = gesperrt();
    if (!warDrin) { toast("Die Tür ist auf, das Update ist da."); laden(); return; }
    zu();
    gross.textContent = "AUF!";
    gross.classList.remove("hidden", "puls"); void gross.offsetWidth; gross.classList.add("puls", "auf");
    band.querySelector("span").textContent = "Die Tür ist auf!";
    const tuer = document.querySelector('[data-ding="einlasstuer"]');
    if (tuer) tuer.classList.add("auf");
    if (Casino.sound) { Casino.sound.play("jackpot"); setTimeout(() => Casino.sound.play("glocke"), 600); }
    if (Casino.fx && Casino.fx.confetti) { Casino.fx.confetti({ count: 120, wucht: 1.4 }); setTimeout(() => Casino.fx.confetti({ count: 80 }), 900); }
    const umzug = (d && d.umzugIn) || 4000;
    setTimeout(() => {
      gross.classList.add("hidden");
      gross.classList.remove("auf");
      laden();
    }, umzug + 300);
  });
  socket.on("einlass:update", () => laden());
  socket.on("einlass:wand", ({ wand } = {}) => {
    if (!st || !Array.isArray(wand)) return;
    st = { ...st, wand };
    anzeigen();
    if (tafelArt === "wand") zeichneTafel();
  });
  socket.on("connect", () => setTimeout(laden, 400));

  /* Nach der Öffnung: Ergebnis vom Schätzglas und das Paket, je einmal. */
  /* Die Zeitung als letztes: erst wenn kein anderes Fenster mehr offen ist. */
  function berichtSpaeter(versuch = 0) {
    if (!berichtNachher) return;
    const offen = !!document.querySelector(".dlg-overlay") || ["update-modal", "onboarding-modal"].some((id) => { const el = document.getElementById(id); return el && !el.classList.contains("hidden"); });
    if (offen && versuch < 90) { setTimeout(() => berichtSpaeter(versuch + 1), 800); return; }
    berichtNachher = false;
    if (Casino._berichtVielleicht) Casino._berichtVielleicht();
  }

  async function nachDerOeffnung() {
    if (!st || st.zu) return;
    // Wartet das Paket noch auf das Neuigkeiten-Fenster, kommt die Zeitung erst danach.
    if (await paketUndErgebnis() !== "warten") berichtSpaeter();
  }
  async function paketUndErgebnis() {
    // Wer im Warteraum stand, bekommt jetzt das Fenster mit den Neuerungen.
    if (warImWarteraum) { warImWarteraum = false; if (Casino._maybeShowUpdate) Casino._maybeShowUpdate(); }
    // Das Paket erst, wenn das Neuigkeiten-Fenster zu ist; zwei Fenster übereinander liest niemand.
    const modal = document.getElementById("update-modal");
    if (st.paket && !paketGefragt && modal && !modal.classList.contains("hidden")) { setTimeout(nachDerOeffnung, 700); return "warten"; }
    if (st.ergebnis && st.ergebnis.meine && !ergebnisGezeigt) {
      ergebnisGezeigt = true;
      const e = st.ergebnis;
      const sieger = e.sieger ? `${e.sieger.name} lag mit ${de(e.sieger.zahl)} am nächsten.` : "";
      toast(`Schätzglas: ${de(e.glas)} Chips waren drin. Du hattest ${de(e.meine)}. ${sieger}`);
      // Am Konto abhaken, sonst kommt es nach dem Neuladen wieder.
      socket.emit("einlass:ergebnisGesehen");
      st = { ...st, ergebnis: null };
    }
    if (st.paket && !paketGefragt) {
      paketGefragt = true;
      const ok = await Casino.dialog.frage(`Zur Eröffnung gibt es ein Paket mit ${de(st.paket.chips)} Chips, für jeden einmal. Es liegt bis ${new Date(st.paket.bis).toLocaleString("de-DE", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} Uhr bereit.`,
        { titel: "Eröffnungspaket", okText: "Abholen", abbruchText: "Später" });
      if (!ok) return;
      socket.emit("einlass:paket", (r) => {
        if (!r || !r.ok) { toast((r && r.error) || "Das ging nicht."); return; }
        if (r.account) Casino.applyAccount(r.account);
        Casino.sound && Casino.sound.play("cash");
        toast(`Eröffnungspaket: +${de(r.chips)} Chips`);
        st = { ...st, paket: null };
      });
    }
  }

  // Erst laden, wenn ein Konto da ist; danach regelmäßig nachgleichen.
  const warte = setInterval(() => { if (Casino.getAccount && Casino.getAccount()) { clearInterval(warte); laden(); } }, 500);
  setInterval(() => { if (st && st.zu) laden(); }, 60000);
})();
