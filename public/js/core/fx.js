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
    confetti({ count: 70 });

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
  window.Casino.fx = { confetti, coins, countUp, bigWin, skeleton };
})();
