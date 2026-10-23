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
  var OWNER_KEY = 'portal_data_owner_v1';

  // whose data is on this device? a different account must never inherit it
  function dataOwner() { try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; } }
  function clearPersonalData() {
    try { localStorage.removeItem(LS_HISTORY); } catch (e) {}
    try { localStorage.removeItem(LS_SAVED); } catch (e) {}
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LS_BEST_PREFIX) === 0) localStorage.removeItem(k);
      }
    } catch (e) {}
    try { localStorage.removeItem('portal_data_touched_v1'); } catch (e) {}
  }
  function ownData(id) {
    if (!id) return;
    var prev = dataOwner();
    if (prev && prev !== id) clearPersonalData();
    try { localStorage.setItem(OWNER_KEY, id); } catch (e) {}
  }
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
    invalidateClients();
    try { if (global.PortalCloudUI) global.PortalCloudUI(); } catch (e) {}
  }
  function signOut() {
    // an explicit sign-out must survive any background poll/sync
    invalidateClients();
    try {
      localStorage.removeItem(ACCOUNT_KEY);
      localStorage.removeItem(SYNC_KEY);
      // the PIN is a credential: it must not outlive the session on a shared device
      localStorage.removeItem('portal_pin_v1');
      localStorage.setItem('portal_signed_out_v1', '1');
    } catch (e) {}
    cachedUser = null;
    try { if (global.PortalCloudUI) global.PortalCloudUI(); } catch (e) {}
  }
  // the cached clients carry the account header, so they die with the identity
  function invalidateClients() {
    try { sbClientPromise = null; } catch (e) {}
    try { if (global.PortalLeague && global.PortalLeague.invalidateClient) global.PortalLeague.invalidateClient(); } catch (e) {}
    try { if (global.__sbClient) global.__sbClient = null; } catch (e) {}
  }

  function normalizeHandle(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
  }
  // the server answers with a status instead of raising, so the attempt counter
  // can commit; the client turns the status back into the old error shape
  function statusError(row, fallback) {
    var st = (row && row.status) || '';
    if (st === 'bad_pin') return new Error('bad_pin');
    if (st === 'too_many_attempts') {
      var secs = Number(row && row.retry_after) || 0;
      var mins = Math.max(1, Math.ceil(secs / 60));
      return new Error('too_many_attempts:' + mins);
    }
    if (st && st !== 'ok') return new Error(st);
    return new Error(fallback);
  }

  async function login(handle, pin, name) {
    var h = normalizeHandle(handle);
    if (h.length < 3) throw new Error('handle-short');
    if (!/^[0-9]{4}$/.test(String(pin || ''))) throw new Error('pin-format');
    var sb = await sbClient();
    var r = await sb.rpc('portal_login', { p_handle: h, p_pin: String(pin), p_name: String(name || '').trim() });
    if (r.error) throw new Error(r.error.message || 'login-failed');
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) throw new Error('login-empty');
    if (row.status && row.status !== 'ok') throw statusError(row, 'login-failed');
    if (!row.id) throw new Error('login-empty');
    setAccount({ id: row.id, handle: row.handle, name: row.name || h, avatar: row.avatar || '', at: Date.now() });
    ownData(row.id);
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
    if (row && row.status && row.status !== 'ok') throw statusError(row, 'profile-failed');
    setAccount({ id: a.id, handle: a.handle, name: (row && row.name) || a.name, avatar: (row && row.avatar) || '', at: Date.now() });
    try { lsSet('portal_pin_v1', pin); } catch (e) {}
    return account();
  }

  // the PIN is the only credential: rotating it is its own operation, not part
  // of the profile save, and the device keeps the new one on success.
  async function changePin(oldPin, newPin) {
    var a = account();
    if (!a) throw new Error('not-linked');
    var sb = await sbClient();
    var r = await sb.rpc('portal_change_pin', {
      p_handle: a.handle, p_old_pin: String(oldPin || ''), p_new_pin: String(newPin || ''),
    });
    if (r.error) throw new Error(r.error.message || 'pin-change-failed');
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    var st = (row && row.status) || 'ok';
    if (st !== 'ok') throw statusError(row, 'pin-change-failed');
    try { lsSet('portal_pin_v1', String(newPin)); } catch (e) {}
    return true;
  }

  // erase the account and everything attached to it (the student asked for it)
  // Everything the account owns on this device: history, bookmarks, best scores,
  // and the merge bookkeeping. The server copy is untouched — signing back in
  // (or linking) brings it down again.
  function clearPersonal() {
    try {
      localStorage.removeItem(LS_HISTORY);
      localStorage.removeItem(LS_SAVED);
      localStorage.removeItem('portal_data_owner_v1');
      localStorage.removeItem('portal_session_v1');
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && (k.indexOf(LS_BEST_PREFIX) === 0 || k === 'portal_data_touched_v1' ||
            k === 'portal_saved_removed_v1' || k === 'portal_history_cleared_v1')) localStorage.removeItem(k);
      }
      try { sessionStorage.removeItem('portal_session_v1'); } catch (e) {}
    } catch (e) {}
  }

  async function deleteAccount(pinOverride) {
    var a = account();
    if (!a) throw new Error('not-linked');
    var pin = String(pinOverride || lsGet('portal_pin_v1') || '');
    if (!pin) throw new Error('pin-required');
    var sb = await sbClient();
    var r = await sb.rpc('portal_delete_account', { p_handle: a.handle, p_pin: pin });
    if (r.error) throw new Error(r.error.message || 'delete-failed');
    var st = (Array.isArray(r.data) ? r.data[0] : r.data) || 'ok';
    if (st !== 'ok') throw statusError({ status: st }, 'delete-failed');
    signOut();
    clearPersonal();
    return true;
  }

  // a device approved through the link code gets the account without the pin;
  // profile edits then ask for the pin once.
  function adopt(row) {
    if (!row || !row.id) throw new Error('adopt-empty');
    try { if (localStorage.getItem('portal_signed_out_v1') === '1') return null; } catch (e) {}
    setAccount({ id: row.id, handle: row.handle, name: row.name || row.handle, avatar: row.avatar || '', at: Date.now() });
    ownData(row.id);
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
    // the timestamp of the last real change, not of this sync attempt: a device
    // that has been offline cannot overwrite newer data from another device
    var touched = 0;
    try { touched = Number(localStorage.getItem('portal_data_touched_v1')) || 0; } catch (e) {}
    var removed = {}, clearedAt = 0;
    try { removed = JSON.parse(localStorage.getItem('portal_saved_removed_v1') || '{}') || {}; } catch (e) {}
    try { clearedAt = Number(localStorage.getItem('portal_history_cleared_v1')) || 0; } catch (e) {}
    return { app: 'mcq-portal', version: 1, exportedAt: new Date().toISOString(), updatedAt: touched || Date.now(),
             saved: saved, history: history, bests: bests, removed: removed, clearedAt: clearedAt };
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
    if (d.removed && typeof d.removed === 'object') {
      try { localStorage.setItem('portal_saved_removed_v1', JSON.stringify(d.removed)); } catch (e) {}
    }
    if (d.clearedAt) {
      try { localStorage.setItem('portal_history_cleared_v1', String(Number(d.clearedAt))); } catch (e) {}
    }
    // the downloaded copy is the current state: remember its write time so the
    // next comparison is a tie and the server keeps winning it
    try { localStorage.setItem('portal_data_touched_v1', String(Number(d.updatedAt) || Date.now())); } catch (e) {}
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

  // ---------- personal payload encryption ----------
  // The history and the saved questions are encrypted on the device with a key
  // derived from the PIN (PBKDF2) and a per-account salt (the handle). The
  // server stores bytes it cannot read; the PIN never leaves the device.
  var keyCache = null;

  function b64(buf) {
    var bytes = new Uint8Array(buf), out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out);
  }
  function unb64(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function saltFor(handle) { return 'mcqquiz|' + String(handle || ''); }

  async function personalKey() {
    var a = account();
    if (!a) return null;
    var pin = String(lsGet('portal_pin_v1') || '');
    if (!/^[0-9]{4}$/.test(pin)) return null;      // a linked device without the PIN
    if (global.crypto && global.crypto.subtle) {
      var saltKey = 'k:' + a.handle + ':' + pin;
      if (keyCache && keyCache.id === saltKey) return keyCache.key;
      try {
        var enc = new TextEncoder();
        var base = await global.crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
        var key = await global.crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: enc.encode(saltFor(a.handle)), iterations: 210000, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
        keyCache = { id: saltKey, key: key };
        return key;
      } catch (e) { return null; }
    }
    return null;                                    // no WebCrypto (rare): stay in the clear
  }

  function isEnvelope(obj) {
    return !!(obj && typeof obj === 'object' && obj.enc === 1 && typeof obj.iv === 'string' && typeof obj.ct === 'string');
  }

  async function encryptBundle(bundle) {
    var key = await personalKey();
    if (!key) return null;
    try {
      var iv = global.crypto.getRandomValues(new Uint8Array(12));
      var data = new TextEncoder().encode(JSON.stringify(bundle));
      var ct = await global.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
      return { enc: 1, iv: b64(iv), ct: b64(ct) };
    } catch (e) { return null; }
  }

  async function decryptBundle(envelope) {
    var key = await personalKey();
    if (!key) return null;
    try {
      var plain = await global.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(unb64(envelope.iv)) }, key, unb64(envelope.ct));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) { return null; }                    // wrong key or tampered bytes
  }

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
      var mod = await import('./vendor/npm/supabase-js.js');
      // the RLS policies scope the personal tables to the account we act as
      var uid = '';
      try { var a = account(); uid = a ? ('u:' + a.id) : ''; } catch (e) {}
      return mod.createClient(c.url, c.key, { global: { headers: { 'x-portal-user': uid } } });
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
      var raw = (r.data && r.data.data) || null;
      if (!raw) return null;
      if (isEnvelope(raw)) {
        var plain = await decryptBundle(raw);
        // no PIN on this device, or the bytes were tampered with: keep the
        // local copy and say so instead of overwriting it with garbage
        return plain || { enc: 1, locked: true };
      }
      return raw;                                   // legacy plain row
    },
    save: async function (bundle) {
      var sb = await sbClient();
      var uid = userId();
      if (!uid) throw new Error('not-linked');
      var payload = bundle || collectBundle();
      var envelope = await encryptBundle(payload);
      // without a key (no PIN on this device) we do not put readable bytes on
      // the server: the data stays on the device until the PIN is entered
      if (!envelope) throw new Error('no-key');
      var stored = envelope;
      var res = await sb.from('portal_data').upsert({
        user_id: uid, data: stored, updated_at: new Date().toISOString(),
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
    var b = bundle || collectBundle();
    await s.save(b);
    // what just went up is now the server's copy: keep the same write time
    try { localStorage.setItem('portal_data_touched_v1', String(Number(b.updatedAt) || Date.now())); } catch (e) {}
    markSync();
  }

  // ---------- merging two copies (two devices, one account) ----------
  // Union of what both sides know, not "the newest copy replaces the other":
  // a bookmark saved on the tablet and a bookmark saved on the computer both
  // survive, the best score per quiz is the higher one, and a deliberate
  // removal (unsave / clear history) is carried as a timestamp so it is not
  // resurrected by the other device.
  function mergeBundles(a, b) {
    a = a || {}; b = b || {};
    var out = {
      app: 'mcq-portal', version: 1, exportedAt: new Date().toISOString(),
      updatedAt: Math.max(Number(a.updatedAt) || 0, Number(b.updatedAt) || 0),
    };

    var removed = {};
    [a.removed, b.removed].forEach(function (m) {
      Object.keys(m || {}).forEach(function (k) {
        removed[k] = Math.max(Number(removed[k]) || 0, Number(m[k]) || 0);
      });
    });

    var saved = {};
    [a.saved, b.saved].forEach(function (m) {
      Object.keys(m || {}).forEach(function (k) {
        var it = m[k], cur = saved[k];
        var at = Number(it && it.savedAt) || 0;
        var curAt = Number(cur && cur.savedAt) || 0;
        if (!cur || at > curAt) saved[k] = it;
      });
    });
    var now = Date.now(), old = now - 30 * 86400000;
    Object.keys(saved).forEach(function (k) {
      var rm = Number(removed[k]) || 0;
      var at = Number(saved[k] && saved[k].savedAt) || 0;
      // a removal wins only when it is newer than the item itself: re-saving a
      // question after another device removed it must bring it back
      if (rm && rm >= at) { delete saved[k]; return; }
      if (rm) delete removed[k];
    });
    Object.keys(removed).forEach(function (k) {
      if (saved[k]) { delete removed[k]; return; }
      if (Number(removed[k]) < old) delete removed[k];
    });

    var clearedAt = Math.max(Number(a.clearedAt) || 0, Number(b.clearedAt) || 0);
    var seen = {}, hist = [];
    [a.history, b.history].forEach(function (arr) {
      (arr || []).forEach(function (h) {
        if (!h || typeof h !== 'object') return;
        if (Number(h.t) && Number(h.t) <= clearedAt) return;
        var sig = [h.t, h.quizId, h.pct, h.correct, h.total].join('|');
        if (seen[sig]) return;
        seen[sig] = 1;
        hist.push(h);
      });
    });
    hist.sort(function (x, y) { return (Number(x.t) || 0) - (Number(y.t) || 0); });
    if (hist.length > 200) hist = hist.slice(-200);

    var bests = {};
    [a.bests, b.bests].forEach(function (m) {
      Object.keys(m || {}).forEach(function (k) {
        var v = m[k], cur = bests[k];
        if (!cur || Number(v && v.pct) > Number(cur && cur.pct)) bests[k] = v;
      });
    });

    out.saved = saved; out.history = hist; out.bests = bests; out.removed = removed; out.clearedAt = clearedAt;
    return out;
  }

  function sameBundle(a, b) {
    try { return JSON.stringify(a || null) === JSON.stringify(b || null); } catch (e) { return false; }
  }

  async function pullOrPush() {
    if (!linked()) throw new Error('not-linked');
    if (!activeStore()) { markSync(); return { action: 'local-only' }; }
    var remote = null;
    try { remote = await download(); } catch (e) { remote = null; }
    if (remote && remote.locked) {
      // the server copy is encrypted and this device has no PIN yet: keep the
      // local data and do not overwrite anything
      return { action: 'needs-pin' };
    }
    var local = collectBundle();
    if (!remote) {
      if (localCount() > 0) {
        try { await upload(local); return { action: 'uploaded-new' }; }
        catch (e) { if (String(e && e.message) === 'no-key') return { action: 'needs-pin' }; throw e; }
      }
      markSync();
      return { action: 'empty' };
    }
    // the two copies are merged, never swapped: neither device loses what the
    // other added while they were apart
    var merged = mergeBundles(local, remote);
    applyBundle(merged);
    if (!sameBundle(remote, merged)) {
      try { await upload(merged); return { action: 'merged-uploaded' }; }
      catch (e) { if (String(e && e.message) === 'no-key') return { action: 'needs-pin' }; throw e; }
    }
    markSync();
    return { action: 'merged' };
  }

  function pushSoon() {
    if (!linked() || !activeStore() || !navigator.onLine) return;
    // without the PIN there is no key: the encrypted server copy is not ours to
    // overwrite, so a freshly linked device waits for the unlock instead of
    // firing an upload that can only fail
    if (!/^[0-9]{4}$/.test(String(lsGet('portal_pin_v1') || ''))) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      if (syncing || !navigator.onLine || !linked() || !activeStore()) return;
      syncing = true;
      upload().catch(function (e) { try { console.warn('[sync] upload failed:', (e && e.message) || e); } catch (x) {} }).then(function () {
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
    // a device that was signed in before the owner key existed takes ownership
    // now, so a later account switch still clears the old data
    try { var a0 = account(); if (a0 && a0.id && !dataOwner()) localStorage.setItem(OWNER_KEY, a0.id); } catch (e) {}
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
    changePin: changePin,
    pinOnDevice: function () { return /^[0-9]{4}$/.test(String(lsGet('portal_pin_v1') || '')); },
    deleteAccount: deleteAccount,
    adopt: adopt,
    signOut: signOut,
    clearPersonal: clearPersonal,
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
