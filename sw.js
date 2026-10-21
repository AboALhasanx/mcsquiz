/* MCQ Portal service worker â€” static + data cache, no API fabrication.
 * Telemetry POSTs do not exist in the portal, so failed POSTs are never
 * answered with fake 200s (unlike the Master-Studio sw.js defect). */
const CACHE = 'mcq-portal-v43';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/quiz.css',
  './css/fonts.css',
  './css/portal.css',
  './js/app.js',
  './js/analytics.js',
  './js/quiz-vault.js',
  './js/lucide.min.js',
  './js/pwa.js',
  './js/debug.js',
  './js/tg-config.js',
  './js/cloud.js',
  './js/league.js',
  './js/supabase-config.js',
  './assets/fonts/space-grotesk-500.woff2',
  './assets/fonts/space-grotesk-700.woff2',
  './assets/fonts/plex-arabic-400-arabic.woff2',
  './assets/fonts/plex-arabic-400-latin.woff2',
  './assets/fonts/plex-arabic-500-arabic.woff2',
  './assets/fonts/plex-arabic-500-latin.woff2',
  './assets/fonts/plex-arabic-600-arabic.woff2',
  './assets/fonts/plex-arabic-600-latin.woff2',
  './assets/fonts/plex-arabic-700-arabic.woff2',
  './assets/fonts/plex-arabic-700-latin.woff2',
  './assets/brand-icon-light.png',
  './assets/brand-icon-dark.png',
  './assets/avatar-default.svg',
  './data/index.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_DrHuda_20MCQ.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_DrHuda_20MCQ.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_01_Cybersecurity_Foundations.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_02_Risk_Assessment.json',
  './data/banks/02_English_Language_Ch01_Quiz_01_Grammar_and_Tenses.json',
  './data/banks/03_Data_Mining_Ch01_Quiz_01_Introduction_to_Data_Mining.json',
  './data/banks/04_Advanced_Software_Eng_Ch01_Quiz_01_Software_Crisis.json',
  './data/banks/04_Advanced_Software_Eng_Ch02_Quiz_02_Patriot_Brooks.json',
  './data/banks/05_Soft_Computing_Ch01_Quiz_01_Soft_Computing_Foundations.json',
  './data/banks/05_Soft_Computing_Ch02_Quiz_02_Fuzzy_Logic_Systems.json',
  './sounds/correct.mp3',
  './sounds/wrong.mp3',
  './sounds/completed.mp3',
  './sounds/fail.mp3',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((cs) => cs.forEach((c) => c.postMessage({ type: 'sw-activated', cache: CACHE })))
  );
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

