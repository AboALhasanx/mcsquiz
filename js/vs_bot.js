/**
 * MCSQuiz — Virtual Human Opponents Engine (Cognitive Architecture)
 *
 * Implements authentic human decision dynamics:
 * 1. Cognitive Funnel & Elimination Heuristic (The 50/50 dilemma)
 * 2. Plausible Distractor Identification (Stem keyword overlap & length similarity)
 * 3. Human Cognitive Biases:
 *    - Negation Blindness ("ما عدا", "ليس", "غير", "NOT", "EXCEPT")
 *    - Length & Detail Bias under doubt
 *    - Buzzer Panic under expiration (< 2.5s remaining)
 * 4. Human Latency Distribution:
 *    - Reading latency based on stem word count + option scanning
 *    - Deliberation & hesitation jitter (3.4s to 9.6s, never instantaneous)
 * 5. Psychological States:
 *    - Hot-hand confidence streak (+1 to +3)
 *    - Tilt & second-guessing after mistakes (-1 to -2)
 *    - Clutch pressure in Round 5 (Double Points)
 * 6. Distinct Legend Cognitive Archetypes:
 *    - Ronaldinho: Intuitive gut reaction, prone to negation traps and hasty leaps
 *    - Zidane: Methodical eliminator, highly immune to traps, deliberate and patient
 *    - Messi: Pattern recognizer, high balanced accuracy, steady composure
 *    - Cristiano: Hyper-competitive, turns fiercely focused when trailing or in round 5
 *    - Maradona: High-volatility emotional gambler, brilliant flashes mixed with tilt blunders
 */
(function (global) {
  'use strict';

  var LEGENDS = [
    {
      id: 'ronaldinho',
      name: 'رونالدينيو',
      title: 'الساحر المباغت',
      shape: 'circle',
      avatar: 'assets/avatars/legend-ronaldinho.png',
      avatarChar: 'ر',
      archetype: 'حدسي عفوي',
      description: 'يعتمد على الانطباع الأول وسرعة البديهة؛ نادر التردد لكنه يقع في فخاخ النفي والمشتتات الخادعة.',
      readingRateWpm: 230,
      deliberationMs: [1400, 2400],
      baseAccuracy: 0.76,
      negationVulnerability: 0.28,
      trapAttraction: 0.85,
      tiltTendency: 'rush',
      clutchFocus: 0.04,
      style: 'حدس عفوي وسرعة بديهة'
    },
    {
      id: 'maldini',
      name: 'مالديني',
      title: 'الجدار المتزن',
      shape: 'circle',
      avatar: 'assets/avatars/legend-maldini.png',
      avatarChar: 'م',
      archetype: 'محلل هادئ',
      description: 'انضباط تكتيكي وهدوء دفاعي يستبعد الخطأ بحكمة؛ محصن ضد فخاخ النفي والمشتتات السطحية لكنه يتأنى في الحسم.',
      readingRateWpm: 185,
      deliberationMs: [2600, 4200],
      baseAccuracy: 0.86,
      negationVulnerability: 0.06,
      trapAttraction: 0.68,
      tiltTendency: 'cautious',
      clutchFocus: 0.12,
      style: 'انضباط وهدوء تكتيكي'
    },
    {
      id: 'messi',
      name: 'ميسي',
      title: 'الموهبة الخارقة',
      shape: 'circle',
      avatar: 'assets/avatars/legend-messi.png',
      avatarChar: 'م',
      archetype: 'ذكي متزن',
      description: 'قراءة شاملة واستيعاب سريع للأنماط؛ يوازن بذكاء بين سرعة الوقت ودقة الاختيار.',
      readingRateWpm: 210,
      deliberationMs: [1800, 2900],
      baseAccuracy: 0.84,
      negationVulnerability: 0.12,
      trapAttraction: 0.75,
      tiltTendency: 'calibrate',
      clutchFocus: 0.10,
      style: 'التقاط ذكي ودقة استثنائية'
    },
    {
      id: 'cristiano',
      name: 'كريستيانو',
      title: 'الحاسم تحت الضغط',
      shape: 'circle',
      avatar: 'assets/avatars/legend-cristiano.png',
      avatarChar: 'ك',
      archetype: 'مقاتل تنافسي',
      description: 'انضباط تكتيكي وتركيز تصاعدي؛ يشتعل حماسه ودقته إلى أقصى حد في الجولة الحاسمة وعند التأخر.',
      readingRateWpm: 200,
      deliberationMs: [2100, 3200],
      baseAccuracy: 0.79,
      negationVulnerability: 0.15,
      trapAttraction: 0.80,
      tiltTendency: 'focus',
      clutchFocus: 0.22,
      style: 'شراسة وحسم في اللحظات الأخيرة'
    },
    {
      id: 'maradona',
      name: 'مارادونا',
      title: 'العبقري المندفع',
      shape: 'circle',
      avatar: 'assets/avatars/legend-maradona.png',
      avatarChar: 'د',
      archetype: 'مجازف متقلب',
      description: 'انفعالي وعفوي؛ يباغتك بلمحات عبقرية في أصعب الأسئلة لكنه يتأثر بالارتباك إذا خسر جولة.',
      readingRateWpm: 220,
      deliberationMs: [1200, 4800],
      baseAccuracy: 0.80,
      negationVulnerability: 0.24,
      trapAttraction: 0.82,
      tiltTendency: 'volatile',
      clutchFocus: 0.06,
      style: 'عفوية ومفاجآت غير متوقعة'
    }
  ];

  var NEGATION_REGEX = /(?:ما\s*عدا|ليس|غير|لا\s+ي|لا\s+ت|باستثناء|خطأ|خاطئ|not|except|never|least|false)/i;
  var RIVALRY_KEY = 'portal_vs_rivals';

  function getLegends() {
    return LEGENDS.slice();
  }

  function getLegend(id) {
    if (!id) return LEGENDS[0];
    return LEGENDS.find(function (l) { return l.id === id; }) || LEGENDS[0];
  }

  function getStemText(q) {
    if (!q) return '';
    var s = q.question || q.stem || '';
    if (typeof s === 'object') return s.ar || s.en || '';
    return String(s);
  }

  function getOptionText(opt) {
    if (!opt) return '';
    if (typeof opt === 'object') return opt.ar || opt.en || '';
    return String(opt);
  }

  /**
   * Identifies the most tempting distractor (the plausible trap)
   * based on keyword overlap with the question stem and length similarity.
   */
  function findPlausibleTrap(q, correctIdx, optsCount) {
    var stem = getStemText(q);
    var stemTokens = stem.toLowerCase().split(/[^\w\u0621-\u064A]+/).filter(function (t) {
      return t && t.length >= 4;
    });

    var correctOpt = (q && q.options && q.options[correctIdx]) ? getOptionText(q.options[correctIdx]) : '';
    var correctLen = correctOpt.length;

    var bestIdx = -1;
    var maxScore = -999999;

    for (var i = 0; i < optsCount; i++) {
      if (i === correctIdx) continue;
      var optText = (q && q.options && q.options[i]) ? getOptionText(q.options[i]) : '';
      var optTokens = optText.toLowerCase().split(/[^\w\u0621-\u064A]+/).filter(Boolean);

      var overlap = 0;
      stemTokens.forEach(function (token) {
        if (optTokens.indexOf(token) >= 0) overlap++;
      });

      var lenDiff = Math.abs(optText.length - correctLen);
      // Humans are drawn to options with similar detail/length and matching terminology
      var score = (overlap * 12) - (lenDiff * 0.15) + (optText.length * 0.05);

      if (score > maxScore) {
        maxScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      for (var j = 0; j < optsCount; j++) {
        if (j !== correctIdx) { bestIdx = j; break; }
      }
    }

    return bestIdx;
  }

  /**
   * Decide the opponent's reaction time, cognitive stages, and choice.
   */
  function decide(legend, question, roundIndex, myScore, oppScore, botStreak) {
    legend = legend || LEGENDS[0];
    roundIndex = (typeof roundIndex === 'number') ? roundIndex : 0;
    myScore = (typeof myScore === 'number') ? myScore : 0;
    oppScore = (typeof oppScore === 'number') ? oppScore : 0;
    botStreak = (typeof botStreak === 'number') ? botStreak : 0;

    var stem = getStemText(question);
    var isNegation = NEGATION_REGEX.test(stem);

    var optsCount = (question && question.options && question.options.length) ? question.options.length : 4;
    var correctIdx = (question && typeof question.answer === 'number' && question.answer >= 0 && question.answer < optsCount)
      ? question.answer
      : 0;

    var trapIdx = findPlausibleTrap(question, correctIdx, optsCount);

    // 1. Human Reading Latency Calculation
    var stemWords = stem ? stem.split(/\s+/).filter(Boolean).length : 14;
    var wpm = legend.readingRateWpm || 200;
    var msPerWord = (60000 / wpm) * 0.65; // High-tempo skimming rate
    var readDelayMs = Math.round(Math.max(1600, Math.min(4200, stemWords * msPerWord)));

    // 2. Human Deliberation & Elimination Time
    var delibMin = legend.deliberationMs[0];
    var delibMax = legend.deliberationMs[1];
    var delibMs = delibMin + Math.random() * (delibMax - delibMin);

    // Streak & psychological momentum adjustments
    if (botStreak > 1) {
      // Hot-hand flow: confident, faster deliberation
      delibMs -= Math.min(600, botStreak * 220);
    } else if (botStreak < 0) {
      var tiltLevel = Math.abs(botStreak);
      if (legend.tiltTendency === 'rush') {
        // Ronaldinho / Maradona: impatience, hasty lock-in
        delibMs -= Math.min(500, tiltLevel * 180);
      } else if (legend.tiltTendency === 'cautious') {
        // Zidane: cautious second-guessing, extra reading
        delibMs += Math.min(900, tiltLevel * 300);
      } else if (legend.tiltTendency === 'focus') {
        // Cristiano: sharpens rhythm
        delibMs -= Math.min(300, tiltLevel * 120);
      }
    }

    // Double points final round pressure (Round 5)
    if (roundIndex >= 4) {
      delibMs += 400; // tense deliberation
    }

    var finalTimeMs = Math.round(readDelayMs + delibMs);
    // Humans never answer in < 3.4 seconds (reading floor) and finish before the 12s clock expires
    finalTimeMs = Math.max(3400, Math.min(10200, finalTimeMs));

    // 3. Dynamic Human Accuracy Calculation
    var currentAccuracy = legend.baseAccuracy;

    // Clutch round bonus
    if (roundIndex >= 3) {
      currentAccuracy += legend.clutchFocus;
    }

    // Dynamic Rubber-banding (Tight competitive match)
    var scoreDiff = oppScore - myScore; // positive: bot is ahead
    if (scoreDiff > 350) {
      currentAccuracy -= 0.08; // human slight relaxation
    } else if (scoreDiff < -250) {
      currentAccuracy += 0.09; // human fighting back to catch up
    }

    // Negation vulnerability
    if (isNegation) {
      currentAccuracy -= legend.negationVulnerability;
    }

    // Hot hand vs tilt
    if (botStreak > 1) {
      currentAccuracy += 0.04;
    } else if (botStreak < 0) {
      if (legend.tiltTendency === 'rush') currentAccuracy -= 0.08;
      else if (legend.tiltTendency === 'cautious') currentAccuracy += 0.03;
      else if (legend.tiltTendency === 'volatile') currentAccuracy += (Math.random() > 0.5 ? 0.08 : -0.12);
    }

    // Panic blunder under clock expiration
    if (finalTimeMs > 9000) {
      currentAccuracy -= 0.14;
    }

    currentAccuracy = Math.max(0.35, Math.min(0.96, currentAccuracy));

    // 4. Decision & Distractor Selection
    var roll = Math.random();
    var isCorrect = (roll < currentAccuracy);
    var pickIndex = correctIdx;
    var decisionReason = '';

    if (isCorrect) {
      pickIndex = correctIdx;
      decisionReason = (finalTimeMs < 4800) ? 'حسم سريع بالبديهة' : 'استبعاد وتحليل منهجي';
    } else {
      // Human error: 80%+ of human errors fall into the plausible trap
      var fallsForTrap = (Math.random() < legend.trapAttraction);
      if (fallsForTrap && trapIdx !== -1 && trapIdx !== correctIdx) {
        pickIndex = trapIdx;
        decisionReason = isNegation ? 'فخ النفي (ما عدا)' : 'فخ المشتت الأقرب';
      } else {
        // Pick one of the other distractors
        var otherDistractors = [];
        for (var d = 0; d < optsCount; d++) {
          if (d !== correctIdx && d !== trapIdx) otherDistractors.push(d);
        }
        if (otherDistractors.length) {
          pickIndex = otherDistractors[Math.floor(Math.random() * otherDistractors.length)];
        } else {
          pickIndex = trapIdx;
        }
        decisionReason = (finalTimeMs > 8800) ? 'داهمه الوقت وتسرع' : 'تردد ومفاضلة خاطئة';
      }
    }

    // 5. Observable Cognitive Stages during the 12-second round
    var stages = [
      { delayMs: 0, text: 'يقرأ', phase: 'reading' },
      { delayMs: Math.round(readDelayMs), text: 'يفاضل', phase: 'deliberating' }
    ];

    if (finalTimeMs - readDelayMs > 2400) {
      stages.push({
        delayMs: Math.round(readDelayMs + 1800),
        text: 'يتردد',
        phase: 'hesitating'
      });
    }

    stages.push({
      delayMs: finalTimeMs,
      text: 'جاهز',
      phase: 'locked'
    });

    return {
      timeMs: finalTimeMs,
      readDelayMs: readDelayMs,
      pickIndex: pickIndex,
      isCorrect: (pickIndex === correctIdx),
      decisionReason: decisionReason,
      stages: stages,
      trapIdx: trapIdx,
      isNegation: isNegation
    };
  }

  /**
   * Head-to-Head Rivalry Statistics
   */
  function getRivalStats(legendId) {
    try {
      var raw = localStorage.getItem(RIVALRY_KEY);
      if (!raw) return { played: 0, wins: 0, losses: 0, ties: 0 };
      var all = JSON.parse(raw);
      if (!all || typeof all !== 'object') return { played: 0, wins: 0, losses: 0, ties: 0 };
      return all[legendId] || { played: 0, wins: 0, losses: 0, ties: 0 };
    } catch (e) {
      return { played: 0, wins: 0, losses: 0, ties: 0 };
    }
  }

  function recordMatchResult(legendId, outcome) {
    try {
      var raw = localStorage.getItem(RIVALRY_KEY);
      var all = raw ? JSON.parse(raw) : {};
      if (!all || typeof all !== 'object') all = {};
      var st = all[legendId] || { played: 0, wins: 0, losses: 0, ties: 0 };
      st.played++;
      if (outcome === 'win') st.wins++;
      else if (outcome === 'loss') st.losses++;
      else st.ties++;
      all[legendId] = st;
      localStorage.setItem(RIVALRY_KEY, JSON.stringify(all));
      return st;
    } catch (e) {
      return null;
    }
  }

  function resetRivalStats() {
    try {
      localStorage.removeItem(RIVALRY_KEY);
    } catch (e) {}
  }

  function pseudoHash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  /**
   * Generates dynamic, realistic league standing rows for the 5 football legends.
   * Features:
   *  1. Weekly Form & Role Rotation (seeded by weekId) so podium leaders rotate across weeks.
   *  2. Discrete Human Study Sessions (4 daily study windows) instead of a flat linear drip.
   *  3. Competitive Pace / Rubber-banding against top human / student score.
   *  4. 1v1 Rivalry duel bonuses & subject-specific focus shifts.
   */
  function getLeagueRows(opts) {
    opts = opts || {};
    var isPrev = !!opts.isPrev;
    var isAllTime = !!opts.isAllTime;
    var subjects = opts.subjects && opts.subjects.length ? opts.subjects : [
      { subject_id: '01_Cyber_Security', subject_title: 'الأمن السيبراني' },
      { subject_id: '02_English_Language', subject_title: 'اللغة الإنجليزية' },
      { subject_id: '03_Data_Mining', subject_title: 'تنقيب البيانات' },
      { subject_id: '04_Advanced_Software_Eng', subject_title: 'هندسة البرمجيات' },
      { subject_id: '05_Soft_Computing', subject_title: 'الحوسبة اللينة' },
      { subject_id: '06_Artificial_Intelligence', subject_title: 'الذكاء الاصطناعي' }
    ];

    var weekId = opts.weekId || (window.PortalLeague && window.PortalLeague.weekStart ? window.PortalLeague.weekStart(Date.now()) : '2026-10-26');
    var now = typeof opts.nowMs === 'number' && !isNaN(opts.nowMs) ? opts.nowMs : Date.now();
    var monday = new Date(weekId + 'T00:00:00').getTime();
    if (isNaN(monday)) monday = now - (3.5 * 86400000);
    var elapsedMs = isPrev ? (7 * 86400000) : Math.max(3600000, Math.min(7 * 86400000, Math.max(0, now - monday)));
    var elapsedHours = Math.max(1, elapsedMs / 3600000);

    var baseSubjectWeights = {
      cristiano: { '01_Cyber_Security': 0.18, '02_English_Language': 0.16, '03_Data_Mining': 0.16, '04_Advanced_Software_Eng': 0.18, '05_Soft_Computing': 0.15, '06_Artificial_Intelligence': 0.17 },
      messi:     { '01_Cyber_Security': 0.10, '02_English_Language': 0.10, '03_Data_Mining': 0.28, '04_Advanced_Software_Eng': 0.14, '05_Soft_Computing': 0.18, '06_Artificial_Intelligence': 0.20 },
      maldini:   { '01_Cyber_Security': 0.28, '02_English_Language': 0.16, '03_Data_Mining': 0.12, '04_Advanced_Software_Eng': 0.24, '05_Soft_Computing': 0.08, '06_Artificial_Intelligence': 0.12 },
      ronaldinho:{ '01_Cyber_Security': 0.12, '02_English_Language': 0.26, '03_Data_Mining': 0.14, '04_Advanced_Software_Eng': 0.20, '05_Soft_Computing': 0.16, '06_Artificial_Intelligence': 0.12 },
      maradona:  { '01_Cyber_Security': 0.16, '02_English_Language': 0.10, '03_Data_Mining': 0.24, '04_Advanced_Software_Eng': 0.12, '05_Soft_Computing': 0.14, '06_Artificial_Intelligence': 0.24 }
    };

    var baseRatings = {
      cristiano: 224,
      messi:     218,
      maldini:   206,
      ronaldinho:192,
      maradona:  184
    };

    // 1. Weekly Form Rotation: permute form tiers deterministically from weekId
    // so different legends peak as #1/#2 in different weeks.
    var formTiers = [
      { mult: 1.24, tag: 'في قمة مستواه هذا الأسبوع' },
      { mult: 1.12, tag: 'سلسلة انتصارات متتالية' },
      { mult: 1.02, tag: 'وتيرة مذاكرة ثابتة' },
      { mult: 0.92, tag: 'يركّز على المراجعة الدقيقة' },
      { mult: 0.84, tag: 'أسبوع هادئ نسبياً' }
    ];
    var orderIdx = [0, 1, 2, 3, 4];
    for (var s = 4; s > 0; s--) {
      var swapWith = pseudoHash(weekId + '_form_slot_' + s) % (s + 1);
      var tmp = orderIdx[s];
      orderIdx[s] = orderIdx[swapWith];
      orderIdx[swapWith] = tmp;
    }

    // Check human competition level for adaptive pacing (rubber-banding)
    var humanTopXp = Number(opts.humanTopXp) || 0;
    var myXp = Number(opts.myXp) || 0;
    var refHumanXp = Math.max(humanTopXp, myXp);

    // 2. Simulate discrete study sessions across the week (4 study windows per day: 09:00, 14:00, 19:00, 22:30)
    var studyWindows = [9.0, 14.0, 19.0, 22.5];

    var rows = [];
    var rivalry = {};
    try {
      rivalry = JSON.parse(localStorage.getItem(RIVALRY_KEY) || '{}');
      if (!rivalry || typeof rivalry !== 'object') rivalry = {};
    } catch (e) { rivalry = {}; }

    LEGENDS.forEach(function (leg, legIdx) {
      var key = leg.id;
      var hash = pseudoHash(weekId + '_' + key);
      var form = formTiers[orderIdx[legIdx] || 0];
      var jitter = (hash % 23) - 11;
      var weeklyTarget = Math.round((baseRatings[key] || 200) * form.mult) + jitter;

      var riv = rivalry[key] || { played: 0, wins: 0, losses: 0 };
      var duelBonus = (riv.played * 6) + (riv.wins * 4);

      var xp = 0;
      var lastSessionAgoSec = (hash % 3200) + 300;

      if (isAllTime) {
        // Cumulative all-time: sum across 5 virtual weeks + current progress
        var allTimeSum = 0;
        for (var w = 1; w <= 5; w++) {
          var wh = pseudoHash('alltime_w' + w + '_' + key);
          var wf = 0.88 + ((wh % 35) / 100);
          allTimeSum += Math.round((baseRatings[key] || 200) * wf);
        }
        xp = allTimeSum + duelBonus + Math.round(weeklyTarget * (elapsedHours / 168));
      } else if (isPrev) {
        xp = weeklyTarget + duelBonus;
        lastSessionAgoSec = 3600 + (hash % 7200);
      } else {
        // Discrete session accumulation up to `elapsedHours`
        var sessionWeights = [];
        var totalWeight = 0;
        for (var day = 0; day < 7; day++) {
          for (var win = 0; win < studyWindows.length; win++) {
            var sh = pseudoHash(weekId + '_' + key + '_d' + day + '_w' + win);
            // Legends take ~25% of windows off and study harder in others
            var active = (sh % 100) >= 24;
            var wVal = active ? (0.7 + ((sh % 90) / 100)) : 0.08;
            // Cristiano & Maldini push harder on weekends (days 4, 5, 6)
            if ((key === 'cristiano' || key === 'maldini') && day >= 4) wVal *= 1.18;
            var jitterHr = ((sh % 70) - 35) / 60; // +-35 min around window
            var sessionHour = (day * 24) + studyWindows[win] + jitterHr;
            sessionWeights.push({ hour: Math.max(0.5, sessionHour), weight: wVal });
            totalWeight += wVal;
          }
        }

        // Starter baseline on Monday morning so nobody sits at 0
        var starterXp = 14 + (hash % 11);
        var remainingTarget = Math.max(40, weeklyTarget - starterXp);
        var earnedSoFar = starterXp;
        var latestCompletedHr = 0.2;

        for (var i = 0; i < sessionWeights.length; i++) {
          var sw = sessionWeights[i];
          var sessPoints = remainingTarget * (sw.weight / totalWeight);
          if (elapsedHours >= sw.hour) {
            earnedSoFar += sessPoints;
            if (sw.hour > latestCompletedHr) latestCompletedHr = sw.hour;
          } else if (elapsedHours >= sw.hour - 0.75) {
            // Currently in the middle of a live study session!
            var part = (elapsedHours - (sw.hour - 0.75)) / 0.75;
            earnedSoFar += sessPoints * Math.max(0, Math.min(1, part));
            latestCompletedHr = elapsedHours;
          }
        }

        xp = Math.round(earnedSoFar) + duelBonus;
        lastSessionAgoSec = Math.max(60, Math.round((elapsedHours - latestCompletedHr) * 3600));
      }

      // 3. Competitive Rubber-Banding: if a human student surges ahead, the top in-form
      // legends step up their study pace so the race for #1 / Podium stays thrilling.
      if (!isPrev && !isAllTime && refHumanXp > xp && orderIdx[legIdx] <= 1) {
        var gap = refHumanXp - xp;
        var catchupRatio = orderIdx[legIdx] === 0 ? 0.82 : 0.68;
        var maxBoost = Math.round(weeklyTarget * 0.65);
        var boost = Math.min(maxBoost, Math.round(gap * catchupRatio));
        var closeOffset = ((hash % 9) - 4); // -4 to +4 around the student
        xp = Math.min(refHumanXp + closeOffset, xp + boost);
      }

      xp = Math.max(14, xp);

      // Dynamic accuracy variance per week (+-2%)
      var accShift = ((hash % 5) - 2) * 0.01;
      var effAcc = Math.max(0.70, Math.min(0.95, leg.baseAccuracy + accShift));
      var answered = Math.max(xp + 1, Math.round(xp / effAcc));

      // Rotate subject focus slightly each week so per-subject leaderboards also shift
      var baseW = baseSubjectWeights[key] || {};
      var perSub = {};
      var subRaw = [];
      var subSum = 0;

      subjects.forEach(function (sub, sIdx) {
        var bw = baseW[sub.subject_id] || (1.0 / subjects.length);
        var sh = pseudoHash(weekId + '_' + key + '_sub_' + sIdx);
        var factor = 0.75 + ((sh % 55) / 100); // 0.75x to 1.30x weekly subject focus
        var w = bw * factor;
        subRaw.push({ sub: sub, w: w });
        subSum += w;
      });

      var allocatedXp = 0;
      subRaw.forEach(function (item, idx) {
        var sub = item.sub;
        var subXp = (idx === subRaw.length - 1)
          ? Math.max(1, xp - allocatedXp)
          : Math.max(1, Math.round(xp * (item.w / (subSum || 1))));
        allocatedXp += subXp;
        var subAns = Math.max(subXp + 1, Math.round(subXp / effAcc));
        perSub[sub.subject_id] = {
          title: sub.subject_title || sub.subject_id,
          xp: subXp,
          n: subAns
        };
      });

      rows.push({
        rank: 0,
        user_id: 'legend:' + leg.id,
        legend_id: leg.id,
        isBot: true,
        name: leg.name,
        username: leg.id,
        avatar: leg.avatar,
        avatarChar: leg.avatarChar,
        shape: leg.shape,
        title: leg.title + (isAllTime ? '' : (' · ' + form.tag)),
        formTag: form.tag,
        xp: xp,
        answered: answered,
        per_subject: perSub,
        updated_at: (function () {
          try {
            var d = new Date(now - (lastSessionAgoSec * 1000));
            return !isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
          } catch (e) {
            return new Date().toISOString();
          }
        })()
      });
    });

    return rows;
  }

  global.PortalVSBot = {
    getLegends: getLegends,
    getLegend: getLegend,
    decide: decide,
    getRivalStats: getRivalStats,
    recordMatchResult: recordMatchResult,
    resetRivalStats: resetRivalStats,
    getLeagueRows: getLeagueRows
  };

})(window);
