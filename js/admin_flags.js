/* MCQ Portal — Admin Question Flags & QA Tool
 * Strictly restricted to account handle 'aboalhasan'.
 * Stores flagged question defects, tags, and notes locally and in encrypted cloud bundle.
 * Exports structured JSON for AI agent remediation in the vault.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'portal_flags_v1';
  var ADMIN_HANDLE = 'aboalhasan';

  function isAdmin() {
    try {
      var acc = null;
      if (global.PortalCloud && typeof global.PortalCloud.account === 'function') {
        acc = global.PortalCloud.account();
      }
      if (!acc) {
        var raw = localStorage.getItem('portal_account_v1');
        if (raw) acc = JSON.parse(raw);
      }
      return !!(acc && acc.handle && String(acc.handle).trim().toLowerCase() === ADMIN_HANDLE);
    } catch (e) {
      return false;
    }
  }

  function getAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveAll(flags) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(flags || {}));
      if (global.PortalCloud && typeof global.PortalCloud.markNeedsSync === 'function') {
        global.PortalCloud.markNeedsSync();
      }
    } catch (e) {}
  }

  function getFlag(key) {
    if (!key) return null;
    var all = getAll();
    return all[key] || null;
  }

  function setFlag(key, data) {
    if (!key || !data) return null;
    var all = getAll();
    all[key] = Object.assign({}, data, {
      key: key,
      updatedAt: Date.now()
    });
    saveAll(all);
    return all[key];
  }

  function removeFlag(key) {
    if (!key) return false;
    var all = getAll();
    if (all[key]) {
      delete all[key];
      saveAll(all);
      return true;
    }
    return false;
  }

  function count() {
    return Object.keys(getAll()).length;
  }

  function clearAll() {
    saveAll({});
  }

  function exportPayload() {
    var all = getAll();
    var list = Object.keys(all).map(function (k) { return all[k]; });
    // sort newest first
    list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return {
      app: 'mcq-portal',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      admin: ADMIN_HANDLE,
      totalCount: list.length,
      flags: list
    };
  }

  function downloadJson() {
    var payload = exportPayload();
    var jsonText = JSON.stringify(payload, null, 2);
    var blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = 'mcq_flags_' + ts + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    return payload;
  }

  global.PortalAdminFlags = {
    isAdmin: isAdmin,
    getAll: getAll,
    getFlag: getFlag,
    setFlag: setFlag,
    removeFlag: removeFlag,
    count: count,
    clearAll: clearAll,
    exportPayload: exportPayload,
    downloadJson: downloadJson
  };
})(window);
