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
      avatar: 'ر',
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
      id: 'zidane',
      name: 'زيدان',
      title: 'المايسترو المتزن',
      avatar: 'ز',
      archetype: 'محلل منهجي',
      description: 'يستبعد الخيارات خطوة بخطوة بهدوء؛ محصن ضد فخاخ النفي والمشتتات السطحية لكنه يتأنى في الحسم.',
      readingRateWpm: 180,
      deliberationMs: [2800, 4400],
      baseAccuracy: 0.87,
      negationVulnerability: 0.05,
      trapAttraction: 0.70,
      tiltTendency: 'cautious',
      clutchFocus: 0.08,
      style: 'تحليل منهجي وتأنٍ متزن'
    },
    {
      id: 'messi',
      name: 'ميسي',
      title: 'الموهبة الخارقة',
      avatar: 'م',
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
      avatar: 'ك',
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
      avatar: 'د',
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
      { delayMs: 0, text: 'يقرأ السؤال...', phase: 'reading' },
      { delayMs: Math.round(readDelayMs), text: 'يفاضل بين خيارين...', phase: 'deliberating' }
    ];

    if (finalTimeMs - readDelayMs > 2400) {
      stages.push({
        delayMs: Math.round(readDelayMs + 1800),
        text: 'يتردد في الحسم...',
        phase: 'hesitating'
      });
    }

    stages.push({
      delayMs: finalTimeMs,
      text: 'قفل الإجابة',
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
      return all[legendId] || { played: 0, wins: 0, losses: 0, ties: 0 };
    } catch (e) {
      return { played: 0, wins: 0, losses: 0, ties: 0 };
    }
  }

  function recordMatchResult(legendId, outcome) {
    try {
      var raw = localStorage.getItem(RIVALRY_KEY);
      var all = raw ? JSON.parse(raw) : {};
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

  global.PortalVSBot = {
    getLegends: getLegends,
    getLegend: getLegend,
    decide: decide,
    getRivalStats: getRivalStats,
    recordMatchResult: recordMatchResult,
    resetRivalStats: resetRivalStats
  };

})(window);
