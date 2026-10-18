/* Portal cloud sync — student's own Dropbox (App Folder), no server needed.
 * OAuth2 PKCE flow (no client secret), tokens in localStorage (never exported).
 * One JSON file synced: /mcq-portal.json {saved, history, bests, updatedAt}.
 * Requires window.PORTAL_DROPBOX_KEY (see js/dropbox-config.example.js).
 */
(function (global) {
  'use strict';

  const TOK_KEY = 'portal_cloud_tokens';
  const SYNC_KEY = 'portal_cloud_synced_at';
  const FILE_PATH = '/mcq-portal.json';
  const LS_BEST_PREFIX = 'portal_best_';
  const LS_SAVED = 'portal_saved_v1';
  const LS_HISTORY = 'portal_history_v1';

  let pushTimer = null;
  let syncing = false;

  function key() { return (global.PORTAL_DROPBOX_KEY || '').trim(); }
  function configured() { return !!key(); }

  function loadTokens() {
    try { return JSON.parse(localStorage.getItem(TOK_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveTokens(t) {
    try {
      if (t) localStorage.setItem(TOK_KEY, JSON.stringify(t));
      else localStorage.removeItem(TOK_KEY);
    } catch (e) {}
  }
  function linked() { const t = loadTokens(); return !!(t && t.refresh_token); }

  function b64url(buf) {
    const s = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randStr(n) {
    const a = new Uint8Array(n);
    (global.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.map(() => Math.floor(Math.random() * 256));
    let s = '';
    for (let i = 0; i < a.length; i++) s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[a[i] % 64];
    return s;
  }
  async function challengeFor(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return b64url(digest);
  }

  function redirectUri() {
    return location.origin + location.pathname;
  }

  async function startLogin() {
    if (!configured()) return { ok: false, needSetup: true };
    const verifier = randStr(96);
    try { sessionStorage.setItem('portal_pkce_verifier', verifier); } catch (e) {}
    const challenge = await challengeFor(verifier).catch(() => null);
    if (!challenge) return { ok: false, error: 'PKCE غير مدعوم في هذا المتصفح' };
    const state = randStr(24);
    try { sessionStorage.setItem('portal_pkce_state', state); } catch (e) {}
    const u = new URL('https://www.dropbox.com/oauth2/authorize');
    u.searchParams.set('client_id', key());
    u.searchParams.set('redirect_uri', redirectUri());
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('token_access_type', 'offline');
    u.searchParams.set('scope', 'account_info.read files.content.read files.content.write');
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('state', state);
    location.href = u.toString();
    return { ok: true };
  }

  async function api(path, opts) {
    const t = loadTokens();
    if (!t) throw new Error('not-linked');
    let access = t.access_token;
    if (!access || Date.now() > (t.obtained_at || 0) + (t.expires_in - 60) * 1000) {
      access = await refresh(t);
    }
    const res = await fetch(path, Object.assign({}, opts, {
      headers: Object.assign({ Authorization: 'Bearer ' + access }, (opts && opts.headers) || {}),
    }));
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.error_summary) msg = j.error_summary; } catch (e) {}
      throw new Error(msg);
    }
    return res;
  }

  async function refresh(t) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
      client_id: key(),
    });
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: body });
    if (!res.ok) throw new Error('refresh-failed');
    const j = await res.json();
    const nt = Object.assign({}, t, { access_token: j.access_token, expires_in: j.expires_in || 14400, obtained_at: Date.now() });
    saveTokens(nt);
    return nt.access_token;
  }

  async function finishLogin(code, state) {
    let verifier = null, want = null;
    try {
      verifier = sessionStorage.getItem('portal_pkce_verifier');
      want = sessionStorage.getItem('portal_pkce_state');
      sessionStorage.removeItem('portal_pkce_verifier');
      sessionStorage.removeItem('portal_pkce_state');
    } catch (e) {}
    if (!verifier || (want && want !== state)) throw new Error('bad-state');
    const body = new URLSearchParams({
      code: code, grant_type: 'authorization_code', code_verifier: verifier,
      client_id: key(), redirect_uri: redirectUri(),
    });
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: body });
    if (!res.ok) throw new Error('exchange-failed');
    const j = await res.json();
    saveTokens({ access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in || 14400, obtained_at: Date.now() });
  }

  function collectBundle() {
    let saved = {}, history = [], bests = {};
    try { saved = JSON.parse(localStorage.getItem(LS_SAVED) || '{}') || {}; } catch (e) {}
    try { history = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]') || []; } catch (e) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(LS_BEST_PREFIX) === 0) bests[k] = JSON.parse(localStorage.getItem(k));
      }
    } catch (e) {}
    return { app: 'mcq-portal', version: 1, exportedAt: new Date().toISOString(), updatedAt: Date.now(), saved: saved, history: history, bests: bests };
  }

  function applyBundle(d) {
    if (!d || typeof d !== 'object') throw new Error('bad-bundle');
    if (d.saved && typeof d.saved === 'object') {
      try { localStorage.setItem(LS_SAVED, JSON.stringify(d.saved)); } catch (e) {}
    }
    if (Array.isArray(d.history)) {
      try { localStorage.setItem(LS_HISTORY, JSON.stringify(d.history.slice(-200))); } catch (e) {}
    }
    if (d.bests && typeof d.bests === 'object') {
      Object.keys(d.bests).forEach((k) => {
        if (k.indexOf(LS_BEST_PREFIX) === 0) {
          try { localStorage.setItem(k, JSON.stringify(d.bests[k])); } catch (e) {}
        }
      });
    }
  }

  function lastSync() {
    try { return Number(localStorage.getItem(SYNC_KEY) || 0); } catch (e) { return 0; }
  }
  function markSync() {
    try { localStorage.setItem(SYNC_KEY, String(Date.now())); } catch (e) {}
  }

  async function download() {
    const res = await api('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': JSON.stringify({ path: FILE_PATH }) },
    });
    return res.json();
  }

  async function upload(bundle) {
    await api('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: FILE_PATH, mode: { '.tag': 'overwrite' }, autorename: false, mute: true }),
      },
      body: JSON.stringify(bundle || collectBundle()),
    });
    markSync();
  }

  async function accountInfo() {
    const res = await api('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' });
    return res.json();
  }

  // Pull on link: cloud wins if newer, else push local up.
  async function pullOrPush() {
    let remote = null;
    let missing = false;
    try {
      remote = await download();
    } catch (e) {
      if (String((e && e.message) || '').indexOf('not_found') !== -1) missing = true;
      else throw e;
    }
    const local = collectBundle();
    const localCount = Object.keys(local.saved || {}).length + (local.history || []).length;
    if (missing || !remote || (remote.updatedAt || 0) <= lastSync() && localCount > 0) {
      if (localCount > 0 || missing) await upload(local);
      return { action: missing ? 'uploaded-new' : 'uploaded' };
    }
    applyBundle(remote);
    markSync();
    return { action: 'downloaded' };
  }

  function pushSoon() {
    if (!configured() || !linked() || !navigator.onLine) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      if (syncing || !navigator.onLine || !linked()) return;
      syncing = true;
      upload().catch(() => {}).then(() => {
        syncing = false;
        if (typeof global.PortalCloudUI === 'function') { try { global.PortalCloudUI(); } catch (e) {} }
      });
    }, 2000);
  }

  async function logout() {
    saveTokens(null);
    try { localStorage.removeItem(SYNC_KEY); } catch (e) {}
  }

  global.PortalCloud = {
    configured: configured,
    linked: linked,
    startLogin: startLogin,
    finishLogin: finishLogin,
    logout: logout,
    pushSoon: pushSoon,
    pullOrPush: pullOrPush,
    upload: upload,
    download: download,
    accountInfo: accountInfo,
    lastSync: lastSync,
  };
})(window);
