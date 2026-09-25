"use strict";

const moderation = require("./moderation");
const zugangsschutz = require("./zugangsschutz");

const GATE_ALLOW = new Set(["auth", "app:version", "verification:state", "verification:submit"]);
const statuses = new Set(["required", "pending", "message"]);
const clean = (value, max) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);

function state(acc) {
  const v = acc && acc.verification;
  if (!v || !statuses.has(v.status)) return null;
  return { status: v.status, message: v.message || "", submittedAt: v.submittedAt || null };
}

function setupVerification(io, accounts) {
  io.on("connection", (socket) => {
    // Ein bereits verbundener Browser darf nach einer Sperre nicht weiterspielen.
    socket.use((packet, next) => {
      const key = socket.data.account;
      const acc = key && accounts.get(key);
      if (!acc || !state(acc) || GATE_ALLOW.has(packet[0])) return next();
      const ack = packet[packet.length - 1];
      if (typeof ack === "function") ack({ ok: false, error: "Bitte bestätige zuerst deine Identität." });
      // Nicht an Spiel-, Chat- oder Wirtschafts-Handler weiterreichen.
    });

    const myKey = () => socket.data.account;
    const myAcc = () => accounts.get(myKey());
    const myLevel = () => moderation.level(myAcc(), myKey());
    const protectedTarget = (key) => moderation.level(accounts.get(key), key) > 0;
    const resolve = (raw) => accounts.kanonisch(String(raw || "")) || String(raw || "").toLowerCase();
    const notifyTeam = () => {
      for (const s of io.of("/").sockets.values()) {
        if (moderation.level(accounts.get(s.data.account), s.data.account) >= 1) s.emit("admin:identityChanged");
      }
    };
    const update = (key) => {
      const acc = accounts.get(key);
      for (const s of io.of("/").sockets.values()) {
        if (s.data.account === key) {
          s.emit("account:update", { account: accounts.publicAccount(acc) });
          s.emit("verification:update", { verification: state(acc) });
        }
      }
    };

    socket.on("verification:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = myAcc();
      ack(acc ? { ok: true, verification: state(acc), account: accounts.publicAccount(acc) }
        : { ok: false, error: "Bitte melde dich erneut an." });
    });

    socket.on("verification:submit", ({ realName, grade } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = myAcc();
      const current = state(acc);
      if (!acc || !current) return ack({ ok: false, error: "Keine Bestätigung nötig." });
      if (current.status !== "required") return ack({ ok: false, error: "Deine Angaben wurden bereits eingereicht." });
      const name = clean(realName, 80);
      const stufe = clean(grade, 30);
      if (name.length < 3 || stufe.length < 1 || name.length > 80 || stufe.length > 30) {
        return ack({ ok: false, error: "Bitte echten Namen und Stufe/Klasse angeben." });
      }
      acc.identity = { ...(acc.identity || {}), known: false, realName: name, grade: stufe, updatedAt: Date.now() };
      acc.verification = { ...acc.verification, status: "pending", message: "Deine Angaben warten auf Prüfung.", submittedAt: Date.now() };
      accounts.save();
      try { moderation.record({ actor: acc.name, action: "verification:submit", target: acc.name }); } catch (err) { console.error(err); }
      update(myKey());
      notifyTeam();
      ack({ ok: true, verification: state(acc) });
    });

    socket.on("admin:team", (ack) => {
      if (typeof ack !== "function") return;
      if (myLevel() < 1) return ack({ ok: false, error: "Kein Zugriff." });
      ack({ ok: true, team: accounts.rawAll().filter((a) => moderation.level(a, accounts.kanonisch(a.name)) > 0)
        .map((a) => ({ name: a.name, level: moderation.level(a, accounts.kanonisch(a.name)), rank: moderation.rank(a, accounts.kanonisch(a.name)) }))
        .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, "de")), ranks: moderation.RANKS });
    });

    socket.on("admin:audit", (params, ack) => {
      if (typeof params === "function") { ack = params; params = {}; }
      if (typeof ack !== "function") return;
      if (myLevel() < 1) return ack({ ok: false, error: "Kein Zugriff." });
      ack({ ok: true, ...moderation.recent(100, params?.offset) });
    });

    socket.on("admin:identityQueue", (ack) => {
      if (typeof ack !== "function") return;
      if (myLevel() < 1) return ack({ ok: false, error: "Kein Zugriff." });
      const cases = accounts.rawAll().filter((a) => state(a)).map((a) => ({
        name: a.name, status: a.verification.status, message: a.verification.message || "",
        realName: a.identity?.realName || "", grade: a.identity?.grade || "",
        submittedAt: a.verification.submittedAt || null,
      })).sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || (a.submittedAt || 0) - (b.submittedAt || 0));
      ack({ ok: true, cases });
    });

    socket.on("admin:identitySet", ({ target, known, realName, grade } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (myLevel() < 1) return ack({ ok: false, error: "Kein Zugriff." });
      if (typeof known !== "boolean") return ack({ ok: false, error: "Ungültiger Zuordnungsstatus." });
      const key = resolve(target), acc = accounts.get(key);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      if (protectedTarget(key)) return ack({ ok: false, error: "Teamkonten sind geschützt." });
      if (known && state(acc)) return ack({ ok: false, error: "Eine laufende Prüfung muss regulär bestätigt werden." });
      acc.identity = { ...(acc.identity || {}), known: !!known, updatedAt: Date.now(), updatedBy: myAcc()?.name || myKey() };
      if (realName !== undefined) acc.identity.realName = clean(realName, 80);
      if (grade !== undefined) acc.identity.grade = clean(grade, 30);
      accounts.save();
      ack({ ok: true });
      notifyTeam();
    });

    socket.on("admin:identityHold", ({ target } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (myLevel() < 2) return ack({ ok: false, error: "Ab Moderator-Rang möglich." });
      const key = resolve(target), acc = accounts.get(key);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      if (protectedTarget(key)) return ack({ ok: false, error: "Teamkonten sind geschützt." });
      if (acc.identity?.known) return ack({ ok: false, error: "Erst als unbekannt markieren." });
      acc.verification = { status: "required", message: "Bitte gib deinen echten Namen und deine Stufe/Klasse an.", requestedAt: Date.now(), requestedBy: myAcc()?.name || myKey() };
      accounts.save(); update(key);
      ack({ ok: true });
      notifyTeam();
    });

    socket.on("admin:identityReview", ({ target, action, message } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (myLevel() < 2) return ack({ ok: false, error: "Ab Moderator-Rang möglich." });
      const key = resolve(target), acc = accounts.get(key);
      if (!acc || !state(acc)) return ack({ ok: false, error: "Keine offene Prüfung." });
      if (protectedTarget(key)) return ack({ ok: false, error: "Teamkonten sind geschützt." });
      if (!["approve", "reject", "message", "banDevice"].includes(action)) return ack({ ok: false, error: "Ungültige Entscheidung." });
      if (action === "banDevice" && myLevel() < 3) return ack({ ok: false, error: "Nur Leitmoderation oder Besitzer." });
      if (action === "approve" && (!acc.verification.submittedAt || !acc.identity?.realName || !acc.identity?.grade)) {
        return ack({ ok: false, error: "Erst Name und Stufe/Klasse prüfen." });
      }
      if (action === "banDevice") {
        const device = acc.lastDeviceId;
        if (!/^[a-f0-9]{32}$/.test(String(device || ""))) return ack({ ok: false, error: "Für diesen Account ist kein Browser-Gerät bekannt." });
        if (accounts.rawAll().some((a) => a !== acc && moderation.level(a, accounts.kanonisch(a.name)) > 0 && a.lastDeviceId === device)) {
          return ack({ ok: false, error: "Dieses Gerät wurde auch von einem Teammitglied benutzt." });
        }
        const ban = accounts.ban(key);
        if (!ban.ok) return ack(ban);
        zugangsschutz.sperre(device);
        for (const s of io.of("/").sockets.values()) {
          if (s.data.account === key || s.data.deviceId === device) {
            s.emit("admin:kicked", { reason: "Konto und Browser wurden gesperrt." });
            s.disconnect(true);
          }
        }
      } else if (action === "approve") {
        acc.identity = { ...acc.identity, known: true, updatedAt: Date.now(), updatedBy: myAcc()?.name || myKey() };
        delete acc.verification;
        accounts.save(); update(key);
      } else {
        const fallback = action === "reject" ? "Die Angaben wurden nicht bestätigt. Bitte korrigiere sie." : "Komm in der großen Pause zur Bestätigung in den Pausenraum.";
        const note = clean(message, 300) || fallback;
        acc.verification = { ...acc.verification, status: action === "reject" ? "required" : "message", message: note,
          submittedAt: action === "reject" ? null : acc.verification.submittedAt };
        accounts.save(); update(key);
      }
      ack({ ok: true });
      notifyTeam();
    });
  });
}

module.exports = { setupVerification, state };
