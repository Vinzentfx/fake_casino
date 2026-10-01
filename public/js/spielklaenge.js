"use strict";

/*
 * Klänge für die Spiele, die bisher stumm waren: Schach, Memory, Solitär,
 * Poker, Pferderennen, Kniffel, Würfelpoker, Glücksrad, Lotterie und die
 * kurzen Events (Heist, Chip-Regen, Quiz).
 *
 * Absichtlich an EINER Stelle und nicht in zehn Spieldateien: alles hängt
 * an den Socket-Ereignissen. Was man selbst tut, kommt über
 * `onAnyOutgoing` (würfeln, ziehen, setzen), was am Tisch passiert, über die
 * Zustandsmeldungen der Spiele. Dieser Teil liest nur mit und schickt nie
 * etwas, das Spiel selbst merkt davon nichts.
 *
 * Die Zustandsklänge spielen nur, wenn der Bildschirm des Spiels offen ist;
 * die Events laufen als Fenster über allem und klingen überall.
 */
(function () {
  const C = window.Casino;
  const socket = C && C.socket;
  const S = C && C.sound;
  if (!socket || !S || !socket.onAnyOutgoing) return;
  const auf = (name) => C.screens && C.screens.current() === name;
  const play = (n) => n && S.play(n);

  /* Was man selbst auslöst. */
  const RAUS = {
    "wuerfel:start": "wuerfel",
    "wuerfel:nachwurf": "wuerfel",
    "kniffel:wurf": "wuerfel",
    "sol:move": (m) => (m && m.type === "draw" ? "flip" : "karte_ab"),
    "solrace:move": (m) => (m && m.type === "draw" ? "flip" : "karte_ab"),
    "sol:start": "mischen",
    "poker:action": (m) => (!m ? null : m.action === "fold" ? "flip" : m.action === "check" ? "tick" : "chip"),
    "horses:bet": "chip",
    "heist:hit": "rad_tick",
    "rain:grab": "chip",
    "wheel:spin": () => { radKlappern(); return null; },
  };
  socket.onAnyOutgoing((ev, ...args) => {
    const r = RAUS[ev];
    if (!r) return;
    play(typeof r === "function" ? r(args[0]) : r);
  });

  /* Das große Glücksrad: die Zunge klappert an jeder Feldgrenze, gemessen
     am echten Winkel wie beim Rad in der Welt. */
  function radKlappern() {
    const g = document.getElementById("gr-dreh");
    if (!g) return;
    const n = document.querySelectorAll(".gr-feld").length || 12;
    const weite = 360 / n;
    const winkel = () => {
      const w = /matrix\(([^,]+),\s*([^,]+)/.exec(getComputedStyle(g).transform || "");
      return w ? (Math.atan2(Number(w[2]), Number(w[1])) * 180 / Math.PI + 360) % 360 : 0;
    };
    let vorher = winkel(), still = 0;
    const start = performance.now();
    clearInterval(radKlappern.uhr);
    radKlappern.uhr = setInterval(() => {
      const jetzt = winkel();
      if (Math.floor(jetzt / weite) !== Math.floor(vorher / weite)) { play("rad_tick"); still = 0; }
      else if (Math.abs(jetzt - vorher) < 0.01) still++;
      vorher = jetzt;
      // Erst anfangen lassen (die Antwort des Servers kommt etwas später), dann bei Stillstand aufhören.
      if ((performance.now() - start > 1500 && still > 12) || performance.now() - start > 9000) clearInterval(radKlappern.uhr);
    }, 25);
  }

  /* Schach: jeder Zug klackt, Schlagen klingt doppelt, Matt fällt ab. */
  let schach = { zug: null, figuren: 0, fertig: false };
  socket.on("chess:state", (s) => {
    if (!s) return;
    const zug = s.lastMove ? s.lastMove.from + s.lastMove.to : null;
    const figuren = Array.isArray(s.board) ? s.board.flat().filter(Boolean).length : 0;
    if (auf("chess")) {
      if (zug && zug !== schach.zug && schach.zug !== null) play(figuren < schach.figuren ? "schlagen" : "schach");
      if (s.check && zug !== schach.zug) setTimeout(() => play("select"), 120);
      if (s.state === "done" && !schach.fertig) play("schach_matt");
    }
    schach = { zug: zug || "", figuren, fertig: s.state === "done" };
  });

  /* Memory: aufgedeckte Karten (auch die des Gegners) und gefundene Paare. */
  let memory = { offen: 0, paare: 0 };
  socket.on("memory:state", (s) => {
    if (!s || !Array.isArray(s.board)) return;
    const offen = s.board.filter((c) => c.up && !c.matched).length;
    const paare = s.board.filter((c) => c.matched).length;
    if (auf("memory")) {
      if (paare > memory.paare) play("paar");
      else if (offen > memory.offen) play("flip");
    }
    memory = { offen, paare };
  });

  /* Poker: neue Hand wird gemischt, jede Gemeinschaftskarte kommt einzeln,
     Einsätze der anderen klingen am Pot. */
  let poker = { karten: 0, pot: 0, hand: false, dran: false };
  socket.on("poker:state", (s) => {
    if (!s) return;
    const karten = Array.isArray(s.board) ? s.board.length : 0;
    const pot = Number(s.pot) || 0;
    const hand = !!s.handActive;
    const dran = !!(s.options && s.yourSeat === s.toAct && hand);
    if (auf("poker")) {
      if (hand && !poker.hand) play("mischen");
      for (let i = poker.karten; i < karten; i++) setTimeout(() => play("karte_ab"), (i - poker.karten) * 140);
      if (pot > poker.pot && poker.hand) play("chip");
      if (dran && !poker.dran) setTimeout(() => play("select"), 200);
    }
    poker = { karten, pot, hand, dran };
  });

  /* Pferderennen: Startschuss, Hufe während des Laufs, Glocke im Ziel. */
  let rennPhase = null, letzterGalopp = 0;
  socket.on("horses:round", (s) => {
    if (!s) return;
    if (auf("horses") && rennPhase && s.phase !== rennPhase) {
      if (s.phase === "running") play("startschuss");
      if (s.phase === "done") play("glocke");
    }
    rennPhase = s.phase;
  });
  socket.on("horses:tick", () => {
    if (rennPhase === "betting") { if (auf("horses")) play("startschuss"); }
    rennPhase = "running";
    const jetzt = performance.now();
    if (auf("horses") && jetzt - letzterGalopp > 1500) { letzterGalopp = jetzt; play("galopp"); }
  });

  /* Lotterie: ist neu gezogen, rollen die Kugeln einzeln. */
  let gezogen = null;
  socket.on("lotterie:update", (d) => {
    const neu = d && d.letzte && Array.isArray(d.letzte.gezogen) ? d.letzte.gezogen.join(",") : null;
    if (neu && gezogen !== null && neu !== gezogen && auf("lotterie")) {
      d.letzte.gezogen.forEach((_, i) => setTimeout(() => play("kugel"), i * 420));
    }
    if (neu) gezogen = neu;
  });

  /* Die kurzen Events. */
  socket.on("heist:start", () => play("alarm"));
  socket.on("heist:end", (d) => play(d && d.success ? "cash" : "lose"));
  socket.on("rain:start", () => play("regen"));
  socket.on("quiz:begin", () => play("select"));
  socket.on("quiz:result", () => {
    // Läuft nach quiz.js; das hat die eigene Antwort schon markiert.
    setTimeout(() => {
      const meine = document.querySelector(".quiz-opt.picked");
      if (meine) play(meine.classList.contains("correct") ? "richtig" : "falsch");
    }, 0);
  });
})();
