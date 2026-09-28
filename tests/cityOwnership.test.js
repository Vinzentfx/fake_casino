"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-city-test-"));
  fs.mkdirSync(path.join(root, "game", "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"));
  for (const file of ["city.js", "cityFinance.js"])
    fs.copyFileSync(path.join(__dirname, "..", "game", file), path.join(root, "game", file));
  fs.copyFileSync(path.join(__dirname, "..", "game", "data", "porta.json"), path.join(root, "game", "data", "porta.json"));
  const cityPath = path.join(root, "game", "city.js");
  return {
    root, dataPath: path.join(root, "data", "city.json"),
    load() { delete require.cache[cityPath]; return require(cityPath); },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test("a market jump cannot turn an owned building into resale profit", () => {
  const f = fixture();
  try {
    let city = f.load();
    const districtId = city.publicOverview("alice").districts[0].id;
    const building = city.publicDistrict(districtId, "alice").buildings.find((b) => b.cls === "residential" && !b.trophy);
    assert.ok(building);
    const purchase = city.buyBuilding(building.id, "alice", "Alice");
    assert.equal(purchase.ok, true);
    purchase.commit();
    const saved = JSON.parse(fs.readFileSync(f.dataPath));
    assert.equal(saved.own[building.id].costBasis, purchase.cost);
    const random = Math.random;
    try { Math.random = () => 0; city.fireEvent(districtId); }
    finally { Math.random = random; }
    const after = city.publicDistrict(districtId, "alice").buildings.find((b) => b.id === building.id);
    assert.ok(after.price > building.price);
    assert.ok(after.sellPrice <= purchase.cost * 0.9);
    assert.ok(city.sellBuilding(building.id, "alice").gain <= purchase.cost * 0.9);
    assert.ok(city.takeover(building.id, "bob", "Bob").payout.amount <= purchase.cost);
  } finally { f.cleanup(); }
});

test("releasing all of one owner's buildings leaves other owners untouched", () => {
  const f = fixture();
  try {
    const city = f.load();
    const districtId = city.publicOverview("alice").districts[0].id;
    const ids = city.publicDistrict(districtId, "alice").buildings.filter((b) => !b.trophy).slice(0, 3).map((b) => b.id);
    city.buyBuilding(ids[0], "alice", "Alice").commit();
    city.buyBuilding(ids[1], "alice", "Alice").commit();
    city.buyBuilding(ids[2], "bob", "Bob").commit();
    assert.equal(city.adminRemoveOwner("alice").removed, 2);
    const lots = city.ownedLots();
    assert.equal(lots.length, 1);
    assert.equal(lots[0].ownerKey, "bob");
  } finally { f.cleanup(); }
});

test("legacy holdings receive a fixed basis and IPO marker at migration", () => {
  const f = fixture();
  try {
    const map = JSON.parse(fs.readFileSync(path.join(f.root, "game", "data", "porta.json")));
    const building = map.districts.flatMap((d) => d.buildings).find((b) => b.id && b.a && !b.trophy);
    fs.writeFileSync(f.dataPath, JSON.stringify({ v: "porta2", own: { [building.id]: { owner: "alice", ownerName: "Alice", listed: true } } }));
    const city = f.load();
    const saved = JSON.parse(fs.readFileSync(f.dataPath));
    assert.ok(saved.own[building.id].costBasis > 0);
    assert.ok(saved.own[building.id].capitalRecovered >= 0);
    assert.equal(saved.ipoed[building.id], true);
    assert.equal(city.listCompany(building.id, "alice").ok, false);
  } finally { f.cleanup(); }
});

test("a saved market index is retained when migrating old holdings", () => {
  const f = fixture();
  try {
    const map = JSON.parse(fs.readFileSync(path.join(f.root, "game", "data", "porta.json")));
    const district = map.districts[0];
    const building = district.buildings.find((b) => b.id && b.a);
    fs.writeFileSync(f.dataPath, JSON.stringify({ v: "porta2", own: { [building.id]: { owner: "alice", ownerName: "Alice" } }, idx: { [district.id]: 1.9 } }));
    const city = f.load();
    assert.equal(city.publicOverview("alice").districts[0].idx, 1.9);
    assert.equal(JSON.parse(fs.readFileSync(f.dataPath)).idx[district.id], 1.9);
  } finally { f.cleanup(); }
});
