"""Adversarial Continuity & Modular Integrity TDD Test Suite.

Tests edge cases, corrupted states, modal shielding, quota limits,
and adversarial inputs across all modular components:
- js/app.js
- js/saved_ui.js
- js/stats_ui.js
- js/league_ui.js
- js/vs_ui.js
- js/vs_bot.js
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('adversarial_continuity')


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True)
    try:
        page.wait_for_function('() => !!window.PortalStatsUI && !!window.PortalSavedUI && !!window.PortalVsUI', timeout=20000)
        check('all modular UIs are loaded and exposed', True)

        # -------------------------------------------------------------
        # 1. Foreign / Invalid JSON Backup Import Guard
        # -------------------------------------------------------------
        import_test = page.evaluate("""() => {
          let lastToast = null;
          const origToast = window.toast;
          window.toast = (msg, type) => { lastToast = { msg, type }; if (origToast) origToast(msg, type); };

          const statsUI = window.PortalStatsUI.create();
          
          // Test A: Empty Object JSON
          const emptyBlob = new Blob(['{}'], { type: 'application/json' });
          statsUI.importData(emptyBlob);
          
          return new Promise(resolve => {
            setTimeout(() => {
              const resEmpty = Object.assign({}, lastToast);
              
              // Test B: Foreign JSON (e.g. package.json)
              const foreignBlob = new Blob(['{"name":"test-package","version":"1.0.0"}'], { type: 'application/json' });
              statsUI.importData(foreignBlob);
              
              setTimeout(() => {
                const resForeign = Object.assign({}, lastToast);
                window.toast = origToast;
                resolve({ resEmpty, resForeign });
              }, 100);
            }, 100);
          });
        }""")

        res_empty = import_test.get('resEmpty') or {}
        res_foreign = import_test.get('resForeign') or {}

        check('empty json import does not claim success',
              'نجاح' not in (res_empty.get('msg') or ''),
              res_empty.get('msg'))
        check('empty json import warns file is invalid or empty',
              'غير صالح' in (res_empty.get('msg') or '') or 'فارغ' in (res_empty.get('msg') or ''),
              res_empty.get('msg'))

        check('foreign package json does not claim success',
              'نجاح' not in (res_foreign.get('msg') or ''),
              res_foreign.get('msg'))
        check('foreign package json warns file is invalid',
              'غير صالح' in (res_foreign.get('msg') or ''),
              res_foreign.get('msg'))

        # -------------------------------------------------------------
        # 2. Corrupt Saved Snapshot Resilience
        # -------------------------------------------------------------
        saved_res = page.evaluate("""() => {
          // Inject corrupt items alongside a healthy one into portal_saved_v1
          const corruptData = {
            "corrupt_null": { "origin": { "subjectId": "01_Cyber_Security", "chapterNo": 1 }, "snapshot": null },
            "corrupt_empty": { "origin": { "subjectId": "01_Cyber_Security", "chapterNo": 1 } },
            "healthy_1": {
              "origin": { "subjectId": "01_Cyber_Security", "chapterNo": 1, "subjectTitle": "الأمن السيبراني" },
              "snapshot": {
                "question": "ما هو التشفير المتناظر؟",
                "options": ["مفتاح مشترك", "مفتاح عام", "توقيع رقمي", "شهادة أمان"],
                "correct": 0,
                "explanation": "يستخدم نفس المفتاح للتشفير وفك التشفير."
              }
            }
          };
          localStorage.setItem('portal_saved_v1', JSON.stringify(corruptData));
          
          let crashed = false;
          try {
            location.hash = '#/saved';
            window.PortalSavedUI.create().renderSaved();
          } catch (e) {
            crashed = e.message;
          }
          
          const renderedCards = document.querySelectorAll('.saved-q-card').length;
          return { crashed, renderedCards };
        }""")

        check('renderSaved does not crash on null/empty snapshots',
              saved_res['crashed'] is False,
              saved_res['crashed'])
        check('healthy item is rendered safely despite corrupt siblings',
              saved_res['renderedCards'] >= 1,
              saved_res['renderedCards'])

        # -------------------------------------------------------------
        # 3. Modal & Drawer Keyboard Bleed Guard
        # -------------------------------------------------------------
        kb_test = page.evaluate("""() => {
          // Setup mock session
          window.__portal.state.session = {
            sub: { subject_id: '01_Cyber_Security', subject_title: 'الأمن السيبراني' },
            ch: { chapter_no: 1, quiz_id: 'Quiz_Ch01' },
            title: 'اختبار الفحص',
            questions: [
              { question: 'Q1', options: ['A', 'B', 'C', 'D'], correct: 0 },
              { question: 'Q2', options: ['A', 'B', 'C', 'D'], correct: 1 }
            ],
            picks: [null, null],
            dwells: [0, 0],
            idx: 0,
            maxIdx: 0,
            pauseStart: null,
            pauseAccum: 0,
            startEpoch: Date.now(),
            qStart: Date.now()
          };
          document.getElementById('quiz-view').classList.remove('hidden');

          // 1. Open Leave Modal
          document.getElementById('leave-modal').classList.remove('hidden');

          // Dispatch keydown '2' (which normally picks option 1)
          document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
          const pickDuringLeaveModal = window.__portal.state.session.picks[0];

          // Dispatch keydown 'Enter' (which normally advances question)
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
          const idxDuringLeaveModal = window.__portal.state.session.idx;

          // Close Leave Modal
          document.getElementById('leave-modal').classList.add('hidden');

          // 2. Open Pause Overlay
          document.getElementById('pause-overlay').classList.remove('hidden');
          document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
          const pickDuringPause = window.__portal.state.session.picks[0];
          document.getElementById('pause-overlay').classList.add('hidden');

          // Clean up mock session
          window.__portal.state.session = null;
          document.getElementById('quiz-view').classList.add('hidden');

          return { pickDuringLeaveModal, idxDuringLeaveModal, pickDuringPause };
        }""")

        check('keystroke 2 is ignored while leave modal is visible',
              kb_test['pickDuringLeaveModal'] is None,
              kb_test['pickDuringLeaveModal'])
        check('keystroke Enter is ignored while leave modal is visible',
              kb_test['idxDuringLeaveModal'] == 0,
              kb_test['idxDuringLeaveModal'])
        check('keystroke 1 is ignored while pause overlay is visible',
              kb_test['pickDuringPause'] is None,
              kb_test['pickDuringPause'])

        # -------------------------------------------------------------
        # 4. Active Recall Mode State Retention
        # -------------------------------------------------------------
        recall_res = page.evaluate("""() => {
          location.hash = '#/saved';
          const savedUI = window.__portal ? window.__portal.getSavedUI() : window.PortalSavedUI.create();
          savedUI.renderSaved();

          // Click toggle button to enable Active Recall
          const modeBtn = document.getElementById('btn-saved-recall-mode');
          if (modeBtn) modeBtn.click();
          
          const isMaskedBefore = document.querySelector('.saved-q-card.is-masked') !== null;
          
          // Check persisted UI settings in localStorage
          const savedData = JSON.parse(localStorage.getItem('portal_ui_v1') || '{}');
          
          return { isMaskedBefore, persisted: savedData.savedHideAnswers };
        }""")

        check('active recall mode masks question solutions', recall_res['isMaskedBefore'])
        check('active recall state is persisted in portal_ui_v1',
              recall_res.get('persisted') is True,
              recall_res.get('persisted'))

        # -------------------------------------------------------------
        # 5. Single Data Point Spline & Empty State in Stats
        # -------------------------------------------------------------
        spline_res = page.evaluate("""() => {
          // Exactly 1 history entry
          const singleHist = [{
            sub: '01_Cyber_Security',
            quizId: 'Quiz_Ch01',
            score: 10,
            total: 10,
            pct: 100,
            secs: 60,
            t: Date.now()
          }];
          localStorage.setItem('portal_history_v1', JSON.stringify(singleHist));
          location.hash = '#/stats';
          const statsUI = window.__portal ? window.__portal.getStatsUI() : window.PortalStatsUI.create();
          statsUI.renderStats();

          const trendSvg = document.querySelector('#stats-trend svg');
          const lineEl = trendSvg ? trendSvg.querySelector('path.trend-line-path') : null;
          const pathD = lineEl ? lineEl.getAttribute('d') : '';
          const hasNaN = pathD && pathD.includes('NaN');
          
          return { hasSvg: !!trendSvg, pathD, hasNaN };
        }""")

        check('single history item generates valid trend SVG', spline_res['hasSvg'])
        check('trend SVG path does not contain NaN coordinates',
              spline_res['hasNaN'] is False,
              spline_res['pathD'])

        # -------------------------------------------------------------
        # 6. Storage QuotaExceeded Shielding
        # -------------------------------------------------------------
        quota_res = page.evaluate("""() => {
          const origSetItem = localStorage.setItem;
          let thrown = false;
          try {
            localStorage.setItem = () => {
              const err = new DOMException('QuotaExceededError');
              err.name = 'QuotaExceededError';
              throw err;
            };

            // These must all safely catch storage errors internally
            window.__portal.touchData();
            window.__portal.persistSaved();
            window.__portal.saveUI();
          } catch (e) {
            thrown = e.message;
          } finally {
            localStorage.setItem = origSetItem;
          }
          return { thrown };
        }""")

        check('QuotaExceededError does not throw unhandled exception',
              quota_res['thrown'] is False,
              quota_res['thrown'])

        # -------------------------------------------------------------
        # 7. VS Mode Rematch Flood Guard
        # -------------------------------------------------------------
        rematch_res = page.evaluate("""() => {
          location.hash = '#/vs';
          const vsUI = window.__portal ? window.__portal.getVsUI() : window.PortalVsUI.create();
          vsUI.renderVs();
          const btnRematch = document.getElementById('vs-btn-rematch');
          if (!btnRematch) return { error: 'no btn-rematch' };

          let clickCount = 0;
          btnRematch.addEventListener('click', () => { clickCount++; });

          // Simulate rapid double click
          btnRematch.click();
          const disabledImmediately = btnRematch.disabled;
          btnRematch.click();

          return { clickCount, disabledImmediately };
        }""")

        check('rematch button is debounced/disabled immediately on click',
              rematch_res.get('disabledImmediately') is True,
              rematch_res)

        # -------------------------------------------------------------
        # 8. BiDi Arrow Transformation & Latin Run Isolation
        # -------------------------------------------------------------
        bidi_res = page.evaluate("""() => {
          const bidi = window.__portal.bidiHtml;
          const multiArrow = bidi('بروتوكول A -> B -> C');
          const extendedLatin = bidi('المعيار (Laprie/Avižienis, 1985–1990) مهم جداً');
          
          return {
            arrowConverted: multiArrow.includes('\u2190') && !multiArrow.includes('->'),
            arrowCount: (multiArrow.match(/\u2190/g) || []).length,
            hasBdi: multiArrow.includes('<bdi dir="ltr">'),
            extendedLatinPreserved: extendedLatin.includes('Avižienis') && extendedLatin.includes('<bdi dir="ltr">')
          };
        }""")

        check('multi-step arrows -> convert to Arabic leftward arrows',
              bidi_res['arrowConverted'] and bidi_res['arrowCount'] == 2,
              bidi_res)
        check('Latin and numbers are wrapped in bdi dir=ltr',
              bidi_res['hasBdi'] and bidi_res['extendedLatinPreserved'],
              bidi_res)

        # -------------------------------------------------------------
        # 9. Immutable Option Pick Lock-in
        # -------------------------------------------------------------
        pick_res = page.evaluate("""() => {
          window.__portal.state.session = {
            sub: { subject_id: '01_Cyber_Security', subject_title: 'الأمن' },
            ch: { chapter_no: 1, quiz_id: 'Q1' },
            title: 'كوز',
            questions: [
              { question: 'Q1', options: ['A', 'B', 'C', 'D'], correct: 0 }
            ],
            picks: [null],
            dwells: [0],
            idx: 0,
            maxIdx: 0,
            pauseStart: null,
            pauseAccum: 0,
            startEpoch: Date.now(),
            qStart: Date.now()
          };
          document.getElementById('quiz-view').classList.remove('hidden');

          // Pick option 0
          window.__portal.pickOption(0);
          const firstPick = window.__portal.state.session.picks[0];

          // Attempt to change pick to option 2 (must be rejected)
          window.__portal.pickOption(2);
          const secondPick = window.__portal.state.session.picks[0];

          // Clean up
          window.__portal.state.session = null;
          document.getElementById('quiz-view').classList.add('hidden');

          return { firstPick, secondPick };
        }""")

        check('first selected option is locked in', pick_res['firstPick'] == 0, pick_res['firstPick'])
        check('subsequent option picks do not mutate original choice', pick_res['secondPick'] == 0, pick_res['secondPick'])

        # -------------------------------------------------------------
        # 10. Corrupt History Records Division-by-Zero Defense
        # -------------------------------------------------------------
        corrupt_hist_res = page.evaluate("""() => {
          const badHistory = [
            { sub: '01_Cyber_Security', quizId: 'Q1', score: 0, total: 0, pct: null, secs: -15, t: Date.now() },
            { sub: '01_Cyber_Security', quizId: 'Q2', score: 5, total: 5, pct: 100, secs: 50, t: Date.now() }
          ];
          localStorage.setItem('portal_history_v1', JSON.stringify(badHistory));
          
          let crash = false;
          try {
            location.hash = '#/stats';
            const statsUI = window.__portal.getStatsUI();
            statsUI.renderStats();
          } catch (e) {
            crash = e.message;
          }

          const heroText = (document.querySelector('.stats-hero-value') || {}).textContent || '';
          const hasNaN = heroText.includes('NaN');

          return { crash, heroText, hasNaN };
        }""")

        check('renderStats survives corrupt history records with total=0 and pct=null',
              corrupt_hist_res['crash'] is False,
              corrupt_hist_res['crash'])
        check('stats hero value displays valid percentage without NaN',
              corrupt_hist_res['hasNaN'] is False,
              corrupt_hist_res['heroText'])

        # -------------------------------------------------------------
        # 11. Escape Key Closes Modal Dialogs
        # -------------------------------------------------------------
        esc_res = page.evaluate("""() => {
          const leaveModal = document.getElementById('leave-modal');
          leaveModal.classList.remove('hidden');
          const wasOpen = !leaveModal.classList.contains('hidden');

          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const isClosed = leaveModal.classList.contains('hidden');

          return { wasOpen, isClosed };
        }""")

        check('Escape key dismisses leave modal',
              esc_res['wasOpen'] and esc_res['isClosed'],
              esc_res)

        # -------------------------------------------------------------
        # 12. Speed Scoring Boundary Clamping & Final Round 0-Point Guard
        # -------------------------------------------------------------
        score_res = page.evaluate("""() => {
          const vs = window.PortalVS;
          return {
            wrongRegular: vs.computeScore(false, 100, 12000, false),
            wrongFinalDouble: vs.computeScore(false, 100, 12000, true),
            negativeTimeClamped: vs.computeScore(true, -500, 12000, false),
            overTimeClamped: vs.computeScore(true, 15000, 12000, false)
          };
        }""")

        check('wrong answer in regular round yields 0', score_res['wrongRegular'] == 0)
        check('wrong answer in final double-points round still yields 0 (no false reward)', score_res['wrongFinalDouble'] == 0)
        check('negative time taken is clamped to at most 1000 points', score_res['negativeTimeClamped'] == 1000)
        check('over-time taken yields base 500 points', score_res['overTimeClamped'] == 500)

        # Check browser errors
        check('no unhandled browser runtime errors', len(errors) == 0, errors)

        return common.report()
    finally:
        browser.close()
        pw.stop()


if __name__ == '__main__':
    run()
