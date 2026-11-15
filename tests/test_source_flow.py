"""ASE source questions: ordinary presentation, original order and offline snapshots.

Uses an intercepted local fixture; no database writes and no production content.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import check, suite

suite('source_flow')


def fixture_bank(qid, kind='source'):
    bank = {
        'schema_version': 3, 'quiz_id': qid,
        'subject_id': '04_Advanced_Software_Eng', 'subject_title': 'هندسة البرمجيات',
        'topic': {'ar': 'أسئلة المصدر' if kind == 'source' else 'تدريب الفهم', 'en': 'Source MCQs'},
        'bank_kind': kind, 'questions': [],
    }
    for i in range(3):
        q = {
            'id': 'q%d' % (i + 1), 'concept_id': '%s_%d' % (qid, i),
            'stem': {'en': 'Question %d?' % (i + 1), 'ar': 'السؤال %d؟' % (i + 1)},
            'options': [{'en': en, 'ar': ar} for en, ar in zip(
                ['First option', 'Second option', 'Both A and B', 'None of the above'],
                ['الخيار الأول', 'الخيار الثاني', 'كلا الخيارين A وB', 'لا شيء مما سبق'])],
            'answer': 2,
            'explanation': {'en': 'The first two statements apply.', 'ar': 'تنطبق العبارتان الأولى والثانية.'},
        }
        if kind == 'source':
            q['source'] = {'id': '1.%d' % (i + 1), 'reference': 'Fixture source <not markup>',
                           'key_status': 'confirmed',
                           'note': {'en': 'Source correction kept separate.', 'ar': 'تصحيح المصدر موثق منفصلاً.'}}
            if i == 2:
                q['answer'] = None
                q['source']['key_status'] = 'disputed'
                q['source']['note'] = {'en': 'No unique source key is verified.', 'ar': 'لا توجد إجابة وحيدة متحققة.'}
        bank['questions'].append(q)
    return bank


def run():
    source_id = 'Quiz_Ch01_S01_Source_MCQs'
    practice_id = 'Quiz_Ch01_T01_Practice'
    eight_id = 'Quiz_Ch08_S01_Source_MCQs'
    banks = {source_id: fixture_bank(source_id), practice_id: fixture_bank(practice_id, 'practice'),
             eight_id: fixture_bank(eight_id)}
    # Deliberately omit kind from the manifest, like the existing live RPC.
    manifest = {'version': 1, 'subjects': [{'subject_id': '04_Advanced_Software_Eng',
        'subject_title': 'هندسة البرمجيات', 'chapters': [
            {'quiz_id': qid, 'chapter_no': 8 if qid == eight_id else 1,
             'bank': 'banks/%s.json' % qid, 'count': 3, 'version': 1}
            for qid in banks]}]}
    pw = common.launch()
    launch_kw = {'executable_path': common.EXE} if os.path.exists(common.EXE) else {}
    browser = pw.chromium.launch(headless=True, **launch_kw)
    errors = []
    try:
        ctx = browser.new_context(viewport={'width': 402, 'height': 874}, service_workers='block')
        ctx.add_init_script("localStorage.setItem('portal_tour_done','1'); localStorage.setItem('portal_quiz_hint','1');")
        ctx.route('**/rest/v1/rpc/**', lambda r: r.abort())
        ctx.route('**/data/index.json*', lambda r: r.fulfill(json=manifest))
        ctx.route('**/data/banks/*', lambda r: r.fulfill(json=banks[r.request.url.split('/')[-1].split('?')[0][:-5]]))
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(common.APP, wait_until='domcontentloaded')
        page.wait_for_function('() => window.__portal && Object.keys(window.__portal.S.banks).length === 3')
        check('catalog has no source/practice filter', page.locator('#bank-kind-filter-bar').count() == 0)
        check('source and practice banks share the normal chapter list',
              page.locator('#catalog-cards-container .sketch-row').count() == 2)
        check('bank title may retain its wording, without a batch label',
              'أسئلة المصدر' in page.locator('#catalog-cards-container').inner_text() and
              'دفعة:' not in page.locator('#catalog-cards-container').inner_text())
        artifact_dir = Path(os.environ.get('PORTAL_SOURCE_ARTIFACTS', str(Path(tempfile.gettempdir()) / 'opencode')))
        artifact_dir.mkdir(parents=True, exist_ok=True)
        page.evaluate('document.fonts.ready')
        page.screenshot(path=str(artifact_dir / 'ase-source-catalog-dark402.png'))
        page.get_by_role('button', name='جابتر 8', exact=True).click()
        check('source-only chapter remains selectable without a track filter',
              page.evaluate('window.__portal.S.chapterFilter') == 8 and
              page.locator('#catalog-cards-container .sketch-row').count() == 1)
        page.get_by_role('button', name='جابتر 1', exact=True).click()
        check('practice bank remains listed beside source bank',
              page.locator('#catalog-cards-container a[href*="%s"]' % practice_id).count() == 2)
        page.locator('#catalog-cards-container a[href*="%s"]' % source_id).first.click()
        page.wait_for_selector('#btn-start-quiz:visible')
        check('preflight contains no provenance notice', page.locator('#start-note').inner_text().strip() == '')
        page.locator('#btn-start-quiz').click()
        page.wait_for_selector('#question-text:visible')
        original = [o['en'] for o in banks[source_id]['questions'][0]['options']]
        original_ar = [o['ar'] for o in banks[source_id]['questions'][0]['options']]
        check('source question follows the selected Arabic language',
              page.locator('#question-text').inner_text() == 'السؤال 1؟')
        check('source options retain their order in Arabic',
              page.locator('.option-content').all_text_contents() == original_ar)
        check('source key keeps its original position', page.evaluate('window.__portal.S.session.questions[0].correct') == 2)
        page.screenshot(path=str(artifact_dir / 'ase-source-quiz-dark402.png'))
        page.set_viewport_size({'width': 533, 'height': 874})
        page.evaluate('document.documentElement.setAttribute("data-theme", "light")')
        page.screenshot(path=str(artifact_dir / 'ase-source-quiz-light533.png'))
        page.set_viewport_size({'width': 402, 'height': 874})
        page.evaluate('document.documentElement.setAttribute("data-theme", "dark")')
        check('question card has no provenance element or text',
              page.locator('#question-source').count() == 0 and
              '<not markup>' not in page.locator('#question-card').inner_text() and
              'المصدر' not in page.locator('#question-card').inner_text())
        check('correction does not reveal itself before answering', not page.locator('#live-feedback-box').is_visible())
        page.locator('.option-tile').nth(2).click()
        check('explanation appears without injected source notes',
              'تنطبق العبارتان الأولى والثانية.' in page.locator('#live-explanation-text').inner_text() and
              page.locator('.source-note').count() == 0 and
              'تصحيح المصدر' not in page.locator('#live-explanation-text').inner_text())
        check('source question does not override the selected language',
              page.evaluate('window.__portal.S.lang') == 'ar')
        page.locator('#lang-toggle-session').click()
        check('language toggle exposes the English translation',
              page.locator('#question-text').inner_text() == 'Question 1?')
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function('() => window.__portal && window.__portal.S.session && window.__portal.S.session.started')
        check('reloading a source session restores the selected language',
              page.evaluate('window.__portal.S.lang') == 'en' and
              page.locator('#question-text').inner_text() == 'Question 1?')
        page.locator('#lang-toggle-session').click()
        check('Arabic translation remains available', page.locator('#question-text').inner_text() == 'السؤال 1؟')
        check('source metadata remains hidden after language switching',
              'تصحيح المصدر' not in page.locator('#question-card').inner_text() and
              'Fixture source' not in page.locator('#question-card').inner_text())
        page.locator('#btn-save-question').click()
        check('saved snapshot retains source identity', page.evaluate('Object.values(window.__portal.S.saved)[0].snapshot.bank_kind') == 'source')
        # Session restore must not normalize away internal order metadata.
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function('() => window.__portal && window.__portal.S.session && window.__portal.S.session.started')
        check('reload preserves source order and answer', page.evaluate('window.__portal.S.session.questions[0].options[2].en') == 'Both A and B')
        page.evaluate("""() => {
           const s = window.__portal.S;
           const item = Object.values(s.saved)[0];
           Math.random = () => 0;
           window.__portal.startReviewPractice([item.snapshot], 'مراجعة سؤال', 'review');
         }""")
        check('review does not shuffle positional source options', page.evaluate('window.__portal.S.session.questions[0].options[2].en') == 'Both A and B')
        grade = page.evaluate("""() => {
          const s = window.__portal.S;
          const qs = s.banks['Quiz_Ch01_S01_Source_MCQs'].questions;
          const res = window.PortalAnalytics.analyze(qs, [2, 2, 0], [1, 1, 1], 3);
          const retry = window.PortalAnalytics.buildWrongOnly(qs, [2, 0, 0]);
          return {total:res.total, correct:res.correct, wrong:res.wrong, retry:retry.map(q => q.id)};
        }""")
        check('unresolved source keys are excluded from scores', grade == {'total': 2, 'correct': 2, 'wrong': 0, 'retry': ['q2']}, grade)
        page.evaluate("""() => {
          const s = window.__portal.S;
          const q = JSON.parse(JSON.stringify(s.banks['Quiz_Ch01_S01_Source_MCQs'].questions[2]));
          q.origin = {subjectId:'04_Advanced_Software_Eng', quizId:'Quiz_Ch01_S01_Source_MCQs', chapterNo:1};
          window.__beforeUnscoredReview = JSON.stringify(window.PortalReview.loadStore());
          window.__portal.startReviewPractice([q], 'مراجعة سؤال ملتبس', 'review');
        }""")
        page.locator('#btn-start-quiz').click()
        check('ungraded question shows no provenance label',
              page.locator('#question-source').count() == 0 and
              'لا يُحتسب ضمن النتيجة' not in page.locator('#question-card').inner_text())
        page.locator('.option-tile').first.click()
        check('ungraded choice is neutral, not wrong',
              page.locator('.option-tile.ungraded-choice').count() == 1 and
              page.locator('.option-tile.user-wrong, .option-tile.correct-answer').count() == 0)
        check('ungraded choice is visibly selected without grading colors',
              page.locator('.option-tile.ungraded-choice.selected[aria-checked="true"]').count() == 1 and
              page.locator('.option-tile.ungraded-choice').evaluate("""el => {
                const selected = getComputedStyle(el);
                const peer = getComputedStyle(el.parentElement.querySelector('.option-tile:not(.ungraded-choice)'));
                return selected.borderColor !== peer.borderColor && selected.boxShadow !== peer.boxShadow;
              }""") and
              page.locator('.option-tile.user-wrong, .option-tile.correct-answer').count() == 0)
        check('ungraded selection does not affect review telemetry', page.evaluate('JSON.stringify(window.PortalReview.loadStore()) === window.__beforeUnscoredReview'))
        page.locator('#btn-next').click()
        check('ungraded-only results are not a failed exam', page.locator('#score-badge-text').inner_text() == 'مراجعة بلا تقييم' and page.locator('#score-percentage').inner_text() == '—')
        check('ungraded review preserves every choice', page.locator('.review-card .review-option-item').count() == 4)
        # Finish a scored source session with one wrong graded answer and one
        # ungraded disputed pick: the wrong counter must ignore the latter.
        page.evaluate("""(id) => {
           const s = window.__portal.S;
           window.__portal.startReviewPractice(s.banks[id].questions, 'مراجعة النتيجة', 'custom');
         }""", source_id)
        page.locator('#btn-start-quiz').click()
        page.locator('.option-tile').nth(2).click()
        page.locator('#btn-next').click()
        page.locator('.option-tile').nth(0).click()
        page.locator('#btn-next').click()
        page.locator('.option-tile').nth(0).click()
        page.locator('#btn-next').click()
        page.wait_for_timeout(500)
        check('ungraded pick does not inflate the wrong counter', page.locator('#filter-count-wrong').inner_text() == '1', page.locator('#filter-count-wrong').inner_text())
        check('ungraded pick is marked neutral, not wrong',
               page.locator('.review-option-item.ungraded-choice').count() == 1 and
               page.locator('.review-card[data-ok="ungraded"]').count() == 1)
        page.evaluate("() => { location.hash = '#/'; }")
        page.wait_for_timeout(300)
        check('leaving the quiz keeps the selected language', page.evaluate('window.__portal.S.lang') == 'ar', page.evaluate('window.__portal.S.lang'))
        # A normal practice bank still follows the existing shuffle rule.
        page.evaluate("() => { Math.random = () => 0; location.hash = '#/quiz/04_Advanced_Software_Eng/%s'; }" % practice_id)
        page.wait_for_function('(id) => window.__portal.S.session && window.__portal.S.session.ch.quiz_id === id', arg=practice_id)
        check('practice options still shuffle', page.evaluate('window.__portal.S.session.questions[0].options.map(o => o.en)') != original)
        check('practice answer remains mapped to its correct text', page.evaluate('window.__portal.S.session.questions[0].options[window.__portal.S.session.questions[0].correct].en') == 'Both A and B')
        for width, theme in [(402, 'dark'), (533, 'light')]:
            page.set_viewport_size({'width': width, 'height': 874})
            page.evaluate('(t) => document.documentElement.setAttribute("data-theme", t)', theme)
            check('no horizontal overflow at %d in %s' % (width, theme), page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        check('no source-flow runtime errors', not errors, errors[:2])
        browser.close()
    finally:
        if browser.is_connected():
            browser.close()
        pw.stop()
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
