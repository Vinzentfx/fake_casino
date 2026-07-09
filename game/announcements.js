"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "announcement.json");
const OWNER = "vincent";
const MAX_TEXT = 220;

let current = load();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw && typeof raw.text === "string") return raw;
  } catch {}
  return null;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (current) fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
    else fs.rmSync(FILE, { force: true });
  } catch {}
}

function publicState() {
  return current ? { ...current } : null;
}

function setupAnnouncements(io) {
  io.on("connection", (socket) => {
    socket.emit("announcement:state", { announcement: publicState() });

    socket.on("announcement:get", (ack) => {
      if (typeof ack === "function") ack({ ok: true, announcement: publicState() });
    });

    socket.on("admin:announcement", ({ text } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (socket.data.account !== OWNER) return ack({ ok: false, error: "Kein Zugriff." });
      text = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      if (!text) return ack({ ok: false, error: "Text eingeben." });
      current = { text, by: OWNER, at: Date.now() };
      save();
      io.emit("announcement:state", { announcement: publicState(), toast: true });
      ack({ ok: true, announcement: publicState() });
    });

    socket.on("admin:announcementClear", (ack) => {
      if (typeof ack !== "function") return;
      if (socket.data.account !== OWNER) return ack({ ok: false, error: "Kein Zugriff." });
      current = null;
      save();
      io.emit("announcement:state", { announcement: null, toast: false });
      ack({ ok: true });
    });
  });
}

module.exports = { setupAnnouncements, publicState };
