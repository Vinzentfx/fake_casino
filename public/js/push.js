"use strict";

/**
 * Benachrichtigungen.
 *
 * Zweck steht in game/push.js: das Casino ist voller Dinge, die zu zweit
 * stattfinden, und niemand weiss, wann die anderen da sind. Hier ist die
 * Oberflaeche dazu, außerdem der Knopf, mit dem man die anderen ruft.
 *
 * iPad ist der wichtigste Fall und gleichzeitig der einzige mit einer echten
 * Huerde: Safari erlaubt Push nur, wenn die Seite ueber "Zum Home-Bildschirm"
 * installiert wurde. Steht sie im Browser-Tab, gibt es die Berechtigung
 * schlicht nicht. Das sagt der Kasten offen, statt einen Schalter anzubieten,
 * der ohne Erklaerung nichts tut.
 */
(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);

  const unterstuetzt = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const istApple = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installiert = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  let reg = null;
  let stand = null;
  let swKaputt = false;   // einmal gescheitert reicht, nicht bei jedem Aufruf neu

  // base64url in ein Uint8Array umwandeln, das Format verlangt der Browser für den VAPID-Key.
  function urlB64(base64) {
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const roh = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i++) out[i] = roh.charCodeAt(i);
    return out;
  }

  async function registriere() {
    if (!unterstuetzt || reg || swKaputt) return reg;
    try {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    } catch { reg = null; swKaputt = true; }
    return reg;
  }

  function holeStand() {
    return new Promise((r) => socket.emit("push:state", r));
  }

  /** Ist dieses Gerät angemeldet? Die Geräteliste kommt vom Server. */
  async function meinAbo() {
    if (!reg) return null;
    try { return await reg.pushManager.getSubscription(); } catch { return null; }
  }

  async function anmelden() {
    if (!unterstuetzt) return toast("Dieser Browser kann keine Benachrichtigungen.");
    if (istApple && !installiert) {
      return toast("Auf dem iPad zuerst über Teilen und „Zum Home-Bildschirm“ installieren.");
    }
    await registriere();
    if (!reg) return toast("Benachrichtigungen konnten nicht eingerichtet werden.");

    const erlaubnis = await Notification.requestPermission();
    if (erlaubnis !== "granted") return toast("Ohne Erlaubnis geht es leider nicht.");

    const s = stand || (await holeStand());
    if (!s || !s.publicKey) return toast("Server hat keinen Schlüssel geliefert.");

    let sub = await meinAbo();
    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64(s.publicKey),
        });
      } catch { return toast("Anmeldung abgelehnt."); }
    }
    const res = await new Promise((r) => socket.emit("push:subscribe", { sub: sub.toJSON(), ua: navigator.userAgent }, r));
    if (!res || !res.ok) return toast((res && res.error) || "Anmeldung fehlgeschlagen.");
    stand = res;
    Casino.sound.play("win");
    toast("Benachrichtigungen sind an.");
    zeichne();
  }

  async function abmelden() {
    const sub = await meinAbo();
    const endpoint = sub ? sub.endpoint : null;
    if (sub) { try { await sub.unsubscribe(); } catch {} }
    const res = await new Promise((r) => socket.emit("push:unsubscribe", { endpoint }, r));
    if (res && res.ok) stand = res;
    toast("Benachrichtigungen sind aus.");
    zeichne();
  }

  async function zeichne() {
    const box = $("#push-box");
    const hint = $("#push-hint");
    if (!box || !hint) return;

    if (!unterstuetzt) {
      hint.textContent = "Dieser Browser kann keine Benachrichtigungen.";
      box.innerHTML = "";
      return;
    }
    if (istApple && !installiert) {
      hint.textContent = "Auf iPad und iPhone erlaubt Safari Benachrichtigungen nur für installierte Seiten.";
      box.innerHTML = `<div class="push-hinweis">
          <b>So geht es auf dem iPad:</b>
          <ol>
            <li>In Safari unten (oder oben) auf <b>Teilen</b> tippen.</li>
            <li><b>Zum Home-Bildschirm</b> wählen.</li>
            <li>Das Casino über das neue Symbol öffnen und hier wieder herkommen.</li>
          </ol>
        </div>`;
      return;
    }

    if (!reg) {
      hint.textContent = "Dieser Browser lässt keine Benachrichtigungen zu.";
      box.innerHTML = "";
      return;
    }

    stand = await holeStand();
    const sub = await meinAbo();
    const an = !!sub && !!stand && stand.geraete > 0 && stand.endpunkte.includes(sub.endpoint);

    hint.textContent = an
      ? "Dieses Gerät ist angemeldet. Nur die angehakten Anlässe werden geschickt, und nur wenn du gerade nicht im Casino bist."
      : "Das Casino meldet sich, wenn wirklich etwas los ist. Nie öfter als nötig.";

    const katalog = (stand && stand.katalog) || [];
    const typen = (stand && stand.typen) || {};
    box.innerHTML = `
      <div class="push-actions">
        <button class="btn-primary" id="push-toggle" type="button">${an ? "Auf diesem Gerät ausschalten" : "Auf diesem Gerät einschalten"}</button>
        ${an ? '<button class="chip-btn" id="push-test" type="button">Probe schicken</button>' : ""}
      </div>
      ${an ? katalog.map((t) => `
        <label class="toggle-row">
          <span>${escapeHtml(t.label)}<small class="toggle-note">${escapeHtml(t.hint)}</small></span>
          <input type="checkbox" data-push-typ="${t.id}" ${typen[t.id] === false ? "" : "checked"} />
        </label>`).join("") : ""}
    `;
  }

  // Mitspieler rufen
  function zeigeRufKnopf() {
    const b = $("#ruf-btn");
    if (b) b.hidden = false;
  }

  async function rufe() {
    const b = $("#ruf-btn");
    if (b) b.disabled = true;
    const res = await new Promise((r) => socket.emit("push:ruf", {}, r));
    if (res && res.ok) {
      Casino.sound.play("win");
      toast(`Ruf ist raus, ${res.erreicht} ${res.erreicht === 1 ? "Gerät" : "Geräte"} erreicht.`);
      if (b) b.disabled = false;
    } else {
      toast((res && res.error) || "Ging gerade nicht.");
      if (b) b.disabled = false;
    }
  }

  // Verdrahtung
  document.addEventListener("click", async (e) => {
    if (e.target.closest("#push-toggle")) {
      const sub = await meinAbo();
      const an = !!sub && !!stand && stand.endpunkte.includes(sub.endpoint);
      return an ? abmelden() : anmelden();
    }
    if (e.target.closest("#push-test")) {
      const res = await new Promise((r) => socket.emit("push:test", r));
      return toast(res && res.ok ? "Probe verschickt." : (res && res.error) || "Probe fehlgeschlagen.");
    }
    if (e.target.closest("#ruf-btn")) return rufe();
  });

  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-push-typ]");
    if (!el) return;
    socket.emit("push:types", { typen: { [el.dataset.pushTyp]: el.checked } }, (res) => {
      if (res && res.ok) stand = res;
    });
  });

  // Der Einstellungs-Screen ist schon in app.js registriert; register() wuerde
  // ihn ueberschreiben. Deshalb haengt sich der Kasten hier nur ein.
  Casino._loadPush = () => registriere().then(zeichne);

  // Beim Start nur dann registrieren, wenn dieses Gerät Benachrichtigungen
  // ueberhaupt schon erlaubt hat. Wer sie nie eingeschaltet hat, soll bei
  // jedem Laden nicht eine Datei mehr holen; in den Einstellungen wird
  // ohnehin registriert, bevor der Schalter etwas tut.
  if (unterstuetzt && Notification.permission === "granted") registriere();
  zeigeRufKnopf();
})();
