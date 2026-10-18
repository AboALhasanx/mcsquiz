/* portal pwa.js — SW registration + install API (banner never auto-shows; install lives in the side menu). */
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
    });
  });

  window.PortalPWA = {
    canInstall: function () { return !!deferredPrompt; },
    install: async function () {
      if (!deferredPrompt) return false;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) {}
      deferredPrompt = null;
      return true;
    },
  };
})();
