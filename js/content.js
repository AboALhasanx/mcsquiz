/**
 * content.js — the content portal client.
 *
 * The questions live in Supabase (the "portal") and the agent publishes them
 * there. This module is the only place the app talks to it:
 *
 *   manifest()  a tiny document: the content version + every chapter's version
 *   bank(id)    one bank, v3 payload
 *
 * The app compares the manifest version with what it already has, downloads
 * only the banks whose version changed, and keeps them locally (the offline
 * cache in cloud.js/app.js). If Supabase is unreachable it falls back to the
 * static data/ files that ship with the shell.
 */
(function (global) {
  'use strict';

  function cfg() { return global.PORTAL_SUPABASE || {}; }

  function configured() {
    var c = cfg();
    return !!(c.url && c.key && c.url.indexOf('supabase') > 0);
  }

  function rpc(name, body) {
    var c = cfg();
    if (!configured()) return Promise.reject(new Error('content-not-configured'));
    return fetch(c.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        apikey: c.key,
        Authorization: 'Bearer ' + c.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
      cache: 'no-store',
    }).then(function (r) {
      if (!r.ok) throw new Error('content-rpc-' + name + '-' + r.status);
      return r.json();
    });
  }

  global.PortalContent = {
    configured: configured,
    manifest: function () { return rpc('content_manifest', {}); },
    bank: function (quizId) { return rpc('content_bank', { p_quiz_id: quizId }); },
  };
})(window);
