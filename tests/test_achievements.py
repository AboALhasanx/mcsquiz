# tests/test_achievements.py
# Verification of Achievements Engine, Multi-tier Badges, and Bottom Sheet UI
import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
try:
    b, p, errs = common.new_page(pw)

    # 1. Setup mock student with rich quiz history
    now = int(time.time() * 1000)
    day_ms = 86400000

    # 4 consecutive days of study, with one perfect 100% quiz
    mock_history = [
        {'t': now, 'total': 10, 'score': 10, 'correct': 10, 'pct': 100, 'secs': 120, 'subjectId': 'demo'},
        {'t': now - day_ms, 'total': 15, 'score': 14, 'correct': 14, 'pct': 93, 'secs': 180, 'subjectId': 'demo'},
        {'t': now - 2 * day_ms, 'total': 12, 'score': 11, 'correct': 11, 'pct': 91, 'secs': 150, 'subjectId': 'demo'},
        {'t': now - 3 * day_ms, 'total': 10, 'score': 9, 'correct': 9, 'pct': 90, 'secs': 110, 'subjectId': 'demo'},
    ]
    # 25 saved questions
    mock_saved = {f"q_{i}": True for i in range(25)}
    # 2 VS wins
    mock_vs = [{'result': 'win'}, {'result': 'win'}, {'result': 'loss'}]

    mock_user = {
        'id': 'test-uuid-achieve-1',
        'handle': 'achiever_test',
        'name': 'طالب متميز',
        'avatar': 'assets/avatars/person-01.png'
    }

    p.evaluate(f"""() => {{
        localStorage.setItem('portal_account_v1', JSON.stringify({json.dumps(mock_user)}));
        localStorage.setItem('portal_pin_v1', '1234');
        localStorage.setItem('portal_history_v1', JSON.stringify({json.dumps(mock_history)}));
        localStorage.setItem('portal_saved_v1', JSON.stringify({json.dumps(mock_saved)}));
        localStorage.setItem('portal_vs_recent_v1', JSON.stringify({json.dumps(mock_vs)}));
    }}""")

    # 2. Test engine evaluation directly
    eval_data = p.evaluate("""() => {
        return window.PortalAchievements.evaluateAll();
    }""")

    # Check streak (4 days => Level 1 Bronze unlocked, next target is 7)
    streak_res = next((r for r in eval_data['results'] if r['badge']['id'] == 'streak_master'), None)
    common.check('streak badge detected', streak_res is not None)
    common.check('streak is unlocked at bronze (tier 1)', streak_res['evalRes']['achievedTier'] == 1)
    common.check('streak progress shows 4 / 7', streak_res['evalRes']['currentVal'] == 4 and streak_res['evalRes']['targetVal'] == 7)

    # Check sniper (perfect quiz with 10/10 => Single feat gold unlocked)
    sniper_res = next((r for r in eval_data['results'] if r['badge']['id'] == 'sniper'), None)
    common.check('sniper badge detected', sniper_res is not None)
    common.check('sniper is unlocked (tier 3 gold)', sniper_res['evalRes']['achievedTier'] == 3)

    # Check system shield (25 saved => Bronze target 10 reached, next is Silver 50)
    shield_res = next((r for r in eval_data['results'] if r['badge']['id'] == 'system_shield'), None)
    common.check('system shield is unlocked at bronze', shield_res['evalRes']['achievedTier'] == 1)
    common.check('system shield progress tracks 25 / 50', shield_res['evalRes']['currentVal'] == 25 and shield_res['evalRes']['targetVal'] == 50)

    # 3. Test Navigation to Account View and UI Inspection
    p.evaluate("() => { location.hash = '#/account'; }")
    p.wait_for_selector('#account-view:not(.hidden)', timeout=10000)
    p.wait_for_timeout(500)

    # Check Honors count
    badges_count_text = p.locator('#profile-badges-count').text_content()
    common.check('badges count displayed on shelf', '/' in badges_count_text)

    # Check that badge items are rendered on shelf
    badge_items = p.locator('.profile-badge-item')
    common.check('shelf has 8 badges', badge_items.count() == 8)

    # 4. Click a badge item to open the Bottom Sheet
    p.evaluate("() => { window.PortalAchievements.showBadgeSheet('streak_master'); }")
    p.wait_for_timeout(400)

    sheet_is_open = p.evaluate("() => document.getElementById('badge-sheet').classList.contains('is-open')")
    common.check('badge bottom sheet is opened', sheet_is_open)

    sheet_title = p.locator('#badge-sheet-title').text_content()
    common.check('sheet shows correct title', 'المثابر' in sheet_title)

    sheet_progress = p.locator('#badge-sheet-progress-val').text_content()
    common.check('sheet displays progress', '4 / 7' in sheet_progress)

    # Close the bottom sheet
    p.evaluate("() => { window.PortalAchievements.closeBadgeSheet(); }")
    p.wait_for_timeout(350)
    sheet_is_closed = p.evaluate("() => !document.getElementById('badge-sheet').classList.contains('is-open')")
    common.check('badge bottom sheet closes cleanly', sheet_is_closed)

    # 5. Test Celebration Floating Pill HUD
    p.evaluate("""() => {
        window.PortalAchievements.showCelebrationHUD({
            badge: { icon: 'award' },
            title: 'المثابر البرونزي',
            tierMeta: { label: 'الفئة البرونزية', color: '#d97706' }
        });
    }""")
    p.wait_for_timeout(300)

    hud_is_active = p.evaluate("() => document.getElementById('achievement-hud-pill').classList.contains('is-active')")
    common.check('celebration HUD pill is active', hud_is_active)
    hud_title = p.locator('#hud-pill-title').text_content()
    common.check('celebration HUD shows title', 'المثابر البرونزي' in hud_title)

    b.close()
    common.report()
finally:
    pw.stop()
