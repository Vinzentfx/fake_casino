"use strict";

/**
 * Ein Stück verkaufen: Festpreis oder Versteigerung.
 *
 * Beides gab es schon, und beides konnte man auch schon selbst bepreisen —
 * nur an zwei verschiedenen Orten, und man musste vorher wissen, dass es
 * zwei Wege gibt. Wer im Markt stand, sah das Auktionshaus nicht, und wer
 * im Auktionshaus stand, den Markt nicht. Die eigentliche Entscheidung
 * stand damit nirgends:
 *
 *   FESTPREIS      Du nennst die Zahl, und genau die bekommst du (abzüglich
 *                  Gebühr). Es liegt im Schaufenster, bis jemand zugreift,
 *                  und niemand bietet dich hoch.
 *
 *   VERSTEIGERUNG  Du nennst nur, wo es LOSGEHT. Was daraus wird,
 *                  entscheiden die anderen — nach oben offen. Dafür ist die
 *                  Gebühr sofort weg, auch wenn keiner bietet, und das Haus
 *                  behält mehr vom Zuschlag.
 *
 * Genau diese Abwägung steht jetzt in einem Fenster, mit den Zahlen beider
 * Wege nebeneinander, und danach gibt man seinen Preis ein. Aufgerufen wird
 * es aus dem Markt UND aus dem Auktionshaus, damit man von überall dieselbe
 * Wahl hat.
 */
(function () {
  const Casino = window.Casino;
  const socket = Casino.socket;
  if (!socket) return;

  const zahl = (n) => Math.floor(Number(n) || 0).toLocaleString("de-DE");

  /** Beide Stände holen, sonst kennt man je nur den halben Vergleich. */
  function staende() {
    return Promise.all([
      new Promise((f) => socket.emit("market:state", (r) => f(r && r.ok ? r : null))),
      new Promise((f) => socket.emit("auktion:state", (r) => f(r && r.ok ? r : null))),
    ]);
  }

  /**
   * Warum das Auktionshaus für dieses Stück nicht in Frage kommt.
   *
   * Der Grund gehört ins Fenster, nicht in einen Fehler NACH der Wahl: eine
   * Möglichkeit, die man anbietet und dann ablehnt, ist schlimmer als eine,
   * die gar nicht erst dasteht.
   */
  function auktionsGrund(auk, uid) {
    const e = auk && auk.einliefern;
    if (!e) return "Das Auktionshaus antwortet gerade nicht.";
    if (auk.gesperrt) return "Du darfst gerade nichts einliefern.";
    if (e.schlange.some((x) => x.meins)) return "Du hast schon etwas in der Warteschlange.";
    if (e.voll) return "Die Warteschlange ist voll.";
    if (!(e.meine || []).some((x) => x.uid === uid)) return "Nimmt erst ab Episch.";
    return null;
  }

  /**
   * Der ganze Ablauf für ein Stück.
   *
   * @param {{uid: string, label: string, nr: number}} stueck
   * @param {() => void} [fertig]  Wird nach einem erfolgreichen Verkauf gerufen.
   */
  async function verkaufe(stueck, fertig) {
    if (!stueck || !stueck.uid) return;
    const [markt, auk] = await staende();
    if (!markt) return Casino.toast("Der Markt antwortet gerade nicht.");

    const name = `${stueck.label} Nr. ${stueck.nr}`;
    const grund = auktionsGrund(auk, stueck.uid);
    const e = (auk && auk.einliefern) || {};

    const optionen = [
      {
        wert: "markt",
        label: "Festpreis im Markt",
        hinweis: `Du nennst die Zahl und bekommst sie auch. `
          + `${Math.round((markt.gebuehr || 0) * 100)} % Gebühr beim Verkauf, vorher kostet es nichts.`,
      },
      {
        wert: "auktion",
        label: grund ? `Versteigern — geht nicht: ${grund}` : "Versteigern im Auktionshaus",
        hinweis: grund
          ? "Kleineres und schon Eingeliefertes bleibt im Markt."
          : `Du nennst nur das Startgebot, hoch treiben es die anderen. `
            + `${zahl(e.gebuehr)} Chips sofort weg — auch wenn keiner bietet — und `
            + `${Math.round((e.provision || 0) * 100)} % vom Zuschlag ans Haus.`,
      },
    ];

    const weg = await Casino.dialog.wahl(`Wie willst du „${name}“ loswerden?`, {
      titel: "Verkaufen", optionen,
    });
    if (!weg) return;
    if (weg === "auktion" && grund) return Casino.toast(grund);

    if (weg === "markt") return festpreis(markt, stueck, name, fertig);
    return versteigern(auk, stueck, name, fertig);
  }

  async function festpreis(markt, stueck, name, fertig) {
    const preis = await Casino.dialog.eingabe(
      `Zu welchem Preis soll „${name}“ ins Schaufenster? `
      + `Zwischen ${zahl(markt.minPreis)} und ${zahl(markt.maxPreis)} Chips. `
      + `${Math.round(markt.gebuehr * 100)} % gehen beim Verkauf ans Haus.`,
      { titel: "Festpreis", platzhalter: "Preis in Chips", okText: "Ins Schaufenster" },
    );
    if (preis === null || preis === undefined || preis === "") return;
    socket.emit("market:anbieten", { uid: stueck.uid, preis: Number(preis) }, (res) => {
      if (!res || !res.ok) return Casino.toast((res && res.error) || "Ging nicht.");
      if (res.account) Casino.applyAccount(res.account);
      const netto = Math.round(Number(preis) * (1 - markt.gebuehr));
      Casino.toast(`Steht im Schaufenster. Beim Verkauf bekommst du ${zahl(netto)} Chips.`);
      if (fertig) fertig(res);
    });
  }

  async function versteigern(auk, stueck, name, fertig) {
    const e = auk.einliefern;
    const start = await Casino.dialog.eingabe(
      `Ab welchem Betrag soll „${name}“ losgehen? Mindestens ${zahl(auk.startGebot)} Chips. `
      + `Die Einliefergebühr von ${zahl(e.gebuehr)} Chips wird sofort fällig und ist auch weg, `
      + `wenn niemand bietet. Nach oben ist das Startgebot offen — treiben es die anderen höher, `
      + `bekommst du mehr als im Markt.`,
      { titel: "Unter den Hammer", platzhalter: "Startgebot in Chips", okText: "Einliefern" },
    );
    if (start === null || start === undefined || start === "") return;
    socket.emit("auktion:einliefern", { uid: stueck.uid, mindest: Number(start) }, (r) => {
      if (!r || !r.ok) return Casino.toast((r && r.error) || "Ging nicht.");
      if (r.account) Casino.applyAccount(r.account);
      Casino.toast(`„${r.label}“ Nr. ${r.nr} steht in der Warteschlange.`);
      if (fertig) fertig(r);
    });
  }

  Casino.verkaufen = verkaufe;
})();
