"use strict";

/* Towers (wie Dragon Tower)
   Den Turm hochklettern: auf jeder Ebene ein sicheres Feld (Ei) wählen, dann
   steigt der Multiplikator. Fallen (Totenkopf) meiden. Auszahlen geht immer.
   Entschieden wird auf dem Server (game/towers.js), hier wird nur gezeichnet. */

(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  // Multiplikatoren deutsch: "13,05" statt "13.05". toFixed liefert die
  // englische Schreibweise, die im Rest des Hauses nirgends vorkommt.
  const mx = (n) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Schwierigkeiten im Client (Breite, sicher), nur für die Vorschau-Leiter;
  // die echten Werte kommen server-seitig identisch mit (Stake-exakt, RTP 98%).
  const DIFFS = [
    { key: "easy", label: "Einfach", w: 4, s: 3 },
    { key: "medium", label: "Mittel", w: 3, s: 2 },
    { key: "hard", label: "Schwer", w: 2, s: 1 },
    { key: "expert", label: "Experte", w: 3, s: 1 },
    { key: "master", label: "Meister", w: 4, s: 1 },
  ];
  const ROWS = 9;
  const VERLAUF_KEY = "casino_towers_verlauf";
  let diffKey = "easy";
  let game = null;
  let grenzen = { minBet: 50, maxBet: 250000 };

  // Verlauf der letzten Runden. Bewusst lokal: Sitzungsgedaechtnis, kein
  // Besitz, muss nicht ueber Geraete hinweg stimmen.
  function verlauf() {
    try { const v = JSON.parse(localStorage.getItem(VERLAUF_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }
  function merke(eintrag) {
    const v = [eintrag, ...verlauf()].slice(0, 12);
    try { localStorage.setItem(VERLAUF_KEY, JSON.stringify(v)); } catch {}
    renderVerlauf();
  }
  function renderVerlauf() {
    const box = $("#tw-history");
    if (!box) return;
    const v = verlauf();
    box.innerHTML = v.length
      ? `<span class="rv-label">Letzte Runden</span>` + v.map((e) =>
          `<span class="rv-chip ${e.gewonnen ? "up" : "down"}">${e.gewonnen ? mx(e.mult) + "×" : "💀"}</span>`).join("")
      : "";
  }

  const cfg = (k) => DIFFS.find((d) => d.key === k);
  function clientLadder(k) {
    const d = cfg(k), out = [];
    for (let l = 1; l <= ROWS; l++) out.push(Math.max(1, Math.floor(Math.pow(d.w / d.s, l) * 0.98 * 100) / 100));
    return out;
  }
  function previewView() {
    const d = cfg(diffKey);
    return { width: d.w, safe: d.s, rows: ROWS, level: 0, picks: [], over: false, ladder: clientLadder(diffKey), preview: true };
  }

  function renderDiffs() {
    const box = $("#tw-diffs");
    if (!box) return;
    box.innerHTML = DIFFS.map((d) => {
      const pct = Math.round((100 * d.s) / d.w);
      return `<button class="tw-diff${d.key === diffKey ? " active" : ""}" data-diff="${d.key}">${d.label}<span>${pct}% sicher</span></button>`;
    }).join("");
    box.querySelectorAll(".tw-diff").forEach((b) =>
      b.addEventListener("click", () => {
        diffKey = b.dataset.diff;
        renderDiffs();
        if (!game || game.over) renderBoard(previewView());
      })
    );
  }

  function setActive(active) {
    $("#tw-setup").style.display = active ? "none" : "";
    $("#tw-cashout").style.display = active ? "" : "none";
  }

  function renderTop(v) {
    $("#tw-mult").textContent = mx(v.multiplier || 1) + "×";
    $("#tw-cashval").textContent = v.cashout ? fmt(v.cashout) + " Chips" : "-";
    $("#tw-next").textContent = v.nextMultiplier ? mx(v.nextMultiplier) + "×" : "-";
    const btn = $("#tw-cashout");
    btn.textContent = v.cashout ? `Auszahlen: ${fmt(v.cashout)} Chips (${mx(v.multiplier)}×)` : "Auszahlen";
    btn.disabled = !v.cashout;
  }

  // Zeichnet den Turm aus einer Server-View. Reihen von oben (Ebene 9) nach unten (Ebene 1).
  // fx: { pop:{row,tile} } markiert die frisch aufgedeckte Kachel für die Animation.
  const sym = (id) => (window.Casino.icons ? window.Casino.icons.spielSymbol(id) : "");

  function renderBoard(v, fx = {}) {
    const board = $("#tw-board");
    const width = v.width;
    board.innerHTML = "";
    for (let disp = v.rows - 1; disp >= 0; disp--) { // disp = Reihenindex (0 = unten)
      const rowEl = document.createElement("div");
      rowEl.className = "tw-row";
      const climbed = disp < v.level;
      const active = disp === v.level && !v.over && !v.preview;
      const future = disp > v.level && !v.over && !v.preview;
      if (active) rowEl.classList.add("active");
      if (future) rowEl.classList.add("future");
      if (climbed) rowEl.classList.add("climbed");

      /*
       * Wo der Deckel greift, muss es dranstehen.
       *
       * Auf "Meister" verspricht Ebene 9 das 256.901-fache. Ausgezahlt werden
       * hoechstens 2 Mio je Runde, also ist die Stufe schon beim
       * Mindesteinsatz von 50 Chips abgeschnitten. Eine Leiter, die etwas
       * verspricht und dann kuerzt, ist eine Luege, Mines zeigt seinen
       * Deckel laengst, Towers hat ihn nur verschwiegen.
       */
      const mlab = document.createElement("span");
      mlab.className = "tw-mult-lab";
      const mult = v.ladder[disp] || 1;
      const einsatz = Number(($("#tw-amount") || {}).value) || (v.bet || 0);
      const gedeckelt = grenzen.maxWin && einsatz > 0 && mult * einsatz > grenzen.maxWin;
      // Deutsch formatiert wie ueberall sonst: "×256.901,12" statt
      // "×256901.12". toFixed liefert englische Schreibweise.
      mlab.textContent = "×" + mult.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (gedeckelt) mlab.classList.add("tw-gedeckelt");
      rowEl.appendChild(mlab);

      const tilesEl = document.createElement("div");
      tilesEl.className = "tw-tiles";
      for (let t = 0; t < width; t++) {
        const b = document.createElement("button");
        b.className = "tw-tile";
        /*
         * Zwei Seiten wie in Mines: der Deckel klappt um, dahinter liegt eine
         * gezeichnete Seite. Vorher stand die Kachel leer da und beim Tippen
         * erschien ein Emoji darin, kein Moment, und auf jedem Geraet ein
         * anderes Bild.
         */
        b.innerHTML = `<span class="tw-flip"><span class="tw-back"></span><span class="tw-front"></span></span>`;
        const face = (id) => { b.querySelector(".tw-front").innerHTML = sym(id); b.classList.add("auf"); };
        const isTrap = v.trapLayout && v.trapLayout[disp] && v.trapLayout[disp].includes(t);
        if (climbed) {
          b.disabled = true;
          if (v.picks[disp] === t) { b.classList.add("egg"); face("ei"); }
          else if (v.trapLayout) { b.classList.add(isTrap ? "trap" : "safe-dim"); face(isTrap ? "totenkopf" : "ei"); }
          else b.classList.add("covered");
        } else if (active) {
          b.addEventListener("click", () => pick(t));
        } else {
          b.disabled = true;
          if (v.over && v.trapLayout) { b.classList.add(isTrap ? "trap" : "safe-dim"); face(isTrap ? "totenkopf" : "ei"); }
        }
        if (v.over && v.bust && disp === v.row && t === v.tile) b.classList.add("boom");
        if (fx.pop && disp === fx.pop.row && t === fx.pop.tile) b.classList.add("pop");
        tilesEl.appendChild(b);
      }
      rowEl.appendChild(tilesEl);
      if (active) {
        const dragon = document.createElement("span");
        dragon.className = "tw-dragon";
        dragon.textContent = "🐉";
        rowEl.appendChild(dragon);
      }
      board.appendChild(rowEl);
    }

    /*
     * Der Deckel als sichtbare Zeile, nicht als title-Tooltip: auf dem iPad
     * gibt es kein Hover, dort waere er gar nicht erreichbar.
     */
    if (grenzen.maxWin) {
      const cap = document.createElement("div");
      cap.className = "tw-cap";
      const einsatz2 = Number(($("#tw-amount") || {}).value) || (v.bet || 0);
      const ab = einsatz2 > 0 && (v.ladder || []).some((m) => m * einsatz2 > grenzen.maxWin);
      cap.innerHTML = `Höchstgewinn ${fmt(grenzen.maxWin)}<i class=mk></i> pro Runde` +
        (ab ? ` · <b>bei diesem Einsatz greift der Deckel</b>` : "");
      board.appendChild(cap);
    }
  }

  function apply(v) {
    const prev = game;
    game = v;
    renderTop(v.bust ? { ...v, cashout: 0, nextMultiplier: null } : v);
    if (v.bust) { $("#tw-cashval").textContent = "verloren"; $("#tw-next").textContent = "-"; }
    // Frisch aufgedeckte Kachel für die Pop-Animation ermitteln.
    const fx = {};
    if (prev && !prev.over && v.level > prev.level) fx.pop = { row: v.level - 1, tile: v.picks[v.level - 1] };
    renderBoard(v, fx);
    const board = $("#tw-board");
    if (v.over) {
      setActive(false);
      if (v.account) applyAccount(v.account);
      if (v.bust) {
        board.classList.add("tw-bust");
        setTimeout(() => board.classList.remove("tw-bust"), 900);
        toast("Falle erwischt, Einsatz weg.");
        merke({ gewonnen: false, mult: 0 });
      } else if (v.cashedOut || v.cleared) {
        board.classList.add("tw-win");
        const float = document.createElement("div");
        float.className = "tw-float";
        float.textContent = `+${fmt(v.payout)} Chips`;
        board.appendChild(float);
        setTimeout(() => { board.classList.remove("tw-win"); float.remove(); }, 1600);
        toast(v.cleared ? `Turm bezwungen! +${fmt(v.payout)} Chips` : `+${fmt(v.payout)} Chips (${mx(v.mult)}×)!`);
        merke({ gewonnen: true, mult: v.mult || v.multiplier || 1 });
      }
    } else setActive(true);
  }

  const snd = window.Casino.sound;

  function pick(t) {
    if (!game || game.over) return;
    socket.emit("towers:pick", { tile: t }, (v) => {
      if (!v || !v.ok) { $("#tw-error").textContent = (v && v.error) || "Fehler."; return; }
      if (v.bust) snd.play("bust");
      // Je hoeher die Etage, desto hoeher der Ton.
      else snd.tone(400 + Math.min(v.level || 0, 12) * 60, 0.1, "triangle", 0.05);
      apply(v);
    });
  }

  $("#tw-start").addEventListener("click", () => {
    const err = $("#tw-error"); err.textContent = "";
    const bet = parseInt($("#tw-amount").value, 10);
    // Grenzen kommen vom Server. Fest getippt liefen sie auseinander, sobald
    // dort eine Zahl geaendert wird, genau das war hier passiert.
    if (!Number.isFinite(bet) || bet < grenzen.minBet) { err.textContent = `Mindestens ${fmt(grenzen.minBet)} Chips.`; return; }
    if (bet > grenzen.maxBet) { err.textContent = `Maximaleinsatz ${fmt(grenzen.maxBet)} Chips.`; return; }
    socket.emit("towers:start", { bet, difficulty: diffKey }, (v) => {
      if (!v || !v.ok) { err.textContent = (v && v.error) || "Fehler."; return; }
      snd.play("chip");
      if (v.account) applyAccount(v.account);
      apply(v);
    });
  });

  $("#tw-cashout").addEventListener("click", () => {
    socket.emit("towers:cashout", (v) => {
      if (!v || !v.ok) { $("#tw-error").textContent = (v && v.error) || "Fehler."; return; }
      const gewinn = v.payout || 0;
      if (gewinn > 0 && (v.multiplier || 0) >= 3) window.Casino.fx.bigWin(gewinn, { label: "Ausgezahlt", faktor: v.multiplier });
      else { snd.play("cash"); window.Casino.fx.coins($("#tw-cashout")); }
      apply(v);
    });
  });

  /*
   * Der Deckel haengt vom Einsatz ab, also muss die Leiter beim Tippen neu.
   * Sonst steht die Markierung noch auf dem Betrag von vorhin.
   */
  document.addEventListener("input", (e) => {
    if (e.target && e.target.id === "tw-amount" && (!game || game.over)) renderBoard(previewView());
  });

  window.Casino._loadTowers = () => {
    renderDiffs();
    renderVerlauf();
    // Läuft server-seitig noch ein Spiel (z.B. nach Neuladen des Tabs)? Dann fortsetzen.
    socket.emit("towers:state", (v) => {
      if (v && v.minBet) {
        // maxWin muss mit: der Server schickt den Deckel, und ohne ihn
        // verspricht die Leiter Betraege, die nie ausgezahlt werden.
        grenzen = { minBet: v.minBet, maxBet: v.maxBet, maxWin: v.maxWin };
        const feld = $("#tw-amount");
        if (feld) { feld.min = v.minBet; feld.max = v.maxBet; }
        window.Casino.einsatz.leiste(feld, { min: v.minBet, max: v.maxBet, schritt: 50 });
      }
      if (v && v.ok && !v.none) { diffKey = v.difficulty || diffKey; renderDiffs(); apply(v); return; }
      if (!game || game.over) {
        game = null;
        $("#tw-error").textContent = "";
        setActive(false);
        renderTop({ multiplier: 1, cashout: 0, nextMultiplier: null });
        renderBoard(previewView());
      }
    });
  };
})();
