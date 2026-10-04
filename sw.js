/* Service Worker — Control de Tratamiento (offline-first + recordatorios) */
const CACHE = 'control-tratamiento-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Cache-first para lo propio; la red solo como respaldo/actualización */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        fetch(req).then(res => {
          if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then(res => {
        if (res && res.ok && req.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

/* ---------- lectura de la misma base que usa la app ---------- */
function abrirDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('control-tratamiento-db');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function leer(db, store, key) {
  return new Promise((res, rej) => {
    if (!db.objectStoreNames.contains(store)) return res(undefined);
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

const dosDig = n => String(n).padStart(2, '0');

/* Revisa las tomas de hoy y avisa las que ya pasaron de hora y siguen sin marcar */
async function revisarTomas() {
  let db;
  try { db = await abrirDB(); } catch (_) { return; }

  const cfg = await leer(db, 'config', 'tratamiento');
  if (!cfg || !cfg.medicamentos || !cfg.medicamentos.length) return;

  const d = new Date();
  const f = d.getFullYear() + '-' + dosDig(d.getMonth() + 1) + '-' + dosDig(d.getDate());
  const ahora = dosDig(d.getHours()) + ':' + dosDig(d.getMinutes());

  const doc = await leer(db, 'tomas', f);
  const regs = (doc && doc.registros) || {};

  const faltan = [];
  for (const m of cfg.medicamentos) {
    for (const h of (m.horarios || [])) {
      if (h > ahora) continue;
      if (regs[m.id + '|' + h] && regs[m.id + '|' + h].tomada) continue;
      faltan.push(m.nombre + ' ' + (m.dosis || '') + ' (' + h + ')');
    }
  }
  if (!faltan.length) return;

  await self.registration.showNotification(
    faltan.length === 1 ? 'Falta una toma' : 'Faltan ' + faltan.length + ' tomas',
    {
      body: faltan.join(' · '),
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'toma',
      renotify: true,
      data: { url: './index.html' }
    }
  );
}

self.addEventListener('periodicsync', e => {
  if (e.tag === 'revisa-tomas') e.waitUntil(revisarTomas());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const c of cs) if ('focus' in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
