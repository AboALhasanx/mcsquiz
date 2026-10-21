/* portal pwa.js — SW registration + install API (banner never auto-shows; install lives in the side menu). */
(function () {
  'use strict';
  let deferredPrompt = null;

  document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
      // a shell left open for days must still pick up a new build: never trust
      // the HTTP cache for sw.js, and re-check whenever the app comes forward
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
        if (!reg || !reg.update) return;
        const check = () => { try { reg.update(); } catch (e) {} };
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
        window.addEventListener('focus', check);
        setInterval(check, 20 * 60 * 1000);
      }).catch(() => {});
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
