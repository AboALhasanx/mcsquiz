/* MCQ Portal — analytics.js
 * Deterministic, client-side result analysis. No network, no AI, no telemetry.
 * Input:  session answers [{questionId, correctIndex, pickedIndex, dwellMs}]
 * Output: summary object consumed by app.js results view.
 */
(function (global) {
  'use strict';

  function gradeBand(pct) {
    if (pct < 60) return { key: 'fail', ar: 'راسب — تحت الحد الوزاري', icon: 'x-circle' };
    if (pct < 70) return { key: 'danger', ar: 'منطقة خطر', icon: 'alert-triangle' };
    if (pct < 75) return { key: 'borderline', ar: 'حدّي — فوق الوزاري بقليل', icon: 'minus-circle' };
    if (pct < 85) return { key: 'safe', ar: 'آمن — ضمن المستهدف', icon: 'check-circle-2' };
    return { key: 'distinction', ar: 'امتياز', icon: 'award' };
  }

  function fmtClock(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  /**
   * Analyze one finished session.
   * @param {Array} questions  deep-copied session questions [{id, correct, ...}]
   * @param {Array} picks      picks[i] = chosen option index or null
   * @param {Array} dwells     dwells[i] = seconds spent (float)
   * @param {number} totalSec  wall-clock session seconds
   */
  function analyze(questions, picks, dwells, totalSec) {
    const n = questions.length;
    let correct = 0;
    const wrongIds = [];
    const rows = [];
    let dwellSum = 0;
    let dwellN = 0;

    for (let i = 0; i < n; i++) {
      const q = questions[i];
      const picked = picks[i];
      const ok = picked !== null && picked !== undefined && picked === q.correct;
      if (ok) correct++;
      else wrongIds.push(q.id);
      const d = Number(dwells[i]) || 0;
      dwellSum += d;
      dwellN++;
      rows.push({ index: i, id: q.id, picked: picked, correct: q.correct, ok: ok, dwell: d });
    }

    const pct = n === 0 ? 0 : Math.round((correct / n) * 1000) / 10;
    const band = gradeBand(pct);
    const avgDwell = dwellN === 0 ? 0 : dwellSum / dwellN;

    return {
      total: n,
      correct: correct,
      wrong: n - correct,
      pct: pct,
      band: band,
      avgDwell: Math.round(avgDwell * 10) / 10,
      totalTime: fmtClock(totalSec),
      totalTimeSec: Math.round(totalSec),
      wrongIds: wrongIds,
      rows: rows,
    };
  }

  /**
   * Build a retry session containing only the wrongly answered questions.
   * Returns null when there is nothing to retry.
   */
  function buildWrongOnly(questions, picks) {
    const subset = [];
    for (let i = 0; i < questions.length; i++) {
      if (picks[i] === null || picks[i] === undefined || picks[i] !== questions[i].correct) {
        subset.push(questions[i]);
      }
    }
    return subset.length ? subset : null;
  }

  global.PortalAnalytics = { analyze: analyze, buildWrongOnly: buildWrongOnly, gradeBand: gradeBand, fmtClock: fmtClock };
})(window);
