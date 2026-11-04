/* MCQ Portal — achievements.js
 * High-performance, deterministic Achievements & Badges Engine.
 * Multi-tier progressive progression (Bronze, Silver, Gold, Diamond) and single feat milestones.
 * Strictly zero emojis, clean Arabic MSA, RTL-first, mobile-first.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'portal_achievements_v1';
  var HISTORY_KEY = 'portal_history_v1';
  var SAVED_KEY = 'portal_saved_v1';
  var VS_KEY = 'portal_vs_recent_v1';

  var TIERS = {
    1: { id: 'bronze', label: 'الفئة البرونزية', color: '#d97706', accentClass: 'tier-bronze' },
    2: { id: 'silver', label: 'الفئة الفضية', color: '#94a3b8', accentClass: 'tier-silver' },
    3: { id: 'gold', label: 'الفئة الذهبية', color: '#eab308', accentClass: 'tier-gold' },
    4: { id: 'diamond', label: 'الفئة الماسية', color: '#38bdf8', accentClass: 'tier-diamond' }
  };

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
      var raw = localStorage.getItem(VS_KEY);
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

  function getAggregateStats(historyOverride) {
    var history = [];
    var saved = {};
    if (Array.isArray(historyOverride)) {
      history = historyOverride;
    } else {
      try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) {}
    }
    try { saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}'); } catch (e) {}

    var totalQuizzes = history.length;
    var totalQuestions = 0;
    var totalCorrect = 0;
    var totalSecs = 0;
    var hasPerfectQuiz = false;
    var hasSpeedDemon = false;
    var hasEarlyBird = false;
    var hasNightOwl = false;

    history.forEach(function (h) {
      if (!h) return;
      var qTotal = Number(h.total) || 0;
      var qCorrect = Number(h.correct != null ? h.correct : (h.score != null ? h.score : 0));
      var qSecs = Number(h.secs) || 0;

      totalQuestions += qTotal;
      totalCorrect += qCorrect;
      totalSecs += qSecs;

      // Single feats evaluation
      if (qTotal >= 5 && (qCorrect === qTotal || h.pct === 100)) {
        hasPerfectQuiz = true;
      }
      if (qTotal >= 8 && qSecs > 0 && (qSecs / qTotal) <= 15 && (h.pct >= 80)) {
        hasSpeedDemon = true;
      }

      if (h.t) {
        var dt = new Date(h.t);
        var hr = dt.getHours();
        var min = dt.getMinutes();
        var decHr = hr + (min / 60);
        if (decHr >= 5 && decHr <= 8.5) hasEarlyBird = true;
        if (hr >= 23 || hr < 4) hasNightOwl = true;
      }
    });

    var accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
    var streak = computeStreak(history);
    var savedCount = Object.keys(saved).length;
    var vsWins = getVsWins();

    return {
      history: history,
      totalQuizzes: totalQuizzes,
      totalQuestions: totalQuestions,
      totalCorrect: totalCorrect,
      accuracy: accuracy,
      streak: streak,
      savedCount: savedCount,
      vsWins: vsWins,
      hasPerfectQuiz: hasPerfectQuiz,
      hasSpeedDemon: hasSpeedDemon,
      hasEarlyBird: hasEarlyBird,
      hasNightOwl: hasNightOwl
    };
  }

  /* Catalog of 8 Core Badges */
  var CATALOG = [
    {
      id: 'streak_master',
      category: 'habit',
      title: 'المثابر',
      desc: 'المذاكرة اليومية المتتالية وبناء عادة الاستمرار',
      icon: 'flame',
      isSingleFeat: false,
      tiers: [
        { level: 1, rank: 'bronze', target: 3, title: 'المثابر البرونزي', desc: 'المذاكرة لـ 3 أيام متتالية' },
        { level: 2, rank: 'silver', target: 7, title: 'المثابر الفضي', desc: 'المذاكرة لأسبوع متواصل (7 أيام)' },
        { level: 3, rank: 'gold', target: 30, title: 'المثابر الذهبي', desc: 'المذاكرة لشهر متواصل (30 يوماً)' },
        { level: 4, rank: 'diamond', target: 100, title: 'المثابر الماسي', desc: 'الوصول إلى 100 يوم متتالية' }
      ],
      evaluate: function (stats) {
        var val = stats.streak || 0;
        return evaluateTiers(val, this.tiers, 'يوم', 'أيام');
      }
    },
    {
      id: 'question_milestone',
      category: 'volume',
      title: 'بنك الأسئلة',
      desc: 'التدريب المكثف وحل مئات الأسئلة في المواد الطبية',
      icon: 'award',
      isSingleFeat: false,
      tiers: [
        { level: 1, rank: 'bronze', target: 50, title: 'هاوي الأسئلة', desc: 'حل 50 سؤالاً تدريبياً' },
        { level: 2, rank: 'silver', target: 250, title: 'جامع المعرفة', desc: 'حل 250 سؤالاً تدريبياً' },
        { level: 3, rank: 'gold', target: 1000, title: 'خبير الأسئلة', desc: 'حل 1,000 سؤال تدريبي' },
        { level: 4, rank: 'diamond', target: 5000, title: 'أسطورة الاختبارات', desc: 'حل 5,000 سؤال تدريبي' }
      ],
      evaluate: function (stats) {
        var val = stats.totalQuestions || 0;
        return evaluateTiers(val, this.tiers, 'سؤال', 'سؤالاً');
      }
    },
    {
      id: 'sniper',
      category: 'mastery',
      title: 'القناص',
      desc: 'إنهاء كوز كامل (5 أسئلة أو أكثر) بدقة 100% دون أي خطأ',
      icon: 'target',
      isSingleFeat: true,
      featTier: 'gold',
      evaluate: function (stats) {
        var unl = Boolean(stats.hasPerfectQuiz);
        return {
          currentVal: unl ? 1 : 0,
          targetVal: 1,
          achievedTier: unl ? 3 : 0, // Gold feat
          progressPct: unl ? 100 : 0,
          statusText: unl ? 'دقة 100% محققة' : 'بانتظار كويز كامل بدون خطأ',
          currentTierTitle: 'القناص الذهبي',
          nextTierDesc: 'إنهاء كويز كامل بنسبة 100%'
        };
      }
    },
    {
      id: 'system_shield',
      category: 'retention',
      title: 'درع النظام',
      desc: 'تجميع الأسئلة الصعبة في بنك المحفوظات للعودة ومراجعتها',
      icon: 'shield',
      isSingleFeat: false,
      tiers: [
        { level: 1, rank: 'bronze', target: 10, title: 'حارس المحفوظات', desc: 'حفظ 10 أسئلة للمراجعة' },
        { level: 2, rank: 'silver', target: 50, title: 'خازن المعرفة', desc: 'حفظ 50 سؤالاً للمراجعة' },
        { level: 3, rank: 'gold', target: 150, title: 'الدرع الحصين', desc: 'حفظ 150 سؤالاً للمراجعة' }
      ],
      evaluate: function (stats) {
        var val = stats.savedCount || 0;
        return evaluateTiers(val, this.tiers, 'سؤال', 'سؤالاً');
      }
    },
    {
      id: 'quiz_finisher',
      category: 'volume',
      title: 'المنجز الماراثوني',
      desc: 'إتمام الكوزات بالكامل والالتزام بإنهاء كل اختبار بدأته',
      icon: 'layers',
      isSingleFeat: false,
      tiers: [
        { level: 1, rank: 'bronze', target: 5, title: 'المبادر', desc: 'إنهاء 5 كوزات كاملة' },
        { level: 2, rank: 'silver', target: 25, title: 'المواظب', desc: 'إنهاء 25 كويزاً كاملاً' },
        { level: 3, rank: 'gold', target: 100, title: 'الماراثوني', desc: 'إنهاء 100 كويز كامل' }
      ],
      evaluate: function (stats) {
        var val = stats.totalQuizzes || 0;
        return evaluateTiers(val, this.tiers, 'كويز', 'كوزات');
      }
    },
    {
      id: 'legend_slayer',
      category: 'legends',
      title: 'صائد الأساطير',
      desc: 'تحقيق الانتصارات في منافسات التحدي المباشر ونزال الأساطير',
      icon: 'swords',
      isSingleFeat: false,
      tiers: [
        { level: 1, rank: 'bronze', target: 1, title: 'المتحدي الأول', desc: 'تحقيق أول فوز في التحدي' },
        { level: 2, rank: 'silver', target: 5, title: 'صائد الأساطير', desc: 'تحقيق 5 انتصارات' },
        { level: 3, rank: 'gold', target: 20, title: 'سيد الحلبة', desc: 'تحقيق 20 انتصاراً' }
      ],
      evaluate: function (stats) {
        var val = stats.vsWins || 0;
        return evaluateTiers(val, this.tiers, 'فوز', 'انتصارات');
      }
    },
    {
      id: 'speed_demon',
      category: 'mastery',
      title: 'السرعة القياسية',
      desc: 'إنهاء كوز (8 أسئلة فأكثر) بمتوسط أقل من 15 ثانية للسؤال وبدقة 80% فأعلى',
      icon: 'zap',
      isSingleFeat: true,
      featTier: 'silver',
      evaluate: function (stats) {
        var unl = Boolean(stats.hasSpeedDemon);
        return {
          currentVal: unl ? 1 : 0,
          targetVal: 1,
          achievedTier: unl ? 2 : 0, // Silver feat
          progressPct: unl ? 100 : 0,
          statusText: unl ? 'إجابة فائقة السرعة والدقة' : 'أقل من 15 ثانية/سؤال ودقة 80%+',
          currentTierTitle: 'السرعة القياسية',
          nextTierDesc: 'إنهاء كويز بدقة ≥ 80% ومتوسط < 15 ثانية للسؤال'
        };
      }
    },
    {
      id: 'early_bird',
      category: 'habit',
      title: 'طائر الصباح',
      desc: 'بدء اليوم الدراسي باكراً وإتمام كوز كامل بين الساعة 5:00 و 8:30 صباحاً',
      icon: 'sunrise',
      isSingleFeat: true,
      featTier: 'bronze',
      evaluate: function (stats) {
        var unl = Boolean(stats.hasEarlyBird);
        return {
          currentVal: unl ? 1 : 0,
          targetVal: 1,
          achievedTier: unl ? 1 : 0, // Bronze feat
          progressPct: unl ? 100 : 0,
          statusText: unl ? 'همة صباحية عالية' : 'كويز كامل بين 5:00 و 8:30 صباحاً',
          currentTierTitle: 'طائر الصباح',
          nextTierDesc: 'إتمام كويز بين 5:00 و 8:30 صباحاً'
        };
      }
    }
  ];

  function evaluateTiers(currentVal, tiers, unitSingle, unitPlural) {
    var achievedTier = 0;
    var targetVal = tiers[0].target;
    var currentTierTitle = tiers[0].title;
    var nextTierDesc = tiers[0].desc;

    for (var i = 0; i < tiers.length; i++) {
      if (currentVal >= tiers[i].target) {
        achievedTier = tiers[i].level;
        currentTierTitle = tiers[i].title;
      } else {
        targetVal = tiers[i].target;
        nextTierDesc = tiers[i].desc;
        break;
      }
    }

    var progressPct = Math.min(100, Math.round((currentVal / targetVal) * 100));
    var unit = (currentVal === 1) ? unitSingle : unitPlural;
    var statusText = '';
    if (achievedTier === tiers.length) {
      statusText = 'أعلى فئة مكتملة (' + currentVal + ' ' + unit + ')';
    } else {
      statusText = currentVal + ' / ' + targetVal + ' ' + unit;
    }

    return {
      currentVal: currentVal,
      targetVal: targetVal,
      achievedTier: achievedTier,
      progressPct: progressPct,
      statusText: statusText,
      currentTierTitle: currentTierTitle,
      nextTierDesc: nextTierDesc
    };
  }

  var SUBJECT_MASTERY_THRESHOLD = 80;

  var SUBJECT_METADATA = {
    '01_Cyber_Security': { icon: 'shield-check', color: '#06b6d4', accentClass: 'mastery-cyber', shortTitle: 'الأمن السيبراني' },
    '02_English_Language': { icon: 'languages', color: '#f97316', accentClass: 'mastery-english', shortTitle: 'اللغة الإنجليزية' },
    '03_Data_Mining': { icon: 'database', color: '#eab308', accentClass: 'mastery-mining', shortTitle: 'تنقيب البيانات' },
    '04_Advanced_Software_Eng': { icon: 'cpu', color: '#3b82f6', accentClass: 'mastery-swe', shortTitle: 'هندسة البرمجيات' },
    '05_Soft_Computing': { icon: 'network', color: '#a855f7', accentClass: 'mastery-soft', shortTitle: 'الحوسبة اللينة' },
    '06_Artificial_Intelligence': { icon: 'sparkles', color: '#10b981', accentClass: 'mastery-ai', shortTitle: 'الذكاء الاصطناعي' }
  };

  function getSubjectMeta(subjectId, fallbackTitle) {
    var meta = SUBJECT_METADATA[subjectId];
    if (meta) return meta;
    return {
      icon: 'award',
      color: '#38bdf8',
      accentClass: 'mastery-default',
      shortTitle: fallbackTitle || subjectId || 'مادة دراسية'
    };
  }

  function getBestScore(quizId) {
    try {
      var raw = localStorage.getItem('portal_best_' + quizId);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return (obj && typeof obj.pct === 'number') ? obj : null;
    } catch (e) { // audit-ignore: optional storage read
      return null;
    }
  }

  function evaluateSubjectMastery(subjectsOverride, getBestOverride) {
    var subjects = [];
    if (Array.isArray(subjectsOverride)) {
      subjects = subjectsOverride;
    } else {
      var state = global.__portalState || (global.__portal && global.__portal.S) || {};
      if (state.index && Array.isArray(state.index.subjects)) {
        subjects = state.index.subjects;
      }
    }

    var bestFn = (typeof getBestOverride === 'function') ? getBestOverride : getBestScore;
    var outSubjects = [];
    var masteredCount = 0;

    subjects.forEach(function (sub) {
      if (!sub) return;
      var subId = sub.subject_id || '';
      var subTitle = sub.subject_title || subId;
      var meta = getSubjectMeta(subId, subTitle);
      var chapters = Array.isArray(sub.chapters) ? sub.chapters : [];
      var totalQuizzes = chapters.length;
      var completedQuizzes = 0;
      var sumPct = 0;

      chapters.forEach(function (ch) {
        if (!ch || !ch.quiz_id) return;
        var b = bestFn(ch.quiz_id);
        if (b && typeof b.pct === 'number') {
          completedQuizzes++;
          sumPct += Number(b.pct);
        }
      });

      var avgPct = completedQuizzes > 0 ? Math.round(sumPct / completedQuizzes) : 0;
      var progressPct = totalQuizzes > 0 ? Math.min(100, Math.round((completedQuizzes / totalQuizzes) * 100)) : 0;
      var isMastered = (totalQuizzes > 0 && completedQuizzes === totalQuizzes && avgPct >= SUBJECT_MASTERY_THRESHOLD);

      var tier = 0;
      if (isMastered) {
        masteredCount++;
        if (avgPct >= 98) tier = 4;      // Diamond
        else if (avgPct >= 90) tier = 3; // Gold
        else tier = 2;                   // Silver
      }

      var tierMeta = TIERS[tier] || null;
      var statusText = '';
      if (isMastered) {
        statusText = 'مُتقَن (' + completedQuizzes + '/' + totalQuizzes + ' · ' + avgPct + '%)';
      } else if (completedQuizzes === 0) {
        statusText = '0 / ' + totalQuizzes + ' كوزات · لم تبدأ بعد';
      } else {
        statusText = completedQuizzes + ' / ' + totalQuizzes + ' كوزات · ' + avgPct + '%';
      }

      outSubjects.push({
        subjectId: subId,
        title: subTitle,
        shortTitle: meta.shortTitle,
        icon: meta.icon,
        color: meta.color,
        accentClass: meta.accentClass,
        totalQuizzes: totalQuizzes,
        completedQuizzes: completedQuizzes,
        sumPct: sumPct,
        avgPct: avgPct,
        progressPct: progressPct,
        isMastered: isMastered,
        tier: tier,
        tierMeta: tierMeta,
        statusText: statusText
      });
    });

    return {
      subjects: outSubjects,
      masteredCount: masteredCount,
      totalSubjects: outSubjects.length
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, unlocked: {}, recentUnlocks: [] };
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (!parsed.unlocked) parsed.unlocked = {};
        if (!parsed.recentUnlocks) parsed.recentUnlocks = [];
        return parsed;
      }
    } catch (e) {}
    return { version: 1, unlocked: {}, recentUnlocks: [] };
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  /* Deterministic evaluation of all badges */
  function evaluateAll() {
    var stats = getAggregateStats();
    var state = loadState();
    var results = [];
    var changed = false;

    CATALOG.forEach(function (badge) {
      var evalRes = badge.evaluate(stats);
      var record = state.unlocked[badge.id] || { tier: 0, unlockedAt: 0, lastNotifiedTier: 0 };

      // Update state if new tier reached
      if (evalRes.achievedTier > record.tier) {
        record.tier = evalRes.achievedTier;
        if (!record.unlockedAt) record.unlockedAt = Date.now();
        // Retroactive backfill: If first load with existing history, mark notified to avoid popup spam
        if (record.lastNotifiedTier === 0 && !state.hasBootstrapped) {
          record.lastNotifiedTier = evalRes.achievedTier;
        }
        state.unlocked[badge.id] = record;
        changed = true;
      }

      var tierMeta = TIERS[evalRes.achievedTier] || null;

      results.push({
        badge: badge,
        evalRes: evalRes,
        record: record,
        tierMeta: tierMeta,
        isUnlocked: evalRes.achievedTier > 0
      });
    });

    var subjectMastery = evaluateSubjectMastery();

    if (!state.hasBootstrapped) {
      state.hasBootstrapped = true;
      if (subjectMastery && Array.isArray(subjectMastery.subjects)) {
        subjectMastery.subjects.forEach(function (s) {
          if (s.isMastered) {
            var k = 'mastery_' + s.subjectId;
            var rec = state.unlocked[k] || { tier: 0, unlockedAt: 0, lastNotifiedTier: 0 };
            rec.tier = s.tier;
            rec.lastNotifiedTier = s.tier;
            if (!rec.unlockedAt) rec.unlockedAt = Date.now();
            state.unlocked[k] = rec;
          }
        });
      }
      changed = true;
    }

    if (changed) saveState(state);

    return {
      stats: stats,
      results: results,
      unlockedCount: results.filter(function (r) { return r.isUnlocked; }).length,
      totalCount: CATALOG.length,
      subjectMastery: subjectMastery
    };
  }

  /* Check immediately after quiz completion */
  function checkAfterQuiz(ses, res) {
    var stats = getAggregateStats();
    if (res) {
      var rTotal = Number(res.total) || 0;
      var rCorrect = Number(res.correct != null ? res.correct : (res.score != null ? res.score : 0));
      var rSecs = Number(res.secs) || 0;
      var rPct = Number(res.pct) || 0;
      if (rTotal >= 5 && (rCorrect === rTotal || rPct === 100)) {
        stats.hasPerfectQuiz = true;
      }
      if (rTotal >= 8 && rSecs > 0 && (rSecs / rTotal) <= 15 && rPct >= 80) {
        stats.hasSpeedDemon = true;
      }
    }
    var state = loadState();
    var newlyUnlocked = [];

    // If this device never bootstrapped, baseline prior history so we don't spam celebrations
    // for achievements that were already earned before this quiz.
    if (!state.hasBootstrapped) {
      state.hasBootstrapped = true;
      if (stats.history.length > 1) {
        var priorStats = getAggregateStats(stats.history.slice(0, -1));
        CATALOG.forEach(function (badge) {
          var priorEval = badge.evaluate(priorStats);
          if (priorEval.achievedTier > 0) {
            state.unlocked[badge.id] = {
              tier: priorEval.achievedTier,
              unlockedAt: Date.now(),
              lastNotifiedTier: priorEval.achievedTier
            };
          }
        });
        // Also baseline prior subject mastery
        try {
          var priorSm = evaluateSubjectMastery();
          if (priorSm && Array.isArray(priorSm.subjects)) {
            priorSm.subjects.forEach(function (s) {
              if (s.isMastered) {
                var pk = 'mastery_' + s.subjectId;
                state.unlocked[pk] = {
                  tier: s.tier,
                  unlockedAt: Date.now(),
                  lastNotifiedTier: s.tier
                };
              }
            });
          }
        } catch (e) {} // audit-ignore: optional prior mastery baseline
      }
    }

    CATALOG.forEach(function (badge) {
      var evalRes = badge.evaluate(stats);
      var record = state.unlocked[badge.id] || { tier: 0, unlockedAt: 0, lastNotifiedTier: 0 };

      if (evalRes.achievedTier > record.tier) {
        record.tier = evalRes.achievedTier;
        record.unlockedAt = Date.now();
        state.unlocked[badge.id] = record;

        // Check if celebration notification is due
        if (record.tier > record.lastNotifiedTier) {
          record.lastNotifiedTier = record.tier;
          state.unlocked[badge.id] = record;
          var tierMeta = TIERS[record.tier] || { label: 'وسام إنجاز', color: '#d97706' };

          newlyUnlocked.push({
            badge: badge,
            tier: record.tier,
            tierMeta: tierMeta,
            title: evalRes.currentTierTitle || badge.title,
            desc: badge.desc
          });
        }
      }
    });

    // Check subject mastery transitions
    try {
      var sm = evaluateSubjectMastery();
      if (sm && Array.isArray(sm.subjects)) {
        sm.subjects.forEach(function (s) {
          if (s.isMastered) {
            var stateKey = 'mastery_' + s.subjectId;
            var sRec = state.unlocked[stateKey] || { tier: 0, unlockedAt: 0, lastNotifiedTier: 0 };
            if (s.tier > sRec.tier) {
              sRec.tier = s.tier;
              sRec.unlockedAt = Date.now();
              state.unlocked[stateKey] = sRec;

              if (sRec.tier > sRec.lastNotifiedTier) {
                sRec.lastNotifiedTier = sRec.tier;
                state.unlocked[stateKey] = sRec;
                var sTierMeta = s.tierMeta || TIERS[s.tier] || { label: 'وسام إتقان المادة', color: s.color };

                newlyUnlocked.push({
                  badge: { id: stateKey, icon: s.icon },
                  tier: s.tier,
                  tierMeta: sTierMeta,
                  title: 'وسام إتقان: ' + s.shortTitle,
                  desc: 'إتمام كافة كوزات مادة ' + s.shortTitle + ' بمعدل 80% فأعلى'
                });
              }
            }
          }
        });
      }
    } catch (e) {} // audit-ignore: optional subject mastery celebration

    if (newlyUnlocked.length > 0) {
      saveState(state);
      // Trigger instant celebration for the highest achievement
      var topItem = newlyUnlocked[0];
      showCelebrationHUD(topItem);
    }

    return newlyUnlocked;
  }

  /* Non-blocking Floating Pill HUD celebration */
  var _hudTimer = null;
  function showCelebrationHUD(item) {
    if (!item) return;
    var pill = document.getElementById('achievement-hud-pill');
    if (!pill) return;

    var iconEl = document.getElementById('hud-pill-icon');
    var titleEl = document.getElementById('hud-pill-title');
    var kickerEl = document.getElementById('hud-pill-kicker');

    if (titleEl) titleEl.textContent = item.title;
    if (kickerEl) kickerEl.textContent = item.tierMeta ? item.tierMeta.label : 'وسام جديد أُحرز!';
    if (iconEl && item.badge) {
      iconEl.innerHTML = '<i data-lucide="' + escapeHtml(item.badge.icon) + '"></i>';
      iconEl.style.color = item.tierMeta ? item.tierMeta.color : '#eab308';
    }

    pill.classList.remove('hidden');
    // Force reflow for CSS slide down transition
    void pill.offsetWidth;
    pill.classList.add('is-active');

    // Play completed chime if sound enabled
    try {
      var S = global.__portalState || {};
      if (S.sound !== false && typeof global.Audio === 'function') {
        var snd = new Audio('sounds/completed.mp3');
        snd.currentTime = 0;
        snd.play().catch(function () {});
      }
    } catch (e) {}

    if (global.lucide && global.lucide.createIcons) global.lucide.createIcons();

    if (_hudTimer) clearTimeout(_hudTimer);
    _hudTimer = setTimeout(function () {
      pill.classList.remove('is-active');
      setTimeout(function () { pill.classList.add('hidden'); }, 300);
    }, 3800);
  }

  /* Bottom Sheet details inspector */
  function showBadgeSheet(badgeId) {
    if (typeof badgeId === 'string' && badgeId.indexOf('mastery_') === 0) {
      return showSubjectMasterySheet(badgeId.substring(8));
    }
    var badge = CATALOG.find(function (b) { return b.id === badgeId; });
    if (!badge) return;

    var stats = getAggregateStats();
    var evalRes = badge.evaluate(stats);
    var state = loadState();
    var record = state.unlocked[badge.id] || { tier: 0, unlockedAt: 0 };
    var tierMeta = TIERS[evalRes.achievedTier] || null;

    var sheet = document.getElementById('badge-sheet');
    var overlay = document.getElementById('badge-sheet-overlay');
    if (!sheet || !overlay) return;

    var emblemEl = document.getElementById('badge-sheet-emblem');
    var rankEl = document.getElementById('badge-sheet-rank');
    var titleEl = document.getElementById('badge-sheet-title');
    var descEl = document.getElementById('badge-sheet-desc');
    var progValEl = document.getElementById('badge-sheet-progress-val');
    var progFillEl = document.getElementById('badge-sheet-progress-fill');
    var progLabelEl = document.getElementById('badge-sheet-progress-label');
    var dateEl = document.getElementById('badge-sheet-date');

    // Populate emblem
    var isUnlocked = evalRes.achievedTier > 0;
    var emblemClass = isUnlocked ? (tierMeta ? tierMeta.accentClass : 'tier-gold') : 'tier-locked';

    if (emblemEl) {
      emblemEl.className = 'badge-sheet-emblem-wrap ' + emblemClass;
      emblemEl.innerHTML = '<div class="sheet-emblem-halo"></div>' +
        '<div class="sheet-emblem-disc">' +
        '<i data-lucide="' + escapeHtml(badge.icon) + '"></i>' +
        '</div>';
    }

    if (titleEl) titleEl.textContent = evalRes.currentTierTitle || badge.title;
    if (descEl) descEl.textContent = badge.desc;

    if (rankEl) {
      if (isUnlocked) {
        rankEl.textContent = tierMeta ? tierMeta.label : 'وسام شرفي';
        rankEl.className = 'badge-sheet-rank-tag ' + (tierMeta ? tierMeta.accentClass : 'tier-gold');
      } else {
        rankEl.textContent = 'قيد الانتظار';
        rankEl.className = 'badge-sheet-rank-tag tier-locked';
      }
    }

    if (progValEl) progValEl.textContent = evalRes.statusText;
    if (progFillEl) progFillEl.style.width = evalRes.progressPct + '%';
    if (progLabelEl) {
      progLabelEl.textContent = isUnlocked && evalRes.progressPct === 100
        ? 'تم إكمال أعلى رتبة بالكامل'
        : 'التقدم نحو: ' + evalRes.nextTierDesc;
    }

    if (dateEl) {
      if (isUnlocked && record.unlockedAt) {
        var dt = new Date(record.unlockedAt);
        dateEl.textContent = 'أُحرز بتاريخ ' + dt.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
      } else {
        dateEl.textContent = 'لم يتم الفتح بعد — أنجز المتطلب لضمه إلى رف الشرف';
      }
    }

    var shareBtn = document.getElementById('badge-sheet-share-btn');
    if (shareBtn) {
      if (isUnlocked) {
        shareBtn.classList.remove('hidden');
        shareBtn.onclick = function () {
          shareBadgeCard(badge, evalRes, tierMeta, record);
        };
      } else {
        shareBtn.classList.add('hidden');
      }
    }

    sheet.classList.remove('hidden');
    overlay.classList.remove('hidden');
    void sheet.offsetWidth;
    sheet.classList.add('is-open');
    overlay.classList.add('is-open');

    if (global.lucide && global.lucide.createIcons) global.lucide.createIcons();
  }

  function closeBadgeSheet() {
    var sheet = document.getElementById('badge-sheet');
    var overlay = document.getElementById('badge-sheet-overlay');
    if (!sheet || !overlay) return;

    sheet.classList.remove('is-open');
    overlay.classList.remove('is-open');
    setTimeout(function () {
      sheet.classList.add('hidden');
      overlay.classList.add('hidden');
    }, 280);
  }

  function showSubjectMasterySheet(subjectId) {
    var sm = evaluateSubjectMastery();
    var sub = (sm.subjects || []).find(function (s) { return s.subjectId === subjectId; });
    if (!sub) return;

    var sheet = document.getElementById('badge-sheet');
    var overlay = document.getElementById('badge-sheet-overlay');
    if (!sheet || !overlay) return;

    var emblemEl = document.getElementById('badge-sheet-emblem');
    var rankEl = document.getElementById('badge-sheet-rank');
    var titleEl = document.getElementById('badge-sheet-title');
    var descEl = document.getElementById('badge-sheet-desc');
    var progValEl = document.getElementById('badge-sheet-progress-val');
    var progFillEl = document.getElementById('badge-sheet-progress-fill');
    var progLabelEl = document.getElementById('badge-sheet-progress-label');
    var dateEl = document.getElementById('badge-sheet-date');

    var isUnlocked = sub.isMastered;
    var emblemClass = isUnlocked ? (sub.tierMeta ? sub.tierMeta.accentClass : 'tier-gold') : 'tier-locked';

    if (emblemEl) {
      emblemEl.className = 'badge-sheet-emblem-wrap ' + emblemClass;
      emblemEl.innerHTML = '<div class="sheet-emblem-halo"></div>' +
        '<div class="sheet-emblem-disc">' +
        '<i data-lucide="' + escapeHtml(sub.icon) + '"></i>' +
        '</div>';
    }

    if (titleEl) titleEl.textContent = 'وسام إتقان: ' + sub.title;
    if (descEl) descEl.textContent = 'إتمام جميع كوزات مادة ' + sub.title + ' البالغ عددها ' + sub.totalQuizzes + ' كوزاً بمعدل 80% فأعلى';

    if (rankEl) {
      if (isUnlocked) {
        rankEl.textContent = sub.tierMeta ? sub.tierMeta.label : 'وسام إتقان معتمد';
        rankEl.className = 'badge-sheet-rank-tag ' + (sub.tierMeta ? sub.tierMeta.accentClass : 'tier-gold');
      } else {
        rankEl.textContent = 'قيد المذاكرة والتدريب';
        rankEl.className = 'badge-sheet-rank-tag tier-locked';
      }
    }

    if (progValEl) progValEl.textContent = sub.completedQuizzes + ' / ' + sub.totalQuizzes + ' كوزاً مكتملة';
    if (progFillEl) progFillEl.style.width = sub.progressPct + '%';
    if (progLabelEl) {
      if (isUnlocked) {
        progLabelEl.textContent = 'تم إتقان المادة بنجاح (المعدل الإجمالي: ' + sub.avgPct + '%)';
      } else if (sub.completedQuizzes === 0) {
        progLabelEl.textContent = 'الهدف: إتمام كافة كوزات المادة بمعدل ≥ 80%';
      } else {
        progLabelEl.textContent = 'المعدل الحالي: ' + sub.avgPct + '% · متبقي ' + (sub.totalQuizzes - sub.completedQuizzes) + ' كوزاً';
      }
    }

    if (dateEl) {
      if (isUnlocked) {
        dateEl.textContent = 'إتقان أكاديمي معتمد ومسجل في حساب الطالب';
      } else {
        dateEl.textContent = 'أكمل باقي كوزات المادة بمتوسط 80% فأعلى لفتح الوسام';
      }
    }

    var shareBtn = document.getElementById('badge-sheet-share-btn');
    if (shareBtn) {
      if (isUnlocked) {
        shareBtn.classList.remove('hidden');
        shareBtn.onclick = function () {
          shareSubjectMasteryCard(sub);
        };
      } else {
        shareBtn.classList.add('hidden');
      }
    }

    sheet.classList.remove('hidden');
    overlay.classList.remove('hidden');
    void sheet.offsetWidth;
    sheet.classList.add('is-open');
    overlay.classList.add('is-open');

    if (global.lucide && global.lucide.createIcons) global.lucide.createIcons();
  }

  /* --- Canvas Badge Share Card Generation (Offline Safe) --- */
  function drawRoundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawSvgToCanvas(ctx, svgString, x, y, w, h) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        ctx.drawImage(img, x, y, w, h);
        resolve(true);
      };
      img.onerror = function () {
        resolve(false);
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    });
  }

  async function shareBadgeCard(badge, evalRes, tierMeta, record) {
    if (!badge || !evalRes) return;
    if (typeof global.toast === 'function') global.toast('نجهّز بطاقة الوسام…', 'info');

    var W = 800;
    var H = 960;
    var c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    var ctx = c.getContext('2d');
    ctx.direction = 'rtl';
    ctx.textBaseline = 'alphabetic';

    // 1. Dark Gradient Background
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#090d16');
    bg.addColorStop(1, '#0e1626');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 2. Radial Glow matching tier color
    var tierColor = (tierMeta && tierMeta.color) ? tierMeta.color : '#eab308';
    var glow = ctx.createRadialGradient(W / 2, 380, 40, W / 2, 380, 420);
    glow.addColorStop(0, tierColor);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 760);
    ctx.globalAlpha = 1.0;

    // 3. Card Outer Border
    drawRoundRect(ctx, 32, 32, W - 64, H - 64, 32);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 4. Header Bar
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 36px "MCSQuiz Arabic", sans-serif';
    ctx.fillText('MCSQuiz', W - 64, 96);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 24px "MCSQuiz Arabic", sans-serif';
    ctx.fillText('وسام شرفي معتمد', 64, 96);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(64, 126, W - 128, 1.5);

    // 5. Student Header
    var studentName = 'طالب متميز';
    try {
      var acc = JSON.parse(localStorage.getItem('portal_account_v1') || '{}');
      if (acc.name) studentName = acc.name;
    } catch (e) {}

    ctx.textAlign = 'right';
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '700 32px "MCSQuiz Arabic", sans-serif';
    ctx.fillText(studentName, W - 64, 185);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 22px "MCSQuiz Arabic", sans-serif';
    ctx.fillText('سجل إنجاز استثنائي جديد في المنصة', W - 64, 222);

    // 6. Central Emblem Squircle & Icon
    var emblemX = W / 2;
    var emblemY = 380;
    var emblemSize = 130;

    ctx.beginPath();
    ctx.arc(emblemX, emblemY, 88, 0, Math.PI * 2);
    ctx.fillStyle = tierColor;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1.0;

    drawRoundRect(ctx, emblemX - emblemSize / 2, emblemY - emblemSize / 2, emblemSize, emblemSize, 34);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = tierColor;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    var emblemWrap = document.getElementById('badge-sheet-emblem');
    var svgEl = emblemWrap ? emblemWrap.querySelector('svg') : null;
    if (svgEl) {
      var cloneSvg = svgEl.cloneNode(true);
      cloneSvg.setAttribute('width', '68');
      cloneSvg.setAttribute('height', '68');
      cloneSvg.setAttribute('stroke', tierColor);
      var svgXml = new XMLSerializer().serializeToString(cloneSvg);
      await drawSvgToCanvas(ctx, svgXml, emblemX - 34, emblemY - 34, 68, 68);
    }

    // 7. Rank Badge Tag
    var rankLabel = (tierMeta && tierMeta.label) ? tierMeta.label : 'وسام شرفي';
    ctx.font = '700 22px "MCSQuiz Arabic", sans-serif';
    var rankMetrics = ctx.measureText(rankLabel);
    var tagW = rankMetrics.width + 42;
    var tagH = 40;
    var tagX = emblemX - tagW / 2;
    var tagY = 480;

    drawRoundRect(ctx, tagX, tagY, tagW, tagH, 20);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.strokeStyle = tierColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = tierColor;
    ctx.fillText(rankLabel, emblemX, tagY + 27);

    // 8. Badge Title & Description
    var badgeTitle = evalRes.currentTierTitle || badge.title;
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 46px "MCSQuiz Arabic", sans-serif';
    ctx.fillText(badgeTitle, emblemX, 580);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 25px "MCSQuiz Arabic", sans-serif';
    ctx.fillText(badge.desc, emblemX, 630);

    // 9. Metric / Status Box
    var boxW = 560;
    var boxH = 74;
    var boxX = emblemX - boxW / 2;
    var boxY = 675;

    drawRoundRect(ctx, boxX, boxY, boxW, boxH, 18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = '700 26px "MCSQuiz Arabic", sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(evalRes.statusText, emblemX, boxY + 46);

    // 10. Date earned
    var dateStr = 'أُحرز بتاريخ ' + (new Date((record && record.unlockedAt) || Date.now())).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    ctx.font = '500 21px "MCSQuiz Arabic", sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(dateStr, emblemX, 795);

    // 11. Footer App Link
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(80, 835, W - 160, 1.5);

    ctx.font = '600 21px "MCSQuiz Arabic", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('mcq-portal-jade.vercel.app', emblemX, 882);

    // Output: Share file or Modal Preview
    var blob = await new Promise(function (res) { c.toBlob(res, 'image/png'); });
    if (!blob) {
      if (typeof global.toast === 'function') global.toast('تعذر إنشاء الصورة', 'error');
      return;
    }

    var file = new File([blob], 'mcsquiz-badge-' + badge.id + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'وسام ' + badgeTitle,
          text: 'أحرزت وسام ' + badgeTitle + ' في MCSQuiz!'
        });
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          showBadgeModalPreview(URL.createObjectURL(blob), badgeTitle);
        }
        return;
      }
    }

    showBadgeModalPreview(URL.createObjectURL(blob), badgeTitle);
  }

  function showBadgeModalPreview(url, title) {
    closeBadgeSheet();
    var modal = document.getElementById('share-modal');
    var img = document.getElementById('share-img');
    var titleEl = document.getElementById('share-title');
    if (!modal || !img) return;

    if (titleEl) titleEl.textContent = 'بطاقة وسام ' + title;
    img.src = url;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    var dl = document.getElementById('share-download');
    if (dl) {
      dl.onclick = function () {
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mcsquiz-badge.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
    }

    var tg = document.getElementById('share-telegram');
    if (tg) {
      tg.classList.remove('hidden');
      tg.onclick = function () {
        var appUrl = (window.PORTAL_APP_URL || 'https://mcq-portal-jade.vercel.app/') + '#/account';
        var shareLink = 'https://t.me/share/url?url=' + encodeURIComponent(appUrl) +
          '&text=' + encodeURIComponent('أحرزت وسام ' + title + ' في تطبيق MCSQuiz!');
        try {
          if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
            window.Telegram.WebApp.openTelegramLink(shareLink);
          } else {
            window.open(shareLink, '_blank');
          }
        } catch (e) {
          window.open(shareLink, '_blank');
        }
      };
    }
  }

  async function shareSubjectMasteryCard(sub) {
    if (!sub) return;
    if (typeof global.toast === 'function') global.toast('نجهّز بطاقة وسام الإتقان…', 'info');

    var W = 800;
    var H = 960;
    var c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    var ctx = c.getContext('2d');
    ctx.direction = 'rtl';
    ctx.textBaseline = 'alphabetic';

    // 1. Dark Gradient Background
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#090d16');
    bg.addColorStop(1, '#0e1626');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 2. Radial Glow matching subject color
    var glowColor = sub.color || '#eab308';
    var glow = ctx.createRadialGradient(W / 2, 380, 40, W / 2, 380, 420);
    glow.addColorStop(0, glowColor);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 760);
    ctx.globalAlpha = 1.0;

    // 3. Card Outer Border
    drawRoundRect(ctx, 32, 32, W - 64, H - 64, 32);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 4. Header Bar
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 36px "MCSQuiz Arabic", sans-serif';
    ctx.fillText('MCSQuiz', W - 64, 96);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 24px "MCSQuiz Arabic", sans-serif';
    ctx.fillText('وسام إتقان أكاديمي', 64, 96);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(64, 126, W - 128, 1.5);

    // 5. Student Header
    var studentName = 'طالب متميز';
    try {
      var acc = JSON.parse(localStorage.getItem('portal_account_v1') || '{}');
      if (acc.name) studentName = acc.name;
    } catch (e) {} // audit-ignore: optional student name read

    ctx.textAlign = 'right';
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '700 32px "MCSQuiz Arabic", sans-serif';
    ctx.fillText(studentName, W - 64, 185);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 22px "MCSQuiz Arabic", sans-serif';
    ctx.fillText('أتم بنجاح كافة متطلبات إتقان المادة', W - 64, 222);

    // 6. Central Emblem Squircle & Icon
    var emblemX = W / 2;
    var emblemY = 380;
    var emblemSize = 130;

    ctx.beginPath();
    ctx.arc(emblemX, emblemY, 88, 0, Math.PI * 2);
    ctx.fillStyle = glowColor;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1.0;

    drawRoundRect(ctx, emblemX - emblemSize / 2, emblemY - emblemSize / 2, emblemSize, emblemSize, 34);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    var emblemWrap = document.getElementById('badge-sheet-emblem');
    var svgEl = emblemWrap ? emblemWrap.querySelector('svg') : null;
    if (svgEl) {
      var cloneSvg = svgEl.cloneNode(true);
      cloneSvg.setAttribute('width', '68');
      cloneSvg.setAttribute('height', '68');
      cloneSvg.setAttribute('stroke', glowColor);
      var svgXml = new XMLSerializer().serializeToString(cloneSvg);
      await drawSvgToCanvas(ctx, svgXml, emblemX - 34, emblemY - 34, 68, 68);
    }

    // 7. Rank Badge Tag
    var rankLabel = (sub.tierMeta && sub.tierMeta.label) ? sub.tierMeta.label : 'إتقان أكاديمي';
    ctx.font = '700 22px "MCSQuiz Arabic", sans-serif';
    var rankMetrics = ctx.measureText(rankLabel);
    var tagW = rankMetrics.width + 42;
    var tagH = 40;
    var tagX = emblemX - tagW / 2;
    var tagY = 480;

    drawRoundRect(ctx, tagX, tagY, tagW, tagH, 20);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = glowColor;
    ctx.fillText(rankLabel, emblemX, tagY + 27);

    // 8. Badge Title & Description
    var badgeTitle = 'وسام إتقان ' + sub.title;
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 44px "MCSQuiz Arabic", sans-serif';
    ctx.fillText(badgeTitle, emblemX, 580);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 24px "MCSQuiz Arabic", sans-serif';
    ctx.fillText('إنجاز ' + sub.totalQuizzes + ' كوزاً بمعدل نجاح متميز', emblemX, 630);

    // 9. Metric / Status Box
    var boxW = 560;
    var boxH = 74;
    var boxX = emblemX - boxW / 2;
    var boxY = 675;

    drawRoundRect(ctx, boxX, boxY, boxW, boxH, 18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = '700 26px "MCSQuiz Arabic", sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('إتقان كامل بنسبة دقة ' + sub.avgPct + '%', emblemX, boxY + 46);

    // 10. Date earned
    var dateStr = 'معتمد في سجل إنجازات المنصة';
    ctx.font = '500 21px "MCSQuiz Arabic", sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(dateStr, emblemX, 795);

    // 11. Footer App Link
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(80, 835, W - 160, 1.5);

    ctx.font = '600 21px "MCSQuiz Arabic", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('mcq-portal-jade.vercel.app', emblemX, 882);

    // Output: Share file or Modal Preview
    var blob = await new Promise(function (res) { c.toBlob(res, 'image/png'); });
    if (!blob) {
      if (typeof global.toast === 'function') global.toast('تعذر إنشاء الصورة', 'error');
      return;
    }

    var file = new File([blob], 'mcsquiz-mastery-' + sub.subjectId + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: badgeTitle,
          text: 'أحرزت ' + badgeTitle + ' في MCSQuiz!'
        });
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          showBadgeModalPreview(URL.createObjectURL(blob), badgeTitle);
        }
        return;
      }
    }

    showBadgeModalPreview(URL.createObjectURL(blob), badgeTitle);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initUI() {
    var overlay = document.getElementById('badge-sheet-overlay');
    if (overlay) overlay.addEventListener('click', closeBadgeSheet);

    var closeBtn = document.getElementById('badge-sheet-close');
    if (closeBtn) closeBtn.addEventListener('click', closeBadgeSheet);

    var hudPill = document.getElementById('achievement-hud-pill');
    if (hudPill) {
      hudPill.addEventListener('click', function () {
        hudPill.classList.remove('is-active');
        setTimeout(function () { hudPill.classList.add('hidden'); }, 300);
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeBadgeSheet();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  global.PortalAchievements = {
    CATALOG: CATALOG,
    TIERS: TIERS,
    SUBJECT_MASTERY_THRESHOLD: SUBJECT_MASTERY_THRESHOLD,
    evaluateSubjectMastery: evaluateSubjectMastery,
    getSubjectMeta: getSubjectMeta,
    loadState: loadState,
    saveState: saveState,
    evaluateAll: evaluateAll,
    checkAfterQuiz: checkAfterQuiz,
    showBadgeSheet: showBadgeSheet,
    showSubjectMasterySheet: showSubjectMasterySheet,
    closeBadgeSheet: closeBadgeSheet,
    showCelebrationHUD: showCelebrationHUD,
    shareBadgeCard: shareBadgeCard,
    shareSubjectMasteryCard: shareSubjectMasteryCard
  };
})(window);
