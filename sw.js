/* MCQ Portal service worker â€” static + data cache, no API fabrication.
 * Telemetry POSTs do not exist in the portal, so failed POSTs are never
 * answered with fake 200s (unlike the Master-Studio sw.js defect). */
const VERSION = '1.0.2';
const CACHE = 'mcq-portal-' + VERSION;
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/fonts.css',
  './css/portal.css',
  './css/quiz.css',
  './js/analytics.js',
  './js/app.js',
  './js/cloud.js',
  './js/content.js',
  './js/debug.js',
  './js/league.js',
  './js/lucide.min.js',
  './js/pwa.js',
  './js/qrcode.min.js',
  './js/quiz-vault.js',
  './js/supabase-config.js',
  './js/tg-config.js',
  './js/vendor/npm/iceberg-js-0.8.1.mjs',
  './js/vendor/npm/supabase-js.mjs',
  './js/vendor/npm/supabase_auth-js-2.118.0.mjs',
  './js/vendor/npm/supabase_functions-js-2.118.0.mjs',
  './js/vendor/npm/supabase_phoenix-0.4.5.mjs',
  './js/vendor/npm/supabase_postgrest-js-2.118.0.mjs',
  './js/vendor/npm/supabase_realtime-js-2.118.0.mjs',
  './js/vendor/npm/supabase_storage-js-2.118.0.mjs',
  './js/vendor/npm/tslib-2.8.1.mjs',
  './assets/fonts/plex-arabic-400-arabic.woff2',
  './assets/fonts/plex-arabic-400-latin.woff2',
  './assets/fonts/plex-arabic-500-arabic.woff2',
  './assets/fonts/plex-arabic-500-latin.woff2',
  './assets/fonts/plex-arabic-600-arabic.woff2',
  './assets/fonts/plex-arabic-600-latin.woff2',
  './assets/fonts/plex-arabic-700-arabic.woff2',
  './assets/fonts/plex-arabic-700-latin.woff2',
  './assets/fonts/space-grotesk-500.woff2',
  './assets/fonts/space-grotesk-700.woff2',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/brand-icon-light.png',
  './assets/brand-icon-dark.png',
  './assets/avatar-default.svg',
  './assets/avatars/person-01.png',
  './assets/avatars/person-02.png',
  './assets/avatars/person-03.png',
  './assets/avatars/person-04.png',
  './assets/avatars/person-05.png',
  './assets/avatars/person-06.png',
  './assets/avatars/person-07.png',
  './assets/avatars/person-08.png',
  './assets/avatars/person-09.png',
  './assets/avatars/person-10.png',
  './assets/avatars/person-11.png',
  './assets/avatars/person-12.png',
  './assets/avatars/person-13.png',
  './assets/avatars/person-14.png',
  './assets/avatars/person-15.png',
  './assets/avatars/person-16.png',
  './assets/avatars/person-17.png',
  './assets/avatars/person-18.png',
  './assets/avatars/person-19.png',
  './assets/avatars/person-20.png',
  './assets/avatars/person-21.png',
  './assets/avatars/person-22.png',
  './assets/avatars/person-23.png',
  './assets/avatars/person-24.png',
  './assets/avatars/person-25.png',
  './data/index.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_DrHuda_20MCQ.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_ModelB_DrHuda.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T01_Cybersecurity_Definition_and_Evolution.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T02_Scope_Domains_and_Risk_Exposure.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T03_CIA_Triad_and_Utility_Function.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T04_Threat_Landscape_and_Attack_Surface.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T05_Risks_Vulnerabilities_and_Distribution.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T06_Policies_Compliance_and_Optimization.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_DrHuda_20MCQ.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_ModelB_DrHuda.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_01_Cybersecurity_Foundations.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_ModelB_Cybersecurity_Foundations.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_02_Risk_Assessment.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_ModelB_Risk_Assessment.json',
  './data/banks/02_English_Language_Ch01_Quiz_01_Grammar_and_Tenses.json',
  './data/banks/02_English_Language_Ch01_Quiz_Ch01_ModelB_Grammar_and_Tenses.json',
  './data/banks/02_English_Language_Ch02_Quiz_Ch02_ModelA_Reading_and_Vocabulary.json',
  './data/banks/02_English_Language_Ch02_Quiz_Ch02_ModelB_Reading_and_Vocabulary.json',
  './data/banks/03_Data_Mining_Ch01_Quiz_01_Introduction_to_Data_Mining.json',
  './data/banks/03_Data_Mining_Ch01_Quiz_Ch01_ModelB_Introduction_to_Data_Mining.json',
  './data/banks/03_Data_Mining_Ch02_Quiz_Ch02_ModelA_Data_Types_and_Preparation.json',
  './data/banks/03_Data_Mining_Ch02_Quiz_Ch02_ModelB_Data_Types_and_Preparation.json',
  './data/banks/03_Data_Mining_Ch03_Quiz_Ch03_ModelA_Feature_Extraction.json',
  './data/banks/03_Data_Mining_Ch03_Quiz_Ch03_ModelB_Feature_Extraction.json',
  './data/banks/04_Advanced_Software_Eng_Ch01_Quiz_01_Software_Crisis.json',
  './data/banks/04_Advanced_Software_Eng_Ch01_Quiz_Ch01_ModelB_Software_Crisis.json',
  './data/banks/04_Advanced_Software_Eng_Ch02_Quiz_Ch02_ModelA_SDLC_Models.json',
  './data/banks/04_Advanced_Software_Eng_Ch02_Quiz_Ch02_ModelB_SDLC_Models.json',
  './data/banks/04_Advanced_Software_Eng_Ch05_Quiz_Ch05_ModelA_Software_Design.json',
  './data/banks/04_Advanced_Software_Eng_Ch05_Quiz_Ch05_ModelB_Software_Design.json',
  './data/banks/05_Soft_Computing_Ch01_Quiz_01_Soft_Computing_Foundations.json',
  './data/banks/05_Soft_Computing_Ch01_Quiz_Ch01_ModelB_Soft_Computing_Intro.json',
  './data/banks/05_Soft_Computing_Ch02_Quiz_02_Fuzzy_Logic_Systems.json',
  './data/banks/05_Soft_Computing_Ch02_Quiz_Ch02_ModelB_Fuzzy_Logic_Systems.json',
  './data/banks/06_Artificial_Intelligence_Ch01_Quiz_Ch01_ModelA_AI_Foundations.json',
  './data/banks/06_Artificial_Intelligence_Ch01_Quiz_Ch01_ModelB_AI_Foundations.json',
  './data/banks/06_Artificial_Intelligence_Ch02_Quiz_Ch02_ModelA_Search_and_Learning.json',
  './data/banks/06_Artificial_Intelligence_Ch02_Quiz_Ch02_ModelB_Search_and_Learning.json',
  './sounds/completed.mp3',
  './sounds/correct.mp3',
  './sounds/fail.mp3',
  './sounds/wrong.mp3',
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
  // versioned URLs (?v=) ask for one specific revision: always go to the network
  if (url.searchParams.has('v')) {
    e.respondWith(fetch(e.request));
    return;
  }
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

