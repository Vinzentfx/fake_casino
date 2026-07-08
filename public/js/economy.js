"use strict";

/* ============================================================
   Fake Casino – Economy client
   • Work: a capped clicker (starter aid only).
   • Stadt: ECHTE Karte von Porta Westfalica — Territorium & Status.
     Übersicht (Stadtteile mit Boss & Index) → Ortsteil (echte
     Häuser + Straßen). Besitz malt die Karte in deiner Farbe:
     Straßen-Monopole, Stadtteil-Boss, Trophäen-Gebäude,
     Ortsteil-Spekulation, Wohnsitz. Server ist autoritativ.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const idxStr = (i) => String(i).replace(".", ",");

  // ── Work (capped clicker) ────────────────────────────────────────────────
  function applyWorkState(s) {
    if (!s || !s.ok) return;
    const power = s.clickPower * (s.schulleiter ? 3 : 1);
    $("#clicker-power").textContent = power;
    $("#work-power").textContent = power + " 🪙" + (s.schulleiter ? " (🏫 Schulleiter ×3)" : "");
    renderHustle(s.hustle);
    const btn = $("#work-upgrade-btn");
    const costEl = $("#work-upgrade-cost");
    if (s.maxed) {
      costEl.textContent = "max. ausgebaut";
      btn.disabled = true;
      btn.textContent = "✓ Voll ausgebaut";
    } else {
      costEl.textContent = fmt(s.upgradeCost) + " 🪙";
      btn.disabled = false;
      btn.textContent = "⬆️ Upgrade kaufen";
    }
  }

  function renderHustle(h) {
    const box = $("#work-hustle");
    if (!box || !h) return;
    const pct = h.target ? Math.min(100, Math.round((100 * (h.clicks || 0)) / h.target)) : 0;
    box.innerHTML = `
      <div class="stat-row"><span>Hustle-Bonus</span><b>${fmt(h.clicks || 0)}/${fmt(h.target || 25)}</b></div>
      <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      <p class="muted small" style="margin:.35rem 0 0">Bonus-Cap: ${fmt(h.hourEarned || 0)}/${fmt(h.hourCap || 0)} 🪙 pro Stunde · ${fmt(h.dayEarned || 0)}/${fmt(h.dayCap || 0)} 🪙 heute</p>`;
  }

  function loadWork() {
    socket.emit("economy:state", applyWorkState);
  }

  $("#clicker-btn").addEventListener("click", () => {
    socket.emit("work:click", (res) => {
      if (!res || !res.ok) return;
      applyAccount(res.account);
      if (res.hustle) renderHustle(res.hustle);
      flyFromClicker("+" + res.earned + (res.hustleBonus ? " Hustle!" : ""));
    });
  });

  $("#work-upgrade-btn").addEventListener("click", () => {
    const err = $("#work-error");
    err.textContent = "";
    socket.emit("work:upgrade", (res) => {
      if (!res || !res.ok) { err.textContent = (res && res.error) || "Fehler."; return; }
      applyAccount(res.account);
      loadWork();
      toast(`Klick-Stärke: +${res.clickPower} 🪙`);
    });
  });

  function flyFromClicker(text) {
    const btn = $("#clicker-btn");
    if (!btn) return;
    const b = btn.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "click-float";
    el.textContent = text + " 🪙";
    el.style.left = b.left + b.width / 2 + (Math.random() - 0.5) * 40 + "px";
    el.style.top = b.top + "px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  // ── City state ───────────────────────────────────────────────────────────
  let view = "overview";
  let overview = null;
  let district = null;
  let selectedId = null;
  let vb = null, fitVb = null;

  const CLS_FILL = {
    residential: "#3e5748", civic: "#4a4f6e", kiosk: "#5e5636", cafe: "#5d4a33",
    shop: "#33565e", hotel: "#59335e", factory: "#5a4a3a", casino: "#5a2a6e", bank: "#6e5a2a",
  };
  const LM_EMOJI = { school: "🏫", station: "🚉", park: "🏞️", sport: "🏟️" };

  function loadCity() {
    socket.emit("city:state", (res) => {
      if (!res || !res.ok) return;
      overview = res.overview;
      renderEmpire(overview.me);
      if (view === "district" && district) return loadDistrict(district.id, true);
      view = "overview";
      renderOverview();
      renderDetail();
    });
  }

  function loadDistrict(id, keepView) {
    socket.emit("city:district", { id }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Stadtteil nicht ladbar."); return; }
      district = res.district;
      view = "district";
      if (!keepView) { selectedId = null; vb = null; }
      renderDistrict();
      renderDetail();
    });
  }

  // ── "Dein Imperium" panel ────────────────────────────────────────────────
  function renderEmpire(me) {
    const box = $("#biz-buffs");
    if (!box) return;
    if (!me || !me.houses) {
      box.innerHTML = `<p class="muted small" style="margin:0;text-align:center">Noch kein Besitz. Kauf dein erstes Haus — komplette Straßen färben die Karte in deiner Farbe!</p>`;
      return;
    }
    const chips = [];
    chips.push(`<span class="buff-chip" style="border-color:${me.color};color:${me.color}">🏠 ${me.houses} ${me.houses === 1 ? "Haus" : "Häuser"}</span>`);
    chips.push(`<span class="buff-chip">💎 ${fmt(me.value)} 🪙 Wert</span>`);
    if (me.streets) chips.push(`<span class="buff-chip">👑 ${me.streets} ${me.streets === 1 ? "Straße" : "Straßen"} komplett</span>`);
    if (me.hasGolden) chips.push(`<span class="buff-chip" style="border-color:#ffd700;color:#ffd700">✨ Goldene Straße (2× Tribut)</span>`);
    for (const s of me.sets || []) chips.push(`<span class="buff-chip">${s.emoji} ${escapeHtml(s.label)} (+${s.tribute.toLocaleString("de-DE")}/Std)</span>`);
    for (const t of me.trophies) chips.push(`<span class="buff-chip">${t.emoji} ${escapeHtml(t.title)}</span>`);
    for (const d of me.bossOf) chips.push(`<span class="buff-chip">🥇 Boss von ${escapeHtml(d)}</span>`);
    // "Meine Immobilien" — tap to jump to the building on the map.
    let list = `<details class="empire-list"><summary>📋 Meine Immobilien (${me.houses})</summary><div class="empire-items">`;
    for (const p of me.properties || []) {
      list += `<button class="empire-item" data-goto-d="${p.did}" data-goto-b="${p.id}">${p.emoji} ${escapeHtml(p.label)}<small>${escapeHtml(p.districtName)} · ${fmt(p.price)} 🪙</small></button>`;
    }
    list += `</div></details>`;
    box.innerHTML = chips.join("") + list;
  }

  // Jump from the property list straight to the building on the map.
  $("#biz-buffs").addEventListener("click", (e) => {
    const item = e.target.closest(".empire-item");
    if (!item) return;
    const did = item.dataset.gotoD, bid = parseInt(item.dataset.gotoB, 10);
    socket.emit("city:district", { id: did }, (res) => {
      if (!res || !res.ok) return;
      district = res.district;
      view = "district";
      selectedId = bid;
      const b = district.buildings.find((x) => x.id === bid);
      vb = b ? { x: b.c[0] - 200, y: b.c[1] - 150, w: 400, h: 300 } : null;
      renderDistrict();
      renderDetail();
      document.querySelector(".city-map-box").scrollIntoView({ behavior: "smooth" });
    });
  });

  // ── Geometry helpers ─────────────────────────────────────────────────────
  const pathOf = (pts) => "M" + pts.map((p) => p[0] + " " + p[1]).join("L") + "Z";
  const openPath = (pts) => "M" + pts.map((p) => p[0] + " " + p[1]).join("L");
  function bboxOf(ptsList) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const pts of ptsList) for (const [x, y] of pts) {
      if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y;
    }
    return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
  }
  const ringCentroid = (pts) => {
    let x = 0, y = 0;
    for (const p of pts) { x += p[0]; y += p[1]; }
    return [x / pts.length, y / pts.length];
  };
  const setViewBox = () => { if (vb) $("#city-map").setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); };

  // ── Overview: all districts ──────────────────────────────────────────────
  function renderOverview() {
    const svg = $("#city-map");
    if (!svg || !overview) return;
    $("#city-back").classList.add("hidden");
    $("#city-zoom").classList.add("hidden");
    $("#city-title").textContent = overview.city;
    $("#city-subtitle").innerHTML = `Erobere die echte Stadt: Häuser kaufen, Straßen-Monopole sichern, Stadtteil-Boss werden. Chips kommen aus dem Casino — hier zeigst du sie her.`;
    const lp = $("#land-price");
    if (lp) {
      lp.innerHTML = (overview.casinoOwnerName ? `🎰 ${escapeHtml(overview.casinoOwnerName)}` : "🎰 frei")
        + (overview.bankOwnerName ? ` · 🏦 ${escapeHtml(overview.bankOwnerName)}` : " · 🏦 frei");
    }

    const rings = overview.districts.filter((d) => d.ring && d.ring.length > 2);
    const bb = bboxOf(rings.map((d) => d.ring));
    const pad = Math.max(bb.w, bb.h) * 0.03;
    svg.setAttribute("viewBox", `${bb.x1 - pad} ${bb.y1 - pad} ${bb.w + 2 * pad} ${bb.h + 2 * pad}`);

    const fs = Math.max(bb.w, bb.h) / 42;
    const parts = [];
    for (const d of rings) {
      const fill = d.mine > 0 ? "#3d5a3f" : "#33463a";
      const stroke = d.boss ? d.boss.color : "rgba(255,255,255,0.35)";
      parts.push(`<g class="dist" data-d="${d.id}" style="cursor:pointer">`);
      parts.push(`<path d="${pathOf(d.ring)}" fill="${fill}" stroke="${stroke}" stroke-width="${d.boss ? fs / 5 : fs / 8}" />`);
      const [cx, cy] = ringCentroid(d.ring);
      const marks = (d.hasCasino ? "🎰" : "") + (d.hasBank ? "🏦" : "");
      const trendPct = Math.round((d.idx - 1) * 100);
      const trend = `${d.idx >= 1 ? "📈" : "📉"} ${trendPct >= 0 ? "+" : ""}${trendPct}%`;
      parts.push(`<text x="${cx}" y="${cy - fs * 0.9}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="#fff" stroke="#20291f" stroke-width="${fs / 9}" paint-order="stroke">${escapeHtml(d.name)}${marks ? " " + marks : ""}</text>`);
      parts.push(`<text x="${cx}" y="${cy + fs * 0.3}" text-anchor="middle" font-size="${fs * 0.62}" fill="rgba(255,255,255,0.85)" stroke="#20291f" stroke-width="${fs / 12}" paint-order="stroke">${d.total} Häuser · ${trend}${d.monos ? ` · ${d.monos}👑` : ""}</text>`);
      if (d.boss)
        parts.push(`<text x="${cx}" y="${cy + fs * 1.4}" text-anchor="middle" font-size="${fs * 0.68}" font-weight="800" fill="${d.boss.color}" stroke="#20291f" stroke-width="${fs / 12}" paint-order="stroke">🥇 ${escapeHtml(d.boss.name)}${d.boss.isMe ? " (Du)" : ""}</text>`);
      parts.push(`</g>`);
    }
    svg.innerHTML = parts.join("");
  }

  // ── District: real buildings, streets, territory colours ────────────────
  function renderDistrict() {
    const svg = $("#city-map");
    if (!svg || !district) return;
    $("#city-back").classList.remove("hidden");
    $("#city-zoom").classList.remove("hidden");
    $("#city-title").textContent = district.name;
    const mine = district.buildings.filter((b) => b.mine).length;
    const monoStr = district.monopolies.length
      ? ` · 👑 ${district.monopolies.map((m) => escapeHtml(m.st)).slice(0, 3).join(", ")}${district.monopolies.length > 3 ? "…" : ""}`
      : "";
    $("#city-subtitle").innerHTML = `${district.buildings.length} echte Häuser${mine ? ` — <b>${mine}</b> deins` : ""}${monoStr}`;
    const lp = $("#land-price");
    if (lp) {
      const pct = Math.round((district.idx - 1) * 100);
      lp.innerHTML = `${district.idx >= 1 ? "📈" : "📉"} ${escapeHtml(district.name)}-Index <b>${idxStr(district.idx)}</b> (${pct >= 0 ? "+" : ""}${pct}% zum Normalpreis)`
        + (district.boss ? ` · 🥇 <b style="color:${district.boss.color}">${escapeHtml(district.boss.name)}</b>` : "");
    }

    const bb = bboxOf([district.ring.length > 2 ? district.ring : district.buildings.flatMap((b) => b.pts)]);
    const pad = Math.max(bb.w, bb.h) * 0.04;
    fitVb = { x: bb.x1 - pad, y: bb.y1 - pad, w: bb.w + 2 * pad, h: bb.h + 2 * pad };
    if (!vb) vb = { ...fitVb };
    setViewBox();

    // Street name → monopoly (colours the whole street).
    const monoBySt = {};
    for (const m of district.monopolies) monoBySt[m.st] = m;

    const parts = [];
    if (district.ring.length > 2)
      parts.push(`<path d="${pathOf(district.ring)}" fill="#2c3a30" stroke="#d9c463" stroke-width="${fitVb.w / 260}" stroke-dasharray="${fitVb.w / 60} ${fitVb.w / 90}" opacity="0.9"/>`);

    for (const l of district.landmarks) {
      if (l.pts && l.pts.length > 2)
        parts.push(`<path d="${pathOf(l.pts)}" fill="${l.type === "park" ? "#31513a" : "#33494f"}" opacity="0.8"/>`);
    }

    // Streets: monopolised streets glow in the owner's colour; the weekly
    // GOLDEN street shimmers gold underneath everything. 👑✨
    const monoLabelAt = {}; // st -> longest road midpoint for the label
    let goldenLabelAt = null;
    for (const r of district.roads || []) {
      const mono = r.n && monoBySt[r.n];
      const isGolden = r.n && district.golden === r.n;
      const w = r.w === 2 ? 9 : r.w === 1 ? 5.5 : 2.5;
      const col = mono ? mono.color : r.w === 2 ? "#565b63" : r.w === 1 ? "#4a4f56" : "#42464c";
      if (isGolden)
        parts.push(`<path d="${openPath(r.pts)}" fill="none" stroke="#ffd700" stroke-width="${w + 6}" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" style="pointer-events:none"/>`);
      parts.push(`<path d="${openPath(r.pts)}" fill="none" stroke="${col}" stroke-width="${mono ? w + 2 : w}" stroke-linecap="round" stroke-linejoin="round" ${mono ? 'opacity="0.95"' : ""} style="pointer-events:none"/>`);
      if (!mono && r.w >= 1)
        parts.push(`<path d="${openPath(r.pts)}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="${w * 0.22}" stroke-dasharray="${w * 2.2} ${w * 2.6}" stroke-linecap="round" style="pointer-events:none"/>`);
      if (mono) {
        const cur = monoLabelAt[r.n];
        if (!cur || r.pts.length > cur.len) monoLabelAt[r.n] = { len: r.pts.length, p: r.pts[Math.floor(r.pts.length / 2)] };
      }
      if (isGolden && (!goldenLabelAt || r.pts.length > goldenLabelAt.len))
        goldenLabelAt = { len: r.pts.length, p: r.pts[Math.floor(r.pts.length / 2)] };
    }

    // Buildings: territory painting — owned houses fill in the owner's colour.
    for (const b of district.buildings) {
      const sel = b.id === selectedId;
      let fill = CLS_FILL[b.cls] || "#3e5748";
      let stroke = "rgba(0,0,0,0.35)", sw = 0.4;
      if (b.owner) { fill = b.color; stroke = b.mine ? "#f4d782" : "rgba(0,0,0,0.5)"; sw = b.mine ? 1.6 : 0.7; }
      if (sel) { stroke = "#7ec8ff"; sw = 2.4; }
      const special = b.cls === "casino" || b.cls === "bank" || b.trophy;
      parts.push(`<path class="bld" data-b="${b.id}" d="${pathOf(b.pts)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${special ? 'filter="url(#glow)"' : ""} style="cursor:pointer"/>`);
      if (b.cls === "casino" || b.cls === "bank")
        parts.push(`<text x="${b.c[0]}" y="${b.c[1]}" text-anchor="middle" dominant-baseline="central" font-size="${Math.max(14, Math.sqrt(b.a))}" style="pointer-events:none">${b.cls === "casino" ? "🎰" : "🏦"}</text>`);
      else if (b.trophy)
        parts.push(`<text x="${b.c[0]}" y="${b.c[1]}" text-anchor="middle" dominant-baseline="central" font-size="${Math.max(11, Math.sqrt(b.a) * 0.9)}" style="pointer-events:none">${district.trophies[b.trophy].emoji}</text>`);
    }

    for (const l of district.landmarks) {
      parts.push(`<text x="${l.x}" y="${l.y}" text-anchor="middle" dominant-baseline="central" font-size="26" opacity="0.95" style="pointer-events:none">${LM_EMOJI[l.type] || "📍"}</text>`);
    }

    // Monopoly street labels on top.
    for (const [st, info] of Object.entries(monoLabelAt)) {
      const m = monoBySt[st];
      parts.push(`<text x="${info.p[0]}" y="${info.p[1] - 8}" text-anchor="middle" font-size="13" font-weight="800" fill="${m.color}" stroke="#1c231b" stroke-width="2.5" paint-order="stroke" style="pointer-events:none">👑 ${escapeHtml(m.ownerName)}s ${escapeHtml(st)}</text>`);
    }
    if (goldenLabelAt && district.golden)
      parts.push(`<text x="${goldenLabelAt.p[0]}" y="${goldenLabelAt.p[1] + 18}" text-anchor="middle" font-size="13" font-weight="800" fill="#ffd700" stroke="#1c231b" stroke-width="2.5" paint-order="stroke" style="pointer-events:none">✨ Goldene Straße: ${escapeHtml(district.golden)} (2× Tribut)</text>`);

    svg.innerHTML = `<defs><filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#f4d782" flood-opacity="0.85"/></filter></defs>` + parts.join("");
  }

  // ── Pan & zoom (district view) ───────────────────────────────────────────
  const mapEl = $("#city-map");
  const pointers = new Map();
  let panStart = null, moved = false, pinchStart = null;
  // Selection happens on pointerup using the pointerdown target: after
  // setPointerCapture the browser retargets the eventual click to the SVG
  // itself, so a plain click handler never sees the .bld path (mouse bug).
  let downTarget = null;

  const clientToMap = (cx, cy) => {
    const r = mapEl.getBoundingClientRect();
    return [vb.x + ((cx - r.left) / r.width) * vb.w, vb.y + ((cy - r.top) / r.height) * vb.h];
  };

  function zoomAt(factor, cx, cy) {
    if (view !== "district" || !vb) return;
    const [mx, my] = cx != null ? clientToMap(cx, cy) : [vb.x + vb.w / 2, vb.y + vb.h / 2];
    const minW = 60, maxW = fitVb.w * 1.4;
    const nw = Math.min(maxW, Math.max(minW, vb.w * factor));
    const scale = nw / vb.w;
    vb = { x: mx - (mx - vb.x) * scale, y: my - (my - vb.y) * scale, w: nw, h: vb.h * scale };
    setViewBox();
  }

  mapEl.addEventListener("pointerdown", (e) => {
    if (view !== "district") return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 1) { panStart = { x: e.clientX, y: e.clientY, vb: { ...vb } }; moved = false; downTarget = e.target; }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), vb: { ...vb } };
      panStart = null;
    }
    mapEl.setPointerCapture(e.pointerId);
  });
  mapEl.addEventListener("pointermove", (e) => {
    if (view !== "district" || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (d > 0) {
        const scale = pinchStart.dist / d;
        const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
        vb = { ...pinchStart.vb };
        setViewBox();
        zoomAt(scale, cx, cy);
      }
      moved = true;
    } else if (panStart) {
      const r = mapEl.getBoundingClientRect();
      const dx = ((e.clientX - panStart.x) / r.width) * panStart.vb.w;
      const dy = ((e.clientY - panStart.y) / r.height) * panStart.vb.h;
      if (Math.abs(e.clientX - panStart.x) + Math.abs(e.clientY - panStart.y) > 6) moved = true;
      vb = { ...panStart.vb, x: panStart.vb.x - dx, y: panStart.vb.y - dy };
      setViewBox();
    }
  });
  const endPointer = (e) => {
    // A tap (no drag) selects the building under the initial pointerdown.
    if (e.type === "pointerup" && view === "district" && !moved && pointers.size === 1 && downTarget) {
      const bEl = downTarget.closest && downTarget.closest(".bld");
      if (bEl) {
        selectedId = parseInt(bEl.dataset.b, 10);
        renderDistrict();
        renderDetail();
        $("#city-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) { panStart = null; downTarget = null; }
  };
  mapEl.addEventListener("pointerup", endPointer);
  mapEl.addEventListener("pointercancel", endPointer);
  mapEl.addEventListener("wheel", (e) => {
    if (view !== "district") return;
    e.preventDefault();
    zoomAt(e.deltaY > 0 ? 1.18 : 0.85, e.clientX, e.clientY);
  }, { passive: false });

  $("#zoom-in").addEventListener("click", () => zoomAt(0.7));
  $("#zoom-out").addEventListener("click", () => zoomAt(1.45));
  $("#zoom-fit").addEventListener("click", () => { if (fitVb) { vb = { ...fitVb }; setViewBox(); } });
  $("#city-back").addEventListener("click", () => {
    view = "overview"; district = null; selectedId = null; vb = null;
    loadCity();
  });

  // Overview has no pointer capture, so a plain click works there.
  // (District selection happens in endPointer — see note at downTarget.)
  mapEl.addEventListener("click", (e) => {
    if (moved) return;
    const dEl = e.target.closest(".dist");
    if (dEl && view === "overview") loadDistrict(dEl.dataset.d);
  });

  // ── Detail panel ─────────────────────────────────────────────────────────
  const bldById = (id) => district && district.buildings.find((b) => b.id === id);

  const OSM_TYPE = {
    house: "Wohnhaus", detached: "Einfamilienhaus (freistehend)", residential: "Wohngebäude",
    apartments: "Mehrfamilienhaus", semidetached_house: "Doppelhaushälfte", terrace: "Reihenhaus",
    bungalow: "Bungalow", farm: "Bauernhaus", farm_auxiliary: "Wirtschaftsgebäude", barn: "Scheune",
    stable: "Stall", retail: "Geschäftshaus", commercial: "Gewerbegebäude", office: "Bürogebäude",
    supermarket: "Supermarkt", industrial: "Industriegebäude", warehouse: "Lagerhalle",
    manufacture: "Produktionshalle", hotel: "Hotel", church: "Kirche", chapel: "Kapelle",
    school: "Schule", kindergarten: "Kindergarten", civic: "Öffentliches Gebäude",
    public: "Öffentliches Gebäude", government: "Behörde", fire_station: "Feuerwache",
    hospital: "Krankenhaus", university: "Hochschule", sports_hall: "Sporthalle",
    garage: "Garage", bunker: "Bunker", cabin: "Hütte", allotment_house: "Gartenlaube",
    train_station: "Bahnhofsgebäude", transportation: "Verkehrsgebäude", parking: "Parkhaus",
    sports_centre: "Sportzentrum", riding_hall: "Reithalle", silo: "Silo", works: "Werk",
    shop: "Ladengebäude", kiosk: "Kiosk", dormitory: "Wohnheim", hall: "Halle",
    community_centre: "Gemeindezentrum", greenhouse: "Gewächshaus", shed: "Schuppen",
  };

  function renderDetail() {
    const box = $("#city-detail");
    if (!box) return;
    if (view === "overview") {
      // Overview panel = local news feed (Spekulation!).
      let html = `<div class="cd-sub" style="margin-bottom:6px">📰 Orts-News</div>`;
      if (overview && overview.news && overview.news.length) {
        html += overview.news.map((n) => `<div class="cd-row ${n.up ? "news-up" : "news-down"}">${escapeHtml(n.txt)}</div>`).join("");
        html += `<p class="muted small" style="margin:8px 0 0">News bewegen den Preis-Index des Ortsteils — kauf billig, verkauf teuer (Verkauf: 90%).</p>`;
      } else {
        html += `<p class="muted small" style="margin:0">Noch keine Ereignisse — die Indizes driften vor sich hin. Tippe einen Stadtteil an!</p>`;
      }
      box.innerHTML = html;
      return;
    }
    const b = bldById(selectedId);
    if (!b) {
      box.innerHTML = '<p class="muted small" style="text-align:center;padding:14px">Zoome rein und tippe ein Haus an.</p>';
      return;
    }
    const c = district.classes[b.cls];
    const troph = b.trophy ? district.trophies[b.trophy] : null;
    const title = b.nm ? escapeHtml(b.nm) : escapeHtml(c.name);
    const head = `<div class="cd-head">${troph ? troph.emoji : c.emoji} <b>${title}</b>${troph ? ` <span class="cd-trophy-tag">TROPHÄE</span>` : ""}</div>`;

    // Info block: address, type, size.
    let body = `<div class="cd-info">`;
    body += `<div class="cd-row">📍 ${b.n ? `<b>${escapeHtml(b.n)}</b> · ` : ""}${escapeHtml(district.name)}</div>`;
    const art = b.t ? (OSM_TYPE[b.t] || b.t.replace(/_/g, " ")) : c.name;
    body += `<div class="cd-row">🏗️ Art: <b>${escapeHtml(art)}</b>${b.lv ? ` · ${b.lv} ${b.lv === 1 ? "Etage" : "Etagen"}` : ""}</div>`;
    body += `<div class="cd-row">📐 ${fmt(b.a)} m² Grundfläche${b.lm ? " · ⭐ Top-Lage" : ""}</div>`;
    // Residents (Wohnsitz flavour).
    const residents = (district.residents && district.residents[b.id]) || [];
    if (residents.length)
      body += `<div class="cd-row">🛏️ Hier wohnt: <b>${residents.map(escapeHtml).join(", ")}</b></div>`;
    body += `</div>`;

    // Trophy perk.
    if (troph)
      body += `<div class="cd-row cd-buff ${b.mine ? "on" : ""}">${troph.emoji} <b>${escapeHtml(troph.title)}</b> — ${escapeHtml(troph.perk)}${b.mine ? ` · <span class="pos">deins!</span>` : ""}</div>`;
    if (c.perk)
      body += `<div class="cd-row cd-buff ${b.mine ? "on" : ""}">⭐ <b>${escapeHtml(c.perk)}</b></div>`;

    // Street monopoly progress.
    if (b.st && district.streetTotals[b.st]) {
      const total = district.streetTotals[b.st];
      const ownedByMe = district.buildings.filter((x) => x.st === b.st && x.mine).length;
      const mono = district.monopolies.find((m) => m.st === b.st);
      if (mono)
        body += `<div class="cd-row cd-street">👑 <b style="color:${mono.color}">${escapeHtml(mono.ownerName)}s ${escapeHtml(b.st)}</b> — Straßen-Monopol!</div>`;
      else
        body += `<div class="cd-row cd-street">🏘️ <b>${escapeHtml(b.st)}</b>: ${ownedByMe}/${total} Häuser deins — bei ${total}/${total} färbt sich die Straße!</div>`;
    }

    body += `<div class="cd-section">`;
    body += `<div class="cd-row">Besitzer: <b>${b.mine ? "Du" : b.ownerName ? `<span style="color:${b.color}">${escapeHtml(b.ownerName)}</span>` : "— frei —"}</b></div>`;
    if (!b.owner) {
      const discounted = b.myPrice != null && b.myPrice < b.price;
      body += `<button class="btn-primary cd-btn" data-act="buy">Kaufen — ${fmt(discounted ? b.myPrice : b.price)} 🪙${discounted ? ` <s class="muted small">${fmt(b.price)}</s>` : ""}</button>`;
      if (discounted) body += `<div class="cd-row muted small">🥇 Boss-Rabatt: −10 % in deinem Ortsteil.</div>`;
    } else if (b.mine) {
      body += `<button class="btn-primary cd-btn" data-act="sell">Verkaufen — ${fmt(b.sellPrice)} 🪙</button>`;
      if (/^(kiosk|cafe|shop|hotel|factory)$/.test(b.cls)) {
        body += b.listed
          ? `<div class="cd-row" style="color:#7ec8ff">📈 Börsennotiert</div>`
          : `<button class="cd-toggle" data-act="ipo">📈 An die Börse bringen (IPO)</button>`;
      }
    } else {
      body += `<button class="btn-primary cd-btn" data-act="takeover">Übernehmen (+50%) — ${fmt(Math.ceil(b.price * 1.5))} 🪙</button>`;
      body += `<div class="cd-row muted small">Der Vorbesitzer wird zum Marktwert entschädigt.</div>`;
    }
    // Wohnsitz: free flavour on any building.
    const myAcc = window.Casino.getAccount && window.Casino.getAccount();
    const myName = myAcc && myAcc.name;
    const iLiveHere = myName && residents.some((r) => r.toLowerCase() === myName.toLowerCase());
    body += iLiveHere
      ? `<button class="cd-toggle on" data-act="moveout">🛏️ Du wohnst hier — ausziehen</button>`
      : `<button class="cd-toggle" data-act="movein">🛏️ Hier einziehen (kostenlos, nur Spaß)</button>`;
    body += `</div>`;
    box.innerHTML = head + body;
  }

  $("#city-detail").addEventListener("click", (e) => {
    const b = bldById(selectedId);
    if (!b || view !== "district") return;
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "movein" || act === "moveout") {
      socket.emit("city:residence", { buildingId: act === "movein" ? b.id : null }, (res) => {
        if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
        toast(act === "movein" ? "🛏️ Eingezogen!" : "📦 Ausgezogen.");
        loadDistrict(district.id, true);
      });
      return;
    }
    const EVT = { buy: "city:buy", sell: "city:sell", takeover: "city:takeover", ipo: "city:ipo" };
    const ev = EVT[act];
    if (!ev) return;
    socket.emit(ev, { buildingId: b.id, districtId: district.id }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Aktion fehlgeschlagen."); return; }
      applyAccount(res.account);
      if (res.district) { district = res.district; district.residents = district.residents || {}; }
      renderDistrict();
      renderDetail();
      socket.emit("city:state", (r2) => { if (r2 && r2.ok) { overview = r2.overview; renderEmpire(overview.me); } });
      if (res.raised) toast(`🚀 Börsengang! +${fmt(res.raised)} 🪙 Kapital (${res.sym}).`);
      else if (res.gain) toast(`✓ +${fmt(res.gain)} 🪙`);
      else if (res.cost) toast(`✓ −${fmt(res.cost)} 🪙`);
      else toast("✓ Erledigt");
    });
  });

  // Live refresh + news toasts.
  socket.on("city:update", () => {
    const screen = document.querySelector('[data-screen="businesses"]');
    if (screen && screen.classList.contains("active")) loadCity();
  });
  socket.on("city:news", (n) => {
    if (n && n.txt) toast(`📰 ${n.txt}`);
  });
  // Achievement unlocked → celebrate (only for me; big ones hit the chat anyway).
  socket.on("ach:unlocked", (a) => {
    const acc = window.Casino.getAccount && window.Casino.getAccount();
    if (!a || !acc || !a.user || a.user.toLowerCase() !== acc.name.toLowerCase()) return;
    toast(`🏆 Achievement: ${a.emoji} ${a.label} — +${fmt(a.reward)} 🪙!`);
  });

  // ── Screen-entry hooks (called by app.js's showScreen) ───────────────────
  window.Casino._loadWork = loadWork;
  window.Casino._loadBusinesses = () => {
    view = "overview"; district = null; selectedId = null; vb = null;
    loadCity();
  };
})();
