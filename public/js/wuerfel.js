"use strict";

/**
 * Wuerfelpoker — Oberflaeche.
 *
 * Ein Wurf, halten, ein Nachwurf. Die Wuerfel sind gezeichnet und nicht als
 * Emoji gesetzt: Wuerfel-Emoji sehen auf jedem Geraet anders aus und tragen
 * ihre eigene Farbe mit, was in keinem der drei Designs passt.
 *
 * Der Vorschlag, welche Wuerfel sich zu halten lohnen, kommt vom Server.
 * Er ist ein Hinweis, keine Vorgabe — er existiert, damit der Unterschied
 * zwischen gutem und naivem Spiel nicht daran haengt, ob jemand die
 * Wahrscheinlichkeiten auswendig kennt.
 */
(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const mx = (n) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const VERLAUF_KEY = "casino_wuerfel_verlauf";
  let stand = null;
  let grenzen = { minBet: 50, maxBet: 50000, maxWin: 0 };
  let tabelle = [];
  let laeuft = false;

  /* Augen als Punkte, nicht als Ziffer: ein Wuerfel liest sich schneller. */
  const PUNKTE = {
    1: [[50, 50]],
    2: [[28, 28], [72, 72]],
    3: [[28, 28], [50, 50], [72, 72]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
  };
  function wuerfelSvg(augen) {
    const p = (PUNKTE[augen] || []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8.5"/>`).join("");
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="currentColor">${p}</g></svg>`;
  }

  const ladeVerlauf = () => { try { return JSON.parse(localStorage.getItem(VERLAUF_KEY)) || []; } catch { return []; } };
  function merkeVerlauf(name, zahlt) {
    const v = ladeVerlauf(); v.unshift({ name, zahlt });
    try { localStorage.setItem(VERLAUF_KEY, JSON.stringify(v.slice(0, 10))); } catch {}
    zeichneVerlauf();
  }
  function zeichneVerlauf() {
    const box = $("#wp-history"); if (!box) return;
    box.innerHTML = ladeVerlauf().map((e) =>
      `<span class="rv-chip ${e.zahlt ? "up" : "down"}">${e.zahlt ? mx(e.zahlt) + "×" : "—"}</span>`).join("");
  }

  function zeichneTabelle() {
    const box = $("#wp-tabelle"); if (!box || !tabelle.length) return;
    const jetzt = stand && !stand.none ? stand.kategorie : null;
    box.innerHTML = `<h3 class="wp-tab-titel">Was zahlt</h3>` +
      tabelle.map((t) => `
        <div class="wp-tab-zeile${t.id === jetzt ? " aktiv" : ""}">
          <b>${t.label}</b><em>${t.chance}</em><span>${mx(t.zahlt)}×</span>
        </div>`).join("") +
      `<p class="wp-tab-fuss muted small">Alles darunter ist verloren. Die Chancen gelten,
       wenn du gezielt darauf spielst. Höchstgewinn ${fmt(grenzen.maxWin)} Chips pro Runde.</p>`;
  }

  function zeichne(v) {
    stand = v;
    laeuft = !!v && !v.none && !v.over;

    $("#wp-setup").classList.toggle("hidden", laeuft);
    $("#wp-aktionen").classList.toggle("hidden", !laeuft);

    const box = $("#wp-wuerfel");
    if (!v || v.none) {
      box.innerHTML = "";
      $("#wp-status").textContent = "Setz einen Einsatz und wirf.";
      $("#wp-hinweis").textContent = "";
      zeichneTabelle();
      return;
    }

    box.innerHTML = "";
    (v.wuerfel || []).forEach((augen, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "wp-wuerfel-btn";
      b.dataset.index = String(i);
      if (v.halten && v.halten[i]) b.classList.add("gehalten");
      // Vorschlag nur zeigen, solange man noch entscheiden kann.
      if (!v.over && v.vorschlag && v.vorschlag[i] && !(v.halten && v.halten[i])) b.classList.add("empfohlen");
      b.disabled = !!v.over;
      b.innerHTML = wuerfelSvg(augen) +
        `<span class="wp-marke">${v.halten && v.halten[i] ? "gehalten" : (!v.over && v.vorschlag && v.vorschlag[i] ? "halten?" : "")}</span>`;
      box.appendChild(b);
    });

    const zahlt = v.zahlt || 0;
    $("#wp-status").innerHTML = v.over
      ? `<b>${v.ergebnisName || v.kategorieName}</b>` + (v.payout ? ` · <span class="wp-gewinn">+${fmt(v.payout)} Chips</span>` : " · nichts diesmal")
      : `<b>${v.kategorieName}</b>` + (zahlt ? ` · zahlt gerade ${mx(zahlt)}× = ${fmt(v.moeglich)}` : " · zahlt noch nichts");

    $("#wp-hinweis").textContent = v.over
      ? ""
      : (v.nachwuerfe > 0
        ? "Tippe die Würfel an, die bleiben sollen. Dann nachwerfen."
        : "Kein Nachwurf mehr.");

    $("#wp-nachwurf").disabled = !v.nachwuerfe;
    zeichneTabelle();
  }

  function starten() {
    const err = $("#wp-error"); err.textContent = "";
    const bet = parseInt($("#wp-amount").value, 10);
    if (!Number.isFinite(bet) || bet < grenzen.minBet) { err.textContent = `Mindestens ${fmt(grenzen.minBet)} Chips.`; return; }
    if (bet > grenzen.maxBet) { err.textContent = `Maximaleinsatz ${fmt(grenzen.maxBet)} Chips.`; return; }
    socket.emit("wuerfel:start", { bet }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Ging nicht."; return; }
      if (r.account) applyAccount(r.account);
      Casino.sound?.play("select");
      zeichne(r);
    });
  }

  function beenden(r) {
    if (r.account) applyAccount(r.account);
    zeichne(r);
    merkeVerlauf(r.ergebnisName, r.payout ? (r.payout / r.bet) : 0);
    if (r.payout > 0) {
      Casino.sound?.play("win");
      Casino.fx.bigWin(r.payout, { label: r.ergebnisName, faktor: r.payout / r.bet });
    } else {
      Casino.sound?.play("lose");
      toast(`${r.ergebnisName} — das zahlt leider nichts.`);
    }
  }

  function wire() {
    $("#wp-start")?.addEventListener("click", starten);

    $("#wp-wuerfel")?.addEventListener("click", (e) => {
      const b = e.target.closest(".wp-wuerfel-btn");
      if (!b || !laeuft || b.disabled) return;
      socket.emit("wuerfel:halten", { index: Number(b.dataset.index) }, (r) => {
        if (r && r.ok) zeichne(r);
      });
    });

    $("#wp-nachwurf")?.addEventListener("click", () => {
      if (!laeuft) return;
      $("#wp-nachwurf").disabled = true;
      socket.emit("wuerfel:nachwurf", (r) => {
        if (!r || !r.ok) { $("#wp-error").textContent = (r && r.error) || "Ging nicht."; zeichne(stand); return; }
        beenden(r);
      });
    });

    $("#wp-stehen")?.addEventListener("click", () => {
      if (!laeuft) return;
      socket.emit("wuerfel:stehen", (r) => {
        if (!r || !r.ok) { $("#wp-error").textContent = (r && r.error) || "Ging nicht."; return; }
        beenden(r);
      });
    });
  }
  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire, { once: true });

  window.Casino._loadWuerfel = () => {
    zeichneVerlauf();
    socket.emit("wuerfel:config", (c) => {
      if (c && c.ok) {
        grenzen = { minBet: c.minBet, maxBet: c.maxBet, maxWin: c.maxWin };
        tabelle = c.tabelle || [];
        const feld = $("#wp-amount");
        if (feld) { feld.min = c.minBet; feld.max = c.maxBet; }
        Casino.einsatz?.leiste(feld, { min: c.minBet, max: c.maxBet, schritt: 50 });
      }
      socket.emit("wuerfel:state", (r) => zeichne(r && r.ok ? r : { none: true }));
    });
  };
})();
