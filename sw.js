/* MCQ Portal service worker — static + data cache, no API fabrication.
 * Telemetry POSTs do not exist in the portal, so failed POSTs are never
 * answered with fake 200s (unlike the Master-Studio sw.js defect). */
const CACHE = 'mcq-portal-v2';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/quiz.css',
  './css/portal.css',
  './js/app.js',
  './js/analytics.js',
  './js/quiz-vault.js',
  './js/lucide.min.js',
  './js/pwa.js',
  './data/index.json',
  './data/banks/01_Cyber_Security_Ch01_demo.json',
  './data/banks/01_Cyber_Security_Ch02_demo.json',
  './data/banks/04_ASE_SDLC_demo.json',
  './data/banks/04_ASE_Agile_demo.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/brand-icon-light.png',
  './sounds/correct.mp3',
  './sounds/wrong.mp3',
  './sounds/completed.mp3',
  './sounds/fail.mp3',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
