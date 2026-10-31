/**
 * MCSQuiz — Virtual Opponents (Football Legends) Engine
 *
 * Implements human-like cognitive decision dynamics using:
 * - Speed-Accuracy Trade-Off (SAT)
 * - Simulated Annealing with time-based Cooling Schedules
 * - Boltzmann / Softmax utility probability distribution
 * - Reading Latency & Human Hesitation jitter
 * - Dynamic Rubber-banding (DDA) to keep matches tight and thrilling
 */
(function (global) {
  'use strict';

  var LEGENDS = [
    {
      id: 'ronaldinho',
      name: 'رونالدينيو',
      title: 'الساحر المباغت',
      avatar: 'ر',
      initialTemp: 0.85,
      coolingRate: 0.88,
      minTimeMs: 3200,
      maxTimeMs: 5400,
      baseAccuracy: 0.74,
      clutchBonus: 0.02,
      style: 'سرعة خاطفة وحدس عفوي'
    },
    {
      id: 'zidane',
      name: 'زيدان',
      title: 'المايسترو المتزن',
      avatar: 'ز',
      initialTemp: 0.35,
      coolingRate: 0.94,
      minTimeMs: 5800,
      maxTimeMs: 8600,
      baseAccuracy: 0.86,
      clutchBonus: 0.05,
      style: 'تأنٍ وهدوء ودقة تكتيكية'
    },
    {
      id: 'messi',
      name: 'ميسي',
      title: 'الموهبة الخارقة',
      avatar: 'م',
      initialTemp: 0.50,
      coolingRate: 0.91,
      minTimeMs: 3800,
      maxTimeMs: 6200,
      baseAccuracy: 0.83,
      clutchBonus: 0.08,
      style: 'توازن ذكي ودقة استثنائية'
    },
    {
      id: 'cristiano',
      name: 'كريستيانو',
      title: 'الحاسم تحت الضغط',
      avatar: 'ك',
      initialTemp: 0.60,
      coolingRate: 0.89,
      minTimeMs: 4200,
      maxTimeMs: 6500,
      baseAccuracy: 0.78,
      clutchBonus: 0.16,
      style: 'شراسة وحسم في اللحظات الأخيرة'
    },
    {
      id: 'maradona',
      name: 'مارادونا',
      title: 'العبقري المندفع',
      avatar: 'د',
      initialTemp: 0.95,
      coolingRate: 0.82,
      minTimeMs: 2800,
      maxTimeMs: 7800,
      baseAccuracy: 0.79,
      clutchBonus: 0.04,
      style: 'عفوية ومفاجآت غير متوقعة'
    }
  ];

  function getLegends() {
    return LEGENDS.slice();
  }

  function getLegend(id) {
    if (!id) return LEGENDS[0];
    return LEGENDS.find(function (l) { return l.id === id; }) || LEGENDS[0];
  }

  /**
   * Decide the bot's reaction time and choice using Simulated Annealing
   */
  function decide(legend, question, roundIndex, myScore, oppScore, botStreak) {
    legend = legend || LEGENDS[0];
    roundIndex = (typeof roundIndex === 'number') ? roundIndex : 0;
    myScore = (typeof myScore === 'number') ? myScore : 0;
    oppScore = (typeof oppScore === 'number') ? oppScore : 0;
    botStreak = (typeof botStreak === 'number') ? botStreak : 0;

    // 1. Human Reading & Thinking Latency
    var stem = '';
    if (question && question.question) {
      stem = question.question.ar || question.question.en || '';
    }
    var words = stem ? stem.split(/\s+/).filter(Boolean).length : 12;
    var readDelayMs = Math.min(2600, Math.max(1000, words * 45));

    var range = legend.maxTimeMs - legend.minTimeMs;
    var thinkMs = legend.minTimeMs + Math.random() * range;

    if (botStreak > 1) {
      thinkMs -= Math.min(600, botStreak * 180);
    } else if (botStreak < 0) {
      thinkMs += Math.min(800, Math.abs(botStreak) * 250);
    }

    var finalTimeMs = Math.round(readDelayMs + thinkMs);
    finalTimeMs = Math.min(10800, Math.max(2600, finalTimeMs));

    // 2. Simulated Annealing Thermal Dynamics
    var secondsSpent = finalTimeMs / 1000;
    var temp = legend.initialTemp * Math.pow(legend.coolingRate, secondsSpent / 2);

    // Clutch round modifier (Double points round 5)
    if (roundIndex >= 3) {
      temp *= (1.0 - legend.clutchBonus);
    }

    // Dynamic Rubber-banding
    var scoreDiff = oppScore - myScore; // positive: bot is ahead
    if (scoreDiff > 350) {
      temp *= 1.25; // give player a window to catch up
    } else if (scoreDiff < -250) {
      temp *= 0.80; // bot sharpens up to fight back
    }

    if (secondsSpent > 10.0) {
      temp *= 1.35; // panic under clock expiration
    }

    temp = Math.max(0.12, Math.min(2.0, temp));

    // 3. Boltzmann Softmax Choice
    var optsCount = (question && question.options && question.options.length) ? question.options.length : 4;
    var correctIdx = (question && typeof question.answer === 'number' && question.answer >= 0 && question.answer < optsCount)
      ? question.answer
      : 0;

    var utilities = [];
    for (var i = 0; i < optsCount; i++) {
      utilities.push(i === correctIdx ? 2.4 : 0.6);
    }

    var expWeights = utilities.map(function (u) { return Math.exp(u / temp); });
    var sumExp = expWeights.reduce(function (a, b) { return a + b; }, 0);
    var probs = expWeights.map(function (w) { return w / sumExp; });

    var r = Math.random();
    var cumulative = 0;
    var pickIndex = correctIdx;
    for (var j = 0; j < optsCount; j++) {
      cumulative += probs[j];
      if (r <= cumulative) {
        pickIndex = j;
        break;
      }
    }

    return {
      timeMs: finalTimeMs,
      pickIndex: pickIndex,
      isCorrect: (pickIndex === correctIdx),
      temperature: Math.round(temp * 100) / 100
    };
  }

  global.PortalVSBot = {
    getLegends: getLegends,
    getLegend: getLegend,
    decide: decide
  };

})(window);
