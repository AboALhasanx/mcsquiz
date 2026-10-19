/* Shared weekly league (Duolingo-style) on Supabase — one public table.
 * Identity comes from Telegram WebApp (no passwords): user_id = 'tg:<id>'.
 * XP = 1 per correct answer, computed from the local history journal.
 * Week starts Monday (week_id = Monday date 'YYYY-MM-DD').
 * Everything degrades gracefully offline / unconfigured / guest.
 */
(function (global) {
  'use strict';

  var CLIENT_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
  var LS_BEST_PREFIX = 'portal_best_';
  var LS_SAVED = 'portal_saved_v1';
  var LS_HISTORY = 'portal_history_v1';

  var clientPromise = null;
  var injectedClient = null;
  var myId = null;

  function cfg() {
    var c = global.PORTAL_SUPABASE || {};
    return { url: (c.url || '').trim(), key: (c.key || '').trim() };
  }
  function configured() {
    var c = cfg();
    return !!(c.url && c.key);
  }

  function _setClient(c) { injectedClient = c; clientPromise = null; }

  async function client() {
    if (injectedClient) return injectedClient;
    if (!clientPromise) {
      clientPromise = (async function () {
        var c = cfg();
        if (!c.url || !c.key) throw new Error('not-configured');
        var mod = await import(CLIENT_URL);
        return mod.createClient(c.url, c.key);
      })().catch(function (e) { clientPromise = null; throw e; });
    }
    return clientPromise;
  }

  function tgUser() {
    try {
      var w = global.Telegram && global.Telegram.WebApp;
      var u = w && w.initDataUnsafe && w.initDataUnsafe.user;
      if (u && u.id) return u;
    } catch (e) {}
    try {
      var g = global.PortalTGUser;
      if (g && g.id) return g;
    } catch (e2) {}
    return null;
  }
  function linked() { return !!tgUser(); }

  function myUserId() {
    if (myId) return myId;
    var u = tgUser();
    if (!u) return null;
    myId = 'tg:' + String(u.id);
    return myId;
  }

  function displayName(u) {
    var n = [u && u.first_name, u && u.last_name].filter(Boolean).join(' ').trim();
    if (n) return n;
    if (u && u.username) return '@' + u.username;
    return 'لاعب';
  }
  function avatarOf(u) {
    u = u || tgUser() || {};
    try {
      if (u.photo_url) return u.photo_url;
      if (u.photo && u.photo.small_url) return u.photo.small_url;
    } catch (e) {}
    return '';
  }

  function weekStart(d) {
    var t = d ? new Date(d) : new Date();
    var day = (t.getDay() + 6) % 7; // Monday=0
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - day);
    var m = '' + (t.getMonth() + 1), dd = '' + t.getDate();
    return t.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (dd.length < 2 ? '0' + dd : dd);
  }

  function xpFromHistory(history, weekId) {
    var total = 0, bySub = {};
    (history || []).forEach(function (h) {
      var c = Number(h.correct) || 0;
      total += c;
      var sid = h.subjectId || '؟';
      if (!bySub[sid]) bySub[sid] = { title: h.subjectTitle || sid, xp: 0, n: 0 };
      bySub[sid].xp += c;
      bySub[sid].n += 1;
    });
    return { total: total, bySub: bySub };
  }

  function weeklyXp(history, weekId) {
    var monday = new Date(weekId + 'T00:00:00');
    var end = new Date(monday.getTime() + 7 * 86400000);
    var total = 0, bySub = {};
    (history || []).forEach(function (h) {
      var t = Number(h.t) || 0;
      if (t < monday.getTime() || t >= end.getTime()) return;
      var c = Number(h.correct) || 0;
      total += c;
      var sid = h.subjectId || '؟';
      if (!bySub[sid]) bySub[sid] = { title: h.subjectTitle || sid, xp: 0, n: 0 };
      bySub[sid].xp += c;
      bySub[sid].n += 1;
    });
    return { total: total, bySub: bySub };
  }

  function loadLocal() {
    var saved = {}, history = [], bests = {};
    try { saved = JSON.parse(localStorage.getItem(LS_SAVED) || '{}') || {}; } catch (e) {}
    try { history = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]') || []; } catch (e) {}
    return { saved: saved, history: history, bests: bests };
  }

  async function syncWeek() {
    if (!configured() || !linked() || !navigator.onLine) return { ok: false, reason: 'offline-or-unlinked' };
    var sb = await client();
    var u = tgUser();
    var wid = weekStart(Date.now());
    var local = loadLocal();
    var w = weeklyXp(local.history, wid);
    var row = {
      user_id: myUserId(),
      week_id: wid,
      name: displayName(u).slice(0, 40),
      username: (u.username || '').slice(0, 40),
      avatar: avatarOf(u).slice(0, 300),
      hidden: await isHidden(sb, myUserId(), wid),
      xp: Math.max(0, Math.min(5000, w.total)),
      per_subject: w.bySub,
      updated_at: new Date().toISOString(),
    };
    var res = await sb.from('league_xp').upsert(row, { onConflict: 'user_id,week_id' });
    if (res.error) throw new Error(res.error.message || 'upsert-failed');
    return { ok: true, xp: row.xp };
  }

  async function isHidden(sb, uid, wid) {
    try {
      var r = await sb.from('league_xp').select('hidden').eq('user_id', uid).eq('week_id', wid).maybeSingle();
      return !!(r.data && r.data.hidden);
    } catch (e) { return false; }
  }

  async function setHidden(hidden) {
    var sb = await client();
    var uid = myUserId();
    if (!uid) throw new Error('not-linked');
    var wid = weekStart(Date.now());
    var local = loadLocal();
    var w = weeklyXp(local.history, wid);
    var u = tgUser() || {};
    var res = await sb.from('league_xp').upsert({
      user_id: uid, week_id: wid,
      name: displayName(u).slice(0, 40), username: (u.username || '').slice(0, 40), avatar: avatarOf(u).slice(0, 300),
      hidden: !!hidden, xp: Math.max(0, Math.min(5000, w.total)), per_subject: w.bySub,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,week_id' });
    if (res.error) throw new Error(res.error.message || 'upsert-failed');
    return true;
  }

  async function myRow(wid) {
    try {
      var sb = await client();
      var uid = myUserId();
      if (!uid) return null;
      var r = await sb.from('league_xp').select('*').eq('user_id', uid).eq('week_id', wid || weekStart(Date.now())).maybeSingle();
      return r.data || null;
    } catch (e) { return null; }
  }

  async function board(weekId, subjectId) {
    var sb = await client();
    var r = await sb.from('league_xp').select('*').eq('week_id', weekId || weekStart(Date.now())).eq('hidden', false).order('xp', { ascending: false }).limit(100);
    if (r.error) throw new Error(r.error.message || 'read-failed');
    var rows = (r.data || []).map(function (x, i) {
      var xp = subjectId && x.per_subject && x.per_subject[subjectId] ? (Number(x.per_subject[subjectId].xp) || 0) : Number(x.xp) || 0;
      return { rank: 0, user_id: x.user_id, name: x.name || 'لاعب', username: x.username || '', xp: xp, per_subject: x.per_subject || {}, updated_at: x.updated_at };
    });
    if (subjectId) rows.sort(function (a, b) { return b.xp - a.xp; });
    rows.forEach(function (x, i) { x.rank = i + 1; });
    return rows;
  }

  function shareText(me, boardRows, scopeLabel) {
    var lines = boardRows.slice(0, 3).map(function (r) {
      return r.rank + '. ' + r.name + ' — ' + r.xp + ' نقطة';
    });
    return 'دوري MSCQuiz · ' + scopeLabel + '\n' + lines.join('\n') +
      (me ? '\nترتيبي: ' + me.rank + ' بـ ' + me.xp + ' نقطة' : '');
  }

  global.PortalLeague = {
    configured: configured,
    linked: linked,
    weekStart: weekStart,
    weeklyXp: weeklyXp,
    xpFromHistory: xpFromHistory,
    syncWeek: syncWeek,
    setHidden: setHidden,
    myRow: myRow,
    board: board,
    shareText: shareText,
    displayName: displayName,
    _setClient: _setClient,
    loadLocal: loadLocal,
  };
})(window);
