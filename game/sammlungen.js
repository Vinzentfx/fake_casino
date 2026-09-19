"use strict";

/**
 * Kollektionen: der Grund, überhaupt zu handeln.
 *
 * Kisten geben zufällig. Wer etwas ganz Bestimmtes will, muss auf den Markt,
 * und dort muss jemand es hergeben wollen. Genau dafür braucht es einen
 * Grund, und "mir fehlt noch eins" ist der stärkste, den es gibt.
 *
 * Eine Kollektion ist eine benannte Handvoll Stücke, die thematisch
 * zusammengehören. Wer alle davon besitzt, bekommt ein Stück, das es auf
 * keinem anderen Weg gibt: nicht aus Kisten, nicht auf dem Markt, nicht vom
 * Haus. Man kann es sich nicht kaufen, man muss die Sammlung wirklich
 * zusammenbekommen.
 *
 * Bewusst quer durch den Katalog und quer durch die Seltenheiten. Eine
 * Kollektion aus lauter gewöhnlichen Stücken hätte man an einem Abend, eine
 * aus lauter mythischen nie. Jede hier mischt beides, und in jeder steckt
 * mindestens ein Stück, das man mit Glück allein kaum bekommt.
 *
 * Das Belohnungsstück ist NICHT handelbar. Ein Markt dafür wäre die Abkürzung
 * um genau das herum, wofür es da ist.
 */

const KOLLEKTIONEN = [
  {
    id: "porta",
    label: "Porta",
    text: "Alles, was nach dem Haus und der Stadt klingt.",
    stuecke: [
      ["title", "stammgast"], ["banner", "filz"], ["spruch", "haus"],
      ["title", "hausherr"], ["banner", "welle"], ["title", "legende"],
    ],
    belohnung: ["schild", "sml_wesergold"],
  },
  {
    id: "mitternacht",
    label: "Mitternacht",
    text: "Das Dunkle. Die schwerste der drei, hier stecken zwei mythische Stücke drin.",
    stuecke: [
      ["title", "nachtschicht"], ["avatar", "alien"], ["banner", "nacht"],
      ["schild", "neon"], ["style", "glitch"], ["style", "vanta"],
    ],
    belohnung: ["aura", "sml_nachtschwarm"],
  },
  {
    id: "feuer",
    label: "Feuer",
    text: "Alles, was brennt, glüht oder knallt.",
    stuecke: [
      ["avatar", "dragon"], ["banner", "sonne"], ["spruch", "warnung"],
      ["effect", "feuerwerk"], ["frame", "flamme"], ["style", "feuer"],
    ],
    belohnung: ["style", "sml_glutkern"],
  },
];

const nachId = Object.fromEntries(KOLLEKTIONEN.map((k) => [k.id, k]));

/** Verhindert, dass das Vergeben einer Belohnung wieder eine Prüfung auslöst. */
let laeuft = false;

/**
 * Wie weit `acc` in jeder Kollektion ist.
 *
 * `hat(art, id)` kommt von aussen, damit dieses Modul nichts über das Format
 * von `cosOwned` wissen muss.
 */
function fortschritt(acc, hat) {
  return KOLLEKTIONEN.map((k) => {
    const teile = k.stuecke.map(([art, id]) => ({ art, id, hat: hat(acc, art, id) }));
    const voll = teile.filter((t) => t.hat).length;
    const [bArt, bId] = k.belohnung;
    return {
      id: k.id, label: k.label, text: k.text,
      teile, voll, gesamt: teile.length,
      komplett: voll === teile.length,
      belohnung: { art: bArt, id: bId, hat: hat(acc, bArt, bId) },
    };
  });
}

/**
 * Nachsehen, ob eine Kollektion gerade voll geworden ist, und die Belohnung
 * vergeben. Gibt die neu vergebenen Belohnungen zurück.
 *
 * Wird nach jedem Zuwachs gerufen, also aus cosmetics.grant heraus. Der
 * Wächter oben verhindert, dass das Vergeben der Belohnung sich selbst
 * wieder aufruft.
 */
function pruefe(acc, key, hat, gib) {
  if (laeuft || !acc) return [];
  laeuft = true;
  const neu = [];
  try {
    for (const k of KOLLEKTIONEN) {
      const [bArt, bId] = k.belohnung;
      if (hat(acc, bArt, bId)) continue;
      if (!k.stuecke.every(([art, id]) => hat(acc, art, id))) continue;
      if (gib(acc, bArt, bId, key)) neu.push({ kollektion: k.label, art: bArt, id: bId });
    }
  } finally {
    laeuft = false;
  }
  return neu;
}

/** Zu welchen Kollektionen ein Stück gehört. Für die Anzeige am Stück selbst. */
function gehoertZu(art, id) {
  return KOLLEKTIONEN.filter((k) => k.stuecke.some(([a, i]) => a === art && i === id)).map((k) => k.label);
}

/** Ist das ein Belohnungsstück? Die sind nicht handelbar. */
const istBelohnung = (art, id) => KOLLEKTIONEN.some((k) => k.belohnung[0] === art && k.belohnung[1] === id);

module.exports = { KOLLEKTIONEN, nachId, fortschritt, pruefe, gehoertZu, istBelohnung };
