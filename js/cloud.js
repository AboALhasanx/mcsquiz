/* Portal cloud identity + personal sync.
 *
 * Identity (in priority order):
 *   1. Telegram WebApp bridge (window.Telegram.WebApp.initDataUnsafe.user)
 *      — native mobile/desktop clients with full Mini App support.
 *   2. tgWebAppData URL hash (#tgWebAppData=query_id..&user=..&auth_date=..&hash=..)
 *      — clients like Telegram Web K that pass init data in the fragment
 *      instead of injecting the JS bridge.
 * The hash is consumed once at load (stashed in sessionStorage, stripped
 * from the URL so the app router keeps working), and only accepted if
 * auth_date is fresher than 24h.
 *
 * Personal storage (first available wins):
 *   1. Telegram CloudStorage via the bridge (chunked mcq_idx + mcq_pN).
 *   2. Supabase table portal_data(user_id text pk, data jsonb, updated_at)
 *      (needs js/supabase-config.js filled; see PORTAL_LEAGUE_SETUP.md).
 *   3. Device localStorage only (guest / offline fallback).
 *
 * Security note (documented trade-off, friendly-group v1): hash-based
 * identity is NOT cryptographically verified client-side (that needs the
 * bot token on a server). Worst case in this app: someone opening a copied
 * link sees another name and could overwrite that row. Acceptable for a
 * 20-student study group; verify server-side before any high-stakes use.
 */
(function (global) {
  'use strict';

  var SYNC_KEY = 'portal_cloud_synced_at';
  var ACCOUNT_KEY = 'portal_account_v1';
  var LS_BEST_PREFIX = 'portal_best_';
  var LS_SAVED = 'portal_saved_v1';
  var LS_HISTORY = 'portal_history_v1';
  var LS_INIT_STASH = 'portal_tg_init';
  var IDX_KEY = 'mcq_idx';
  var CHUNK_PREFIX = 'mcq_p';
  var CHUNK_SIZE = 3800;
  var SB_CLIENT_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  var pushTimer = null;
  var syncing = false;
  var sbClientPromise = null;
  var cachedUser = null;   // {id, name, username, photo, source}
  var cachedLinked = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  function wa() {
    try { return (global.Telegram && global.Telegram.WebApp) || null; }
    catch (e) { return null; }
  }
  function bridgeUser() {
    try {
      var w = wa();
      var u = w && w.initDataUnsafe && w.initDataUnsafe.user;
      return (u && u.id) ? u : null;
    } catch (e) { return null; }
  }

  // ---- tgWebAppData hash identity (Telegram Web K and friends) ----
  function parseLaunchHash() {
    try {
      var h = String(global.location && global.location.hash || '');
      if (h.indexOf('#tgWebAppData=') !== 0) return null;
      var inner = decodeURIComponent(h.slice('#tgWebAppData='.length));
      var parts = {};
      inner.split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
      });
      if (!parts.user) return null;
      var u = JSON.parse(decodeURIComponent(parts.user));
      if (!u || !u.id) return null;
      var ageOk = true;
      if (parts.auth_date) {
        var age = Date.now() / 1000 - Number(parts.auth_date);
        if (!(age >= 0 && age < 24 * 3600)) ageOk = false;
      }
      if (!ageOk) return null;
      return { id: u.id, first_name: u.first_name, last_name: u.last_name, username: u.username, photo_url: u.photo_url, query_id: parts.query_id || null };
    } catch (e) { return null; }
  }

  function stashLaunch() {
    try {
      var u = parseLaunchHash();
      if (u) ssSet(LS_INIT_STASH, JSON.stringify({ u: u, t: Date.now() }));
    } catch (e) {}
  }
  function stashedUser() {
    try {
      var raw = ssGet(LS_INIT_STASH);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.u || !o.u.id) return null;
      return o.u;
    } catch (e) { return null; }
  }

  function tgUser() {
    if (cachedUser !== undefined && cachedUser !== null) return cachedUser;
    var u = bridgeUser();
    if (!u) u = stashedUser();
    if (!u) { try { u = parseLaunchHash(); } catch (e) { u = null; } }
    if (u) {
      cachedUser = u;
      try { global.PortalTGUser = u; } catch (e) {}
      return cachedUser;
    }
    try { global.PortalTGUser = null; } catch (e) {}
    return null;
  }
  function identitySource() {
    if (bridgeUser()) return 'bridge';
    if (stashedUser() || parseLaunchHash()) return 'hash';
    return null;
  }

  function inTelegram() { return !!wa() || !!parseLaunchHash() || !!stashedUser(); }
  function linked() { return !!account() || !!tgUser(); }
  function botName() {
    try { return (global.PORTAL_TG_BOT || '').trim().replace(/^@/, ''); }
    catch (e) { return ''; }
  }
  function configured() {
    if (inTelegram()) return true;
    var c = sbCfg();
    return !!(c.url && c.key);
  }

  function userId() {
    var a = account();
    if (a) return 'u:' + a.id;
    var u = tgUser();
    return u ? ('tg:' + String(u.id)) : null;
  }
  // ---- handle accounts (no email, no password) -------------------------------
  function account() {
    try {
      var a = JSON.parse(lsGet(ACCOUNT_KEY) || 'null');
      // avatars from older builds were removed; never point at a missing file
      if (a && a.avatar && !/^assets\/avatars\/person-\d{2}\.png$/.test(String(a.avatar))) a.avatar = '';
      return (a && a.id) ? a : null;
    } catch (e) { return null; }
  }
  function setAccount(a) {
    try { lsSet(ACCOUNT_KEY, JSON.stringify(a)); } catch (e) {}
    cachedUser = null;
    try { if (global.PortalCloudUI) global.PortalCloudUI(); } catch (e) {}
  }
  function signOut() {
    // an explicit sign-out must survive any background poll/sync
    try {
      localStorage.removeItem(ACCOUNT_KEY);
      localStorage.removeItem(SYNC_KEY);
      localStorage.setItem('portal_signed_out_v1', '1');
    } catch (e) {}
    cachedUser = null;
    try { if (global.PortalCloudUI) global.PortalCloudUI(); } catch (e) {}
  }
  function normalizeHandle(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
  }
  async function login(handle, pin, name) {
    var h = normalizeHandle(handle);
    if (h.length < 3) throw new Error('handle-short');
    if (!/^[0-9]{4}$/.test(String(pin || ''))) throw new Error('pin-format');
    var sb = await sbClient();
    var r = await sb.rpc('portal_login', { p_handle: h, p_pin: String(pin), p_name: String(name || '').trim() });
    if (r.error) throw new Error(r.error.message || 'login-failed');
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row || !row.id) throw new Error('login-empty');
    setAccount({ id: row.id, handle: row.handle, name: row.name || h, avatar: row.avatar || '', at: Date.now() });
    try { localStorage.removeItem('portal_signed_out_v1'); } catch (e) {}
    try { lsSet('portal_pin_v1', String(pin)); } catch (e) {}
    return account();
  }

  async function updateProfile(name, avatar, pinOverride) {
    var a = account();
    if (!a) throw new Error('not-linked');
    var pin = String(pinOverride || lsGet('portal_pin_v1') || '');
    if (!pin) throw new Error('pin-required');
    var sb = await sbClient();
    var r = await sb.rpc('portal_profile', {
      p_handle: a.handle, p_pin: pin, p_name: String(name || '').trim(), p_avatar: String(avatar || ''),
    });
    if (r.error) throw new Error(r.error.message || 'profile-failed');
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    setAccount({ id: a.id, handle: a.handle, name: (row && row.name) || a.name, avatar: (row && row.avatar) || '', at: Date.now() });
    try { lsSet('portal_pin_v1', pin); } catch (e) {}
    return account();
  }

  // a device approved through the link code gets the account without the pin;
  // profile edits then ask for the pin once.
  function adopt(row) {
    if (!row || !row.id) throw new Error('adopt-empty');
    try { if (localStorage.getItem('portal_signed_out_v1') === '1') return null; } catch (e) {}
    setAccount({ id: row.id, handle: row.handle, name: row.name || row.handle, avatar: row.avatar || '', at: Date.now() });
    try { localStorage.removeItem('portal_pin_v1'); } catch (e) {}
    return account();
  }

  function displayName(u) {
    var a = account();
    if (a && a.name) return a.name;
    u = u || tgUser() || {};
    var n = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    if (n) return n;
    if (u.username) return '@' + u.username;
    return 'لاعب';
  }
  // Telegram profile photo (small) when available, else '' -> callers use initials.
  function avatarUrl(u) {
    var a = account();
    if (a) return a.avatar || '';
    u = u || tgUser() || {};
    try {
      if (u.photo_url) return u.photo_url;
      if (u.photo && u.photo.small_url) return u.photo.small_url;
    } catch (e) {}
    return '';
  }

  function lastSync() {
    var v = lsGet(SYNC_KEY);
    return v ? Number(v) || 0 : 0;
  }
  function markSync() { lsSet(SYNC_KEY, String(Date.now())); }

  function collectBundle() {
    var saved = {}, history = [], bests = {};
    try { saved = JSON.parse(localStorage.getItem(LS_SAVED) || '{}') || {}; } catch (e) {}
    try { history = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]') || []; } catch (e) {}
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
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
      Object.keys(d.bests).forEach(function (k) {
        if (k.indexOf(LS_BEST_PREFIX) === 0) {
          try { localStorage.setItem(k, JSON.stringify(d.bests[k])); } catch (e) {}
        }
      });
    }
  }

  function localCount() {
    var n = 0;
    try { n += Object.keys(JSON.parse(localStorage.getItem(LS_SAVED) || '{}') || {}).length; } catch (e) {}
    try { n += (JSON.parse(localStorage.getItem(LS_HISTORY) || '[]') || []).length; } catch (e) {}
    return n;
  }

  // ---------- backend: Telegram CloudStorage (chunked) ----------
  function csCall(method, arg) {
    return new Promise(function (resolve, reject) {
      var w;
      try { w = wa(); } catch (e) { w = null; }
      if (!w || !w.CloudStorage || typeof w.CloudStorage[method] !== 'function') {
        reject(new Error('no-cloud'));
        return;
      }
      try {
        if (method === 'getItems' || method === 'removeItems') {
          w.CloudStorage[method](arg, function (err, res) { err ? reject(new Error(String(err))) : resolve(res); });
        } else if (method === 'getItem' || method === 'removeItem') {
          w.CloudStorage[method](arg[0], function (err, res) { err ? reject(new Error(String(err))) : resolve(res); });
        } else {
          w.CloudStorage[method](arg[0], arg[1], function (err, res) { err ? reject(new Error(String(err))) : resolve(res); });
        }
      } catch (e) { reject(e); }
    });
  }
  var csGet = function (k) { return csCall('getItem', [k]).then(function (v) { return (typeof v === 'string' && v !== '' ? v : null); }); };
  var csSet = function (k, v) { return csCall('setItem', [k, v]); };
  var csDel = function (k) { return csCall('removeItem', [k]).catch(function () {}); };

  function chunkUp(str) {
    var out = [];
    for (var i = 0; i < str.length; i += CHUNK_SIZE) out.push(str.slice(i, i + CHUNK_SIZE));
    return out;
  }
  function bridgeAvailable() {
    try {
      var w = wa();
      return !!(w && w.CloudStorage && typeof w.CloudStorage.getItem === 'function' && typeof w.CloudStorage.setItem === 'function');
    } catch (e) { return false; }
  }

  var bridgeStore = {
    name: 'tg-cloud',
    load: async function () {
      var idxRaw = await csGet(IDX_KEY);
      if (!idxRaw) return null;
      var idx;
      try { idx = JSON.parse(idxRaw); } catch (e) { return null; }
      if (!idx || typeof idx.chunks !== 'number' || idx.chunks < 1) return null;
      var text = '';
      for (var i = 0; i < idx.chunks; i++) {
        var part = await csGet(CHUNK_PREFIX + i);
        if (part === null || part === undefined) throw new Error('incomplete-cloud');
        text += part;
      }
      try { return JSON.parse(text); } catch (e) { throw new Error('corrupt-cloud'); }
    },
    save: async function (bundle) {
      var payload = bundle || collectBundle();
      var text = JSON.stringify(payload);
      var parts = chunkUp(text);
      if (parts.length > 900) throw new Error('too-big');
      for (var i = 0; i < parts.length; i++) await csSet(CHUNK_PREFIX + i, parts[i]);
      await csSet(IDX_KEY, JSON.stringify({ chunks: parts.length, updatedAt: payload.updatedAt || Date.now() }));
      for (var j = parts.length; j < parts.length + 8; j++) await csDel(CHUNK_PREFIX + j);
    },
  };

  // ---------- backend: Supabase portal_data (shared table, RLS-gated) ----------
  function sbCfg() {
    var c = {};
    try { c = global.PORTAL_SUPABASE || {}; } catch (e) {}
    return { url: (c.url || '').trim(), key: (c.key || '').trim() };
  }
  async function sbClient() {
    if (sbClientPromise) return sbClientPromise;
    var c = sbCfg();
    if (!c.url || !c.key) throw new Error('not-configured');
    sbClientPromise = (async function () {
      if (global.__sbClient) return global.__sbClient;
      var mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      return mod.createClient(c.url, c.key);
    })().catch(function (e) { sbClientPromise = null; throw e; });
    return sbClientPromise;
  }
  var supaStore = {
    name: 'supabase',
    load: async function () {
      var sb = await sbClient();
      var uid = userId();
      if (!uid) throw new Error('not-linked');
      var r = await sb.from('portal_data').select('data').eq('user_id', uid).maybeSingle();
      if (r.error) throw new Error(r.error.message || 'read-failed');
      return (r.data && r.data.data) || null;
    },
    save: async function (bundle) {
      var sb = await sbClient();
      var uid = userId();
      if (!uid) throw new Error('not-linked');
      var payload = bundle || collectBundle();
      var res = await sb.from('portal_data').upsert({
        user_id: uid, data: payload, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (res.error) throw new Error(res.error.message || 'write-failed');
    },
  };

  function activeStore() {
    if (bridgeAvailable()) return bridgeStore;
    var c = sbCfg();
    if (c.url && c.key) return supaStore;
    return null;
  }

  async function download() {
    var s = activeStore();
    if (!s) throw new Error('no-store');
    return s.load();
  }
  async function upload(bundle) {
    var s = activeStore();
    if (!s) throw new Error('no-store');
    await s.save(bundle || collectBundle());
    markSync();
  }

  async function pullOrPush() {
    if (!linked()) throw new Error('not-linked');
    if (!activeStore()) { markSync(); return { action: 'local-only' }; }
    var remote = null;
    try { remote = await download(); } catch (e) { remote = null; }
    var rUpdated = (remote && remote.updatedAt) ? Number(remote.updatedAt) : 0;
    var localN = localCount();
    if (!remote) {
      if (localN > 0) { await upload(); return { action: 'uploaded-new' }; }
      markSync();
      return { action: 'empty' };
    }
    if (localN === 0) { applyBundle(remote); markSync(); return { action: 'downloaded' }; }
    var local = collectBundle();
    var lUpdated = Number(local.updatedAt) || 0;
    // newest write wins; on a tie the server copy wins (online is the source of truth)
    if (lUpdated && rUpdated && lUpdated > rUpdated) { await upload(local); return { action: 'uploaded-local-newer' }; }
    if (!rUpdated || lUpdated <= rUpdated) {
      applyBundle(remote); markSync(); return { action: 'downloaded' };
    }
    await upload();
    return { action: 'uploaded' };
  }

  function pushSoon() {
    if (!linked() || !activeStore() || !navigator.onLine) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      if (syncing || !navigator.onLine || !linked() || !activeStore()) return;
      syncing = true;
      upload().catch(function () {}).then(function () {
        syncing = false;
        if (typeof global.PortalCloudUI === 'function') { try { global.PortalCloudUI(); } catch (e) {} }
      });
    }, 2000);
  }

  async function accountInfo() {
    var u = tgUser();
    if (!u) return null;
    var name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return { name: name || null, username: u.username || null, id: u.id, photo: avatarUrl(u) };
  }

  function integrate() {
    var w = null;
    try { w = wa(); } catch (e) { return; }
    if (!w) return;
    try { if (typeof w.ready === 'function') w.ready(); } catch (e) {}
    try { if (typeof w.expand === 'function') w.expand(); } catch (e) {}
    try { if (typeof w.disableVerticalSwipes === 'function') w.disableVerticalSwipes(); } catch (e) {}
    try {
      if (w.colorScheme && !localStorage.getItem('portal_theme')) {
        document.documentElement.setAttribute('data-theme', w.colorScheme === 'light' ? 'light' : 'dark');
      }
    } catch (e) {}
  }

  function captureLaunch() {
    try {
      var h = String((global.location && global.location.hash) || '');
      if (h.indexOf('#tgWebAppData=') === 0) {
        try {
          var u = parseLaunchHash();
          if (u) ssSet(LS_INIT_STASH, JSON.stringify({ u: u, t: Date.now() }));
        } catch (e2) {}
        try {
          if (global.history && global.history.replaceState) {
            global.history.replaceState(null, '', global.location.pathname + global.location.search);
          }
        } catch (e3) {}
        cachedUser = undefined;
      }
    } catch (e) {}
  }
  // run at script load (script order: cloud.js before app.js boot)
  try { captureLaunch(); } catch (e) {}

  // ---- Supabase identity is the same Telegram user; leaderboard reuses it ----
  global.PortalCloud = {
    configured: function () {
      if (inTelegram()) return true;
      var c = sbCfg();
      return !!(c.url && c.key);
    },
    linked: linked,
    inTelegram: inTelegram,
    identitySource: identitySource,
    bot: botName,
    botLink: function () { var b = botName(); return b ? 'https://t.me/' + b : ''; },
    user: async function () { return tgUser(); },
    accountInfo: accountInfo,
    account: account,
    userId: userId,
    login: login,
    updateProfile: updateProfile,
    adopt: adopt,
    signOut: signOut,
    normalizeHandle: normalizeHandle,
    sb: sbClient,
    avatarUrl: avatarUrl,
    integrate: integrate,
    captureLaunch: captureLaunch,
    pushSoon: pushSoon,
    pullOrPush: pullOrPush,
    upload: upload,
    download: download,
    lastSync: lastSync,
    storeName: function () { var s = activeStore(); return s ? s.name : 'local'; },
    logout: async function () {},
  };
})(window);
