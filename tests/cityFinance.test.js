"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sellPayout, takeoverPayout, ipoRaise } = require("../game/cityFinance");

test("price rises never make a resale profitable", () => {
  const holding = { costBasis: 100_000 };
  assert.equal(sellPayout(holding, 190_000), 90_000);
  assert.equal(takeoverPayout(holding, 190_000), 100_000);
});

test("falling prices still reduce the resale and takeover payout", () => {
  const holding = { costBasis: 100_000 };
  assert.equal(sellPayout(holding, 55_000), 49_500);
  assert.equal(takeoverPayout(holding, 55_000), 55_000);
});

test("IPO proceeds are deducted from later resale and takeover", () => {
  const holding = { costBasis: 100_000 };
  const raised = ipoRaise(holding, 190_000);
  assert.equal(raised, 50_000);
  holding.capitalRecovered = raised;
  assert.equal(sellPayout(holding, 190_000), 40_000);
  assert.equal(takeoverPayout(holding, 190_000), 50_000);
  assert.ok(raised + sellPayout(holding, 190_000) < holding.costBasis);
  assert.equal(raised + takeoverPayout(holding, 190_000), holding.costBasis);
});

test("additional investment increases basis, never past paid chips", () => {
  const holding = { costBasis: 100_000, capitalRecovered: 50_000 };
  holding.costBasis += 30_000;
  assert.equal(sellPayout(holding, 250_000), 67_000);
  assert.equal(takeoverPayout(holding, 250_000), 80_000);
});
