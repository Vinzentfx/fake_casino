"use strict";

/**
 * One-time data snapshot: pulls Porta Westfalica's 15 Stadtteile from
 * OpenStreetMap (Overpass API) — district boundaries, every real building
 * (garages/sheds filtered out), and landmarks (schools, stations, parks,
 * sports grounds) — and writes a compact game map to game/data/porta.json.
 *
 * Run manually when the map should be refreshed:  node tools/fetch-porta.js
 * The game itself never talks to Overpass; it only reads the snapshot.
 */

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "game", "data", "porta.json");
const API = "https://overpass-api.de/api/interpreter";

// The playable Stadtteile of Porta Westfalica (OSM relation ids, admin_level 10).
// Deliberately only 5 of the 15 — keeps the map focused and the snapshot small.
const DISTRICTS = [
  { id: "eisbergen",     name: "Eisbergen",     rel: 1335614 },
  { id: "hausberge",     name: "Hausberge",     rel: 1335589 },
  { id: "kleinenbremen", name: "Kleinenbremen", rel: 1335571 },
  { id: "lerbeck",       name: "Lerbeck",       rel: 1335568 },
  { id: "nammen",        name: "Nammen",        rel: 1335655 },
];

// Buildings that are not really "a house you could own": filtered out.
const SKIP_BUILDING = /^(garage|garages|shed|carport|roof|hut|power|greenhouse|ruins|construction|service|container|transformer_tower)$/;

// Rough local projection: meters east/north of the city centre.
const CENTER = { lat: 52.2436, lon: 8.9184 }; // Porta Westfalica
const M_PER_DEG_LAT = 111320;
const mPerDegLon = M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180);
const px = (lon) => Math.round((lon - CENTER.lon) * mPerDegLon);
const py = (lat) => Math.round((CENTER.lat - lat) * M_PER_DEG_LAT); // screen-y grows south

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Overpass rejects requests without a descriptive UA (406).
        "User-Agent": "fake-casino-map-snapshot/1.0 (hobby project, one-time fetch)",
        "Accept": "application/json",
      },
      body: "data=" + encodeURIComponent(query),
    });
    if (res.ok) return res.json();
    console.log(`  … Overpass ${res.status}, warte 20s (Versuch ${i + 1}/${tries})`);
    await sleep(20000);
  }
  throw new Error("Overpass gab dauerhaft keinen Erfolg zurück.");
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

/** Stitch a relation's member ways into closed outer rings. */
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

/** Douglas-Peucker simplification (tolerance in meters). */
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

// ─── Building classification ────────────────────────────────────────────────
/** Map OSM tags → game class (drives price + buff). */
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

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("→ Hole Stadtteil-Grenzen …");
  const relIds = DISTRICTS.map((d) => d.rel).join(",");
  const bounds = await overpass(`[out:json][timeout:120];rel(id:${relIds});out geom;`);
  const ringByRel = {};
  for (const el of bounds.elements) {
    if (el.type !== "relation") continue;
    const rings = assembleRings(el.members || []);
    if (rings.length) ringByRel[el.id] = simplify(rings[0], 25);
  }

  const out = { city: "Porta Westfalica", center: CENTER, districts: [] };

  for (const d of DISTRICTS) {
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

    // POI nodes → for classifying the building they sit in/near.
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
      // Streets: polyline + class (drives stroke width) + name (for the info panel).
      if (t.highway) {
        let pts = el.geometry.map((g) => [px(g.lon), py(g.lat)]);
        pts = simplify(pts, 3);
        if (pts.length < 2) continue;
        const major = /^(motorway|trunk|primary|secondary)$/.test(t.highway) ? 2
          : /^(tertiary|residential|unclassified|living_street|pedestrian)$/.test(t.highway) ? 1 : 0; // 0 = service
        roads.push({ pts, w: major, n: t.name || null });
        continue;
      }
      // Landmark grounds (schools, parks, sports) — kept separate, not buyable.
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
      if (areaM2 < 25) continue; // ignore mini-structures
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
        t: t.building && t.building !== "yes" ? t.building : null, // original OSM type for the info panel
        nm: t.name || null,                                        // e.g. shop/church names
        lv: t["building:levels"] ? parseFloat(t["building:levels"]) || null : null,
      });
    }

    // Buildings without an address: borrow the nearest named street (≤80 m)
    // so the info panel can still say where the house stands.
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
    await sleep(3000); // be polite to Overpass
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
  console.log(`✓ geschrieben: ${OUT} (${mb} MB)`);
})();
