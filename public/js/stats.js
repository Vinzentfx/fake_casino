"use strict";

/* Statistik
   Zeigt standardmäßig die eigene. Aus der Bestenliste kommt man für jeden
   Spieler hierher (window.Casino.openStats(name)). Abschnitte: Rekorde,
   Stadt-Imperium, Achievements, Bilanz je Spiel. */

(function () {
  const { escapeHtml, showScreen } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  /*
   * Die Kennungen sind dieselben, die `core/icons.js` fuer die Spielkacheln
   * fuehrt, deshalb steht hier nur noch der Name und, wo die Kennung des
   * Spielstands von der des Symbols abweicht, die Uebersetzung. Vorher lag
   * hier eine zweite Emoji-Tabelle fuer genau die Spiele, die in der Lobby
   * laengst gezeichnete Symbole hatten: dasselbe Spiel, zwei Bildsprachen,
   * einen Bildschirm auseinander.
   */
  const GAME_META = {
    slots: { n: "Slots" }, blackjack: { n: "Blackjack" },
    /* Der Schluessel ist der Name, mit dem `recordHand` bucht, und der
       steht so im Spielstand — umbenennen wuerde die bisherige
       Statistik abschneiden. Ohne diesen Eintrag stand beim
       Kisten-Duell ein Pokertisch als Symbol. */
    "Kisten-Duell": { n: "Kisten-Duell", i: "geschenk" },
    roulette: { n: "Roulette" }, sportwetten: { n: "Sportwetten", i: "sports" },
    poker: { n: "Poker" }, crash: { n: "Crash" }, mines: { n: "Mines" },
    pinco: { n: "Pinco Ball" }, solitaire: { n: "Solitär" },
    memory: { n: "Memory" }, sudoku: { n: "Sudoku" }, chess: { n: "Schach" },
    towers: { n: "Towers" }, horses: { n: "Rennbahn" },
    hilo: { n: "Higher/Lower" }, wuerfel: { n: "Würfelpoker" }, kniffel: { n: "Kniffel" },
  };
  const spielSymbol = (k) => {
    const m = GAME_META[k] || {};
    return window.Casino.icons.icon(m.i || k) || window.Casino.icons.ui("poker-tisch");
  };

  // Ist das gesetzt, zeigt das nächste Laden diesen Spieler statt dich.
  let pendingName = null;

  function load() {
    const me = window.Casino.getAccount();
    const name = pendingName || (me && me.name);
    pendingName = null;
    if (!name) return;
    fetch("/api/account/" + encodeURIComponent(name))
      .then((r) => r.json())
      .then((d) => render(name, d))
      .catch(() => render(name, null));
  }

  /**
   * Die Stadtrechnung: Miete je Stunde, Abzuege, was bleibt.
   *
   * Dieselbe Aufstellung wie in der Stadt, und dieselben Zahlen, mit denen
   * der Stunden-Bonus rechnet — sie kommen aus `city.mieteVon` und stehen
   * deshalb nirgends zweimal. Sie gehört hierher, weil die Statistik die
   * Seite ist, auf der man nachsieht, wie jemand dasteht; die Stadt zeigt
   * sie nur dem, der gerade dort ist.
   *
   * Auch bei fremden Spielern, und das ist Absicht: wem was gehört, steht
   * in der Stadt ohnehin offen, und in einer Wirtschaft, in der man sich
   * gegenseitig Häuser abnimmt, ist genau das die interessante Zahl.
   */
  function stadtRechnung(city, isMe, wer) {
    const r = city && city.rechnung;
    if (!r || !r.haeuser) return "";
    const zeile = (label, wert, klasse) =>
      `<tr><td>${label}</td><td class="${klasse || ""}">${wert}</td></tr>`;
    let rows = zeile("Gebäude", fmt(r.haeuser));
    rows += zeile("Wert", `${fmt(r.wert)}<i class=mk></i>`);
    rows += zeile("Miete je Stunde", `${fmt(r.miete)}<i class=mk></i>`, "pos");
    if (r.betriebe) {
      rows += zeile(`davon ${fmt(r.betriebe)} ${r.betriebe === 1 ? "Betrieb" : "Betriebe"}`,
        `auf ${Math.round(r.personalFaktor * 100)} %`, r.personalFaktor < 1 ? "neg" : "pos");
    }
    rows += zeile(r.verwaltung
      ? `Verwaltung (${fmt(r.haeuser - r.verwFrei)} × ${fmt(r.verwJe)})`
      : `Verwaltung (erste ${r.verwFrei} frei)`,
      r.verwaltung ? `−${fmt(r.verwaltung)}<i class=mk></i>` : "0", r.verwaltung ? "neg" : "");
    rows += zeile(r.steuer > 0
      ? `Grundsteuer (${Math.round(r.satz * 100)} %)`
      : `Grundsteuer (bis ${fmt(r.steuerFrei)} frei)`,
      r.steuer > 0 ? `−${fmt(r.steuer)}<i class=mk></i>` : "0", r.steuer > 0 ? "neg" : "");
    rows += `<tr class="sum"><td><b>${isMe ? "Dir bleiben je Stunde" : `${escapeHtml(wer)} bleiben je Stunde`}</b></td>`
      + `<td><b>${fmt(r.netto)}<i class=mk></i></b></td></tr>`;
    return `<div class="st-rechnung">
      <h4 class="st-rechnung-h">${window.Casino.icons.ui("businesses")}Stadtrechnung</h4>
      <table class="stadt-rechnung">${rows}</table>
    </div>`;
  }

  function render(name, d) {
    const me = window.Casino.getAccount();
    const isMe = me && me.name.toLowerCase() === name.toLowerCase();
    const acc = (d && d.account) || {};
    const badge = d && d.ach && d.ach.badge ? ` ${d.ach.badge}` : "";
    // Der Name steht jetzt in der Visitenkarte darunter, also nicht zweimal.
    $("#stats-title").textContent = isMe ? "Deine Statistik" : "Statistik";

    // Social profile header + Rivalen/Kopfgeld panel.
    const rivalBox = $("#stats-rival");
    if (rivalBox) {
      const lvl = acc.level || {};
      const city = d && d.city;
      const ach = d && d.ach;
      const bounty = (d && d.bounty) || 0;
      const achCount = ach ? `${(ach.unlocked || []).length}/${ach.total || 0}` : "0/0";
      const cityLine = city && city.houses
        ? `${city.houses} ${city.houses === 1 ? "Haus" : "Häuser"} · ${fmt(city.streets || 0)} Straßen · ${window.Casino.betrag(city.value || 0)}`
        : "Noch kein Stadt-Imperium";
      /*
       * Dieselbe Visitenkarte wie im eigenen Profil und im Profil-Fenster.
       *
       * Hier stand vorher ein eigener Kasten mit fest eingebauten Farben, dem
       * nackten Avatar-Emoji und der flachen Namensfarbe. Banner, Namensstil,
       * Rahmen und Titel fehlten also genau dort, wo man am ehesten landet:
       * ueber einen Namen in der Bestenliste. Wer Kosmetik kauft, will sie
       * gesehen haben, dann muss sie ueberall auftauchen, wo ein Spieler
       * dargestellt wird.
       */
      const sp = window.Casino.spieler;
      const social = `
        <div class="pf-card pp-card"${acc.banner ? ` data-banner="${escapeHtml(acc.banner)}"` : ""}>
          <div class="pf-avatar">${sp.avatar(acc)}</div>
          <div class="pf-ident">
            <h2>${sp.name(acc)}</h2>
            ${acc.title ? `<div class="pl-title">${escapeHtml(acc.title)}</div>` : ""}
            <div class="pf-tags">
              ${badge ? `<span class="pf-tag">${badge.trim()}</span>` : ""}
              <span class="pf-tag">${window.Casino.icons.rangZeichen(lvl)}Level ${lvl.level || 1} · ${escapeHtml(lvl.title || "Neuling")}</span>
              <span class="pf-tag">${window.Casino.icons.ui("bestenliste")}${achCount}</span>
              ${bounty ? `<span class="pf-tag pf-tag-bounty">${window.Casino.icons.ui("quests")}${window.Casino.betrag(bounty)} Kopfgeld</span>` : ""}
            </div>
          </div>
        </div>
        ${city && city.houses
          ? `<div class="biz-buffs" style="margin-bottom:.75rem"><span class="buff-chip">${cityLine}</span></div>`
          : ""}
        ${stadtRechnung(city, isMe, acc.name || name)}`;
      /* Chips und Netto-Vermoegen standen hier als Pillen und gleich darunter
         noch einmal als Kachel, dieselbe Zahl zweimal, zwei Zentimeter
         auseinander. Die Kacheln sagen es besser, also bleibt hier nur, was
         sie nicht zeigen: das Stadt-Imperium, und auch das nur, wenn es
         eines gibt. */
      if (isMe) {
        rivalBox.innerHTML = social + (bounty
          ? `<div class="cd-buff on">${window.Casino.icons.ui("quests")}Auf deinen Kopf sind <b>${window.Casino.betrag(bounty)}</b> Kopfgeld ausgesetzt!</div>` : "");
      } else {
        rivalBox.innerHTML = social +
          (bounty ? `<div class="cd-buff">${window.Casino.icons.ui("quests")}Aktuelles Kopfgeld: <b>${window.Casino.betrag(bounty)}</b></div>` : "") +
          `<button class="btn-primary cd-btn" id="bounty-btn" data-target="${escapeHtml(acc.name || name)}">${window.Casino.icons.ui("quests")} Kopfgeld aussetzen</button>` +
          `<p class="muted small" style="margin:4px 0 0">Wer ${escapeHtml(acc.name || name)} ein Gebäude abnimmt, kassiert das Kopfgeld.</p>`;
      }
    }

    /*
     * Kennzahlen.
     *
     * Vorher standen hier sieben Zeilen "Label: Wert" untereinander, alle
     * gleich gewichtet, und "Größter Einzelgewinn +0" auch bei jemandem, der
     * noch keine Runde gespielt hat. Eine Null, die nie etwas anderes war,
     * ist keine Information; sie sieht nur aus wie eine.
     *
     * Jetzt: die Zahlen, die etwas sagen, als Kacheln. Was noch leer ist,
     * bleibt weg, und statt der leeren Kacheln steht ein Satz, der sagt,
     * was zu tun ist.
     */
    const s = acc.stats || {};
    const played = s.gamesPlayed || 0, won = s.handsWon || 0;
    const rate = played ? Math.round((100 * won) / played) : 0;
    const ov = $("#stats-overview");
    const seit = acc.createdAt ? new Date(acc.createdAt) : null;
    const tage = seit ? Math.max(1, Math.round((Date.now() - seit.getTime()) / 86400000)) : 0;

    const kachel = (label, wert, extra, klasse) =>
      `<div class="sk-kachel${klasse ? " " + klasse : ""}">` +
      `<span class="sk-label">${label}</span>` +
      `<b class="sk-wert">${wert}</b>` +
      (extra ? `<small class="sk-extra">${extra}</small>` : "") +
      `</div>`;

    if (ov) {
      if (!played) {
        ov.innerHTML =
          `<div class="sk-raster">` +
          kachel("Chips", window.Casino.betrag(acc.chips || 0)) +
          kachel("Netto-Vermögen", window.Casino.betrag(acc.netWorth || acc.chips || 0),
            "Chips plus Immobilien und Aktien") +
          `</div>` +
          `<p class="sk-leer">${isMe
            ? "Noch keine Runde gespielt. Sobald du anfängst, steht hier, wie du dich schlägst, je Spiel und über alles."
            : "Hat noch keine Runde gespielt."}</p>`;
      } else {
        const netto = (s.biggestWin || 0) - (s.biggestLoss || 0);
        ov.innerHTML = `<div class="sk-raster">` +
          kachel("Chips", window.Casino.betrag(acc.chips || 0)) +
          kachel("Netto-Vermögen", window.Casino.betrag(acc.netWorth || acc.chips || 0),
            "mit Immobilien und Aktien") +
          kachel("Runden gespielt", fmt(played),
            tage ? `${(played / tage).toFixed(played / tage < 10 ? 1 : 0)} am Tag` : "") +
          kachel("Gewonnen", `${rate}<span class="sk-einheit">%</span>`,
            `${fmt(won)} von ${fmt(played)}`,
            rate >= 50 ? "sk-gut" : "") +
          kachel("Bester Treffer", window.Casino.betragDelta(s.biggestWin || 0), "größter Einzelgewinn") +
          kachel("Härtester Schlag", window.Casino.betragDelta(-(s.biggestLoss || 0)), "größter Einzelverlust") +
          `</div>` +
          (seit ? `<p class="sk-fuss">Dabei seit ${seit.toLocaleDateString("de-DE")}` +
            (tage > 1 ? ` · ${fmt(tage)} Tage` : "") + `</p>` : "");
      }
    }

    /* Imperium
       Der Abschnitt stand bisher auch dann da, wenn nichts drin war, mit
       "Noch kein Immobilien-Besitz." als einzigem Inhalt. Eine Ueberschrift
       ueber einer Absage ist verschenkte Hoehe; jetzt bleibt der ganze
       Abschnitt weg, solange es nichts zu zeigen gibt. */
    const cityBox = $("#stats-city");
    const cityWrap = $("#stats-city-wrap");
    if (cityBox) {
      const c = d && d.city;
      if (!c || !c.houses) {
        cityWrap && cityWrap.classList.add("hidden");
        cityBox.innerHTML = "";
      } else {
        cityWrap && cityWrap.classList.remove("hidden");
        const chips = [];
        chips.push(`<span class="buff-chip" style="border-color:${c.color};color:${c.color}">${window.Casino.icons.ui("businesses")}${c.houses} ${c.houses === 1 ? "Haus" : "Häuser"}</span>`);
        chips.push(`<span class="buff-chip">${window.Casino.betrag(c.value)} Wert</span>`);
        if (c.streets) chips.push(`<span class="buff-chip">${window.Casino.icons.ui("krone")}${c.streets} ${c.streets === 1 ? "Straße" : "Straßen"} komplett</span>`);
        for (const t of c.trophies || []) chips.push(`<span class="buff-chip">${t.emoji} ${escapeHtml(t.title)}</span>`);
        for (const b of c.bossOf || []) chips.push(`<span class="buff-chip">${window.Casino.icons.ui("krone")}Boss von ${escapeHtml(b)}</span>`);
        cityBox.innerHTML = `<div class="biz-buffs">${chips.join("")}</div>`;
      }
    }

    /* Achievements
       Mit Fortschrittsbalken: "3 von 29" sagt allein wenig, der Balken
       daneben zeigt sofort, wie weit noch zu gehen ist. Die Emoji bleiben.
       Sie sind hier nicht Beiwerk, sondern das Sammelstueck selbst, das man
       sich in der Bestenliste an den Namen heftet. */
    const achBox = $("#stats-ach");
    if (achBox) {
      const a = d && d.ach;
      const offen = a ? (a.total || 0) - (a.unlocked || []).length : 0;
      if (!a || !a.unlocked || !a.unlocked.length) {
        achBox.innerHTML = `<div class="sk-ach-kopf"><b>0 von ${a ? a.total || 0 : 0}</b>` +
          `<div class="sk-balken"><i style="width:0%"></i></div></div>` +
          `<p class="muted small">${isMe
            ? "Noch keins freigeschaltet. Sie kommen beim Spielen von selbst, der erste Gewinn reicht schon."
            : "Noch keine Achievements."}</p>`;
      } else {
        const pct = a.total ? Math.round((100 * a.unlocked.length) / a.total) : 0;
        achBox.innerHTML =
          `<div class="sk-ach-kopf"><b>${a.unlocked.length} von ${a.total}</b>` +
          `<div class="sk-balken"><i style="width:${pct}%"></i></div>` +
          `<span class="muted small">${offen > 0 ? `noch ${offen}` : "alle"}</span></div>` +
          (isMe ? `<p class="hint">Welches du in der Bestenliste trägst, wählst du im Profil.</p>` : "") +
          `<div class="biz-buffs">` +
          a.unlocked.map((u) => `<span class="buff-chip">${u.emoji} ${escapeHtml(u.label)}</span>`).join("") +
          `</div>`;
      }
    }

    /* Bilanz je Spiel
       Vorher eine Zeile je Spiel: Emoji, Name, Anzahl, Prozent, Betrag,
       alles gleich gross, alles gleich wichtig. Man sah nicht, wo das Geld
       hinging. Jetzt traegt jede Zeile einen Balken, dessen Laenge sich am
       groessten Betrag der Liste misst: das Spiel, das am meisten kostet,
       faellt sofort auf, und die Farbe sagt, in welche Richtung. */
    const bg = $("#stats-by-game");
    if (!bg) return;
    const pg = s.perGame || {};
    const keys = Object.keys(pg).sort((a, b) => Math.abs(pg[b].net) - Math.abs(pg[a].net));
    if (!keys.length) {
      bg.innerHTML = `<p class="muted small">${isMe
        ? "Noch nichts gespielt. Jede Runde landet hier, mit Einsatz, Trefferquote und dem, was unterm Strich blieb."
        : "Noch keine Spiele gespielt."}</p>`;
      return;
    }
    const groesste = Math.max(1, ...keys.map((k) => Math.abs(pg[k].net || 0)));
    const gesamt = keys.reduce((sum, k) => sum + (pg[k].net || 0), 0);

    bg.innerHTML =
      `<div class="sk-spiele">` +
      keys.map((k) => {
        const g = pg[k], m = GAME_META[k] || { n: k };
        const r = g.plays ? Math.round((100 * g.wins) / g.plays) : 0;
        const gut = (g.net || 0) >= 0;
        const breite = Math.round((100 * Math.abs(g.net || 0)) / groesste);
        return `<div class="sk-spiel">` +
          `<span class="sk-spiel-sym">${spielSymbol(k)}</span>` +
          `<span class="sk-spiel-name">${escapeHtml(m.n)}` +
          `<small>${fmt(g.plays)} Runden · ${r}% gewonnen</small></span>` +
          `<span class="sk-spiel-wert ${gut ? "pos" : "neg"}">${window.Casino.betragDelta(g.net || 0)}</span>` +
          `<span class="sk-spiel-balken ${gut ? "gut" : "schlecht"}">` +
          `<i style="width:${breite}%"></i></span>` +
          `</div>`;
      }).join("") +
      `</div>` +
      `<div class="sk-summe ${gesamt >= 0 ? "gut" : "schlecht"}">` +
      `<span>Über alle Spiele</span><b>${window.Casino.betragDelta(gesamt)}</b></div>`;
  }

  // Kopfgeld auf den angezeigten Spieler setzen.
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("#bounty-btn");
    if (!btn) return;
    const target = btn.dataset.target;
    const raw = await window.Casino.dialog.eingabe(
      `Wie viel Kopfgeld auf ${target} aussetzen? Mindestens 1.000 Chips.`,
      { titel: "Kopfgeld aussetzen", wert: "5000", okText: "Aussetzen" });
    if (raw == null) return;
    const amount = parseInt(raw, 10);
    if (!Number.isFinite(amount) || amount < 1000) return window.Casino.toast("Mindestens 1.000 Chips.");
    window.Casino.socket.emit("bounty:place", { target, amount }, (r) => {
      if (!r || !r.ok) return window.Casino.toast(r?.error || "Fehler.");
      window.Casino.applyAccount(r.account);
      window.Casino.toast(`${window.Casino.betragText(amount)} Kopfgeld auf ${target} ausgesetzt!`);
      load();
    });
  });

  window.Casino._loadStats = load;
  /** Aus der Bestenliste die Statistik jedes Spielers ansehen. */
  window.Casino.openStats = (name) => {
    pendingName = name || null;
    showScreen("stats");
  };
})();
