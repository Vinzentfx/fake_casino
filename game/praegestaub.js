"use strict";

/**
 * Prägestaub und das wöchentlich wechselnde Atelier.
 *
 * Doppelte Kistenfunde werden nicht länger zu Chips zurückgedreht. Das wäre
 * für volle Sammlungen nur ein Geldautomat und fühlt sich trotzdem wie eine
 * Niete an. Stattdessen werden sie zu einer eigenen, nicht handelbaren
 * Währung. Im Atelier stehen jede Woche drei exklusive Stücke fest zur Wahl.
 * Sie entstehen nirgendwo sonst und bilden zusammen eine eigene Garnitur.
 */

const DUST_BY_TIER = Object.freeze({
  gewoehnlich: 8,
  selten: 20,
  episch: 55,
  legendaer: 140,
  mythisch: 350,
  kiste: 700,
});
const FREE_DUPLICATE_DUST = 5;
const OFFER_COST = Object.freeze({ selten: 160, episch: 420, legendaer: 950 });
const OFFER_TIERS = Object.freeze(["selten", "episch", "legendaer"]);
const weekNow = (now = Date.now()) => Math.floor((now / 86400000 + 3) / 7);
const nextWeekAt = (now = Date.now()) => (weekNow(now) + 1) * 7 * 86400000 - 3 * 86400000;

function balance(acc) { return Math.max(0, Math.floor(Number(acc && acc.praegestaub) || 0)); }

function gutschreiben(acc, tier, free = false) {
  if (!acc) return 0;
  const amount = free ? FREE_DUPLICATE_DUST : (DUST_BY_TIER[tier] || DUST_BY_TIER.gewoehnlich);
  acc.praegestaub = balance(acc) + amount;
  return amount;
}

function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function katalog() {
  const c = require("./cosmetics");
  const listen = {
    avatar: c.AVATARS, color: c.COLORS, style: c.STYLES, frame: c.FRAMES,
    title: c.TITLES, effect: c.EFFEKTE, spruch: c.SPRUECHE, banner: c.BANNER,
    schild: c.SCHILDER, aura: c.AUREN, karte: c.KARTEN, zeichen: c.ZEICHEN,
  };
  const out = [];
  for (const [art, liste] of Object.entries(listen)) {
    for (const item of liste || []) {
      /* Nur eigens für diesen Weg entworfene Stücke. So fühlt sich Staub
         nicht wie ein Umweg zu gewöhnlicher Kistenware an. */
      if (item.nur !== "staub" || item.limitiert !== "staub") continue;
      const tier = item.staubTier;
      if (OFFER_TIERS.includes(tier)) out.push({ art, id: item.id, item, tier });
    }
  }
  return out;
}

function offers(now = Date.now()) {
  const week = weekNow(now);
  const all = katalog();
  return OFFER_TIERS.map((tier) => {
    const pool = all.filter((x) => x.tier === tier).sort((a, b) => `${a.art}:${a.id}`.localeCompare(`${b.art}:${b.id}`));
    const x = pool[hash(`${week}:${tier}:atelier`) % pool.length];
    /* Eigene Versionskennung: Wer in dieser Woche noch einen alten,
       gewöhnlichen Wochenpreis gekauft hat, soll die neue Kollektion nicht
       bis Montag gesperrt sehen. */
    return x && { id: `${week}:atelier:${tier}`, week, tier, cost: OFFER_COST[tier], art: x.art, cosmeticId: x.id };
  }).filter(Boolean);
}

function setupPraegestaub(io, accounts) {
  const cosmetics = require("./cosmetics");

  function state(key, now = Date.now()) {
    const acc = accounts.get(key);
    if (!acc) return { ok: false, error: "Bitte zuerst einloggen." };
    const bought = Array.isArray(acc.praegestaubKaeufe) ? acc.praegestaubKaeufe : [];
    return {
      ok: true,
      balance: balance(acc),
      resetsAt: nextWeekAt(now),
      duplicateDust: DUST_BY_TIER,
      freeDuplicateDust: FREE_DUPLICATE_DUST,
      offers: offers(now).map((o) => ({
        ...o,
        label: cosmetics.label(o.art, o.cosmeticId),
        artName: cosmetics.ART_NAME[o.art] || o.art,
        look: cosmetics.vorschauDaten(o.art, o.cosmeticId),
        owned: cosmetics.hatStueck(acc, o.art, o.cosmeticId),
        bought: bought.includes(o.id),
      })),
    };
  }

  io.on("connection", (socket) => {
    const key = () => socket.data.account;

    socket.on("staub:state", (ack) => {
      if (typeof ack === "function") ack(state(key()));
    });

    socket.on("staub:buy", ({ offerId } = {}, ack) => {
      if (typeof ack !== "function") return;
      const k = key(), acc = k && accounts.get(k);
      if (!acc) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const offer = offers().find((x) => x.id === String(offerId || ""));
      if (!offer) return ack({ ok: false, error: "Dieser Wochenpreis ist nicht mehr verfügbar." });
      acc.praegestaubKaeufe = Array.isArray(acc.praegestaubKaeufe) ? acc.praegestaubKaeufe : [];
      if (acc.praegestaubKaeufe.includes(offer.id)) return ack({ ok: false, error: "Diesen Wochenpreis hast du bereits geprägt." });
      if (cosmetics.hatStueck(acc, offer.art, offer.cosmeticId)) return ack({ ok: false, error: "Dieses Stück besitzt du bereits." });
      if (balance(acc) < offer.cost) return ack({ ok: false, error: `Dir fehlen ${(offer.cost - balance(acc)).toLocaleString("de-DE")} Prägestaub.` });

      acc.praegestaub = balance(acc) - offer.cost;
      if (!cosmetics.grant(acc, offer.art, offer.cosmeticId, k)) {
        acc.praegestaub += offer.cost;
        return ack({ ok: false, error: "Das Stück konnte nicht geprägt werden." });
      }
      acc.praegestaubKaeufe.push(offer.id);
      /* Alte Wochen müssen nicht ewig im Konto wachsen. */
      const minWeek = weekNow() - 8;
      acc.praegestaubKaeufe = acc.praegestaubKaeufe.filter((id) => Number(String(id).split(":")[0]) >= minWeek);
      accounts.save();
      let collections = [];
      try { collections = cosmetics.sammlungAnsage(io, accounts, k); } catch {}
      const piece = require("./praegung").stueckVon(k, offer.art, offer.cosmeticId);
      /* Atelierstücke sind echte Prägungen. Legendäre Stücke und seltene
         Seriennummern verdienen deshalb dieselbe Bühne wie große Kistenfunde. */
      try {
        const tiers = require("./kisten").STUFEN;
        const tier = tiers.find((x) => x.id === offer.tier) || tiers[0];
        const label = cosmetics.label(offer.art, offer.cosmeticId);
        require("./ruhm").melde(k, {
          art: offer.art, id: offer.cosmeticId, label, stufe: tier,
          nr: piece && piece.nr, serie: piece && piece.serie,
        }, { kisteLabel: "Prägeatelier" });
        const rank = piece && piece.serie && piece.serie.id;
        if (offer.tier === "legendaer" || rank === "gold" || rank === "jackpot") {
          const accName = acc.name || k;
          const code = piece && piece.serie && piece.serie.code;
          const message = rank === "jackpot"
            ? `🎰 SERIEN-JACKPOT! ${accName} prägt #${code} auf „${label}“ im Prägeatelier.`
            : rank === "gold"
              ? `✦ GOLD-SERIE! ${accName} prägt #${code} auf „${label}“ im Prägeatelier.`
              : `⚒ LEGENDÄRE PRÄGUNG! ${accName} erschafft „${label}“ exklusiv im Prägeatelier.`;
          require("./chat").announce(io, message);
          try { require("./chronik").notiere("event", message, { user: accName }); } catch {}
        }
      } catch (e) {
        console.error("praegestaub: Ansage fehlgeschlagen —", e.message);
      }
      ack({
        ...state(k),
        boughtPiece: {
          label: cosmetics.label(offer.art, offer.cosmeticId),
          artName: cosmetics.ART_NAME[offer.art] || offer.art,
          nr: piece ? piece.nr : null,
          serie: piece ? piece.serie : null,
        },
        collections,
      });
    });
  });

  return { state };
}

module.exports = {
  setupPraegestaub, gutschreiben, balance, offers, weekNow, nextWeekAt,
  DUST_BY_TIER, FREE_DUPLICATE_DUST, OFFER_COST,
};
