/* MCQ Portal — stats_ui.js
 * Statistics Ledger, Monotone Cubic Spline Area Chart & Paginated History Log UI module.
 */
(function (global) {
  'use strict';

  function createStatsUI(ctx) {
    ctx = ctx || {};
    var $ = ctx.$ || function (id) { return document.getElementById(id); };
    var S = ctx.S || {};
    var HISTORY_KEY = ctx.HISTORY_KEY || 'portal_history_v1';
    var escapeHtml = ctx.escapeHtml || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var arCount = ctx.arCount || function (n) { return String(n); };
    var icons = ctx.icons || function () { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); };
    var toast = ctx.toast || function (msg, type) { if (window.toast) window.toast(msg, type); };
    var touchData = ctx.touchData || function () {};
    var persistSaved = ctx.persistSaved || function () {};
    var writeSavedRemoved = ctx.writeSavedRemoved || function () {};
    var updateSavedBadge = ctx.updateSavedBadge || function () {};
    var updateMenuCounts = ctx.updateMenuCounts || function () {};

    var STATS_RANGES = [1, 7, 30, 0];
    var PASS_MARK = 60;

    function pctClass(p) { return p >= 75 ? 'good' : (p >= 60 ? 'mid' : 'bad'); }

    function fmtDur(s) {
      s = Math.round(Number(s) || 0);
      var h = Math.floor(s / 3600);
      var m = Math.floor((s % 3600) / 60);
      if (h > 0) {
        return m > 0 ? (h + ' س ' + m + ' د') : (h + ' س');
      }
      var sec = s % 60;
      return m > 0 ? (m + ' د' + (sec > 0 ? ' ' + sec + ' ث' : '')) : (sec + ' ث');
    }

    function collectBests() {
      var out = {};
      for (var i = 0; i < localStorage.length; i++) {
        try {
          var k = localStorage.key(i);
          if (k && k.indexOf('portal_best_') === 0) {
            var bv = JSON.parse(localStorage.getItem(k));
            if (bv && typeof bv === 'object') out[k] = bv;
          }
        } catch (e) {} // audit-ignore: optional localStorage key read
      }
      return out;
    }

    function clearHistory() {
      S.history = [];
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) {} // audit-ignore: optional storage clear
      try { localStorage.setItem('portal_history_cleared_v1', String(Date.now())); } catch (e) {} // audit-ignore: optional storage write
      touchData();
    }

    function statsRange() {
      var r = Number(S.statsRange);
      return STATS_RANGES.indexOf(r) >= 0 ? r : 30;
    }

    function statsBand(pct) {
      if (pct >= 85) return 'good';
      if (pct >= PASS_MARK) return 'ok';
      return 'low';
    }

    function dayKey(t) {
      var d = new Date(t || 0);
      return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    }

    function shortDay(t) {
      try {
        return new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' }).format(new Date(t || 0));
      } catch (e) { return ''; } // audit-ignore: Intl fallback
    }

    function dayLabel(t) {
      var d = new Date(t || 0);
      var today = new Date();
      var startOf = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
      var diff = Math.round((startOf(today) - startOf(d)) / 86400000);
      if (diff === 0) return 'اليوم';
      if (diff === 1) return 'أمس';
      if (diff === 2) return 'أمس قبل أمس';
      var df = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long' });
      return df.format(d);
    }

    function streakDays(items) {
      if (!items || !items.length) return 0;
      var days = {};
      items.forEach(function (h) {
        if (h && h.t) days[dayKey(h.t)] = true;
      });
      var streak = 0;
      var cur = new Date();
      if (!days[dayKey(cur.getTime())]) cur.setDate(cur.getDate() - 1);
      while (days[dayKey(cur.getTime())]) {
        streak++;
        cur.setDate(cur.getDate() - 1);
      }
      return streak;
    }

    function buildTrendNodes(items, days) {
      if (!items.length) return { nodes: [], subtitle: 'لا توجد محاولات في هذه الفترة' };

      var fmtTime = function (ts) {
        try {
          var d = new Date(ts || 0);
          return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        } catch (e) { return ''; } // audit-ignore: time format fallback
      };

      var uniqueDays = [];
      var byDay = {};
      items.forEach(function (h) {
        if (!h) return;
        var k = dayKey(h.t || 0);
        if (!byDay[k]) {
          byDay[k] = { key: k, t: h.t || 0, rows: [] };
          uniqueDays.push(byDay[k]);
        }
        byDay[k].rows.push(h);
      });

      if (days === 1 || uniqueDays.length <= 2) {
        var recent = items.slice(-10);
        var prevD = '';
        var nodes = recent.map(function (h, idx) {
          var dStr = shortDay(h.t);
          var tStr = fmtTime(h.t);
          var label = tStr;
          if (uniqueDays.length > 1 && (idx === 0 || dStr !== prevD)) {
            label = dStr + ' ' + tStr;
          }
          prevD = dStr;
          return {
            pct: Math.max(0, Math.min(100, h.pct || 0)),
            label: label,
            tooltip: (h.topic || '') + ' · ' + Math.round(h.pct || 0) + '% (' + dStr + ' ' + tStr + ')'
          };
        });
        var subPrefix = days === 1
          ? 'محاولات اليوم'
          : (uniqueDays.length === 1 ? ('محاولات ' + dayLabel(uniqueDays[0].t)) : 'أحدث المحاولات');
        var countText = items.length > 10
          ? ('آخر 10 من ' + items.length + ' محاولة')
          : arCount(items.length, { one: 'محاولة واحدة', two: 'محاولتان', few: 'محاولات', many: 'محاولة' });
        return { nodes: nodes, subtitle: subPrefix + ' · ' + countText };
      }

      if (uniqueDays.length <= 12) {
        var dailyNodes = uniqueDays.map(function (g) {
          var avgPct = g.rows.reduce(function (s, r) { return s + (r.pct || 0); }, 0) / g.rows.length;
          var dStr = shortDay(g.t);
          var cnt = arCount(g.rows.length, { one: 'محاولة', two: 'محاولتان', few: 'محاولات', many: 'محاولة' });
          return {
            pct: Math.max(0, Math.min(100, avgPct)),
            label: dStr,
            tooltip: dStr + ' · المتوسط ' + Math.round(avgPct) + '% (' + cnt + ')'
          };
        });
        var rangeTag = days === 7 ? 'آخر 7 أيام' : (days === 30 ? 'آخر 30 يوماً' : 'كل السجل');
        return {
          nodes: dailyNodes,
          subtitle: 'المتوسط اليومي · ' + rangeTag + ' (' + arCount(uniqueDays.length, { one: 'يوم نشاط', two: 'يوما نشاط', few: 'أيام نشاط', many: 'يوم نشاط' }) + ')'
        };
      }

      var BUCKETS = 10;
      var chunkSize = Math.ceil(uniqueDays.length / BUCKETS);
      var bucketNodes = [];
      for (var i = 0; i < uniqueDays.length; i += chunkSize) {
        var slice = uniqueDays.slice(i, i + chunkSize);
        var allRows = [];
        slice.forEach(function (g) { g.rows.forEach(function (r) { allRows.push(r); }); });
        var avgPct = allRows.reduce(function (s, r) { return s + (r.pct || 0); }, 0) / allRows.length;
        var firstD = shortDay(slice[0].t);
        var lastD = shortDay(slice[slice.length - 1].t);
        bucketNodes.push({
          pct: Math.max(0, Math.min(100, avgPct)),
          label: lastD,
          tooltip: (firstD === lastD ? firstD : (firstD + ' – ' + lastD)) + ' · المتوسط ' + Math.round(avgPct) + '% (' + allRows.length + ' محاولة)'
        });
      }
      return {
        nodes: bucketNodes,
        subtitle: 'المتوسط المرحلي عبر ' + uniqueDays.length + ' يوم نشاط (' + items.length + ' محاولة)'
      };
    }

    function renderStats() {
      try {
        var h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        if (Array.isArray(h)) S.history = h;
      } catch (e) {} // audit-ignore: optional localStorage read
      var rawList = Array.isArray(S.history) ? S.history : [];
      var cleanList = rawList.filter(function (it) {
        return it && typeof it === 'object';
      });
      var ALL = cleanList.slice().sort(function (a, b) {
        return ((a && a.t) || 0) - ((b && b.t) || 0);
      });
      var days = statsRange();
      var nowTs = Date.now();
      var todayStart = (function () {
        var d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      })();
      var H = days === 1
        ? ALL.filter(function (h) { return (h.t || 0) >= todayStart; })
        : (days ? ALL.filter(function (h) { return (nowTs - (h.t || 0)) <= days * 86400000; }) : ALL);
      var prev = days === 1
        ? ALL.filter(function (h) { return (h.t || 0) >= (todayStart - 86400000) && (h.t || 0) < todayStart; })
        : (days
          ? ALL.filter(function (h) {
            var age = nowTs - (h.t || 0);
            return age > days * 86400000 && age <= days * 2 * 86400000;
          })
          : []);

      document.querySelectorAll('.range-opt').forEach(function (b) {
        var on = Number(b.dataset.range) === days;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      var n = H.length;
      var totQ = H.reduce(function (a, h) { return a + (h.correct || 0); }, 0);
      var totTried = H.reduce(function (a, h) { return a + (h.total || 0); }, 0);
      var totSecs = H.reduce(function (a, h) { return a + (h.secs || 0); }, 0);
      var avg = n ? H.reduce(function (a, h) { return a + (h.pct || 0); }, 0) / n : 0;
      var prevAvg = prev.length ? prev.reduce(function (a, h) { return a + (h.pct || 0); }, 0) / prev.length : null;
      var rangeName = days === 1 ? 'اليوم' : (days === 7 ? 'آخر 7 أيام' : (days === 30 ? 'آخر 30 يوماً' : 'كل السجل'));

      $('stats-total-line').textContent = '';

      var empty = $('stats-empty');
      var hasAny = ALL.length > 0;
      if (empty) empty.classList.toggle('hidden', hasAny);
      var ledger = document.querySelector('.stats-ledger');
      if (ledger) ledger.classList.toggle('hidden', !hasAny);
      ['stats-hero', 'stats-overall', 'stats-trend', 'stats-insight', 'stats-subjects', 'history-section'].forEach(function (id) {
        var el = $(id);
        if (el) el.classList.toggle('hidden', !hasAny);
      });
      var trendBlock = document.querySelector('#stats-trend') ? document.querySelector('#stats-trend').closest('.stats-block') : null;
      if (trendBlock) trendBlock.classList.toggle('hidden', !hasAny);
      var subsBlock = document.querySelector('#stats-subjects') ? document.querySelector('#stats-subjects').closest('.stats-block') : null;
      if (subsBlock) subsBlock.classList.toggle('hidden', !hasAny);

      var hero = $('stats-hero');
      hero.innerHTML = '';
      var delta = prevAvg === null ? null : avg - prevAvg;
      var passedCount = H.filter(function (h) { return (h.pct || 0) >= 60; }).length;
      var passRate = n ? Math.round((passedCount / n) * 100) : 0;
      var streak = streakDays(ALL);
      var secPerQ = totTried ? Math.round(totSecs / totTried) : 0;
      var activeSubIds = new Set(H.map(function (h) { return h.subjectId || h.sub; }).filter(Boolean));
      var allSubs = (S.index && Array.isArray(S.index.subjects)) ? S.index.subjects.length : 6;

      var heroMain = document.createElement('div');
      heroMain.className = 'stats-hero-main';
      heroMain.innerHTML =
        '<div class="stats-hero-info">' +
          '<span class="stats-hero-label">المتوسط العام · ' + escapeHtml(rangeName) + '</span>' +
          '<div class="stats-hero-num-row">' +
            '<span class="stats-hero-value" dir="ltr">' + (n ? (Math.round(avg * 10) / 10) + '%' : '—') + '</span>' +
            (delta === null || Math.abs(delta) < 0.5 ? '' :
              '<span class="stats-hero-trend ' + (delta >= 0 ? 'up' : 'down') + '" dir="ltr">' +
              (delta >= 0 ? '+' : '−') + Math.abs(Math.round(delta * 10) / 10) + '%</span>') +
          '</div>' +
        '</div>';
      hero.appendChild(heroMain);

      var streakLabel = streak >= 1
        ? arCount(streak, { one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يوماً' })
        : '—';
      var heroSide = document.createElement('div');
      heroSide.className = 'stats-hero-side';
      heroSide.innerHTML =
        '<div class="stats-hero-stat"><span class="stats-hero-side-label">الاستمرارية</span><span class="stats-hero-side-value">' + escapeHtml(streakLabel) + '</span></div>' +
        '<div class="stats-hero-stat"><span class="stats-hero-side-label">تغطية المنهاج</span><span class="stats-hero-side-value">' + activeSubIds.size + ' من ' + allSubs + ' مواد</span></div>';
      hero.appendChild(heroSide);

      var box = $('stats-overall');
      box.innerHTML = '';
      var cards = [
        ['الاختبارات', String(n), n ? (passedCount + ' باجتياز · ' + passRate + '%') : '—'],
        ['الأسئلة', String(totTried), totQ + ' إجابة صحيحة'],
        ['زمن الدراسة', fmtDur(totSecs), 'إجمالي الوقت'],
        ['معدل السرعة', secPerQ > 0 ? (secPerQ + ' ث') : '—', 'لكل سؤال'],
      ];
      cards.forEach(function (pair) {
        var d = document.createElement('div');
        d.className = 'stat-card';
        d.innerHTML =
          '<span class="stat-label">' + escapeHtml(pair[0]) + '</span>' +
          '<span class="stat-value">' + escapeHtml(pair[1]) + '</span>' +
          '<span class="stat-sub">' + escapeHtml(pair[2]) + '</span>';
        box.appendChild(d);
      });

      var trend = $('stats-trend');
      trend.innerHTML = '';
      var trendMeta = buildTrendNodes(H, days);
      var trendSubEl = $('stats-trend-subtitle');
      if (trendSubEl) trendSubEl.textContent = trendMeta.subtitle;

      var last = trendMeta.nodes;
      if (!last.length) {
        trend.innerHTML = '<div class="trend-empty">لا توجد محاولات مسجّلة في (' + escapeHtml(rangeName) + ')</div>';
      } else {
        var W = 520;
        var H_SVG = 156;
        var PAD_L = 22;
        var PAD_R = 34;
        var PAD_TOP = 24;
        var PAD_BOT = 26;
        var plotW = W - PAD_L - PAD_R;
        var plotH = H_SVG - PAD_TOP - PAD_BOT;
        var plotBottom = PAD_TOP + plotH;
        var m = last.length;

        var pts = last.map(function (node, idx) {
          var pct = Math.max(0, Math.min(100, node.pct || 0));
          var x = m === 1 ? (PAD_L + plotW / 2) : (W - PAD_R - (idx / (m - 1)) * plotW);
          var y = plotBottom - (pct / 100) * plotH;
          return {
            x: x,
            y: y,
            pctRound: Math.round(pct),
            band: statsBand(pct),
            label: node.label,
            tooltip: node.tooltip
          };
        });

        var ordered = pts.slice().sort(function (a, b) { return a.x - b.x; });
        var linePath = '';
        var areaPath = '';
        if (ordered.length === 1) {
          var py = ordered[0].y.toFixed(1);
          linePath = 'M ' + PAD_L + ',' + py + ' L ' + (W - PAD_R) + ',' + py;
          areaPath = linePath + ' L ' + (W - PAD_R) + ',' + plotBottom + ' L ' + PAD_L + ',' + plotBottom + ' Z';
        } else {
          var k = ordered.length;
          var dx = [];
          var sec = [];
          for (var i = 0; i < k - 1; i++) {
            var dxi = Math.max(1e-4, ordered[i + 1].x - ordered[i].x);
            dx.push(dxi);
            sec.push((ordered[i + 1].y - ordered[i].y) / dxi);
          }
          var tan = new Array(k);
          tan[0] = sec[0];
          tan[k - 1] = sec[k - 2];
          for (var j = 1; j < k - 1; j++) {
            tan[j] = (sec[j - 1] * sec[j] <= 0) ? 0 : (sec[j - 1] + sec[j]) / 2;
          }
          for (var s = 0; s < k - 1; s++) {
            if (sec[s] === 0) {
              tan[s] = 0;
              tan[s + 1] = 0;
            } else {
              var a = tan[s] / sec[s];
              var b = tan[s + 1] / sec[s];
              var hyp = Math.hypot(a, b);
              if (hyp > 3) {
                var scale = 3 / hyp;
                tan[s] = scale * a * sec[s];
                tan[s + 1] = scale * b * sec[s];
              }
            }
          }
          linePath = 'M ' + ordered[0].x.toFixed(1) + ',' + ordered[0].y.toFixed(1);
          for (var c = 0; c < k - 1; c++) {
            var cp1x = ordered[c].x + dx[c] / 3;
            var cp1y = ordered[c].y + (tan[c] * dx[c]) / 3;
            var cp2x = ordered[c + 1].x - dx[c] / 3;
            var cp2y = ordered[c + 1].y - (tan[c + 1] * dx[c]) / 3;
            linePath += ' C ' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1) + ' ' +
              cp2x.toFixed(1) + ',' + cp2y.toFixed(1) + ' ' +
              ordered[c + 1].x.toFixed(1) + ',' + ordered[c + 1].y.toFixed(1);
          }
          areaPath = linePath + ' L ' + ordered[k - 1].x.toFixed(1) + ',' + plotBottom.toFixed(1) +
            ' L ' + ordered[0].x.toFixed(1) + ',' + plotBottom.toFixed(1) + ' Z';
        }

        var yPass = (plotBottom - (PASS_MARK / 100) * plotH).toFixed(1);
        var nodesSvg = pts.map(function (p) {
          return '<g class="trend-node">' +
            '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.6" class="trend-dot ' + p.band + '">' +
              '<title>' + escapeHtml(p.tooltip) + '</title>' +
            '</circle>' +
            '<text x="' + p.x.toFixed(1) + '" y="' + (p.y - 9).toFixed(1) + '" class="trend-svg-val ' + p.band + '" text-anchor="middle" direction="ltr">' + p.pctRound + '%</text>' +
            '<text x="' + p.x.toFixed(1) + '" y="' + (plotBottom + 17).toFixed(1) + '" class="trend-svg-day" text-anchor="middle">' + escapeHtml(p.label) + '</text>' +
          '</g>';
        }).join('');

        trend.innerHTML =
          '<div class="trend-chart">' +
            '<svg class="trend-svg" viewBox="0 0 ' + W + ' ' + H_SVG + '" role="img" aria-label="منحنى تطوّر المستوى">' +
              '<defs>' +
                '<linearGradient id="trend-area-grad" x1="0" y1="0" x2="0" y2="1">' +
                  '<stop offset="0%" stop-color="#10b981" stop-opacity="0.24"/>' +
                  '<stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>' +
                '</linearGradient>' +
              '</defs>' +
              '<line x1="' + PAD_L + '" y1="' + PAD_TOP + '" x2="' + (W - PAD_R) + '" y2="' + PAD_TOP + '" class="trend-grid-line" />' +
              '<text x="' + (W - 4) + '" y="' + (PAD_TOP + 3) + '" class="trend-axis-tag" text-anchor="end" direction="ltr">100%</text>' +
              '<line x1="' + PAD_L + '" y1="' + yPass + '" x2="' + (W - PAD_R) + '" y2="' + yPass + '" class="trend-pass-line" />' +
              '<text x="' + (W - 4) + '" y="' + (Number(yPass) + 3).toFixed(1) + '" class="trend-axis-tag pass" text-anchor="end" direction="ltr">60%</text>' +
              '<line x1="' + PAD_L + '" y1="' + plotBottom + '" x2="' + (W - PAD_R) + '" y2="' + plotBottom + '" class="trend-axis-line" />' +
              '<text x="' + (W - 4) + '" y="' + (plotBottom + 3) + '" class="trend-axis-tag" text-anchor="end" direction="ltr">0%</text>' +
              '<path d="' + areaPath + '" class="trend-area-path" fill="url(#trend-area-grad)" />' +
              '<path d="' + linePath + '" class="trend-line-path" />' +
              nodesSvg +
            '</svg>' +
          '</div>';
      }

      var insight = $('stats-insight');
      var txt = '';
      if (n && delta !== null && Math.abs(delta) >= 0.5) {
        txt = delta > 0
          ? 'تحسّن المتوسط بمقدار ' + Math.round(delta) + ' نقطة عن الفترة السابقة.'
          : 'تراجع المتوسط بمقدار ' + Math.abs(Math.round(delta)) + ' نقاط عن الفترة السابقة.';
      }
      insight.textContent = txt;

      var subs = $('stats-subjects');
      subs.innerHTML = '';
      var bySub = {};
      H.forEach(function (h) {
        var sid = h.subjectId || h.sub || 'other';
        var stitle = h.subjectTitle || h.title || 'مادة عامة';
        (bySub[sid] = bySub[sid] || { title: stitle, rows: [] }).rows.push(h);
      });
      Object.keys(bySub).sort(function (a, b) {
        var av = function (g) { return g.rows.reduce(function (x, h) { return x + (h.pct || 0); }, 0) / g.rows.length; };
        return av(bySub[b]) - av(bySub[a]);
      }).forEach(function (sid) {
        var g = bySub[sid];
        var rows = g.rows;
        var a2 = rows.reduce(function (x, h) { return x + (h.pct || 0); }, 0) / rows.length;
        var subTotalQ = rows.reduce(function (x, h) { return x + (h.total || 0); }, 0);
        var wrap = document.createElement('div');
        wrap.className = 'saved-group stats-subject-card';
        wrap.setAttribute('role', 'button');
        wrap.setAttribute('tabindex', '0');
        wrap.setAttribute('title', 'عرض اختبارات ' + g.title);
        wrap.onclick = function () {
          if (sid && sid !== 'other') location.hash = '#/catalog/' + encodeURIComponent(sid);
        };
        wrap.onkeydown = function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wrap.click(); }
        };

        var band = a2 >= 75 ? 'good' : (a2 >= 60 ? 'ok' : 'low');
        var countLabel = arCount(rows.length, { one: 'اختبار واحد', two: 'اختباران', few: 'اختبارات', many: 'اختبار' });
        var head = document.createElement('div');
        head.className = 'saved-group-head stats-subject-head';
        head.innerHTML =
          '<div class="stats-subject-main">' +
            '<span class="saved-group-title stats-subject-title">' + escapeHtml(g.title) + '</span>' +
            '<span class="saved-group-sub stats-subject-meta">' + countLabel + ' · ' + subTotalQ + ' سؤال</span>' +
          '</div>' +
          '<span class="stats-subject-pct ' + band + '" dir="ltr">' + Math.round(a2) + '%</span>';
        wrap.appendChild(head);

        var track = document.createElement('div');
        track.className = 'stat-bar-track';
        track.innerHTML = '<div class="stat-bar-fill ' + band + '" style="width:' + Math.max(4, Math.min(100, a2)) + '%"></div>';
        wrap.appendChild(track);
        subs.appendChild(wrap);
      });

      var list = $('history-list');
      list.innerHTML = '';
      var rangeBar = document.querySelector('.stats-range');
      if (rangeBar) rangeBar.classList.toggle('hidden', !hasAny);
      var histSection = $('history-section');
      if (histSection) histSection.classList.toggle('hidden', !hasAny);

      var toolbar = $('history-toolbar');
      var totalBadge = $('history-total-badge');
      var histSubjects = [];
      var seenSub = {};
      H.forEach(function (h) {
        var sid = h.subjectId || h.sub || 'other';
        var stitle = h.subjectTitle || h.title || 'مادة عامة';
        if (!seenSub[sid]) {
          seenSub[sid] = { id: sid, title: stitle, count: 0 };
          histSubjects.push(seenSub[sid]);
        }
        seenSub[sid].count++;
      });

      if (S.historySubFilter && S.historySubFilter !== 'all' && !seenSub[S.historySubFilter]) {
        S.historySubFilter = 'all';
      }
      var activeSubFilter = S.historySubFilter || 'all';
      var filteredH = activeSubFilter === 'all'
        ? H.slice().reverse()
        : H.filter(function (h) { return (h.subjectId || h.sub || 'other') === activeSubFilter; }).reverse();

      if (totalBadge) {
        totalBadge.textContent = arCount(filteredH.length, { one: 'محاولة واحدة', two: 'محاولتان', few: 'محاولات', many: 'محاولة' }) + ' · ' + rangeName;
      }

      if (toolbar) {
        toolbar.innerHTML = '';
        if (histSubjects.length > 1) {
          var allBtn = document.createElement('button');
          allBtn.type = 'button';
          allBtn.className = 'history-filter-chip' + (activeSubFilter === 'all' ? ' active' : '');
          allBtn.textContent = 'الكل (' + H.length + ')';
          allBtn.onclick = function () {
            S.historySubFilter = 'all';
            S.historyPage = 1;
            renderStats();
          };
          toolbar.appendChild(allBtn);

          histSubjects.forEach(function (sub) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'history-filter-chip' + (activeSubFilter === sub.id ? ' active' : '');
            btn.textContent = sub.title + ' (' + sub.count + ')';
            btn.onclick = function () {
              S.historySubFilter = sub.id;
              S.historyPage = 1;
              renderStats();
            };
            toolbar.appendChild(btn);
          });
          toolbar.classList.remove('hidden');
        } else {
          toolbar.classList.add('hidden');
        }
      }

      var PAGE_SIZE = 8;
      var totalPages = Math.max(1, Math.ceil(filteredH.length / PAGE_SIZE));
      var curPage = Number(S.historyPage) || 1;
      if (curPage < 1) curPage = 1;
      if (curPage > totalPages) curPage = totalPages;
      S.historyPage = curPage;

      var startIdx = (curPage - 1) * PAGE_SIZE;
      var visibleAttempts = filteredH.slice(startIdx, startIdx + PAGE_SIZE);

      if (!visibleAttempts.length) {
        list.innerHTML = '<div class="trend-empty">لا توجد محاولات في هذه الفترة</div>';
      } else {
        var currentKey = '';
        var currentDayRows = null;
        visibleAttempts.forEach(function (h) {
          var key = dayKey(h.t);
          if (key !== currentKey) {
            currentKey = key;
            var dayBox = document.createElement('div');
            dayBox.className = 'history-day';
            var count = filteredH.filter(function (x) { return dayKey(x.t) === key; }).length;
            var shownInDay = visibleAttempts.filter(function (x) { return dayKey(x.t) === key; }).length;
            var dayCountText = shownInDay < count
              ? (shownInDay + ' من ' + arCount(count, { one: 'محاولة', two: 'محاولتين', few: 'محاولات', many: 'محاولة' }))
              : arCount(count, { one: 'محاولة', two: 'محاولتان', few: 'محاولات', many: 'محاولة' });
            dayBox.innerHTML = '<div class="history-day-head"><span class="history-day-name">' +
              escapeHtml(dayLabel(h.t)) + '</span><span class="history-day-count">' +
              dayCountText + '</span></div>';
            currentDayRows = document.createElement('div');
            currentDayRows.className = 'history-day-rows';
            dayBox.appendChild(currentDayRows);
            list.appendChild(dayBox);
          }
          var row = document.createElement('div');
          row.className = 'history-row';
          var cleanLabel = (h.chapterLabel || '').replace(/^موضوع:\s*/, 'موضوع ');
          var subInfo = (h.subjectTitle || '') + (cleanLabel ? ' · ' + cleanLabel : '');
          var timeStr = '';
          try {
            timeStr = new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' }).format(new Date(h.t || 0));
          } catch (e) { timeStr = ''; } // audit-ignore: time format fallback
          var fracStr = (h.correct || 0) + '/' + (h.total || 0);

          var hasQuizLink = Boolean(h.subjectId && h.quizId);
          if (hasQuizLink) {
            row.setAttribute('role', 'button');
            row.setAttribute('tabindex', '0');
            row.setAttribute('title', 'إعادة الاختبار');
            row.onclick = function () {
              location.hash = '#/quiz/' + encodeURIComponent(h.subjectId) + '/' + encodeURIComponent(h.quizId);
            };
            row.onkeydown = function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
            };
          }

          row.innerHTML =
            '<span class="history-pct ' + pctClass(h.pct) + '" dir="ltr"><i class="history-dot"></i>' + Math.round(h.pct) + '%</span>' +
            '<div class="history-meta">' +
              '<div class="history-topic">' + escapeHtml(h.topic || '') + '</div>' +
              '<div class="history-sub">' + escapeHtml(subInfo) + '</div>' +
            '</div>' +
            '<div class="history-tail">' +
              '<span class="history-frac" dir="ltr">' + escapeHtml(fracStr) + '</span>' +
              (timeStr ? '<span class="history-time">' + escapeHtml(timeStr) + '</span>' : '') +
            '</div>' +
            (hasQuizLink ? '<i data-lucide="chevron-left" class="history-arrow" aria-hidden="true"></i>' : '');
          if (currentDayRows) currentDayRows.appendChild(row);
        });
      }

      if (totalPages > 1) {
        var pager = document.createElement('div');
        pager.className = 'history-pager';
        var fromRow = startIdx + 1;
        var toRow = Math.min(filteredH.length, startIdx + PAGE_SIZE);
        pager.innerHTML =
          '<button type="button" class="history-page-btn" id="history-prev-page" ' + (curPage <= 1 ? 'disabled' : '') + ' aria-label="الصفحة السابقة">' +
            '<i data-lucide="chevron-right" aria-hidden="true"></i>' +
            '<span>الأحدث</span>' +
          '</button>' +
          '<span class="history-page-info">' +
            'صفحة <strong>' + curPage + '</strong> من <strong>' + totalPages + '</strong>' +
            '<span class="history-page-range"> · (' + fromRow + '–' + toRow + ' من ' + filteredH.length + ')</span>' +
          '</span>' +
          '<button type="button" class="history-page-btn" id="history-next-page" ' + (curPage >= totalPages ? 'disabled' : '') + ' aria-label="الصفحة التالية">' +
            '<span>الأقدم</span>' +
            '<i data-lucide="chevron-left" aria-hidden="true"></i>' +
          '</button>';
        list.appendChild(pager);

        var prevBtn = pager.querySelector('#history-prev-page');
        var nextBtn = pager.querySelector('#history-next-page');
        if (prevBtn) {
          prevBtn.onclick = function () {
            if (S.historyPage > 1) {
              S.historyPage--;
              renderStats();
            }
          };
        }
        if (nextBtn) {
          nextBtn.onclick = function () {
            if (S.historyPage < totalPages) {
              S.historyPage++;
              renderStats();
            }
          };
        }
      }
      icons();
    }

    function exportData() {
      try {
        var data = {
          app: 'mcq-portal', version: 1, exportedAt: new Date().toISOString(),
          saved: S.saved, history: S.history, bests: collectBests(),
        };
        var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'mcq-portal-backup.json';
        document.body.appendChild(a);
        a.click();
        var revokeTimer = setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); clearTimeout(revokeTimer); }, 500);
        toast('تم تنزيل النسخة الاحتياطية');
      } catch (e) { toast('تعذر إنشاء النسخة'); }
    }

    function importData(file) {
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var d = JSON.parse(rd.result);
          if (!d || typeof d !== 'object' || (!d.saved && !Array.isArray(d.history) && !d.bests)) {
            toast('ملف غير صالح أو فارغ', 'error');
            return;
          }
          var restoredCount = 0;
          if (d.saved && typeof d.saved === 'object' && Object.keys(d.saved).length > 0) {
            S.saved = d.saved;
            writeSavedRemoved({});
            persistSaved(); updateSavedBadge(); updateMenuCounts();
            restoredCount++;
          }
          if (Array.isArray(d.history) && d.history.length > 0) {
            S.history = d.history.slice(-200);
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(S.history)); } catch (e) {} // audit-ignore: optional storage write
            touchData();
            restoredCount++;
          }
          if (d.bests && typeof d.bests === 'object' && Object.keys(d.bests).length > 0) {
            Object.keys(d.bests).forEach(function (k) {
              if (k.indexOf('portal_best_') === 0) {
                try { localStorage.setItem(k, JSON.stringify(d.bests[k])); } catch (e) {} // audit-ignore: optional storage write
              }
            });
            restoredCount++;
          }
          if (restoredCount === 0) {
            toast('ملف غير صالح أو فارغ', 'error');
            return;
          }
          if (location.hash === '#/stats' || location.hash === '#/stats/') renderStats();
          toast('تمت الاستعادة بنجاح');
        } catch (e) { toast('ملف غير صالح', 'error'); }
      };
      rd.readAsText(file);
    }

    return {
      pctClass: pctClass,
      fmtDur: fmtDur,
      collectBests: collectBests,
      clearHistory: clearHistory,
      renderStats: renderStats,
      exportData: exportData,
      importData: importData
    };
  }

  global.PortalStatsUI = {
    create: createStatsUI
  };
})(window);
