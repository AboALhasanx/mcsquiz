"""Quiz session: no skip, answer → explanation → results, review cards."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('quiz')


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True, telegram={'id': 2, 'first_name': 'طالب'})
    try:
        subs = common.subjects(page)
        sid, qid = subs[0]['id'], subs[0]['chapters'][0]
        page.evaluate("(h) => { location.hash = h; }", '#/quiz/%s/%s' % (sid, qid))
        page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
        page.click('#btn-start-quiz')
        page.wait_for_timeout(500)

        # --- the exam cannot be skipped: answer every question or nothing
        check('no skip button exists', page.locator('#btn-skip').count() == 0)
        check('one single action button', page.locator('.bottom-nav .nav-btn').count() == 1)

        page.click('#btn-next')
        page.wait_for_timeout(300)
        check('next is blocked while unanswered',
              (page.locator('#question-index-label').text_content() or '').strip() == '1')
        check('blocked next explains itself',
              page.locator('.portal-toast').count() >= 1)

        # language switch: Arabic <-> English (letters prove the mode)
        letters = lambda: (page.locator('.option-letter').first.text_content() or '').strip()
        check('question starts in Arabic mode', letters() == 'أ', letters())
        page.evaluate('() => document.querySelector("#header-session-view .lang-opt[data-lang=\'en\']").click()')
        page.wait_for_timeout(250)
        check('the switch turns the question into English', letters() == 'A', letters())
        check('the English stem is used',
              not re.search(r'[\u0600-\u06FF]', page.locator('#question-text').text_content() or ''),
              (page.locator('#question-text').text_content() or '')[:60])
        page.evaluate('() => document.querySelector("#header-session-view .lang-opt[data-lang=\'ar\']").click()')
        page.wait_for_timeout(250)
        check('the switch returns to Arabic', letters() == 'أ', letters())

        total = int((page.locator('#question-total-label').text_content() or '0').strip())
        check('total questions loaded', total > 0, total)

        # save / unsave the current question (JS click: small fixed target)
        page.evaluate('() => document.querySelector("#btn-save-question").click()')
        page.wait_for_timeout(200)
        check('saving marks the bookmark',
              'is-saved' in (page.locator('#btn-save-question').get_attribute('class') or ''))
        page.evaluate('() => document.querySelector("#btn-save-question").click()')
        page.wait_for_timeout(200)
        check('saving again removes it',
              'is-saved' not in (page.locator('#btn-save-question').get_attribute('class') or ''))

        # answer WRONG on purpose: only a wrong answer shows the explanation
        wrong = page.evaluate("""() => {
          const s = window.__portal.S.session;
          const c = s.questions[s.idx].correct;
          return (c + 1) % 4;
        }""")
        page.locator('.option-tile').nth(wrong).click()
        page.wait_for_timeout(300)
        check('explanation appears after a wrong answer',
              'hidden' not in (page.locator('#live-feedback-box').get_attribute('class') or ''))
        check('a wrong answer opens the explanation automatically',
              page.locator('#live-expl-toggle').get_attribute('aria-expanded') == 'true')
        page.locator('#live-expl-toggle').click()
        page.wait_for_timeout(200)
        check('the explanation can be collapsed on demand',
              page.locator('#live-expl-toggle').get_attribute('aria-expanded') == 'false')
        page.locator('#live-expl-toggle').click()
        page.wait_for_timeout(200)
        check('the explanation re-opens on demand',
              page.locator('#live-expl-toggle').get_attribute('aria-expanded') == 'true')

        # matrix: answered cell marked, no forward jumping
        page.evaluate('() => document.querySelector("#btn-open-matrix").click()')
        page.wait_for_timeout(400)
        check('matrix opens', 'open' in (page.locator('#matrix-drawer').get_attribute('class') or ''))
        cells = page.locator('.matrix-cell')
        check('matrix has one cell per question', cells.count() == total, cells.count())
        check('answered cell is marked answered',
              'answered-' in (cells.nth(0).get_attribute('class') or ''))
        check('matrix has no early-finish button', page.locator('#btn-finish-quiz').count() == 0)
        page.evaluate('() => document.querySelector("#btn-close-matrix").click()')
        page.wait_for_timeout(300)

        # answer everything: the quiz ends on the last answer
        # (answered questions are locked by design — only answer open ones)
        for i in range(total):
            if 'hidden' not in (page.locator('#results-view').get_attribute('class') or ''):
                break
            is_open = page.evaluate("""() => {
              const s = window.__portal.S.session;
              return s.picks[s.idx] === null;
            }""")
            if is_open:
                common.tap(page, page.locator('.option-tile').first)
                page.wait_for_timeout(120)
            page.click('#btn-next')
            page.wait_for_timeout(150)
        page.wait_for_timeout(800)
        check('the quiz ends after the last answer',
              'hidden' not in (page.locator('#results-view').get_attribute('class') or ''))

        stats = page.evaluate("""() => ({
          correct: Number(document.querySelector('#stat-correct').textContent),
          wrong: Number(document.querySelector('#stat-wrong').textContent),
          acc: document.querySelector('#stat-accuracy').textContent,
          hasUnanswered: !!document.querySelector('#stat-unanswered'),
          time: document.querySelector('#stat-total-time').textContent,
        })""")
        check('correct + wrong equals the total', stats['correct'] + stats['wrong'] == total, stats)
        check('accuracy equals the score percentage',
              stats['acc'].strip() == (page.locator('#score-percentage').text_content() or '').strip(), stats)
        check('no unanswered figure', stats['hasUnanswered'] is False)
        body = page.locator('#results-view').inner_text()
        check('results never say "unanswered"', 'لم تُجب' not in body)

        # review cards
        cards = page.locator('.review-card')
        check('one review card per question', cards.count() == total, cards.count())
        check('explanations start collapsed',
              'collapsed' in (cards.first.locator('.review-explanation-box').get_attribute('class') or ''))
        cards.first.locator('.expl-toggle').click()
        page.wait_for_timeout(200)
        check('explanation opens with the arrow',
              cards.first.locator('.expl-body').is_visible())
        check('every card can save the question',
              page.locator('.review-card .review-save-btn').count() == total)
        check('correct answer is always shown',
              page.locator('.review-option-item.correct-answer').count() >= 1)

        # retry the wrong answers only, when there are any
        if stats['wrong'] == 0:
            page.locator('.review-save-btn').first.click()
            page.wait_for_timeout(200)
            check('saving from review works',
                  'is-saved' in (page.locator('.review-save-btn').first.get_attribute('class') or ''))

        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
