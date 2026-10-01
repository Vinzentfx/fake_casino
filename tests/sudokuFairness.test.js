"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Sudoku registriert beim Import den Duell-Adapter; dafür nur eine isolierte Kopie laden.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-sudoku-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
const sudoku = require(path.join(root, "game/sudoku"));
const duelle = require(path.join(root, "game/asyncDuell"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("generated puzzles have the advertised clue count and exactly one solution", () => {
  for (const [difficulty, clues] of [["easy", 45], ["medium", 34], ["hard", 28]]) {
    for (let i = 0; i < 40; i++) {
      const { puzzle, solution } = sudoku._makePuzzle(difficulty);
      assert.equal(puzzle.filter(Boolean).length, clues);
      assert.equal(sudoku._countSolutions(puzzle), 1);
      assert.equal(sudoku._isSolved(solution, puzzle), true);
    }
  }
});

test("a valid alternate solution of a legacy ambiguous puzzle receives full credit", () => {
  const solution = sudoku._makePuzzle("easy").solution;
  const alternate = solution.map((n) => n === 1 ? 2 : n === 2 ? 1 : n);
  const oldPuzzle = new Array(81).fill(0);
  assert.equal(sudoku._countSolutions(oldPuzzle), 2);
  assert.equal(sudoku._isSolved(alternate, oldPuzzle), true);
  assert.deepEqual(sudoku._scoreGrid(alternate, oldPuzzle, solution),
    { punkte: 81, richtig: 81, falsch: 0, geloest: true, valid: true });
});

test("partial scoring penalizes guesses and rejects contradictory grids", () => {
  const solution = sudoku._makePuzzle("easy").solution;
  const puzzle = new Array(81).fill(0);
  const partial = puzzle.slice();
  partial[0] = solution[0];
  assert.equal(sudoku._scoreGrid(partial, puzzle, solution).punkte, 1);
  partial[40] = solution[40] === 9 ? 1 : solution[40] + 1;
  assert.equal(sudoku._scoreGrid(partial, puzzle, solution).punkte, -1);
  partial[1] = partial[0];
  assert.equal(sudoku._scoreGrid(partial, puzzle, solution).valid, false);
});

test("two blank asynchronous submissions refund both stakes despite different times", () => {
  const players = {
    alice: { name: "Alice", chips: 1000 },
    bob: { name: "Bob", chips: 1000 },
  };
  const accounts = {
    get: (key) => players[key],
    publicAccount: (account) => account,
    adjustChips(key, amount) {
      const account = players[key];
      if (!account || account.chips + amount < 0) return { ok: false, error: "Nicht genug Chips." };
      account.chips += amount;
      return { ok: true, account };
    },
  };
  const io = { on() {}, emit() {}, of() { return { sockets: new Map() }; } };
  duelle.setup(io, accounts);
  const originalNow = Date.now;
  let now = 1_000_000_000;
  Date.now = () => now;
  try {
    const created = duelle.erstelle("alice", { spiel: "sudoku", einsatz: 50 });
    assert.equal(created.ok, true);
    now += 5_000;
    assert.equal(duelle.gibAb("alice", created.id, created.aufgabe.puzzle).ergebnis.punkte, 0);
    assert.equal(duelle.nimmAn("bob", created.id).ok, true);
    now += 20_000;
    const result = duelle.gibAb("bob", created.id, created.aufgabe.puzzle);
    assert.equal(result.sieger, null);
    assert.equal(result.auszahlung, 0);
    assert.equal(players.alice.chips, 1000);
    assert.equal(players.bob.chips, 1000);
  } finally { Date.now = originalNow; }
});
