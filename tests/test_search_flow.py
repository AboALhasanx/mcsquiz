"""MCQ Portal - tests/test_search_flow.py
Verifies Phase 2: In-portal search end-to-end integration flow.
Checks route navigation, typing, debounced search, mark highlighting, subject filtering,
expandable preview details, zero-state, and launching practice sessions.
"""
import sys
import os
import time

sys.path.insert(0, os.path.dirname(__file__))
import common


def test_search_flow():
    pw = common.launch()
    try:
        b, page, errs = common.new_page(pw, tour_done=True)

        # -------------------------------------------------------------
        # 1. Navigation to #/search
        # -------------------------------------------------------------
        page.evaluate("() => { location.hash = '#/search'; }")
        page.wait_for_selector('#search-view:not(.hidden)', timeout=5000)
        common.check('search route reveals #search-view', page.is_visible('#search-view'))
        common.check('catalog deck is hidden', not page.is_visible('#deck-catalog'))
        common.check('initial state is visible on empty input', page.is_visible('#search-initial-state'))
        common.check('empty state is hidden initially', not page.is_visible('#search-empty-state'))
        common.check('clear button is hidden initially', not page.is_visible('#search-clear-btn'))

        # Practice button should be disabled initially
        btn_practice = page.locator('#btn-start-search-practice')
        common.check('practice button is disabled on empty search', btn_practice.is_disabled())

        # -------------------------------------------------------------
        # 2. Typing a search query and verifying debounced results
        # -------------------------------------------------------------
        input_el = page.locator('#search-query-input')
        input_el.fill('تشفير')
        page.wait_for_timeout(300)  # Wait for 120ms debounce + render

        cards = page.locator('.search-result-card')
        count = cards.count()
        common.check('searching "تشفير" yields matching result cards', count > 0)
        common.check('initial state is hidden when results exist', not page.is_visible('#search-initial-state'))
        common.check('clear button is visible when input has text', page.is_visible('#search-clear-btn'))
        common.check('practice button is enabled when results exist', not btn_practice.is_disabled())

        # Check highlight mark
        marks = page.locator('.search-mark')
        common.check('keyword "تشفير" is highlighted with <mark class="search-mark">', marks.count() > 0)

        # Check count label
        count_label = page.locator('#search-count-label').inner_text()
        common.check('count label displays number of matching questions', str(count) in count_label)

        # -------------------------------------------------------------
        # 3. Card Details: options and explanation preview
        # -------------------------------------------------------------
        first_card = cards.first
        details = first_card.locator('.search-card-details')
        summary = first_card.locator('.search-details-toggle')
        common.check('details preview is initially collapsed', not details.evaluate('(el) => el.open'))

        summary.click()
        page.wait_for_timeout(100)
        common.check('details preview opens on summary click', details.evaluate('(el) => el.open'))

        correct_opt = first_card.locator('.search-card-opt.is-correct')
        common.check('correct option is flagged with .is-correct', correct_opt.count() > 0)

        # -------------------------------------------------------------
        # 4. Subject rail filtering
        # -------------------------------------------------------------
        chips = page.locator('#search-subject-bar .filter-chip')
        common.check('subject bar renders filter chips', chips.count() > 1)

        # Click the second chip (first specific subject)
        second_chip = chips.nth(1)
        sub_id = second_chip.get_attribute('data-sub')
        second_chip.click(force=True)
        page.wait_for_timeout(200)

        filtered_cards = page.locator('.search-result-card')
        filtered_count = filtered_cards.count()
        common.check('subject chip click updates result set', filtered_count <= count)

        # Reset to all subjects
        all_chip = chips.first
        all_chip.click(force=True)
        page.wait_for_timeout(200)
        common.check('clicking "جميع المواد" restores full results', page.locator('.search-result-card').count() == count)

        # -------------------------------------------------------------
        # 5. Launch custom practice session from search results
        # -------------------------------------------------------------
        btn_practice.click(force=True)
        page.wait_for_timeout(400)

        common.check('practice button navigates to #/practice', page.evaluate("() => location.hash === '#/practice'"))
        common.check('quiz session view is active', page.is_visible('#quiz-view') or page.is_visible('#quiz-start-view'))

        # Check session kind
        ses_meta = page.evaluate("""() => {
            const p = window.__portal;
            const S = p && p.S;
            return {
                hasSession: !!(S && S.session),
                replayType: S && S.session && S.session.replay && S.session.replay.type,
                qCount: S && S.session && S.session.questions && S.session.questions.length
            };
        }""")
        common.check('launched session has kind=custom', ses_meta['replayType'] == 'custom')
        common.check('session has questions loaded from search pool', ses_meta['qCount'] > 0)

        # Answering in quiz view
        if page.is_visible('#quiz-start-view'):
            page.locator('#btn-start-quiz').click(force=True)
            page.wait_for_timeout(300)

        common.check('question is presented in quiz view', page.is_visible('#quiz-view'))
        opt_tiles = page.locator('.option-tile')
        if opt_tiles.count() > 0:
            opt_tiles.first.click(force=True)
            page.wait_for_timeout(200)
            common.check('answering in search practice reveals feedback/explanation box', page.is_visible('#live-feedback-box:not(.hidden)'))

        # -------------------------------------------------------------
        # 6. Return to search and test clear button
        # -------------------------------------------------------------
        page.evaluate("() => { location.hash = '#/search'; }")
        page.wait_for_timeout(200)
        if page.is_visible('#leave-modal:not(.hidden)'):
            page.locator('#leave-go').click(force=True)
            page.wait_for_timeout(300)

        page.wait_for_selector('#search-view:not(.hidden)', timeout=5000)

        clear_btn = page.locator('#search-clear-btn')
        common.check('clear button is present for active query', page.is_visible('#search-clear-btn'))
        clear_btn.click(force=True)
        page.wait_for_timeout(200)

        common.check('clear button clears input text', page.locator('#search-query-input').input_value() == '')
        common.check('initial state restored after clear', page.is_visible('#search-initial-state'))
        common.check('practice button disabled after clear', page.locator('#btn-start-search-practice').is_disabled())

        # -------------------------------------------------------------
        # 7. No results scenario (non-matching query)
        # -------------------------------------------------------------
        input_el.fill('كلمة_غير_موجودة_بتاتا_999xyz')
        page.wait_for_timeout(300)

        common.check('no results query displays empty state', page.is_visible('#search-empty-state'))
        common.check('no results query renders 0 cards', page.locator('.search-result-card').count() == 0)
        common.check('practice button disabled on 0 results', page.locator('#btn-start-search-practice').is_disabled())

        # No runtime JS errors
        common.check('no runtime errors during search flow', errs == [])

    finally:
        pw.stop()


if __name__ == '__main__':
    test_search_flow()
