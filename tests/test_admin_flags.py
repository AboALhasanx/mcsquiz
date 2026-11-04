# tests/test_admin_flags.py
# Verification of Admin Question QA Flags Tool (Strictly restricted to @aboalhasan)
import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
try:
    b, p, errs = common.new_page(pw)

    # -------------------------------------------------------------
    # 1. Admin Authorization Gate Tests
    # -------------------------------------------------------------
    # Guest user: isAdmin must be false
    p.evaluate("""() => {
        localStorage.clear();
    }""")
    is_admin = p.evaluate("() => window.PortalAdminFlags.isAdmin()")
    common.check('guest is not admin', is_admin is False)

    # Regular user: isAdmin must be false
    p.evaluate("""() => {
        localStorage.setItem('portal_account_v1', JSON.stringify({
            handle: 'student123',
            name: 'طالب مجتهد'
        }));
    }""")
    is_admin = p.evaluate("() => window.PortalAdminFlags.isAdmin()")
    common.check('regular student is not admin', is_admin is False)

    # Admin user: aboalhasan must be true (case-insensitive)
    p.evaluate("""() => {
        localStorage.setItem('portal_account_v1', JSON.stringify({
            handle: 'aboalhasan',
            name: 'ابو الحسن'
        }));
    }""")
    is_admin = p.evaluate("() => window.PortalAdminFlags.isAdmin()")
    common.check('aboalhasan is admin', is_admin is True)

    p.evaluate("""() => {
        localStorage.setItem('portal_account_v1', JSON.stringify({
            handle: 'AboAlHasan',
            name: 'ابو الحسن'
        }));
    }""")
    is_admin = p.evaluate("() => window.PortalAdminFlags.isAdmin()")
    common.check('handle check is case-insensitive', is_admin is True)

    # -------------------------------------------------------------
    # 2. PortalAdminFlags Engine CRUD & Export
    # -------------------------------------------------------------
    crud_res = p.evaluate("""() => {
        window.PortalAdminFlags.clearAll();
        const initialCount = window.PortalAdminFlags.count();

        // set flag
        window.PortalAdminFlags.setFlag('sub1::ch1::q1', {
            subjectId: 'sub1',
            quizId: 'ch1',
            qid: 'q1',
            stem: 'سؤال تجريبي',
            tag: 'wrong_answer',
            tagLabel: 'إجابة غير صحيحة',
            note: 'الجواب الصحيح هو د'
        });

        const countAfterSet = window.PortalAdminFlags.count();
        const stored = window.PortalAdminFlags.getFlag('sub1::ch1::q1');
        const exportData = window.PortalAdminFlags.exportPayload();

        // remove flag
        window.PortalAdminFlags.removeFlag('sub1::ch1::q1');
        const countAfterRemove = window.PortalAdminFlags.count();

        return {
            initialCount: initialCount,
            countAfterSet: countAfterSet,
            storedTag: stored ? stored.tag : null,
            storedNote: stored ? stored.note : null,
            exportCount: exportData.totalCount,
            exportFlagsLen: exportData.flags.length,
            countAfterRemove: countAfterRemove
        };
    }""")

    common.check('initial count is 0', crud_res['initialCount'] == 0)
    common.check('count after set is 1', crud_res['countAfterSet'] == 1)
    common.check('stored tag matches', crud_res['storedTag'] == 'wrong_answer')
    common.check('stored note matches', crud_res['storedNote'] == 'الجواب الصحيح هو د')
    common.check('export payload has 1 item', crud_res['exportCount'] == 1 and crud_res['exportFlagsLen'] == 1)
    common.check('count after remove is 0', crud_res['countAfterRemove'] == 0)

    # -------------------------------------------------------------
    # 3. In-Quiz UI: Hidden for non-admin vs Visible for aboalhasan
    # -------------------------------------------------------------
    # Load bank and start a quiz
    p.goto(common.BASE_URL + '/#/')
    p.wait_for_selector('.subject-card', timeout=7000)

    # First test as guest/non-admin
    p.evaluate("""() => {
        localStorage.clear();
        localStorage.setItem('portal_account_v1', JSON.stringify({
            handle: 'student_tester',
            name: 'طالب'
        }));
    }""")
    p.reload()
    p.wait_for_selector('.subject-card', timeout=7000)
    p.click('.subject-card')
    p.wait_for_selector('.quiz-item-btn', timeout=7000)
    p.click('.quiz-item-btn')
    p.wait_for_selector('#btn-start-quiz', timeout=7000)
    p.click('#btn-start-quiz')
    p.wait_for_selector('#question-card', timeout=7000)

    is_flag_btn_hidden = p.evaluate("""() => {
        const btn = document.getElementById('btn-flag-question');
        return !btn || btn.classList.contains('hidden');
    }""")
    common.check('flag button is hidden for non-admin', is_flag_btn_hidden is True)

    # Exit quiz back to home
    p.click('#btn-exit')
    p.wait_for_selector('.subject-card', timeout=7000)

    # Now test as aboalhasan
    p.evaluate("""() => {
        localStorage.setItem('portal_account_v1', JSON.stringify({
            handle: 'aboalhasan',
            name: 'ابو الحسن'
        }));
    }""")
    p.reload()
    p.wait_for_selector('.subject-card', timeout=7000)
    p.click('.subject-card')
    p.wait_for_selector('.quiz-item-btn', timeout=7000)
    p.click('.quiz-item-btn')
    p.wait_for_selector('#btn-start-quiz', timeout=7000)
    p.click('#btn-start-quiz')
    p.wait_for_selector('#question-card', timeout=7000)

    is_flag_btn_visible = p.evaluate("""() => {
        const btn = document.getElementById('btn-flag-question');
        return btn && !btn.classList.contains('hidden');
    }""")
    common.check('flag button is visible for aboalhasan', is_flag_btn_visible is True)

    # -------------------------------------------------------------
    # 4. Timer Pause on Flag Modal Open & Resume on Save
    # -------------------------------------------------------------
    time_state_1 = p.evaluate("""() => {
        const ses = window.__portal ? window.__portal.state().session : null;
        return { isPaused: !!(ses && ses.pauseStart) };
    }""")
    common.check('quiz session timer is running before modal open', time_state_1['isPaused'] is False)

    # Click flag button
    p.click('#btn-flag-question')
    p.wait_for_selector('#flag-modal:not(.hidden)', timeout=5000)

    time_state_2 = p.evaluate("""() => {
        const ses = window.__portal ? window.__portal.state().session : null;
        return { isPaused: !!(ses && ses.pauseStart) };
    }""")
    common.check('quiz session timer is paused when modal opens', time_state_2['isPaused'] is True)

    # Select tag and fill note
    p.click('#flag-tags-grid button[data-tag="options"]')
    p.fill('#flag-note-input', 'الخيار ج يحتاج تعديل صياغة')
    p.click('#btn-save-flag')

    p.wait_for_selector('#flag-modal.hidden', timeout=5000)

    time_state_3 = p.evaluate("""() => {
        const ses = window.__portal ? window.__portal.state().session : null;
        const btn = document.getElementById('btn-flag-question');
        return {
            isPaused: !!(ses && ses.pauseStart),
            isFlaggedClass: btn && btn.classList.contains('is-flagged'),
            flagsCount: window.PortalAdminFlags.count()
        };
    }""")
    common.check('quiz session timer resumes after saving flag', time_state_3['isPaused'] is False)
    common.check('flag button has is-flagged class', time_state_3['isFlaggedClass'] is True)
    common.check('flags count is 1', time_state_3['flagsCount'] == 1)

    # -------------------------------------------------------------
    # 5. Account Profile View: Admin Export & Count Badge
    # -------------------------------------------------------------
    # Navigate to account profile
    p.goto(common.BASE_URL + '/#/account')
    p.wait_for_selector('#account-view', timeout=7000)

    export_btn_state = p.evaluate("""() => {
        const btn = document.getElementById('account-export-flags');
        const badge = document.getElementById('admin-flags-count');
        return {
            visible: btn && !btn.classList.contains('hidden'),
            countText: badge ? badge.textContent.trim() : ''
        };
    }""")
    common.check('export flags button is visible for aboalhasan', export_btn_state['visible'] is True)
    common.check('export flags count badge shows 1', export_btn_state['countText'] == '1')

    # Now verify it is hidden when not admin
    p.evaluate("""() => {
        localStorage.setItem('portal_account_v1', JSON.stringify({
            handle: 'regular_user',
            name: 'طالب'
        }));
        if (window.__portal && window.__portal.renderAccount) {
            window.__portal.renderAccount();
        }
    }""")
    p.reload()
    p.wait_for_selector('#account-view', timeout=7000)

    non_admin_export_state = p.evaluate("""() => {
        const btn = document.getElementById('account-export-flags');
        return !btn || btn.classList.contains('hidden');
    }""")
    common.check('export flags button is hidden for regular user', non_admin_export_state is True)

    # -------------------------------------------------------------
    # 6. Cloud Bundle Merging
    # -------------------------------------------------------------
    merge_res = p.evaluate("""() => {
        const bundleA = {
            app: 'mcq-portal',
            version: 2,
            updatedAt: 1000,
            flags: {
                'k1': { tag: 'wrong_answer', note: 'ملاحظة أ', updatedAt: 1000 }
            }
        };
        const bundleB = {
            app: 'mcq-portal',
            version: 2,
            updatedAt: 2000,
            flags: {
                'k1': { tag: 'options', note: 'ملاحظة محدثة', updatedAt: 2000 },
                'k2': { tag: 'wording', note: 'سؤال ثاني', updatedAt: 1500 }
            }
        };
        const merged = window.PortalCloud.mergeBundles(bundleA, bundleB);
        return {
            flagsCount: Object.keys(merged.flags || {}).length,
            k1Tag: merged.flags && merged.flags['k1'] ? merged.flags['k1'].tag : null,
            k1Note: merged.flags && merged.flags['k1'] ? merged.flags['k1'].note : null,
            hasK2: !!(merged.flags && merged.flags['k2'])
        };
    }""")
    common.check('cloud merge contains 2 flags', merge_res['flagsCount'] == 2)
    common.check('cloud merge resolved k1 to newer updatedAt', merge_res['k1Tag'] == 'options')
    common.check('cloud merge retained k2', merge_res['hasK2'] is True)

    print("ALL ADMIN FLAGS TESTS PASSED")

finally:
    pw.stop()
