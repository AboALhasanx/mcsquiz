/* MCQ Portal service worker â€” static + data cache, no API fabrication.
 * Telemetry POSTs do not exist in the portal, so failed POSTs are never
 * answered with fake 200s (unlike the Master-Studio sw.js defect). */
const VERSION = '1.7.11';
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
  './js/vendor/npm/iceberg-js-0.8.1.js',
  './js/vendor/npm/supabase-js.js',
  './js/vendor/npm/supabase_auth-js-2.118.0.js',
  './js/vendor/npm/supabase_functions-js-2.118.0.js',
  './js/vendor/npm/supabase_phoenix-0.4.5.js',
  './js/vendor/npm/supabase_postgrest-js-2.118.0.js',
  './js/vendor/npm/supabase_realtime-js-2.118.0.js',
  './js/vendor/npm/supabase_storage-js-2.118.0.js',
  './js/vendor/npm/tslib-2.8.1.js',
  './js/vendor/katex/katex.min.css',
  './js/vendor/katex/katex.min.js',
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
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T01_Cybersecurity_Definition_and_Evolution.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T02_Scope_Domains_and_Risk_Exposure.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T03_CIA_Triad_and_Utility_Function.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T04_Threat_Landscape_and_Attack_Surface.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T05_Risks_Vulnerabilities_and_Distribution.json',
  './data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_T06_Policies_Compliance_and_Optimization.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_T01_Risk_And_Threat_Chain.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_T02_Two_Equations_And_Matrices.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_T03_Threat_Groups_And_Countermeasures.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_T04_Mitigation_And_PDCA.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_T05_Analysis_Frameworks.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_T06_ISO_IEC_27002.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_T07_OCTAVE.json',
  './data/banks/01_Cyber_Security_Ch02_Quiz_Ch02_T08_Policy_And_Physical_Controls.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_T01_Organizational_Risk.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_T02_Three_Dimensions_And_EFL.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_T03_Risk_Equation.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_T04_Governance_Bridge_And_Cycle.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_T05_Emerging_Challenges.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_T06_Industry_Specific_Risks.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_T08_Policy_Challenges_And_Lifecycle.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_T09_Strategic_Role_Of_Policies.json',
  './data/banks/01_Cyber_Security_Ch03_Quiz_Ch03_T10_Modern_Trends.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_T01_Classical_Ciphers_And_Unicity.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_T02_Symmetric_Encryption.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_T03_Asymmetric_Encryption.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_T04_Hybrid_Cryptography_And_Work_Factor.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_T05_Hash_Functions.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_T06_Digital_Signatures.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_T07_Certificates_PKI_And_Trust_Model.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_T08_HTTPS_TLS_And_Applications.json',
  './data/banks/01_Cyber_Security_Ch04_Quiz_Ch04_T09_Economic_Model_And_Challenges.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T01_Protocol_Surface_And_Transport.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T02_Network_Layer_And_Addressing.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T03_DNS_DNSSEC_And_Encrypted_Resolution.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T04_Routing_And_Time.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T05_TLS13_And_Protocol_Risk.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T06_Firewalls.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T07_Proxies.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T08_VPNs.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T09_Convergence_Risk_And_Governance.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T10_IDS_Foundations_And_Architectures.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T11_Detection_Techniques.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T12_Prevention_And_Performance_Math.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T13_Encrypted_Environments_And_Integration.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T14_Segmentation_Concepts.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T15_Defense_In_Depth.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T16_Segmentation_Math_Models.json',
  './data/banks/01_Cyber_Security_Ch05_Quiz_Ch05_T17_Trends_Cases_And_Synthesis.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T01_Intro_And_Strategic_Principles.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T02_DevSecOps_Framework.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T03_Risk_Models_And_Modern_Directions.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T04_Tools.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T05_Secure_Coding_And_Identity.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T06_Monitoring_Integration_And_Challenges.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T07_SQLi_XSS_CSRF.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T08_API_SupplyChain_Cloud.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T09_Reliability_Engineering.json',
  './data/banks/01_Cyber_Security_Ch06_Quiz_Ch06_T10_Business_Continuity_And_Threats.json',
  './data/banks/02_English_Language_Ch01_Quiz_01_Grammar_and_Tenses.json',
  './data/banks/02_English_Language_Ch01_Quiz_Ch01_ModelB_Grammar_and_Tenses.json',
  './data/banks/02_English_Language_Ch02_Quiz_Ch02_ModelA_Reading_and_Vocabulary.json',
  './data/banks/02_English_Language_Ch02_Quiz_Ch02_ModelB_Reading_and_Vocabulary.json',
  './data/banks/03_Data_Mining_Ch01_Quiz_Ch01_T01_What_Is_Data_Mining.json',
  './data/banks/03_Data_Mining_Ch01_Quiz_Ch01_T02_Advantages_of_Data_Mining.json',
  './data/banks/03_Data_Mining_Ch01_Quiz_Ch01_T03_Disadvantages_of_Data_Mining.json',
  './data/banks/03_Data_Mining_Ch01_Quiz_Ch01_T04_Data_Mining_Applications.json',
  './data/banks/03_Data_Mining_Ch01_Quiz_Ch01_T05_Implementation_Challenges.json',
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
  // versioned URLs (?v=) ask for one specific revision: try network first, fallback to cache
  if (url.searchParams.has('v')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }
  const isNav = e.request.mode === 'navigate';
  e.respondWith(
    caches.match(e.request, { ignoreSearch: isNav }).then((hit) => {
      const fallback = hit || (isNav ? caches.match('./index.html') : null);
      return Promise.resolve(fallback).then((cached) => {
        const net = fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || net;
      });
    })
  );
});

