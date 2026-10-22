/* Portal debug tracking — always-on, lightweight, privacy-aware.
 * Ring buffer (last 120 entries) mirrored to localStorage (survives refresh,
 * so we can see what happened BEFORE a reload/white-screen).
 * Never logs: tokens, keys, full initData, passwords, message contents.
 * Safe values only: timestamps, tags, short statuses, user id.
 */
(function (global) {
  'use strict';

  var LS_KEY = 'portal_debug_log';
  var MAX_MEM = 120;
  var MAX_STORE_CHARS = 20000;
  var buf = [];

  function now() {
    try {
      var d = new Date();
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    } catch (e) { return '??:??:??'; }
  }

  function safeText(v) {
    try {
      if (typeof v === 'string') return v.slice(0, 220);
      return JSON.stringify(v).slice(0, 220);
    } catch (e) { return '[unprintable]'; }
  }

  function push(kind, tag, msg) {
    var line = now() + ' [' + kind + '] ' + tag + (msg ? ' :: ' + safeText(msg) : '');
    buf.push(line);
    if (buf.length > MAX_MEM) buf = buf.slice(buf.length - MAX_MEM);
    try {
      var all = buf.join('\n');
      if (all.length > MAX_STORE_CHARS) all = all.slice(all.length - MAX_STORE_CHARS);
      localStorage.setItem(LS_KEY, all);
    } catch (e) {}
    try {
      var el = document.getElementById('debug-output');
      if (el && !document.getElementById('debug-panel').classList.contains('hidden')) {
        el.textContent = buf.join('\n');
        el.scrollTop = el.scrollHeight;
      }
      var m = document.getElementById('debug-modal-log');
      if (m && m.offsetParent) { m.textContent = buf.join('\n'); m.scrollTop = m.scrollHeight; }
    } catch (e) {}
  }

  function info(tag, msg) { push('i', tag, msg); }
  function warn(tag, msg) { push('w', tag, msg); }
  function error(tag, msg) { push('E', tag, msg); }

  function snapshot() { return buf.join('\n'); }
  function clear() {
    buf = [];
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    try {
      var el = document.getElementById('debug-output');
      if (el) el.textContent = '';
      var m = document.getElementById('debug-modal-log');
      if (m) m.textContent = '';
    } catch (e2) {}
  }
  function restore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        buf = raw.split('\n').slice(-MAX_MEM);
        var el = document.getElementById('debug-output');
        if (el && !document.getElementById('debug-panel').classList.contains('hidden')) el.textContent = buf.join('\n');
      }
    } catch (e) {}
  }

  // ---------- reporting to the server ----------
  // Only the error lines leave the device, in small batches, and only when the
  // app is online. A handle, a question or a token is never part of a line.
  var lastReport = 0;
  var pending = [];

  function flushReport(force) {
    if (!pending.length) return;
    var now = Date.now();
    if (!force && now - lastReport < 60000) return;
    if (!navigator.onLine) return;
    lastReport = now;
    var lines = pending.splice(0, 5);
    var version = '';
    try { version = localStorage.getItem('portal_shell_version') || ''; } catch (e) {}
    try {
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: version, lines: lines }),
        keepalive: true,
      }).catch(function (e) { info('report', 'the report endpoint did not answer: ' + safeText(e && e.message)); });
    } catch (e) { /* audit-ignore: reporting is best effort */ }
  }

  function report(tag, msg) {
    try {
      pending.push(tag + ' :: ' + safeText(msg));
      if (pending.length > 20) pending = pending.slice(-20);
      flushReport(false);
    } catch (e) {}
  }

  global.PortalLog = { info: info, warn: warn, error: error, snapshot: snapshot, clear: clear, restore: restore, report: report, flush: function () { flushReport(true); } };

  // Global crash net (page errors + rejected promises). Runs always.
  try {
    window.addEventListener('error', function (ev) {
      var m = ev && ev.message ? String(ev.message) : 'unknown error';
      var where = ev && ev.filename ? String(ev.filename).split('/').pop() + ':' + (ev.lineno || '?') : '';
      error('window.onerror', m.slice(0, 200) + ' @' + where);
      report('window.onerror', m.slice(0, 160) + ' @' + where);
    }, true);
    window.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason;
      var m = r ? (r.message || String(r)) : 'unhandled rejection';
      error('unhandledrejection', String(m).slice(0, 200));
      report('unhandledrejection', String(m).slice(0, 160));
    });
  } catch (e) {}
})(window);
