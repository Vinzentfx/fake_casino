"use strict";

/**
 * Einmaliger Auszug: holt die Stadtteile von Porta Westfalica aus
 * OpenStreetMap (Overpass-API), also Ortsteilgrenzen, jedes echte Gebäude
 * (ohne Garagen und Schuppen) und Wahrzeichen (Schulen, Bahnhöfe, Parks,
 * Sportplätze), und schreibt eine kompakte Spielkarte nach game/data/porta.json.
 *
 * Von Hand starten, wenn die Karte neu soll:  node tools/fetch-porta.js
 * Das Spiel selbst fragt Overpass nie, es liest nur den Auszug.
 */

const fs = require("fs");
const path = require("path");

const OUT = process.env.OUT || path.join(__dirname, "..", "game", "data", "porta.json");
// Mehrere Overpass-Spiegel. Der Hauptserver bremst unter Last (429/504),
// deshalb wird reihum gewechselt und zwischen den Versuchen gewartet.
const APIS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Die spielbaren Stadtteile von Porta Westfalica (OSM-Relationen, admin_level 10).
// Eine Auswahl aus den 15, damit die Karte lesbar und der Auszug klein bleibt.
const DISTRICTS = [
  { id: "eisbergen",     name: "Eisbergen",     rel: 1335614 },
  { id: "hausberge",     name: "Hausberge",     rel: 1335589 },
  { id: "holzhausen",    name: "Holzhausen",    rel: 1335620 },
  { id: "kleinenbremen", name: "Kleinenbremen", rel: 1335571 },
  { id: "lerbeck",       name: "Lerbeck",       rel: 1335568 },
  { id: "nammen",        name: "Nammen",        rel: 1335655 },
  { id: "neesen",        name: "Neesen",        rel: 1335647 },
  { id: "veltheim",      name: "Veltheim",      rel: 1335577 },
];
const SELECTED_DISTRICTS = process.env.ONLY_DISTRICT
  ? DISTRICTS.filter((d) => d.id === process.env.ONLY_DISTRICT)
  : DISTRICTS;

// Gebäude, die nicht wirklich "ein Haus zum Besitzen" sind, fliegen raus.
const SKIP_BUILDING = /^(garage|garages|shed|carport|roof|hut|power|greenhouse|ruins|construction|service|container|transformer_tower)$/;

// Grobe lokale Projektion: Meter nach Osten/Norden ab der Stadtmitte.
const CENTER = { lat: 52.2436, lon: 8.9184 }; // Porta Westfalica
const M_PER_DEG_LAT = 111320;
const mPerDegLon = M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180);
const px = (lon) => Math.round((lon - CENTER.lon) * mPerDegLon);
const py = (lat) => Math.round((CENTER.lat - lat) * M_PER_DEG_LAT); // Bildschirm-y wächst nach Süden

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, tries = 8) {
  let lastStatus = "?";
  for (let i = 0; i < tries; i++) {
    const api = APIS[i % APIS.length]; // Spiegel reihum
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass lehnt Anfragen ohne aussagekräftigen User-Agent ab (406).
          "User-Agent": "fake-casino-map-snapshot/1.0 (hobby project, one-time fetch)",
          "Accept": "application/json",
        },
        body: "data=" + encodeURIComponent(query),
      });
      if (res.ok) return res.json();
      lastStatus = res.status;
    } catch (e) {
      lastStatus = e.message;
    }
    const wait = Math.min(45000, 8000 + i * 6000); // immer länger warten, höchstens 45 s
    console.log(`  … Overpass ${lastStatus} @ ${api.split("/")[2]}, warte ${Math.round(wait / 1000)}s (Versuch ${i + 1}/${tries})`);
    await sleep(wait);
  }
  throw new Error("Overpass gab dauerhaft keinen Erfolg zurück (letzter Status: " + lastStatus + ").");
}

// --- Geometrie ---

/** Die Wege einer Relation zu geschlossenen Außenringen zusammensetzen. */
function assembleRings(members) {
  const ways = members
    .filter((m) => m.type === "way" && m.role !== "inner" && Array.isArray(m.geometry))
    .map((m) => m.geometry.map((g) => [px(g.lon), py(g.lat)]));
  const rings = [];
  const key = (p) => p[0] + "," + p[1];
  while (ways.length) {
    let ring = ways.shift().slice();
    let grew = true;
    while (grew && key(ring[0]) !== key(ring[ring.length - 1])) {
      grew = false;
      for (let i = 0; i < ways.length; i++) {
        const w = ways[i];
        if (key(w[0]) === key(ring[ring.length - 1])) { ring = ring.concat(w.slice(1)); ways.splice(i, 1); grew = true; break; }
        if (key(w[w.length - 1]) === key(ring[ring.length - 1])) { ring = ring.concat(w.slice(0, -1).reverse()); ways.splice(i, 1); grew = true; break; }
        if (key(w[w.length - 1]) === key(ring[0])) { ring = w.slice(0, -1).concat(ring); ways.splice(i, 1); grew = true; break; }
        if (key(w[0]) === key(ring[0])) { ring = w.slice(1).reverse().concat(ring); ways.splice(i, 1); grew = true; break; }
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  rings.sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
  return rings;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Douglas-Peucker-Vereinfachung (Toleranz in Metern). */
function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const sqTol = tol * tol;
  const sqSegDist = (p, a, b) => {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx || dy) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(pts[i], pts[first], pts[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sqTol && idx > 0) { keep[idx] = true; stack.push([first, idx], [idx, last]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const centroid = (pts) => {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [Math.round(x / pts.length), Math.round(y / pts.length)];
};

// --- Gebäude einordnen ---
/** OSM-Tags auf eine Spielklasse abbilden (bestimmt den Preis). */
function classify(tags, pois) {
  const b = tags.building || "yes";
  if (b === "hotel" || pois.hotel) return "hotel";
  if (/^(industrial|warehouse|factory|manufacture)$/.test(b)) return "factory";
  if (pois.cafe) return "cafe";
  if (pois.kiosk) return "kiosk";
  if (/^(retail|supermarket|commercial|office|kiosk)$/.test(b) || pois.shop) return "shop";
  if (/^(church|chapel|civic|public|government|fire_station|hospital|school|kindergarten|university)$/.test(b)) return "civic";
  return "residential";
}

// --- Hauptteil ---
(async () => {
  console.log("→ Hole Stadtteil-Grenzen …");
  const relIds = SELECTED_DISTRICTS.map((d) => d.rel).join(",");
  const bounds = await overpass(`[out:json][timeout:120];rel(id:${relIds});out geom;`);
  const ringByRel = {};
  for (const el of bounds.elements) {
    if (el.type !== "relation") continue;
    const rings = assembleRings(el.members || []);
    if (rings.length) ringByRel[el.id] = simplify(rings[0], 25);
  }

  const out = { city: "Porta Westfalica", center: CENTER, districts: [] };

  for (const d of SELECTED_DISTRICTS) {
    console.log(`→ ${d.name}: Gebäude + Landmarks …`);
    const area = 3600000000 + d.rel;
    const q = `[out:json][timeout:180];
area(${area})->.d;
( way(area.d)["building"]["building"!~"${SKIP_BUILDING.source.slice(2, -2)}"]; )->.b;
( node(area.d)["amenity"~"^(cafe|restaurant|fast_food|bank|pharmacy|kiosk)$"];
  node(area.d)["shop"];
  node(area.d)["tourism"="hotel"];
  node(area.d)["railway"~"^(station|halt)$"];
)->.p;
( way(area.d)["amenity"="school"];
  way(area.d)["leisure"~"^(park|stadium|sports_centre|pitch|playground)$"];
)->.l;
( way(area.d)["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|service)$"]; )->.r;
.b out geom qt; .p out qt; .l out geom qt; .r out geom qt;`;
    const data = await overpass(q);
    const els = data.elements || [];

    // Einzelne Punkte (POIs), um das Gebäude einzuordnen, in oder an dem sie liegen.
    const poiNodes = [];
    const landmarks = [];
    for (const el of els) {
      if (el.type !== "node" || !el.tags) continue;
      const t = el.tags;
      const X = px(el.lon), Y = py(el.lat);
      if (t.railway === "station" || t.railway === "halt")
        landmarks.push({ type: "station", name: t.name || "Bahnhof", x: X, y: Y });
      else if (t.amenity === "cafe" || t.amenity === "restaurant" || t.amenity === "fast_food")
        poiNodes.push({ x: X, y: Y, kind: "cafe" });
      else if (t.tourism === "hotel") poiNodes.push({ x: X, y: Y, kind: "hotel" });
      else if (t.shop === "kiosk" || t.shop === "convenience" || t.amenity === "kiosk")
        poiNodes.push({ x: X, y: Y, kind: "kiosk" });
      else if (t.shop || t.amenity === "pharmacy") poiNodes.push({ x: X, y: Y, kind: "shop" });
      else if (t.amenity === "bank") poiNodes.push({ x: X, y: Y, kind: "bank" });
    }

    const buildings = [];
    const roads = [];
    for (const el of els) {
      if (el.type !== "way" || !el.geometry) continue;
      const t = el.tags || {};
      // Straßen: Linienzug, Klasse (bestimmt die Strichstärke) und Name (fürs Infofeld).
      if (t.highway) {
        let pts = el.geometry.map((g) => [px(g.lon), py(g.lat)]);
        pts = simplify(pts, 3);
        if (pts.length < 2) continue;
        const major = /^(motorway|trunk|primary|secondary)$/.test(t.highway) ? 2
          : /^(tertiary|residential|unclassified|living_street|pedestrian)$/.test(t.highway) ? 1 : 0; // 0 = Zufahrt
        roads.push({ pts, w: major, n: t.name || null });
        continue;
      }
      // Wahrzeichen-Flächen (Schulen, Parks, Sport), getrennt geführt und nicht kaufbar.
      if (!t.building) {
        const pts = el.geometry.map((g) => [px(g.lon), py(g.lat)]);
        const [cx, cy] = centroid(pts);
        const kind = t.amenity === "school" ? "school"
          : t.leisure === "park" ? "park"
          : /^(stadium|sports_centre|pitch)$/.test(t.leisure || "") ? "sport"
          : "park";
        landmarks.push({ type: kind, name: t.name || null, x: cx, y: cy, pts: simplify(pts, 8) });
        continue;
      }
      let pts = el.geometry.map((g) => [px(g.lon), py(g.lat)]);
      if (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
      pts = simplify(pts, 1.2);
      if (pts.length < 3) continue;
      const areaM2 = Math.abs(polyArea(pts));
      if (areaM2 < 25) continue; // Kleinkram ignorieren
      const [cx, cy] = centroid(pts);
      const near = { hotel: 0, cafe: 0, kiosk: 0, shop: 0, bank: 0 };
      for (const p of poiNodes) {
        if (Math.abs(p.x - cx) < 30 && Math.abs(p.y - cy) < 30) near[p.kind] = 1;
      }
      buildings.push({
        id: el.id,
        pts,
        c: [cx, cy],
        a: Math.round(areaM2),
        cls: classify(t, near),
        bank: near.bank ? 1 : 0,
        n: t["addr:street"] ? `${t["addr:street"]} ${t["addr:housenumber"] || ""}`.trim() : null,
        t: t.building && t.building !== "yes" ? t.building : null, // ursprünglicher OSM-Typ fürs Infofeld
        nm: t.name || null,                                        // z. B. Namen von Läden oder Kirchen
        lv: t["building:levels"] ? parseFloat(t["building:levels"]) || null : null,
      });
    }

    // Gebäude ohne Adresse leihen sich die nächste benannte Straße (≤80 m),
    // damit im Infofeld trotzdem steht, wo das Haus ist.
    const namedPts = [];
    for (const r of roads) if (r.n) for (const p of r.pts) namedPts.push([p[0], p[1], r.n]);
    for (const b of buildings) {
      if (b.n) continue;
      let best = null, bd = 80 * 80;
      for (const [x, y, n] of namedPts) {
        const dx = x - b.c[0], dy = y - b.c[1], dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = n; }
      }
      if (best) b.n = best;
    }

    out.districts.push({
      id: d.id, name: d.name,
      ring: ringByRel[d.rel] || [],
      buildings,
      landmarks,
      roads,
    });
    console.log(`   ${buildings.length} Gebäude, ${landmarks.length} Landmarks, ${roads.length} Straßen`);
    await sleep(6000); // Overpass nicht überlasten (die Spiegel bremsen sonst)
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
  console.log(`✓ geschrieben: ${OUT} (${mb} MB)`);
})();
