# tests/test_review_flow.py
# End-to-End integration test for Review Hub, Spaced Repetition (Leitner), and Custom Quiz Builder.
# Verifies routing, deck launching, question answering, Leitner progression, session isolation (no history/XP pollution),
# study day recording, and retry flows.
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import check


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True)
    try:
        ev = page.evaluate

        # Ensure banks are loaded
        page.goto(f"{common.BASE}/?debug=1#/", wait_until="networkidle")
        page.wait_for_selector("#deck-catalog", state="visible")
        page.wait_for_timeout(1000)

        # 1. Navigation to #/review
        page.goto(f"{common.BASE}/?debug=1#/review", wait_until="networkidle")
        page.wait_for_timeout(500)

        is_review_visible = ev("() => !document.getElementById('review-view').classList.contains('hidden')")
        check("Route #/review renders review-view", is_review_visible)

        # 2. Review Hub DOM elements exist
        has_stats_grid = ev("() => Boolean(document.querySelector('.review-stats-grid'))")
        has_due_deck = ev("() => Boolean(document.getElementById('btn-start-due-review'))")
        has_weak_deck = ev("() => Boolean(document.getElementById('btn-start-weak-review'))")
        has_custom_builder = ev("() => Boolean(document.getElementById('btn-start-custom-quiz'))")
        check("Review Hub contains stats grid, deck buttons, and custom builder",
              has_stats_grid and has_due_deck and has_weak_deck and has_custom_builder)

        # 3. Initially with empty review store: due and weak counts are 0, buttons disabled
        btn_due_disabled = ev("() => document.getElementById('btn-start-due-review').disabled === true")
        btn_weak_disabled = ev("() => document.getElementById('btn-start-weak-review').disabled === true")
        check("Due and weak buttons are disabled when no cards exist", btn_due_disabled and btn_weak_disabled)

        # 4. Custom Builder chips interaction
        # Click 'Saved' source chip
        saved_chip_clicked = ev("""() => {
            const chip = document.querySelector('.builder-chip[data-source=\"saved\"]');
            if (!chip) return false;
            chip.click();
            return chip.classList.contains('active');
        }""")
        check("Custom builder source chip toggles active", saved_chip_clicked)

        # Click 'Subject' source chip: picker group should become visible
        sub_chip_revealed = ev("""() => {
            const chip = document.querySelector('.builder-chip[data-source=\"subject\"]');
            if (!chip) return false;
            chip.click();
            const group = document.getElementById('builder-subject-picker-group');
            return chip.classList.contains('active') && group && !group.classList.contains('hidden');
        }""")
        check("Subject source chip reveals subject picker dropdown", sub_chip_revealed)

        # Count chip interaction (select 20)
        count_chip_selected = ev("""() => {
            const chip = document.querySelector('.builder-chip[data-count=\"20\"]');
            if (!chip) return false;
            chip.click();
            return chip.classList.contains('active');
        }""")
        check("Count chip 20 toggles active", count_chip_selected)

        # 5. Populate mock Leitner store with 2 due questions and 1 weak question
        # Find a real question key from index and banks
        seed_res = ev("""() => {
            const S = window.__portal ? window.__portal.S : null;
            if (!S || !S.index || !S.banks) return null;
            const sub = S.index.subjects[0];
            const ch = sub.chapters[0];
            const bank = S.banks[ch.quiz_id];
            if (!bank || !bank.questions || !bank.questions.length) return null;
            const q0 = bank.questions[0];
            const q1 = bank.questions[1] || bank.questions[0];
            const k0 = sub.subject_id + '|' + ch.quiz_id + '|' + q0.id;
            const k1 = sub.subject_id + '|' + ch.quiz_id + '|' + q1.id;

            // Seed review store using PortalReview
            const t = window.PortalReview.today();
            window.PortalReview.recordAnswer(k0, 'abc0', true);
            window.PortalReview.recordAnswer(k1, 'abc1', false);
            const s = window.PortalReview.loadStore();
            s[k0].d = t;      // due today!
            s[k1].d = t + 5;  // not due today, but weak (w=1, n=1)!
            window.PortalReview.saveStore(s);
            return { k0, k1, q0, q1, quizId: ch.quiz_id };
        }""")
        check("Seed review store with due and weak cards", bool(seed_res and seed_res.get('k0')))

        # Re-render review hub to reflect seeded cards
        ev("() => { if (window.__portal && window.__portal.renderReview) window.__portal.renderReview(); }")
        page.wait_for_timeout(500)

        stat_due_val = ev("() => document.getElementById('review-stat-due').textContent.trim()")
        stat_weak_val = ev("() => document.getElementById('review-stat-weak').textContent.trim()")
        check("Review stats display 1 due card and 1 weak card", stat_due_val == "1" and stat_weak_val == "1")

        btn_due_enabled = ev("() => document.getElementById('btn-start-due-review').disabled === false")
        check("Due review button is enabled when due questions exist", btn_due_enabled)

        # 6. Launch Due Review session
        ev("() => document.getElementById('btn-start-due-review').click()")
        page.wait_for_timeout(500)

        is_quiz_start = ev("() => !document.getElementById('quiz-start-view').classList.contains('hidden')")
        check("Clicking start due review transitions to quiz-start-view", is_quiz_start)

        ses_kind = ev("() => (window.__portal && window.__portal.S.session) ? window.__portal.S.session.kind : null")
        check("Review session has kind: 'review'", ses_kind == "review")

        # 7. Start answering questions
        ev("() => document.getElementById('btn-start-quiz').click()")
        page.wait_for_timeout(500)

        is_quiz_view = ev("() => !document.getElementById('quiz-view').classList.contains('hidden')")
        check("Clicking start transitions to quiz-view", is_quiz_view)

        # Check history length before quiz
        hist_len_before = ev("() => (window.__portal ? window.__portal.S.history.length : 0)")

        # Answer question correctly
        ev("""() => {
            const ses = window.__portal.S.session;
            const q = ses.questions[ses.idx];
            window.__portal.pickOption(q.correct);
        }""")
        page.wait_for_timeout(400)

        # Advance / finish quiz
        ev("() => document.getElementById('btn-next').click()")
        page.wait_for_timeout(600)

        is_results = ev("() => !document.getElementById('results-view').classList.contains('hidden')")
        check("Quiz completion leads to results-view", is_results)

        # 8. Verify session isolation: Review session must NOT pollute history or league XP!
        hist_len_after = ev("() => (window.__portal ? window.__portal.S.history.length : 0)")
        check("Review session does NOT append to portal_history_v1", hist_len_after == hist_len_before)

        # 9. Verify Leitner card progression: k0 should have moved to box 2!
        k0_state = ev(f"""() => {{
            const store = JSON.parse(localStorage.getItem('portal_review_v1') || '{{}}');
            return store ? store['{seed_res["k0"]}'] : null;
        }}""")
        check("Card moved to box 2 upon correct answer in review", k0_state and k0_state.get('b') == 2)

        # 10. Verify study day logging
        study_days = ev("() => JSON.parse(localStorage.getItem('portal_days_v1') || '{}')")
        check("Study day is recorded in portal_days_v1", isinstance(study_days, dict) and len(study_days) >= 1)

        # 11. Retry quiz button on Review session
        # Clicking 'btn-retry-quiz' should restart the review session cleanly without crashing
        retry_ok = ev("""() => {
            try {
                document.getElementById('btn-retry-quiz').click();
                const ses = window.__portal.S.session;
                return ses && ses.kind === 'review' && ses.started === true;
            } catch (e) {
                return false;
            }
        }""")
        page.wait_for_timeout(500)
        check("Retry quiz on review session restarts cleanly without error", retry_ok)

        # 12. Menu review badge reflects due items
        badge_val = ev("""() => {
            if (window.PortalReviewUI) window.PortalReviewUI.updateBadge();
            const b = document.getElementById('menu-review-count');
            return { text: b ? b.textContent : '', hidden: b ? b.classList.contains('hidden') : true };
        }""")
        # Since k0 was moved to box 2 (interval 3 days), due count should now be 0, badge hidden
        check("Menu review badge is hidden when 0 cards are due", badge_val.get('hidden') is True)

    finally:
        browser.close()
        pw.stop()


if __name__ == "__main__":
    run()
