/* portal pwa.js — SW registration + install banner (no server dependency). */
(function () {
  'use strict';
  let deferredPrompt = null;

  document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const b = document.getElementById('pwa-install-banner');
      if (b) b.classList.remove('hidden');
    });
    const install = document.getElementById('btn-pwa-install');
    if (install) install.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null;
      document.getElementById('pwa-install-banner').classList.add('hidden');
    });
    const dismiss = document.getElementById('btn-pwa-dismiss');
    if (dismiss) dismiss.addEventListener('click', () => {
      document.getElementById('pwa-install-banner').classList.add('hidden');
    });
  });
})();
