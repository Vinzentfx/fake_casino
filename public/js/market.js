"use strict";

/* Kosmetik-Markt: geprägte Stücke zwischen Spielern.
   Festpreis, hinterlegt, Gebühr beim Verkauf. Entschieden wird auf dem
   Server (game/market.js), hier wird nur angezeigt und getippt. */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const serieCode = (x) => window.Casino.spieler.serienCode(x);

  let stand = null;
  /* Welches Stück gerade frisch gekauft ist, und bis wann es leuchtet.
     Muss hier stehen und nicht als Klasse am Element: `market:update` geht an
     alle, also auch an den Käufer selbst, und der baut daraufhin die Liste
     neu auf. Eine Klasse, die direkt am Element hängt, ist danach weg. */
  let frisch = { uid: null, bis: 0 };

  const onScreen = () => {
    const s = document.querySelector('[data-screen="market"]');
    return s && s.classList.contains("active");
  };

  function load() {
    socket.emit("market:state", (res) => {
      if (!res || !res.ok) return;
      stand = res;
      render();
    });
  }

  /** Datum kurz. Bei einem Stück von vor Monaten zählt der Tag, nicht die Uhrzeit. */
  const tag = (ts) => new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

  /*
   * Die Herkunft eines Stücks.
   *
   * Das ist der ganze Grund für den Markt: ein Hologramm #0427, das seit der
   * Prägung beim Ersten liegt, ist eine andere Sache als eins, das schon
   * durch drei Hände ging. Steht deshalb am Angebot und nicht hinter einem
   * zweiten Tipp, denn auf dem iPad gibt es kein Hover.
   */
  function herkunft(o) {
    const zeilen = [`Geprägt am ${tag(o.gepraegtAm)} für <b>${escapeHtml(o.gepraegtFuer)}</b>.`];
    if (o.verlauf.length) {
      const letzte = o.verlauf.slice(-3);
      zeilen.push("Verkauft: " + letzte.map((v) => `${fmt(v.preis)} an ${escapeHtml(v.name)}`).join(", ")
        + (o.verlauf.length > 3 ? ` (und ${o.verlauf.length - 3} weitere Male)` : ""));
    } else {
      zeilen.push("Hat noch nie den Besitzer gewechselt.");
    }
    return `<div class="mkt-herkunft">${zeilen.join("<br>")}</div>`;
  }

  const acc = () => window.Casino.getAccount() || {};

  /*
   * Die Kachel eines Stücks: links es selbst, rechts, was es ist.
   *
   * Die Vorschau kommt aus Casino.spieler.kosVorschau, also aus derselben
   * Quelle wie die im Laden. Ohne sie wäre das hier eine Liste von Namen, und
   * niemand kauft ein Aussehen, das er nicht gesehen hat.
   */
  function stueckKachel(o, extra = "") {
    const bewegt = o.look && o.look.motion
      ? `<span class="mkt-motion" aria-hidden="true">${window.Casino.icons.ui("stern-voll")}</span>` : "";
    return `<div class="mkt-stueck">
      <div class="mkt-demo mkt-demo-${escapeHtml((o.look && o.look.art) || "x")}">
        ${window.Casino.spieler.kosVorschau(o.look, { name: acc().name || "Du" })}${bewegt}
      </div>
      <div class="mkt-stueck-text">
        <div class="mkt-stueck-kopf"><b>${escapeHtml(o.label)}</b>
          ${window.Casino.spieler.serienBadge(o)}</div>
        <div class="mkt-art">${escapeHtml((o.look && o.look.artName) || "")}</div>
        ${extra}
      </div>
    </div>`;
  }

  function renderOffers() {
    const el = $("#mkt-offers");
    if (!el || !stand) return;
    if (!stand.angebote.length) {
      el.innerHTML = `<div class="mkt-leer">${window.Casino.icons.ui("warenkorb")}
        <b>Nichts im Schaufenster</b>
        <span>Wer etwas Seltenes hat, kann es unten anbieten.</span></div>`;
      return;
    }
    el.innerHTML = stand.angebote.map((o) => {
      const gebuehr = Math.round(o.preis * stand.gebuehr);
      return `<div class="mkt-karte${o.meins ? " meins" : ""}" data-karte-id="${o.id}">
        ${stueckKachel(o, `<div class="mkt-von">von <b>${escapeHtml(o.verkaeuferName)}</b>${o.meins ? " (du)" : ""}</div>`)}
        ${herkunft(o)}
        <div class="mkt-fuss">
          ${o.meins
            ? `<span class="mkt-preis">${fmt(o.preis)}<i class=mk></i>
                 <small>davon ${fmt(gebuehr)} Gebühr</small></span>
               <button class="btn-secondary" data-zurueck="${o.id}">Zurücknehmen</button>`
            : `<span class="mkt-preis">${fmt(o.preis)}<i class=mk></i></span>
               <button class="btn-primary" data-kauf="${o.id}">Kaufen</button>`}
        </div>
      </div>`;
    }).join("");
  }

  function renderInventory() {
    const el = $("#mkt-inventory");
    if (!el || !stand) return;
    if (!stand.meine.length) {
      el.innerHTML = `<div class="mkt-leer">${window.Casino.icons.ui("sperre")}
        <b>Du hast nichts Handelbares</b>
        <span>Gehandelt wird nur, was es nicht im Laden gibt: Auktionsware, Fortuna, die Wiedereröffnung und die Season.</span></div>`;
      return;
    }
    const voll = stand.offen >= stand.maxJeSpieler;
    const leuchtet = (uid) => (frisch.uid === uid && frisch.bis > Date.now() ? " frisch" : "");
    el.innerHTML = stand.meine.map((s) => `
      <div class="mkt-karte${leuchtet(s.uid)}" data-uid="${escapeHtml(s.uid)}">
        ${stueckKachel(s)}
        <div class="mkt-fuss">
          <span class="mkt-belegt">${stand.offen} / ${stand.maxJeSpieler} Angebote</span>
          <button class="btn-primary" data-anbieten="${s.uid}" ${voll ? "disabled" : ""}>Anbieten</button>
        </div>
      </div>`).join("")
      + `<p class="muted small" style="margin:10px 0 0">`
      + `Beim Verkauf gehen ${Math.round(stand.gebuehr * 100)} % Gebühr ans Haus. `
      + `Solange etwas im Schaufenster steht, kannst du es nicht tragen; Zurücknehmen geht jederzeit und kostet nichts.</p>`;
  }

  function render() {
    renderOffers();
    renderInventory();
  }

  $("#mkt-offers")?.addEventListener("click", (e) => {
    const kauf = e.target.closest("[data-kauf]");
    const zurueck = e.target.closest("[data-zurueck]");
    if (kauf) {
      const o = stand.angebote.find((x) => x.id === kauf.dataset.kauf);
      if (!o) return;
      window.Casino.dialog.frage(
        `${o.label} #${serieCode(o)} für ${fmt(o.preis)} Chips von ${o.verkaeuferName}.`,
        { titel: "Kaufen?", okText: "Kaufen" },
      ).then((ja) => {
        if (!ja) return;
        socket.emit("market:buy", { id: o.id }, (res) => {
          if (!res || !res.ok) return toast((res && res.error) || "Ging nicht.");
          applyAccount(res.account);
          stand = res;
          render();
          window.Casino.sound?.play("win");
          /* Die Kachel wandert von oben nach unten, und ohne Zeichen dafür
             sieht ein Kauf aus wie ein Ladefehler: das Angebot ist einfach
             weg. Das Stück leuchtet deshalb kurz in der eigenen Liste auf. */
          frisch = { uid: res.gekauft.uid, bis: Date.now() + 2400 };
          render();
          const neuKachel = document.querySelector(`#mkt-inventory .mkt-karte[data-uid="${res.gekauft.uid}"]`);
          if (neuKachel) neuKachel.scrollIntoView({ block: "center", behavior: "smooth" });
          setTimeout(() => { frisch = { uid: null, bis: 0 }; if (onScreen()) render(); }, 2400);
          toast(`${res.gekauft.label} #${serieCode(res.gekauft)} gehört jetzt dir.`);
        });
      });
      return;
    }
    if (zurueck) {
      socket.emit("market:zurueck", { id: zurueck.dataset.zurueck }, (res) => {
        if (!res || !res.ok) return toast((res && res.error) || "Ging nicht.");
        applyAccount(res.account);
        stand = res;
        render();
        toast("Wieder bei dir.");
      });
    }
  });

  $("#mkt-inventory")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-anbieten]");
    if (!btn) return;
    const s = stand.meine.find((x) => x.uid === btn.dataset.anbieten);
    if (!s) return;
    /* Der gemeinsame Weg: erst die Wahl zwischen Festpreis und
       Versteigerung, dann der Preis. Beides stand vorher an zwei
       getrennten Orten, und die Entscheidung dazwischen nirgends. */
    window.Casino.verkaufen(s, () => load());
  });

  socket.on("market:update", () => { if (onScreen()) load(); });
  // Verkauft, während man woanders war. Kommt immer, nicht nur auf dem Screen.
  socket.on("market:verkauft", (v) => {
    if (!v) return;
    toast(`${v.label} #${serieCode(v)} ist verkauft: ${fmt(v.erloes)} Chips von ${v.an}.`);
    if (onScreen()) load();
  });

  window.Casino.screens.register("market", { onEnter: load });
})();
