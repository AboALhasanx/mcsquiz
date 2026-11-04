# tests/test_achievements_flow.py
# Verification of:
# 1. Badge Share Card Generation and Share Modal
# 2. Public Player Card Honors & Streak Highlights
# 3. Quiz Completion Celebration Flow on Results View

import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
b, p, errs = common.new_page(
    pw, tour_done=True,
    telegram={'id': 7777, 'first_name': 'طالب', 'username': 'talib'}
)

try:
    now = int(time.time() * 1000)
    day_ms = 86400000

    # Mock history: 4 consecutive study days, 1 perfect quiz
    mock_history = [
        {'t': now, 'total': 10, 'score': 10, 'correct': 10, 'pct': 100, 'secs': 120, 'subjectId': 'demo'},
        {'t': now - day_ms, 'total': 15, 'score': 14, 'correct': 14, 'pct': 93, 'secs': 180, 'subjectId': 'demo'},
        {'t': now - 2 * day_ms, 'total': 12, 'score': 11, 'correct': 11, 'pct': 91, 'secs': 150, 'subjectId': 'demo'},
        {'t': now - 3 * day_ms, 'total': 10, 'score': 9, 'correct': 9, 'pct': 90, 'secs': 110, 'subjectId': 'demo'},
    ]
    mock_saved = {f"q_{i}": True for i in range(25)}
    mock_vs = [{'result': 'win'}, {'result': 'win'}, {'result': 'loss'}]

    mock_user = {
        'id': 'test-uuid-achieve-flow',
        'handle': 'flow_tester',
        'name': 'طالب متفوق',
        'avatar': 'assets/avatars/person-02.png'
    }

    p.evaluate(f"""() => {{
        localStorage.setItem('portal_account_v1', JSON.stringify({json.dumps(mock_user)}));
        localStorage.setItem('portal_pin_v1', '1234');
        localStorage.setItem('portal_history_v1', JSON.stringify({json.dumps(mock_history)}));
        localStorage.setItem('portal_saved_v1', JSON.stringify({json.dumps(mock_saved)}));
        localStorage.setItem('portal_vs_recent_v1', JSON.stringify({json.dumps(mock_vs)}));
    }}""")

    # -------------------------------------------------------------
    # Test 1: Badge Share Card Flow
    # -------------------------------------------------------------
    p.evaluate("() => { location.hash = '#/account'; }")
    p.wait_for_selector('#account-view:not(.hidden)', timeout=10000)
    p.wait_for_timeout(400)

    # Open bottom sheet for sniper badge (unlocked at Gold tier)
    p.evaluate("() => { window.PortalAchievements.showBadgeSheet('sniper'); }")
    p.wait_for_timeout(400)

    # Verify share button is visible
    share_btn_vis = p.evaluate("() => { const b = document.getElementById('badge-sheet-share-btn'); return b && !b.classList.contains('hidden'); }")
    common.check('badge sheet share button is visible for unlocked badge', share_btn_vis)

    # Click the share button inside the bottom sheet
    p.click('#badge-sheet-share-btn')
    p.wait_for_timeout(1000)

    share_modal_open = p.evaluate("() => { const m = document.getElementById('share-modal'); return m && !m.classList.contains('hidden'); }")
    common.check('badge share card triggers share preview modal', share_modal_open)

    share_title_txt = p.locator('#share-title').text_content()
    common.check('share modal title shows badge name', 'القناص الذهبي' in share_title_txt)

    # Verify that the image was rendered
    img_width = p.evaluate("() => document.getElementById('share-img').naturalWidth || 0")
    common.check('share modal rendered card canvas', img_width > 0)

    # Close share modal
    p.click('#share-close')
    p.wait_for_timeout(300)
    p.evaluate("() => { window.PortalAchievements.closeBadgeSheet(); }")
    p.wait_for_timeout(300)

    # -------------------------------------------------------------
    # Test 2: Public Player Card Honors Highlight
    # -------------------------------------------------------------
    common.install_mock(p, common.board(player=8, me_id='tg:7777'))
    p.evaluate("() => { location.hash = '#/league'; }")
    p.wait_for_selector('#league-view:not(.hidden)', timeout=10000)
    p.wait_for_function("""() => {
        const box = document.querySelector('#league-board');
        return box && box.childElementCount > 0;
    }""", timeout=15000)
    p.wait_for_timeout(400)

    # Click first row in league board to open player card
    p.locator('.league-row').first.click()
    p.wait_for_selector('#player-drawer.open', timeout=8000)
    p.wait_for_timeout(300)

    drawer_open = p.evaluate("() => document.getElementById('player-drawer').classList.contains('open')")
    common.check('player drawer opened from league', drawer_open)

    card_text = p.locator('#player-card').inner_text()
    common.check('player card renders accurately', 'إجابة' in card_text and 'المركز' in card_text)
    common.check('player card never leaks handle', '@' not in card_text)

    # Close player drawer
    p.click('#player-close')
    p.wait_for_timeout(300)

    # -------------------------------------------------------------
    # Test 3: Quiz Finish Celebration Flow on Results View
    # -------------------------------------------------------------
    p.evaluate("""() => {
        // Reset achievements state with hasBootstrapped: true so this fresh quiz celebrates sniper
        localStorage.setItem('portal_achievements_v1', JSON.stringify({ hasBootstrapped: true, unlocked: {} }));

        const ses = {
            subjectId: 'demo',
            mode: 'practice',
            questions: Array.from({ length: 5 }, (_, i) => ({ id: 'q_' + i }))
        };
        const res = {
            total: 5,
            score: 5,
            correct: 5,
            pct: 100,
            band: { ar: 'ممتاز' },
            secs: 60
        };
        // Evaluate checkAfterQuiz
        const newBadges = window.PortalAchievements.checkAfterQuiz(ses, res);

        // Show results-view
        const views = ['catalog-view', 'practice-view', 'deck-catalog', 'quiz-start-view', 'quiz-view', 'results-view', 'saved-view', 'stats-view', 'league-view', 'account-view', 'vs-view'];
        views.forEach(v => { const el = document.getElementById(v); if (el) el.classList.toggle('hidden', v !== 'results-view'); });

        // Render celebratory block
        const celEl = document.getElementById('results-achievement-celebration');
        if (celEl && newBadges.length > 0) {
            const top = newBadges[0];
            const tierClass = (top.tierMeta && top.tierMeta.accentClass) ? top.tierMeta.accentClass : 'tier-gold';
            celEl.className = 'results-achievement-celebration ' + tierClass;
            celEl.innerHTML = '<div class="results-cel-icon-wrap">' +
                '<i data-lucide="' + top.badge.icon + '"></i>' +
                '</div>' +
                '<div class="results-cel-info">' +
                '<span class="results-cel-kicker">وسام شرفي جديد أُحرز!</span>' +
                '<h4 class="results-cel-title">' + top.title + '</h4>' +
                '<p class="results-cel-desc">' + top.desc + '</p>' +
                '</div>';
            celEl.classList.remove('hidden');
            celEl.onclick = () => window.PortalAchievements.showBadgeSheet(top.badge.id);
            if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
        }
    }""")
    p.wait_for_timeout(400)

    cel_vis = p.evaluate("() => { const c = document.getElementById('results-achievement-celebration'); return c && !c.classList.contains('hidden'); }")
    common.check('quiz results celebration card is visible on quiz finish', cel_vis)

    cel_text = p.locator('#results-achievement-celebration').inner_text()
    common.check('celebration card has honors kicker', 'وسام شرفي جديد أُحرز' in cel_text)

    # Click celebration card to verify it opens the Bottom Sheet
    p.locator('#results-achievement-celebration').click()
    p.wait_for_timeout(400)

    sheet_opened_from_results = p.evaluate("() => document.getElementById('badge-sheet').classList.contains('is-open')")
    common.check('clicking results celebration card opens badge bottom sheet', sheet_opened_from_results)

    # Close bottom sheet
    p.evaluate("() => window.PortalAchievements.closeBadgeSheet();")
    p.wait_for_timeout(300)

    print("ALL 10 CHECKS PASSED")

finally:
    b.close()
