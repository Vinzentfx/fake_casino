"use strict";

/**
 * Higher/Lower, Oberfläche.
 *
 * Die beiden Knoepfe tragen ihren eigenen Multiplikator und die Chance dazu.
 * Das ist der Kern des Spiels: bei einer Zwei ist "hoeher" fast sicher und
 * bringt kaum etwas, bei einer Zwei ist "tiefer" unmoeglich. Ohne diese
 * Zahlen waere es blindes Raten statt einer Entscheidung.
 *
 * Der Server rechnet die Werte aus dem echten Restdeck, der Client zeigt sie
 * nur an. Hier wird nichts nachgerechnet, sonst laufen beide auseinander.
 */
(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const mx = (n) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const VERLAUF_KEY = "casino_hilo_verlauf";
  let stand = null;
  let grenzen = { minBet: 50, maxBet: 50000, maxWin: 0 };
  let laeuft = false;

  /* --- Verlauf --- */
  const ladeVerlauf = () => { try { return JSON.parse(localStorage.getItem(VERLAUF_KEY)) || []; } catch { return []; } };
  function merkeVerlauf(gewonnen, mult) {
    const v = ladeVerlauf();
    v.unshift({ gewonnen, mult });
    try { localStorage.setItem(VERLAUF_KEY, JSON.stringify(v.slice(0, 12))); } catch {}
    zeichneVerlauf();
  }
  function zeichneVerlauf() {
    const box = $("#hilo-history");
    if (!box) return;
    const v = ladeVerlauf();
    box.innerHTML = v.length
      ? v.map((e) => `<span class="rv-chip ${e.gewonnen ? "up" : "down"}">${e.gewonnen ? mx(e.mult) + "×" : "💀"}</span>`).join("")
      : "";
  }

  /* --- Karten --- */
  const ROT = new Set([1, 2]); // Herz und Karo im Farbindex des Servers

  function karteEl(k, klasse = "") {
    const el = document.createElement("div");
    el.className = "hilo-karte " + klasse + (ROT.has(k.f) ? " rot" : "");
    const rang = k.text.slice(0, -1);
    const farbe = k.text.slice(-1);
    el.innerHTML = `<span class="hk-rang">${rang}</span><span class="hk-farbe">${farbe}</span>`;
    return el;
  }

  function zeichneKarten(v, alt) {
    const box = $("#hilo-karten");
    if (!box) return;
    box.innerHTML = "";
    if (alt) box.appendChild(karteEl(alt, "hilo-alt"));
    const neu = karteEl(v.karte, "hilo-aktuell");
    box.appendChild(neu);
    if (!document.documentElement.classList.contains("reduce-motion")) {
      neu.classList.add("hilo-rein");
      setTimeout(() => neu.classList.remove("hilo-rein"), 420);
    }
  }

  /* --- Darstellung --- */
  function zeichne(v, extra = {}) {
    stand = v;
    laeuft = !!v && !v.none && !v.over;

    $("#hilo-setup").classList.toggle("hidden", laeuft);
    $("#hilo-tipps").classList.toggle("hidden", !laeuft);
    $("#hilo-cashout").style.display = laeuft && v.treffer > 0 ? "" : "none";

    if (!laeuft) {
      $("#hilo-kette").textContent = "0";
      $("#hilo-mult").textContent = "1,00×";
      $("#hilo-cashval").textContent = "-";
      $("#hilo-rest").textContent = "";
      if (grenzen.maxWin) $("#hilo-cap").innerHTML = `Höchstgewinn ${fmt(grenzen.maxWin)}<i class=mk></i> pro Runde`;
      return;
    }

    $("#hilo-kette").textContent = String(v.treffer);
    $("#hilo-mult").textContent = mx(v.mult) + "×";
    $("#hilo-cashval").textContent = v.cashout ? fmt(v.cashout) : "-";
    $("#hilo-rest").textContent = `${v.rest} Karten übrig`;
    zeichneKarten(v, extra.alt);

    // Knopfbeschriftung: Multiplikator und Chance, oder gesperrt.
    const setzeKnopf = (id, wert, gut, gesamt) => {
      const b = $(id);
      const m = $(id + "-mult");
      const c = $(id + "-chance");
      const geht = wert != null;
      b.disabled = !geht;
      b.classList.toggle("gesperrt", !geht);
      m.textContent = geht ? mx(wert) + "×" : "geht nicht";
      /*
       * Ein Faktor von genau 1 heisst: diese Seite kann gar nicht verlieren,
       * bringt aber auch nichts. Ohne den Hinweis wirkt es wie ein Fehler
       * ("ich tippe richtig und es passiert nichts").
       */
      c.textContent = !geht ? "" : (wert === 1 ? "sicher, kein Zuwachs" : `${gut} von ${gesamt}`);
      b.classList.toggle("sicher", geht && wert === 1);
    };
    const ch = v.chancen || { hoch: 0, tief: 0 };
    const entschieden = ch.hoch + ch.tief;
    setzeKnopf("#hilo-hoch", v.hoch, ch.hoch, entschieden);
    setzeKnopf("#hilo-tief", v.tief, ch.tief, entschieden);

    const btn = $("#hilo-cashout");
    if (btn && v.cashout) {
      btn.innerHTML = `<i data-icon="auszahlen"></i> Auszahlen: ${Casino.betrag(v.cashout)} (${mx(v.mult)}×)` +
        (v.gedeckelt ? " · Deckel erreicht" : "");
      if (Casino.icons) Casino.icons.zeichne(btn);
    }
  }

  /* --- Aktionen --- */
  function starten() {
    const err = $("#hilo-error"); err.textContent = "";
    const bet = parseInt($("#hilo-amount").value, 10);
    if (!Number.isFinite(bet) || bet < grenzen.minBet) { err.textContent = `Mindestens ${fmt(grenzen.minBet)} Chips.`; return; }
    if (bet > grenzen.maxBet) { err.textContent = `Maximaleinsatz ${fmt(grenzen.maxBet)} Chips.`; return; }
    socket.emit("hilo:start", { bet }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Ging nicht."; return; }
      if (r.account) applyAccount(r.account);
      Casino.sound?.play("select");
      zeichne(r);
    });
  }

  function tippen(richtung) {
    if (!laeuft) return;
    const err = $("#hilo-error"); err.textContent = "";
    // Doppeltippen auf dem iPad darf nicht zwei Karten ziehen.
    $("#hilo-hoch").disabled = true; $("#hilo-tief").disabled = true;
    socket.emit("hilo:tipp", { richtung }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Ging nicht."; zeichne(stand); return; }
      if (r.account) applyAccount(r.account);

      if (r.ergebnis === "push") {
        toast("Gleicher Wert, zählt nicht. Weiter geht's.");
        Casino.sound?.play("tick");
        zeichne(r, { alt: r.alt });
        return;
      }
      if (r.ergebnis === "verloren") {
        Casino.sound?.play("lose");
        zeichne(r, { alt: r.alt });
        merkeVerlauf(false, 0);
        toast("Daneben. Einsatz ist weg.");
        return;
      }
      // Treffer oder automatische Auszahlung (Deck leer / Deckel erreicht).
      Casino.sound?.play("win");
      zeichne(r, { alt: r.alt });
      if (r.ergebnis === "auto") {
        merkeVerlauf(true, r.mult);
        Casino.fx.bigWin(r.payout, { label: r.grund === "deckel" ? "Höchstgewinn erreicht" : "Deck leer", faktor: r.mult });
        toast(r.grund === "deckel"
          ? `Deckel erreicht, ${fmt(r.payout)} Chips ausgezahlt.`
          : `Deck leer, ${fmt(r.payout)} Chips ausgezahlt.`);
      }
    });
  }

  function auszahlen() {
    if (!laeuft) return;
    $("#hilo-cashout").disabled = true;
    socket.emit("hilo:cashout", (r) => {
      $("#hilo-cashout").disabled = false;
      if (!r || !r.ok) { $("#hilo-error").textContent = (r && r.error) || "Ging nicht."; return; }
      applyAccount(r.account);
      merkeVerlauf(true, r.mult);
      Casino.fx.bigWin(r.payout, { label: `${r.treffer} in Folge`, faktor: r.mult });
      zeichne({ none: true });
    });
  }

  /* --- Einhaengen --- */
  function wire() {
    $("#hilo-start")?.addEventListener("click", starten);
    $("#hilo-hoch")?.addEventListener("click", () => tippen("hoch"));
    $("#hilo-tief")?.addEventListener("click", () => tippen("tief"));
    $("#hilo-cashout")?.addEventListener("click", auszahlen);
  }
  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire, { once: true });

  window.Casino._loadHilo = () => {
    zeichneVerlauf();
    socket.emit("hilo:config", (c) => {
      if (c && c.ok) {
        grenzen = { minBet: c.minBet, maxBet: c.maxBet, maxWin: c.maxWin };
        const feld = $("#hilo-amount");
        if (feld) { feld.min = c.minBet; feld.max = c.maxBet; }
        Casino.einsatz?.leiste(feld, { min: c.minBet, max: c.maxBet, schritt: 50 });
        $("#hilo-cap").innerHTML = `Höchstgewinn ${fmt(c.maxWin)}<i class=mk></i> pro Runde`;
      }
      socket.emit("hilo:state", (r) => zeichne(r && r.ok ? r : { none: true }));
    });
  };
})();
