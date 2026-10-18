/* Portal cloud sync — Telegram WebApp identity + Telegram CloudStorage.
 * No server, no database, no OAuth dance: when the portal runs inside
 * Telegram (opened from the course bot), window.Telegram.WebApp is present,
 * the student is already identified, and data syncs to their own per-user
 * Telegram cloud. Outside Telegram everything stays device-local.
 *
 * CloudStorage limits: ~1024 keys, 4096 chars per value -> the JSON bundle
 * is chunked (~3800 chars) under keys mcq_idx + mcq_p0..mcq_pN.
 */
(function (global) {
  'use strict';

  const SYNC_KEY = 'portal_cloud_synced_at';
  const LS_BEST_PREFIX = 'portal_best_';
  const LS_SAVED = 'portal_saved_v1';
  const LS_HISTORY = 'portal_history_v1';
  const IDX_KEY = 'mcq_idx';
  const CHUNK_PREFIX = 'mcq_p';
  const CHUNK_SIZE = 3800;

  let pushTimer = null;
  let syncing = false;

  function wa() {
    try { return (global.Telegram && global.Telegram.WebApp) || null; }
    catch (e) { return null; }
  }
  function tgUser() {
    try {
      const w = wa();
      const u = w && w.initDataUnsafe && w.initDataUnsafe.user;
      return u && u.id ? u : null;
    } catch (e) { return null; }
  }
  function inTelegram() { return !!wa(); }
  function botName() {
    try { return (global.PORTAL_TG_BOT || '').trim().replace(/^@/, ''); }
    catch (e) { return ''; }
  }
  // "configured" = the account feature can do something useful:
  // either we are inside Telegram, or the owner set the bot username.
  function configured() { return inTelegram() || !!botName(); }
  function linked() { return !!tgUser(); }

  function lastSync() {
    try { return Number(localStorage.getItem(SYNC_KEY) || 0); } catch (e) { return 0; }
  }
  function markSync() {
    try { localStorage.setItem(SYNC_KEY, String(Date.now())); } catch (e) {}
  }

  function csCall(method, arg) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = wa(); } catch (e) { w = null; }
      if (!w || !w.CloudStorage || typeof w.CloudStorage[method] !== 'function') {
        reject(new Error('no-cloud'));
        return;
      }
      try {
        if (method === 'getItems' || method === 'removeItems') {
          w.CloudStorage[method](arg, (err, res) => (err ? reject(new Error(String(err))) : resolve(res)));
        } else if (method === 'getItem' || method === 'removeItem') {
          w.CloudStorage[method](arg[0], (err, res) => (err ? reject(new Error(String(err))) : resolve(res)));
        } else {
          w.CloudStorage[method](arg[0], arg[1], (err, res) => (err ? reject(new Error(String(err))) : resolve(res)));
        }
      } catch (e) { reject(e); }
    });
  }
  const csGet = (k) => csCall('getItem', [k]).then((v) => (typeof v === 'string' && v !== '' ? v : null));
  const csSet = (k, v) => csCall('setItem', [k, v]);
  const csDel = (k) => csCall('removeItem', [k]).catch(() => {});

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

  function chunkUp(str) {
    const out = [];
    for (let i = 0; i < str.length; i += CHUNK_SIZE) out.push(str.slice(i, i + CHUNK_SIZE));
    return out;
  }

  async function download() {
    const idxRaw = await csGet(IDX_KEY);
    if (!idxRaw) return null;
    let idx;
    try { idx = JSON.parse(idxRaw); } catch (e) { return null; }
    if (!idx || typeof idx.chunks !== 'number' || idx.chunks < 1) return null;
    let text = '';
    for (let i = 0; i < idx.chunks; i++) {
      const part = await csGet(CHUNK_PREFIX + i);
      if (part === null || part === undefined) throw new Error('incomplete-cloud');
      text += part;
    }
    try { return JSON.parse(text); } catch (e) { throw new Error('corrupt-cloud'); }
  }

  async function upload(bundle) {
    const payload = bundle || collectBundle();
    const text = JSON.stringify(payload);
    const parts = chunkUp(text);
    if (parts.length > 900) throw new Error('too-big');
    for (let i = 0; i < parts.length; i++) await csSet(CHUNK_PREFIX + i, parts[i]);
    await csSet(IDX_KEY, JSON.stringify({ chunks: parts.length, updatedAt: payload.updatedAt || Date.now() }));
    // best-effort cleanup of stale chunks from a previously larger bundle
    for (let i = parts.length; i < parts.length + 8; i++) await csDel(CHUNK_PREFIX + i);
    markSync();
  }

  function localCount() {
    let n = 0;
    try { n += Object.keys(JSON.parse(localStorage.getItem(LS_SAVED) || '{}') || {}).length; } catch (e) {}
    try { n += (JSON.parse(localStorage.getItem(LS_HISTORY) || '[]') || []).length; } catch (e) {}
    return n;
  }

  async function pullOrPush() {
    if (!linked()) throw new Error('not-linked');
    let remote = null;
    try { remote = await download(); } catch (e) { remote = null; }
    const rUpdated = (remote && remote.updatedAt) ? Number(remote.updatedAt) : 0;
    const localN = localCount();
    if (!remote) {
      if (localN > 0) { await upload(); return { action: 'uploaded-new' }; }
      markSync();
      return { action: 'empty' };
    }
    if (localN === 0) { applyBundle(remote); markSync(); return { action: 'downloaded' }; }
    const ls = lastSync();
    if (ls && rUpdated && rUpdated < ls) { await upload(); return { action: 'uploaded-local-newer' }; }
    if (!rUpdated || !ls || rUpdated >= ls) {
      if (rUpdated && ls && rUpdated === ls) { await upload(); return { action: 'uploaded-tie' }; }
      applyBundle(remote); markSync(); return { action: 'downloaded' };
    }
    await upload();
    return { action: 'uploaded' };
  }

  function pushSoon() {
    if (!linked() || !navigator.onLine) return;
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

  async function accountInfo() {
    const u = tgUser();
    if (!u) return null;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return { name: name || null, username: u.username || null, id: u.id };
  }

  // Telegram chrome integration (safe no-ops outside Telegram).
  function integrate() {
    let w = null;
    try { w = wa(); } catch (e) { return; }
    if (!w) return;
    try { if (typeof w.ready === 'function') w.ready(); } catch (e) {}
    try { if (typeof w.expand === 'function') w.expand(); } catch (e) {}
    try {
      if (typeof w.disableVerticalSwipes === 'function') w.disableVerticalSwipes();
    } catch (e) {}
    try {
      if (w.colorScheme && !localStorage.getItem('portal_theme')) {
        document.documentElement.setAttribute('data-theme', w.colorScheme === 'light' ? 'light' : 'dark');
      }
    } catch (e) {}
  }

  global.PortalCloud = {
    configured: configured,
    linked: linked,
    inTelegram: inTelegram,
    bot: botName,
    botLink: function () { const b = botName(); return b ? 'https://t.me/' + b + '?startapp=portal' : ''; },
    user: async function () { return tgUser(); },
    accountInfo: accountInfo,
    integrate: integrate,
    pushSoon: pushSoon,
    pullOrPush: pullOrPush,
    upload: upload,
    download: download,
    logout: async function () {},
  };
})(window);
