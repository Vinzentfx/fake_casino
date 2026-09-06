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
  function confetti({ count = 60, origin = null, colors = null } = {}) {
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
      p.style.animationDuration = 1.1 + Math.random() * 0.9 + "s";
      host.appendChild(p);
      setTimeout(() => p.remove(), 2600);
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
      c.textContent = "🪙";
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

  /** Ein Teilchen auf die Effektebene legen und nach `leben` wieder abraeumen. */
  function teil(klasse, stil, leben) {
    const el = document.createElement("i");
    el.className = klasse;
    Object.assign(el.style, stil);
    ebene().appendChild(el);
    setTimeout(() => el.remove(), leben);
  }

  const zufall = (a, b) => a + Math.random() * (b - a);

  function muenzflut(anzahl = 26) {
    for (let i = 0; i < anzahl; i++) {
      teil("fx-muenze", {
        left: zufall(4, 96) + "vw",
        animationDelay: (i * 22) + "ms",
        // Wie hoch sie springt und wie weit sie dabei zur Seite driftet.
        "--hoch": zufall(38, 78) + "vh",
        "--seit": zufall(-70, 70) + "px",
        "--dreh": zufall(-220, 220) + "deg",
      }, 1900);
    }
  }

  function goldregen(anzahl = 70) {
    for (let i = 0; i < anzahl; i++) {
      teil("fx-strahl", {
        left: zufall(0, 100) + "vw",
        height: zufall(28, 70) + "px",
        animationDelay: zufall(0, 500) + "ms",
        animationDuration: zufall(900, 1500) + "ms",
        opacity: String(zufall(0.45, 1)),
      }, 2200);
    }
    teil("fx-goldschein", {}, 1600);
  }

  function feuerwerk(salven = 3) {
    const farben = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#a66bff", "#7ef9ff"];
    for (let n = 0; n < salven; n++) {
      setTimeout(() => {
        const x = zufall(18, 82), y = zufall(18, 55);
        const farbe = farben[Math.floor(Math.random() * farben.length)];
        for (let i = 0; i < 22; i++) {
          const winkel = (Math.PI * 2 * i) / 22 + zufall(-0.1, 0.1);
          const weite = zufall(90, 190);
          teil("fx-funke", {
            left: x + "vw", top: y + "vh", background: farbe,
            "--dx": Math.cos(winkel) * weite + "px",
            "--dy": Math.sin(winkel) * weite + "px",
          }, 1200);
        }
      }, n * 320);
    }
  }

  function blitz() {
    teil("fx-blitz", {}, 460);
    // Der Zacken selbst, an zufaelliger Stelle, damit es nicht jedes Mal
    // dieselbe Bahn ist.
    const x = zufall(25, 75);
    teil("fx-zacke", { left: x + "vw" }, 500);
  }

  function sternenfall(anzahl = 9) {
    for (let i = 0; i < anzahl; i++) {
      teil("fx-stern", {
        left: zufall(-5, 85) + "vw",
        top: zufall(-10, 30) + "vh",
        animationDelay: (i * 130) + "ms",
        fontSize: zufall(14, 30) + "px",
      }, 2600);
    }
  }

  function spieleGewinnEffekt() {
    if (reduziert()) return;
    switch (gewinnEffekt()) {
      case "muenzen": return muenzflut();
      case "gold": return goldregen();
      case "feuerwerk": return feuerwerk();
      case "blitz": return blitz();
      case "sterne": return sternenfall();
      default: return confetti({ count: 70 });
    }
  }

  function bigWin(betrag, { label = "Gewinn", sound = true, dauer = 2600 } = {}) {
    const host = ebene();
    const karte = document.createElement("div");
    karte.className = "fx-bigwin";
    karte.innerHTML = `<small></small><b>0</b>`;
    karte.querySelector("small").textContent = label;
    host.appendChild(karte);
    requestAnimationFrame(() => karte.classList.add("show"));

    countUp(karte.querySelector("b"), 0, betrag, { format: (n) => fmt(n) + " 🪙", sound: false });
    if (sound && window.Casino.sound) window.Casino.sound.play(betrag > 0 ? "bigwin" : "win");
    spieleGewinnEffekt();

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
  window.Casino.fx = { confetti, coins, countUp, bigWin, skeleton, spieleGewinnEffekt };
})();
