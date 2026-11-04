/* MCQ Portal — league_ui.js
 * Weekly League Standings, Football Legends Integration, Player Drawer & Canvas Share Card UI module.
 */
(function (global) {
  'use strict';

  function createLeagueUI(ctx) {
    var $ = ctx.$;
    var S = ctx.S;
    var escapeHtml = ctx.escapeHtml;
    var ansCount = ctx.ansCount;
    var accuracyOf = ctx.accuracyOf;
    var icons = ctx.icons;
    var toast = ctx.toast;
    var dbg = ctx.dbg;
    var openDrawer = ctx.openDrawer;

    var leagueRenderSeq = 0;

    function scopeRows(rows, subjectId) {
      if (!subjectId) return rows;
      var out = (rows || []).map(function (r) {
        return Object.assign({}, r, {
          xp: (r.per_subject && r.per_subject[subjectId] && Number(r.per_subject[subjectId].xp)) || 0
        });
      });
      out.sort(function (a, b) { return b.xp - a.xp; });
      out.forEach(function (r, i) { r.rank = i + 1; });
      return out;
    }

    function leagueScopeLabel() {
      if (!S.leagueSubject) return 'الترتيب العام';
      var subs = (S.index && S.index.subjects) || [];
      var s = subs.find(function (x) { return x.subject_id === S.leagueSubject; });
      return s ? s.subject_title : 'الترتيب العام';
    }

    function renderLeagueModeBar() {
      var bar = $('league-mode-bar');
      if (!bar) return;
      bar.querySelectorAll('button[data-mode]').forEach(function (b) {
        b.classList.toggle('active', (S.leagueMode || 'weekly') === b.dataset.mode);
      });
    }

    function renderLeagueWeekBar(isPrev, rangeText, rem) {
      var bar = $('league-week-bar');
      if (!bar) return;
      if (S.leagueMode === 'alltime') {
        bar.style.display = 'none';
        return;
      }
      bar.style.display = 'flex';
      bar.querySelectorAll('button[data-week]').forEach(function (b) {
        var active = (S.leagueWeek || 'current') === b.dataset.week;
        b.classList.toggle('active', active);
      });
      var titleEl = $('league-week-title');
      if (titleEl) titleEl.textContent = rangeText || '';
      var statusEl = $('league-week-status');
      if (statusEl) {
        if (isPrev) {
          statusEl.className = 'league-status-pill is-concluded';
          statusEl.innerHTML = '<i data-lucide="trophy"></i><span>أسبوع منتهي</span>';
        } else {
          statusEl.className = 'league-status-pill is-live';
          statusEl.innerHTML = '<span class="pulse-dot"></span><span>مباشر · ' + ((rem && rem.label) || 'ينتهي الأحد') + '</span>';
        }
      }
    }

    function renderLeagueWinnerBanner(rows, isPrev) {
      var el = $('league-winner-banner');
      if (!el) return;
      if (isPrev && Array.isArray(rows) && rows.length > 0 && rows[0].xp > 0) {
        el.innerHTML = '<i data-lucide="crown"></i><span>بطل الأسبوع الماضي: <b>' +
          escapeHtml(rows[0].name || 'لاعب') + '</b> برصيد ' + rows[0].xp + ' إجابة ودقة ' +
          (accuracyOf(rows[0]) !== null ? accuracyOf(rows[0]) + '%' : '—') + '</span>';
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
        el.innerHTML = '';
      }
    }

    function renderLeagueJoinCallout(me, isLive) {
      var el = $('league-join-callout');
      if (!el) return;
      var isUnranked = !me || (Number(me.answered) === 0 && Number(me.xp) === 0);
      if (isLive && isUnranked && (window.PortalLeague && window.PortalLeague.linked && window.PortalLeague.linked())) {
        el.innerHTML = '<div class="league-join-text">' +
          '<strong>لم تشارك بعد هذا الأسبوع!</strong>' +
          '<span>أجب عن كويز واحد للانضمام لمنافسة هذا الأسبوع مع زملائك</span>' +
          '</div>' +
          '<a href="#/" class="action-btn primary-btn league-cta-btn">' +
          '<i data-lucide="play"></i><span>ابدأ كويز</span></a>';
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
        el.innerHTML = '';
      }
    }

    function renderLeagueChips() {
      var bar = $('league-subject-bar');
      if (!bar) return;
      bar.innerHTML = '';
      var mk = function (id, label) {
        var b = document.createElement('button');
        b.className = 'filter-chip' + (S.leagueSubject === id ? ' active' : '');
        b.textContent = label;
        b.setAttribute('aria-pressed', S.leagueSubject === id ? 'true' : 'false');
        b.addEventListener('click', function () { S.leagueSubject = id; renderLeague(); });
        bar.appendChild(b);
      };
      mk(null, 'العام');
      ((S.index && S.index.subjects) || []).forEach(function (s) { mk(s.subject_id, s.subject_title); });
    }

    function leagueSkeletonHtml() {
      return '<div class="skeleton-league-wrap" aria-hidden="true">' +
        '<div class="skeleton-league-podium">' +
        '  <div class="skeleton-slot p2">' +
        '    <div class="skeleton-avatar" style="width: 52px; height: 52px;"></div>' +
        '    <div class="skeleton-line" style="width: 54px; height: 12px; margin-top: 6px;"></div>' +
        '    <div class="skeleton-line" style="width: 36px; height: 10px; margin-top: 3px;"></div>' +
        '    <div class="skeleton-block" style="height: 48px; width: 100%;"></div>' +
        '  </div>' +
        '  <div class="skeleton-slot p1">' +
        '    <div class="skeleton-avatar" style="width: 62px; height: 62px;"></div>' +
        '    <div class="skeleton-line" style="width: 64px; height: 14px; margin-top: 6px;"></div>' +
        '    <div class="skeleton-line" style="width: 44px; height: 10px; margin-top: 3px;"></div>' +
        '    <div class="skeleton-block" style="height: 64px; width: 100%;"></div>' +
        '  </div>' +
        '  <div class="skeleton-slot p3">' +
        '    <div class="skeleton-avatar" style="width: 52px; height: 52px;"></div>' +
        '    <div class="skeleton-line" style="width: 50px; height: 12px; margin-top: 6px;"></div>' +
        '    <div class="skeleton-line" style="width: 34px; height: 10px; margin-top: 3px;"></div>' +
        '    <div class="skeleton-block" style="height: 36px; width: 100%;"></div>' +
        '  </div>' +
        '</div>' +
        '<div class="skeleton-rows">' +
        [1, 2, 3].map(function () {
          return '<div class="skeleton-row">' +
            '<div class="skeleton-line" style="width: 16px; height: 14px;"></div>' +
            '<div class="skeleton-avatar" style="width: 30px; height: 30px;"></div>' +
            '<div class="skeleton-line" style="flex: 1; height: 14px; max-width: 130px;"></div>' +
            '<div class="skeleton-line" style="width: 44px; height: 14px;"></div>' +
            '</div>';
        }).join('') +
        '</div></div>';
    }

    function avatarHtml(photo, name, cls) {
      if (photo) {
        return '<span class="' + cls + ' avatar-default" style="background-image:url(&quot;' + String(photo).replace(/"/g, '%22') +
          '&quot;),url(&quot;assets/avatar-default.svg&quot;);background-size:cover;background-position:center"></span>';
      }
      return '<span class="' + cls + ' avatar-default" aria-hidden="true"></span>';
    }

    function mergeLeagueLegends(realRows, opts) {
      if (window.PortalLeague && window.PortalLeague.isMock && window.PortalLeague.isMock()) return realRows || [];
      if (!window.PortalVSBot || !window.PortalVSBot.getLeagueRows) return realRows || [];
      var humanList = Array.isArray(realRows) ? realRows : [];
      var humanTopXp = humanList.reduce(function (m, r) {
        return (!r.isBot && Number(r.xp) > m) ? Number(r.xp) : m;
      }, 0);
      var botRows = window.PortalVSBot.getLeagueRows(Object.assign({}, opts, {
        subjects: (S.index && S.index.subjects) || [],
        humanTopXp: humanTopXp
      }));
      var combined = humanList.slice();
      var seen = new Set(combined.map(function (r) { return r.user_id; }));
      botRows.forEach(function (b) {
        if (!seen.has(b.user_id)) {
          combined.push(b);
        }
      });
      combined.sort(function (a, b) {
        if (b.xp !== a.xp) return b.xp - a.xp;
        var accA = a.answered > 0 ? (a.xp / a.answered) : 0;
        var accB = b.answered > 0 ? (b.xp / b.answered) : 0;
        if (accB !== accA) return accB - accA;
        return String(a.updated_at || '').localeCompare(String(b.updated_at || ''));
      });
      combined.forEach(function (r, idx) { r.rank = idx + 1; });
      return combined;
    }

    async function renderLeague() {
      var renderSeq = ++leagueRenderSeq;
      var box = $('league-board');
      var emptyEl = $('league-empty-state');
      var offEl = $('league-offline-note');
      var L = window.PortalLeague;
      var isAllTime = S.leagueMode === 'alltime';
      var isPrev = S.leagueWeek === 'prev';
      var wk = L ? (isPrev ? (L.prevWeekStart ? L.prevWeekStart(Date.now()) : '') : (L.weekStart ? L.weekStart(Date.now()) : '')) : '';
      var wl = $('league-week-line');
      var rangeText = '';
      var rem = null;
      if (wk && L) {
        var start = new Date(wk + 'T00:00:00');
        var end = new Date(start.getTime() + 6 * 86400000);
        var dayFmt = new Intl.DateTimeFormat('ar', { day: 'numeric' });
        var monFmt = new Intl.DateTimeFormat('ar', { month: 'long' });
        rangeText = start.getMonth() === end.getMonth()
          ? dayFmt.format(start) + ' – ' + dayFmt.format(end) + ' ' + monFmt.format(start)
          : dayFmt.format(start) + ' ' + monFmt.format(start) + ' – ' + dayFmt.format(end) + ' ' + monFmt.format(end);
        if (L.weekRemaining) rem = L.weekRemaining(Date.now());
      }
      if (wl) {
        if (isAllTime) {
          wl.textContent = 'الترتيب العام التراكمي';
        } else if (wk) {
          wl.textContent = isPrev ? ('الأسبوع السابق · ' + rangeText) : rangeText;
        } else {
          wl.textContent = '';
        }
      }
      renderLeagueModeBar();
      renderLeagueWeekBar(isPrev, rangeText, rem);
      renderLeagueChips();

      if (!L || !L.configured()) {
        if (box) box.innerHTML = '';
        if (emptyEl) emptyEl.classList.add('hidden');
        if (offEl) offEl.classList.add('hidden');
        var chips = $('league-subject-bar');
        if (chips) chips.style.display = 'none';
        renderLeagueWinnerBanner([], false);
        renderLeagueJoinCallout(null, false);
        updateLeagueMe(null, []);
        icons();
        return;
      }
      var chipsBar = $('league-subject-bar');
      if (chipsBar) chipsBar.style.display = '';
      if (offEl) offEl.classList.toggle('hidden', navigator.onLine !== false);
      if (emptyEl) emptyEl.classList.add('hidden');

      var cachedRows = isAllTime
        ? S.leagueRowsAllTime
        : (isPrev ? S.leagueRowsPrev : S.leagueRows);
      var cachedMe = isAllTime
        ? S.leagueMeAllTime
        : (isPrev ? S.leagueMePrev : S.leagueMe);
      var hasCache = Array.isArray(cachedRows) && cachedRows.length > 0;

      if (!hasCache && navigator.onLine !== false && box) {
        box.innerHTML = leagueSkeletonHtml();
      }

      var rows = [];
      var me = null;
      try {
        if (!hasCache && navigator.onLine === false) {
          throw new Error('offline');
        }
        if (isAllTime) {
          var freshAll = Array.isArray(S.leagueRowsAllTime) && Date.now() - (S.leagueStampAllTime || 0) < 45000;
          if (freshAll) {
            rows = S.leagueRowsAllTime;
            me = S.leagueMeAllTime || null;
          } else {
            var rawAll = L.allTimeBoard ? await L.allTimeBoard() : await L.board();
            rows = mergeLeagueLegends(rawAll, { isAllTime: true, weekId: wk });
            var myIdAll = (L.userId ? L.userId() : null) || (window.PortalCloud && window.PortalCloud.userId ? window.PortalCloud.userId() : null);
            me = myIdAll ? ((rows || []).find(function (r) { return r.user_id === myIdAll; }) || null) : null;
            S.leagueRowsAllTime = rows;
            S.leagueMeAllTime = me;
            S.leagueStampAllTime = Date.now();
          }
        } else {
          var fresh = isPrev
            ? (Array.isArray(S.leagueRowsPrev) && Date.now() - (S.leagueStampPrev || 0) < 45000)
            : (Array.isArray(S.leagueRows) && Date.now() - (S.leagueStamp || 0) < 45000);
          if (fresh) {
            rows = isPrev ? S.leagueRowsPrev : S.leagueRows;
            me = isPrev ? (S.leagueMePrev || null) : (S.leagueMe || null);
          } else {
            var pair = await Promise.all([
              L.board(wk),
              (L.linked && L.linked()) ? L.myRow(wk) : Promise.resolve(null)
            ]);
            var resRows = pair[0];
            var resMe = pair[1];
            rows = mergeLeagueLegends(resRows, {
              isPrev: isPrev,
              weekId: wk,
              myXp: resMe ? Number(resMe.xp) || 0 : 0
            });
            me = resMe;
            if (me) {
              var foundMe = rows.find(function (r) { return r.user_id === me.user_id; });
              if (foundMe) me.rank = foundMe.rank;
            }
            if (isPrev) {
              S.leagueRowsPrev = rows;
              S.leagueMePrev = me;
              S.leagueStampPrev = Date.now();
            } else {
              S.leagueRows = rows;
              S.leagueMe = me;
              S.leagueStamp = Date.now();
            }
            if (!isPrev && L.linked && L.linked() && navigator.onLine !== false && Date.now() - (S.leagueSyncStamp || 0) > 600000) {
              S.leagueSyncStamp = Date.now();
              L.syncWeek().then(function () { return L.board(wk); }).then(function (r2) {
                var merged2 = mergeLeagueLegends(r2, {
                  isPrev: false,
                  weekId: wk,
                  myXp: me ? Number(me.xp) || 0 : 0
                });
                S.leagueRows = merged2;
                S.leagueStamp = Date.now();
                if (location.hash.indexOf('#/league') === 0 && (S.leagueWeek || 'current') === 'current' && (S.leagueMode || 'weekly') === 'weekly') renderLeague();
              }).catch(function () {}); // audit-ignore: background refresh optional
            }
          }
        }
      } catch (e) {
        if (box) box.innerHTML = '';
        renderPodium([], null, '');
        var restLblErr = $('league-rest-label');
        if (restLblErr) restLblErr.classList.add('hidden');
        var offline = navigator.onLine === false;
        if (offline) {
          if (offEl) offEl.classList.remove('hidden');
          if (emptyEl) emptyEl.classList.add('hidden');
        } else if (emptyEl) {
          emptyEl.querySelector('p').textContent = 'تعذر تحميل اللوحة';
          emptyEl.classList.remove('hidden');
        }
        renderLeagueWinnerBanner([], false);
        renderLeagueJoinCallout(null, false);
        updateLeagueMe(null, []);
        icons();
        return;
      }
      renderLeagueWinnerBanner(rows, !isAllTime && isPrev);
      renderLeagueJoinCallout(me, !isAllTime && !isPrev);

      if (renderSeq !== leagueRenderSeq) return;
      rows = scopeRows(rows, S.leagueSubject);
      if (me && me.user_id) {
        var foundScoped = rows.find(function (r) { return r.user_id === me.user_id; });
        if (foundScoped) me.rank = foundScoped.rank;
      }
      if (!rows.length && emptyEl) {
        emptyEl.querySelector('p').textContent = isAllTime
          ? 'لا يوجد متنافسون في الترتيب العام بعد'
          : (isPrev ? 'لا توجد بيانات للأسبوع السابق' : 'لا أحد في الترتيب بعد هذا الأسبوع · حل أول كويز للانضمام!');
        emptyEl.classList.remove('hidden');
      }

      var myId = me && me.user_id;
      var myPhoto = (me && me.avatar) || (function () { try { return L.avatarUrl ? L.avatarUrl() : ''; } catch (e) { return ''; } })(); // audit-ignore: avatar lookup
      var avatarFor = function (r) {
        var photo = (r.user_id === myId && !r.avatar) ? myPhoto : r.avatar;
        return avatarHtml(photo, r.name, 'menu-avatar');
      };
      if (box) box.innerHTML = '';
      var usePodium = rows.length >= 3;
      var top = usePodium ? rows.slice(0, 3) : [];
      var rest = usePodium ? rows.slice(3) : rows;
      renderPodium(top, myId, myPhoto);
      var restLabel = $('league-rest-label');
      if (restLabel) restLabel.classList.toggle('hidden', !usePodium || rest.length === 0);
      rest.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'league-row' + (myId && r.user_id === myId ? ' is-me' : '');
        row.setAttribute('role', 'listitem');
        row.innerHTML =
          '<span class="league-rank" dir="ltr">' + r.rank + '</span>' +
          avatarFor(r) +
          '<span class="league-row-name" dir="auto">' +
            escapeHtml(r.name || 'لاعب') +
          '</span>' +
          '<span class="league-row-xp">' + r.xp + '<small>إجابة</small></span>' +
          (!S.leagueSubject ? '<span class="league-row-acc">' + (accuracyOf(r) !== null ? accuracyOf(r) + '%' : '—') + '</span>' : '');
        wirePlayerCard(row, r);
        box.appendChild(row);
      });
      updateLeagueMe(me, rows);
      icons();
    }

    function openPlayerCard(r) {
      var card = $('player-card');
      if (!card || !r) return;
      var acc = accuracyOf(r);
      var subs = Object.keys(r.per_subject || {})
        .map(function (id) {
          var v = r.per_subject[id] || {};
          return { id: id, title: v.title || id, n: Number(v.n) || 0, xp: Number(v.xp) || 0 };
        })
        .filter(function (s) { return s.n > 0; })
        .sort(function (a, b) { return b.n - a.n; })
        .slice(0, 3);
      var stat = function (label, value) {
        return '<div class="player-stat"><span class="player-stat-value">' + escapeHtml(String(value)) +
        '</span><span class="player-stat-label">' + escapeHtml(label) + '</span></div>';
      };
      var avHtml = avatarHtml(r.avatar, r.name, 'player-avatar');

      var honorsHtml = '';
      try {
        var L = window.PortalLeague;
        var localAcc = {};
        try { localAcc = JSON.parse(localStorage.getItem('portal_account_v1') || '{}'); } catch (e) {}
        var currentUserId = (L && L.userId ? L.userId() : null) ||
                            (window.PortalCloud && window.PortalCloud.userId ? window.PortalCloud.userId() : null) ||
                            localAcc.id;
        var isMe = !!((currentUserId && r.user_id === currentUserId) || (localAcc.id && r.user_id === localAcc.id) || r.isMe);
        if (isMe && window.PortalAchievements && window.PortalAchievements.evaluateAll) {
          var ev = window.PortalAchievements.evaluateAll();
          var pills = [];
          if (ev.stats && ev.stats.streak > 0) {
            pills.push('<span class="player-honor-pill streak"><i data-lucide="flame"></i> استمرارية ' + ev.stats.streak + ' أيام</span>');
          }
          var unlocked = (ev.results || []).filter(function (x) { return x.isUnlocked; });
          if (unlocked.length > 0) {
            unlocked.sort(function (a, b) {
              var ta = (a.evalRes && a.evalRes.achievedTier) || 1;
              var tb = (b.evalRes && b.evalRes.achievedTier) || 1;
              return tb - ta;
            });
            var topB = unlocked[0];
            var tierCls = (topB.tierMeta && topB.tierMeta.accentClass) ? ('badge-' + topB.tierMeta.accentClass) : 'badge-tier-gold';
            pills.push('<span class="player-honor-pill ' + tierCls + '"><i data-lucide="' + escapeHtml(topB.badge.icon) + '"></i> ' + escapeHtml(topB.evalRes.currentTierTitle || topB.badge.title) + '</span>');
          }
          if (pills.length > 0) {
            honorsHtml = '<div class="player-honors-highlight">' + pills.join('') + '</div>';
          }
        } else if (r.isBot) {
          honorsHtml = '<div class="player-honors-highlight"><span class="player-honor-pill badge-tier-diamond"><i data-lucide="sparkles"></i> ذكاء أسطوري متكيف</span></div>';
        }
      } catch (e) {} // audit-ignore: optional honors highlight

      card.innerHTML =
        '<div class="player-head">' +
          avHtml +
          '<div class="player-head-text">' +
            '<h3 dir="auto">' + escapeHtml(r.name || 'لاعب') + '</h3>' +
            '<p>' + (r.title ? escapeHtml(r.title) + ' · ' : '') + 'المركز ' + escapeHtml(String(r.rank || '—')) + ' هذا الأسبوع</p>' +
          '</div>' +
        '</div>' +
        '<div class="player-stats">' +
          stat('إجابة', r.xp) +
          stat('الدقة', acc === null ? '—' : acc + '%') +
          stat('المركز', r.rank || '—') +
        '</div>' +
        honorsHtml +
        (subs.length
          ? '<div class="player-subjects"><span class="player-subjects-title">أكثر المواد</span>' +
            subs.map(function (s) {
              return '<div class="player-subject"><span dir="auto">' + escapeHtml(s.title) + '</span>' +
              '<b>' + s.n + '</b></div>';
            }).join('') +
            '</div>'
          : '') +
        '<p class="player-note">' + (r.isBot ? 'منافس أسطوري ذكي يتفاعل مع وتيرة أدائك وتحدياتك' : 'أرقام هذا الأسبوع فقط — بدون معرّف الحساب ولا أي بيانات شخصية.') + '</p>';
      openDrawer('player-drawer');
      icons();
    }

    function wirePlayerCard(el, row) {
      if (!el) return;
      el.classList.add('is-clickable');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', 'بطاقة ' + (row.name || 'لاعب'));
      el.addEventListener('click', function () { openPlayerCard(row); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayerCard(row); }
      });
    }

    function renderPodium(top, myId, myPhoto) {
      var el = $('league-podium');
      if (!el) return;
      el.innerHTML = '';
      if (!top.length) { el.style.display = 'none'; return; }
      el.style.display = '';
      var order = [top[1], top[0], top[2]].filter(Boolean);
      order.forEach(function (r) {
        var slot = document.createElement('div');
        var first = r.rank === 1;
        var photo = (myId && r.user_id === myId && !r.avatar) ? (myPhoto || '') : r.avatar;
        slot.className = 'podium-slot p' + r.rank + (myId && r.user_id === myId ? ' is-me' : '');
        var avHtml = avatarHtml(photo, r.name, 'podium-av');
        slot.innerHTML =
          '<span class="podium-av-wrap">' +
          (first ? '<span class="podium-crown" aria-hidden="true"><i data-lucide="crown"></i></span>' : '') +
          avHtml +
          '</span>' +
          '<span class="podium-name" dir="auto">' + escapeHtml(r.name || 'لاعب') + '</span>' +
          '<span class="podium-xp">' + r.xp + ' <small>إجابة</small></span>' +
          '<span class="podium-block">' + r.rank + '</span>';
        wirePlayerCard(slot, r);
        el.appendChild(slot);
      });
    }

    function updateLeagueMe(me, rows) {
      var box = $('league-me');
      if (!box) return;
      var L = window.PortalLeague;
      var linked = !!(L && L.linked && L.linked());
      box.hidden = false;

      if (!L || !L.configured()) {
        box.innerHTML = '<div class="league-me-main"><div class="league-me-name">الدوري غير متاح حالياً</div>' +
          '<div class="league-me-sub">سيتوفر بعد إعداد الخادم الخاص بالبوابة</div></div>';
        icons();
        return;
      }

      if (!linked) {
        box.innerHTML = '<div class="league-me-main"><div class="league-me-name">لست في الدوري</div>' +
          '<div class="league-me-sub">سجّل حسابك (اسم مستخدم + رمز 4 أرقام) وتظهر في الترتيب مع زملائك</div></div>' +
          '<button type="button" class="league-join-btn" data-action="join">' +
          '<i data-lucide="user-plus"></i><span>سجّل حسابك</span></button>';
        icons();
        return;
      }

      var hidden = !!(me && me.hidden);
      var myId = me && me.user_id;
      var mine = (rows || []).filter(function (r) { return r.user_id === myId; })[0];
      var name = (me && me.name) || S.cloudName || 'أنت';
      var photo = (me && me.avatar) || (function () { try { return L.avatarUrl ? L.avatarUrl() : ''; } catch (e) { return ''; } })(); // audit-ignore: avatar lookup
      var facts = [];
      var isPrev = S.leagueWeek === 'prev';
      if (mine) facts.push('المركز ' + mine.rank);
      facts.push(ansCount(mine ? mine.xp : (Number(me && me.xp) || 0)));
      var acc = accuracyOf(mine);
      if (acc !== null && !S.leagueSubject) facts.push('دقة ' + acc + '%');
      if (hidden && !isPrev) facts.push('مخفي');
      var gapLine = '';
      if (!hidden && mine && mine.rank > 1 && !isPrev) {
        var above = (rows || [])[mine.rank - 2];
        if (above) {
          var gap = Math.max(0, above.xp - mine.xp);
          gapLine = gap === 0 ? 'متعادل مع المركز ' + above.rank : 'باقي ' + gap + ' للمركز ' + above.rank;
        }
      }

      box.innerHTML =
        avatarHtml(photo, name, 'menu-avatar') +
        '<div class="league-me-main">' +
        '<div class="league-me-name" dir="auto">' + escapeHtml(name) + '</div>' +
        '<div class="league-me-sub">' + escapeHtml(facts.join(' · ')) + '</div>' +
        (gapLine ? '<div class="league-me-gap">' + escapeHtml(gapLine) + '</div>' : '') +
        '</div>' +
        '<label class="league-vis">' +
        '<input type="checkbox" id="league-vis-toggle"' + (hidden ? '' : ' checked') + '>' +
        '<span>ظاهر</span>' +
        '</label>';

      var toggle = $('league-vis-toggle');
      if (toggle) toggle.addEventListener('change', async function () {
        var next = !toggle.checked;
        toggle.disabled = true;
        try {
          await L.setHidden(next);
          toast(next ? 'أُخفيت من الترتيب' : 'ظهرت في الترتيب', 'success');
        } catch (e) {
          toast('تعذر تحديث الحالة', 'error');
        }
        S.leagueRows = null;
        S.leagueMe = null;
        S.leagueStamp = 0;
        renderLeague();
      });
      icons();
    }

    function drawRoundRect(ctx2d, x, y, w, h, r) {
      ctx2d.beginPath();
      ctx2d.moveTo(x + r, y);
      ctx2d.arcTo(x + w, y, x + w, y + h, r);
      ctx2d.arcTo(x + w, y + h, x, y + h, r);
      ctx2d.arcTo(x, y + h, x, y, r);
      ctx2d.arcTo(x, y, x + w, y, r);
      ctx2d.closePath();
    }

    function drawAvatar(ctx2d, cx, cy, r, name, ring, img, fallback) {
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
      ctx2d.clip();
      if (img && img.width) {
        var s = Math.min(img.width, img.height);
        ctx2d.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2);
      } else if (fallback && fallback.width) {
        ctx2d.fillStyle = 'rgba(139, 151, 168, 0.14)';
        ctx2d.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx2d.drawImage(fallback, cx - r, cy - r, r * 2, r * 2);
      } else {
        ctx2d.fillStyle = '#d9b26a';
        ctx2d.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx2d.fillStyle = '#14161c';
        ctx2d.font = '700 ' + Math.round(r * 0.9) + 'px "MCSQuiz Arabic", sans-serif';
        ctx2d.textAlign = 'center';
        ctx2d.textBaseline = 'middle';
        ctx2d.fillText((name || '؟').trim().charAt(0) || '؟', cx, cy + 2);
      }
      ctx2d.restore();
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
      ctx2d.lineWidth = 3;
      ctx2d.strokeStyle = ring || 'rgba(255,255,255,0.14)';
      ctx2d.stroke();
    }

    function loadCardImage(url) {
      return new Promise(function (resolve) {
        if (!url) return resolve(null);
        var isTme = /^https:\/\/t\.me\/i\/userpic\//.test(url);
        var localDev = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
        var src = isTme
          ? ((localDev ? 'https://mcq-portal-jade.vercel.app' : '') + '/api/avatar?u=' + encodeURIComponent(url))
          : url;
        var img = new Image();
        if (!/^\/api\//.test(src)) img.crossOrigin = 'anonymous';
        var done = false;
        var finish = function (v) { if (!done) { done = true; resolve(v); } };
        img.onload = function () { finish(img); };
        img.onerror = function () { finish(null); };
        img.src = src;
        var imgTimeout = setTimeout(function () { finish(null); clearTimeout(imgTimeout); }, 3500);
      });
    }

    async function buildLeagueCard(data) {
      var W = 1080;
      var INK = '#f3f4f6', MUTED = '#8b97a8';
      var GOLD = '#d9b26a';
      var L = 84, R = W - 84;

      var ranked = data.rows.slice().sort(function (a, b) { return b.xp - a.xp; })
        .map(function (r, i) { return Object.assign({}, r, { rank: i + 1 }); });
      var mineId = data.mine && data.mine.user_id;
      var mine = ranked.filter(function (r) { return r.user_id === mineId; })[0] || null;
      var shown = ranked.slice(0, 5);
      var mineOutside = !!(mine && mine.rank > 5);

      var rowH = 148;
      var header = 330, footerH = 40, mineH = mineOutside ? 148 : 0;
      var H = Math.max(520, Math.min(1350, header + Math.max(1, shown.length) * rowH + mineH + footerH + 30));

      var imgs = {};
      var fallbackAvatar = await loadCardImage('/assets/avatar-default.svg');
      var toLoad = shown.slice();
      if (mineOutside && mine) toLoad.push(mine);
      await Promise.all(toLoad.map(async function (r) {
        var url = (mineId && r.user_id === mineId && !r.avatar) ? (data.myPhoto || '') : r.avatar;
        imgs[r.user_id] = await loadCardImage(url);
      }));

      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var ctx2d = c.getContext('2d');
      ctx2d.direction = 'rtl';
      ctx2d.textBaseline = 'alphabetic';

      var bg = ctx2d.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b0e14');
      bg.addColorStop(1, '#0e131c');
      ctx2d.fillStyle = bg;
      ctx2d.fillRect(0, 0, W, H);

      var glow = ctx2d.createRadialGradient(W / 2, 190, 40, W / 2, 190, 580);
      glow.addColorStop(0, 'rgba(217,178,106,0.14)');
      glow.addColorStop(1, 'rgba(77,163,255,0)');
      ctx2d.fillStyle = glow;
      ctx2d.fillRect(0, 0, W, 660);

      ctx2d.textAlign = 'right';
      ctx2d.fillStyle = INK;
      ctx2d.font = '700 34px "MCSQuiz Arabic", sans-serif';
      ctx2d.fillText('MCSQuiz', R, 96);
      ctx2d.textAlign = 'left';
      ctx2d.fillStyle = MUTED;
      ctx2d.font = '500 26px "MCSQuiz Arabic", sans-serif';
      ctx2d.fillText(data.week, L, 96);
      ctx2d.fillStyle = 'rgba(255,255,255,0.06)';
      ctx2d.fillRect(L, 132, W - L * 2, 2);

      ctx2d.textAlign = 'right';
      ctx2d.fillStyle = INK;
      ctx2d.font = '700 58px "MCSQuiz Arabic", sans-serif';
      ctx2d.fillText('ترتيب هذا الأسبوع', R, 226);
      ctx2d.fillStyle = MUTED;
      ctx2d.font = '500 28px "MCSQuiz Arabic", sans-serif';
      ctx2d.fillText(data.scope, R, 268);

      ctx2d.font = '600 26px "MCSQuiz Arabic", sans-serif';
      ctx2d.fillStyle = '#9ca3af';
      ctx2d.textAlign = 'right';
      ctx2d.fillText('اللاعب', R - 162, 306);
      ctx2d.textAlign = 'left';
      ctx2d.fillText('إجابات صحيحة', L, 306);
      ctx2d.fillStyle = 'rgba(255,255,255,0.08)';
      ctx2d.fillRect(L, 318, W - L * 2, 2);

      var medals = ['#d9b26a', '#c3ccda', '#c08a5c'];

      var drawRow = function (r, y, opts) {
        var h = opts.h;
        var isMe = !!mine && r.user_id === mine.user_id;
        var first = r.rank === 1;
        var avR = opts.av;
        var cy = y + h / 2;

        if (isMe) {
          ctx2d.fillStyle = 'rgba(217,178,106,0.14)';
          drawRoundRect(ctx2d, L - 14, y + 8, W - (L - 14) * 2, h - 16, 16);
          ctx2d.fill();
          ctx2d.strokeStyle = 'rgba(217,178,106,0.35)';
          ctx2d.lineWidth = 2;
          ctx2d.stroke();
        }

        ctx2d.textAlign = 'right';
        ctx2d.fillStyle = medals[r.rank - 1] || MUTED;
        ctx2d.font = '700 40px "MCSQuiz Arabic", sans-serif';
        ctx2d.fillText(String(r.rank), R - 4, cy + 13);

        drawAvatar(ctx2d, R - 92, cy, avR, r.name, first ? GOLD : 'rgba(255,255,255,0.10)', imgs[r.user_id], fallbackAvatar);
        if (first) {
          var cx = R - 92, cyy = cy - avR - 12;
          ctx2d.fillStyle = GOLD;
          ctx2d.beginPath();
          ctx2d.moveTo(cx - 22, cyy + 10);
          ctx2d.lineTo(cx - 15, cyy - 8);
          ctx2d.lineTo(cx - 7, cyy + 2);
          ctx2d.lineTo(cx, cyy - 10);
          ctx2d.lineTo(cx + 7, cyy + 2);
          ctx2d.lineTo(cx + 15, cyy - 8);
          ctx2d.lineTo(cx + 22, cyy + 10);
          ctx2d.closePath();
          ctx2d.fill();
        }

        ctx2d.textAlign = 'right';
        ctx2d.fillStyle = INK;
        ctx2d.font = '600 32px "MCSQuiz Arabic", sans-serif';
        var nameX = R - 92 - avR - 26;
        ctx2d.fillText(r.name || 'لاعب', nameX, cy + 10);

        ctx2d.textAlign = 'left';
        ctx2d.fillStyle = first ? GOLD : INK;
        ctx2d.font = '700 38px "MCSQuiz Arabic", sans-serif';
        ctx2d.fillText(String(r.xp), L, cy + 16);
        var nw = ctx2d.measureText(String(r.xp)).width;
        ctx2d.fillStyle = MUTED;
        ctx2d.font = '500 22px "MCSQuiz Arabic", sans-serif';
        ctx2d.fillText('إجابة', L + nw + 8, cy + 14);

        ctx2d.fillStyle = 'rgba(255,255,255,0.05)';
        ctx2d.fillRect(L, y + h - 6, W - L * 2, 1.5);
      };

      var y = header;
      shown.forEach(function (r) { drawRow(r, y, { h: rowH, av: 44 }); y += rowH; });

      if (mineOutside) {
        drawRow(mine, y + 12, { h: 124, av: 40 });
      }

      return c;
    }

    function appShareLink() {
      var appUrl = (window.PORTAL_APP_URL || 'https://mcq-portal-jade.vercel.app/') + '#/league';
      return 'https://t.me/share/url?url=' + encodeURIComponent(appUrl) +
        '&text=' + encodeURIComponent('دوري MCSQuiz — ترتيبي هذا الأسبوع');
    }

    function showSharePreview(url) {
      var modal = $('share-modal');
      var img = $('share-img');
      if (!modal || !img) return;
      img.src = url;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      var dl = $('share-download');
      if (dl) dl.onclick = function () {
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mcsquiz-league.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      var tg = $('share-telegram');
      if (tg) {
        tg.classList.remove('hidden');
        tg.onclick = function () {
          var link = appShareLink();
          try {
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
              window.Telegram.WebApp.openTelegramLink(link);
            } else {
              window.open(link, '_blank');
            }
          } catch (e) { window.open(link, '_blank'); }
        };
      }
      var cp = $('share-copy');
      if (cp) cp.classList.toggle('hidden', true);
    }

    async function shareMyRank() {
      if (!navigator.onLine) { toast('تحتاج إنترنت لإنشاء بطاقة الدوري', 'error'); return; }
      var btn = $('btn-league-share');
      if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
      toast('نجهّز بطاقتك…', 'info');
      try {
        var L = window.PortalLeague;
        if (!L || !L.configured()) { toast('الدوري غير مفعّل بعد', 'error'); return; }
        var rows = null;
        var me = null;
        var wk = L.weekStart(Date.now());
        if (Array.isArray(S.leagueRows) && Date.now() - (S.leagueStamp || 0) < 60000) {
          rows = S.leagueRows;
          me = S.leagueMe || null;
        } else {
          var rawBoard = await L.board();
          try { me = await L.myRow(); } catch (e) { dbg('myLeagueRow failed:', (e && e.message) || e); }
          rows = mergeLeagueLegends(rawBoard, {
            isPrev: false,
            weekId: wk,
            myXp: me ? Number(me.xp) || 0 : 0
          });
        }
        rows = scopeRows(rows, S.leagueSubject);
        var myId = me && me.user_id;
        var mine = rows.filter(function (r) { return r.user_id === myId; })[0] || null;
        var weekLabel = '';
        if (wk) {
          var start = new Date(wk + 'T00:00:00');
          var end = new Date(start.getTime() + 6 * 86400000);
          var df = new Intl.DateTimeFormat('ar', { day: 'numeric' });
          var mf = new Intl.DateTimeFormat('ar', { month: 'long' });
          weekLabel = df.format(start) + ' – ' + df.format(end) + ' ' + mf.format(start);
        }
        var myPhoto = (me && me.avatar) || (function () { try { return L.avatarUrl ? L.avatarUrl() : ''; } catch (e) { return ''; } })(); // audit-ignore: avatar lookup
        var canvas = await buildLeagueCard({ rows: rows, mine: mine, myPhoto: myPhoto, scope: leagueScopeLabel(), week: weekLabel });
        var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
        if (!blob) { toast('تعذر إنشاء الصورة', 'error'); return; }
        var file = new File([blob], 'mcsquiz-league.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'دوري MCSQuiz' });
            return;
          } catch (e) {
            if (e && e.name === 'AbortError') return;
          }
        }
        showSharePreview(URL.createObjectURL(blob));
      } catch (e) { toast('تعذر إنشاء المشاركة', 'error'); }
      finally {
        if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
      }
    }

    return {
      scopeRows: scopeRows,
      renderLeague: renderLeague,
      shareMyRank: shareMyRank,
      openPlayerCard: openPlayerCard
    };
  }

  global.PortalLeagueUI = {
    create: createLeagueUI
  };
})(window);
