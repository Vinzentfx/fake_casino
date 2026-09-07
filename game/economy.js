"use strict";

/**
 * Economy: the work clicker (a capped bootstrap, NOT an idle game) plus the
 * shared-city actions (buy/sell land, build, buy out & take over businesses).
 *
 * The city no longer pays passive income — owning a building grants a BUFF, and
 * buying anything is a chip SINK. Real chips come from playing the games. The
 * clicker exists only to help a broke/new player scrape together a first stake;
 * it's deliberately capped so it never competes with the games or the city.
 */

const city = require("./city");
const stocks = require("./stocks");
const chat = require("./chat");
const achievements = require("./achievements");
const quests = require("./quests");
const weekly = require("./weekly");

// ─── Work clicker (capped) ──────────────────────────────────────────────────
const MAX_CLICK_LEVEL = 5;     // a few upgrades, then it's maxed out
const CLICK_POWER_BY_LEVEL = [2, 4, 7, 11, 16, 22];
const clickUpgradeCost = (lvl) => 200 * (lvl + 1); // lvl 0→200, 1→400, … 4→1000
const HUSTLE_TARGET = 25;      // valid work clicks per bonus
const HUSTLE_MIN_GAP = 180;    // clicks faster than this don't build hustle
const HUSTLE_HOUR_CAP = 10000;
const HUSTLE_DAY_CAP = 60000;
const WORK_FACTOR_WINDOW = 15 * 60 * 1000;
const JOB_HOUR_CAP = 32000;
const JOB_DAY_CAP = 150000;
/*
 * Die Jobs sind jetzt Rollen IM Haus, und die Aufgaben sind das, was man in
 * so einer Rolle wirklich koennen muss: wechseln, richtig auszahlen, Quoten
 * rechnen, einen falschen Wettschein erkennen.
 *
 * Vorher waren es Paketstapel, Kabelfarben und Zahlenfelder — thematisch
 * beliebig, und fast alle nach demselben Muster "die Loesung steht da, tippe
 * sie ab". Das war kein Raetsel, sondern eine Gehorsamspruefung.
 *
 * Zahlen (base, cooldown, xp) bleiben unveraendert: hier geht es um die
 * Qualitaet der Aufgaben, nicht um mehr Geld.
 */
const JOBS = {
  delivery: { hue: 190, label: "Kellner", emoji: "🍸", cooldown: 28_000, base: 170, xp: 2,
    hint: "Kurze Runden im Saal. Sicherer Einstieg.",
    tasks: ["bestellung", "wechseln"] },
  promo: { hue: 45, label: "Kasse", emoji: "🎫", cooldown: 50_000, base: 95, xp: 9,
    hint: "Wechseln und nachrechnen. Wenig Geld, viel XP.",
    tasks: ["wechseln", "quote"] },
  side: { hue: 265, label: "Croupier", emoji: "🃏", cooldown: 95_000, base: 230, xp: 4, risky: true,
    hint: "Auszahlen am Tisch. Wer die Quoten kennt, verdient hier.",
    tasks: ["auszahlung", "strategie"] },
  shift: { hue: 210, label: "Sicherheit", emoji: "🛡️", duration: 75_000, cooldown: 125_000, base: 980, xp: 12,
    hint: "Läuft kurz im Hintergrund. Danach: wer schummelt hier?",
    tasks: ["schein", "auszahlung"] },
};
const dayNow = () => Math.floor(Date.now() / 86400000);
// Die alten Aufgaben waren Abtippen, da reichten 35 Sekunden. Die neuen muss
// man rechnen, deshalb eine Minute.
const TASK_TTL = 60_000;
// Wer falsch liegt, bekommt trotzdem etwas. Die Wartezeit laeuft ohnehin, und
// Arbeiten ist die Hilfe fuer Leute ohne Chips — ein Totalausfall ist da die
// falsche Strafe. Richtig liegen lohnt sich trotzdem deutlich.
const TROSTLOHN = 0.4;
const WORK_STOPS = ["Depot", "Bank", "Markt", "Park", "Kiosk", "Hotel"];
const WORK_SYMBOLS = ["◆", "●", "▲", "■", "★", "✚"];
const WORK_CRATES = ["Rot", "Blau", "Gelb"];
const WORK_WIRES = ["Rot", "Blau", "Gelb", "Grün"];
const WORK_SCAN = ["💎", "🎟️", "🍀", "⭐", "🔑", "🪙"];

function shuffle(xs) {
  const arr = [...xs];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const CHIP_WERTE = [5000, 1000, 500, 100];
const TISCHE = ["Tisch 1", "Tisch 2", "Tisch 3", "Tisch 4", "Tisch 5", "Bar"];
const GETRAENKE = ["🍸", "🍺", "☕", "🥤", "🍾"];

const zufall = (n) => Math.floor(Math.random() * n);
const waehle = (xs) => xs[zufall(xs.length)];

/** Greedy-Zerlegung eines Betrags in Chips, groesste zuerst. */
function zerlege(betrag) {
  const out = [];
  let rest = betrag;
  for (const w of CHIP_WERTE) {
    while (rest >= w) { out.push(w); rest -= w; }
  }
  return rest === 0 ? out : null;
}

/**
 * Betrag suchen, der sich mit drei bis fuenf Chips auszahlen laesst. Ohne die
 * Schranke kommen Betraege wie 9.900 heraus, und dann tippt man zehn Chips.
 */
function wechselBetrag() {
  for (let i = 0; i < 60; i++) {
    const betrag = (2 + zufall(58)) * 100; // 200 bis 5.900
    const chips = zerlege(betrag);
    if (chips && chips.length >= 3 && chips.length <= 5) return { betrag, chips };
  }
  return { betrag: 1600, chips: [1000, 500, 100] };
}

/** Vier Antwortmoeglichkeiten, die richtige ist dabei, Reihenfolge gemischt. */
function auswahl(richtig, ablenker) {
  const set = [String(richtig)];
  for (const a of ablenker) {
    const v = String(Math.round(a));
    if (v !== String(richtig) && !set.includes(v) && Number(v) > 0) set.push(v);
    if (set.length >= 4) break;
  }
  return shuffle(set);
}

const fmtChips = (n) => Math.round(n).toLocaleString("de-DE");

/*
 * Grundstrategie Blackjack, auf die Faelle beschraenkt, die eindeutig sind.
 * Genau diese Situationen kosten am Tisch am meisten Geld, wenn man sie
 * falsch spielt — deshalb stehen sie hier.
 */
const BJ_FAELLE = [
  { hand: "harte 16", dealer: 10, richtig: "Karte", warum: "Gegen eine hohe Dealer-Karte musst du verbessern." },
  { hand: "harte 16", dealer: 6,  richtig: "Passen", warum: "Der Dealer hat die schlechteste Karte und überkauft oft." },
  { hand: "harte 12", dealer: 4,  richtig: "Passen", warum: "Dealer 4 überkauft häufig, kein Risiko nötig." },
  { hand: "harte 12", dealer: 2,  richtig: "Karte",  warum: "Bei Dealer 2 ist Passen mit 12 noch zu schwach." },
  { hand: "harte 11", dealer: 6,  richtig: "Verdoppeln", warum: "Mit 11 gegen eine schwache Karte verdoppelt man immer." },
  { hand: "harte 10", dealer: 9,  richtig: "Verdoppeln", warum: "10 gegen 9 ist noch klar im Vorteil." },
  { hand: "zwei Achter", dealer: 7, richtig: "Teilen", warum: "16 ist die schlechteste Hand — zwei Achten sind besser." },
  { hand: "zwei Asse", dealer: 6, richtig: "Teilen", warum: "Asse teilt man immer." },
  { hand: "harte 17", dealer: 10, richtig: "Passen", warum: "Ab 17 wird nicht mehr gezogen." },
  { hand: "harte 9", dealer: 3, richtig: "Verdoppeln", warum: "9 gegen 3 bis 6 wird verdoppelt." },
];
const BJ_AKTIONEN = ["Karte", "Passen", "Verdoppeln", "Teilen"];

function makeWorkTask(id, job, now = Date.now()) {
  const taskPool = Array.isArray(job.tasks) && job.tasks.length ? job.tasks : [job.task || "wechseln"];
  const type = taskPool[zufall(taskPool.length)];
  const ende = now + TASK_TTL;

  // ── Kasse: Betrag in moeglichst wenige Chips wechseln ────────────────────
  if (type === "wechseln") {
    const { betrag, chips } = wechselBetrag();
    return {
      id, type, expiresAt: ende,
      answer: chips.join(""),
      sortAnswer: "desc", // Reihenfolge beim Tippen soll egal sein
      loesung: chips.map((c) => fmtChips(c)).join(" + "),
      public: {
        id, type, title: "Wechseln",
        prompt: `Ein Gast will ${fmtChips(betrag)} 🪙 in Chips. Gib sie mit möglichst wenigen Chips aus.`,
        chips: CHIP_WERTE,
      },
    };
  }

  // ── Croupier: was zahlt der Tisch aus? ───────────────────────────────────
  if (type === "auszahlung") {
    const { payoutFactor } = require("./roulette");
    const einsatz = (1 + zufall(20)) * 50; // 50 bis 1.000
    const art = waehle(["zahl", "einfach", "dutzend"]);
    let faktor, frage;
    if (art === "zahl") {
      const n = 1 + zufall(36);
      faktor = payoutFactor("number", n, n);
      frage = `Jemand setzt ${fmtChips(einsatz)} 🪙 auf die ${n}. Die ${n} kommt. Was zahlst du aus?`;
    } else if (art === "einfach") {
      faktor = payoutFactor("red", null, 3); // 3 ist rot -> einfache Chance
      frage = `${fmtChips(einsatz)} 🪙 auf Rot, es kommt Rot. Was zahlst du aus?`;
    } else {
      faktor = payoutFactor("dozen", 1, 5); // 5 liegt im ersten Dutzend
      frage = `${fmtChips(einsatz)} 🪙 auf das erste Dutzend, es kommt die 5. Was zahlst du aus?`;
    }
    const richtig = Math.floor(einsatz * faktor);
    return {
      id, type, expiresAt: ende,
      answer: String(richtig),
      loesung: `${fmtChips(einsatz)} × ${String(faktor).replace(".", ",")} = ${fmtChips(richtig)} 🪙`,
      public: {
        id, type, title: "Auszahlung am Tisch", prompt: frage,
        options: auswahl(richtig, [einsatz * faktor + einsatz, einsatz, richtig * 2, Math.floor(richtig / 2)]),
        suffix: "🪙",
      },
    };
  }

  // ── Kasse: Quote ausrechnen ──────────────────────────────────────────────
  if (type === "quote") {
    const einsatz = (1 + zufall(20)) * 100;
    const quote = Math.round((1.2 + Math.random() * 4) * 100) / 100;
    const richtig = Math.floor(einsatz * quote);
    return {
      id, type, expiresAt: ende,
      answer: String(richtig),
      loesung: `${fmtChips(einsatz)} × ${String(quote).replace(".", ",")} = ${fmtChips(richtig)} 🪙`,
      public: {
        id, type, title: "Wettschein auszahlen",
        prompt: `Sportwette gewonnen: ${fmtChips(einsatz)} 🪙 bei Quote ${String(quote).replace(".", ",")}. Was kommt zurück?`,
        options: auswahl(richtig, [einsatz * quote + einsatz, einsatz, richtig - einsatz, richtig * 2]),
        suffix: "🪙",
      },
    };
  }

  // ── Croupier: Grundstrategie ─────────────────────────────────────────────
  if (type === "strategie") {
    const f = waehle(BJ_FAELLE);
    return {
      id, type, expiresAt: ende,
      answer: f.richtig.toLowerCase(),
      loesung: `${f.richtig} — ${f.warum}`,
      public: {
        id, type, title: "Richtig beraten",
        prompt: `Ein Gast hat ${f.hand}, der Dealer zeigt ${f.dealer}. Was rätst du?`,
        options: shuffle(BJ_AKTIONEN),
      },
    };
  }

  // ── Sicherheit: welcher Schein rechnet nicht auf? ────────────────────────
  if (type === "schein") {
    const scheine = [];
    const falschIdx = zufall(4);
    for (let i = 0; i < 4; i++) {
      const einsatz = (1 + zufall(15)) * 100;
      const quote = Math.round((1.3 + Math.random() * 3) * 100) / 100;
      const korrekt = Math.floor(einsatz * quote);
      const abweichung = Math.max(50, Math.round(korrekt * (0.12 + Math.random() * 0.25)));
      const gezeigt = i === falschIdx
        ? korrekt + (Math.random() < 0.5 ? abweichung : -abweichung)
        : korrekt;
      scheine.push({
        id: `S${i + 1}`,
        text: `S${i + 1}: ${fmtChips(einsatz)} 🪙 × ${String(quote).replace(".", ",")} = ${fmtChips(gezeigt)} 🪙`,
      });
    }
    return {
      id, type, expiresAt: ende,
      answer: `s${falschIdx + 1}`,
      loesung: `Schein S${falschIdx + 1} stimmt nicht.`,
      public: {
        id, type, title: "Falschen Schein finden",
        prompt: "Einer dieser vier Wettscheine rechnet nicht auf. Welcher?",
        options: scheine.map((x) => x.id),
        zeilen: scheine.map((x) => x.text),
      },
    };
  }

  // ── Kellner: Bestellungen in der richtigen Reihenfolge ───────────────────
  const anzahl = 3 + zufall(2);
  const bestellung = Array.from({ length: anzahl }, () => ({
    tisch: waehle(TISCHE), getraenk: waehle(GETRAENKE),
  }));
  // Doppelte Tische raus, sonst ist die Reihenfolge nicht eindeutig tippbar.
  const gesehen = new Set();
  const eindeutig = bestellung.filter((b) => (gesehen.has(b.tisch) ? false : gesehen.add(b.tisch)));
  const folge = eindeutig.map((b) => b.tisch);
  return {
    id, type: "bestellung", expiresAt: ende,
    answer: folge.join(""),
    loesung: folge.join(" → "),
    public: {
      id, type: "bestellung", title: "Bestellungen ausliefern",
      prompt: "Liefere die Bestellungen in genau dieser Reihenfolge aus.",
      target: eindeutig.map((b) => `${b.getraenk} ${b.tisch}`),
      options: shuffle(folge),
    },
  };
}

/**
 * Antwort einer Mini-Aufgabe vergleichbar machen.
 *
 * Der Haken war, dass Liste und Text unterschiedlich behandelt wurden: eine
 * Liste wurde nur zusammengefuegt, ein Text zusaetzlich kleingeschrieben. Der
 * Server legt die Loesung als Text ab ("P3P1P2P4"), der Client schickt eine
 * Liste (["P3","P1","P2","P4"]). Damit verglich man "p3p1p2p4" mit
 * "P3P1P2P4" — die Aufgaben route, wires und stack waren dadurch schlicht
 * unloesbar, und ein Fehlversuch verbrannte trotzdem die Wartezeit.
 */
function normalizeTaskAnswer(answer) {
  const roh = Array.isArray(answer) ? answer.join("") : String(answer || "");
  return roh.trim().toLowerCase().replace(/\s+/g, "");
}

function ensureEconomy(acc) {
  if (!acc.economy) acc.economy = {};
  const e = acc.economy;
  if (typeof e.clickLevel !== "number") {
    e.clickLevel = e.clickPower ? Math.min(MAX_CLICK_LEVEL, e.clickPower - 1) : 0;
  }
  return e;
}

const clickPower = (e) => CLICK_POWER_BY_LEVEL[Math.max(0, Math.min(MAX_CLICK_LEVEL, e.clickLevel || 0))] || CLICK_POWER_BY_LEVEL[0];

function workFactorFor(nw) {
  if (nw < 50000) return 4;
  if (nw < 250000) return 2.5;
  if (nw < 1000000) return 1.5;
  if (nw < 10000000) return 0.6;
  return 0.2;
}

function workFactorState(acc, e, now) {
  const nw = Math.max(0, Math.floor((accountsPublicNetWorth(acc)) || 0));
  if (!e.workNwAt || now - e.workNwAt >= WORK_FACTOR_WINDOW) {
    e.workNwAt = now;
    e.workNwPeak = nw;
  } else {
    e.workNwPeak = Math.max(e.workNwPeak || 0, nw);
  }
  const smoothed = Math.max(nw, e.workNwPeak || 0);
  return { netWorth: nw, smoothedNetWorth: smoothed, factor: workFactorFor(smoothed) };
}

function ensureJobState(e, now = Date.now()) {
  e.jobs = e.jobs || { cooldowns: {} };
  if (!e.jobs.cooldowns) e.jobs.cooldowns = {};
  if (e.jobs.day !== dayNow()) { e.jobs.day = dayNow(); e.jobs.dayEarned = 0; }
  if (!e.jobs.hourAt || now - e.jobs.hourAt >= 3600000) { e.jobs.hourAt = now; e.jobs.hourEarned = 0; }
  if (e.jobs.activeShift && now - e.jobs.activeShift.startedAt > 6 * 3600000) delete e.jobs.activeShift;
  return e.jobs;
}

function jobRoom(jobs) {
  return Math.max(0, Math.min(JOB_HOUR_CAP - (jobs.hourEarned || 0), JOB_DAY_CAP - (jobs.dayEarned || 0)));
}

function publicJobs(acc, e, now = Date.now()) {
  const jobs = ensureJobState(e, now);
  activeTask(jobs, now);
  const factor = workFactorState(acc, e, now);
  return {
    factor,
    hourEarned: Math.floor(jobs.hourEarned || 0),
    hourCap: JOB_HOUR_CAP,
    dayEarned: Math.floor(jobs.dayEarned || 0),
    dayCap: JOB_DAY_CAP,
    activeShift: jobs.activeShift ? {
      readyAt: jobs.activeShift.readyAt,
      startedAt: jobs.activeShift.startedAt,
      label: JOBS.shift.label,
    } : null,
    activeTask: jobs.activeTask && jobs.activeTask.expiresAt > now ? jobs.activeTask.public : null,
    jobs: Object.entries(JOBS).map(([id, job]) => ({
      id,
      label: job.label,
      emoji: job.emoji || "💼",
      hint: job.hint || "",
      hue: job.hue || 40,
      cooldownMs: job.cooldown || 0,
      durationMs: job.duration || 0,
      readyAt: jobs.cooldowns[id] || 0,
      payout: Math.max(1, Math.round(job.base * factor.factor)),
      xp: job.xp || 0,
      risky: !!job.risky,
    })),
  };
}

function awardJob(acc, key, e, job, now, mult = 1) {
  const jobs = ensureJobState(e, now);
  const factor = workFactorState(acc, e, now);
  const room = jobRoom(jobs);
  const raw = Math.max(1, Math.round(job.base * factor.factor * mult));
  const earned = Math.max(0, Math.min(room, raw));
  let publicAccount = accountsPublicAccount(acc);
  if (earned > 0) {
    const res = _accountsRef.adjustChips(key, earned);
    publicAccount = res.account || publicAccount;
    jobs.hourEarned = (jobs.hourEarned || 0) + earned;
    jobs.dayEarned = (jobs.dayEarned || 0) + earned;
  }
  if (job.xp) publicAccount = _accountsRef.addXp(key, job.xp) || publicAccount;
  try { quests.track(key, "work_job"); } catch {}
  return { earned, xp: job.xp || 0, account: publicAccount, capped: earned < raw, jobs: publicJobs(acc, e, now) };
}

function activeTask(jobs, now = Date.now()) {
  if (jobs.activeTask && jobs.activeTask.expiresAt <= now) delete jobs.activeTask;
  return jobs.activeTask || null;
}

function accountsPublicAccount(acc) {
  try { return _accountsRef.publicAccount(acc); } catch { return null; }
}

function accountsPublicNetWorth(acc) {
  try { return Number(_accountsRef.publicAccount(acc).netWorth) || 0; } catch { return acc.chips || 0; }
}

let _accountsRef = null;

/**
 * Zwei Kosmetik-Stuecke gibt es nicht zu kaufen, sondern nur ueber die Stadt:
 * der Titel "Straßenherr" fuer die erste komplette Strasse, der Namensstil
 * "Krone" dafuer, Boss eines Ortsteils zu sein.
 *
 * Die Pruefung lief erst nur nach einem Kauf, dann zusaetzlich beim Oeffnen
 * der Stadt — und haing damit immer noch daran, dass jemand den richtigen
 * Bildschirm antippt. Wer seinen Ortsteil laengst erobert hatte und die Karte
 * einfach nicht mehr aufmachte, wartete weiter vergeblich. Deshalb laeuft sie
 * jetzt zusaetzlich in einem Durchgang ueber ALLE Konten.
 */
function stadtKosmetik(io, accounts, key, acc) {
  if (!acc) return null;
  const cos = require("./cosmetics");
  let neu = null;
  if (city.streetCount(key) > 0 && cos.grant(acc, "title", "strassenkoenig")) neu = "Titel „Straßenherr“";
  if (city.istBossIrgendwo(key) && cos.grant(acc, "style", "krone")) neu = "Namensstil „Krone“";
  if (!neu) return null;
  accounts.save();
  if (io) {
    for (const s2 of io.of("/").sockets.values()) {
      if (s2.data && s2.data.account === key) {
        s2.emit("notice", { text: `🎨 Freigeschaltet: ${neu} — anlegen in der Kosmetik.` });
        break;
      }
    }
  }
  return neu;
}

/** Einmal ueber alle Konten. Billig: die Boss-Tabelle ist ohnehin gecacht. */
function stadtKosmetikFuerAlle(io, accounts) {
  for (const acc of accounts.rawAll()) {
    const key = String(acc.name || "").trim().toLowerCase();
    if (!key) continue;
    try { stadtKosmetik(io, accounts, key, acc); } catch {}
  }
}

function setupEconomy(io, accounts) {
  _accountsRef = accounts;
  const acct = (s) => (s.data.account ? accounts.get(s.data.account) : null);

  /** Tell everyone the shared city changed; clients re-pull city:state. */
  function broadcastCity() {
    io.emit("city:update");
  }

  // Per-ACCOUNT click rate limiter (~20/s) — keyed by account, not socket, so
  // opening extra tabs/sockets can't multiply the click faucet.
  const clickTimes = new Map();
  const CLICK_MAX = 20, CLICK_WINDOW = 1000;

  /*
   * Einmal beim Start und danach stuendlich. Wer seinen Ortsteil erobert hat,
   * bekommt seine Kosmetik damit spaetestens eine Stunde spaeter, ohne
   * irgendetwas anklicken zu muessen.
   */
  stadtKosmetikFuerAlle(io, accounts);
  setInterval(() => stadtKosmetikFuerAlle(io, accounts), 60 * 60 * 1000).unref();

  io.on("connection", (socket) => {
    // ── Work clicker ────────────────────────────────────────────────────────
    socket.on("work:click", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const now = Date.now();
      const key = socket.data.account;
      const times = (clickTimes.get(key) || []).filter((t) => now - t < CLICK_WINDOW);
      if (times.length >= CLICK_MAX) { clickTimes.set(key, times); return ack({ ok: false, error: "Zu schnell." }); }
      times.push(now); clickTimes.set(key, times);

      const e = ensureEconomy(acc);
      // Hourly earnings cap: with an autoclicker the 20/s rate limit alone
      // would still allow ~1M+/h — the clicker is a bootstrap, not a job.
      const HOUR = 3600000, CLICK_EARN_CAP = 35000;
      if (!e.clickHourAt || now - e.clickHourAt >= HOUR) { e.clickHourAt = now; e.clickEarned = 0; }
      if ((e.clickEarned || 0) >= CLICK_EARN_CAP)
        return ack({ ok: false, error: "Feierabend! Der Klick-Job ist für diese Stunde ausgeschöpft." });
      if (e.hustleDay !== dayNow()) { e.hustleDay = dayNow(); e.hustleDayEarned = 0; e.hustleClicks = 0; }
      if (!e.hustleHourAt || now - e.hustleHourAt >= HOUR) { e.hustleHourAt = now; e.hustleHourEarned = 0; }
      // Schulleiter trophy: education pays — clicks ×3.
      const schule = city.hasTrophy(key, "schule") ? 3 : 1;
      const factor = workFactorState(acc, e, now);
      let earned = Math.max(1, Math.round(clickPower(e) * schule * factor.factor));
      e.clickEarned = (e.clickEarned || 0) + earned;
      let hustleBonus = 0;
      const gap = now - (e.hustleLastClickAt || 0);
      e.hustleLastClickAt = now;
      const hustleEligible = gap >= HUSTLE_MIN_GAP;
      if (hustleEligible && (e.hustleDayEarned || 0) < HUSTLE_DAY_CAP && (e.hustleHourEarned || 0) < HUSTLE_HOUR_CAP) {
        e.hustleClicks = (e.hustleClicks || 0) + 1;
        if (e.hustleClicks >= HUSTLE_TARGET) {
          e.hustleClicks -= HUSTLE_TARGET;
          const rawBonus = 180 + e.clickLevel * 70;
          const room = Math.min(HUSTLE_DAY_CAP - (e.hustleDayEarned || 0), HUSTLE_HOUR_CAP - (e.hustleHourEarned || 0));
          hustleBonus = Math.max(0, Math.min(room, Math.round(rawBonus * factor.factor)));
          e.hustleDayEarned = (e.hustleDayEarned || 0) + hustleBonus;
          e.hustleHourEarned = (e.hustleHourEarned || 0) + hustleBonus;
          earned += hustleBonus;
        }
      }
      const res = accounts.adjustChips(key, earned);
      ack({
        ok: res.ok, account: res.account, earned, hustleBonus,
        jobs: publicJobs(acc, e, now),
        hustle: {
          clicks: e.hustleClicks || 0,
          target: HUSTLE_TARGET,
          hourEarned: Math.floor(e.hustleHourEarned || 0),
          hourCap: HUSTLE_HOUR_CAP,
          dayEarned: Math.floor(e.hustleDayEarned || 0),
          dayCap: HUSTLE_DAY_CAP,
          eligible: hustleEligible,
          factor: factor.factor,
          netWorth: factor.netWorth,
          smoothedNetWorth: factor.smoothedNetWorth,
        },
      });
    });

    socket.on("work:upgrade", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      if (e.clickLevel >= MAX_CLICK_LEVEL) return ack({ ok: false, error: "Schon voll ausgebaut — der Rest kommt aus den Spielen & der Stadt." });
      const cost = clickUpgradeCost(e.clickLevel);
      if (acc.chips < cost) return ack({ ok: false, error: "Nicht genug Chips." });
      e.clickLevel += 1;
      const res = accounts.adjustChips(socket.data.account, -cost);
      if (!res.ok) { e.clickLevel -= 1; return ack({ ok: false, error: res.error }); }
      ack({ ok: true, account: res.account, clickPower: clickPower(e), clickLevel: e.clickLevel, maxed: e.clickLevel >= MAX_CLICK_LEVEL });
    });

    socket.on("work:jobStart", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const now = Date.now();
      const jobs = ensureJobState(e, now);
      const job = JOBS[id];
      if (!job) return ack({ ok: false, error: "Job nicht gefunden." });
      if (activeTask(jobs, now)) return ack({ ok: false, error: "Erledige erst deine laufende Aufgabe.", jobs: publicJobs(acc, e, now) });
      if ((jobs.cooldowns[id] || 0) > now) return ack({ ok: false, error: "Dieser Job hat noch Cooldown.", jobs: publicJobs(acc, e, now) });
      if (jobRoom(jobs) <= 0) return ack({ ok: false, error: "Feierabend! Dein Job-Cap ist aktuell ausgeschöpft.", jobs: publicJobs(acc, e, now) });

      if (id === "shift") {
        if (jobs.activeShift) return ack({ ok: false, error: "Du hast schon eine Schicht laufen.", jobs: publicJobs(acc, e, now) });
        jobs.activeShift = { startedAt: now, readyAt: now + job.duration };
        jobs.cooldowns[id] = now + job.cooldown;
        accounts.save();
        return ack({ ok: true, started: true, jobs: publicJobs(acc, e, now) });
      }

      let mult = 1, outcome = null;
      if (job.risky) {
        const roll = Math.random();
        if (roll < 0.22) { mult = 2.8; outcome = "bonus"; }
        else if (roll < 0.55) { mult = 0.35; outcome = "schwach"; }
        else outcome = "normal";
      }
      jobs.cooldowns[id] = now + job.cooldown;
      jobs.activeTask = {
        ...makeWorkTask(id, job, now),
        jobId: id,
        mult,
        outcome,
        shiftDone: false,
      };
      accounts.save();
      return ack({ ok: true, task: jobs.activeTask.public, jobs: publicJobs(acc, e, now) });
    });

    socket.on("work:shiftClaim", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const now = Date.now();
      const jobs = ensureJobState(e, now);
      if (activeTask(jobs, now)) return ack({ ok: false, error: "Erledige erst deine laufende Aufgabe.", jobs: publicJobs(acc, e, now) });
      const shift = jobs.activeShift;
      if (!shift) return ack({ ok: false, error: "Keine aktive Schicht.", jobs: publicJobs(acc, e, now) });
      if (shift.readyAt > now) return ack({ ok: false, error: "Die Schicht läuft noch.", jobs: publicJobs(acc, e, now) });
      jobs.activeTask = {
        ...makeWorkTask("shift", JOBS.shift, now),
        jobId: "shift",
        mult: 1,
        outcome: "normal",
        shiftDone: true,
      };
      accounts.save();
      return ack({ ok: true, task: jobs.activeTask.public, jobs: publicJobs(acc, e, now) });
    });

    socket.on("work:taskComplete", ({ answer } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const now = Date.now();
      const jobs = ensureJobState(e, now);
      const task = activeTask(jobs, now);
      if (!task) return ack({ ok: false, error: "Keine aktive Aufgabe.", jobs: publicJobs(acc, e, now) });

      const job = JOBS[task.jobId];
      if (!job) { delete jobs.activeTask; accounts.save(); return ack({ ok: false, error: "Job nicht gefunden.", jobs: publicJobs(acc, e, now) }); }

      /* Beim Wechseln soll die Reihenfolge der angetippten Chips egal sein —
         wichtig ist, WELCHE Chips, nicht in welcher Folge man sie greift. */
      let eingabe = answer;
      if (task.sortAnswer === "desc" && Array.isArray(eingabe)) {
        eingabe = [...eingabe].map(Number).sort((a, b) => b - a);
      }
      const richtig = normalizeTaskAnswer(eingabe) === normalizeTaskAnswer(task.answer);

      if (task.shiftDone) delete jobs.activeShift;
      delete jobs.activeTask;

      /* Kein Totalausfall mehr. Die Wartezeit laeuft ohnehin, und Arbeiten ist
         die Hilfe fuer Leute ohne Chips — wer danebenliegt, bekommt den
         Trostlohn und erfaehrt die richtige Antwort. Richtig liegen bringt
         immer noch das Zweieinhalbfache. */
      const result = awardJob(acc, socket.data.account, e, job, now,
        (task.mult || 1) * (richtig ? 1 : TROSTLOHN));

      // Arbeiten zaehlt jetzt auch fuer die Season. Wenig, aber nicht null:
      // wer sich hochkaempft, kommt dabei auch im Pass voran.
      try { require("./season").addXp(socket.data.account, richtig ? 3 : 1, "play"); } catch {}

      return ack({
        ok: true, ...result,
        richtig,
        loesung: richtig ? null : (task.loesung || null),
        outcome: task.outcome,
        shiftDone: !!task.shiftDone,
      });
    });

    socket.on("economy:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const maxed = e.clickLevel >= MAX_CLICK_LEVEL;
      const factor = workFactorState(acc, e, Date.now());
      ack({
        ok: true,
        clickPower: clickPower(e),
        clickLevel: e.clickLevel,
        maxClickLevel: MAX_CLICK_LEVEL,
        upgradeCost: maxed ? null : clickUpgradeCost(e.clickLevel),
        maxed,
        hustle: {
          clicks: e.hustleClicks || 0,
          target: HUSTLE_TARGET,
          hourEarned: Math.floor(e.hustleHourEarned || 0),
          hourCap: HUSTLE_HOUR_CAP,
          dayEarned: Math.floor(e.hustleDayEarned || 0),
          dayCap: HUSTLE_DAY_CAP,
          factor: factor.factor,
          netWorth: factor.netWorth,
          smoothedNetWorth: factor.smoothedNetWorth,
        },
        jobs: publicJobs(acc, e),
        schulleiter: city.hasTrophy(socket.data.account, "schule"), // Klicks ×3
      });
    });

    // ── Shared city (real map: districts → buildings) ─────────────────────
    socket.on("city:state", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account || null;
      // Auch beim blossen Oeffnen pruefen. Vorher lief das nur nach einem
      // Kauf, weshalb alle, die ihren Ortsteil laengst erobert hatten, ewig
      // auf ihre Kosmetik warteten.
      if (key) { try { stadtKosmetik(io, accounts, key, accounts.get(key)); } catch {} }
      ack({ ok: true, overview: city.publicOverview(key) });
    });

    // Die Haeuser eines einzelnen Besitzers, mit dem Uebernahmepreis fuer den
    // Fragenden. Eigener Aufruf, damit die Uebersicht klein bleibt.
    socket.on("city:owner", ({ owner } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account || null;
      const ziel = String(owner || "").trim().toLowerCase();
      if (!ziel) return ack({ ok: false, error: "Kein Besitzer angegeben." });
      ack({ ok: true, owner: ziel, properties: city.ownerProperties(ziel, key) });
    });

    socket.on("city:district", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account || null;
      const d = city.publicDistrict(id, key);
      if (!d) return ack({ ok: false, error: "Stadtteil nicht gefunden." });
      d.residents = accounts.residentsByBuilding(); // Wohnsitz flavour for the panel
      ack({ ok: true, district: d });
    });

    // Wohnsitz: free social flavour — "live" in any house on the map.
    socket.on("city:residence", ({ buildingId } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = accounts.setResidence(socket.data.account, buildingId);
      if (!r.ok) return ack(r);
      ack({ ok: true, residence: r.residence, account: accounts.publicAccount(acc) });
      broadcastCity();
    });

    // Generic building action: validate, pay cost / receive gain, compensate a
    // dispossessed ex-owner (takeover), commit, broadcast. Conquests (new
    // street monopoly, boss change) are announced in the global chat, and
    // every action may complete an achievement.
    function doAction(socket, ack, make, districtId, buildingId) {
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const key = socket.data.account;
      const r = make(key, acc.name);
      if (!r.ok) return ack(r);
      if (r.cost && accounts.get(key).chips < r.cost) return ack({ ok: false, error: "Nicht genug Chips." });
      const before = city.territorySnapshot();
      r.commit();
      let res;
      if (r.cost) res = accounts.adjustChips(key, -r.cost).account;
      else if (r.gain) res = accounts.adjustChips(key, r.gain).account;
      else res = accounts.publicAccount(accounts.get(key));
      // Takeover: the previous owner is compensated (premium above value burns).
      if (r.payout && r.payout.to && r.payout.to !== key && r.payout.amount > 0) {
        accounts.adjustChips(r.payout.to, r.payout.amount);
        // …and if there's a bounty on that rival, the raider collects it.
        const victim = accounts.get(r.payout.to);
        const bounty = accounts.claimBounty(r.payout.to, key);
        if (bounty > 0) {
          chat.announce(io, `🎯 KOPFGELD! ${acc.name} hat ${victim ? victim.name : "einem Rivalen"} ein Gebäude abgenommen und ${bounty.toLocaleString("de-DE")} 🪙 Kopfgeld kassiert!`);
          achievements.check(key);
        }
      }
      ack({
        ok: true, account: res, cost: r.cost || 0, gain: r.gain || 0,
        district: districtId ? city.publicDistrict(districtId, key) : null,
      });
      for (const msg of city.territoryDiff(before, city.territorySnapshot())) chat.announce(io, msg);
      // Buys & takeovers count for quests, but each building only once/day.
      if (r.cost) quests.track(key, "buy_house", 1, buildingId);
      achievements.check(key);
      stadtKosmetik(io, accounts, key, acc);
      broadcastCity();
    }

    const A = (fn) => ({ buildingId, districtId } = {}, ack) => {
      if (typeof ack !== "function") return;
      doAction(socket, ack, (key, name) => fn(buildingId, key, name), districtId, buildingId);
    };
    socket.on("city:buy",      A((id, key, name) => city.buyBuilding(id, key, name)));
    socket.on("city:sell",     A((id, key) => city.sellBuilding(id, key)));
    socket.on("city:takeover", A((id, key, name) => city.takeover(id, key, name)));

    // List one of your businesses on the stock market (IPO): raise capital
    // now, and it starts trading for everyone.
    socket.on("city:ipo", ({ buildingId, districtId } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const key = socket.data.account;
      const r = city.listCompany(buildingId, key);
      if (!r.ok) return ack(r);
      const listed = stocks.ipo(key, r.name, r.seedPrice);
      r.commit();
      const res = accounts.adjustChips(key, r.raise);
      ack({ ok: true, raised: r.raise, sym: listed.sym, account: res.account, district: districtId ? city.publicDistrict(districtId, key) : null });
      broadcastCity();
    });

    // ── Rivalen / Kopfgeld ────────────────────────────────────────────────
    socket.on("bounty:place", ({ target, amount } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = accounts.placeBounty(socket.data.account, target, amount);
      if (!r.ok) return ack(r);
      chat.announce(io, `🎯 KOPFGELD ausgesetzt: ${(accounts.get(socket.data.account) || {}).name || "?"} setzt ${Math.floor(amount).toLocaleString("de-DE")} 🪙 auf ${r.targetName} — übernimm ein Gebäude von ${r.targetName}, um es zu kassieren!`);
      ack(r);
    });

    // ── Login-Kalender ────────────────────────────────────────────────────
    socket.on("calendar:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...accounts.calendarState(socket.data.account) });
    });
    socket.on("calendar:claim", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = accounts.claimCalendar(socket.data.account);
      if (r.ok) achievements.check(socket.data.account);
      ack(r);
    });

    // ── Glücksrad ─────────────────────────────────────────────────────────
    socket.on("wheel:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...accounts.wheelState(socket.data.account) });
    });
    socket.on("wheel:spin", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack(accounts.spinWheel(socket.data.account));
    });

    socket.on("disconnect", () => clickTimes.delete(socket.id));
  });

  // Market life: per-district indices drift every minute; occasionally a local
  // news event shakes one district — everyone gets a toast (Spekulation!).
  // The same heartbeat drives the weekly cycle (Spieler der Woche, Goldene Straße).
  setInterval(() => {
    const event = city.tickMarket();
    io.emit("city:update");
    if (event) io.emit("city:news", event);
    weekly.tick(io, accounts);
  }, 60000).unref();
  weekly.tick(io, accounts); // seed golden street on boot
}

module.exports = { setupEconomy };
