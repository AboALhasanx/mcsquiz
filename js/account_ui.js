/* MCQ Portal — account_ui.js
 * Student Identity, Bento Stats Grid, and Achievements/Badges Engine.
 * Strictly no emojis, fully accessible, RTL-first, mobile-first.
 */
(function (global) {
  'use strict';

  var HISTORY_KEY = 'portal_history_v1';
  var SAVED_KEY = 'portal_saved_v1';

  var BADGE_DEFINITIONS = [
    {
      id: 'sniper',
      title: 'القناص',
      desc: 'إنهاء كوز كامل بنسبة 100%',
      icon: 'target',
      accent: 'gold',
      eval: function (stats) {
        return {
          unlocked: Boolean(stats.hasPerfectQuiz),
          detail: stats.hasPerfectQuiz ? 'دقة 100%' : 'بانتظار الإنجاز',
          progress: stats.hasPerfectQuiz ? '1 / 1' : '0 / 1'
        };
      }
    },
    {
      id: 'slayer',
      title: 'صائد الأساطير',
      desc: 'تحقيق 3 انتصارات في منافسات الأساطير',
      icon: 'swords',
      accent: 'purple',
      eval: function (stats) {
        var wins = Number(stats.vsWins) || 0;
        return {
          unlocked: wins >= 3,
          detail: wins >= 3 ? 'بطل المنافسات' : (wins + ' / 3 فوز'),
          progress: Math.min(wins, 3) + ' / 3'
        };
      }
    },
    {
      id: 'guardian',
      title: 'درع النظام',
      desc: 'حفظ 20 سؤالاً في بنك المراجعة',
      icon: 'shield',
      accent: 'cyan',
      eval: function (stats) {
        var saved = Number(stats.savedCount) || 0;
        return {
          unlocked: saved >= 20,
          detail: saved >= 20 ? 'بنك المحفوظات' : (saved + ' / 20 سؤالاً'),
          progress: Math.min(saved, 20) + ' / 20'
        };
      }
    },
    {
      id: 'streak_7',
      title: 'المثابر',
      desc: 'المذاكرة لـ 7 أيام متتالية',
      icon: 'flame',
      accent: 'orange',
      eval: function (stats) {
        var streak = Number(stats.streak) || 0;
        return {
          unlocked: streak >= 7,
          detail: streak >= 7 ? 'أسبوع متواصل' : (streak + ' / 7 أيام'),
          progress: Math.min(streak, 7) + ' / 7'
        };
      }
    },
    {
      id: 'century',
      title: 'نادي المئة',
      desc: 'حل أكثر من 100 سؤال اختباري',
      icon: 'award',
      accent: 'emerald',
      eval: function (stats) {
        var total = Number(stats.totalQuestions) || 0;
        return {
          unlocked: total >= 100,
          detail: total >= 100 ? '100+ سؤال' : (total + ' / 100'),
          progress: Math.min(total, 100) + ' / 100'
        };
      }
    }
  ];

  function dayKey(t) {
    var d = new Date(t || 0);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function computeStreak(history) {
    if (global.PortalReview && global.PortalReview.computeCombinedStreak) {
      var daysStore = {};
      try { daysStore = JSON.parse(localStorage.getItem('portal_days_v1') || '{}') || {}; } catch (e) {}
      return global.PortalReview.computeCombinedStreak(history, daysStore);
    }
    if (!history || !history.length) return 0;
    var days = {};
    history.forEach(function (h) {
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

  function getVsWins() {
    try {
      var raw = localStorage.getItem('portal_vs_recent_v1');
      if (!raw) return 0;
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return 0;
      var wins = 0;
      arr.forEach(function (m) {
        if (m && m.result === 'win') wins++;
      });
      return wins;
    } catch (e) {
      return 0;
    }
  }

  function computeStats() {
    var history = [];
    var saved = {};
    try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) {}
    try { saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}'); } catch (e) {}

    var totalQuizzes = history.length;
    var totalQuestions = 0;
    var totalCorrect = 0;
    var hasPerfectQuiz = false;

    history.forEach(function (h) {
      if (!h) return;
      var qTotal = Number(h.total) || 0;
      var qCorrect = Number(h.correct != null ? h.correct : (h.score != null ? h.score : 0));
      totalQuestions += qTotal;
      totalCorrect += qCorrect;
      if (qTotal >= 5 && (qCorrect === qTotal || h.pct === 100)) {
        hasPerfectQuiz = true;
      }
    });

    var accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
    var streak = computeStreak(history);
    var savedCount = Object.keys(saved).length;
    var vsWins = getVsWins();

    var daysMap = {};
    history.forEach(function (h) {
      if (h && h.t) daysMap[dayKey(h.t)] = true;
    });

    var weeklyDots = [];
    var dayLetters = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
    var dayFullNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    var curD = new Date();
    for (var di = 6; di >= 0; di--) {
      var pastD = new Date(curD.getTime() - di * 86400000);
      var dayIdx = pastD.getDay();
      var isToday = (di === 0);
      weeklyDots.push({
        active: Boolean(daysMap[dayKey(pastD.getTime())]),
        letter: dayLetters[dayIdx],
        fullName: dayFullNames[dayIdx],
        isToday: isToday
      });
    }

    return {
      totalQuizzes: totalQuizzes,
      totalQuestions: totalQuestions,
      totalCorrect: totalCorrect,
      accuracy: accuracy,
      streak: streak,
      weeklyDots: weeklyDots,
      hasPerfectQuiz: hasPerfectQuiz,
      savedCount: savedCount,
      vsWins: vsWins
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render(acc) {
    if (!acc) return;

    var stats = computeStats();

    // 1. Hero Identity Info
    var nameEl = document.getElementById('profile-display-name');
    if (nameEl) nameEl.textContent = acc.name || 'طالب';

    var handleEl = document.getElementById('account-body');
    if (handleEl) {
      handleEl.textContent = '@' + acc.handle + (navigator.onLine ? '' : ' · غير متصل');
    }

    // 2. League Standing Line
    var leagueLineEl = document.getElementById('profile-league-standing-text');
    if (leagueLineEl) {
      var S = global.__portalState || {};
      var me = S.leagueMe;
      var weeklyTotal = 0;
      if (global.PortalLeague && global.PortalLeague.weeklyXp) {
        try {
          var history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
          var w = global.PortalLeague.weeklyXp(history, global.PortalLeague.weekStart(Date.now()));
          weeklyTotal = w ? w.total : 0;
        } catch (e) {}
      }

      if (me && me.rank && me.rank > 0) {
        var tierName = (me.xp >= 250) ? 'الدوري الماسي' : ((me.xp >= 100) ? 'الدوري الذهبي' : ((me.xp >= 50) ? 'الدوري الفضي' : 'الدوري البرونزي'));
        leagueLineEl.textContent = 'المركز ' + me.rank + ' في ' + tierName + ' · ' + me.xp + ' نقطة';
      } else if (weeklyTotal > 0) {
        leagueLineEl.textContent = 'الدوري الأسبوعي · ' + weeklyTotal + ' نقطة هذا الأسبوع';
      } else {
        leagueLineEl.textContent = 'الدوري الأسبوعي · في انتظار أول محاولة';
      }
    }

    // 3. Bento Stats Grid
    var statXp = document.getElementById('profile-stat-league-xp');
    var statDesc = document.getElementById('profile-stat-league-desc');
    var xpVal = 0;
    if (global.PortalLeague && global.PortalLeague.weeklyXp) {
      try {
        var hArr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        var curW = global.PortalLeague.weeklyXp(hArr, global.PortalLeague.weekStart(Date.now()));
        xpVal = curW ? curW.total : 0;
      } catch (e) {}
    }
    if (statXp) statXp.textContent = String(xpVal);
    if (statDesc) {
      var tier = (xpVal >= 250) ? 'الفئة الماسية' : ((xpVal >= 100) ? 'الفئة الذهبية' : ((xpVal >= 50) ? 'الفئة الفضية' : 'الفئة البرونزية'));
      statDesc.textContent = tier;
    }

    var statStreak = document.getElementById('profile-stat-streak');
    if (statStreak) statStreak.textContent = String(stats.streak);

    var dotsContainer = document.getElementById('profile-streak-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      (stats.weeklyDots || []).forEach(function (dot) {
        var cap = document.createElement('div');
        cap.className = 'habit-day-capsule' + (dot.active ? ' is-active' : ' is-inactive') + (dot.isToday ? ' is-today' : '');
        cap.setAttribute('title', dot.fullName + (dot.active ? ': نشاط مذاكرة مكتمل' : ': استراحة'));

        var letterSpan = document.createElement('span');
        letterSpan.className = 'habit-day-letter';
        letterSpan.textContent = dot.letter;

        var dotIndicator = document.createElement('div');
        dotIndicator.className = 'habit-day-dot';
        if (dot.active) {
          dotIndicator.innerHTML = '<i data-lucide="check" class="habit-check-icon"></i>';
        }

        cap.appendChild(letterSpan);
        cap.appendChild(dotIndicator);
        dotsContainer.appendChild(cap);
      });
    }

    var streakSub = document.getElementById('profile-streak-sub');
    var streakBadge = document.getElementById('profile-streak-status-text');
    if (stats.streak > 0) {
      if (streakSub) streakSub.textContent = 'أنت في مسار دراسي ممتاز';
      if (streakBadge) streakBadge.textContent = 'شعلة مشتعلة';
    } else {
      if (streakSub) streakSub.textContent = 'أكمل كويز اليوم لتفعيل الشعلة';
      if (streakBadge) streakBadge.textContent = 'بانتظار البدء';
    }

    var statAcc = document.getElementById('profile-stat-accuracy');
    var statAccDetail = document.getElementById('profile-stat-accuracy-detail');
    var ringEl = document.getElementById('profile-stat-accuracy-ring');
    if (ringEl) {
      var C = 138.23;
      var pct = Math.max(0, Math.min(100, stats.accuracy));
      var offset = C * (1 - (pct / 100));
      ringEl.style.strokeDasharray = String(C);
      ringEl.style.strokeDashoffset = String(offset);
    }
    if (statAcc) statAcc.textContent = String(stats.accuracy);
    if (statAccDetail) statAccDetail.textContent = stats.totalCorrect + ' / ' + stats.totalQuestions;

    var statQuiz = document.getElementById('profile-stat-quizzes');
    var statSavedCount = document.getElementById('profile-stat-saved-count');
    if (statQuiz) statQuiz.textContent = String(stats.totalQuizzes);
    if (statSavedCount) statSavedCount.textContent = String(stats.savedCount);

    // 4. Badges / Honors Shelf
    renderBadges(stats);

    if (global.lucide && global.lucide.createIcons) {
      global.lucide.createIcons();
    }
  }

  function renderBadges(stats) {
    var grid = document.getElementById('profile-badges-grid');
    var countEl = document.getElementById('profile-badges-count');
    if (!grid) return;

    grid.innerHTML = '';

    if (global.PortalAchievements && global.PortalAchievements.evaluateAll) {
      var data = global.PortalAchievements.evaluateAll();
      var items = data.results || [];

      items.forEach(function (r) {
        var badge = r.badge;
        var evalRes = r.evalRes;
        var tierMeta = r.tierMeta;
        var isUnlocked = r.isUnlocked;

        var item = document.createElement('div');
        var tierClass = isUnlocked ? (tierMeta ? tierMeta.accentClass : 'tier-gold') : 'tier-locked';
        item.className = 'profile-badge-item ' + (isUnlocked ? 'is-unlocked ' : 'is-locked ') + tierClass;
        item.setAttribute('role', 'listitem');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', (evalRes.currentTierTitle || badge.title) + ': ' + evalRes.statusText);

        var iconHtml = '<div class="profile-badge-icon-box">' +
          '<i data-lucide="' + escapeHtml(badge.icon) + '"></i>' +
          '</div>';

        var titleHtml = '<span class="profile-badge-title">' + escapeHtml(evalRes.currentTierTitle || badge.title) + '</span>';
        var statusHtml = '<span class="profile-badge-status">' + escapeHtml(evalRes.statusText) + '</span>';

        item.innerHTML = iconHtml + titleHtml + statusHtml;

        item.addEventListener('click', function () {
          global.PortalAchievements.showBadgeSheet(badge.id);
        });

        grid.appendChild(item);
      });

      if (countEl) {
        countEl.textContent = data.unlockedCount + ' / ' + data.totalCount;
      }
      return;
    }

    var unlockedCount = 0;
    BADGE_DEFINITIONS.forEach(function (badge) {
      var res = badge.eval(stats);
      if (res.unlocked) unlockedCount++;

      var item = document.createElement('div');
      item.className = 'profile-badge-item' + (res.unlocked ? ' is-unlocked' : ' is-locked');
      item.setAttribute('role', 'listitem');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', badge.title + ': ' + badge.desc + ' — ' + (res.unlocked ? 'مكتمل' : 'قيد التقدم'));

      var iconHtml = '<div class="profile-badge-icon-box badge-accent-' + escapeHtml(badge.accent) + '">' +
        '<i data-lucide="' + escapeHtml(badge.icon) + '"></i>' +
        '</div>';

      var titleHtml = '<span class="profile-badge-title">' + escapeHtml(badge.title) + '</span>';
      var statusHtml = '<span class="profile-badge-status">' + escapeHtml(res.detail) + '</span>';

      item.innerHTML = iconHtml + titleHtml + statusHtml;

      item.addEventListener('click', function () {
        var msg = badge.title + ': ' + badge.desc + ' (' + (res.unlocked ? 'مكتمل' : res.progress) + ')';
        if (typeof global.toast === 'function') {
          global.toast(msg, res.unlocked ? 'success' : 'info');
        }
      });

      grid.appendChild(item);
    });

    if (countEl) {
      countEl.textContent = unlockedCount + ' / ' + BADGE_DEFINITIONS.length;
    }
  }

  function init() {
    var contentEl = document.getElementById('account-profile-content');
    var toggleBtn = document.getElementById('account-profile-toggle');

    function setSettingsOpen(open, smooth) {
      if (!contentEl || !toggleBtn) return;
      toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      contentEl.classList.toggle('collapsed', !open);
      if (open && smooth) {
        toggleBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    var isDebug = (location.search || '').indexOf('debug=1') >= 0;
    // Real student usage starts collapsed, debug mode defaults open for test suite
    setSettingsOpen(isDebug, false);

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        var isOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
        setSettingsOpen(!isOpen, true);
      });
    }

    function copyHandleAction() {
      var C = global.PortalCloud;
      var acc = (C && C.account) ? C.account() : null;
      if (!acc || !acc.handle) return;
      var text = '@' + acc.handle;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          var statusIcon = document.getElementById('profile-copy-status');
          if (statusIcon) {
            statusIcon.innerHTML = '<i data-lucide="check" class="copy-success-icon"></i>';
            if (global.lucide && global.lucide.createIcons) global.lucide.createIcons();
            setTimeout(function () {
              if (statusIcon) {
                statusIcon.innerHTML = '<i data-lucide="copy"></i>';
                if (global.lucide && global.lucide.createIcons) global.lucide.createIcons();
              }
            }, 1800);
          }
          if (typeof global.toast === 'function') global.toast('تم نسخ المعرف: ' + text);
        }).catch(function () {});
      }
    }

    var handlePill = document.getElementById('profile-handle-pill');
    if (handlePill) handlePill.addEventListener('click', copyHandleAction);
    var copyBtn = document.getElementById('profile-copy-handle');
    if (copyBtn) copyBtn.addEventListener('click', copyHandleAction);

    var settingsBtn = document.getElementById('account-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
        setSettingsOpen(true, true);
        var nameInput = document.getElementById('profile-name');
        if (nameInput) {
          setTimeout(function () { nameInput.focus(); }, 180);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.PortalAccountUI = {
    computeStats: computeStats,
    render: render,
    BADGE_DEFINITIONS: BADGE_DEFINITIONS
  };
})(window);
