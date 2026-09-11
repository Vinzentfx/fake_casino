"use strict";

/* ============================================================
   Mines

   Server-autoritativ (game/mines.js); hier wird nur gezeichnet.

   Was hier neu ist und warum:
   • Die Auszahlungstabelle steht vor dem Einsatz da. Vorher tippte man eine
     Minenzahl in ein Zahlenfeld, ohne zu wissen, was zwei Minen gegenüber
     zwanzig überhaupt bringen.
   • Minen sind eine Knopfreihe statt eines Zahlenfelds. "17" hat nie jemand
     getippt, und auf dem iPad kostet jedes Zahlenfeld eine Tastatur.
   • Zufallsfeld und "bis zum Ziel aufdecken": beim Aufdecken gibt es nichts zu
     können, jedes verdeckte Feld ist gleich wahrscheinlich. Zielen auf kleine
     Kacheln ist damit reine Fingerarbeit ohne Entscheidung.
   • Ein Verlauf der letzten Runden, damit eine Sitzung nicht spurlos bleibt.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  // Multiplikatoren deutsch: "13,05" statt "13.05". toFixed liefert die
  // englische Schreibweise, die im Rest des Hauses nirgends vorkommt.
  const mx = (n) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const snd = Casino.sound;

  const TILES = 25;
  const MINEN_WAHL = [1, 3, 5, 10, 15, 24];
  const VERLAUF_KEY = "casino_mines_verlauf";

  let game = null;          // Spiegel der letzten Server-Sicht
  let minen = 3;
  let grenzen = { minBet: 50, maxBet: 250000 };
  let autoLaeuft = false;

  // --- Verlauf ---
  // Bewusst lokal: das ist Sitzungsgedaechtnis, kein Besitz, und muss nicht
  // ueber Geraete hinweg stimmen.
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
    const box = $("#mines-history");
    if (!box) return;
    const v = verlauf();
    box.innerHTML = v.length
      ? `<span class="rv-label">Letzte Runden</span>` + v.map((e) =>
          `<span class="rv-chip ${e.gewonnen ? "up" : "down"}">${e.gewonnen ? mx(e.mult) + "×" : "💥"}</span>`).join("")
      : "";
  }

  // --- Aufbau ---
  /*
   * Jede Kachel hat zwei Seiten und dreht sich beim Aufdecken um.
   *
   * Vorher war es ein leeres Viereck, in dem beim Aufdecken einfach ein Emoji
   * erschien. Das sah nach nichts aus: kein Moment, keine Bewegung, und das
   * Emoji sieht auf jedem Geraet anders aus. Jetzt liegt hinter dem Deckel
   * eine gezeichnete Seite, und die Kachel klappt darauf um.
   */
  function buildGrid() {
    const grid = $("#mines-grid");
    if (grid.childElementCount === TILES) return;
    grid.innerHTML = "";
    for (let i = 0; i < TILES; i++) {
      const b = document.createElement("button");
      b.className = "mine-tile";
      b.dataset.tile = i;
      b.innerHTML = `<span class="mt-flip"><span class="mt-back"></span><span class="mt-front"></span></span>`;
      b.addEventListener("click", () => reveal(i));
      grid.appendChild(b);
    }
  }

  function renderMinenWahl() {
    const box = $("#mines-mine-row");
    if (!box) return;
    box.innerHTML = MINEN_WAHL.map((m) =>
      `<button type="button" class="mines-mine${m === minen ? " active" : ""}" data-minen="${m}">${m}</button>`).join("");
  }

  /*
   * Die Auszahlungstabelle stand als eine einzige gequetschte Zeile da, in der
   * Ueberschrift, fuenf Stufen und der Deckel um denselben Platz kaempften.
   * Jetzt drei Ebenen: Ueberschrift, ein Raster mit Luft dazwischen, und der
   * Deckel als eigene Zeile darunter, der gehoert nicht in die Leiter, er
   * begrenzt sie.
   */
  function renderPay(tabelle) {
    const box = $("#mines-pay");
    if (!box || !tabelle) return;
    box.innerHTML =
      `<div class="mines-pay-head">Bei ${minen} ${minen === 1 ? "Mine" : "Minen"} zahlt dein Einsatz</div>` +
      `<div class="mines-pay-row">` +
        tabelle.map((z) =>
          `<span class="mines-pay-step"><b>${mx(z.mult)}×</b>` +
          `<small>${z.safe} ${z.safe === 1 ? "Feld" : "Felder"}</small></span>`).join("") +
      `</div>` +
      (grenzen.maxWin
        ? `<div class="mines-pay-cap">Höchstgewinn ${fmt(grenzen.maxWin)}<i class=mk></i> pro Runde</div>` : "");
  }

  function ladeConfig() {
    socket.emit("mines:config", { mines: minen }, (r) => {
      if (!r || !r.ok) return;
      grenzen = { minBet: r.minBet, maxBet: r.maxBet, maxWin: r.maxWin };
      const feld = $("#mines-amount");
      if (feld) { feld.min = r.minBet; feld.max = r.maxBet; }
      Casino.einsatz.leiste(feld, { min: r.minBet, max: r.maxBet, schritt: 50 });
      renderPay(r.paytable);
    });
  }

  // --- Zeichnen ---
  function setActive(active) {
    $("#mines-setup").style.display = active ? "none" : "";
    $("#mines-cashout").style.display = active ? "" : "none";
    $("#mines-live").classList.toggle("hidden", !active);
  }

  function renderTop(v) {
    $("#mines-mult").textContent = mx(v.multiplier || 1) + "×";
    $("#mines-cashval").textContent = v.cashout ? fmt(v.cashout) + " Chips" : "-";
    $("#mines-next").textContent = v.nextMultiplier ? mx(v.nextMultiplier) + "×" : "-";
    if (v.cashout) $("#mines-cashout").textContent = `Auszahlen: ${fmt(v.cashout)} Chips (${mx(v.multiplier)}×)`;
    else $("#mines-cashout").textContent = "Auszahlen";
    $("#mines-cashout").disabled = !v.cashout;
  }

  const SYM = (id) => (Casino.icons ? Casino.icons.spielSymbol(id) : "");

  function paint(v) {
    const tiles = $("#mines-grid").children;
    for (let i = 0; i < TILES; i++) {
      const t = tiles[i];
      t.className = "mine-tile";
      t.querySelector(".mt-front").innerHTML = "";
      t.disabled = !!v.over;
    }
    for (const idx of v.revealed || []) {
      tiles[idx].classList.add("gem", "auf");
      tiles[idx].querySelector(".mt-front").innerHTML = SYM("edelstein");
    }
    if (v.over && v.mineSet) {
      for (const idx of v.mineSet) {
        if (tiles[idx].classList.contains("gem")) continue;
        tiles[idx].classList.add("bomb", "auf");
        tiles[idx].querySelector(".mt-front").innerHTML = SYM("bombe");
      }
      if (v.bust && v.tile != null) tiles[v.tile].classList.add("boom");
    }
  }

  function apply(v) {
    game = v;
    renderTop(v.bust ? { ...v, multiplier: v.multiplier, cashout: 0, nextMultiplier: null } : v);
    if (v.bust) { $("#mines-cashval").textContent = "verloren"; $("#mines-next").textContent = "-"; }
    paint(v);
    if (v.over) {
      autoLaeuft = false;
      setActive(false);
      if (v.account) applyAccount(v.account);
      if (v.bust) { toast("Bombe. Einsatz weg."); merke({ gewonnen: false, mult: 0 }); }
      else if (v.cashedOut) { toast(`+${fmt(v.payout)} Chips (${mx(v.mult)}×)`); merke({ gewonnen: true, mult: v.mult }); }
      else if (v.cleared) { toast(`Alles leergeräumt! +${fmt(v.payout)} Chips`); merke({ gewonnen: true, mult: v.multiplier }); }
    } else setActive(true);
  }

  // --- Züge ---
  function tonFuerAufdecken(v) {
    if (v.bust) return snd.play("bust");
    // Jeder sichere Stein klingt eine Stufe hoeher. Das baut die Spannung
    // hoerbar auf, ohne dass man auf den Multiplikator schauen muss.
    const stufe = (v.revealed || []).length;
    snd.tone(420 + Math.min(stufe, 18) * 45, 0.09, "triangle", 0.05);
  }

  function reveal(i) {
    if (!game || game.over || autoLaeuft) return;
    if ((game.revealed || []).includes(i)) return;
    socket.emit("mines:reveal", { tile: i }, (v) => {
      if (!v || !v.ok) { $("#mines-error").textContent = (v && v.error) || "Fehler."; return; }
      tonFuerAufdecken(v);
      apply(v);
    });
  }

  function revealRandom() {
    return new Promise((fertig) => {
      if (!game || game.over) return fertig(null);
      socket.emit("mines:revealRandom", (v) => {
        if (!v || !v.ok) { $("#mines-error").textContent = (v && v.error) || "Fehler."; return fertig(null); }
        tonFuerAufdecken(v);
        apply(v);
        fertig(v);
      });
    });
  }

  /**
   * Zufällig weiter aufdecken, bis der Ziel-Multiplikator erreicht ist, dann
   * auszahlen. Bricht bei einer Bombe von selbst ab. Die Entscheidung, wann
   * Schluss ist, trifft man damit vorher einmal statt unter Druck.
   */
  async function autoAufdecken() {
    if (!game || game.over || autoLaeuft) return;
    const ziel = parseFloat($("#mines-target").value.replace(",", "."));
    if (!Number.isFinite(ziel) || ziel <= 1) { toast("Ziel muss über 1× liegen."); return; }
    autoLaeuft = true;
    $("#mines-auto").disabled = true;
    try {
      while (game && !game.over && (game.multiplier || 1) < ziel) {
        const v = await revealRandom();
        if (!v || v.over) break;
        await new Promise((r) => setTimeout(r, 220));
      }
      if (game && !game.over && (game.multiplier || 1) >= ziel) cashout();
    } finally {
      autoLaeuft = false;
      $("#mines-auto").disabled = false;
    }
  }

  function cashout() {
    socket.emit("mines:cashout", (v) => {
      if (!v || !v.ok) { $("#mines-error").textContent = (v && v.error) || "Fehler."; return; }
      const gewinn = v.payout || 0;
      // Ab dem Dreifachen des Einsatzes ist es ein Ereignis, darunter reicht
      // der Muenzwurf. Sonst feiert man sich bei 1,05x zu Tode.
      if (gewinn > 0 && (v.multiplier || 0) >= 3) Casino.fx.bigWin(gewinn, { label: "Ausgezahlt", faktor: v.multiplier });
      else { snd.play("cash"); Casino.fx.coins($("#mines-cashout")); }
      apply(v);
    });
  }

  // --- Verdrahtung ---
  $("#mines-mine-row").addEventListener("click", (e) => {
    const b = e.target.closest("[data-minen]");
    if (!b) return;
    minen = parseInt(b.dataset.minen, 10);
    snd.play("tick");
    renderMinenWahl();
    ladeConfig();
  });

  $("#mines-start").addEventListener("click", () => {
    const err = $("#mines-error"); err.textContent = "";
    const bet = parseInt($("#mines-amount").value, 10);
    if (!Number.isFinite(bet) || bet < grenzen.minBet) { err.textContent = `Mindestens ${fmt(grenzen.minBet)} Chips.`; return; }
    if (bet > grenzen.maxBet) { err.textContent = `Maximaleinsatz ${fmt(grenzen.maxBet)} Chips.`; return; }
    socket.emit("mines:start", { bet, mines: minen }, (v) => {
      if (!v || !v.ok) { err.textContent = (v && v.error) || "Fehler."; return; }
      snd.play("chip");
      if (v.account) applyAccount(v.account);
      apply(v);
    });
  });

  $("#mines-random").addEventListener("click", () => { if (!autoLaeuft) revealRandom(); });
  $("#mines-auto").addEventListener("click", autoAufdecken);
  $("#mines-cashout").addEventListener("click", cashout);

  Casino._loadMines = () => {
    buildGrid();
    renderMinenWahl();
    renderVerlauf();
    ladeConfig();
    // Läuft server-seitig noch ein Spiel (z.B. nach Tab-Reload)? → fortsetzen.
    socket.emit("mines:state", (v) => {
      if (v && v.ok && !v.none) { apply(v); return; }
      if (!game || game.over) {
        $("#mines-error").textContent = "";
        setActive(false);
        const tiles = $("#mines-grid").children;
        for (let i = 0; i < TILES; i++) {
          tiles[i].className = "mine-tile";
          tiles[i].querySelector(".mt-front").innerHTML = "";
          tiles[i].disabled = false;
        }
        renderTop({ multiplier: 1, cashout: 0, nextMultiplier: null });
      }
    });
  };
})();
