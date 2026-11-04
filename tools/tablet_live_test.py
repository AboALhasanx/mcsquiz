import json
import time
import os
import sys
import subprocess
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def capture_tablet_screen(dest):
    adb = r"C:\Users\gokoq\AppData\Local\FlutterWay\android-sdk\platform-tools\adb.exe"
    data = subprocess.check_output([adb, "exec-out", "screencap", "-p"])
    with open(dest, "wb") as f:
        f.write(data)

def run_tablet_verification():
    print("Connecting to tablet over CDP at http://127.0.0.1:9333...")
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp("http://127.0.0.1:9333")
        contexts = browser.contexts
        if not contexts:
            print("No contexts found!")
            return
        
        ctx = contexts[0]
        pages = ctx.pages
        print(f"Found {len(pages)} pages on tablet.")
        
        # Find the portal page or navigate one
        page = None
        for p in pages:
            url = p.url
            print("Page URL:", url)
            if "8081" in url or "mcq" in url:
                page = p
                break
        
        if not page:
            page = pages[0]
            print("Navigating page 0 to http://127.0.0.1:8081/?debug=1#/")
            page.goto("http://127.0.0.1:8081/?debug=1#/")
            page.wait_for_load_state('domcontentloaded')
            page.wait_for_timeout(2000)
        else:
            print("Reusing existing page:", page.url)
            # reload with cache-bust to ensure new js/css loads cleanly
            page.goto(f"http://127.0.0.1:8081/?debug=1&t={int(time.time())}#/")
            page.wait_for_load_state('domcontentloaded')
            page.wait_for_timeout(2000)
        page.bring_to_front()
        page.wait_for_timeout(500)

        # -------------------------------------------------------------
        # STEP 1: Verify current account on tablet
        # -------------------------------------------------------------
        current_acc = page.evaluate("""() => {
            const C = window.PortalCloud;
            const acc = C && C.account ? C.account() : null;
            const raw = localStorage.getItem('portal_account_v1');
            return {
                cloudAcc: acc,
                rawAcc: raw ? JSON.parse(raw) : null,
                isAdmin: window.PortalAdminFlags ? window.PortalAdminFlags.isAdmin() : false
            };
        }""")
        print("Tablet current account state:", current_acc)

        # If not logged in as aboalhasan, set aboalhasan for the admin test
        # (save previous account if any to restore later)
        prev_raw = page.evaluate("() => localStorage.getItem('portal_account_v1')")
        prev_pin = page.evaluate("() => localStorage.getItem('portal_pin_v1')")

        print("\n--- [TEST 1: Admin Account (@aboalhasan)] ---")
        if not current_acc['isAdmin']:
            page.evaluate("""() => {
                localStorage.setItem('portal_account_v1', JSON.stringify({
                    id: 'acc-aboalhasan-live',
                    handle: 'aboalhasan',
                    name: 'ابو الحسن'
                }));
                localStorage.setItem('portal_tour_done', '1');
                localStorage.setItem('portal_quiz_hint', '1');
            }""")
        else:
            page.evaluate("""() => {
                localStorage.setItem('portal_tour_done', '1');
                localStorage.setItem('portal_quiz_hint', '1');
            }""")

        page.evaluate("(h) => { location.hash = h; }", "#/")
        page.wait_for_timeout(600)

        # Navigate to first quiz
        subs = page.evaluate("""() => {
            return (window.__portal && window.__portal.S && window.__portal.S.index && window.__portal.S.index.subjects) 
                ? window.__portal.S.index.subjects.map(s => ({ id: s.subject_id, ch: (s.chapters||[]).map(c=>c.quiz_id) }))
                : [];
        }""")
        if not subs:
            print("Subjects not ready, waiting...")
            page.wait_for_selector('.subject-card', timeout=10000)
            subs = page.evaluate("""() => window.__portal.S.index.subjects.map(s => ({ id: s.subject_id, ch: s.chapters.map(c=>c.quiz_id) }))""")
        
        sid = subs[0]['id']
        qid = subs[0]['ch'][0]
        print(f"Navigating to quiz: subject={sid}, quiz={qid}")

        page.evaluate(f"(h) => {{ location.hash = h; }}", f"#/quiz/{sid}/{qid}")
        page.wait_for_timeout(1000)

        def tap(sel):
            page.wait_for_selector(sel, timeout=7000)
            page.evaluate(f"() => {{ const el = document.querySelector('{sel}'); if (el) el.click(); }}")

        # Start quiz if start button is visible
        if page.locator('#btn-start-quiz').is_visible():
            tap('#btn-start-quiz')
            page.wait_for_timeout(800)
        
        page.wait_for_selector('#question-card', timeout=10000)

        # Check flag button visibility for aboalhasan
        flag_btn_visible = page.evaluate("""() => {
            const btn = document.getElementById('btn-flag-question');
            return btn && !btn.classList.contains('hidden');
        }""")
        print("Flag button visible for aboalhasan:", flag_btn_visible)
        assert flag_btn_visible, "Flag button MUST be visible for aboalhasan"

        # Check timer is running
        timer_text_before = page.locator('#session-timer').text_content()
        print("Session timer before flag modal:", timer_text_before)

        out_dir = r"C:\Users\gokoq\.gemini\antigravity\brain\c93cbeb3-3645-440b-9f04-ac4956782de6"
        btn_shot = os.path.join(out_dir, "tablet_flag_button_live.png")
        capture_tablet_screen(btn_shot)
        print("Saved screenshot:", btn_shot)

        # Click flag button to open modal
        tap('#btn-flag-question')
        page.wait_for_selector('#flag-modal:not(.hidden)', timeout=5000)
        page.wait_for_timeout(400)

        # Verify timer is paused
        is_paused = page.evaluate("""() => {
            const ses = window.__portal ? window.__portal.S.session : null;
            return !!(ses && ses.pauseStart);
        }""")
        print("Quiz session timer paused:", is_paused)
        assert is_paused, "Timer must be paused when flag modal is open"

        # Screenshot: Flag modal on tablet
        out_dir = r"C:\Users\gokoq\.gemini\antigravity\brain\c93cbeb3-3645-440b-9f04-ac4956782de6"
        modal_shot = os.path.join(out_dir, "tablet_flag_modal_live.png")
        capture_tablet_screen(modal_shot)
        print("Saved screenshot:", modal_shot)

        # Select defect tag: wording, fill note
        tap('#flag-tags-grid button[data-tag="wording"]')
        page.fill('#flag-note-input', 'صياغة السؤال تحتاج مراجعة في الترجمة العربية')
        page.wait_for_timeout(300)

        # Save flag
        tap('#btn-save-flag')
        page.wait_for_selector('#flag-modal', state='hidden', timeout=5000)
        page.wait_for_timeout(500)

        # Verify timer resumed
        is_paused_after = page.evaluate("""() => {
            const ses = window.__portal ? window.__portal.S.session : null;
            return !!(ses && ses.pauseStart);
        }""")
        print("Quiz session timer resumed after save:", not is_paused_after)
        assert not is_paused_after, "Timer must resume after saving flag"

        # Verify button has .is-flagged
        is_flagged = page.evaluate("""() => {
            const btn = document.getElementById('btn-flag-question');
            return btn && btn.classList.contains('is-flagged');
        }""")
        print("Flag button highlighted (.is-flagged):", is_flagged)
        assert is_flagged, "Flag button must have .is-flagged class"

        # Screenshot: Question with amber flag button
        flagged_shot = os.path.join(out_dir, "tablet_flagged_question_live.png")
        capture_tablet_screen(flagged_shot)
        print("Saved screenshot:", flagged_shot)

        # Exit quiz cleanly
        tap('#btn-exit')
        page.wait_for_selector('#leave-go', timeout=5000)
        tap('#leave-go')
        page.wait_for_timeout(500)

        # Check Account Profile for admin export buttons
        page.evaluate("(h) => { location.hash = h; }", "#/account")
        page.wait_for_selector('#account-view:not(.hidden)', timeout=7000)
        page.wait_for_timeout(600)

        admin_export_state = page.evaluate("""() => {
            const exportBtn = document.getElementById('account-export-flags');
            const clearBtn = document.getElementById('account-clear-flags');
            const badge = document.getElementById('admin-flags-count');
            return {
                exportVisible: exportBtn && !exportBtn.classList.contains('hidden'),
                clearVisible: clearBtn && !clearBtn.classList.contains('hidden'),
                count: badge ? badge.textContent.trim() : '0'
            };
        }""")
        print("Admin export state in account profile:", admin_export_state)
        assert admin_export_state['exportVisible'], "Export flags button must be visible for aboalhasan"
        assert int(admin_export_state['count']) >= 1, "Flags count must be >= 1"

        # Screenshot: Account view with admin export button
        account_admin_shot = os.path.join(out_dir, "tablet_account_admin_live.png")
        capture_tablet_screen(account_admin_shot)
        print("Saved screenshot:", account_admin_shot)

        # -------------------------------------------------------------
        # STEP 2: Non-Admin / Test Guest Account
        # -------------------------------------------------------------
        print("\n--- [TEST 2: Regular Student / Non-Admin Account] ---")
        page.evaluate("""() => {
            localStorage.setItem('portal_account_v1', JSON.stringify({
                id: 'acc-regular-student',
                handle: 'student_tester',
                name: 'طالب تجريبي'
            }));
            if (window.__portal && window.__portal.renderAccount) {
                window.__portal.renderAccount();
            }
            if (window.__portal && window.__portal.updateAdminFlagsUI) {
                window.__portal.updateAdminFlagsUI();
            }
        }""")
        page.wait_for_timeout(600)

        # Verify export button is now hidden in account profile
        non_admin_export_state = page.evaluate("""() => {
            const exportBtn = document.getElementById('account-export-flags');
            return !exportBtn || exportBtn.classList.contains('hidden');
        }""")
        print("Export button hidden for regular student:", non_admin_export_state)
        assert non_admin_export_state, "Export button must be hidden for non-admin"

        # Screenshot: Account view for regular student (no admin export)
        guest_account_shot = os.path.join(out_dir, "tablet_account_student_live.png")
        capture_tablet_screen(guest_account_shot)
        print("Saved screenshot:", guest_account_shot)

        # Enter quiz as regular student
        page.evaluate(f"(h) => {{ location.hash = h; }}", f"#/quiz/{sid}/{qid}")
        page.wait_for_timeout(1000)
        if page.locator('#btn-start-quiz').is_visible():
            tap('#btn-start-quiz')
            page.wait_for_timeout(800)
        page.wait_for_selector('#question-card', timeout=10000)

        # Verify flag button is hidden for regular student
        flag_hidden_for_student = page.evaluate("""() => {
            const btn = document.getElementById('btn-flag-question');
            return !btn || btn.classList.contains('hidden');
        }""")
        print("Flag button hidden for student in quiz:", flag_hidden_for_student)
        assert flag_hidden_for_student, "Flag button must be hidden for non-admin"

        # Screenshot: Quiz view for regular student (clean card header with only bookmark)
        guest_quiz_shot = os.path.join(out_dir, "tablet_quiz_student_live.png")
        capture_tablet_screen(guest_quiz_shot)
        print("Saved screenshot:", guest_quiz_shot)

        # Cleanly exit quiz
        tap('#btn-exit')
        page.wait_for_selector('#leave-go', timeout=5000)
        tap('#leave-go')
        page.wait_for_timeout(500)

        # -------------------------------------------------------------
        # STEP 3: Restore user's authentic account state
        # -------------------------------------------------------------
        print("\n--- [Restoring user account state on tablet] ---")
        if prev_raw:
            page.evaluate(f"() => {{ localStorage.setItem('portal_account_v1', {json.dumps(prev_raw)}); }}")
        else:
            page.evaluate("""() => {
                localStorage.setItem('portal_account_v1', JSON.stringify({
                    handle: 'aboalhasan',
                    name: 'ابو الحسن'
                }));
            }""")
        if prev_pin:
            page.evaluate(f"() => {{ localStorage.setItem('portal_pin_v1', {json.dumps(prev_pin)}); }}")
        
        page.evaluate("(h) => { location.hash = h; }", "#/")
        page.wait_for_timeout(800)
        print("Tablet restored cleanly!")

        print("\n>>> ALL TABLET LIVE VERIFICATIONS PASSED SUCCESSFULLY! <<<")

if __name__ == '__main__':
    run_tablet_verification()
