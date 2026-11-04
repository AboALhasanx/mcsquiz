/* MCQ Portal — review.js
 * Spaced Repetition (Leitner System), Weak Questions Tracker, and Study Days Journal.
 * Pure logic, deterministic, fully isolated from league XP and history pollution.
 */
(function (global) {
  'use strict';

  var REVIEW_KEY = 'portal_review_v1';
  var DAYS_KEY = 'portal_days_v1';
  var INTERVALS = [1, 3, 7, 14, 30, 90];
  var MAX_BOX = 5;
  var MAX_FUTURE_DAYS = 120;

  // FNV-1a 32-bit content hash of stem + correct answer text
  function contentHash(stem, correctText) {
    var str = String(stem || '').trim() + '|||' + String(correctText || '').trim();
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    var hex = (h >>> 0).toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return hex;
  }

  // Integer day count in local calendar
  function today(ts) {
    var d = ts ? new Date(ts) : new Date();
    var localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.floor(localMidnight / 86400000);
  }

  function formatDayKey(dateOrTs) {
    var d = dateOrTs instanceof Date ? dateOrTs : new Date(dateOrTs || Date.now());
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  // Schedule an item according to Leitner rules
  function schedule(record, isCorrect, todayVal) {
    var t = (typeof todayVal === 'number') ? todayVal : today();
    var cur = record || { b: 0, d: 0, n: 0, w: 0, u: 0, h: '' };
    var n = (Number(cur.n) || 0) + 1;
    var b = Number(cur.b) || 0;
    var w = Number(cur.w) || 0;
    var d = Number(cur.d) || 0;

    if (!isCorrect) {
      w += 1;
      b = 0;
      d = t + INTERVALS[0]; // due tomorrow
    } else {
      var isDue = d <= t;
      if (isDue) {
        b = Math.min(b + 1, MAX_BOX);
        d = t + INTERVALS[b];
      }
      // If not due: anti-exploitation, b and d remain unchanged
    }

    // Safety guard against clock manipulation or future drift
    d = Math.min(d, t + MAX_FUTURE_DAYS);

    return {
      b: b,
      d: d,
      n: n,
      w: w,
      u: Date.now(),
      h: cur.h || ''
    };
  }

  function isOrphan(record, currentHash) {
    if (!record || !record.h || !currentHash) return false;
    return record.h !== currentHash;
  }

  function getWeakKeys(store) {
    var s = store || {};
    var keys = Object.keys(s).filter(function (k) {
      var r = s[k];
      return r && Number(r.w) >= 1 && Number(r.n) > 0;
    });

    keys.sort(function (k1, k2) {
      var r1 = s[k1];
      var r2 = s[k2];
      var ratio1 = r1.w / r1.n;
      var ratio2 = r2.w / r2.n;
      if (ratio2 !== ratio1) return ratio2 - ratio1; // highest error ratio first
      if (r2.w !== r1.w) return r2.w - r1.w;         // more errors first
      return (Number(r1.u) || 0) - (Number(r2.u) || 0);
    });

    return keys;
  }

  function getDueKeys(store, todayVal) {
    var t = (typeof todayVal === 'number') ? todayVal : today();
    var s = store || {};
    var keys = Object.keys(s).filter(function (k) {
      var r = s[k];
      return r && Number(r.d) <= t;
    });

    keys.sort(function (k1, k2) {
      var r1 = s[k1];
      var r2 = s[k2];
      return (Number(r1.d) || 0) - (Number(r2.d) || 0); // most overdue first
    });

    return keys;
  }

  // Merge two review stores commutatively and idempotently
  function mergeStores(a, b) {
    var s1 = a || {};
    var s2 = b || {};
    var out = {};
    var allKeys = Object.keys(s1);
    Object.keys(s2).forEach(function (k) {
      if (allKeys.indexOf(k) === -1) allKeys.push(k);
    });

    allKeys.sort();
    allKeys.forEach(function (k) {
      var r1 = s1[k];
      var r2 = s2[k];
      if (r1 && !r2) {
        out[k] = Object.assign({}, r1);
      } else if (!r1 && r2) {
        out[k] = Object.assign({}, r2);
      } else if (r1 && r2) {
        var u1 = Number(r1.u) || 0;
        var u2 = Number(r2.u) || 0;
        if (u1 > u2) {
          out[k] = Object.assign({}, r1);
        } else if (u2 > u1) {
          out[k] = Object.assign({}, r2);
        } else {
          // Tie on u: higher n wins
          var n1 = Number(r1.n) || 0;
          var n2 = Number(r2.n) || 0;
          if (n1 > n2) {
            out[k] = Object.assign({}, r1);
          } else if (n2 > n1) {
            out[k] = Object.assign({}, r2);
          } else {
            var w1 = Number(r1.w) || 0;
            var w2 = Number(r2.w) || 0;
            if (w1 > w2) out[k] = Object.assign({}, r1);
            else if (w2 > w1) out[k] = Object.assign({}, r2);
            else out[k] = Object.assign({}, r1);
          }
        }
      }
    });

    return out;
  }

  function mergeDays(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { out[k] = true; });
    Object.keys(b || {}).forEach(function (k) { out[k] = true; });
    return out;
  }

  function computeCombinedStreak(history, daysStore, nowTs) {
    var days = {};
    (history || []).forEach(function (h) {
      if (h && h.t) days[formatDayKey(h.t)] = true;
    });
    Object.keys(daysStore || {}).forEach(function (k) {
      days[k] = true;
    });

    var cur = new Date(nowTs || Date.now());
    var todayKey = formatDayKey(cur);

    // If today is answered, start streak from today. Otherwise start from yesterday.
    var streak = 0;
    var pointer = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
    if (!days[todayKey]) {
      pointer.setDate(pointer.getDate() - 1);
    }

    while (true) {
      var k = formatDayKey(pointer);
      if (days[k]) {
        streak += 1;
        pointer.setDate(pointer.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(REVIEW_KEY, JSON.stringify(store || {}));
      localStorage.setItem('portal_data_touched_v1', String(Date.now()));
    } catch (e) {}
  }

  function loadDays() {
    try {
      return JSON.parse(localStorage.getItem(DAYS_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function saveDays(days) {
    try {
      localStorage.setItem(DAYS_KEY, JSON.stringify(days || {}));
      localStorage.setItem('portal_data_touched_v1', String(Date.now()));
    } catch (e) {}
  }

  function markTodayStudy() {
    var days = loadDays();
    var key = formatDayKey(Date.now());
    if (!days[key]) {
      days[key] = true;
      saveDays(days);
    }
  }

  function recordAnswer(key, hash, isCorrect, opts) {
    if (!key) return null;
    var store = loadStore();
    var rec = store[key] || { b: 0, d: 0, n: 0, w: 0, u: 0, h: hash || '' };
    if (hash) rec.h = hash;
    var next = schedule(rec, isCorrect);
    next.h = hash || rec.h || '';
    store[key] = next;
    saveStore(store);

    if (opts && opts.markStudyDay) {
      markTodayStudy();
    }
    return next;
  }

  function getStats(store, todayVal) {
    var t = (typeof todayVal === 'number') ? todayVal : today();
    var s = store || loadStore();
    var keys = Object.keys(s);
    var dueCount = 0;
    var weakCount = 0;
    var boxes = [0, 0, 0, 0, 0, 0];

    keys.forEach(function (k) {
      var r = s[k];
      if (!r) return;
      if (Number(r.d) <= t) dueCount += 1;
      if (Number(r.w) >= 1 && Number(r.n) > 0) weakCount += 1;
      var b = Math.min(Math.max(Number(r.b) || 0, 0), MAX_BOX);
      boxes[b] += 1;
    });

    return {
      total: keys.length,
      due: dueCount,
      weak: weakCount,
      boxes: boxes
    };
  }

  global.PortalReview = {
    contentHash: contentHash,
    today: today,
    formatDayKey: formatDayKey,
    schedule: schedule,
    isOrphan: isOrphan,
    getWeakKeys: getWeakKeys,
    getDueKeys: getDueKeys,
    mergeStores: mergeStores,
    mergeDays: mergeDays,
    computeCombinedStreak: computeCombinedStreak,
    loadStore: loadStore,
    saveStore: saveStore,
    loadDays: loadDays,
    saveDays: saveDays,
    markTodayStudy: markTodayStudy,
    recordAnswer: recordAnswer,
    getStats: getStats,
    INTERVALS: INTERVALS,
    MAX_BOX: MAX_BOX
  };

})(typeof window !== 'undefined' ? window : this);
