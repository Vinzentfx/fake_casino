"use strict";

/* Spickzettel
   Zeigt CHEATSHEET.md im Casino an. Der Text kommt von /api/spickzettel, der
   Renderer kann genau das, was in der Datei vorkommt: Ueberschriften,
   Tabellen, Listen, fett, Code und Sprungmarken. */
(function () {
  const $ = (s) => document.querySelector(s);
  let geladen = false;

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /** Gleiche Regel wie bei den Links im Inhaltsverzeichnis. */
  const marke = (text) => text.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").trim().replace(/\s+/g, "-");

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, ziel) =>
        `<a href="${esc(ziel)}"${ziel.startsWith("#") ? "" : ' target="_blank" rel="noopener"'}>${text}</a>`);
  }

  const zelle = (zeile) => zeile.replace(/^\||\|$/g, "").split("|").map((z) => z.trim());

  function baue(md) {
    const zeilen = md.split("\n");
    const out = [];
    let liste = null, absatz = [], titelWeg = false;

    const absatzZu = () => {
      if (absatz.length) out.push(`<p>${inline(absatz.join(" "))}</p>`);
      absatz = [];
    };
    const listeZu = () => {
      if (liste) out.push(`</${liste}>`);
      liste = null;
    };

    for (let i = 0; i < zeilen.length; i++) {
      const z = zeilen[i];
      const roh = z.trim();

      if (!roh) { absatzZu(); listeZu(); continue; }

      const h = /^(#{1,3})\s+(.*)$/.exec(roh);
      if (h) {
        absatzZu(); listeZu();
        // Die Ueberschrift der Datei faellt weg, der Screen traegt sie schon.
        if (h[1].length === 1 && !titelWeg) { titelWeg = true; continue; }
        const stufe = Math.max(2, Math.min(3, h[1].length));
        out.push(`<h${stufe} id="${esc(marke(h[2]))}">${inline(h[2])}</h${stufe}>`);
        continue;
      }

      // Tabelle: Kopfzeile, Trennzeile, dann Inhalt bis zur ersten leeren Zeile.
      if (roh.startsWith("|") && /^\|[\s:-]+\|/.test((zeilen[i + 1] || "").trim())) {
        absatzZu(); listeZu();
        const kopf = zelle(roh);
        const reihen = [];
        i += 2;
        while (i < zeilen.length && zeilen[i].trim().startsWith("|")) reihen.push(zelle(zeilen[i++].trim()));
        i -= 1;
        out.push('<div class="spick-tabelle"><table><thead><tr>'
          + kopf.map((k) => `<th>${inline(k)}</th>`).join("")
          + "</tr></thead><tbody>"
          + reihen.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")
          + "</tbody></table></div>");
        continue;
      }

      const punkt = /^[*-]\s+(.*)$/.exec(roh);
      const nummer = /^\d+\.\s+(.*)$/.exec(roh);
      if (punkt || nummer) {
        absatzZu();
        const art = punkt ? "ul" : "ol";
        if (liste !== art) { listeZu(); out.push(`<${art}>`); liste = art; }
        out.push(`<li>${inline((punkt || nummer)[1])}</li>`);
        continue;
      }

      // Fortsetzung einer Aufzaehlung oder eines Absatzes.
      if (liste && /^\s{2,}/.test(z)) { out.push(out.pop().replace(/<\/li>$/, ` ${inline(roh)}</li>`)); continue; }
      absatz.push(roh);
    }
    absatzZu(); listeZu();
    return out.join("\n");
  }

  async function lade() {
    const ziel = $("#spick-inhalt");
    if (!ziel || geladen) return;
    try {
      const res = await fetch("/api/spickzettel", { cache: "no-cache" });
      if (!res.ok) throw new Error("nicht erreichbar");
      ziel.innerHTML = baue(await res.text());
      geladen = true;
    } catch {
      ziel.innerHTML = '<p class="muted small">Der Spickzettel ist gerade nicht zu erreichen.</p>';
    }
  }

  /* Sprungmarken selbst behandeln: die Adresszeile fuehrt sonst der Router,
     und aus #stadt wuerde ein Screenwechsel. */
  $("#spick-inhalt")?.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.Casino.screens.register("spickzettel", { onEnter: lade });
  if (window.Casino.screens.current() === "spickzettel") lade();
})();
