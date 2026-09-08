"use strict";

/**
 * Gemeinsame Effekte: Feiern, Zahlen hochzaehlen, Ladeplatzhalter.
 *
 * Bisher hatten nur die Slots eine Gewinnfeier. Ein dicker Treffer in Mines,
 * Towers oder Crash passierte kommentarlos: die Zahl stand einfach da. Das
 * hier ist die gemeinsame Stelle dafuer, damit ein Gewinn ueberall gleich
 * gefeiert wird und nicht jedes Spiel sein eigenes Konfetti erfindet.
 *
 * Alles respektiert "Bewegung reduzieren" aus den Einstellungen: dann gibt es
 * keine Partikel, und Zahlen springen sofort auf den Endwert statt zu zaehlen.
 * Der Effekt entfaellt, die Information nicht.
 */
(function () {
  const reduziert = () => document.documentElement.classList.contains("reduce-motion");
  const fmt = (n) => Math.round(n).toLocaleString("de-DE");

  let schicht = null;
  function ebene() {
    if (schicht && schicht.isConnected) return schicht;
    schicht = document.createElement("div");
    schicht.className = "fx-layer";
    schicht.setAttribute("aria-hidden", "true");
    document.body.appendChild(schicht);
    return schicht;
  }

  /**
   * Konfetti. Ohne Zielelement regnet es von oben, mit Zielelement fliegt es
   * aus dessen Mitte weg (etwa aus dem Gewinnfeld heraus).
   */
  function confetti({ count = 60, origin = null, colors = null, wucht = 1 } = {}) {
    if (reduziert()) return;
    const host = ebene();
    const stil = getComputedStyle(document.documentElement);
    const palette = colors || [
      stil.getPropertyValue("--accent").trim() || "#e7c66b",
      stil.getPropertyValue("--accent-strong").trim() || "#f7dc8c",
      stil.getPropertyValue("--good").trim() || "#4ade80",
      "#ffffff",
    ];
    const box = origin ? origin.getBoundingClientRect() : null;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("i");
      p.className = "fx-confetti";
      p.style.background = palette[i % palette.length];
      if (box) {
        p.style.left = box.left + box.width / 2 + "px";
        p.style.top = box.top + box.height / 2 + "px";
        const winkel = Math.random() * Math.PI * 2;
        const weite = 90 + Math.random() * 220;
        p.style.setProperty("--dx", Math.cos(winkel) * weite + "px");
        p.style.setProperty("--dy", Math.sin(winkel) * weite + 160 + "px");
      } else {
        p.style.left = Math.random() * 100 + "vw";
        p.style.top = "-20px";
        p.style.setProperty("--dx", (Math.random() * 160 - 80) + "px");
        p.style.setProperty("--dy", window.innerHeight + 80 + "px");
      }
      p.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
      p.style.animationDelay = Math.random() * 0.25 + "s";
      // Groesser und laenger, je groesser der Gewinn war.
      p.style.animationDuration = 1.2 + wucht * 0.22 + Math.random() * 0.9 + "s";
      p.style.width = (8 + wucht * 2) + "px";
      p.style.height = (13 + wucht * 3) + "px";
      host.appendChild(p);
      setTimeout(() => p.remove(), 3400);
    }
  }

  /** Muenzen, die aus einem Element herausspringen. Fuer Auszahlungen. */
  function coins(el, { count = 14 } = {}) {
    if (reduziert() || !el) return;
    const host = ebene();
    const box = el.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const c = document.createElement("i");
      c.className = "fx-coin";
      c.textContent = "Chips";
      c.style.left = box.left + box.width / 2 + "px";
      c.style.top = box.top + box.height / 2 + "px";
      c.style.setProperty("--dx", (Math.random() * 240 - 120) + "px");
      c.style.setProperty("--dy", -(80 + Math.random() * 150) + "px");
      c.style.animationDelay = Math.random() * 0.18 + "s";
      host.appendChild(c);
      setTimeout(() => c.remove(), 1600);
    }
  }

  /**
   * Zahl hochzaehlen. Gibt sich Muehe, kurz zu bleiben: unter 400 ms wirkt es
   * hektisch, ueber 1,6 s langweilig, deshalb der Deckel.
   */
  function countUp(el, von, bis, { duration = null, format = fmt, sound = false } = {}) {
    if (!el) return;
    if (reduziert()) { el.textContent = format(bis); return; }
    const spanne = bis - von;
    const dauer = duration != null ? duration : Math.min(1600, Math.max(400, Math.abs(spanne) * 1.2));
    const start = performance.now();
    let letzterTon = 0;
    function schritt(jetzt) {
      const t = Math.min(1, (jetzt - start) / dauer);
      // Weich auslaufend, damit die letzten Ziffern lesbar werden.
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = format(von + spanne * e);
      if (sound && window.Casino.sound && jetzt - letzterTon > 60 && t < 1) {
        letzterTon = jetzt;
        window.Casino.sound.play("countUp");
      }
      if (t < 1) requestAnimationFrame(schritt);
      else el.textContent = format(bis);
    }
    requestAnimationFrame(schritt);
  }

  /**
   * Grosse Gewinnfeier ueber dem ganzen Bild. Verschwindet von selbst und
   * laesst sich wegtippen, damit sie nie im Weg steht.
   */
  /**
   * Der gekaufte Gewinn-Effekt. Vorher regnete es bei allen dieselben
   * Konfetti; jetzt entscheidet die Kosmetik, was passiert. Ein unbekannter
   * oder fehlender Wert faellt still auf Konfetti zurueck, damit ein
   * geloeschtes Stueck nie einen leeren Bildschirm hinterlaesst.
   */
  /*
   * Jeder gekaufte Effekt hat eine eigene FORM und eine eigene BEWEGUNG,
   * nicht nur andere Farben. Dasselbe Konfetti in Orange statt Gelb waere
   * kein Effekt, sondern ein Farbregler — und genau so hatte ich es zuerst
   * gebaut.
   *
   *   muenzen    Münzen springen von unten hoch und fallen zurück.
   *   gold       Dichter Vorhang dünner Streifen, streng senkrecht.
   *   feuerwerk  Drei Explosionen: Punkte fliegen radial auseinander.
   *   blitz      Bildschirm-Aufblitzen plus ein gezackter Blitz.
   *   sterne     Wenige große Sterne, langsam und schräg, mit Schweif.
   */
  function gewinnEffekt() {
    const acc = window.Casino.getAccount ? window.Casino.getAccount() : null;
    return (acc && acc.winEffect) || null;
  }

  /**
   * Wie gross ein Gewinn sich anfuehlt, als Stufe 1 bis 4.
   *
   * Der reine Betrag taugt dafuer nicht: 100.000 sind fuer die Haelfte der
   * Runde ein Lebensereignis und fuer die Spitze ein Achselzucken. Gemessen
   * wird deshalb an zwei Groessen, und die groessere gewinnt:
   *
   *   das VIELFACHE des Einsatzes, falls das Spiel es mitliefert, und
   *   der Gewinn im VERHAELTNIS zum eigenen Guthaben.
   *
   * Damit feiert dieselbe Runde bei einem Neuling lauter als bei jemandem
   * mit drei Millionen, und das ist genau richtig.
   */
  function wucht(betrag, faktor) {
    const acc = window.Casino.getAccount ? window.Casino.getAccount() : null;
    const guthaben = acc && acc.chips > 0 ? acc.chips : 0;
    const anteil = guthaben ? betrag / guthaben : 0;

    let stufe = 1;
    if (faktor >= 3 || anteil >= 0.08) stufe = 2;
    if (faktor >= 10 || anteil >= 0.25) stufe = 3;
    if (faktor >= 40 || anteil >= 0.75) stufe = 4;
    return stufe;
  }

  /**
   * Ein Teilchen auf die Effektebene legen und nach `leben` wieder abraeumen.
   *
   * Eigene CSS-Variablen (--hoch, --dx, …) MUESSEN ueber setProperty gesetzt
   * werden. Object.assign auf el.style legt bei unbekannten Namen nur eine
   * JavaScript-Eigenschaft an, die das Stylesheet nie zu sehen bekommt — die
   * Animationen liefen dadurch gegen leere Werte und bewegten sich gar nicht.
   */
  function teil(klasse, stil, leben) {
    const el = document.createElement("i");
    el.className = klasse;
    for (const [k, v] of Object.entries(stil)) {
      if (k.startsWith("--")) el.style.setProperty(k, v);
      else el.style[k] = v;
    }
    ebene().appendChild(el);
    setTimeout(() => el.remove(), leben);
  }

  const zufall = (a, b) => a + Math.random() * (b - a);

  /**
   * Ein Farbschwall ueber den ganzen Bildschirm. Ab Stufe 3 laeuft er bei
   * JEDEM Effekt mit — ein grosser Gewinn soll gross wirken, egal welchen
   * Effekt jemand gekauft hat.
   */
  function schwall(farbe, w) {
    teil("fx-schwall", { "--fx-farbe": farbe, animationDuration: (700 + w * 180) + "ms" }, 1500);
  }

  function muenzflut(w) {
    const n = 30 * w;
    for (let i = 0; i < n; i++) {
      teil("fx-muenze", {
        left: zufall(2, 98) + "vw",
        animationDelay: (i * (18 - w * 2)) + "ms",
        width: (16 + w * 4) + "px",
        height: (16 + w * 4) + "px",
        animationDuration: (1500 + w * 200) + "ms",
        // Wie hoch sie springt und wie weit sie dabei zur Seite driftet.
        "--hoch": zufall(45 + w * 8, 80 + w * 12) + "vh",
        "--seit": zufall(-90, 90) + "px",
        "--dreh": zufall(-320, 320) + "deg",
      }, 2400 + w * 200);
    }
    // Ab Stufe 3 regnet es zusaetzlich von oben: doppelte Richtung, doppelt
    // so voll.
    if (w >= 3) {
      for (let i = 0; i < 18 * w; i++) {
        teil("fx-muenze fx-muenze-fall", {
          left: zufall(0, 100) + "vw",
          animationDelay: zufall(0, 700) + "ms",
          width: (14 + w * 3) + "px",
          height: (14 + w * 3) + "px",
          "--dreh": zufall(-360, 360) + "deg",
        }, 2600);
      }
    }
    if (w >= 3) schwall("255,215,110", w);
  }

  function goldregen(w) {
    const n = 70 * w;
    for (let i = 0; i < n; i++) {
      teil("fx-strahl", {
        left: zufall(0, 100) + "vw",
        height: zufall(34 + w * 8, 80 + w * 22) + "px",
        width: (2 + (w >= 3 ? 1 : 0)) + "px",
        animationDelay: zufall(0, 420) + "ms",
        animationDuration: zufall(750, 1350) + "ms",
        opacity: String(zufall(0.55, 1)),
      }, 2400);
    }
    teil("fx-goldschein", { animationDuration: (1400 + w * 350) + "ms", opacity: String(0.5 + w * 0.16) }, 2600);
    if (w >= 3) schwall("255,190,80", w);
  }

  function feuerwerk(w) {
    const farben = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#a66bff", "#7ef9ff", "#ffffff"];
    const salven = 2 + w * 2;
    const proSalve = 22 + w * 8;
    for (let n = 0; n < salven; n++) {
      setTimeout(() => {
        const x = zufall(14, 86), y = zufall(14, 58);
        const farbe = farben[Math.floor(Math.random() * farben.length)];
        for (let i = 0; i < proSalve; i++) {
          const winkel = (Math.PI * 2 * i) / proSalve + zufall(-0.12, 0.12);
          const weite = zufall(110 + w * 20, 210 + w * 60);
          teil("fx-funke", {
            left: x + "vw", top: y + "vh", background: farbe,
            width: (5 + w) + "px", height: (5 + w) + "px",
            animationDuration: (1000 + w * 220) + "ms",
            "--dx": Math.cos(winkel) * weite + "px",
            "--dy": Math.sin(winkel) * weite + "px",
          }, 1400 + w * 250);
        }
        if (w >= 3) teil("fx-knall", { left: x + "vw", top: y + "vh", background: farbe }, 600);
      }, n * (280 - w * 25));
    }
    if (w >= 3) schwall("255,220,120", w);
  }

  function blitz(w) {
    // Mehrere Schlaege nacheinander statt eines einzigen.
    for (let n = 0; n < w; n++) {
      setTimeout(() => {
        teil("fx-blitz", { animationDuration: (440 + w * 60) + "ms" }, 620);
        const x = zufall(18, 82);
        teil("fx-zacke", {
          left: x + "vw",
          width: (26 + w * 6) + "px",
          height: (62 + w * 6) + "vh",
        }, 640);
      }, n * 220);
    }
    if (w >= 3) {
      schwall("126,249,255", w);
      // Bei einem Einschlag dieser Groesse wackelt auch der Bildschirm.
      const el = document.getElementById("app");
      if (el) { el.classList.remove("fx-beben"); void el.offsetWidth; el.classList.add("fx-beben"); setTimeout(() => el.classList.remove("fx-beben"), 700); }
    }
  }

  /**
   * Salut: zwei Partykanonen aus den unteren Ecken.
   *
   * Bewusst anders als alles andere im Laden — es ist das einzige Stueck aus
   * dem Wiedereroeffnungs-Paket und soll man auf den ersten Blick erkennen.
   */
  function salut(w) {
    const farben = ["#f7dc8c", "#ffffff", "#ff6b6b", "#4ecdc4", "#a66bff", "#ffd93d"];
    const proSeite = 26 + w * 14;
    for (const links of [true, false]) {
      for (let i = 0; i < proSeite; i++) {
        // Schraeg nach innen und oben, mit Streuung: eine Kanone schiesst
        // keinen geraden Strahl.
        const grund = links ? -60 : -120;
        const winkel = (grund + zufall(-26, 26)) * (Math.PI / 180);
        const weite = zufall(220, 460 + w * 90);
        teil("fx-band", {
          left: links ? "-10px" : "calc(100vw + 10px)",
          bottom: "-10px",
          background: farben[i % farben.length],
          width: (5 + w) + "px",
          height: (12 + w * 4) + "px",
          animationDelay: zufall(0, 90 + w * 40) + "ms",
          animationDuration: (1300 + w * 260) + "ms",
          "--dx": Math.cos(winkel) * weite * (links ? -1 : 1) + "px",
          "--dy": Math.sin(winkel) * weite + "px",
          "--rot": zufall(-900, 900) + "deg",
        }, 2600 + w * 300);
      }
    }
    if (w >= 2) schwall("247,220,140", w);
  }

  function sternenfall(w) {
    const n = 8 * w;
    for (let i = 0; i < n; i++) {
      teil("fx-stern", {
        left: zufall(-10, 90) + "vw",
        top: zufall(-15, 30) + "vh",
        animationDelay: (i * (120 - w * 12)) + "ms",
        animationDuration: (2200 - w * 150) + "ms",
        fontSize: zufall(16 + w * 3, 32 + w * 10) + "px",
      }, 3000);
    }
    if (w >= 3) schwall("255,246,216", w);
  }

  /**
   * Spielt den gekauften Effekt.
   * @param {{betrag?: number, faktor?: number, stufe?: number}} [opts]
   */
  function spieleGewinnEffekt(opts = {}) {
    if (reduziert()) return;
    const w = Math.max(1, Math.min(4, opts.stufe || wucht(opts.betrag || 0, opts.faktor || 0)));
    spieleEffekt(gewinnEffekt(), w);
  }

  /**
   * Einen BESTIMMTEN Effekt abspielen, unabhaengig davon, was jemand angelegt
   * hat. Gebraucht, wo der Effekt selbst das Thema ist: das Auspacken des
   * Wiedereroeffnungs-Pakets zeigt den Salut, den es damit gerade gibt.
   * @param {string|null} id
   * @param {number} [stufe] 1 bis 4
   */
  function spieleEffekt(id, stufe = 3) {
    if (reduziert()) return;
    const w = Math.max(1, Math.min(4, stufe));
    switch (id) {
      case "muenzen": return muenzflut(w);
      case "gold": return goldregen(w);
      case "feuerwerk": return feuerwerk(w);
      case "blitz": return blitz(w);
      case "sterne": return sternenfall(w);
      case "salut": return salut(w);
      default: {
        // Konfetti: mehr, groesser, laenger — und ab Stufe 3 eine zweite Welle.
        confetti({ count: 60 * w, wucht: w });
        if (w >= 3) setTimeout(() => confetti({ count: 40 * w, wucht: w }), 260);
        if (w >= 3) schwall("247,220,140", w);
        return;
      }
    }
  }

  /**
   * @param {number} betrag
   * @param {{label?: string, sound?: boolean, dauer?: number, faktor?: number}} [opts]
   *   `faktor` ist das Vielfache des Einsatzes, falls das Spiel es kennt.
   */
  function bigWin(betrag, { label = "Gewinn", sound = true, dauer = 2600, faktor = 0 } = {}) {
    const host = ebene();
    const karte = document.createElement("div");
    karte.className = "fx-bigwin";
    // Die Chip-Marke ist ein eigenes Element NEBEN der Zahl, nicht Teil des
    // formatierten Textes: countUp schreibt ueber textContent, dort wuerde
    // `<i class=mk></i>` als Zeichenkette im Bild stehen statt als Symbol.
    karte.innerHTML = `<small></small><b><span class="bw-zahl">0</span><i class=mk></i></b>`;
    karte.querySelector("small").textContent = label;
    host.appendChild(karte);
    requestAnimationFrame(() => karte.classList.add("show"));

    countUp(karte.querySelector(".bw-zahl"), 0, betrag, { sound: false });
    if (sound && window.Casino.sound) window.Casino.sound.play(betrag > 0 ? "bigwin" : "win");
    spieleGewinnEffekt({ betrag, faktor });

    const weg = () => {
      karte.classList.remove("show");
      setTimeout(() => karte.remove(), 400);
    };
    karte.addEventListener("click", weg);
    setTimeout(weg, dauer);
  }

  /**
   * Ladeplatzhalter statt "Lädt…". Zeigt die Form dessen, was gleich kommt,
   * damit der Bildschirm beim Nachladen nicht springt.
   */
  function skeleton(el, { rows = 3, height = 18 } = {}) {
    if (!el) return;
    el.innerHTML = Array.from({ length: rows }, (_, i) =>
      `<div class="fx-skeleton" style="height:${height}px;width:${92 - i * 12}%"></div>`
    ).join("");
  }

  window.Casino = window.Casino || {};
  window.Casino.fx = { confetti, coins, countUp, bigWin, skeleton, spieleGewinnEffekt, spieleEffekt };
})();
