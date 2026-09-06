"use strict";

/**
 * Service Worker — ausschliesslich fuer Push.
 *
 * Hier wird bewusst NICHTS zwischengespeichert. Das Casino erkennt neue
 * Versionen ueber einen Fingerabdruck des Inhalts und laedt dann neu; ein
 * Cache im Service Worker wuerde genau dagegen arbeiten und dem Spieler alte
 * Dateien unterschieben. Der Worker existiert nur, damit Safari und Chrome
 * ueberhaupt Push zustellen duerfen.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  const titel = d.title || "🎰 Fake Casino";
  e.waitUntil(self.registration.showNotification(titel, {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Gleicher Anlass ersetzt die alte Nachricht, statt sich zu stapeln.
    tag: d.typ || "casino",
    renotify: true,
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const ziel = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const liste = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Ein offenes Casino-Fenster wird nach vorne geholt, statt ein zweites zu
    // oeffnen: sonst haette man auf dem iPad am Ende drei davon.
    for (const c of liste) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if (ziel && ziel !== "/") { try { c.navigate(ziel); } catch {} }
        return;
      }
    }
    await self.clients.openWindow(ziel);
  })());
});
