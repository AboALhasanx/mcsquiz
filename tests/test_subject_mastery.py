# tests/test_subject_mastery.py
# Verification of Subject Mastery Badges (أوسمة إتقان المواد)
# 1. Deterministic engine evaluation (completion, threshold >= 80%, multi-tier).
# 2. Honors shelf UI in #account-view (#profile-mastery-grid, count, unlocked styles).
# 3. Bottom sheet modal inspection for subject mastery badges and share button.
# 4. Subject chips mastery indicator on #deck-catalog.
# 5. Public player card honors highlight.

import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
try:
    b, p, errs = common.new_page(
        pw, tour_done=True,
        telegram={'id': 8888, 'first_name': 'طالب', 'username': 'master_tester'}
    )

    # -------------------------------------------------------------
    # 1. Pure Calculation Unit Tests
    # -------------------------------------------------------------
    calc_res = p.evaluate("""() => {
        const mockSubjects = [
            {
                subject_id: 'test_sub',
                subject_title: 'مادة الاختبار',
                chapters: [
                    { quiz_id: 'q1' },
                    { quiz_id: 'q2' },
                    { quiz_id: 'q3' }
                ]
            }
        ];

        // Case A: 0 completed
        const resA = window.PortalAchievements.evaluateSubjectMastery(mockSubjects, () => null);

        // Case B: Partial completion (2 of 3)
        const resB = window.PortalAchievements.evaluateSubjectMastery(mockSubjects, (id) => {
            if (id === 'q1') return { pct: 90 };
            if (id === 'q2') return { pct: 95 };
            return null;
        });

        // Case C: All completed but under threshold (75% avg)
        const resC = window.PortalAchievements.evaluateSubjectMastery(mockSubjects, () => ({ pct: 75 }));

        // Case D: All completed >= 80% (Silver tier 2)
        const resD = window.PortalAchievements.evaluateSubjectMastery(mockSubjects, () => ({ pct: 85 }));

        // Case E: All completed >= 90% (Gold tier 3)
        const resE = window.PortalAchievements.evaluateSubjectMastery(mockSubjects, () => ({ pct: 94 }));

        // Case F: All completed >= 98% (Diamond tier 4)
        const resF = window.PortalAchievements.evaluateSubjectMastery(mockSubjects, () => ({ pct: 100 }));

        return {
            a: resA.subjects[0],
            b: resB.subjects[0],
            c: resC.subjects[0],
            d: resD.subjects[0],
            e: resE.subjects[0],
            f: resF.subjects[0]
        };
    }""")

    # Assertions on pure engine logic
    common.check('0 quizzes completed is not mastered', calc_res['a']['isMastered'] is False and calc_res['a']['completedQuizzes'] == 0)
    common.check('partial completion 2/3 is not mastered', calc_res['b']['isMastered'] is False and calc_res['b']['completedQuizzes'] == 2)
    common.check('all completed at 75% is not mastered (threshold 80%)', calc_res['c']['isMastered'] is False and calc_res['c']['avgPct'] == 75)
    common.check('all completed at 85% is mastered at silver tier 2', calc_res['d']['isMastered'] is True and calc_res['d']['tier'] == 2)
    common.check('all completed at 94% is mastered at gold tier 3', calc_res['e']['isMastered'] is True and calc_res['e']['tier'] == 3)
    common.check('all completed at 100% is mastered at diamond tier 4', calc_res['f']['isMastered'] is True and calc_res['f']['tier'] == 4)

    # -------------------------------------------------------------
    # 2. UI Verification on Account Honors Shelf
    # -------------------------------------------------------------
    # AI subject ('06_Artificial_Intelligence') has 4 chapters in index.json:
    ai_quizzes = [
        'Quiz_Ch01_ModelA_AI_Foundations',
        'Quiz_Ch01_ModelB_AI_Foundations',
        'Quiz_Ch02_ModelA_Search_and_Learning',
        'Quiz_Ch02_ModelB_Search_and_Learning'
    ]

    mock_user = {
        'id': 'test-uuid-subject-mastery',
        'handle': 'master_tester',
        'name': 'طالب متفوق',
        'avatar': 'assets/avatars/person-03.png'
    }

    # Set up AI quizzes with 95% best scores in localStorage
    setup_script = f"""() => {{
        localStorage.setItem('portal_account_v1', JSON.stringify({json.dumps(mock_user)}));
        localStorage.setItem('portal_pin_v1', '1234');
        {"; ".join([f"localStorage.setItem('portal_best_{qid}', JSON.stringify({{ pct: 95, frac: '19/20' }}));" for qid in ai_quizzes])}
    }}"""
    p.evaluate(setup_script)

    # Navigate to Account View
    p.evaluate("() => { location.hash = '#/account'; }")
    p.wait_for_selector('#account-view:not(.hidden)', timeout=10000)
    p.wait_for_timeout(500)

    # Check mastery section count
    mastery_count = p.locator('#profile-mastery-count').text_content()
    common.check('subject mastery count displayed (1 / 6)', '1 / 6' in mastery_count)

    # Check that 6 subject badges are rendered
    mastery_items = p.locator('#profile-mastery-grid .profile-badge-item')
    common.check('6 subject mastery badges rendered', mastery_items.count() == 6)

    # Check that the AI badge is unlocked with gold tier styling
    ai_item = p.locator('#profile-mastery-grid .profile-badge-item.mastery-ai')
    common.check('AI subject badge exists', ai_item.count() == 1)
    common.check('AI badge is marked unlocked', 'is-unlocked' in (ai_item.get_attribute('class') or ''))
    common.check('AI badge has gold tier styling', 'tier-gold' in (ai_item.get_attribute('class') or ''))

    # Click on the AI mastery badge to open bottom sheet
    p.evaluate("() => { window.PortalAchievements.showSubjectMasterySheet('06_Artificial_Intelligence'); }")
    p.wait_for_timeout(400)

    sheet_open = p.evaluate("() => document.getElementById('badge-sheet').classList.contains('is-open')")
    common.check('bottom sheet opens for subject mastery', sheet_open)

    sheet_title = p.locator('#badge-sheet-title').text_content()
    common.check('sheet displays subject mastery title', 'الذكاء الاصطناعي' in sheet_title)

    sheet_prog = p.locator('#badge-sheet-progress-val').text_content()
    common.check('sheet displays 4 / 4 completed quizzes', '4 / 4' in sheet_prog)

    share_btn_visible = p.evaluate("() => !document.getElementById('badge-sheet-share-btn').classList.contains('hidden')")
    common.check('share card button is visible for mastered subject', share_btn_visible)

    # Close the sheet
    p.evaluate("() => { window.PortalAchievements.closeBadgeSheet(); }")
    p.wait_for_timeout(350)

    # -------------------------------------------------------------
    # 3. Subject Filter Chips on #deck-catalog
    # -------------------------------------------------------------
    p.evaluate("() => { location.hash = '#/'; }")
    p.wait_for_selector('#deck-catalog', timeout=10000)
    p.wait_for_timeout(500)

    # Check that the AI chip has the shield-check mastery icon
    ai_chip = p.locator('#subject-filter-bar button[data-subject="06_Artificial_Intelligence"]')
    common.check('AI chip exists in filter bar', ai_chip.count() == 1)
    has_mastery_icon = ai_chip.locator('.chip-mastery-icon').count() > 0
    common.check('mastered AI chip displays shield-check mastery icon', has_mastery_icon)

    # Check unmastered subject (e.g. Cyber Security) has NO mastery icon
    cyber_chip = p.locator('#subject-filter-bar button[data-subject="01_Cyber_Security"]')
    common.check('cyber security chip has no mastery icon', cyber_chip.locator('.chip-mastery-icon').count() == 0)

    # -------------------------------------------------------------
    # 4. Public Player Card Honors Highlight
    # -------------------------------------------------------------
    p.evaluate("""() => {
        window.location.hash = '#/league';
    }""")
    p.wait_for_selector('#league-view:not(.hidden)', timeout=10000)
    p.wait_for_timeout(400)

    # Trigger player card for the current student using getLeagueUI
    p.evaluate("""() => {
        const r = {
            user_id: 'test-uuid-subject-mastery',
            name: 'طالب متفوق',
            avatar: 'assets/avatars/person-03.png',
            rank: 1,
            score: 1500,
            solved: 40,
            accuracy: 95,
            isMe: true
        };
        const leagueUI = window.__portal ? window.__portal.getLeagueUI() : window.PortalLeagueUI.create({});
        leagueUI.openPlayerCard(r);
    }""")
    p.wait_for_timeout(400)

    player_card_text = p.locator('#player-card').inner_text()
    common.check('player card highlights mastered subject pill', 'إتقان الذكاء الاصطناعي' in player_card_text)

    b.close()
    common.report()
finally:
    pw.stop()
