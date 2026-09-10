"use strict";

/* ============================================================
   Fake Casino – Glücksrad.

   Einmal am Tag gratis. Der Server bestimmt das Feld, hier
   dreht nur das Bild dorthin.

   Vom Server kommt die STUFE eines Feldes (klein, mittel, gross,
   sonder, fortuna), das Aussehen macht das Stylesheet. Gold heisst
   Chips, blau heisst etwas anderes (Lose, XP, Glueckstag), und
   FORTUNA ist voll gold.

   Was ein Dreh gebracht hat, formuliert der SERVER (titel + text).
   Der Client zeigt es nur an — sonst muesste jede neue Feldart hier
   noch einmal beschrieben werden.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);

  let segmente = [];
  let drehung = 0;      // aufaddierte Drehung in Grad
  let laeuft = false;
  let uhr = null;

  const M = 120;        // Mittelpunkt
  const R_RAND = 116;   // Aussenkante des Rings
  const R_FELD = 102;   // Aussenkante der Felder
  const R_NABE = 26;

  const DREH_MS = 5200;
  const zahl = (n) => Number(n || 0).toLocaleString("de-DE");

  /** Punkt auf dem Rad. 0 Grad zeigt nach oben, gezaehlt wird im Uhrzeigersinn. */
  function pt(grad, r) {
    const b = (grad * Math.PI) / 180;
    return [M + r * Math.sin(b), M - r * Math.cos(b)];
  }

  function zeichneRad() {
    const svg = $("#wheel-svg");
    if (!svg || !segmente.length) return;
    const n = segmente.length, weite = 360 / n;
    let felder = "";

    for (let i = 0; i < n; i++) {
      const a0 = i * weite, a1 = (i + 1) * weite, mitte = a0 + weite / 2;
      const [x0, y0] = pt(a0, R_FELD), [x1, y1] = pt(a1, R_FELD);
      const s = segmente[i];
      felder += `<path class="gr-feld gr-${s.stufe || "klein"}" data-i="${i}" d="M${M} ${M} L${x0.toFixed(2)} ${y0.toFixed(2)} A${R_FELD} ${R_FELD} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z"/>`;

      /* Beschriftung laeuft am Radius entlang und wird auf der linken Haelfte
         umgedreht — sonst steht die Haelfte aller Zahlen auf dem Kopf, und
         genau so sah es vorher aus. */
      const links = mitte > 180;
      const [lx, ly] = pt(mitte, R_FELD * 0.62);
      const dreh = links ? mitte + 90 : mitte - 90;
      const lang = s.label.length > 5;
      felder += `<text class="gr-schrift gr-schrift-${s.stufe || "klein"}${lang ? " gr-schrift-lang" : ""}"
        x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" text-anchor="middle" dominant-baseline="central"
        transform="rotate(${dreh.toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)})">${escapeHtml(s.label)}</text>`;
    }

    // Trennstriche und die Stifte auf dem Ring, an denen der Zeiger sitzt.
    let striche = "", stifte = "";
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i * weite, R_FELD);
      striche += `<line class="gr-strich" x1="${M}" y1="${M}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"/>`;
      const [px, py] = pt(i * weite, (R_FELD + R_RAND) / 2);
      stifte += `<circle class="gr-stift" cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="3"/>`;
    }

    svg.innerHTML = `
      <g id="gr-dreh" style="transform-origin:${M}px ${M}px">
        <circle class="gr-ring" cx="${M}" cy="${M}" r="${(R_RAND + R_FELD) / 2}" fill="none" stroke-width="${R_RAND - R_FELD}"/>
        <circle class="gr-grund" cx="${M}" cy="${M}" r="${R_FELD}"/>
        ${felder}${striche}${stifte}
        <circle class="gr-feldrand" cx="${M}" cy="${M}" r="${R_FELD}" fill="none"/>
      </g>
      <circle class="gr-nabe" cx="${M}" cy="${M}" r="${R_NABE}"/>
      <circle class="gr-nabe-rand" cx="${M}" cy="${M}" r="${R_NABE}" fill="none"/>
      <circle class="gr-nabe-kern" cx="${M}" cy="${M}" r="7"/>`;
    setzeDrehung();
  }

  function setzeDrehung(dauer) {
    const g = document.getElementById("gr-dreh");
    if (!g) return;
    g.style.transition = dauer ? `transform ${dauer}ms cubic-bezier(0.12, 0.72, 0.14, 1)` : "none";
    g.style.transform = `rotate(${drehung}deg)`;
  }

  function restText(ms) {
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h} ${h === 1 ? "Stunde" : "Stunden"} ${m} Min`;
    if (m > 0) return `${m} Minuten`;
    return "gleich";
  }

  /** Knopf und Countdown. Die Restzeit lief vorher IM Knopftext mit. */
  function setzeKnopf(s) {
    const btn = $("#wheel-spin");
    const zeile = $("#gr-uhr");
    if (!btn) return;
    if (uhr) { clearInterval(uhr); uhr = null; }

    if (laeuft) {
      btn.disabled = true;
      btn.textContent = "Das Rad dreht…";
      if (zeile) zeile.textContent = "";
      return;
    }
    if (s && !s.canSpin) {
      btn.disabled = true;
      btn.textContent = "Heute schon gedreht";
      let rest = s.msLeft;
      const male = () => {
        if (!zeile) return;
        rest -= 1000;
        if (rest <= 0) { clearInterval(uhr); uhr = null; lade(); return; }
        zeile.textContent = `Nächster Gratis-Dreh in ${restText(rest)}.`;
      };
      if (zeile) zeile.textContent = `Nächster Gratis-Dreh in ${restText(s.msLeft)}.`;
      uhr = setInterval(male, 1000);
      return;
    }
    btn.disabled = false;
    btn.textContent = "Gratis drehen";
    if (zeile) zeile.textContent = "Dein Dreh ist frei.";
  }

  const ART_KOPF = {
    chips: "Gewonnen", los: "Lotterie", xp: "Season", glueckstag: "Morgen doppelt", fortuna: "Eines von sieben",
  };

  function zeigeErgebnis(r) {
    const box = $("#gr-ergebnis");
    if (!box) return;
    box.className = `gr-ergebnis${r.art === "fortuna" ? " gr-ergebnis-fortuna" : ""}`;
    box.innerHTML =
      `<small>${escapeHtml(ART_KOPF[r.art] || "Gewonnen")}</small>` +
      `<b>${escapeHtml(r.titel || "")}</b>` +
      (r.text ? `<span>${escapeHtml(r.text)}</span>` : "");
    box.hidden = false;
  }

  /** Wie viele Fortuna noch im Rad sind. Der Grund, morgen wiederzukommen. */
  function zeigeFortuna(f) {
    const zeile = $("#gr-fortuna");
    if (!zeile) return;
    if (!f) { zeile.hidden = true; return; }
    zeile.hidden = false;
    if (f.hat) {
      zeile.innerHTML = `<b>Du hast Fortuna.</b><small>Für dich zahlt das Feld jetzt Chips.</small>`;
      return;
    }
    if (!f.rest) {
      zeile.innerHTML = `<b>Alle ${f.max} Fortuna sind vergeben.</b><small>Das Feld zahlt jetzt Chips.</small>`;
      return;
    }
    zeile.innerHTML =
      `<b>Noch ${f.rest} von ${f.max} Fortuna im Rad.</b>` +
      `<small>Ring, Namensstil und Titel. Danach gibt es nie wieder welche.</small>`;
  }

  /** Der grosse Moment. Drei Stuecke auf einmal, das ist ein Fenster wert. */
  function zeigeFortunaFenster(r) {
    const m = $("#fortuna-modal");
    if (!m) return;
    const unter = $("#fo-unter");
    if (unter) unter.textContent = r.text || "";
    const liste = $("#fo-liste");
    if (liste) {
      liste.innerHTML = (r.stuecke || []).map((s) => `<div class="fo-stueck">${escapeHtml(s)}</div>`).join("");
    }
    m.classList.remove("hidden");
    window.Casino.fx?.confetti({ count: 90, wucht: 1.4 });
  }

  function lade() {
    socket.emit("wheel:state", (s) => {
      if (!s || !s.ok) return;
      segmente = s.segments || [];
      zeichneRad();
      setzeKnopf(s);
      zeigeFortuna(s.fortuna);
      // Die Bremse steht sonst nirgends: das Rad verspricht 10.000 und es
      // kommen 6.500 an, ohne dass jemand sagt warum.
      const hinweis = $("#gr-intro-bremse");
      if (hinweis) hinweis.remove();
      if (s.faucet != null && s.faucet < 100) {
        const p = document.createElement("p");
        p.id = "gr-intro-bremse";
        p.className = "muted small gr-bremse";
        p.textContent = `Bei deinem Vermögen zahlt das Rad ${s.faucet} % aus. Die Felder zeigen schon deine Werte.`;
        $(".gr-intro")?.after(p);
      }
    });
  }

  $("#wheel-spin")?.addEventListener("click", () => {
    if (laeuft) return;
    const fehler = $("#wheel-error");
    if (fehler) fehler.textContent = "";
    const box = $("#gr-ergebnis");
    if (box) box.hidden = true;
    laeuft = true;
    setzeKnopf();

    socket.emit("wheel:spin", (r) => {
      if (!r || !r.ok) {
        laeuft = false;
        if (fehler) fehler.textContent = (r && r.error) || "Fehler.";
        setzeKnopf({ canSpin: false, msLeft: (r && r.msLeft) || 0 });
        return;
      }
      const n = segmente.length, weite = 360 / n;
      // Das getroffene Feld muss unter dem Zeiger oben stehen bleiben.
      const ziel = 360 * 6 - (r.index * weite + weite / 2);
      drehung = drehung - (drehung % 360) + ziel;
      setzeDrehung(DREH_MS);
      $("#gr-zeiger")?.classList.add("gr-zeiger-tickt");

      setTimeout(() => {
        laeuft = false;
        $("#gr-zeiger")?.classList.remove("gr-zeiger-tickt");
        const feld = document.querySelector(`.gr-feld[data-i="${r.index}"]`);
        feld?.classList.add("gr-treffer");
        if (r.account) applyAccount(r.account);
        zeigeErgebnis(r);
        const buehne = document.querySelector(".gr-buehne");
        if (r.art === "fortuna") {
          zeigeFortunaFenster(r);
        } else if (r.chips >= 25000) {
          window.Casino.fx?.bigWin(r.chips, { label: "Am Glücksrad" });
        } else if (buehne) {
          window.Casino.fx?.coins(buehne, { count: r.chips >= 5000 ? 16 : 8 });
        }
        toast(r.art === "fortuna" ? "FORTUNA! Eines von sieben." : `Glücksrad: ${r.titel}`);
        window.Casino.renderAbholBadge?.();
        socket.emit("wheel:state", (s) => {
          if (!s || !s.ok) return;
          // Neu zeichnen: wer Fortuna gewonnen hat, sieht dort ab jetzt Chips.
          segmente = s.segments || [];
          zeichneRad();
          setzeKnopf(s);
          zeigeFortuna(s.fortuna);
        });
      }, DREH_MS + 250);
    });
  });

  $("#fo-close")?.addEventListener("click", () => $("#fortuna-modal")?.classList.add("hidden"));
  $("#fo-kosmetik")?.addEventListener("click", () => {
    $("#fortuna-modal")?.classList.add("hidden");
    window.Casino.screens.show("cosmetics");
  });

  /* Ein Fortuna weniger im Rad betrifft alle, nicht nur den Gewinner. */
  socket.on("wheel:fortuna", () => {
    if (window.Casino.screens.current() === "wheel") lade();
  });

  window.Casino._loadWheel = lade;
})();
